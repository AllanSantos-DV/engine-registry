// test-retry-opcional.mjs — a retentativa com espera crescente em falha transitória de rede é opt-in (ENGINE_KIT_RETRY ou --retry N) e desligada por padrão.
//
// O que precisa ser verdade:
//   • sem a opção, o comportamento é o de sempre: a primeira falha (HTTP 5xx ou conexão derrubada) aborta, com uma única requisição;
//   • com a opção, falha transitória (5xx, 429, conexão derrubada) é repetida até N vezes e a requisição que dá certo entrega o corpo;
//   • erro que não é transitório (404 e as outras respostas 4xx) nunca é repetido, e acabando as tentativas o último erro sobe;
//   • valor inválido da variável vale zero, e o teto é 5 tentativas, por mais que se peça;
//   • pelo CLI, `--retry N` aceita 0 a 5, recusa o resto e vale só para os verbos que falam com o registry; o uso documenta a opção.
// Hermético: servidor HTTP local em porta livre, HOME e ENGINE_KIT_HOME isolados, nenhum registry real.
//
//   node tests/test-retry-opcional.mjs
import "./_tmp.mjs";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-retry-"));
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: join(RUN, "kit-home"), ENGINE_KIT_NO_AUTO_UPDATE: "1" });
const { fetchBuf, tentativasDeRede } = await import("../kit/provision.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

/** Servidor que responde com cada item de `roteiro` em ordem (status, "derruba" ou "ok"), e `ok` quando acaba. */
const servir = async (roteiro, corpo = "{}") => {
  const vistas = { n: 0 };
  const srv = createServer((q, res) => {
    const passo = roteiro[vistas.n++] ?? "ok";
    if (passo === "derruba") { q.socket.destroy(); return; }
    res.writeHead(passo === "ok" ? 200 : passo).end(passo === "ok" ? corpo : "");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${srv.address().port}/manifest.json`, vistas, fecha: () => srv.close() };
};
const tenta = async (url) => { try { return { corpo: String(await fetchBuf(url, 5000)) }; } catch (e) { return { erro: e.message, status: e.status }; } };

console.log("== desligada por padrão ==");
{
  delete process.env.ENGINE_KIT_RETRY;
  const s = await servir([503]);
  const r = await tenta(s.url);
  check("sem a opção, o 503 aborta na primeira e há uma requisição só", r.status === 503 && s.vistas.n === 1, JSON.stringify({ r, n: s.vistas.n }));
  s.fecha();
  const d = await servir(["derruba"]);
  const rd = await tenta(d.url);
  check("sem a opção, a conexão derrubada aborta na primeira", rd.erro !== undefined && d.vistas.n === 1, JSON.stringify({ rd, n: d.vistas.n }));
  d.fecha();
}

console.log("\n== ligada ==");
{
  process.env.ENGINE_KIT_RETRY = "2";
  const s = await servir([503, 502], "{\"ok\":true}");
  const r = await tenta(s.url);
  check("dois 5xx e depois 200 com ENGINE_KIT_RETRY=2: entrega o corpo na terceira requisição", r.corpo === "{\"ok\":true}" && s.vistas.n === 3, JSON.stringify({ r, n: s.vistas.n }));
  s.fecha();
  const d = await servir(["derruba"], "{\"ok\":true}");
  const rd = await tenta(d.url);
  check("conexão derrubada e depois 200: repetida e entrega o corpo", rd.corpo === "{\"ok\":true}" && d.vistas.n === 2, JSON.stringify({ rd, n: d.vistas.n }));
  d.fecha();
  const t = await servir([429], "{}");
  const rt = await tenta(t.url);
  check("429 conta como transitório", rt.corpo === "{}" && t.vistas.n === 2, JSON.stringify({ rt, n: t.vistas.n }));
  t.fecha();
  const q = await servir([404]);
  const rq = await tenta(q.url);
  check("404 nunca é repetido, por maior que seja o N", rq.status === 404 && q.vistas.n === 1, JSON.stringify({ rq, n: q.vistas.n }));
  q.fecha();
  process.env.ENGINE_KIT_RETRY = "1";
  const e = await servir([503, 503, 503]);
  const re = await tenta(e.url);
  check("acabaram as tentativas: o último erro sobe (duas requisições com N=1)", re.status === 503 && e.vistas.n === 2, JSON.stringify({ re, n: e.vistas.n }));
  e.fecha();
  delete process.env.ENGINE_KIT_RETRY;
}

console.log("\n== valor da variável ==");
{
  check("vazio, texto e negativo valem zero", [undefined, "", "abc", "-3"].every((v) => tentativasDeRede({ ENGINE_KIT_RETRY: v }) === 0));
  check("de 1 a 5 vale o próprio número, e acima disso o teto é 5", tentativasDeRede({ ENGINE_KIT_RETRY: "2" }) === 2 && tentativasDeRede({ ENGINE_KIT_RETRY: "5" }) === 5 && tentativasDeRede({ ENGINE_KIT_RETRY: "999" }) === 5);
}

console.log("\n== pelo CLI ==");
{
  const env = { ...process.env, ENGINE_KIT_NO_AUTO_UPDATE: "1" };
  delete env.ENGINE_KIT_RETRY;
  const cli = (...a) => new Promise((ok) => {
    const p = spawn(process.execPath, ["kit/cli.mjs", ...a], { cwd: new URL("..", import.meta.url), env, windowsHide: true });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => ok({ code, out, err }));
  });
  const { readFileSync } = await import("node:fs");
  const manifesto = readFileSync(new URL("../manifest.json", import.meta.url), "utf8");

  const sem = await servir([503, 503], manifesto);
  const r0 = await cli("ensure", "vxk", "--dry-run", "--registry-url", sem.url);
  check("sem --retry, o registry que falha duas vezes derruba o comando (exit 1, uma requisição)", r0.code === 1 && sem.vistas.n === 1, JSON.stringify({ code: r0.code, n: sem.vistas.n, err: r0.err.slice(0, 120) }));
  sem.fecha();
  const com = await servir([503, 503], manifesto);
  const r2 = await cli("ensure", "vxk", "--dry-run", "--retry", "2", "--registry-url", com.url);
  check("com --retry 2, o mesmo registry é vencido na terceira requisição (exit 0, plano de instalar)", r2.code === 0 && com.vistas.n === 3 && /PLANO vxk/.test(r2.out), JSON.stringify({ code: r2.code, n: com.vistas.n, out: r2.out.slice(0, 120), err: r2.err.slice(0, 120) }));
  com.fecha();
  for (const ruim of ["9", "x", "-1"]) {
    const r = await cli("ensure", "vxk", "--retry", ruim);
    check(`--retry ${ruim}: recusado, exit 1`, r.code === 1 && /--retry/.test(r.err), r.err);
  }
  const lista = await cli("list", "--retry", "2");
  check("--retry não vale para um verbo que não fala com o registry", lista.code === 1 && /--retry não vale/.test(lista.err), lista.err);
  check("o uso documenta a opção e a variável", /--retry/.test((await cli("--help")).out) && /ENGINE_KIT_RETRY/.test((await cli("--help")).out));
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
