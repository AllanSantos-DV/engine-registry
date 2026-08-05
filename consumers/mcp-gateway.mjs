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
import { join, dirname, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { ensureEngine } from "../kit/index.mjs";

const DEFAULT_HOME = join(homedir(), ".mcp-gateway");
const DEFAULT_PORT = 7337;
const ENGINE_NAME = "mcp-gateway";
// manifest.json do próprio engine-registry — mesmo arquivo que declara `install.agentInstructions`
// e `install.extractTo` para este motor (fonte única de verdade; ver schema.json).
const MANIFEST_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), "manifest.json");

/** HOME do motor, resolvido a cada chamada (respeita override de teste/dev via env). */
function resolveHome() {
  return process.env.MCP_GATEWAY_DATA_DIR || DEFAULT_HOME;
}

const HOME = resolveHome();

/**
 * Descritor do motor `mcp-gateway` lido do manifest.json do registry. Nunca lança: manifest
 * ilegível ou motor ausente do registro → null (quem chama sinaliza, não inventa um default).
 */
function loadEngineDescriptor() {
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    return (manifest.engines ?? []).find((e) => e?.name === ENGINE_NAME) ?? null;
  } catch {
    return null;
  }
}

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
 * Caminho do pacote de instruções para agente, dentro do HOME do motor. Composto a partir do
 * MESMO `install.agentInstructions` declarado no manifest.json (fonte única de verdade — mudar
 * o manifest muda o consumer, nunca o contrário) e de `install.extractTo` (a pasta onde o
 * `provision` REALMENTE desempacota o artefato — ver kit/provision.mjs: `binDir = join(home,
 * install.extractTo ?? "bin")`). Sem isso o caminho apontaria para <home>/docs/... enquanto o
 * artefato desempacotado mora em <home>/<extractTo>/docs/... — dois lugares diferentes.
 * Função pura: só resolve o caminho, não toca rede (o manifest.json lido é o arquivo estático
 * empacotado junto com este módulo, não uma chamada ao registry remoto).
 * @returns {string|null} null quando o manifest não declara `agentInstructions` para o motor.
 */
export function instructionsPath() {
  const engine = loadEngineDescriptor();
  const rel = engine?.install?.agentInstructions;
  if (!rel) { return null; }
  const extractTo = engine.install.extractTo ?? "bin";
  if (rel.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(rel) || rel.split(/[\\/]+/).includes("..")) {
    return null;
  }
  const home = resolvePath(resolveHome());
  const candidate = resolvePath(home, extractTo, rel);
  if (candidate !== home && !candidate.startsWith(`${home}${sep}`)) {
    return null;
  }
  return candidate;
}

/**
 * Carrega o pacote de instruções do disco (sem rede, sem healthcheck). Host-agnóstico:
 * devolve o conteúdo cru para qualquer cliente MCP decidir o que fazer com ele.
 * @returns {{available:true, path:string, content:string} | {available:false, reason:string}}
 */
export function readInstructions() {
  const path = instructionsPath();
  if (!path) {
    return { available: false, reason: "manifest.json não declara um caminho seguro para as instruções do mcp-gateway" };
  }
  try {
    return { available: true, path, content: readFileSync(path, "utf8") };
  } catch (e) {
    return { available: false, reason: e.message };
  }
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
