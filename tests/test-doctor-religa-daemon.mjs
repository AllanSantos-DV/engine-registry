// test-doctor-religa-daemon.mjs — o `doctor --fix` que derruba um daemon vivo para trocar a instalação o RELIGA, como o `ensure`.
//
// O que precisa ser verdade:
//   • daemon vivo na v1, motor desatualizado: o --fix troca para a v2 e o daemon da v2 está no ar (pid novo, versão nova, /health responde), com o log de religar e a saída em run/boot.log;
//   • daemon parado antes: nada é lançado (sem daemon.json, sem boot.log, sem linha de religar) e o --fix sai com 0;
//   • motor não religável (kind=cli) cujo daemon o --fix derruba: uma linha "daemon derrubado e NÃO religado por este comando (quem o sobe é o consumidor)" e exit 0;
//   • a v2 não sobe: o --fix conta a falha, sai com 1 e o texto traz a razão, a frase "NÃO está no ar" e o caminho do boot.log;
//   • a troca que falha depois de o daemon cair religa a instalação ANTIGA e conta a falha (só no Windows, que trava o rename de uma pasta em uso).
// Hermético: HOME e ENGINE_KIT_HOME isolados, registry e downloads de memória (o .tgz é real), o CLI roda numa cópia do kit sem rede, porta efêmera própria, sem janela.
// Todo daemon lançado aqui é encerrado no fim, por PID.
//
//   node tests/test-doctor-religa-daemon.mjs
import "./_tmp.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "dr-religa-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { RUNTIME, SOBE } = await import("./_daemon-falso.mjs");
const { criarCliOffline } = await import("./_kit-copiado.mjs");
const { homeOf, registry, instalado, preinstalar } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const lancados = new Set();
const matar = (pid) => { if (pid) { try { process.kill(pid); } catch { /* já saiu */ } } };
process.on("exit", () => { for (const p of lancados) { matar(p); } });
const WINDOWS = process.platform === "win32";

const QUEBRA = "console.error('boom: motor novo quebrado'); process.exit(3);\n";
const SOBE_UMA_VEZ = SOBE.replace("readFileSync } from 'node:fs'", "readFileSync, existsSync } from 'node:fs'")
  .replace("const shutdownToken", `const marca = join(aqui, '..', 'ja-subiu');
if (existsSync(marca)) { console.error('boom: religar do anterior quebrado'); process.exit(3); }
writeFileSync(marca, '1');
const shutdownToken`);

const daemonJson = (home) => { try { return JSON.parse(readFileSync(join(home, "run", "daemon.json"), "utf8")); } catch { return null; } };
const saude = async (home) => { try { return (await fetch(`http://127.0.0.1:${daemonJson(home).port}/health`, { signal: AbortSignal.timeout(2000) })).status; } catch { return null; } };
const sumiu = async (pid, ms = 5000) => { for (let i = 0; i < ms / 100 && vivo(pid); i++) { await sleep(100); } return !vivo(pid); };

/** Instala a v1 (com o daemon dela, se `vivoAntes`) e devolve o `doctor --fix` do motor contra um registry que oferece a v2 com a fonte `v2`. */
async function preparar(nome, { v2 = SOBE, v1 = SOBE, vivoAntes = true, kind = "daemon" } = {}) {
  const name = `dr-${nome}`;
  const r = registry({ [name]: "1.1.0" }, { extra: { [name]: { kind, runtime: RUNTIME } }, fonte: () => v2 });
  preinstalar(name, "1.0.0");
  const home = homeOf(name);
  writeFileSync(join(home, "bin", `${name}.mjs`), v1);
  let pid1 = null;
  if (vivoAntes) {
    pid1 = spawn(process.execPath, [join(home, "bin", `${name}.mjs`)], { cwd: join(home, "bin"), windowsHide: true, stdio: "ignore" }).pid;
    lancados.add(pid1);
    for (let i = 0; i < 100 && daemonJson(home)?.pid !== pid1; i++) { await sleep(100); }
    if (daemonJson(home)?.pid !== pid1) { throw new Error("o daemon v1 não anunciou"); }
  }
  const { cli } = await criarCliOffline(RUN, { manifest: r.manifest, artefatos: r.artefatos, kitHome: KIT_HOME, env: { ENGINE_KIT_NO_AUTO_UPDATE: "0", LOOPBACK_REAL: "1", LOCALAPPDATA: join(RUN, "local") } });
  const fix = () => { const f = cli("doctor", "--fix", "--engine", name); if (daemonJson(home)?.pid) { lancados.add(daemonJson(home).pid); } return f; };
  return { name, home, pid1, fix, bootLog: join(home, "run", "boot.log") };
}

console.log("== doctor --fix religa o daemon que derrubou ==");
{
  const c = await preparar("vivo");
  const f = await c.fix();
  const dj = daemonJson(c.home);
  check("troca 1.0.0 → 1.1.0 e sai com 0", f.status === 0 && instalado(c.name) === "1.1.0" && /== conciliado ==/.test(f.stdout), `${f.status} ${f.stdout} ${f.stderr}`);
  check("o daemon v1 saiu e o v2 está vivo, anunciado na versão nova, num pid novo", !vivo(c.pid1) && dj?.pid > 0 && dj.pid !== c.pid1 && dj.version === "1.1.0" && vivo(dj.pid), `${c.pid1} → ${JSON.stringify(dj)}`);
  check("o /health do daemon novo responde 200 e a saída vai para run/boot.log", (await saude(c.home)) === 200 && existsSync(c.bootLog));
  check("o texto diz que religou, antes e depois, com o pid e o boot.log", f.stdout.includes(`${c.name}: religando o daemon que estava no ar...`) && f.stdout.includes(`${c.name}: daemon religado (pid ${dj?.pid}, v1.1.0); saída em ${c.bootLog}`), f.stdout);
}

