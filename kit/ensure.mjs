// engine-kit/ensure.mjs — `npx engine-kit ensure <motor>`: instala um motor com um comando, sem clonar o repo.
//
// O mesmo caminho do doctor --fix (resolve → provision: sha256 + Ed25519 fail-closed, lock, swap), com uma
// diferença na raiz de confiança: a chave pública do PRIMEIRO contato vem do manifest.json que viaja DENTRO deste
// pacote (publicado no npm com proveniência), não do registry baixado na hora. Ela entra como `trustedKeys`: se o
// registry servir outra chave, é ABORT já na primeira instalação — quem toma o repositório não troca a chave sem
// também publicar um engine-kit novo, e essa publicação deixa rastro público (proveniência do npm).
//
// Motor que não está no manifest deste pacote é recusado: sem a chave embarcada não há primeiro contato
// verificável, e cair no TOFU calado seria justamente o buraco que o pacote fecha. Saída: atualizar o kit.
// NUNCA lança: devolve { ok, reason } para o cli decidir o exit code.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolve, fill, target, expandHome, platformReason } from "./resolve.mjs";
export { platformReason };
import { provision, installedVersion, satisfiesPin } from "./provision.mjs";
import { shutdown, stopEngine } from "./lifecycle.mjs";
import { pinOf, setPin } from "./trust.mjs";
export { firstContactKeys } from "./trust.mjs";
import { pointerOf } from "./diagnose.mjs";
import { checkCommand, historyCommand } from "./inspect.mjs";

const BUNDLED_MANIFEST = new URL("../manifest.json", import.meta.url);
const installedOf = (e) => existsSync(join(e.homeDir, e.install.entry)) ? installedVersion(join(e.homeDir, e.install.extractTo ?? "bin")) : null;

/** Manifest que viaja dentro do pacote (lança se ilegível; `embarcado` transforma em reason). */
export function bundledManifest() {
  return JSON.parse(readFileSync(BUNDLED_MANIFEST, "utf8"));
}

/** O manifest embarcado (ou o injetado por teste): `{ local }`, ou `{ reason }` quando ilegível. */
export function embarcado(bundled) {
  try { return { local: bundled ?? bundledManifest() }; }
  catch (e) { return { reason: `manifest embarcado ilegível: ${e.message}` }; }
}

/**
 * Pin do motor (`trust.json`), recusando uma `version` pedida que o contradiz.
 * @returns {{pin?:string, reason?:string}}
 */
export function pinFor(name, version) {
  let pin;
  try { pin = pinOf(name); } catch (e) { return { reason: e.message }; }
  return pin && version && version !== pin
    ? { reason: `${name} está fixado em v${pin} → engine-kit pin ${name} --version ${version} troca a versão fixada; engine-kit unpin ${name} solta` }
    : { pin };
}

/** `onBeforeReplace` do `provision`: derruba o daemon pelo `shutdownPath` que o registry declara, porque no Windows arquivo em uso não se sobrescreve. */
export const derrubarAntes = (engine, log) => async () => {
  const s = await shutdown(engine, { log });
  if (!s.ok) { log(`aviso: ${s.reason} — o swap pode falhar com o motor vivo`); }
};

/**
 * `engine-kit list`: os motores do manifest embarcado, a plataforma que cada um atende e o que está instalado aqui. Não usa rede. Nunca lança.
 * @returns {{ok:true, platform:string, engines:{name:string, version:string, kind:string, platforms:string[], supported:boolean, installed:string|null, selfManaged:boolean}[]} | {ok:false, reason:string}}
 */
export function listCommand({ bundled, platform = target() } = {}) {
  const { local, reason } = embarcado(bundled);
  if (!local) { return { ok: false, reason }; }
  const engines = (local.engines ?? []).map((e) => {
    let installed = null;
    try { installed = e.status !== "self-managed" && e.install.entry && e.home ? installedOf({ homeDir: expandHome(e.home), install: e.install }) : null; } catch { /* instalação ilegível = não instalado */ }
    return { name: e.name, version: e.version, kind: e.kind, platforms: e.platforms ?? [], supported: platformReason(e, platform) === null, installed, selfManaged: e.status === "self-managed" };
  });
  return { ok: true, platform, engines };
}

