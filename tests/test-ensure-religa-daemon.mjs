// test-ensure-religa-daemon.mjs — o `ensure` que derruba um daemon vivo para trocar a instalação o RELIGA com o executável novo.
//
// O que precisa ser verdade:
//   • daemon vivo na v1, ensure para a v2: o daemon da v2 está no ar (pid novo, versão nova, /health responde), o resultado diz `restarted.ok` e a saída fica em run/boot.log;
//   • daemon parado antes: nada é lançado e o resultado não tem `restarted`;
//   • a v2 não sobe (sai com erro): `restarted.ok:false` com a razão e o boot.log, o ensure falha com o texto "NÃO está no ar" e o CLI sai com 1;
//   • a v2 sobe e nunca anuncia: a falha vem dentro do prazo injetado, sem pendurar, e o processo que não anunciou é encerrado;
//   • `--dry-run` não derruba nem religa (o plano avisa que derrubaria e religaria); motor com `runtime.updatePath` não é trocado nem religado;
//   • kind=cli que não é a casa nem o grafo (o vxk) é derrubado como antes e NÃO é religado;
//   • o daemon novo que outro consumidor já subiu é reconhecido (nada lançado, anúncio intacto); o anúncio de um pid ainda vivo nunca é apagado, e o lançado que perde a corrida não vira falha;
//   • o daemon que anuncia a versão com sufixo `+build` é aceito; o saudável que anuncia outra versão devolve ok:false com a razão e NÃO é morto;
//   • o anúncio de um pid vivo que ainda não responde o /health é esperado até o prazo, sem lançar um segundo daemon;
//   • a troca que falha depois de o daemon cair religa a instalação ANTIGA e diz se subiu; se também não sobe, diz que o daemon NÃO está no ar;
//   • a razão não leva o shutdownToken do runtime.json nem sequência de 24+ caracteres [A-Za-z0-9_-] (hexadecimal, base64, ?token=) do fim do boot.log (viram [omitido]); as outras linhas ficam, em até 5 linhas e 400 caracteres;
//   • daemon com o /health lento (TRAVADO: pid vivo e porta, mas sem resposta em 2 s) é derrubado e religado como o VIVO; o motor não religável que o gancho derrubou deixa uma linha de aviso "derrubado e NÃO religado por este comando", sem mudar o exit;
//   • "o daemon anterior foi religado" só aparece se a instalação anterior existe no disco e subiu; sem ela a razão diz que não existe mais e o daemon NÃO está no ar, sem lançar nada;
//   • anúncio sem pid: nenhum processo é encerrado e a razão diz que o anúncio não traz pid;
//   • entry e runtimeFile fora do home são recusados sem apagar nem lançar; o daemon religado roda na pasta do executável, sem NODE_OPTIONS nem COPILOT_SDK_PATH;
//   • motor que se relança sozinho (shutdownPath com relaunch=1) não é religável; plano desconhecido não vira a palavra "undefined";
//   • só o entry .js, .mjs ou .cjs é lançado por node; o que apenas termina em "js" (bin/foo-js, bin/nodejs) é lançado direto, como executável;
//   • o filho lançado que perde a corrida para outro daemon de versão diferente é encerrado e o outro segue vivo; o filho que é ele mesmo o divergente segue vivo;
//   • o pid anterior que morre perto do fim do prazo não deixa o filho sem tempo: o filho recebe sempre um piso de espera, e o total não passa de prazo + piso;
//   • o filho lançado que perde a corrida para outro daemon da MESMA versão certa, anunciado durante a espera, é encerrado (pid do anúncio diferente do filho) e o outro é o religado;
//   • o daemon da versão certa que fica saudável só depois da última espera é o religado (ok com o pid dele), sem falha: o filho lançado que não anunciou é encerrado e o daemon segue vivo; o filho que é o próprio anunciante não é morto.
// Hermético: registry e downloads de memória (o .tgz é real), HOME e ENGINE_KIT_HOME isolados, porta efêmera própria, sem janela, sem áudio, sem rede.
// Todo processo lançado aqui é encerrado no fim, por PID.
//
//   node tests/test-ensure-religa-daemon.mjs
import "./_tmp.mjs";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-religa-"));
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: join(RUN, "kit-home") });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { RUNTIME, SOBE } = await import("./_daemon-falso.mjs");
const { criarCliOffline } = await import("./_kit-copiado.mjs");
const { ensureCommand, pinCommand, planoEm } = await import("../kit/ensure.mjs");
const { pinOf } = await import("../kit/trust.mjs");
const religar = await import("../kit/religar.mjs").catch(() => null);
const { resolve: resolverMotor } = await import("../kit/resolve.mjs");
const { lifeOf } = await import("../kit/diagnose.mjs");
const { signBlob } = await import("../kit/index.mjs");
const { tarBinary } = await import("../kit/provision.mjs");
const { owner, homeOf, registry, instalado } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const lancados = new Set();
const matar = (pid) => { if (pid) { try { process.kill(pid); } catch { /* já saiu */ } } };
process.on("exit", () => { for (const p of lancados) { matar(p); } });

const FONTES = {
  sobe: SOBE,
  quebra: "console.error('boom: motor novo quebrado'); process.exit(3);\n",
  mudo: "console.log('subi e nao anuncio'); setInterval(() => {}, 1000);\n",
};
const AMBIENTE = SOBE.replace("srv.listen(0, '127.0.0.1', () => {", `srv.listen(0, '127.0.0.1', () => {
  writeFileSync(join(aqui, '..', 'ambiente.json'), JSON.stringify({ cwd: process.cwd(), nodeOptions: process.env.NODE_OPTIONS ?? null, sdk: process.env.COPILOT_SDK_PATH ?? null }));`);
