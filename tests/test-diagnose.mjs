// test-diagnose.mjs — prova o diagnóstico de vida e de ponteiro do doctor (kit/diagnose.mjs).
// Só leitura, em pastas temporárias: nenhum motor real é consultado e nenhum daemon é tocado.
import "./_tmp.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { lifeOf, pointerOf, detailLines, engineView } from "../kit/diagnose.mjs";

let fail = 0;
const check = (name, cond, detail = "") => {
  console.log(`  ${cond ? "OK  " : "FALHOU"} ${name}${cond ? "" : ` — ${detail}`}`);
  if (!cond) fail++;
};

const tmp = mkdtempSync(join(tmpdir(), "ek-diagnose-"));
const PID_INEXISTENTE = 2147483646;
const motor = (nome, runtime) => {
  const homeDir = join(tmp, nome);
  mkdirSync(join(homeDir, "run"), { recursive: true });
  mkdirSync(join(homeDir, "bin"), { recursive: true });
  return { name: nome, homeDir, install: { entry: "bin/cli.mjs", extractTo: "bin" }, runtime };
};
const rt = { transport: "http", runtimeFile: "run/daemon.json", heartbeatMs: 30000 };
const escreve = (e, arquivo, obj) => writeFileSync(join(e.homeDir, arquivo), JSON.stringify(obj));

console.log("== vida ==");
const semBloco = motor("sem-bloco");
check("motor sem bloco runtime → SEM-DECLARAÇÃO (o doctor não inventa vida)", (await lifeOf(semBloco)).state === "SEM-DECLARAÇÃO");
check("transporte por pipe, sem arquivo de runtime → SEM-DECLARAÇÃO e diz o transporte",
  /pipe/.test((await lifeOf(motor("pipe", { transport: "pipe", pipeName: "x" }))).detail));

const parado = motor("parado", rt);
check("sem arquivo de runtime → PARADO", (await lifeOf(parado)).state === "PARADO");

const servidores = [];
const servidor = async (handler) => {
  const requisicoes = [];
  const s = createServer((req, res) => { requisicoes.push(req.url); handler(req, res); });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  servidores.push(s);
  return { port: s.address().port, requisicoes };
};
const portaFechada = async () => {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
};
const responde = (status) => (_req, res) => res.writeHead(status).end();
const anuncia = (nome, runtime, runtimeJson) => { const e = motor(nome, runtime); escreve(e, "run/daemon.json", runtimeJson); return e; };

const saudavel = await servidor((req, res) => res.writeHead(req.url === "/health" ? 200 : 404).end());
const vivo = anuncia("vivo", rt, { pid: process.pid, port: saudavel.port });
const v = await lifeOf(vivo);
check("pid existente e /health 200 → VIVO, com pid e porta no detalhe", v.state === "VIVO" && v.detail.includes(`pid ${process.pid}`) && v.detail.includes(String(saudavel.port)), JSON.stringify(v));
check("VIVO sem divergência não traz aviso", v.warns.length === 0, JSON.stringify(v.warns));

const degradado = await servidor(responde(503));
check("/health 503 (degradado) continua VIVO, como no discover do cliente", (await lifeOf(anuncia("degradado", rt, { pid: process.pid, port: degradado.port }))).state === "VIVO");

const erro500 = await servidor(responde(500));
const t500 = await lifeOf(anuncia("erro500", rt, { pid: process.pid, port: erro500.port }));
check("pid existe mas /health responde 500 → TRAVADO com a causa, nunca VIVO", t500.state === "TRAVADO" && /HTTP 500/.test(t500.detail) && t500.detail.includes("/health"), JSON.stringify(t500));

const recusada = await lifeOf(anuncia("recusada", rt, { pid: process.pid, port: await portaFechada() }));
check("pid existe mas a porta recusa conexão → TRAVADO com ECONNREFUSED", recusada.state === "TRAVADO" && /ECONNREFUSED/.test(recusada.detail), JSON.stringify(recusada));