/**
 * @param {string} name motor no registry.
 * @param {object} opts
 * @param {string=} opts.version versão EXATA (default: a do registry): uma instalada diferente, maior ou menor, é trocada por ela.
 * @param {string=} opts.registryUrl manifest remoto (default: registry público).
 * @param {object=} opts.bundled manifest embarcado (default: o deste pacote; testes injetam).
 * @param {object=} opts.manifest manifest do registry já carregado (testes; pula rede e cache).
 * @param {Function=} opts.fetcher download injetável (testes).
 * @param {boolean=} opts.autoUpdate false = motor já instalado fica na versão dele e o retorno avisa a nova
 *        (`available`). Default true. Um `version` explícito sempre vale: foi pedido.
 *        Motor fixado (`engine-kit pin`) fica sempre na versão fixada; `version` diferente dela é recusado.
 * @param {boolean=} opts.dryRun true = só diz o que faria, sem baixar nem gravar: devolve `{ ok:true, dryRun:true, plan }` com `plan` = instalar, atualizar, reusar ou manter.
 * @returns {Promise<{ok:true, entryPath:string, version:string, kind:string, reused?:boolean, signed?:boolean,
 *          previous?:string, available?:string, pinned?:string} | {ok:false, reason:string}>} `previous` = versão
 *          substituída; `pinned` = versão em que o motor está fixado.
 */
export async function ensureCommand(name, { version, registryUrl, bundled, manifest, fetcher, autoUpdate = true, dryRun = false, log = () => {} } = {}) {
  const { local, reason } = embarcado(bundled);
  if (!local) { return { ok: false, reason }; }

  const pinned = (local.engines ?? []).find((e) => e.name === name);
  if (!pinned) { return { ok: false, reason: semMotor(local, name, "ensure") }; }
  const fora = platformReason(pinned);
  if (fora) { return { ok: false, reason: fora }; }
  const publicKey = pinned.install?.publicKey;
  if (!publicKey) {
    return { ok: false, reason: `${name}: o manifest embarcado não traz publicKey → sem chave do primeiro contato não instalo (ABORT)` };
  }

  const { pin, reason: recusa } = pinFor(name, version);
  if (recusa) { return { ok: false, reason: recusa }; }
  // refresh: instalar quer a verdade do registry, não um descritor de cache.
  const r = await resolve(name, { version: version ?? pin, registryUrl, refresh: true, ...(manifest ? { manifest } : {}) });
  if (!r.ok) { return { ok: false, reason: r.reason }; }

  const engine = r.engine;
  const previous = installedOf(engine);
  const manter = (!autoUpdate || engine.runtime?.updatePath) && !version && !pin && previous && !satisfiesPin(previous, engine.version);
  if (dryRun) {
    if (engine.status === "pending-release") { return { ok: false, reason: `${name} ainda não publicou release (status: pending-release)` }; }
    if (engine.status === "self-managed" && !previous) { return { ok: false, reason: `${name} é self-managed: instala pelo próprio instalador → engine-kit fetch ${name} baixa e confere` }; }
    const serve = previous && (version || pin ? previous === engine.version : engine.runtime?.updatePath || satisfiesPin(previous, engine.version));
    return {
      ok: true, dryRun: true, plan: manter ? "manter" : serve ? "reusar" : previous ? "atualizar" : "instalar", kind: engine.kind,
      version: manter || serve ? previous : engine.version,
      ...(previous ? { installed: previous } : {}), ...(manter ? { available: engine.version } : {}), ...(pin ? { pinned: pin } : {}), ...(engine.staleCache ? { staleCache: true } : {}),
    };
  }
  if (manter) {
    return {
      ok: true, entryPath: join(engine.homeDir, engine.install.entry), version: previous, kind: engine.kind, reused: true, available: engine.version,
      ...(engine.staleCache ? { staleCache: true } : {}),
      ...(engine.kind === "cli" ? { pointer: pointerOf(engine) } : {}),
    };
  }

  const p = await provision(r.engine, {
    log,
    trustedKeys: { [name]: publicKey },
    allowDowngrade: Boolean(version),
    exact: Boolean(pin || version),
    ...(fetcher ? { fetcher } : {}),
    onBeforeReplace: derrubarAntes(r.engine, log),
  });
  if (!p.ok && engine.status === "self-managed") {
    const { repo, tag } = engine.install;
    const release = `https://github.com/${repo}/releases/tag/${fill(tag, { version: engine.version, platform: process.platform, arch: process.arch })}`;
    return { ok: false, reason: `${p.reason} → instalador da v${engine.version}: ${release}; engine-kit fetch ${name} baixa e confere hash e assinatura sem instalar` };
  }
  if (!p.ok) {
    // Rotação legítima de chave chega ao registry antes de chegar a este pacote: a saída é o kit novo.
    const hint = /FIXADA|não declara publicKey/.test(p.reason) ? ` — se a chave foi rotacionada de propósito, rode npx engine-kit@latest ensure ${name}` : "";
    return { ok: false, reason: p.reason + hint };
  }
  return {
    ok: true, entryPath: p.entryPath, version: p.version, kind: engine.kind, reused: p.reused === true, signed: p.signed,
    ...(p.installed && previous && previous !== p.version ? { previous } : {}),
    ...(pin ? { pinned: pin } : {}),
    ...(engine.staleCache ? { staleCache: true } : {}),
    ...(engine.kind === "cli" ? { pointer: pointerOf(engine) } : {}),
  };
}