const SOBE_UMA_VEZ = SOBE.replace("readFileSync } from 'node:fs'", "readFileSync, existsSync } from 'node:fs'")
  .replace("const shutdownToken", `const marca = join(aqui, '..', 'ja-subiu');
if (existsSync(marca)) { console.error('boom: religar do anterior quebrado'); process.exit(3); }
writeFileSync(marca, '1');
const shutdownToken`);
const PERDE = `
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const anuncio = join(dirname(fileURLToPath(import.meta.url)), '..', 'run', 'daemon.json');
for (let i = 0; i < 40; i++) {
  try {
    const { port } = JSON.parse(readFileSync(anuncio, 'utf8'));
    if ((await fetch('http://127.0.0.1:' + port + '/health')).status === 200) { console.error('perdi o port-lock: outro daemon ja responde'); process.exit(1); }
  } catch { /* ainda sem anuncio */ }
  await new Promise((r) => setTimeout(r, 100));
}
console.error('perdi o port-lock e nenhum outro daemon respondeu'); process.exit(1);
`;
const LENTO = `
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
let pronto = false;
setTimeout(() => { pronto = true; }, 1500);
const srv = http.createServer((req, res) => { res.writeHead(req.url === '/health' && pronto ? 200 : 404).end(); });
srv.listen(0, '127.0.0.1', () => {
  mkdirSync(join(process.argv[2], 'run'), { recursive: true });
  writeFileSync(join(process.argv[2], 'run', 'daemon.json'), JSON.stringify({ port: srv.address().port, pid: process.pid, version: '1.1.0', shutdownToken: 'x' }));
});
`;
const FILHO = `import { writeFileSync } from 'node:fs'; import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'filho.pid'), String(process.pid)); setInterval(() => {}, 1000);
`;
const SO_NO_FIM = `
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
let ultimo = 0, seguidos = 0;
const srv = http.createServer((req, res) => {
  const agora = Date.now();
  seguidos = agora - ultimo < 200 ? seguidos + 1 : 0;
  ultimo = agora;
  res.writeHead(req.url === '/health' && seguidos >= 2 ? 200 : 404).end();
});
srv.listen(0, '127.0.0.1', () => {
  mkdirSync(join(process.argv[2], 'run'), { recursive: true });
  writeFileSync(join(process.argv[2], 'run', 'daemon.json'), JSON.stringify({ port: srv.address().port, pid: process.pid, version: '1.1.0', shutdownToken: 'x' }));
});
`;
const SO_NO_FIM_DO_FILHO = SO_NO_FIM.replaceAll("process.argv[2]", "dirname(dirname(fileURLToPath(import.meta.url)))")
  .replace("import { join } from 'node:path';", "import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';");
const FORA = (marcador) => `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marcador)}, 'lancado');
`;
const VAZA = (extra) => `
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const aqui = dirname(fileURLToPath(import.meta.url));
${extra}
console.error('boom: motor novo quebrado');
process.exit(3);
`;
const SOBE_SAUDE_LENTA = SOBE.replace("if (req.url === '/health') { res.writeHead(200).end('ok'); return; }", "if (req.url === '/health') { setTimeout(() => res.writeHead(200).end('ok'), 3000); return; }");
const SEM_PID = SOBE.replace("pid: process.pid, ", "");
const SEGREDO_B64 = Buffer.from("segredo-do-daemon-que-nao-pode-vazar").toString("base64url");
const SEGREDO_B64_PADRAO = "ab+/cd/+ef12+/gh34/+ij56==";
const SEGREDO_URL = "AbCdEfGhIjKlMnOpQrStUvWx12";
Object.assign(FONTES, {
  vazaBase64: VAZA(`console.error('token ${SEGREDO_B64} fim');`),
  vazaBase64Padrao: VAZA(`console.error('token ${SEGREDO_B64_PADRAO} fim');`),
  vazaUrl: VAZA(`console.error('GET http://127.0.0.1:8080/cb?token=${SEGREDO_URL} falhou');`),
  vazaLongo: VAZA("for (let i = 0; i < 7; i++) { console.error('linha-' + i + ' ' + 'texto comum '.repeat(30)); }"),
  perde: PERDE,
  vazaToken: VAZA(`mkdirSync(join(aqui, '..', 'run'), { recursive: true });
writeFileSync(join(aqui, '..', 'run', 'daemon.json'), JSON.stringify({ port: 1, pid: process.pid, version: '1.1.0', shutdownToken: 'segredo-do-shutdown' }));
console.error('subindo com shutdownToken=segredo-do-shutdown');`),
  vazaHex: VAZA("console.error('chave ' + 'ab12'.repeat(16) + ' fim');"),
});
const fonteDe = (v2, v1 = SOBE) => (_nome, versao) => (versao === "1.0.0" ? v1 : FONTES[v2] ?? v2);

const ler = (f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };
const daemonJson = (home) => { try { return JSON.parse(readFileSync(join(home, "run", "daemon.json"), "utf8")); } catch { return null; } };
const saude = async (home) => { const d = daemonJson(home); try { return (await fetch(`http://127.0.0.1:${d.port}/health`, { signal: AbortSignal.timeout(2000) })).status; } catch { return null; } };

/** Instala a v1 e, com `vivoAntes`, sobe o daemon dela (cwd = bin, como o real) e espera o anúncio. */
async function preparar(nome, { v2 = "sobe", v1 = SOBE, vivoAntes = true, extraEngine = {} } = {}) {
  const name = `fake-${nome}`;
  process.env.ENGINE_KIT_HOME = join(RUN, `trust-${nome}`);
  mkdirSync(process.env.ENGINE_KIT_HOME, { recursive: true });
  const extra = { [name]: { kind: "daemon", runtime: RUNTIME, ...extraEngine } };
  const r1 = registry({ [name]: "1.0.0" }, { extra, fonte: fonteDe("sobe", v1) });
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
  const r2 = registry({ [name]: "1.1.0" }, { extra, fonte: fonteDe(v2, v1) });
  return { name, home, pid1, r2, bootLog: join(home, "run", "boot.log") };
}
const guardar = (r) => { if (r?.restarted?.pid) { lancados.add(r.restarted.pid); } };
const AVISO_NAO_RELIGADO = /daemon derrubado e NÃO religado por este comando \(quem o sobe é o consumidor\)/;
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
  check("o daemon religado não gera o aviso de 'derrubado e NÃO religado'", !linhas.some((l) => AVISO_NAO_RELIGADO.test(l)), linhas.join(" | "));
}

