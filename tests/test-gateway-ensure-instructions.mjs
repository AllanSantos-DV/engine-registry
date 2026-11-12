// test-gateway-ensure-instructions.mjs — ensureGateway() devolve junto as instruções para agente.
//
// Um host que conecta no gateway (url + token) precisa também do pacote de instruções do motor, sem chamar
// outra função nem ler caminho: o retorno traz `instructions` com o conteúdo do arquivo instalado, ou o motivo
// de não haver. O gateway disponível nunca vira indisponível por falta do arquivo de instruções.
// Hermético: gateway falso numa porta livre, motor já instalado numa pasta temporária (nada de rede, nada do cofre).
//
//   node tests/test-gateway-ensure-instructions.mjs
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const ROOT = join(tmpdir(), `engine-kit-gwinstr-${process.pid}-${Date.now()}`);
const HOME = join(ROOT, "user");
const GW_HOME = join(ROOT, "gw-home");
mkdirSync(HOME, { recursive: true });
mkdirSync(GW_HOME, { recursive: true });
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
process.env.ENGINE_KIT_HOME = join(ROOT, "trust-home");
process.env.MCP_GATEWAY_DATA_DIR = GW_HOME;

const { ensureGateway, instructionsPath } = await import("../consumers/mcp-gateway.mjs");

const server = createServer((req, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ name: "mcp-gateway", status: "ok", backends: ["a"] })));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

// motor já instalado e vivo: o ensure reusa, sem rede
const manifest = { engines: [{
  name: "mcp-gateway", version: "9.9.9", kind: "daemon", summary: "fixture", home: GW_HOME,
  install: { type: "github-release", repo: "x/y", tag: "v{version}", asset: "mcp-gateway.tgz", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/mcp-gateway.mjs" },
  runtime: { transport: "http", runtimeFile: "runtime.json", healthPath: "/health", defaultPort: port, heartbeatMs: 30000 },
}] };
mkdirSync(join(GW_HOME, "bin"), { recursive: true });
writeFileSync(join(GW_HOME, "bin", "mcp-gateway.mjs"), "process.exit(0);\n");
writeFileSync(join(GW_HOME, "bin", "package.json"), JSON.stringify({ name: "mcp-gateway", version: "9.9.9" }));
writeFileSync(join(GW_HOME, "config.json"), JSON.stringify({ port }));
writeFileSync(join(GW_HOME, "runtime.json"), JSON.stringify({ pid: process.pid, port }));
const registry = createServer((req, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(manifest)));
await new Promise((r) => registry.listen(0, "127.0.0.1", r));
const registryUrl = `http://127.0.0.1:${registry.address().port}/manifest.json`;

console.log("== ensureGateway: instruções para agente no retorno ==\n");

const file = instructionsPath();
mkdirSync(join(file, ".."), { recursive: true });
const CONTEUDO = "# instruções de teste\nuse o gateway assim\n";
writeFileSync(file, CONTEUDO);

{
  const gw = await ensureGateway({ registryUrl, bootTimeoutMs: 1500 });
  check("gateway disponível pelo caminho rápido (motor vivo, sem rede)", gw.available === true, gw.available ? "" : gw.reason);
  check("o retorno traz as instruções com o conteúdo do arquivo instalado", gw.instructions?.available === true && gw.instructions.content === CONTEUDO, JSON.stringify(gw.instructions));
  check("o caminho devolvido é o do arquivo instalado", gw.instructions?.path === file, gw.instructions?.path);
}

{
  rmSync(file);
  const gw = await ensureGateway({ registryUrl, bootTimeoutMs: 1500 });
  check("sem o arquivo de instruções o gateway continua disponível", gw.available === true, gw.available ? "" : gw.reason);
  check("a ausência das instruções vem explicada, sem lançar", gw.instructions?.available === false && typeof gw.instructions.reason === "string" && gw.instructions.reason.length > 0, JSON.stringify(gw.instructions));
}

server.close();
registry.close();
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