/**
 * `engine-kit ensure --de <manifesto>`: instala ou atualiza, pelo `ensureCommand`, cada motor que o `checkCommand` reprova por AUSENTE ou FORA-DA-FAIXA,
 * e reconfere no fim pelo mesmo check. Quem já satisfaz não é tocado (`reusado`); self-managed fica `pulado`; DESCONHECIDO e ERRO ficam `recusado`.
 * Faixa inválida aborta antes de instalar qualquer motor. Uma última versão que não satisfaz a faixa reprova como FORA-DA-FAIXA. Nunca lança.
 * @param {string} file manifesto do plugin.
 * @param {object=} opts as do `ensureCommand`, menos `version`.
 * @returns {Promise<{ok:boolean, manifest:string, reason?:string, engines:object[]} | {ok:false, reason:string}>} cada motor traz as chaves do
 *          `checkCommand` e `acao` (reusado, pulado, recusado, instalado, atualizado, mantido, falhou, abortado), `version`, `previous` e `available`.
 */
export async function ensureDeCommand(file, opts = {}) {
  const antes = await checkCommand(file, { manifest: opts.manifest });
  if (!antes.engines) { return antes; }
  const ruins = antes.engines.filter((e) => e.state === "FAIXA-INVALIDA").map((e) => e.name);
  if (ruins.length) {
    return { ...antes, ok: false, reason: `faixa inválida em ${ruins.join(", ")}: nada foi instalado`, engines: antes.engines.map((e) => ({ ...e, acao: "abortado" })) };
  }
  const extra = {};
  for (const e of antes.engines) {
    if (!["AUSENTE", "FORA-DA-FAIXA"].includes(e.state)) { extra[e.name] = { acao: { OK: "reusado", "NAO-VERIFICAVEL": "pulado" }[e.state] ?? "recusado" }; continue; }
    const r = await ensureCommand(e.name, opts);
    extra[e.name] = r.ok
      ? { acao: opts.dryRun ? { instalar: "instalaria", atualizar: "atualizaria" }[r.plan] ?? "mantido" : r.previous ? "atualizado" : r.reused ? "mantido" : "instalado", version: r.version, previous: r.previous ?? r.installed, available: r.available }
      : { acao: "falhou", detail: r.reason };
  }
  if (opts.dryRun) {
    const engines = antes.engines.map((e) => ({ ...e, ...extra[e.name] }));
    return { ok: engines.every((e) => !["recusado", "falhou"].includes(e.acao)), manifest: file, dryRun: true, engines };
  }
  const depois = await checkCommand(file, { manifest: opts.manifest });
  if (!depois.engines) { return depois; }
  const engines = depois.engines.map((e) => ({ ...e, ...extra[e.name] }));
  return { ok: engines.every((e) => e.satisfied), manifest: file, engines };
}

/** Motivo da recusa de um nome que não é motor: app aponta o `fetch`; o resto, o kit novo. */
const semMotor = (local, name, verbo) => (local.apps ?? []).some((a) => a.name === name)
  ? `"${name}" é app, não motor: o ${verbo} não se aplica → engine-kit fetch ${name} baixa e confere`
  : `motor "${name}" não está no manifest deste engine-kit → atualize o kit (npx engine-kit@latest ${verbo} ${name})`;

/**
 * `engine-kit pin <motor> [--version x.y.z]`: congela UM motor. Sem `version`, fixa a versão instalada; com ela,
 * instala essa versão (sha256 + Ed25519, downgrade permitido) e fixa. A autoatualização pula só este motor.
 * Nunca lança. Opções de teste iguais às de `ensureCommand`.
 * @returns {Promise<{ok:true, version:string, pinned:string} | {ok:false, reason:string}>}
 */