console.log("\n== daemon com o /health lento (TRAVADO) é derrubado e religado ==");
{
  const c = await preparar("travado", { v1: SOBE_SAUDE_LENTA });
  const motor = await resolverMotor(c.name, { manifest: c.r2.manifest });
  check("(controle) o daemon antigo está TRAVADO: o pid vive, mas o /health passa de 2 s", (await lifeOf(motor.engine)).state === "TRAVADO");
  const plano = await ensureCommand(c.name, { ...c.r2.opts, dryRun: true });
  check("o --dry-run avisa que derrubaria e religaria o daemon travado", plano.ok && plano.religaria === true, JSON.stringify(plano));
  const r = await ensureCommand(c.name, { ...c.r2.opts, religarPrazoMs: 20000 });
  guardar(r);
  check("troca 1.0.0 → 1.1.0: o daemon lento caiu e o religado responde o /health na versão nova", r.ok && r.version === "1.1.0" && r.restarted?.ok === true && r.restarted.version === "1.1.0" && !vivo(c.pid1) && vivo(r.restarted.pid) && (await saude(c.home)) === 200, JSON.stringify(r));
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

console.log("\n== o fim do log do daemon que não sobe não vaza segredo ==");
{
  const caso = async (nome, v2) => {
    const c = await preparar(nome, { v2 });
    const r = await ensureCommand(c.name, { ...c.r2.opts, religarPrazoMs: 20000 });
    guardar(r);
    return { r, razoes: [r.restarted?.reason ?? "", r.reason ?? ""] };
  };
  const t = await caso("vaza-token", "vazaToken");
  check("o shutdownToken do runtime.json sai da razão (do religar e do ensure) e vira [omitido]", t.r.restarted?.ok === false && t.razoes.every((x) => !x.includes("segredo-do-shutdown") && x.includes("[omitido]")), JSON.stringify(t.razoes));
  check("as outras linhas do log seguem visíveis", t.razoes.every((x) => x.includes("boom: motor novo quebrado") && x.includes("subindo com shutdownToken=")), JSON.stringify(t.razoes));
  const h = await caso("vaza-hex", "vazaHex");
  check("sequência hexadecimal de 32+ caracteres sai da razão e vira [omitido]", h.r.restarted?.ok === false && h.razoes.every((x) => !/[0-9a-f]{32}/i.test(x) && x.includes("chave [omitido] fim")), JSON.stringify(h.razoes));
  check("as outras linhas do log seguem visíveis também no caso do hexadecimal", h.razoes.every((x) => x.includes("boom: motor novo quebrado")), JSON.stringify(h.razoes));
  const b = await caso("vaza-base64", "vazaBase64");
  check("token em base64 sai da razão e vira [omitido]; o texto em volta e as outras linhas ficam", b.r.restarted?.ok === false && b.razoes.every((x) => !x.includes(SEGREDO_B64) && x.includes("token [omitido] fim") && x.includes("boom: motor novo quebrado")), JSON.stringify(b.razoes));
  const bp = await caso("vaza-base64-padrao", "vazaBase64Padrao");
  check("base64 padrão com + / = sai da razão inteiro e vira [omitido]", bp.r.restarted?.ok === false && bp.razoes.every((x) => !["ab+", "/+ef", "ij56", "=="].some((p) => x.includes(p)) && x.includes("token [omitido] fim") && x.includes("boom: motor novo quebrado")), JSON.stringify(bp.razoes));
  const u = await caso("vaza-url", "vazaUrl");
  check("token numa URL ?token=... sai da razão e vira [omitido]; o resto da linha fica", u.r.restarted?.ok === false && u.razoes.every((x) => !x.includes(SEGREDO_URL) && x.includes("cb?[omitido] falhou")), JSON.stringify(u.razoes));
  const l = await caso("log-longo", "vazaLongo");
  const trecho = (l.r.restarted?.reason ?? "").split("últimas linhas: ")[1] ?? "";
  check("o trecho do log tem no máximo 5 linhas e 400 caracteres, e o fim (o erro) continua nele", l.r.restarted?.ok === false && trecho.length > 0 && trecho.length <= 400 && trecho.split(" | ").length <= 5 && trecho.includes("boom: motor novo quebrado"), `${trecho.length} ${trecho.split(" | ").length}`);
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
  const linhas = [];
  const r = await ensureCommand(c.name, { ...c.r2.opts, log: (m) => linhas.push(m) });
  check("troca 1.0.0 → 1.1.0 com o daemon v1 derrubado", r.ok && r.version === "1.1.0" && !vivo(c.pid1), JSON.stringify(r));
  check("não foi religado: sem restarted, sem boot.log", r.restarted === undefined && !existsSync(c.bootLog), JSON.stringify(r.restarted));
  check("o ensure avisa, numa linha só, que o daemon foi derrubado e NÃO religado por este comando", linhas.filter((l) => AVISO_NAO_RELIGADO.test(l)).length === 1 && r.ok === true, linhas.join(" | "));
  const p = await preparar("cli-parado", { extraEngine: { kind: "cli" }, vivoAntes: false });
  const linhasP = [];
  await ensureCommand(p.name, { ...p.r2.opts, log: (m) => linhasP.push(m) });
  check("motor não religável que não estava no ar não gera o aviso: nada foi derrubado", !linhasP.some((l) => AVISO_NAO_RELIGADO.test(l)), linhasP.join(" | "));
}

const motorDe = async (c) => (await resolverMotor(c.name, { manifest: c.r2.manifest })).engine;
const entryDe = (c) => join(c.home, "bin", c.name + ".mjs");
const lerJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
const esperarAnuncio = async (home, pid) => { for (let i = 0; i < 100 && daemonJson(home)?.pid !== pid; i++) { await sleep(100); } return daemonJson(home)?.pid === pid; };
const subirComo = async (c, args, opts = {}) => {
  const p = spawn(process.execPath, args, { windowsHide: true, stdio: "ignore", ...opts });
  lancados.add(p.pid);
  await esperarAnuncio(c.home, p.pid);
  return p.pid;
};
/** Derruba o daemon v1 pelo gancho do religador, instala a v2 sem daemon no ar e devolve o religador já com "derrubou". */
async function derrubadoEInstalado(c, prazoMs = 20000, pisoFilhoMs) {
  const rel = religar.religador(await motorDe(c), { prazoMs, pisoFilhoMs });
  await rel.antes();
  const i = await ensureCommand(c.name, c.r2.opts);
  if (!i.ok || vivo(c.pid1)) { throw new Error("preparo da corrida falhou: " + JSON.stringify(i)); }
  return rel;
}
const segurarPasta = (pasta) => { const p = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: pasta, windowsHide: true, stdio: "ignore" }); lancados.add(p.pid); return p.pid; };
const WINDOWS = process.platform === "win32";

