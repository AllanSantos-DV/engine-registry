// test-gateway-provision.mjs — ensureGateway() instala pelo caminho real (registry local + fetcher
// injetados) mesmo com um `tar` QUEBRADO na frente do PATH (caso real: GNU tar do Git Bash lendo
// "C:\..." como host remoto). No Windows o kit usa %SystemRoot%\System32\tar.exe; nos demais, o do PATH.
//
//   node tests/test-gateway-provision.mjs
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const ROOT = join(tmpdir(), `engine-kit-gwprov-${process.pid}-${Date.now()}`);
const FAKE_HOME = join(ROOT, "home");
const BROKEN = join(ROOT, "broken-bin");
mkdirSync(FAKE_HOME, { recursive: true });
mkdirSync(BROKEN, { recursive: true });

// isola TUDO que escreve em ~ (cache do registry, trust, HOME do motor) antes de importar o kit
process.env.USERPROFILE = FAKE_HOME;
process.env.HOME = FAKE_HOME;
process.env.MCP_GATEWAY_DATA_DIR = join(FAKE_HOME, ".mcp-gateway");

const { ensureGateway } = await import("../consumers/mcp-gateway.mjs");
const { tarBinary } = await import("../kit/provision.mjs");

// artefato mínimo
const pkg = join(ROOT, "pkg");
mkdirSync(pkg, { recursive: true });
writeFileSync(join(pkg, "mcp-gateway.mjs"), "process.exit(0);\n");
writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "mcp-gateway", version: "9.9.9" }));
const TGZ = join(ROOT, "mcp-gateway.tgz");
execFileSync(tarBinary(), ["-czf", TGZ, "-C", pkg, "."], { stdio: "ignore" });
const sha = createHash("sha256").update(readFileSync(TGZ)).digest("hex");

// registry local: manifest com o motor, sem assinatura (o objeto aqui é a extração, não a autenticidade)
const manifest = { engines: [{
  name: "mcp-gateway", version: "9.9.9", kind: "daemon", summary: "fixture", home: join(FAKE_HOME, ".mcp-gateway"),
  install: { type: "github-release", repo: "x/y", tag: "v{version}", asset: "mcp-gateway.tgz", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/mcp-gateway.mjs" },
  runtime: { transport: "http", runtimeFile: "runtime.json", healthPath: "/health", defaultPort: 1, heartbeatMs: 30000 },
}] };
const registry = createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(manifest)); });
await new Promise((r) => registry.listen(0, "127.0.0.1", r));
const registryUrl = `http://127.0.0.1:${registry.address().port}/manifest.json`;

// tar quebrado na frente do PATH: aceita --version, falha em qualquer extração
copyFileSync(process.execPath, join(BROKEN, process.platform === "win32" ? "tar.exe" : "tar"));
process.env.PATH = BROKEN + delimiter + process.env.PATH;

const fetched = [];
const fetcher = async (url) => {
  fetched.push(url);
  if (url.endsWith(".sha256")) return Buffer.from(`${sha}  mcp-gateway.tgz`);
  if (url.endsWith(".tgz")) return readFileSync(TGZ);
  throw new Error(`url inesperada: ${url}`);
};

console.log("== ensureGateway: registry local + tar quebrado no PATH ==\n");
const r = await ensureGateway({ registryUrl, fetcher, bootTimeoutMs: 1500 });
check("registryUrl repassado (resolveu a versão do registry local)", fetched.some((u) => u.includes("9.9.9")), fetched[0]);
check("fetcher repassado (asset e sidecar vieram dele)", fetched.some((u) => u.endsWith(".tgz")) && fetched.some((u) => u.endsWith(".sha256")));
if (process.platform === "win32") {
  check("extraiu apesar do tar quebrado no PATH", existsSync(join(FAKE_HOME, ".mcp-gateway", "bin", "mcp-gateway.mjs")), r.available ? "" : r.reason);
} else {
  console.log("  --   fora do Windows o tar do PATH é o contrato: extração com tar quebrado não se aplica");
}
check("motor falso não sobe → degrade sinalizado, sem lançar", r.available === false && !!r.reason);

registry.close();
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
