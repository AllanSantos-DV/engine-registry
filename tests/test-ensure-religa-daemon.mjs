// test-ensure-religa-daemon.mjs — o `ensure` que derruba um daemon vivo para trocar a instalação o RELIGA com o executável novo.
//
// O que precisa ser verdade:
//   • daemon vivo na v1, ensure para a v2: o daemon da v2 está no ar (pid novo, versão nova, /health responde), o resultado diz `restarted.ok` e a saída fica em run/boot.log;
//   • daemon parado antes: nada é lançado e o resultado não tem `restarted`;
//   • a v2 não sobe (sai com erro): `restarted.ok:false` com a razão e o boot.log, o ensure falha com o texto "NÃO está no ar" e o CLI sai com 1;
//   • a v2 sobe e nunca anuncia: a falha vem dentro do prazo injetado, sem pendurar, e o processo que não anunciou é encerrado;
//   • `--dry-run` não derruba nem religa (o plano avisa que derrubaria e religaria); motor com `runtime.updatePath` não é trocado nem religado;
//   • kind=cli que não é a casa nem o grafo (o vxk) é derrubado como antes e NÃO é religado.
// Hermético: registry e downloads de memória (o .tgz é real), HOME e ENGINE_KIT_HOME isolados, porta efêmera própria, sem janela, sem áudio, sem rede.
// Todo processo lançado aqui é encerrado no fim, por PID.
//
//   node tests/test-ensure-religa-daemon.mjs
import "./_tmp.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-religa-"));
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: join(RUN, "kit-home") });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { criarCliOffline } = await import("./_kit-copiado.mjs");
const { ensureCommand, planoEm } = await import("../kit/ensure.mjs");
const religar = await import("../kit/religar.mjs").catch(() => null);
const { homeOf, registry, instalado } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const lancados = new Set();
const matar = (pid) => { if (pid) { try { process.kill(pid); } catch { /* já saiu */ } } };
process.on("exit", () => { for (const p of lancados) { matar(p); } });

const RUNTIME = { transport: "http", runtimeFile: "run/daemon.json", healthPath: "/health", shutdownPath: "/shutdown", shutdownTokenField: "shutdownToken", shutdownTokenHeader: "x-shutdown-token", heartbeatMs: 30000 };

const SOBE = `
import http from 'node:http';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const aqui = dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(readFileSync(join(aqui, 'package.json'), 'utf8')).version;
const shutdownToken = 'tok-' + process.pid;
const srv = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200).end('ok'); return; }
  if (req.url === '/shutdown' && req.method === 'POST') {
    if (req.headers['x-shutdown-token'] !== shutdownToken) { res.writeHead(401).end(); return; }
    res.writeHead(200).end('ok'); setTimeout(() => process.exit(0), 50); return;
  }
  res.writeHead(404).end();
});
srv.listen(0, '127.0.0.1', () => {
  mkdirSync(join(aqui, '..', 'run'), { recursive: true });
  writeFileSync(join(aqui, '..', 'run', 'daemon.json'), JSON.stringify({ port: srv.address().port, pid: process.pid, version, shutdownToken }));
});
`;
const FONTES = {
  sobe: SOBE,
  quebra: "console.error('boom: motor novo quebrado'); process.exit(3);\n",
  mudo: "console.log('subi e nao anuncio'); setInterval(() => {}, 1000);\n",
};
const fonteDe = (v2) => (_nome, versao) => (versao === "1.0.0" ? SOBE : FONTES[v2]);

const ler = (f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };
const daemonJson = (home) => { try { return JSON.parse(readFileSync(join(home, "run", "daemon.json"), "utf8")); } catch { return null; } };
const saude = async (home) => { const d = daemonJson(home); try { return (await fetch(`http://127.0.0.1:${d.port}/health`, { signal: AbortSignal.timeout(2000) })).status; } catch { return null; } };

