// real-grafo-tipos.mjs — o grafoClient contra o motor-de-grafo INSTALADO, em instância isolada (home temporário, porta efêmera, sem janela).
// Não faz parte de `npm test` (precisa do motor instalado). Nunca toca o daemon do usuário: só desliga o pid que subiu, pelo token do próprio anúncio.
//
//   node tests/real-grafo-tipos.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { grafoClient } from "../kit/client.mjs";

const EXE = join(homedir(), ".motor-de-grafo", "bin", "motor-de-grafo.exe");
if (!existsSync(EXE)) { throw new Error(`motor-de-grafo não instalado em ${EXE} → engine-kit ensure motor-de-grafo`); }

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const home = mkdtempSync(join(tmpdir(), "grafo-real-"));
const proc = spawn(EXE, [], { env: { ...process.env, MOTOR_DE_GRAFO_HOME: home, MOTOR_DE_GRAFO_PORT: "0" }, stdio: "ignore", windowsHide: true });
const anuncio = join(home, "run", "daemon.json");
let a = null;
for (let i = 0; i < 180 && !a; i++) { await sleep(500); try { a = JSON.parse(readFileSync(anuncio, "utf8")); } catch { /* ainda subindo */ } }
if (!a?.url) { proc.kill(); throw new Error("o motor isolado não anunciou em 90 s"); }
console.log(`== motor ${a.version} em ${a.url} (isolado) ==\n`);
check("o motor instalado é o 0.1.1", a.version === "0.1.1", a.version);

try {
  const g = grafoClient({ url: a.url });
  const nome = `real_${process.pid}`;
  const k0 = await g.kinds();
  check("kinds lista o catálogo com o tipo code", k0.ok && k0.result.kinds.some((k) => k.name === "code"), JSON.stringify(k0).slice(0, 160));
  const reg = await g.kinds({ name: nome, owner: "kit-real", fulltext: ["name", "content"], edge_types: [`${nome.toUpperCase()}_LIGA`] });
  check("kinds registra um tipo novo", reg.ok && reg.result.created === true, JSON.stringify(reg).slice(0, 200));
  const ligacao = `${nome.toUpperCase()}_LIGA`;
  const grafo = `grafo-${nome}`;
  const w = await g.nodes(grafo, [
    { id: `${nome}:a`, kind: nome, name: "Nota A", props: { origem: "kit" }, content: "decisão sobre o motor único de grafos" },
    { id: `${nome}:b`, kind: nome, name: "Nota B", props: { origem: "outro" }, content: "texto de apoio" }]);
  check("nodes grava os dois nós", w.ok && w.result.upserted === 2, JSON.stringify(w).slice(0, 200));
  const e = await g.edges(grafo, [{ source: `${nome}:a`, target: `${nome}:b`, type: ligacao }]);
  check("edges grava a aresta", e.ok && e.result.upserted === 1, JSON.stringify(e).slice(0, 200));
  const n = await g.neighbors(grafo, `${nome}:a`, { direction: "out" });
  check("neighbors devolve o vizinho pela aresta do tipo", n.ok && n.result.neighbors.some((v) => v.id === `${nome}:b`), JSON.stringify(n).slice(0, 240));
  const s = await g.symbolsOf(grafo, { kinds: [nome], where: { origem: "kit" } });
  check("symbolsOf com where acha só o nó da propriedade", s.ok && s.result.symbols.length === 1 && s.result.symbols[0].id === `${nome}:a`, JSON.stringify(s).slice(0, 240));
  const t = await g.symbolsOf(grafo, { kinds: [nome], query: "motor único", mode: "text" });
  check("symbolsOf por texto acha o conteúdo", t.ok && t.result.symbols.some((x) => x.id === `${nome}:a`), JSON.stringify(t).slice(0, 240));
  const q = await g.searchOf(grafo, { kinds: [nome], query: "Nota A", hops: 1 });
  check("searchOf traz a semente e a expansão", q.ok && JSON.stringify(q.result).includes(`${nome}:a`), JSON.stringify(q).slice(0, 240));
  const b = await g.backup(grafo);
  check("backup grava cópia conferida com sha256 e linhas", b.ok && /^[0-9a-f]{64}$/.test(b.result.sha256 ?? "") && b.result.rows && !String(b.result.file).includes(":\\"), JSON.stringify(b).slice(0, 240));
  const d = await g.deleteNodes(grafo, [`${nome}:b`]);
  check("deleteNodes remove o nó e a aresta que o tocava", d.ok && d.result.deleted === 1, JSON.stringify(d).slice(0, 200));
  const n2 = await g.neighbors(grafo, `${nome}:a`);
  check("depois da remoção o vizinho some", n2.ok && n2.result.neighbors.length === 0, JSON.stringify(n2).slice(0, 200));
  const ruim = await g.nodes(grafo, [{ id: "livro:1", kind: "livro_inexistente", name: "L" }]);
  check("tipo desconhecido volta HTTP 400 UNKNOWN_KIND, nunca vira outro tipo", !ruim.ok && ruim.status === 400 && /UNKNOWN_KIND/.test(ruim.reason), ruim.reason);
  const dono = await g.kinds({ name: nome, owner: "outro-produto" });
  check("outro dono não registra o mesmo tipo (409 KIND_OWNED)", !dono.ok && dono.status === 409 && /KIND_OWNED/.test(dono.reason), dono.reason);
} finally {
  const r = await fetch(new URL(a.shutdownPath ?? "/api/v1/server/shutdown", a.url), { method: "POST", headers: { "x-shutdown-token": a.shutdownToken } }).catch(() => null);
  await sleep(2000);
  if (proc.exitCode === null) { proc.kill(); }
  console.log(`desligamento pelo token: HTTP ${r?.status ?? "sem resposta"}`);
  rmSync(home, { recursive: true, force: true });
}
console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
