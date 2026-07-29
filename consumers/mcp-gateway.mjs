// consumers/mcp-gateway.mjs — adaptador pronto do motor `mcp-gateway`.
//
// Qualquer extensão que queira falar com o agregador MCP importa isto e chama `ensureGateway()`.
// O adaptador sabe o que é específico DESTE motor (handshake do /health, onde mora o bearer
// token, como pedir shutdown antes de uma atualização) — o engine-kit cuida do resto
// (resolver no registry, baixar com SHA256, instalar, subir, esperar o anúncio).
//
//   import { ensureGateway } from "engine-registry/consumers/mcp-gateway.mjs";
//
//   const gw = await ensureGateway({ log });
//   if (!gw.available) { log(`gateway indisponível: ${gw.reason}`); return; }   // degrade SINALIZADO
//   // gw.url   -> http://127.0.0.1:<porta>/mcp
//   // gw.token -> bearer para o header Authorization
//
// Contrato: nunca lança.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ensureEngine } from "../kit/index.mjs";

const HOME = join(homedir(), ".mcp-gateway");
const DEFAULT_PORT = 7337;

/** Lê a porta configurada pelo usuário (config.json), caindo no default do motor. */
function configuredPort() {
  try {
    return JSON.parse(readFileSync(join(HOME, "config.json"), "utf8")).port ?? DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

/** Lê o bearer token do cofre do motor (arquivo com ACL só do dono). */
function readToken() {
  try {
    return readFileSync(join(HOME, "auth-token"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Handshake do gateway: confirma que quem atende na porta é MESMO este motor e já está
 * servindo. `degraded` é ACEITO — significa que o gateway está de pé e atendendo, com um
 * ou mais backends em reconexão; `starting` não serve (ainda conectando pela primeira vez).
 */
async function healthCheck() {
  const port = configuredPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) { return null; }
    const h = await res.json();
    const serving = h?.status === "ok" || h?.status === "degraded";
    return h?.name === "mcp-gateway" && serving ? { ...h, port } : null;
  } catch {
    return null;
  }
}

/** Derruba o daemon antes de sobrescrever os arquivos (Windows trava arquivo em uso). */
async function onBeforeReplace() {
  try {
    const rt = JSON.parse(readFileSync(join(HOME, "runtime.json"), "utf8"));
    if (rt?.pid) { process.kill(rt.pid, "SIGTERM"); }
    await new Promise((r) => setTimeout(r, 1500));
  } catch { /* já parado / sem runtime */ }
}

/**
 * Garante o agregador MCP instalado e vivo.
 * @returns {Promise<{available:true, url:string, token:string|null, port:number, backends:string[], health:object}
 *                  | {available:false, reason:string}>}
 */
export async function ensureGateway({ log = () => {}, version, allowNetwork = true, bootTimeoutMs = 45000 } = {}) {
  const r = await ensureEngine("mcp-gateway", {
    healthCheck,
    onBeforeReplace,
    log,
    version,
    allowNetwork,
    bootTimeoutMs,
    env: { MCP_GATEWAY_DATA_DIR: HOME },
  });
  if (!r.available) { return r; }

  const port = r.health.port ?? configuredPort();
  return {
    available: true,
    url: `http://127.0.0.1:${port}/mcp`,
    token: readToken(),
    port,
    backends: r.health.backends ?? [],
    health: r.health,
  };
}
