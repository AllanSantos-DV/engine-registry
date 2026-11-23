// test-update-verbo.mjs — `engine-kit update <motor>` aciona o updater próprio do daemon vivo (runtime.updatePath).
//
// O que precisa ser verdade:
//   • o pedido vai por POST em runtime.updatePath, com o token do anúncio só no cabeçalho do manifest (nunca na linha de comando nem na saída);
//   • --check manda { check: true } e só informa, sem aplicar; sem --check o corpo é vazio e o motor decide;
//   • 200 up-to-date, 200 de --check, 202 applying e a recusa 409 (UPDATE_REFUSED, UPDATE_NOT_INSTALLED) viram saída legível, com o exit certo;
//   • 401/403 (token) e motor parado dizem a causa; motor sem updatePath é recusado sem pedido algum e aponta o `ensure`.
// Hermético: HOME isolado, o "motor" é um servidor HTTP local com token fictício, nenhum daemon real é tocado, o CLI roda sem rede.
//
//   node tests/test-update-verbo.mjs
import "./_tmp.mjs";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RUN = mkdtempSync(join(tmpdir(), "ee-update-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const bundled = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const grafo = bundled.engines.find((e) => e.name === "motor-de-grafo");
const casa = bundled.engines.find((e) => e.name === "casa-de-embeddings");
const anunciar = (e, url, port, extra = {}) => {
  const file = join(e.home.replace(/^~[/\\]?/, `${RUN}/`), e.runtime.runtimeFile);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify({ url, port, pid: process.pid, version: "0.1.2", shutdownToken: TOKEN, ...extra }));
  return file;
};
const TOKEN = "TOKEN-FICTICIO-do-teste-1a2b3c4d5e6f";

let resposta = [200, { state: "up-to-date" }];
const pedidos = [];
const motor = createServer((q, res) => {
  let raw = "";
  q.on("data", (d) => (raw += d));
  q.on("end", () => {
    if (q.url === "/health") { res.writeHead(200, { "content-type": "application/json" }).end("{}"); return; }
    pedidos.push({ metodo: q.method, rota: q.url, token: q.headers["x-shutdown-token"], tipo: q.headers["content-type"], corpo: raw });
    res.writeHead(resposta[0], { "content-type": "application/json" }).end(JSON.stringify(resposta[1]));
  });
});
await new Promise((r) => motor.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${motor.address().port}`;
const arquivo = anunciar(grafo, url, motor.address().port);

const stub = join(RUN, "so-local.mjs");
writeFileSync(stub, `const real = globalThis.fetch;
globalThis.fetch = (u, o) => (/^http:\\/\\/127\\.0\\.0\\.1[:/]/.test(String(u)) ? real(u, o) : Promise.reject(Object.assign(new Error("offline"), { cause: { code: "ECONNREFUSED" } })));\n`);
const cli = (...args) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["--import", pathToFileURL(stub).href, "kit/cli.mjs", ...args], {
    cwd: new URL("..", import.meta.url), windowsHide: true,
    env: { ...process.env, HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME, ENGINE_KIT_NO_AUTO_UPDATE: "1" },
  });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ code, out, err }));
});
const json = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
const semToken = (r) => !(r.out + r.err).includes(TOKEN);
const ultimo = () => pedidos.at(-1);

console.log("== engine-kit update: pedido ao updater do daemon ==");
{
  pedidos.length = 0;
  resposta = [200, { state: "up-to-date", current: "0.1.3", available: "0.1.3", updateAvailable: false }];
  const r = await cli("update", "motor-de-grafo");
  check("sem --check: POST em runtime.updatePath, token só no cabeçalho do manifest, corpo vazio", r.code === 0 && pedidos.length === 1 && ultimo().metodo === "POST" && ultimo().rota === grafo.runtime.updatePath && ultimo().token === TOKEN && ultimo().corpo === "", JSON.stringify(ultimo()));
  check("já na última: diz que está em dia, exit 0, sem vazar o token", /em dia/.test(r.out) && /0\.1\.3/.test(r.out) && semToken(r), r.out + r.err);

  const c = await cli("update", "motor-de-grafo", "--check", "--json");
  check("--check manda { check: true } como JSON e não aplica", c.code === 0 && ultimo().tipo === "application/json" && JSON.parse(ultimo().corpo).check === true, JSON.stringify(ultimo()));
  check("--json devolve o estado do motor e nunca o token", json(c)?.ok === true && json(c).name === "motor-de-grafo" && json(c).state === "up-to-date" && semToken(c), c.out);

  resposta = [200, { current: "0.1.2", available: "0.1.3", updateAvailable: true }];
  const nova = await cli("update", "motor-de-grafo", "--check");
  check("--check com versão nova: mostra a atual e a disponível, exit 0", nova.code === 0 && /0\.1\.2/.test(nova.out) && /0\.1\.3/.test(nova.out) && /disponível/.test(nova.out), nova.out + nova.err);

  resposta = [202, { state: "applying", version: "0.1.3", current: "0.1.2" }];
  const ap = await cli("update", "motor-de-grafo");
  check("202 applying: diz que a troca foi agendada para a versão nova e que o motor reinicia sozinho, exit 0", ap.code === 0 && /agendad/.test(ap.out) && /0\.1\.3/.test(ap.out) && /reinicia/.test(ap.out), ap.out + ap.err);
}

console.log("\n== recusas e falhas dizem a causa ==");
{
  resposta = [409, { code: "UPDATE_REFUSED", message: "assinatura Ed25519 não confere" }];
  const rec = await cli("update", "motor-de-grafo");
  check("409 UPDATE_REFUSED: exit 1 com o motivo do motor", rec.code === 1 && /UPDATE_REFUSED/.test(rec.err) && /assinatura Ed25519/.test(rec.err) && semToken(rec), rec.err);

  resposta = [409, { code: "UPDATE_NOT_INSTALLED", message: "o motor não roda da instalação empacotada" }];
  const ni = await cli("update", "motor-de-grafo", "--json");
  check("409 UPDATE_NOT_INSTALLED: ok:false com o código, exit 1", ni.code === 1 && json(ni)?.ok === false && /UPDATE_NOT_INSTALLED/.test(json(ni).detail), ni.out);

  resposta = [401, { code: "TOKEN_REQUIRED" }];
  const t1 = await cli("update", "motor-de-grafo");
  resposta = [403, { code: "TOKEN_MISMATCH" }];
  const t2 = await cli("update", "motor-de-grafo");
  check("401 e 403: o erro cita o token do anúncio sem mostrá-lo", t1.code === 1 && t2.code === 1 && /TOKEN_REQUIRED/.test(t1.err) && /TOKEN_MISMATCH/.test(t2.err) && /run[\\/]daemon\.json/.test(t2.err) && semToken(t1) && semToken(t2), t1.err + t2.err);

  writeFileSync(arquivo, JSON.stringify({ url, port: motor.address().port, pid: process.pid, version: "0.1.2" }));
  pedidos.length = 0;
  const st = await cli("update", "motor-de-grafo");
  check("anúncio sem token: recusa antes de qualquer pedido, dizendo o que falta", st.code === 1 && /shutdownToken/.test(st.err) && pedidos.length === 0, st.err);
  anunciar(grafo, url, motor.address().port);

  const velho = await new Promise((r) => { const s = createServer(() => {}); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
  anunciar(grafo, `http://127.0.0.1:${velho}`, velho);
  const parado = await cli("update", "motor-de-grafo");
  check("motor parado: erro visível com o comando que resolve, exit 1", parado.code === 1 && /motor-de-grafo/.test(parado.err) && /engine-kit ensure/.test(parado.err), parado.err);
  anunciar(grafo, url, motor.address().port);
}

console.log("\n== quem não tem updater próprio ==");
{
  anunciar(casa, url, motor.address().port);
  pedidos.length = 0;
  const r = await cli("update", "casa-de-embeddings");
  check("motor sem runtime.updatePath: recusado sem pedido algum, apontando o ensure", r.code === 1 && pedidos.length === 0 && /updater próprio/.test(r.err) && /engine-kit ensure casa-de-embeddings/.test(r.err), r.err);
  const desc = await cli("update", "motor-que-nao-existe");
  check("motor fora do manifest: erro com o nome, exit 1", desc.code === 1 && /motor-que-nao-existe/.test(desc.err), desc.err);
  const flag = await cli("update", "motor-de-grafo", "--version", "1.0.0");
  check("flag que não vale para o verbo continua recusada", flag.code === 1 && /--version não vale para `update`/.test(flag.err), flag.err);
  const uso = await cli("--help");
  check("o uso lista o verbo update", /engine-kit update <motor>/.test(uso.out), uso.out);
}

motor.close();
rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