const mudo = await servidor(() => {});
const calado = await lifeOf(anuncia("calado", rt, { pid: process.pid, port: mudo.port }), { timeoutMs: 200 });
check("pid existe mas /health não responde no prazo → TRAVADO dizendo o prazo", calado.state === "TRAVADO" && /sem resposta em 200ms/.test(calado.detail), JSON.stringify(calado));

const saude = await servidor((req, res) => res.writeHead(req.url === "/saude" ? 200 : 404).end());
check("usa o healthPath do manifest, não um /health fixo", (await lifeOf(anuncia("healthpath", { ...rt, healthPath: "/saude" }, { pid: process.pid, port: saude.port }))).state === "VIVO");

const porUrl = await lifeOf(anuncia("por-url", rt, { pid: process.pid, url: `http://127.0.0.1:${saudavel.port}` }));
check("anúncio com url em vez de porta também é conferido", porUrl.state === "VIVO", JSON.stringify(porUrl));

const semPorta = await lifeOf(anuncia("sem-porta", rt, { pid: process.pid }));
check("pid existe mas o anúncio não traz porta nem url → PID-VIVO, dizendo que o /health não foi conferido (não VIVO)", semPorta.state === "PID-VIVO" && /\/health não conferido/.test(semPorta.detail), JSON.stringify(semPorta));

const portaRuim = await lifeOf(anuncia("porta-ruim", rt, { pid: process.pid, port: 99999 }));
check("porta fora de 1..65535 no anúncio → PID-VIVO nomeando a porta inválida", portaRuim.state === "PID-VIVO" && /99999/.test(portaRuim.detail), JSON.stringify(portaRuim));

const orfao = anuncia("orfao", rt, { pid: PID_INEXISTENTE, port: saudavel.port });
const antesOrfao = saudavel.requisicoes.length;
const o = await lifeOf(orfao);
check("runtime apontando para pid que não existe → ÓRFÃO, nunca VIVO", o.state === "ÓRFÃO" && /não existe/.test(o.detail), JSON.stringify(o));
check("ÓRFÃO não consulta a porta (pode ser de outro processo)", saudavel.requisicoes.length === antesOrfao);

const velho = anuncia("velho", rt, { pid: process.pid, port: saudavel.port });
const antes = new Date(Date.now() - 3600_000);
utimesSync(join(velho.homeDir, "run/daemon.json"), antes, antes);
const lv = await lifeOf(velho);
check("a idade do runtime aparece no detalhe (3600s) com o limite declarado", /há 3600s \(limite 90s\)/.test(lv.detail), lv.detail);
check("heartbeat atrasado é só aviso: o estado segue VIVO", lv.state === "VIVO" && lv.warns.some((w) => /heartbeat/.test(w) && /3600s/.test(w)), JSON.stringify(lv));

const semHb = anuncia("sem-hb", { transport: "http", runtimeFile: "run/daemon.json" }, { pid: process.pid, port: saudavel.port });
utimesSync(join(semHb.homeDir, "run/daemon.json"), antes, antes);
check("motor sem heartbeatMs declarado não ganha aviso de heartbeat", (await lifeOf(semHb)).warns.length === 0);

const gateway = anuncia("mcp-gateway", rt, { pid: process.pid, port: saudavel.port });
utimesSync(join(gateway.homeDir, "run/daemon.json"), antes, antes);
const g = await lifeOf(gateway);
check("mcp-gateway só escreve o runtime no boot: sem aviso de heartbeat, sem limite no detalhe, ainda VIVO", g.state === "VIVO" && g.warns.length === 0 && !/limite/.test(g.detail), JSON.stringify(g));