console.log("\n== outro consumidor já subiu o daemon novo: o religar o reconhece, sem lançar nem apagar ==");
{
  const c = await preparar("corrida", {});
  const rel = await derrubadoEInstalado(c);
  const pidOutro = await subirComo(c, [entryDe(c)], { cwd: join(c.home, "bin") });
  const anuncio = ler(join(c.home, "run", "daemon.json"));
  const r = await rel.religar("1.1.0");
  check("restarted ok com o pid e a versão do daemon que já estava no ar", r?.ok === true && r.pid === pidOutro && r.version === "1.1.0", JSON.stringify(r));
  check("nada foi lançado: sem boot.log, o anúncio segue byte a byte e o daemon do outro segue vivo", !existsSync(c.bootLog) && ler(join(c.home, "run", "daemon.json")) === anuncio && vivo(pidOutro), `${existsSync(c.bootLog)} ${vivo(pidOutro)}`);
}

console.log("\n== o anúncio de um pid ainda vivo nunca é apagado; o lançado que perde a corrida não vira falha ==");
{
  const c = await preparar("perde", { v2: "perde" });
  const rel = await derrubadoEInstalado(c);
  const lento = join(RUN, "w-lento.mjs");
  writeFileSync(lento, LENTO);
  const pidLento = await subirComo(c, [lento, c.home]);
  const r = await rel.religar("1.1.0");
  check("o daemon vivo que ainda subia é o religado: ok com o pid dele, não 'saiu ao subir'", r?.ok === true && r.pid === pidLento, JSON.stringify(r));
  check("o anúncio é o dele e ele segue vivo", daemonJson(c.home)?.pid === pidLento && vivo(pidLento));
}

console.log("\n== a versão anunciada: '+metadata' de semver não conta; versão diferente não mata o daemon saudável ==");
{
  const anunciando = (expr) => SOBE.replace(/const version = (.*);/, `const version = ${expr};`);
  const c = await preparar("sufixo", { v2: anunciando("$1 + '+build.7'") });
  const r = await ensureCommand(c.name, { ...c.r2.opts, religarPrazoMs: 3000 });
  guardar(r);
  check("daemon que anuncia 1.1.0+build.7 é o religado da v1.1.0", r.ok && r.restarted?.ok === true && r.restarted.version === "1.1.0+build.7" && vivo(r.restarted.pid) && (await saude(c.home)) === 200, JSON.stringify(r));
  const d = await preparar("diverge", { v2: anunciando("'9.9.9'") });
  const t0 = Date.now();
  const rd = await ensureCommand(d.name, { ...d.r2.opts, religarPrazoMs: 1500 });
  guardar(rd);
  check("versão realmente diferente: ok:false com a razão 'no ar mas anuncia vX, esperado vY' e o pid do daemon", rd.ok === false && rd.restarted?.ok === false && /o daemon está no ar mas anuncia v9\.9\.9, esperado v1\.1\.0/.test(rd.restarted.reason) && rd.restarted.pid > 0, JSON.stringify(rd.restarted));
  check("o daemon saudável que anuncia outra versão não é morto: segue vivo e o /health responde", vivo(rd.restarted?.pid) && daemonJson(d.home)?.pid === rd.restarted?.pid && (await saude(d.home)) === 200 && Date.now() - t0 < 20000);
}

console.log("\n== pid vivo anunciado que ainda não responde o /health: espera, sem lançar um segundo daemon ==");
{
  const marcador = join(RUN, "marcador-segundo");
  const c = await preparar("espera", { v2: FORA(marcador) });
  const rel = await derrubadoEInstalado(c);
  const lento = join(RUN, "w-lento-espera.mjs");
  writeFileSync(lento, LENTO);
  const pidLento = await subirComo(c, [lento, c.home]);
  const r = await rel.religar("1.1.0");
  await sleep(500);
  check("o religado é o daemon vivo que ainda subia", r?.ok === true && r.pid === pidLento && vivo(pidLento), JSON.stringify(r));
  check("nenhum segundo daemon foi lançado: sem marcador e sem boot.log", !existsSync(marcador) && !existsSync(c.bootLog));
}