/** Instala a v1 e, com `vivoAntes`, sobe o daemon dela (cwd = bin, como o real) e espera o anúncio. */
async function preparar(nome, { v2 = "sobe", vivoAntes = true, extraEngine = {} } = {}) {
  const name = `fake-${nome}`;
  process.env.ENGINE_KIT_HOME = join(RUN, `trust-${nome}`);
  mkdirSync(process.env.ENGINE_KIT_HOME, { recursive: true });
  const extra = { [name]: { kind: "daemon", runtime: RUNTIME, ...extraEngine } };
  const r1 = registry({ [name]: "1.0.0" }, { extra, fonte: fonteDe("sobe") });
  const primeira = await ensureCommand(name, r1.opts);
  if (!primeira.ok) { throw new Error(`instalação inicial falhou: ${primeira.reason}`); }
  const home = homeOf(name);
  let pid1 = null;
  if (vivoAntes) {
    const proc = spawn(process.execPath, [join(home, "bin", `${name}.mjs`)], { cwd: join(home, "bin"), windowsHide: true, stdio: "ignore" });
    pid1 = proc.pid; lancados.add(pid1);
    for (let i = 0; i < 100 && daemonJson(home)?.pid !== pid1; i++) { await sleep(100); }
    if (daemonJson(home)?.pid !== pid1) { throw new Error("o daemon v1 não anunciou"); }
  }
  const r2 = registry({ [name]: "1.1.0" }, { extra, fonte: fonteDe(v2) });
  return { name, home, pid1, r2, bootLog: join(home, "run", "boot.log") };
}
const guardar = (r) => { if (r?.restarted?.pid) { lancados.add(r.restarted.pid); } };
const sumiu = async (pid, ms = 5000) => { for (let i = 0; i < ms / 100 && vivo(pid); i++) { await sleep(100); } return !vivo(pid); };

console.log("== o ensure religa o daemon que ele derrubou ==");
{
  const c = await preparar("vivo");
  const linhas = [];
  const r = await ensureCommand(c.name, { ...c.r2.opts, log: (m) => linhas.push(m) });
  guardar(r);
  const dj = daemonJson(c.home);
  check("troca 1.0.0 → 1.1.0", r.ok && r.version === "1.1.0" && r.previous === "1.0.0" && instalado(c.name) === "1.1.0", JSON.stringify(r));
  check("restarted.ok com o pid e a versão do daemon novo", r.restarted?.ok === true && r.restarted.pid > 0 && r.restarted.version === "1.1.0", JSON.stringify(r.restarted));
  check("o pid é novo, o daemon v1 saiu e o v2 está vivo", r.restarted?.pid !== c.pid1 && !vivo(c.pid1) && vivo(r.restarted?.pid) && dj?.pid === r.restarted?.pid, `${c.pid1} → ${r.restarted?.pid}`);
  check("o /health do daemon novo responde 200", (await saude(c.home)) === 200);
  check("a saída do daemon novo vai para run/boot.log", existsSync(c.bootLog) && r.restarted?.bootLog === c.bootLog, String(r.restarted?.bootLog));
  check("o log diz que religou, antes e depois", linhas.some((l) => l.includes(`${c.name}: religando o daemon que estava no ar...`)) && linhas.some((l) => l.includes(`${c.name}: daemon religado (pid ${r.restarted?.pid}`)), linhas.join(" | "));
}

console.log("\n== daemon que não estava no ar não é lançado ==");
{
  const c = await preparar("parado", { vivoAntes: false });
  const linhas = [];
  const r = await ensureCommand(c.name, { ...c.r2.opts, log: (m) => linhas.push(m) });
  check("troca 1.0.0 → 1.1.0", r.ok && r.version === "1.1.0" && instalado(c.name) === "1.1.0", JSON.stringify(r));
  check("sem campo restarted", r.restarted === undefined, JSON.stringify(r.restarted));
  check("nada foi lançado: sem daemon.json nem boot.log, sem linha de religar", daemonJson(c.home) === null && !existsSync(c.bootLog) && !linhas.some((l) => /religando/.test(l)));
}

