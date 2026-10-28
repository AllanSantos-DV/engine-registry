// test-ensure-daemon.mjs — atualizar um motor kind=cli que tem daemon próprio (o caso do vxk 0.19.0).
//
// O shim stdio do vxk é `cli` (o kit não sobe nada), mas o daemon único que ele sobe segura a pasta bin: no Windows o
// swap do `ensure` falharia com "arquivos em uso". O manifest declara `runtime` (run/daemon.json + POST /shutdown com
// x-shutdown-token) para o kit derrubá-lo antes de trocar; ocupado, ele responde 202 e só fecha quando o trabalho acaba. Aqui o daemon é um fake com o mesmo contrato do real
// (visual: mcp/vxk-daemon.mjs), vivo com a pasta bin como diretório corrente, e o bloco `runtime` usado é o do
// manifest.json de verdade — se alguém mexer na declaração, este teste enxerga.
// Hermético: HOME/ENGINE_KIT_HOME em pasta temporária, downloads de memória, sem janela e sem áudio.
//
//   node tests/test-ensure-daemon.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { generateKeyPairHex, signBlob } from "../kit/index.mjs";
import { tarBinary, renameRetry } from "../kit/provision.mjs";
import { ensureCommand } from "../kit/ensure.mjs";
import { shutdown } from "../kit/lifecycle.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RUN = join(tmpdir(), `engine-ensure-daemon-${Date.now()}`);
mkdirSync(RUN, { recursive: true });
process.env.ENGINE_KIT_HOME = join(RUN, "trust-home");

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const real = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")).engines.find((e) => e.name === "vxk");
const RUNTIME = real?.runtime;

console.log("== ensure com daemon vivo (kind=cli + runtime.shutdownPath) ==\n");

check("o vxk do manifest declara o runtime do daemon (run/daemon.json, /shutdown, token no cabeçalho)",
  RUNTIME?.runtimeFile === "run/daemon.json" && RUNTIME?.shutdownPath === "/shutdown"
  && RUNTIME?.shutdownTokenField === "shutdownToken" && RUNTIME?.shutdownTokenHeader === "x-shutdown-token",
  JSON.stringify(RUNTIME));
check("o vxk segue kind=cli (o kit não sobe nem espera o daemon)", real?.kind === "cli");

// o daemon fake: mesmo arquivo e mesmo endpoint do real; só encerra com o token certo
const DAEMON = join(RUN, "fake-daemon.mjs");
writeFileSync(DAEMON, `
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.FAKE_HOME, shutdownToken = 'tok-' + process.pid;
const srv = http.createServer((req, res) => {
  if (req.url === '/shutdown' && req.method === 'POST') {
    if (req.headers['x-shutdown-token'] !== shutdownToken) { res.writeHead(401).end('token'); return; }
    const ocupado = Number(process.env.FAKE_BUSY_MS || 0);
    if (ocupado) { res.writeHead(202).end(JSON.stringify({ reciclar: true })); setTimeout(() => process.exit(0), ocupado); return; }
    res.writeHead(200).end('ok'); setTimeout(() => process.exit(0), 50); return;
  }
  res.writeHead(404).end();
});
srv.listen(0, '127.0.0.1', () => {
  mkdirSync(join(home, 'run'), { recursive: true });
  writeFileSync(join(home, 'run', 'daemon.json'), JSON.stringify({ name: 'vxk', port: srv.address().port, pid: process.pid, shutdownToken }));
});
`);

