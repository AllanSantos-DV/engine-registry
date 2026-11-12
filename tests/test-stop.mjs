// test-stop.mjs — `engine-kit stop <motor>` desliga o motor pelo shutdownPath que o registry declara.
//
// O daemon é um fake com o contrato do vxk (run/daemon.json + POST /shutdown com x-shutdown-token), numa porta própria
// e numa pasta temporária: nenhum daemon real da máquina é consultado. O bloco `runtime` usado é o do manifest.json.
//
//   node tests/test-stop.mjs
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "engine-stop-"));
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: join(RUN, "trust-home") });
const { stopCommand } = await import("../kit/ensure.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const real = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).engines;
const RUNTIME = real.find((e) => e.name === "vxk").runtime;
check("o vxk do manifest declara o shutdownPath que o stop usa", RUNTIME?.shutdownPath === "/shutdown");
check("o mcp-gateway do manifest não declara shutdownPath (o stop recusa em vez de adivinhar)", !real.find((e) => e.name === "mcp-gateway").runtime?.shutdownPath);

const DAEMON = join(RUN, "fake-daemon.mjs");
writeFileSync(DAEMON, `
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.FAKE_HOME, shutdownToken = 'tok-' + process.pid;
const srv = http.createServer((req, res) => {
  if (req.url === '/shutdown' && req.method === 'POST') {
    if (req.headers['x-shutdown-token'] !== shutdownToken) { res.writeHead(401).end('token'); return; }
    res.writeHead(200).end('ok'); setTimeout(() => process.exit(0), 50); return;
  }
  res.writeHead(404).end();
});
srv.listen(0, '127.0.0.1', () => {
  mkdirSync(join(home, 'run'), { recursive: true });
  writeFileSync(join(home, 'run', 'daemon.json'), JSON.stringify({ name: 'fake', port: srv.address().port, pid: process.pid, shutdownToken }));
});
`);

const manifestWith = (home, runtime) => ({ engines: [{
  name: "fake-engine", version: "1.0.0", kind: "cli", summary: "fixture", home, ...(runtime ? { runtime } : {}),
  install: { repo: "x/y", tag: "v{version}", asset: "a.tgz", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/a.mjs" },
}] });
const opts = (m) => ({ bundled: m, manifest: m });

{
  const home = join(RUN, "home-vivo");
  mkdirSync(home, { recursive: true });
  const proc = spawn(process.execPath, [DAEMON], { env: { ...process.env, FAKE_HOME: home }, windowsHide: true, stdio: "ignore" });
  for (let i = 0; i < 100 && !(() => { try { readFileSync(join(home, "run", "daemon.json")); return true; } catch { return false; } })(); i++) { await sleep(100); }
  const pid = JSON.parse(readFileSync(join(home, "run", "daemon.json"), "utf8")).pid;
  check("daemon fake vivo antes do stop", vivo(pid), `pid ${pid}`);
  const r = await stopCommand("fake-engine", opts(manifestWith(home, RUNTIME)));
  check("stop de motor vivo devolve ok com stopped:true", r.ok === true && r.stopped === true, JSON.stringify(r));
  for (let i = 0; i < 30 && vivo(pid); i++) { await sleep(100); }
  check("o processo do motor saiu", !vivo(pid));
  proc.kill();
}

{
  const home = join(RUN, "home-parado");
  mkdirSync(home, { recursive: true });
  const r = await stopCommand("fake-engine", opts(manifestWith(home, RUNTIME)));
  check("stop sem daemon.json é ok e diz que nada estava vivo (stopped:false)", r.ok === true && r.stopped === false, JSON.stringify(r));
}

{
  const r = await stopCommand("fake-engine", opts(manifestWith(join(RUN, "home-sem-runtime"), undefined)));
  check("motor sem shutdownPath declarado é recusado com o motivo", r.ok === false && /não declara shutdownPath/.test(r.reason), r.reason);
}

{
  const r = await stopCommand("nao-existe", opts(manifestWith(join(RUN, "x"), RUNTIME)));
  check("motor fora do manifest do kit é recusado", r.ok === false && /não está no manifest/.test(r.reason), r.reason);
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