console.log("\n== a v2 não consegue subir: falha visível ==");
{
  const c = await preparar("quebra", { v2: "quebra" });
  const r = await ensureCommand(c.name, { ...c.r2.opts, religarPrazoMs: 20000 });
  guardar(r);
  check("o ensure falha e a v2 ficou instalada", r.ok === false && instalado(c.name) === "1.1.0", JSON.stringify(r));
  check("restarted.ok:false com a razão (código de saída e a linha do erro) e o boot.log", r.restarted?.ok === false && /código 3/.test(r.restarted.reason) && /boom: motor novo quebrado/.test(r.restarted.reason) && r.restarted.bootLog === c.bootLog, JSON.stringify(r.restarted));
  check("o texto diz que o daemon NÃO está no ar e aponta o boot.log", /NÃO está no ar/.test(r.reason ?? "") && (r.reason ?? "").includes(c.bootLog), r.reason);
  check("o boot.log tem a saída da v2", /boom: motor novo quebrado/.test(ler(c.bootLog)));
}

console.log("\n== a v2 sobe e nunca anuncia: o prazo corta ==");
{
  const c = await preparar("mudo", { v2: "mudo" });
  const t0 = Date.now();
  const r = await ensureCommand(c.name, { ...c.r2.opts, religarPrazoMs: 1500 });
  const gasto = Date.now() - t0;
  guardar(r);
  check("falha dentro do prazo, sem pendurar", r.ok === false && r.restarted?.ok === false && gasto < 20000, `${gasto}ms ${JSON.stringify(r.restarted)}`);
  check("a razão cita o prazo e o texto diz que o daemon NÃO está no ar", /não anunciou em 1500ms/.test(r.restarted?.reason ?? "") && /NÃO está no ar/.test(r.reason ?? "") && (r.reason ?? "").includes(c.bootLog), r.reason);
  check("o processo que subiu e não anunciou é encerrado", r.restarted?.pid > 0 && (await sumiu(r.restarted.pid)), String(r.restarted?.pid));
}

console.log("\n== --dry-run não derruba nem religa ==");
{
  const c = await preparar("dry");
  const r = await ensureCommand(c.name, { ...c.r2.opts, dryRun: true });
  check("o plano é atualizar e avisa que derrubaria e religaria o daemon vivo", r.ok && r.dryRun === true && r.plan === "atualizar" && r.religaria === true && /derrubaria e religaria o daemon vivo/.test(planoEm(r) ?? ""), JSON.stringify(r));
  check("o daemon v1 segue vivo no mesmo pid, nada foi lançado nem baixado, a v1 segue instalada", vivo(c.pid1) && daemonJson(c.home)?.pid === c.pid1 && !existsSync(c.bootLog) && instalado(c.name) === "1.0.0" && Object.keys(c.r2.baixados).length === 0);
  const p = await preparar("dry-parado", { vivoAntes: false });
  const rp = await ensureCommand(p.name, { ...p.r2.opts, dryRun: true });
  check("sem daemon vivo o plano não fala em religar", rp.ok && rp.plan === "atualizar" && rp.religaria === undefined && !/religaria/.test(planoEm(rp) ?? ""), JSON.stringify(rp));
}

console.log("\n== motor com runtime.updatePath não é trocado nem religado ==");
{
  const c = await preparar("update", { extraEngine: { runtime: { ...RUNTIME, updatePath: "/update" } } });
  const linhas = [];
  const r = await ensureCommand(c.name, { ...c.r2.opts, log: (m) => linhas.push(m) });
  check("fica na v1 e avisa a v2 disponível", r.ok && r.reused === true && r.version === "1.0.0" && r.available === "1.1.0" && instalado(c.name) === "1.0.0", JSON.stringify(r));
  check("sem restarted; o daemon v1 segue vivo no mesmo pid e nada foi lançado", r.restarted === undefined && vivo(c.pid1) && daemonJson(c.home)?.pid === c.pid1 && !existsSync(c.bootLog) && !linhas.some((l) => /religando|shutdown pedido/.test(l)), linhas.join(" | "));
}

