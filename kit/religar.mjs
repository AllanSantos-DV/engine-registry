// engine-kit/religar.mjs — o `ensure` religa o daemon que ele próprio derrubou para trocar a instalação.
//
// Só religa o que estava VIVO (runtime + pid + /health) e que o `shutdown` do ensure encerrou de fato; daemon parado não é lançado, e o kit
// continua sem verbo para subir motor. A subida reaproveita a do cliente compartilhado (`launchDetached`: sem janela, saída em <home>/run/boot.log)
// e a espera pelo anúncio é a do `discover`. Ferramental do CLI: o runtime do consumidor não importa este arquivo.
import { readFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { CASA, GRAFO, discover, launchDetached } from "./client.mjs";
import { alive, lifeOf } from "./diagnose.mjs";
import { readRuntime } from "./lifecycle.mjs";
import { sleep, say } from "./provision.mjs";
import { derrubarAntes } from "./ensure.mjs";

/** Quanto o kit espera o daemon religado anunciar o `runtime.runtimeFile` e responder o `/health`; o mesmo prazo do `ensureHome`. */
export const PRAZO_RELIGAR_MS = 60000;

/**
 * Motor que o ensure sabe religar: declara runtime (arquivo, health e shutdown) e o executável instalado é o próprio daemon, isto é, `kind: daemon` (menos o mcp-gateway, que tem lançador próprio no `ensureGateway`)
 * ou os dois motores que o cliente compartilhado sobe (a casa e o grafo, `kind: cli`). O vxk é `cli` com daemon próprio: o executável dele é um shim stdio.
 * Fora também o motor que se relança sozinho ao desligar (`shutdownPath` com `relaunch=1`): o kit lançaria um segundo.
 */
export const religavel = (engine) => {
  const r = engine.runtime;
  return Boolean(r?.runtimeFile && r.healthPath && r.shutdownPath) && !/[?&]relaunch=1(&|$)/.test(r.shutdownPath) && engine.name !== "mcp-gateway" && (engine.kind === "daemon" || [CASA, GRAFO].includes(engine.name));
};

/** O motor é religável e tem daemon VIVO agora (pid existe e `/health` responde). */
export const vivoParaReligar = async (engine) => religavel(engine) && (await lifeOf(engine)).state === "VIVO";

/** As últimas linhas do log, sem o `token` do anúncio do daemon nem sequências hexadecimais de 32+ caracteres (podem ser segredo). */
const fimDoLog = (log, token) => {
  try {
    const fim = readFileSync(log, "utf8").trim().split("\n").slice(-5).join(" | ");
    return (token ? fim.replaceAll(String(token), "[omitido]") : fim).replace(/[0-9a-f]{32,}/gi, "[omitido]");
  } catch { return ""; }
};

/** Versão sem o sufixo `+metadata` de semver, que não distingue versões. */
const semMeta = (v) => String(v).replace(/^v/, "").replace(/\+.*$/, "");

const foraDoHome = (home, p) => { const r = relative(home, resolve(home, p)); return /^\.\.([\\/]|$)/.test(r) || isAbsolute(r); };

/**
 * Sobe o executável e espera o anúncio da `versao`; no prazo, ou se o processo morre, devolve a causa e o `bootLog`.
 * Daemon já no ar na `versao` (outro consumidor subiu durante a troca) é devolvido sem lançar nada; o anúncio de um pid vivo nunca é apagado e esse pid é esperado, não duplicado.
 * A versão anunciada vale sem o sufixo `+metadata`; daemon saudável que anuncia outra versão devolve ok:false e continua vivo; se o anúncio é de outro pid, o filho lançado é encerrado.
 * O prazo é um só para a espera do pid anterior e a do filho.
 */
async function subir(engine, versao, prazoMs) {
  const { homeDir, install, runtime } = engine;
  const entry = join(homeDir, install.entry);
  const bootLog = join(homeDir, "run", "boot.log");
  const manifest = { engines: [engine] };
  const falha = (reason, pid) => ({ ok: false, reason, bootLog, ...(pid ? { pid } : {}) });
  const fora = [install.entry, runtime.runtimeFile].find((p) => foraDoHome(homeDir, p));
  if (fora) { return falha(`${fora} fica fora do home ${homeDir}: não lancei nem apaguei nada`); }
  const olhar = async (boot) => {
    const d = await discover(engine.name, { manifest });
    return d.ok ? { ok: true, pid: d.pid ?? boot?.pid, version: String(d.version ?? versao ?? "").replace(/^v/, ""), bootLog } : null;
  };
  const noAr = async (boot) => { const o = await olhar(boot); return o && (!versao || semMeta(o.version) === semMeta(versao)) ? o : null; };
  const fim = Date.now() + prazoMs;
  const esperar = async (boot, segue) => {
    let up = await noAr(boot);
    for (; !up && segue() && Date.now() < fim; up = await noAr(boot)) { await sleep(250); }
    return up ?? noAr(boot);
  };
  const divergiu = async (boot) => { const o = await olhar(boot); return o && falha(`o daemon está no ar mas anuncia v${o.version}, esperado v${versao}`, o.pid); };
  const ja = await noAr();
  if (ja) { return ja; }
  const anterior = readRuntime(engine)?.pid;
  if (anterior && alive(anterior)) {
    const up = await esperar(undefined, () => alive(anterior));
    if (up) { return up; }
    if (alive(anterior)) { return (await divergiu()) ?? falha(`o pid ${anterior} anunciado está vivo mas não respondeu o /health em ${prazoMs}ms: não lancei um segundo daemon`, anterior); }
  }
  const anuncio = readRuntime(engine);
  if (!(anuncio?.pid && alive(anuncio.pid))) { rmSync(join(homeDir, runtime.runtimeFile), { force: true }); }
  const opts = { cwd: dirname(entry), env: { ...process.env, NODE_OPTIONS: "", COPILOT_SDK_PATH: "" } };
  let boot;
  try { boot = /\.[cm]?js$/.test(entry) ? launchDetached(process.execPath, bootLog, [entry], opts) : launchDetached(entry, bootLog, [], opts); }
  catch (e) { return falha(`não consegui subir ${entry} (${e?.message ?? e})`); }
  const up = await esperar(boot, () => !boot.dead);
  if (up) { return up; }
  if (boot.dead) {
    const { code, signal, error } = boot.dead;
    return falha(`${entry} saiu ao subir (${error ?? (signal ? `sinal ${signal}` : `código ${code}`)}); últimas linhas: ${fimDoLog(bootLog, readRuntime(engine)?.[runtime.shutdownTokenField]) || "(vazio)"}`, boot.pid);
  }
  const div = await divergiu(boot);
  if (div?.pid === boot.pid) { return div; }
  try { process.kill(boot.pid); } catch { /* já saiu */ }
  return div ?? falha(`${entry} subiu mas não anunciou em ${prazoMs}ms (encerrei o pid ${boot.pid})`, boot.pid);
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
