// engine-kit/religar.mjs — o `ensure` e o `doctor --fix` religam o daemon que eles próprios derrubaram para trocar a instalação.
//
// Só religa o que estava no ar (runtime + pid + porta; `/health` respondendo ou lento) e que o `shutdown` do gancho `antes` encerrou de fato; daemon parado não é lançado, e o kit
// continua sem verbo para subir motor. A subida reaproveita a do cliente compartilhado (`launchDetached`: sem janela, saída em <home>/run/boot.log)
// e a espera pelo anúncio é a do `discover`. Ferramental do CLI: o runtime do consumidor não importa este arquivo.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { CASA, GRAFO, discover, launchDetached } from "./client.mjs";
import { alive, lifeOf } from "./diagnose.mjs";
import { readRuntime } from "./lifecycle.mjs";
import { sleep, say } from "./provision.mjs";
import { derrubarAntes } from "./ensure.mjs";

/** Quanto o kit espera o daemon religado anunciar o `runtime.runtimeFile` e responder o `/health`; o mesmo prazo do `ensureHome`. */
export const PRAZO_RELIGAR_MS = 60000;

/** Espera mínima do filho lançado, mesmo que o pid anterior tenha gasto quase todo o prazo (nunca maior que o prazo). */
export const PISO_FILHO_MS = 10000;

/**
 * Motor que o ensure sabe religar: declara runtime (arquivo, health e shutdown) e o executável instalado é o próprio daemon, isto é, `kind: daemon` (menos o mcp-gateway, que tem lançador próprio no `ensureGateway`)
 * ou os dois motores que o cliente compartilhado sobe (a casa e o grafo, `kind: cli`). O vxk é `cli` com daemon próprio: o executável dele é um shim stdio.
 * Fora também o motor que se relança sozinho ao desligar (`shutdownPath` com `relaunch=1`): o kit lançaria um segundo.
 */
export const religavel = (engine) => {
  const r = engine.runtime;
  return Boolean(r?.runtimeFile && r.healthPath && r.shutdownPath) && !/[?&]relaunch=1(&|$)/.test(r.shutdownPath) && engine.name !== "mcp-gateway" && (engine.kind === "daemon" || [CASA, GRAFO].includes(engine.name));
};

/** O motor é religável e tem daemon no ar agora: pid existe e o `/health` responde (VIVO) ou passa do prazo (TRAVADO, que o `shutdown` ainda derruba). */
export const vivoParaReligar = async (engine) => religavel(engine) && ["VIVO", "TRAVADO"].includes((await lifeOf(engine)).state);

/** O fim do log (até 5 linhas e 400 caracteres), sem o `token` do anúncio do daemon nem sequência de 24+ caracteres `[A-Za-z0-9+/=_-]` (hexadecimal, base64 e token de URL podem ser segredo). */
const fimDoLog = (log, token) => {
  try {
    const fim = readFileSync(log, "utf8").trim().split("\n").slice(-5).join(" | ");
    return (token ? fim.replaceAll(String(token), "[omitido]") : fim).replace(/[A-Za-z0-9+/=_-]{24,}/g, "[omitido]").slice(-400);
  } catch { return ""; }
};

/** Versão sem o sufixo `+metadata` de semver, que não distingue versões. */
const semMeta = (v) => String(v).replace(/^v/, "").replace(/\+.*$/, "");

const foraDoHome = (home, p) => { const r = relative(home, resolve(home, p)); return /^\.\.([\\/]|$)/.test(r) || isAbsolute(r); };

/**
 * Sobe o executável e espera o anúncio da `versao`; no prazo, ou se o processo morre, devolve a causa e o `bootLog`.
 * Daemon já no ar na `versao` (outro consumidor subiu durante a troca) é devolvido sem lançar nada; o anúncio de um pid vivo nunca é apagado e esse pid é esperado, não duplicado.
 * Sem o executável no disco (a troca apagou a instalação anterior) nada é lançado: `ausente:true`. Anúncio sem pid não permite saber quem é o filho: ninguém é encerrado e a razão diz isso.
 * A versão anunciada vale sem o sufixo `+metadata`; daemon saudável que anuncia outra versão devolve ok:false e continua vivo; o filho lançado que não é o anunciante (outro pid, de qualquer versão) é encerrado.
 * O prazo vale para a espera do pid anterior; o filho lançado espera ao menos `pisoMs`, de modo que o total fica em até prazo + piso.
 */