console.log("\n== a troca que falha depois de o daemon cair religa a instalação antiga ==");
if (!WINDOWS) { console.log("  PULADO só o Windows trava o rename de uma pasta em uso (o holder tem o cwd em bin)"); }
else {
  const c = await preparar("troca-falha");
  const holder = segurarPasta(join(c.home, "bin"));
  await sleep(300);
  const linhas = [];
  const r = await ensureCommand(c.name, { ...c.r2.opts, religarPrazoMs: 20000, log: (m) => linhas.push(m) });
  guardar(r);
  const dj = daemonJson(c.home);
  check("o ensure falha e a instalação antiga ficou intacta", r.ok === false && /não consegui trocar/.test(r.reason ?? "") && instalado(c.name) === "1.0.0", JSON.stringify(r));
  check("restarted.ok com a versão antiga, num pid novo, anunciado e respondendo", r.restarted?.ok === true && r.restarted.version === "1.0.0" && r.restarted.pid !== c.pid1 && dj?.pid === r.restarted.pid && vivo(r.restarted.pid) && (await saude(c.home)) === 200, JSON.stringify(r.restarted));
  check("a razão diz que a troca falhou e que o daemon anterior foi religado", /a troca falhou; o daemon anterior foi religado/.test(r.reason ?? ""), r.reason);
  matar(holder);
}
if (WINDOWS) {
  const c = await preparar("troca-falha-sem-religar", { v1: SOBE_UMA_VEZ });
  const holder = segurarPasta(join(c.home, "bin"));
  await sleep(300);
  const r = await ensureCommand(c.name, { ...c.r2.opts, religarPrazoMs: 20000 });
  guardar(r);
  check("o ensure falha e a razão diz que o daemon NÃO está no ar, com o boot.log", r.ok === false && /não consegui trocar/.test(r.reason ?? "") && /NÃO está no ar/.test(r.reason ?? "") && (r.reason ?? "").includes(c.bootLog), r.reason);
  check("restarted.ok:false com a causa da subida que falhou", r.restarted?.ok === false && /boom: religar do anterior quebrado/.test(r.restarted.reason) && r.restarted.bootLog === c.bootLog, JSON.stringify(r.restarted));
  matar(holder);
}

if (WINDOWS) {
  const c = await preparar("pin-troca-falha");
  const holder = segurarPasta(join(c.home, "bin"));
  await sleep(300);
  const r = await pinCommand(c.name, { ...c.r2.opts, version: "1.1.0", religarPrazoMs: 20000 });
  lancados.add(daemonJson(c.home)?.pid);
  check("pin --version cuja troca falha não deixa o pin gravado, mesmo com o daemon antigo religado", r.ok === false && /pin não aplicado/.test(r.reason ?? "") && /o daemon anterior foi religado/.test(r.reason) && !pinOf(c.name), `${JSON.stringify(r)} pin=${pinOf(c.name)}`);
  matar(holder);
}

console.log("\n== a razão só diz 'o daemon anterior foi religado' se a instalação anterior existe e subiu ==");
{
  const c = await preparar("anterior-presente");
  const rel = religar.religador(await motorDe(c), { prazoMs: 20000 });
  await rel.antes();
  const r = await rel.religar("1.0.0");
  if (r?.pid) { lancados.add(r.pid); }
  check("com a instalação anterior no disco o religar sobe a v1.0.0 e a razão diz que o daemon anterior foi religado", r?.ok === true && r.version === "1.0.0" && /; a troca falhou; o daemon anterior foi religado \(pid \d+, v1\.0\.0\)/.test(religar.aposReligar(r, false)), JSON.stringify(r));
  const g = await preparar("anterior-ausente");
  const relG = religar.religador(await motorDe(g), { prazoMs: 20000 });
  await relG.antes();
  rmSync(join(g.home, "bin"), { recursive: true, force: true });
  const rg = await relG.religar("1.0.0");
  const texto = religar.aposReligar(rg, false);
  check("sem a instalação anterior nada é lançado: ok:false, sem boot.log", rg?.ok === false && !existsSync(g.bootLog), JSON.stringify(rg));
  check("a razão diz que a troca falhou e a instalação anterior não existe mais: o daemon NÃO está no ar", texto.includes("a troca falhou e a instalação anterior não existe mais: o daemon NÃO está no ar") && !/foi religado|anuncia v/.test(texto), texto);
  const e = await preparar("troca-apagou-anterior");
  const incompleto = join(RUN, `incompleto-${e.name}`);
  mkdirSync(incompleto, { recursive: true });
  writeFileSync(join(incompleto, "package.json"), JSON.stringify({ name: e.name, version: "1.1.0" }));
  execFileSync(tarBinary(), ["-czf", `${incompleto}.tgz`, "-C", incompleto, "."], { stdio: "ignore", windowsHide: true });
  const tgz = readFileSync(`${incompleto}.tgz`), sig = signBlob(tgz, owner.privateKeyHex);
  const sem = async (url) => (url.endsWith(".sha256") ? Buffer.from(`${createHash("sha256").update(tgz).digest("hex")}  ${e.name}.tgz\n`) : url.endsWith(".sig") ? sig : tgz);
  const r2 = await ensureCommand(e.name, { ...e.r2.opts, fetcher: sem, religarPrazoMs: 5000 });
  guardar(r2);
  check("artefato novo sem o executável (a anterior já apagada): o ensure falha e a razão não promete um daemon", r2.ok === false && /extraído incompleto/.test(r2.reason ?? ""), r2.reason);
  check("a razão diz que a instalação anterior não existe mais e que o daemon NÃO está no ar, sem 'religado' nem 'anuncia vX'", /a troca falhou e a instalação anterior não existe mais: o daemon NÃO está no ar/.test(r2.reason ?? "") && !/foi religado|anuncia v/.test(r2.reason ?? "") && !existsSync(e.bootLog), r2.reason);
}

console.log("\n== anúncio sem pid: ninguém é encerrado e a razão diz que o anúncio não traz pid ==");
{
  const c = await preparar("sem-pid", { v2: FILHO });
  const rel = await derrubadoEInstalado(c, 4000);
  const emVoo = rel.religar("1.1.0");
  const arq = join(c.home, "filho.pid");
  for (let i = 0; i < 100 && !existsSync(arq); i++) { await sleep(100); }
  const pidFilho = Number(ler(arq));
  lancados.add(pidFilho);
  const outro = join(c.home, "bin", "outro-sem-pid.mjs");
  writeFileSync(outro, SEM_PID.replace(/const version = (.*);/, "const version = '9.9.9';"));
  const p = spawn(process.execPath, [outro], { cwd: join(c.home, "bin"), windowsHide: true, stdio: "ignore" });
  lancados.add(p.pid);
  for (let i = 0; i < 100 && daemonJson(c.home)?.version !== "9.9.9"; i++) { await sleep(100); }
  const r = await emVoo;
  check("ok:false, a razão diz que o anúncio não traz pid e não atribui um pid ao anunciante", r?.ok === false && /o anúncio não traz pid/.test(r.reason) && r.pid === undefined, JSON.stringify(r));
  check("ninguém foi encerrado: o filho lançado e o outro daemon seguem vivos, e o /health do outro responde", vivo(pidFilho) && vivo(p.pid) && (await saude(c.home)) === 200, `${vivo(pidFilho)} ${vivo(p.pid)}`);
}