const versao = (e, v) => writeFileSync(join(e.homeDir, "bin", "package.json"), JSON.stringify({ name: e.name, version: v }));
const diverge = anuncia("diverge", rt, { pid: process.pid, port: saudavel.port, version: "1.0.0" });
versao(diverge, "1.1.0");
const dv = await lifeOf(diverge);
check("versão anunciada ≠ instalada → aviso com as duas versões, estado segue VIVO", dv.state === "VIVO" && dv.warns.some((w) => w.includes("1.0.0") && w.includes("1.1.0")), JSON.stringify(dv));
const igual = anuncia("igual", rt, { pid: process.pid, port: saudavel.port, version: "v1.1.0" });
versao(igual, "1.1.0");
check("versão anunciada igual à instalada (com ou sem 'v') → sem aviso", (await lifeOf(igual)).warns.length === 0);
check("anúncio sem versão ou instalação sem package.json → nada a comparar, sem aviso", (await lifeOf(anuncia("sem-versao", rt, { pid: process.pid, port: saudavel.port }))).warns.length === 0
  && (await lifeOf(anuncia("sem-pkg", rt, { pid: process.pid, port: saudavel.port, version: "1.0.0" }))).warns.length === 0);

const linhas = await detailLines({ name: "diverge", state: "OK", detail: "", warns: [], engine: { ...diverge, status: "ok" } });
check("o doctor mostra o aviso de versão e o estado de vida nas linhas de detalhe", linhas.some((l) => /^aviso: .*1\.0\.0.*1\.1\.0/.test(l)) && linhas.some((l) => l.startsWith("vida: VIVO")), linhas.join(" | "));
const visao = await engineView({ name: "travado", state: "OK", detail: "", warns: [], engine: { ...anuncia("travado", rt, { pid: process.pid, port: erro500.port }), status: "ok" } });
check("engineView (doctor --json) traz life.state TRAVADO e a causa", visao.life.state === "TRAVADO" && /HTTP 500/.test(visao.life.detail), JSON.stringify(visao.life));

for (const s of servidores) { s.closeAllConnections(); s.close(); }

console.log("\n== ponteiro cli.json ==");
const sem = motor("sem-ponteiro");
check("sem cli.json → AUSENTE", pointerOf(sem).state === "AUSENTE");

const ruim = motor("ilegivel");
writeFileSync(join(ruim.homeDir, "cli.json"), "{ não é json");
check("cli.json corrompido → ILEGÍVEL", pointerOf(ruim).state === "ILEGÍVEL");

const dentro = motor("dentro");
writeFileSync(join(dentro.homeDir, "bin", "cli.mjs"), "");
escreve(dentro, "cli.json", { cli: join(dentro.homeDir, "bin", "cli.mjs"), node: process.execPath, version: "1.0.0" });
check("todo caminho existe e o motor está na instalação do kit → OK (campo node e versão não contam como fora)", pointerOf(dentro).state === "OK", JSON.stringify(pointerOf(dentro)));

const quebrado = motor("quebrado");
escreve(quebrado, "cli.json", { cli: join(quebrado.homeDir, "bin", "sumiu.mjs"), node: process.execPath });
const q = pointerOf(quebrado);
check("ponteiro para arquivo inexistente → QUEBRADO, nomeando o campo", q.state === "QUEBRADO" && /cli/.test(q.detail), JSON.stringify(q));

const fora = motor("fora");
const alheio = join(tmp, "outro-lugar.mjs");
writeFileSync(alheio, "");
escreve(fora, "cli.json", { cli: alheio, node: process.execPath });
check("ponteiro para executável que existe mas fica fora da instalação do kit → FORA-DA-INSTALAÇÃO", pointerOf(fora).state === "FORA-DA-INSTALAÇÃO", JSON.stringify(pointerOf(fora)));

rmSync(tmp, { recursive: true, force: true });
console.log(fail === 0 ? "\n== TUDO VERDE ==" : `\n== ${fail} FALHA(S) ==`);
process.exitCode = fail === 0 ? 0 : 1;
