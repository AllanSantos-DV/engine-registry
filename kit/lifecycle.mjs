// engine-kit/lifecycle.mjs — LIFECYCLE: garante o motor VIVO e devolve como falar com ele.
// Generalização do ensureDaemon.mjs do embed-house. Regra do kit: ele NUNCA adivinha a saúde do
// motor — `healthCheck` é sempre um callback de quem conhece o protocolo (handshake de versão,
// modelo, dimensão…). O kit cuida do que é genérico: ler o runtime.json fresco, subir o processo
// destacado e esperar o auto-anúncio. NUNCA lança.
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lê o runtime.json do motor SE estiver fresco (heartbeat vivo). null se ausente/obsoleto. */
export function readFreshRuntime(engine, { staleMs } = {}) {
  const rt = join(engine.homeDir, engine.runtime?.runtimeFile ?? "runtime.json");
  const limit = staleMs ?? (engine.runtime?.heartbeatMs ? engine.runtime.heartbeatMs * 3 : Infinity);
  try {
    if (Number.isFinite(limit) && Date.now() - statSync(rt).mtimeMs > limit) { return null; }
    return JSON.parse(readFileSync(rt, "utf8"));
  } catch {
    return null;
  }
}

/** Sobe o motor destacado, com ambiente limpo (fora do fork do host). */
function spawnEngine(nodePath, entryPath, log, extraEnv) {
  try {
    const child = spawn(nodePath, [entryPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, NODE_OPTIONS: "", COPILOT_SDK_PATH: "", ...extraEnv },
    });
    child.unref();
    log(`[engine-kit] motor disparado: ${nodePath} ${entryPath}`);
    return true;
  } catch (e) {
    log(`[engine-kit] falha ao subir motor (sinalizado): ${e?.message || e}`);
    return false;
  }
}

/**
 * Garante o motor vivo.
 * @param engine   descritor resolvido (resolve.mjs)
 * @param entryPath caminho do entrypoint instalado (provision.mjs)
 * @param healthCheck (runtimeInfo) => Promise<object|null> — validação de saúde/protocolo DO MOTOR.
 * @returns {Promise<{available:true, runtime:object, health:object} | {available:false, reason:string}>}
 */
export async function lifecycle(engine, entryPath, { healthCheck, log = () => {}, bootTimeoutMs = 60000, nodePath = process.execPath, env } = {}) {
  if (typeof healthCheck !== "function") {
    return { available: false, reason: "healthCheck é obrigatório (o kit não adivinha o protocolo do motor)" };
  }

  // 1) FAST PATH: já vivo? (runtime fresco + handshake do motor)
  const fresh = readFreshRuntime(engine);
  if (fresh) {
    const h = await healthCheck(fresh);
    if (h) { log(`[engine-kit] ${engine.name}: fast-path (já vivo)`); return { available: true, runtime: fresh, health: h }; }
    log(`[engine-kit] ${engine.name}: runtime fresco mas health incompatível — vai resubir`);
  }

  // 2) SOBE. A corrida por singleton é resolvida DENTRO do motor (port-lock/bind); quem perde sai.
  if (!spawnEngine(nodePath, entryPath, log, env)) {
    return { available: false, reason: `${engine.name}: spawn falhou` };
  }

  const deadline = Date.now() + bootTimeoutMs;
  while (Date.now() < deadline) {
    const info = readFreshRuntime(engine);
    if (info) {
      const h = await healthCheck(info);
      if (h) { return { available: true, runtime: info, health: h }; }
    }
    await sleep(1000);
  }
  return { available: false, reason: `${engine.name}: não anunciou em ${bootTimeoutMs}ms` };
}