console.log("\n== caminhos do descritor fora do home: recusados sem apagar nem lançar ==");
{
  const c = await preparar("fora-entry", { v2: "sobe" });
  const marcador = join(RUN, "marcador-entry");
  writeFileSync(join(RUN, "homes", "fora-do-home.mjs"), FORA(marcador));
  const base = await motorDe(c);
  const rel = religar.religador({ ...base, install: { ...base.install, entry: "../fora-do-home.mjs" } }, { prazoMs: 5000 });
  await rel.antes();
  const antes = ler(join(c.home, "run", "daemon.json"));
  const r = await rel.religar("1.1.0");
  await sleep(1500);
  check("entry com .. é recusado dizendo que sai do home", r?.ok === false && /fora do home/.test(r.reason ?? ""), JSON.stringify(r));
  check("nada foi lançado nem apagado: sem marcador, sem boot.log, anúncio intacto", !existsSync(marcador) && !existsSync(c.bootLog) && ler(join(c.home, "run", "daemon.json")) === antes && antes !== "");
  const c2 = await preparar("fora-abs", { v2: "sobe" });
  const abs = join(RUN, "fora-abs.mjs");
  writeFileSync(abs, FORA(join(RUN, "marcador-abs")));
  const b2 = await motorDe(c2);
  const rel2 = religar.religador({ ...b2, install: { ...b2.install, entry: abs } }, { prazoMs: 5000 });
  await rel2.antes();
  const antes2 = ler(join(c2.home, "run", "daemon.json"));
  const r2 = await rel2.religar("1.1.0");
  await sleep(1500);
  check("entry absoluto é recusado e nada é lançado nem apagado", r2?.ok === false && /fora do home/.test(r2.reason ?? "") && !existsSync(join(RUN, "marcador-abs")) && !existsSync(c2.bootLog) && ler(join(c2.home, "run", "daemon.json")) === antes2 && antes2 !== "", JSON.stringify(r2));
  const c3 = await preparar("fora-runtime", { v2: "sobe" });
  const anuncioFora = join(RUN, "anuncio-fora.json");
  writeFileSync(anuncioFora, ler(join(c3.home, "run", "daemon.json")));
  const b3 = await motorDe(c3);
  const rel3 = religar.religador({ ...b3, runtime: { ...b3.runtime, runtimeFile: "../../anuncio-fora.json" } }, { prazoMs: 5000 });
  await rel3.antes();
  const r3 = await rel3.religar("1.1.0");
  check("runtimeFile fora do home é recusado: o arquivo de fora segue lá e nada é lançado", r3?.ok === false && /fora do home/.test(r3.reason ?? "") && existsSync(anuncioFora) && !existsSync(c3.bootLog), JSON.stringify(r3));
}

console.log("\n== o daemon religado roda na pasta do executável, sem NODE_OPTIONS nem COPILOT_SDK_PATH ==");
{
  const c = await preparar("ambiente", { v2: AMBIENTE });
  Object.assign(process.env, { NODE_OPTIONS: "--no-warnings", COPILOT_SDK_PATH: join(RUN, "sdk-falso") });
  let r;
  try { r = await ensureCommand(c.name, { ...c.r2.opts, religarPrazoMs: 20000 }); } finally { delete process.env.NODE_OPTIONS; delete process.env.COPILOT_SDK_PATH; }
  guardar(r);
  const amb = lerJson(join(c.home, "ambiente.json"));
  const mesmo = (a, b) => realpathSync(a).toLowerCase() === realpathSync(b).toLowerCase();
  check("o religar deu certo", r.ok && r.restarted?.ok === true, JSON.stringify(r));
  check("o cwd do daemon é a pasta do executável (bin)", amb?.cwd && mesmo(amb.cwd, join(c.home, "bin")), JSON.stringify(amb));
  check("NODE_OPTIONS e COPILOT_SDK_PATH não chegam ao daemon", !amb?.nodeOptions && !amb?.sdk, JSON.stringify(amb));
}

console.log("\n== só entry .js, .mjs e .cjs é lançado por node; o resto é executável lançado direto ==");
{
  const CJS = (marcador) => `require('node:fs').writeFileSync(${JSON.stringify(marcador)}, 'lancado');\n`;
  const lancar = async (nome, entry, escrever) => {
    const c = await preparar(nome, { v2: "sobe" });
    const marcador = join(RUN, `marcador-${nome}`);
    escrever(join(c.home, entry), marcador);
    const base = await motorDe(c);
    const rel = religar.religador({ ...base, install: { ...base.install, entry } }, { prazoMs: 5000 });
    await rel.antes();
    return { r: await rel.religar("1.1.0"), marcador };
  };
  const script = (conteudo) => (arq, marcador) => writeFileSync(arq, conteudo(marcador));
  const binario = (arq) => { copyFileSync(process.execPath, arq); chmodSync(arq, 0o755); };
  const porNode = { "bin/lanca.js": CJS, "bin/lanca.cjs": CJS, "bin/lanca.mjs": FORA };
  for (const [entry, conteudo] of Object.entries(porNode)) {
    const { marcador } = await lancar(`entry-${entry.split(".")[1]}`, entry, script(conteudo));
    check(`o entry ${entry} é lançado por node`, existsSync(marcador));
  }
  const direto = WINDOWS ? /ENOENT/ : /código 0/;
  for (const entry of ["bin/foo-js", "bin/nodejs"]) {
    const { r } = await lancar(`entry-${entry.split("/")[1]}`, entry, binario);
    check(`o entry ${entry}, sem ponto antes de js, é lançado direto e não por node`, r?.ok === false && direto.test(r.reason) && !/código 1/.test(r.reason), JSON.stringify(r));
  }
}