console.log("\n== kind=cli que não é a casa nem o grafo: derrubado, não religado ==");
{
  const c = await preparar("cli", { extraEngine: { kind: "cli" } });
  const r = await ensureCommand(c.name, c.r2.opts);
  check("troca 1.0.0 → 1.1.0 com o daemon v1 derrubado", r.ok && r.version === "1.1.0" && !vivo(c.pid1), JSON.stringify(r));
  check("não foi religado: sem restarted, sem boot.log", r.restarted === undefined && !existsSync(c.bootLog), JSON.stringify(r.restarted));
}

console.log("\n== quem é religável ==");
{
  const real = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).engines;
  const quem = (n) => religar?.religavel({ ...real.find((e) => e.name === n) }) === true;
  check("a casa e o motor de grafo (kind=cli, mas o cliente compartilhado os sobe) e os kind=daemon são religáveis", quem("casa-de-embeddings") && quem("motor-de-grafo") && quem("embed-house"));
  check("o mcp-gateway (lançador próprio no ensureGateway) não é religado pelo ensure", religar !== null && !quem("mcp-gateway"));
  check("o vxk (kind=cli, shim stdio) e o motor sem bloco runtime não são", religar !== null && !quem("vxk") && religar.religavel({ name: "x", kind: "daemon" }) === false);
  check("o prazo padrão é uma constante nomeada de 60 s", religar?.PRAZO_RELIGAR_MS === 60000);
}

console.log("\n== pelo CLI de verdade (exit code, texto, --json) ==");
async function cli(nome, v2, args) {
  const c = await preparar(nome, { v2 });
  const { cli: roda } = await criarCliOffline(RUN, { manifest: c.r2.manifest, artefatos: c.r2.artefatos, kitHome: process.env.ENGINE_KIT_HOME, env: { LOOPBACK_REAL: "1", ENGINE_KIT_NO_AUTO_UPDATE: "" } });
  const r = roda("ensure", c.name, ...args);
  const dj = daemonJson(c.home);
  if (dj?.pid) { lancados.add(dj.pid); }
  return { c, r, dj };
}
{
  const { c, r, dj } = await cli("cli-ok", "sobe", ["--json"]);
  const j = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
  check("--json: exit 0, restarted.ok com pid e versão do daemon que está no ar", r.status === 0 && j?.ok === true && j.restarted?.ok === true && j.restarted.pid === dj?.pid && j.restarted.version === "1.1.0" && vivo(dj?.pid) && !vivo(c.pid1), `${r.status} ${r.stdout} ${r.stderr}`);
}
{
  const { c, r } = await cli("cli-texto", "sobe", []);
  check("texto: exit 0 e as duas linhas de log", r.status === 0 && r.stdout.includes(`[engine-kit] ${c.name}: religando o daemon que estava no ar...`) && r.stdout.includes(`[engine-kit] ${c.name}: daemon religado (pid `), `${r.status} ${r.stdout} ${r.stderr}`);
}
{
  const { c, r } = await cli("cli-falha", "quebra", []);
  check("v2 que não sobe: exit 1, FALHOU com o boot.log e dizendo que o daemon NÃO está no ar", r.status === 1 && /FALHOU /.test(r.stderr) && /NÃO está no ar/.test(r.stderr) && r.stderr.includes(c.bootLog), `${r.status} ${r.stderr}`);
}
{
  const { c, r } = await cli("cli-falha-json", "quebra", ["--json"]);
  const j = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
  check("--json da falha: exit 1, ok:false e restarted.ok:false com o bootLog", r.status === 1 && j?.ok === false && j.restarted?.ok === false && j.restarted.bootLog === c.bootLog && /NÃO está no ar/.test(j.detail), `${r.status} ${r.stdout}`);
}

for (const p of lancados) { matar(p); }
console.log(failures === 0 ? "\n== TUDO VERDE ==" : `\n== ${failures} FALHA(S) ==`);
process.exitCode = failures === 0 ? 0 : 1;
