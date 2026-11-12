// test-gateway-adapter-fields.mjs — o retorno do ensureGateway() diz o que o agente precisa saber para decidir.
//
// Gateway sem token legível continua disponível, mas o retorno explica por que o token é null (em vez de o
// agente só descobrir pelo 401). Também devolve a versão instalada, avisa descritor vindo de cache vencido e
// fixa a chave do primeiro contato do manifest embarcado (a mesma raiz de confiança do `engine-kit ensure`).
// Hermético: gateway falso numa porta livre, motor já instalado numa pasta temporária, registry local.
//
//   node tests/test-gateway-adapter-fields.mjs
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, rmSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const ROOT = join(tmpdir(), `engine-kit-gwfields-${process.pid}-${Date.now()}`);
const HOME = join(ROOT, "user");
const GW_HOME = join(ROOT, "gw-home");
mkdirSync(HOME, { recursive: true });
mkdirSync(GW_HOME, { recursive: true });
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
process.env.ENGINE_KIT_HOME = join(ROOT, "trust-home");
process.env.MCP_GATEWAY_DATA_DIR = GW_HOME;
delete process.env.MCP_GATEWAY_TOKEN;

const { ensureGateway } = await import("../consumers/mcp-gateway.mjs");
const { firstContactKeys } = await import("../kit/trust.mjs");

const gateway = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ name: "mcp-gateway", status: "ok", backends: [] })));
await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
const port = gateway.address().port;

const manifest = { engines: [{
  name: "mcp-gateway", version: "9.9.9", kind: "daemon", summary: "fixture", home: GW_HOME,
  install: { type: "github-release", repo: "x/y", tag: "v{version}", asset: "mcp-gateway.tgz", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/mcp-gateway.mjs", publicKey: "bb".repeat(32), signatureRequired: true },
  runtime: { transport: "http", runtimeFile: "runtime.json", healthPath: "/health", defaultPort: port, heartbeatMs: 30000 },
}] };
mkdirSync(join(GW_HOME, "bin"), { recursive: true });
writeFileSync(join(GW_HOME, "bin", "mcp-gateway.mjs"), "process.exit(0);\n");
writeFileSync(join(GW_HOME, "bin", "package.json"), JSON.stringify({ name: "mcp-gateway", version: "9.9.9" }));
writeFileSync(join(GW_HOME, "config.json"), JSON.stringify({ port }));
writeFileSync(join(GW_HOME, "runtime.json"), JSON.stringify({ pid: process.pid, port }));
const registry = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(manifest)));
await new Promise((r) => registry.listen(0, "127.0.0.1", r));
const registryUrl = `http://127.0.0.1:${registry.address().port}/manifest.json`;

console.log("== ensureGateway: o que o retorno explica ==\n");

writeFileSync(join(GW_HOME, "auth-token"), "senha-de-teste\n");
{
  const gw = await ensureGateway({ registryUrl, bootTimeoutMs: 1500 });
  check("token legível: vem no retorno e não há tokenReason", gw.available === true && gw.token === "senha-de-teste" && gw.tokenReason === undefined, JSON.stringify({ t: gw.token, r: gw.tokenReason }));
  check("a versão instalada do motor vem no retorno", gw.version === "9.9.9", gw.version);
  check("descritor fresco: sem staleCache", gw.staleCache === undefined, String(gw.staleCache));
}

rmSync(join(GW_HOME, "auth-token"));
{
  const gw = await ensureGateway({ registryUrl, bootTimeoutMs: 1500 });
  check("sem token: o gateway continua disponível com token null", gw.available === true && gw.token === null, JSON.stringify({ a: gw.available, t: gw.token }));
  check("sem token: o retorno explica o motivo e onde procurou", typeof gw.tokenReason === "string" && /auth-token/.test(gw.tokenReason) && /MCP_GATEWAY_TOKEN/.test(gw.tokenReason), gw.tokenReason);
}

{
  const cache = join(HOME, ".engine-kit", "manifest.json");
  const velho = new Date(Date.now() - 7 * 60 * 60 * 1000);
  utimesSync(cache, velho, velho);
  registry.close();
  const gw = await ensureGateway({ registryUrl, bootTimeoutMs: 1500 });
  check("registry fora e cache vencido: o retorno avisa staleCache", gw.available === true && gw.staleCache === true, JSON.stringify({ a: gw.available, s: gw.staleCache, r: gw.reason }));
}

console.log("\n== ensureGateway: chave do primeiro contato ==\n");

{
  const embutida = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).engines.find((e) => e.name === "mcp-gateway").install.publicKey;
  check("registry público: fixa a chave do manifest embarcado", firstContactKeys("mcp-gateway")["mcp-gateway"] === embutida, JSON.stringify(firstContactKeys("mcp-gateway")));
  check("registry próprio (registryUrl): a chave embarcada não se aplica", firstContactKeys("mcp-gateway", registryUrl) === undefined);
}

{
  const otro = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ engines: [{ ...manifest.engines[0], version: "9.9.10" }] })));
  await new Promise((r) => otro.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${otro.address().port}/manifest.json`;
  const corpo = Buffer.from("artefato");
  const fetcher = async (u) => (u.endsWith(".sha256") ? Buffer.from(`${createHash("sha256").update(corpo).digest("hex")}  mcp-gateway.tgz`) : corpo);
  const gw = await ensureGateway({ registryUrl: url, fetcher, trustedKeys: { "mcp-gateway": "aa".repeat(32) }, bootTimeoutMs: 1500 });
  check("chave do registry diferente da fixada: ABORT, gateway indisponível", gw.available === false && /FIXADA/.test(gw.reason), gw.reason);
  otro.close();
}

gateway.close();
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