console.log("\n== o filho lançado que perde a corrida para outro daemon de outra versão é encerrado ==");
{
  const c = await preparar("filho-perde", { v2: FILHO });
  const rel = await derrubadoEInstalado(c, 6000);
  const emVoo = rel.religar("1.1.0");
  const arq = join(c.home, "filho.pid");
  for (let i = 0; i < 100 && !existsSync(arq); i++) { await sleep(100); }
  const pidFilho = Number(ler(arq));
  lancados.add(pidFilho);
  const outro = join(c.home, "bin", "outro.mjs");
  writeFileSync(outro, SOBE.replace(/const version = (.*);/, "const version = '9.9.9';"));
  const pidOutro = await subirComo(c, [outro], { cwd: join(c.home, "bin") });
  const r = await emVoo;
  check("o religar devolve ok:false dizendo a versão anunciada e o pid do outro daemon", r?.ok === false && /o daemon está no ar mas anuncia v9\.9\.9, esperado v1\.1\.0/.test(r.reason) && r.pid === pidOutro, JSON.stringify(r));
  check("o filho lançado é encerrado", pidFilho > 0 && (await sumiu(pidFilho)), String(pidFilho));
  check("o outro daemon segue vivo, anunciado e respondendo", vivo(pidOutro) && daemonJson(c.home)?.pid === pidOutro && (await saude(c.home)) === 200);
}

console.log("\n== o filho lançado que perde a corrida para outro daemon da mesma versão certa é encerrado e o outro é o religado ==");
{
  const c = await preparar("filho-perde-igual", { v2: FILHO });
  const rel = await derrubadoEInstalado(c, 6000);
  const emVoo = rel.religar("1.1.0");
  const arq = join(c.home, "filho.pid");
  for (let i = 0; i < 100 && !existsSync(arq); i++) { await sleep(100); }
  const pidFilho = Number(ler(arq));
  lancados.add(pidFilho);
  const outro = join(c.home, "bin", "outro.mjs");
  writeFileSync(outro, SOBE);
  const pidOutro = await subirComo(c, [outro], { cwd: join(c.home, "bin") });
  const r = await emVoo;
  check("o religar devolve ok com o pid e a versão do outro daemon", r?.ok === true && r.pid === pidOutro && r.version === "1.1.0", JSON.stringify(r));
  check("o filho lançado é encerrado", pidFilho > 0 && (await sumiu(pidFilho)), String(pidFilho));
  check("o outro daemon segue vivo, anunciado e respondendo", vivo(pidOutro) && daemonJson(c.home)?.pid === pidOutro && (await saude(c.home)) === 200);
}

console.log("\n== o filho que já saiu não recebe kill quando outro daemon da versão certa anuncia ==");
{
  const PAI = `import { spawn } from 'node:child_process'; import { writeFileSync, existsSync } from 'node:fs'; import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const bin = dirname(fileURLToPath(import.meta.url)), home = dirname(bin);
writeFileSync(join(home, 'filho.pid'), String(process.pid));
const neto = spawn(process.execPath, [join(bin, 'outro.mjs'), home], { detached: true, stdio: 'ignore', windowsHide: true });
writeFileSync(join(home, 'neto.pid'), String(neto.pid)); neto.unref();
while (!existsSync(join(home, 'run', 'daemon.json'))) { await new Promise((r) => setTimeout(r, 20)); }
await new Promise((r) => setTimeout(r, 60));
`;
  const c = await preparar("filho-saiu", { v2: PAI });
  const rel = await derrubadoEInstalado(c, 6000);
  writeFileSync(join(c.home, "bin", "outro.mjs"), `await new Promise((r) => setTimeout(r, 450));
${SOBE}`);
  const alvos = [];
  const killOriginal = process.kill;
  process.kill = (pid, sinal) => { alvos.push(pid); return killOriginal.call(process, pid, sinal); };
  let r;
  try { r = await rel.religar("1.1.0"); } finally { process.kill = killOriginal; }
  const pidFilho = Number(ler(join(c.home, "filho.pid")));
  const pidNeto = Number(ler(join(c.home, "neto.pid")));
  lancados.add(pidNeto);
  check("o religar devolve ok com o pid do daemon que anunciou, não o do filho", r?.ok === true && r.pid === pidNeto && r.pid !== pidFilho, JSON.stringify(r));
  check("nenhum kill foi para o pid do filho que já saiu", pidFilho > 0 && !alvos.includes(pidFilho), JSON.stringify(alvos));
}

const surdoDe = (nome) => { const f = join(RUN, `w-surdo-${nome}.mjs`); writeFileSync(f, LENTO.replace("1500", "600000")); return f; };

console.log("\n== o pid anterior que morre perto do fim: o filho tem ao menos o piso, e o total não passa de prazo + piso ==");
{
  const prazo = 3000, piso = 1500;
  const c = await preparar("prazo-unico", { v2: "mudo" });
  const rel = await derrubadoEInstalado(c, prazo, piso);
  const pidSurdo = await subirComo(c, [surdoDe("prazo-unico"), c.home]);
  const t0 = Date.now();
  setTimeout(() => matar(pidSurdo), prazo - 500);
  const r = await rel.religar("1.1.0");
  const gasto = Date.now() - t0;
  check("o religar falha por não anunciar, a razão diz o tempo que o filho teve (o piso) e o processo é encerrado", r?.ok === false && /não anunciou em 1500ms/.test(r.reason ?? "") && (await sumiu(r.pid)), JSON.stringify(r));
  check("o filho esperou o piso inteiro depois da morte do anterior", gasto >= prazo - 500 + piso - 200, `${gasto}ms`);
  check("o total não passa de prazo + piso + tolerância", gasto < prazo + piso + 1500, `${gasto}ms para um prazo de ${prazo}ms e piso de ${piso}ms`);
}