function tgzOf(version) {
  const src = join(RUN, `src-${version}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "fake-engine", version }));
  writeFileSync(join(src, "fake-engine.mjs"), 'console.log("ok");\n');
  const tgz = `${src}.tgz`;
  execFileSync(tarBinary(), ["-czf", tgz, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  return readFileSync(tgz);
}

const serve = (blob, sig, version) => {
  const base = `https://github.com/x/y/releases/download/fake-engine-v${version}`;
  const map = { [`${base}/fake-engine.tgz`]: blob, [`${base}/fake-engine.tgz.sha256`]: Buffer.from(`${sha256(blob)}  fake-engine.tgz\n`), [`${base}/fake-engine.tgz.sig`]: sig };
  return async (url) => { if (!(url in map)) { const e = new Error("HTTP 404"); e.status = 404; throw e; } return map[url]; };
};

const owner = generateKeyPairHex();
const manifestWith = (version, home, runtime) => ({ engines: [{
  name: "fake-engine", version, kind: "cli", summary: "fixture", home, ...(runtime ? { runtime } : {}),
  install: { repo: "x/y", tag: "fake-engine-v{version}", asset: "fake-engine.tgz", checksum: "{asset}.sha256",
    extractTo: "bin", entry: "bin/fake-engine.mjs", publicKey: owner.publicKeyHex, signatureAlgorithm: "ed25519-sha256-raw" },
}] });

/** instala a 1.2.3, sobe o daemon fake com a pasta bin como diretório corrente e espera o daemon.json. */
async function instalarComDaemonVivo(home, runtime, busyMs = 0) {
  const v1 = manifestWith("1.2.3", home, runtime);
  const blob = tgzOf("1.2.3");
  const first = await ensureCommand("fake-engine", { bundled: v1, manifest: v1, fetcher: serve(blob, signBlob(blob, owner.privateKeyHex), "1.2.3") });
  if (!first.ok) { throw new Error(`instalação inicial falhou: ${first.reason}`); }
  const proc = spawn(process.execPath, [DAEMON], { cwd: join(home, "bin"), env: { ...process.env, FAKE_HOME: home, FAKE_BUSY_MS: String(busyMs) }, windowsHide: true, stdio: "ignore" });
  const dj = join(home, "run", "daemon.json");
  for (let i = 0; i < 100 && !existsSync(dj); i++) { await sleep(100); }
  if (!existsSync(dj)) { proc.kill(); throw new Error("o daemon fake não anunciou o daemon.json"); }
  return { proc, pid: JSON.parse(readFileSync(dj, "utf8")).pid };
}

async function atualizar(home, runtime) {
  const v2 = manifestWith("1.2.4", home, runtime);
  const blob = tgzOf("1.2.4");
  return ensureCommand("fake-engine", { bundled: v2, manifest: v2, fetcher: serve(blob, signBlob(blob, owner.privateKeyHex), "1.2.4") });
}
const versaoNoDisco = (home) => JSON.parse(readFileSync(join(home, "bin", "package.json"), "utf8")).version;

{
  console.log("-- runtime declarado: o ensure derruba o daemon vivo e troca --");
  const home = join(RUN, "home-declarado");
  const { proc, pid } = await instalarComDaemonVivo(home, RUNTIME);
  check("daemon vivo antes da atualização", vivo(pid), `pid ${pid}`);
  const r = await atualizar(home, RUNTIME);
  check("atualizou 1.2.3 → 1.2.4", r.ok && r.version === "1.2.4" && r.previous === "1.2.3", r.ok ? "" : r.reason);
  check("a instalação no disco é a 1.2.4", versaoNoDisco(home) === "1.2.4");
  for (let i = 0; i < 20 && vivo(pid); i++) { await sleep(100); }
  check("o daemon foi desligado antes do swap", !vivo(pid));
  proc.kill();
}

{
  console.log("\n-- daemon ocupado (202): o ensure espera o fim do trabalho antes do swap --");
  const home = join(RUN, "home-ocupado");
  const { proc, pid } = await instalarComDaemonVivo(home, RUNTIME, 3000);
  const r = await atualizar(home, RUNTIME);
  check("atualizou 1.2.3 → 1.2.4 depois que o daemon ocupado saiu", r.ok && r.version === "1.2.4" && versaoNoDisco(home) === "1.2.4", r.ok ? "" : r.reason);
  check("o daemon ocupado terminou", !vivo(pid));
  proc.kill();
}

{
  console.log("\n-- daemon ocupado além da espera: falha dita, sem fingir que parou --");
  const home = join(RUN, "home-ocupado-longo");
  const { proc, pid } = await instalarComDaemonVivo(home, RUNTIME, 8000);
  const s = await shutdown({ name: "fake-engine", homeDir: home, runtime: RUNTIME }, { waitBusyMs: 2000 });
  check("shutdown devolve ok:false com o motivo", s.ok === false && /ainda ocupado/.test(s.reason), JSON.stringify(s));
  check("o daemon ainda vive (o kit não o mata)", vivo(pid));
  for (let i = 0; i < 100 && vivo(pid); i++) { await sleep(200); }
  proc.kill();
}

{
  console.log("\n-- sem daemon.json (nada vivo): o ensure segue e troca --");
  const home = join(RUN, "home-sem-daemon");
  const v1 = manifestWith("1.2.3", home, RUNTIME);
  const b1 = tgzOf("1.2.3");
  await ensureCommand("fake-engine", { bundled: v1, manifest: v1, fetcher: serve(b1, signBlob(b1, owner.privateKeyHex), "1.2.3") });
  const r = await atualizar(home, RUNTIME);
  check("atualizou sem daemon", r.ok && r.version === "1.2.4", r.ok ? "" : r.reason);
}

if (process.platform === "win32") {
  console.log("\n-- controle (Windows): sem runtime declarado o daemon vivo trava a troca --");
  const home = join(RUN, "home-sem-runtime");
  const { proc, pid } = await instalarComDaemonVivo(home, undefined);
  const r = await atualizar(home, undefined);
  check("recusou com 'arquivos em uso' (é isso que a declaração evita)", !r.ok && /arquivos em uso/.test(r.reason), r.ok ? "trocou com o daemon vivo?" : r.reason);
  check("instalação anterior intacta (1.2.3)", versaoNoDisco(home) === "1.2.3");
  proc.kill();
  for (let i = 0; i < 20 && vivo(pid); i++) { await sleep(100); }
}

{
  // Determinístico: um processo com a pasta como cwd (o handle que o daemon deixa) sai num instante marcado;
  // no Windows o rename ocupado falha com EBUSY/EPERM até lá e o retry tem de absorver.
  console.log("\n-- swap: rename ocupado repete com backoff e passa quando o handle solta --");
  const seguro = (n) => { const d = join(RUN, n); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "f.txt"), "x"); return d; };
  const seguraAte = (d, ms) => spawn(process.execPath, ["-e", `setTimeout(() => {}, ${ms})`], { cwd: d, windowsHide: true, stdio: "ignore" });
  const a = seguro("rn-a");
  const h1 = seguraAte(a, 700);
  await sleep(300);
  let erro = null;
  try { await renameRetry(a, `${a}-novo`); } catch (e) { erro = e; }
  check("renameRetry passou depois que o handle soltou", !erro && existsSync(join(`${a}-novo`, "f.txt")), erro ? `${erro.code}` : "");

  const b = seguro("rn-b");
  const h2 = seguraAte(b, 20000);
  await sleep(300);
  erro = null;
  try { await renameRetry(b, `${b}-novo`, 3); } catch (e) { erro = e; }
  if (process.platform === "win32") {
    check("handle que não solta: lança o erro do SO (visível), sem estado parcial", /^(EBUSY|EPERM|EACCES)$/.test(erro?.code) && existsSync(join(b, "f.txt")) && !existsSync(`${b}-novo`), `${erro?.code}`);
  }
  h1.kill(); h2.kill();
}

console.log(failures === 0 ? "\n== TUDO VERDE ==": `\n== ${failures} FALHA(S) ==`);
process.exitCode = failures === 0 ? 0 : 1;
