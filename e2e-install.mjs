// e2e-install.mjs — prova de ponta a ponta da Fase 3: um consumidor NOVO obtém o motor
// `mcp-gateway` só com o engine-kit — resolve (registry remoto) → provision (download real com
// verificação SHA256) → lifecycle (daemon vivo respondendo). Usa um HOME isolado para não tocar
// a instalação da máquina.
//
//   node e2e-install.mjs
import { resolve, provision, lifecycle } from "./kit/index.mjs";
import { mkdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HOME = join(tmpdir(), `mcpgw-e2e-${Date.now()}`);
const PORT = 7391; // porta isolada, não colide com o daemon real (7337)
let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("== e2e: instalar o mcp-gateway do zero via engine-kit ==\n");
console.log(`HOME isolado: ${HOME}\n`);

// 1) RESOLVE — direto do registry público (sem cache local)
const cache = join(process.env.USERPROFILE ?? process.env.HOME, ".engine-kit", "manifest.json");
if (existsSync(cache)) { rmSync(cache, { force: true }); }

const r = await resolve("mcp-gateway", { allowNetwork: true });
check("resolve do registry remoto", r.ok, r.ok ? r.engine.assetUrl : r.reason);
if (!r.ok) { process.exit(1); }
check("não está mais pending-release", r.engine.status !== "pending-release");

// Redireciona a instalação para o HOME isolado.
const engine = { ...r.engine, homeDir: HOME };

// 2) PROVISION — download real + SHA256 fail-closed
console.log("\nbaixando e instalando (download real)…");
const p = await provision(engine, { log: (m) => console.log(`    ${m}`) });
check("provision instalou", p.ok, p.ok ? `v${p.version}` : p.reason);
if (!p.ok) { process.exit(1); }
check("entrypoint existe no disco", existsSync(p.entryPath), p.entryPath);
check("shim veio junto", existsSync(join(HOME, "bin", "mcp-gateway-shim.mjs")));

// 3) LIFECYCLE — sobe o daemon e valida o protocolo (healthCheck é do motor)
writeFileSync(join(HOME, "config.json"), JSON.stringify({ port: PORT, backends: {} }, null, 2));

const healthCheck = async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) { return null; }
    const h = await res.json();
    return h?.name === "mcp-gateway" ? h : null; // handshake: é mesmo o nosso motor?
  } catch {
    return null;
  }
};

console.log("\nsubindo o daemon…");
const l = await lifecycle(engine, p.entryPath, {
  healthCheck,
  log: (m) => console.log(`    ${m}`),
  bootTimeoutMs: 30000,
  env: { MCP_GATEWAY_DATA_DIR: HOME },
});
check("daemon vivo e respondendo", l.available, l.available ? `v${l.health.version} status=${l.health.status}` : l.reason);

// 4) Limpeza: derruba o daemon isolado
if (l.available) {
  try {
    const rt = JSON.parse((await import("node:fs")).readFileSync(join(HOME, "runtime.json"), "utf8"));
    process.kill(rt.pid, "SIGTERM");
    console.log(`\n    daemon de teste (pid ${rt.pid}) encerrado`);
  } catch { /* best-effort */ }
}

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