console.log("\n== o pid anterior que morre a 100 ms do fim: o filho ainda sobe e anuncia dentro do piso ==");
{
  const prazo = 3000;
  const c = await preparar("piso-filho", { v2: `await new Promise((r) => setTimeout(r, 1200));\n${SOBE}` });
  const rel = await derrubadoEInstalado(c, prazo);
  const pidSurdo = await subirComo(c, [surdoDe("piso-filho"), c.home]);
  setTimeout(() => matar(pidSurdo), prazo - 100);
  const r = await rel.religar("1.1.0");
  if (r?.pid) { lancados.add(r.pid); }
  check("restarted ok com o pid e a versão do filho, anunciado e respondendo", r?.ok === true && r.version === "1.1.0" && daemonJson(c.home)?.pid === r.pid && vivo(r.pid) && (await saude(c.home)) === 200, JSON.stringify(r));
}

console.log("\n== o daemon da versão certa que fica saudável depois da última espera é o religado, sem falha; só o filho que não anunciou é encerrado ==");
{
  const soNoFim = join(RUN, "w-so-no-fim.mjs");
  writeFileSync(soNoFim, SO_NO_FIM);
  const marcador = join(RUN, "marcador-so-no-fim");
  const a = await preparar("so-no-fim-anterior", { v2: FORA(marcador) });
  const relA = await derrubadoEInstalado(a, 2000);
  const pidA = await subirComo(a, [soNoFim, a.home]);
  const rA = await relA.religar("1.1.0");
  await sleep(300);
  check("com o pid anterior vivo: ok com o pid e a versão dele, não 'anuncia vX, esperado vX'", rA?.ok === true && rA.pid === pidA && rA.version === "1.1.0", JSON.stringify(rA));
  check("com o pid anterior vivo: nada foi lançado e o daemon segue vivo e anunciado", !existsSync(marcador) && !existsSync(a.bootLog) && vivo(pidA) && daemonJson(a.home)?.pid === pidA);
  const c = await preparar("so-no-fim-filho", { v2: FILHO });
  const rel = await derrubadoEInstalado(c, 2500);
  const emVoo = rel.religar("1.1.0");
  const arq = join(c.home, "filho.pid");
  for (let i = 0; i < 100 && !existsSync(arq); i++) { await sleep(100); }
  const pidFilho = Number(ler(arq));
  lancados.add(pidFilho);
  const pidOutro = await subirComo(c, [soNoFim, c.home]);
  const r = await emVoo;
  await sleep(300);
  check("com o filho lançado: ok com o pid e a versão do outro daemon, sem falha", r?.ok === true && r.pid === pidOutro && r.version === "1.1.0", JSON.stringify(r));
  check("o filho lançado que não anunciou é encerrado e o outro daemon segue vivo e anunciado", pidFilho > 0 && (await sumiu(pidFilho)) && vivo(pidOutro) && daemonJson(c.home)?.pid === pidOutro, `${pidFilho} ${pidOutro}`);
  const f = await preparar("so-no-fim-e-o-filho", { v2: SO_NO_FIM_DO_FILHO });
  const relF = await derrubadoEInstalado(f, 2500);
  const rF = await relF.religar("1.1.0");
  if (rF?.pid) { lancados.add(rF.pid); }
  await sleep(300);
  check("o filho que é o próprio anunciante da versão certa é o religado e segue vivo", rF?.ok === true && rF.version === "1.1.0" && vivo(rF.pid) && daemonJson(f.home)?.pid === rF.pid, JSON.stringify(rF));
}

console.log("\n== quem é religável ==");
{
  const real = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).engines;
  const quem = (n) => religar?.religavel({ ...real.find((e) => e.name === n) }) === true;
  check("a casa e o motor de grafo (kind=cli, mas o cliente compartilhado os sobe) e os kind=daemon são religáveis", quem("casa-de-embeddings") && quem("motor-de-grafo") && quem("embed-house"));
  check("o mcp-gateway (lançador próprio no ensureGateway) não é religado pelo ensure", religar !== null && !quem("mcp-gateway"));
  check("o vxk (kind=cli, shim stdio) e o motor sem bloco runtime não são", religar !== null && !quem("vxk") && religar.religavel({ name: "x", kind: "daemon" }) === false);
  check("o prazo padrão é uma constante nomeada de 60 s", religar?.PRAZO_RELIGAR_MS === 60000);
  const sintetico = (shutdownPath) => ({ name: "x", kind: "daemon", runtime: { ...RUNTIME, shutdownPath } });
  check("motor que se relança sozinho (shutdownPath com relaunch=1) não é religável; o mesmo motor sem relaunch é", religar?.religavel(sintetico("/shutdown?relaunch=1")) === false && religar?.religavel(sintetico("/shutdown?a=1&relaunch=1")) === false && religar?.religavel(sintetico("/shutdown")) === true);
  check("plano desconhecido não vira a palavra undefined, nem com o aviso de religar", planoEm({ plan: "inexistente", religaria: true }) === undefined && planoEm({ plan: "reusar", version: "1.0.0" }) === "reusaria v1.0.0, já em dia");
}

console.log("\n== pelo CLI de verdade (exit code, texto, --json) ==");
async function cli(nome, v2, args, extra) {
  const c = await preparar(nome, { v2, ...extra });
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
  const { r } = await cli("cli-nao-religavel", "sobe", [], { extraEngine: { kind: "cli" } });
  check("motor não religável derrubado: exit 0 e a linha de aviso na saída do CLI", r.status === 0 && AVISO_NAO_RELIGADO.test(r.stdout), `${r.status} ${r.stdout} ${r.stderr}`);
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
for (const p of lancados) { await sumiu(p); }
console.log(failures === 0 ? "\n== TUDO VERDE ==" : `\n== ${failures} FALHA(S) ==`);
process.exitCode = failures === 0 ? 0 : 1;