async function subir(engine, versao, prazoMs, pisoMs) {
  const { homeDir, install, runtime } = engine;
  const entry = join(homeDir, install.entry);
  const bootLog = join(homeDir, "run", "boot.log");
  const manifest = { engines: [engine] };
  const falha = (reason, pid) => ({ ok: false, reason, bootLog, ...(pid ? { pid } : {}) });
  const fora = [install.entry, runtime.runtimeFile].find((p) => foraDoHome(homeDir, p));
  if (fora) { return falha(`${fora} fica fora do home ${homeDir}: não lancei nem apaguei nada`); }
  const olhar = async () => {
    const d = await discover(engine.name, { manifest });
    return d.ok ? { ok: true, pid: d.pid, version: String(d.version ?? versao ?? "").replace(/^v/, ""), bootLog } : null;
  };
  const noAr = async () => { const o = await olhar(); return o && (!versao || semMeta(o.version) === semMeta(versao)) ? o : null; };
  const fim = Date.now() + prazoMs;
  const esperar = async (segue, limite) => {
    let up = await noAr();
    for (; !up && segue() && Date.now() < limite; up = await noAr()) { await sleep(250); }
    return up ?? noAr();
  };
  const divergiu = async () => { const o = await olhar(); return o && (semMeta(o.version) === semMeta(versao) ? o : falha(`o daemon está no ar mas anuncia v${o.version}, esperado v${versao}${o.pid ? "" : "; o anúncio não traz pid: não encerrei ninguém"}`, o.pid)); };
  const ja = await noAr();
  if (ja) { return ja; }
  const anterior = readRuntime(engine)?.pid;
  if (anterior && alive(anterior)) {
    const up = await esperar(() => alive(anterior), fim);
    if (up) { return up; }
    if (alive(anterior)) { return (await divergiu()) ?? falha(`o pid ${anterior} anunciado está vivo mas não respondeu o /health em ${prazoMs}ms: não lancei um segundo daemon`, anterior); }
  }
  if (!existsSync(entry)) { return { ...falha(`${install.entry} não existe mais em ${homeDir}: não lancei nada`), ausente: true }; }
  const anuncio = readRuntime(engine);
  if (!(anuncio?.pid && alive(anuncio.pid))) { rmSync(join(homeDir, runtime.runtimeFile), { force: true }); }
  const opts = { cwd: dirname(entry), env: { ...process.env, NODE_OPTIONS: "", COPILOT_SDK_PATH: "" } };
  let boot;
  try { boot = /\.[cm]?js$/.test(entry) ? launchDetached(process.execPath, bootLog, [entry], opts) : launchDetached(entry, bootLog, [], opts); }
  catch (e) { return falha(`não consegui subir ${entry} (${e?.message ?? e})`); }
  const matar = () => { try { process.kill(boot.pid); } catch { /* já saiu */ } };
  const lancadoEm = Date.now();
  const fimDoFilho = Math.max(fim, lancadoEm + Math.min(pisoMs, prazoMs));
  const up = await esperar(() => !boot.dead, fimDoFilho);
  if (up) { return up.pid && up.pid !== boot.pid && !boot.dead ? (matar(), up) : up; }
  const morreu = () => {
    const { code, signal, error } = boot.dead;
    return falha(`${entry} saiu ao subir (${error ?? (signal ? `sinal ${signal}` : `código ${code}`)}); últimas linhas: ${fimDoLog(bootLog, readRuntime(engine)?.[runtime.shutdownTokenField]) || "(vazio)"}`, boot.pid);
  };
  const div = await divergiu();
  const outro = div?.pid && div.pid !== boot.pid;
  if (boot.dead && !(div?.ok && (outro || !div.pid))) { return morreu(); }
  if (div && !outro) { return div; }
  if (!boot.dead) { matar(); }
  return div ?? falha(`${entry} subiu mas não anunciou em ${Math.ceil((fimDoFilho - lancadoEm) / 100) * 100}ms (encerrei o pid ${boot.pid})`, boot.pid);
}

/** Trecho da razão de um `ensure` ou `doctor --fix` que religou o daemon: vazio sem religar; `instalada` = a troca terminou e foi o religar da versão nova que falhou. */
export const aposReligar = (r, instalada) => !r ? "" : r.ok
  ? (instalada ? "" : `; a troca falhou; o daemon anterior foi religado (pid ${r.pid ?? "?"}, v${r.version})`)
  : r.ausente && !instalada ? "; a troca falhou e a instalação anterior não existe mais: o daemon NÃO está no ar"
  : `${instalada ? ", mas" : ";"} o daemon NÃO está no ar: ${r.reason}; saída do daemon em ${r.bootLog}`;

/**
 * Par de ganchos do `ensure` e do `doctor --fix`: `antes` substitui o `derrubarAntes` e anota se derrubou um daemon no ar; `religar` sobe o novo, só nesse caso, e avisa na saída quando o gancho derrubou o daemon de um motor que o kit não religa.
 * @param {object} engine descritor resolvido.
 * @param {{log?:(m:string)=>void, prazoMs?:number, pisoFilhoMs?:number}} [opts]
 * @returns {{antes:()=>Promise<void>, religar:(versao:string)=>Promise<undefined|{ok:true, pid?:number, version:string, bootLog:string}|{ok:false, reason:string, bootLog:string, pid?:number, ausente?:true}>}}
 */
export function religador(engine, { log = () => {}, prazoMs = PRAZO_RELIGAR_MS, pisoFilhoMs = PISO_FILHO_MS } = {}) {
  let derrubou = false, orfao = false;
  return {
    async antes() {
      const noAr = await vivoParaReligar(engine);
      const s = await derrubarAntes(engine, log)();
      derrubou = noAr && s.stopped === true;
      orfao = !religavel(engine) && s.stopped === true;
    },
    async religar(versao) {
      if (orfao) { say(log, engine, "daemon derrubado e NÃO religado por este comando (quem o sobe é o consumidor)"); }
      if (!derrubou) { return undefined; }
      say(log, engine, "religando o daemon que estava no ar...");
      const r = await subir(engine, versao, prazoMs, pisoFilhoMs);
      say(log, engine, r.ok ? `daemon religado (pid ${r.pid ?? "?"}, v${r.version}); saída em ${r.bootLog}` : `daemon NÃO religado: ${r.reason}; saída em ${r.bootLog}`);
      return r;
    },
  };
}