export async function pinCommand(name, { version, ...opts } = {}) {
  if (version) {
    const s = setPin(name, version), before = s.was;
    if (!s.ok) { return s; }
    const e = await ensureCommand(name, opts);
    if (!e.ok) {
      const back = setPin(name, before);
      return { ok: false, reason: `${e.reason} → pin não aplicado${back.ok ? (before ? ` (pin anterior v${before} restaurado)` : "") : `; ${back.reason}`}` };
    }
    return e;
  }
  const r = await resolve(name, { registryUrl: opts.registryUrl, ...(opts.manifest ? { manifest: opts.manifest } : {}) });
  if (!r.ok) { return { ok: false, reason: r.reason }; }
  if (r.engine.status === "self-managed") {
    return { ok: false, reason: `${name} é self-managed: atualiza pelo próprio updater, o engine-kit não fixa a versão dele` };
  }
  const inst = installedOf(r.engine);
  if (!inst) {
    return { ok: false, reason: `${name} não está instalado (ou a versão é ilegível) → engine-kit pin ${name} --version <x.y.z> instala e fixa` };
  }
  const s = setPin(name, inst);
  return s.ok ? { ok: true, version: inst, pinned: inst, ...(r.engine.staleCache ? { staleCache: true } : {}) } : s;
}

/** `engine-kit unpin <motor>`: o motor volta a receber atualizações. Nunca lança. */
export function unpinCommand(name) {
  const s = setPin(name, null);
  return s.ok ? { ok: true, was: s.was } : s;
}

/**
 * `engine-kit rollback <motor>`: volta o motor para a versão que ele tinha antes da última troca gravada no histórico (`history`), instalando-a
 * por `pin --version` (sha256 + Ed25519, downgrade permitido) e FIXANDO: sem o pin o próximo `ensure` atualizaria de volta. Só desfaz uma troca
 * que ainda vale: a versão instalada precisa ser a que a última troca gravou. Nunca lança. Opções de teste iguais às do `pinCommand`.
 * @returns {Promise<{ok:true, version:string, pinned:string} | {ok:false, reason:string}>}
 */
export async function rollbackCommand(name, { bundled, ...opts } = {}) {
  const h = historyCommand(name);
  if (!h.ok) { return h; }
  const last = h.entries.at(-1);
  if (!last) { return { ok: false, reason: `nenhuma troca registrada nesta máquina; não há versão anterior para voltar` }; }
  if (!last.from) { return { ok: false, reason: `a última troca (→ v${last.to}) foi a primeira instalação; não há versão anterior para voltar` }; }
  if (last.via === "rollback") { return { ok: false, reason: `a última troca foi a volta automática de v${last.from} para v${last.to}: v${last.from} não subiu e voltar a ela repetiria a falha → engine-kit pin ${name} --version <x.y.z> escolhe outra` }; }
  const row = listCommand({ bundled }).engines?.find((e) => e.name === name);
  if (!row) { return { ok: false, reason: `motor "${name}" não está no manifest deste engine-kit → atualize o kit (npx engine-kit@latest rollback ${name})` }; }
  if (row.selfManaged) { return { ok: false, reason: `${name} é self-managed: atualiza pelo próprio updater, o engine-kit não troca a versão dele` }; }
  if (row.installed !== last.to) { return { ok: false, reason: `instalado v${row.installed ?? "nenhuma"}, mas a última troca gravada terminou em v${last.to} → o histórico não descreve a instalação atual; use engine-kit pin ${name} --version <x.y.z>` }; }
  return pinCommand(name, { ...opts, bundled, version: last.from });
}

/**
 * `engine-kit stop <motor>`: desliga o motor pelo `shutdownPath` que o registry declara, o mesmo pedido que o kit faz antes
 * de trocar a instalação. Motor sem `shutdownPath` é recusado com o motivo: o kit não adivinha como desligar. Nunca lança.
 * @returns {Promise<{ok:true, stopped:boolean} | {ok:false, reason:string}>} `stopped:false` = nada vivo para desligar.
 */
export async function stopCommand(name, { registryUrl, bundled, manifest, log = () => {} } = {}) {
  const { local, reason } = embarcado(bundled);
  if (!local) { return { ok: false, reason }; }
  if (!(local.engines ?? []).some((e) => e.name === name)) { return { ok: false, reason: semMotor(local, name, "stop") }; }
  return stopEngine(name, { registryUrl, manifest, log });
}
