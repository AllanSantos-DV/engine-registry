// test-gateway-drain.mjs — antes de trocar os arquivos, o adaptador do mcp-gateway pede `POST /admin/drain`
// (bearer) e espera o daemon sair sozinho; o SIGTERM só vem se o gateway não drenar. No Windows o SIGTERM
// mata na hora e corta as chamadas em curso, então a prova é a chamada em curso terminar.
//
//   node tests/test-gateway-drain.mjs
import "./_tmp.mjs";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROOT = join(tmpdir(), `engine-kit-gwdrain-${process.pid}-${Date.now()}`);
mkdirSync(ROOT, { recursive: true });
process.env.USERPROFILE = ROOT;
process.env.HOME = ROOT;
const { onBeforeReplace } = await import("../consumers/mcp-gateway.mjs");

const TOKEN = "tok-de-teste";

// gateway falso: uma chamada em curso (800 ms, ou FAKE_CALL_MS); no drain espera ela acabar, grava a marca e sai com 0.
// O modo 'contrato' segue o daemon real (mcp-gateway src/daemon/http.ts + index.ts drenarEParar): lê {reason, waitMs}
// do corpo (sem corpo, o daemon real responde 500) e só responde 200 depois de drenar, saindo 100 ms após a resposta.
const FAKE = join(ROOT, "fake-gateway.mjs");
writeFileSync(FAKE, `
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.FAKE_HOME, mode = process.env.FAKE_MODE;
const emCurso = new Promise((r) => setTimeout(r, Number(process.env.FAKE_CALL_MS || 800))).then(() => writeFileSync(join(home, 'em-curso-terminou'), 'ok'));
http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: 'mcp-gateway', status: 'ok' })); return; }
  if (req.url !== '/admin/drain' || req.method !== 'POST' || mode === 'sem-rota') { res.writeHead(404).end(); return; }
  if (req.headers.authorization !== 'Bearer ${TOKEN}') { res.writeHead(401).end(); return; }
  if (mode === 'contrato') {
    let corpo = '';
    req.on('data', (c) => { corpo += c; }).on('end', async () => {
      writeFileSync(join(home, 'corpo-do-drain.json'), corpo);
      if (!corpo) { res.writeHead(500).end(); return; }
      await emCurso;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, pid: process.pid, pendentes: 0 }));
      setTimeout(() => process.exit(0), 100);
    });
    return;
  }
  res.writeHead(202).end('drenando');
  if (mode === 'trava') { return; }
  emCurso.then(() => process.exit(0));
}).listen(0, '127.0.0.1', function () {
  writeFileSync(join(home, 'runtime.json'), JSON.stringify({ pid: process.pid, port: this.address().port }));
});
`);

async function subir(mode, { comToken = true, callMs, pasta = mode } = {}) {
  const home = join(ROOT, pasta + (comToken ? "" : "-sem-token"));
  mkdirSync(home, { recursive: true });
  if (comToken) { writeFileSync(join(home, "auth-token"), TOKEN); }
  const proc = spawn(process.execPath, [FAKE], { env: { ...process.env, FAKE_HOME: home, FAKE_MODE: mode, ...(callMs ? { FAKE_CALL_MS: String(callMs) } : {}) }, windowsHide: true, stdio: "ignore" });
  const exitCode = new Promise((r) => proc.on("exit", (code) => r(code)));
  for (let i = 0; i < 100 && !existsSync(join(home, "runtime.json")); i++) { await sleep(100); }
  if (!existsSync(join(home, "runtime.json"))) { proc.kill(); throw new Error("gateway falso não anunciou o runtime.json"); }
  return { home, proc, exitCode, marca: join(home, "em-curso-terminou") };
}

console.log("== onBeforeReplace do mcp-gateway: drenar antes de sinalizar ==\n");

{
  const g = await subir("drena");
  const logs = [];
  await onBeforeReplace({ home: g.home, drainMs: 10000, log: (m) => logs.push(m) });
  check("a chamada em curso terminou antes de o daemon sair", existsSync(g.marca));
  check("o daemon saiu com código 0 (drenou, não foi morto)", (await g.exitCode) === 0, `código ${g.proc.exitCode}`);
  check("sem queda para o sinal", logs.length === 0, logs.join(" | "));
}

{
  const g = await subir("contrato", { callMs: 6000 });
  const logs = [];
  await onBeforeReplace({ home: g.home, drainMs: 10000, reason: "teste: troca do gateway", log: (m) => logs.push(m) });
  let corpo = {};
  try { corpo = JSON.parse(readFileSync(join(g.home, "corpo-do-drain.json"), "utf8")); } catch {}
  check("contrato real: o drain leva motivo e espera no corpo", corpo.reason === "teste: troca do gateway" && corpo.waitMs === 10000, JSON.stringify(corpo));
  check("contrato real: chamada em curso de 6 s termina (a resposta só chega depois da drenagem)", existsSync(g.marca), logs.join(" | "));
  check("contrato real: o daemon saiu com código 0, sem sinal", (await g.exitCode) === 0 && logs.length === 0, `código ${g.proc.exitCode}`);
}

{
  const g = await subir("drena", { pasta: "data-dir-do-ambiente" });
  process.env.MCP_GATEWAY_DATA_DIR = g.home;
  const logs = [];
  try { await onBeforeReplace({ drainMs: 10000, log: (m) => logs.push(m) }); } finally { delete process.env.MCP_GATEWAY_DATA_DIR; }
  const saiu = await Promise.race([g.exitCode, sleep(3000).then(() => "vivo")]);
  if (saiu === "vivo") { g.proc.kill(); }
  check("MCP_GATEWAY_DATA_DIR definido depois do import vale na chamada: drena o gateway dessa pasta", saiu === 0 && existsSync(g.marca), `saída ${saiu}`);
}

{
  const g = await subir("sem-rota");
  const logs = [];
  await onBeforeReplace({ home: g.home, drainMs: 10000, log: (m) => logs.push(m) });
  await g.exitCode;
  check("gateway sem /admin/drain: cai no sinal e o daemon sai", g.proc.exitCode !== null || g.proc.signalCode !== null);
  check("a queda para o sinal fica no log com o HTTP recebido", logs.some((m) => m.includes("HTTP 404")), logs.join(" | "));
}

{
  const g = await subir("drena", { comToken: false, callMs: 8000 });
  const logs = [];
  await onBeforeReplace({ home: g.home, drainMs: 10000, log: (m) => logs.push(m) });
  await g.exitCode;
  check("sem token: o drain é recusado (401), cai no sinal e a chamada em curso é cortada", logs.some((m) => m.includes("HTTP 401")) && !existsSync(g.marca), logs.join(" | "));
}

{
  const g = await subir("trava");
  const logs = [];
  const t0 = Date.now();
  await onBeforeReplace({ home: g.home, drainMs: 1500, log: (m) => logs.push(m) });
  await g.exitCode;
  check("drain aceito mas daemon preso: após o prazo cai no sinal e o daemon sai", Date.now() - t0 >= 1500 && logs.some((m) => m.includes("ainda vivo")), logs.join(" | "));
}

{
  const home = join(ROOT, "sem-runtime");
  mkdirSync(home, { recursive: true });
  let lancou = false;
  try { await onBeforeReplace({ home, drainMs: 500 }); } catch { lancou = true; }
  check("sem runtime.json (nada vivo): volta sem lançar", !lancou);
}

rmSync(ROOT, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
