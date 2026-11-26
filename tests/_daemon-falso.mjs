// tests/_daemon-falso.mjs — o descritor `runtime` e o código do daemon HTTP falso que os testes do ensure usam para subir, derrubar e religar um motor.
//
// O daemon anuncia porta, pid, versão (a do package.json ao lado) e `shutdownToken` em run/daemon.json, responde /health e encerra no POST /shutdown com o token.

export const RUNTIME = { transport: "http", runtimeFile: "run/daemon.json", healthPath: "/health", shutdownPath: "/shutdown", shutdownTokenField: "shutdownToken", shutdownTokenHeader: "x-shutdown-token", heartbeatMs: 30000 };

export const SOBE = `
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
