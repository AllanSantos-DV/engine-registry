// engine-kit/religar.mjs — o `ensure` religa o daemon que ele próprio derrubou para trocar a instalação.
//
// Só religa o que estava VIVO (runtime + pid + /health) e que o `shutdown` do ensure encerrou de fato; daemon parado não é lançado, e o kit
// continua sem verbo para subir motor. A subida reaproveita a do cliente compartilhado (`launchDetached`: sem janela, saída em <home>/run/boot.log)
// e a espera pelo anúncio é a do `discover`. Ferramental do CLI: o runtime do consumidor não importa este arquivo.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CASA, GRAFO, discover, launchDetached } from "./client.mjs";
import { lifeOf } from "./diagnose.mjs";
import { sleep, say } from "./provision.mjs";
import { derrubarAntes } from "./ensure.mjs";

/** Quanto o kit espera o daemon religado anunciar o `runtime.runtimeFile` e responder o `/health`; o mesmo prazo do `ensureHome`. */
export const PRAZO_RELIGAR_MS = 60000;

/**
 * Motor que o ensure sabe religar: declara runtime (arquivo, health e shutdown) e o executável instalado é o próprio daemon, isto é, `kind: daemon` (menos o mcp-gateway, que tem lançador próprio no `ensureGateway`)
 * ou os dois motores que o cliente compartilhado sobe (a casa e o grafo, `kind: cli`). O vxk é `cli` com daemon próprio: o executável dele é um shim stdio.
 */
export const religavel = (engine) => {
  const r = engine.runtime;
  return Boolean(r?.runtimeFile && r.healthPath && r.shutdownPath) && engine.name !== "mcp-gateway" && (engine.kind === "daemon" || [CASA, GRAFO].includes(engine.name));
};

/** O motor é religável e tem daemon VIVO agora (pid existe e `/health` responde). */
export const vivoParaReligar = async (engine) => religavel(engine) && (await lifeOf(engine)).state === "VIVO";

const fimDoLog = (log) => { try { return readFileSync(log, "utf8").trim().split("\n").slice(-5).join(" | "); } catch { return ""; } };

/** Sobe o executável novo e espera o anúncio; no prazo, ou se o processo morre, devolve a causa e o `bootLog`. */
async function subir(engine, versao, prazoMs) {
  const entry = join(engine.homeDir, engine.install.entry);
  const bootLog = join(engine.homeDir, "run", "boot.log");
  const manifest = { engines: [engine] };
  const falha = (reason, pid) => ({ ok: false, reason, bootLog, ...(pid ? { pid } : {}) });
  rmSync(join(engine.homeDir, engine.runtime.runtimeFile), { force: true });
  let boot;
  try { boot = /\.[cm]?js$/.test(entry) ? launchDetached(process.execPath, bootLog, [entry]) : launchDetached(entry, bootLog); }
  catch (e) { return falha(`não consegui subir ${entry} (${e?.message ?? e})`); }
  let d = await discover(engine.name, { manifest });
  for (const fim = Date.now() + prazoMs; !d.ok && !boot.dead && Date.now() < fim; d = await discover(engine.name, { manifest })) { await sleep(250); }
  if (d.ok) { return { ok: true, pid: d.pid ?? boot.pid, version: String(d.version ?? versao).replace(/^v/, ""), bootLog }; }
  if (boot.dead) {
    const { code, signal, error } = boot.dead;
    return falha(`${entry} saiu ao subir (${error ?? (signal ? `sinal ${signal}` : `código ${code}`)}); últimas linhas: ${fimDoLog(bootLog) || "(vazio)"}`, boot.pid);
  }
  try { process.kill(boot.pid); } catch { /* já saiu */ }
  return falha(`${entry} subiu mas não anunciou em ${prazoMs}ms (encerrei o pid ${boot.pid})`, boot.pid);
}

/**
 * Par de ganchos do `ensure`: `antes` substitui o `derrubarAntes` e anota se derrubou um daemon vivo; `religar` sobe o novo, só nesse caso.
 * @param {object} engine descritor resolvido.
 * @param {{log?:(m:string)=>void, prazoMs?:number}} [opts]
 * @returns {{antes:()=>Promise<void>, religar:(versao:string)=>Promise<undefined|{ok:true, pid:number, version:string, bootLog:string}|{ok:false, reason:string, bootLog:string, pid?:number}>}}
 */
export function religador(engine, { log = () => {}, prazoMs = PRAZO_RELIGAR_MS } = {}) {
  let derrubou = false;
  return {
    async antes() {
      const vivo = await vivoParaReligar(engine);
      const s = await derrubarAntes(engine, log)();
      derrubou = vivo && s.stopped === true;
    },
    async religar(versao) {
      if (!derrubou) { return undefined; }
      say(log, engine, "religando o daemon que estava no ar...");
      const r = await subir(engine, versao, prazoMs);
      say(log, engine, r.ok ? `daemon religado (pid ${r.pid}, v${r.version}); saída em ${r.bootLog}` : `daemon NÃO religado: ${r.reason}; saída em ${r.bootLog}`);
      return r;
    },
  };
}