console.log("\n== daemon que não estava no ar não é lançado ==");
{
  const c = await preparar("parado", { vivoAntes: false });
  const f = await c.fix();
  check("troca 1.0.0 → 1.1.0 e sai com 0", f.status === 0 && instalado(c.name) === "1.1.0", `${f.status} ${f.stdout} ${f.stderr}`);
  check("nada foi lançado: sem daemon.json nem boot.log, sem linha de religar", daemonJson(c.home) === null && !existsSync(c.bootLog) && !/religando/.test(f.stdout), f.stdout);
}

console.log("\n== motor não religável derrubado: uma linha de aviso, sem mudar o exit ==");
{
  const aviso = /daemon derrubado e NÃO religado por este comando \(quem o sobe é o consumidor\)/g;
  const c = await preparar("cli", { kind: "cli" });
  const f = await c.fix();
  check("o --fix troca para a v2, sai com 0 e o daemon v1 caiu sem ser religado", f.status === 0 && instalado(c.name) === "1.1.0" && !vivo(c.pid1) && !existsSync(c.bootLog) && /== conciliado ==/.test(f.stdout), `${f.status} ${f.stdout} ${f.stderr}`);
  check("o texto traz o aviso uma vez só", (f.stdout.match(aviso) ?? []).length === 1, f.stdout);
  const p = await preparar("cli-parado", { kind: "cli", vivoAntes: false });
  const fp = await p.fix();
  check("sem daemon derrubado não há aviso", fp.status === 0 && !aviso.test(fp.stdout), fp.stdout);
}

console.log("\n== a v2 não consegue subir: falha visível ==");
{
  const c = await preparar("quebra", { v2: QUEBRA });
  const f = await c.fix();
  check("a v2 ficou instalada e o --fix sai com 1 contando a falha", f.status === 1 && instalado(c.name) === "1.1.0" && /== 1 falha\(s\) ==/.test(f.stdout) && !/conciliado/.test(f.stdout), `${f.status} ${f.stdout} ${f.stderr}`);
  check("o texto traz a razão (código de saída e a linha do erro), a frase NÃO está no ar e o caminho do boot.log", / FALHA dr-quebra — .*instalada, mas o daemon NÃO está no ar: .*código 3.*boom: motor novo quebrado/.test(f.stdout) && f.stdout.includes(`saída do daemon em ${c.bootLog}`), f.stdout);
  check("o boot.log tem a saída da v2", existsSync(c.bootLog) && /boom: motor novo quebrado/.test(readFileSync(c.bootLog, "utf8")));
}

console.log("\n== a troca que falha depois de o daemon cair religa a instalação antiga ==");
if (!WINDOWS) { console.log("  PULADO só o Windows trava o rename de uma pasta em uso (o holder tem o cwd em bin)"); }
else {
  const segurar = (pasta) => { const p = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: pasta, windowsHide: true, stdio: "ignore" }); lancados.add(p.pid); return p.pid; };
  const c = await preparar("troca-falha");
  const holder = segurar(join(c.home, "bin"));
  await sleep(300);
  const f = await c.fix();
  const dj = daemonJson(c.home);
  check("o --fix falha, conta a falha e a instalação antiga ficou intacta", f.status === 1 && instalado(c.name) === "1.0.0" && / FALHA dr-troca-falha — /.test(f.stdout) && /== 1 falha\(s\) ==/.test(f.stdout), `${f.status} ${f.stdout} ${f.stderr}`);
  check("o daemon anterior foi religado: pid novo, v1.0.0, respondendo, e o texto diz isso", dj?.pid > 0 && dj.pid !== c.pid1 && dj.version === "1.0.0" && vivo(dj.pid) && (await saude(c.home)) === 200 && /a troca falhou; o daemon anterior foi religado/.test(f.stdout), `${JSON.stringify(dj)} ${f.stdout}`);
  matar(holder);
  const d = await preparar("troca-falha-sem-religar", { v1: SOBE_UMA_VEZ });
  const holder2 = segurar(join(d.home, "bin"));
  await sleep(300);
  const g = await d.fix();
  check("se a instalação antiga também não sobe: falha com a razão, NÃO está no ar e o boot.log", g.status === 1 && /não consegui trocar/.test(g.stdout) && /o daemon NÃO está no ar: .*boom: religar do anterior quebrado/.test(g.stdout) && g.stdout.includes(d.bootLog), `${g.status} ${g.stdout}`);
  matar(holder2);
}

for (const p of lancados) { matar(p); }
for (const p of lancados) { await sumiu(p); }
rmSync(RUN, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
console.log(failures === 0 ? "\n== TUDO VERDE ==" : `\n== ${failures} FALHA(S) ==`);
process.exitCode = failures === 0 ? 0 : 1;
