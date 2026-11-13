#!/usr/bin/env node
/* tests/e2e-gateway-drain-live.mjs — o onBeforeReplace do adaptador contra o mcp-gateway REAL instalado: uma cópia do
   bin (o daemon vivo e a pasta dele não são tocados) sobe numa porta livre com pasta de dados temporária, uma sessão
   chama uma tool lenta (7 s, acima de qualquer timeout curto de HTTP) e, com ela em voo, o adaptador pede a troca.
   A chamada precisa terminar com o resultado e o daemon sair com código 0 pelo drain.

     node tests/e2e-gateway-drain-live.mjs            (bin em ~/.mcp-gateway/bin; GW_BIN troca) */
import "./_tmp.mjs";
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { onBeforeReplace } from '../consumers/mcp-gateway.mjs';

const BIN = process.env.GW_BIN ?? join(homedir(), '.mcp-gateway', 'bin');
const LENTA_MS = 7000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, cond, detail = '') => { if (!cond) failures++; console.log(`${cond ? '  OK  ' : ' FALHA'} ${name}${detail ? ` — ${detail}` : ''}`); };

const freePort = () => new Promise((resolve, reject) => {
  const s = netServer().on('error', reject).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** Backend MCP mínimo (Streamable HTTP, respostas JSON) com a tool `lenta`. */
function backend(port) {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; }).on('end', async () => {
      const msg = JSON.parse(body || '{}');
      const send = (result) => { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's1' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })); };
      if (msg.method === 'initialize') return send({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'lento', version: '1.0.0' } });
      if (msg.method === 'tools/list') return send({ tools: [{ name: 'lenta', description: 'demora', inputSchema: { type: 'object' } }] });
      if (msg.method === 'tools/call') { await sleep(LENTA_MS); return send({ content: [{ type: 'text', text: 'terminou' }] }); }
      res.writeHead(202).end();
    });
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}

/** Cliente MCP de uma sessão no gateway. */
function client(url, token) {
  let sid = null, id = 0;
  return async (method, params = {}) => {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` };
    if (sid) headers['mcp-session-id'] = sid;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    sid = res.headers.get('mcp-session-id') ?? sid;
    const text = await res.text();
    const line = text.split('\n').find((l) => l.startsWith('data: '));
    return { status: res.status, json: JSON.parse(line ? line.slice(6) : text) };
  };
}

const tmp = mkdtempSync(join(tmpdir(), 'gw-drain-live-'));
const bin = join(tmp, 'bin');
const home = join(tmp, 'dados');
let daemon, srv;
try {
  if (!existsSync(join(BIN, 'mcp-gateway.mjs'))) throw new Error(`sem mcp-gateway.mjs em ${BIN}`);
  cpSync(BIN, bin, { recursive: true });
  const version = JSON.parse(readFileSync(join(bin, 'package.json'), 'utf8')).version;
  const [port, bport] = [await freePort(), await freePort()];
  srv = await backend(bport);
  mkdirSync(home);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ port, backends: { lento: { type: 'streamable-http', url: `http://127.0.0.1:${bport}/mcp` } }, idleTimeoutMs: 0, settings: {} }));
  console.log(`== drain do mcp-gateway ${version} real (cópia em ${bin}, porta ${port}) ==\n`);

  daemon = spawn(process.execPath, [join(bin, 'mcp-gateway.mjs')], { env: { ...process.env, MCP_GATEWAY_DATA_DIR: home }, stdio: 'ignore', windowsHide: true });
  const exitCode = new Promise((r) => daemon.on('exit', (code, signal) => r({ code, signal })));
  let up = false;
  for (let i = 0; i < 150 && !up; i++) {
    const h = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json()).catch(() => null);
    up = (h?.status === 'ok' || h?.status === 'degraded') && existsSync(join(home, 'runtime.json'));
    if (!up) await sleep(200);
  }
  if (!up) throw new Error('o gateway isolado não subiu');

  const rpc = client(`http://127.0.0.1:${port}/mcp`, readFileSync(join(home, 'auth-token'), 'utf8').trim());
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e-drain', version: '1' } });
  const tools = (await rpc('tools/list')).json.result?.tools ?? [];
  const lenta = tools.find((t) => t.name.endsWith('lenta'))?.name;
  if (!lenta) throw new Error(`tool lenta fora do catálogo: ${tools.map((t) => t.name).join(', ')}`);

  const t0 = Date.now();
  const emVoo = rpc('tools/call', { name: lenta, arguments: {} }).catch((e) => ({ status: 0, erro: String(e?.cause?.code ?? e) }));
  await sleep(500);
  const logs = [];
  await onBeforeReplace({ home, reason: 'e2e: troca do gateway', log: (m) => logs.push(m) });
  const r = await emVoo;
  const saida = await exitCode;
  check('a chamada em voo termina com o resultado', r.status === 200 && JSON.stringify(r.json).includes('terminou'), `status ${r.status} ${r.erro ?? ''} em ${Date.now() - t0} ms`);
  check('o daemon saiu com código 0 (drain, não sinal)', saida.code === 0, JSON.stringify(saida));
  check('sem queda para o sinal', logs.length === 0, logs.join(' | '));
  const parada = readFileSync(join(home, 'daemon.log'), 'utf8').split('\n').filter((l) => /drenagem|parando/.test(l));
  check('daemon.log registra o motivo enviado e código 0', parada.some((l) => /motivo="drain: e2e: troca do gateway".*código=0/.test(l)), parada.join(' | '));
  console.log(parada.map((l) => `        ${l.trim()}`).join('\n'));
} catch (e) {
  check('execução sem erro', false, e.message);
} finally {
  try { daemon?.kill(); } catch { /* já saiu */ }
  srv?.close(); srv?.closeAllConnections?.();
  await sleep(300);
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n== ${failures === 0 ? 'TUDO VERDE' : `${failures} FALHA(S)`} ==`);
process.exitCode = failures ? 1 : 0;
