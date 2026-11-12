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
import { resolve, fill } from "./resolve.mjs";
import { provision, installedVersion, satisfiesPin } from "./provision.mjs";
import { shutdown, stopEngine } from "./lifecycle.mjs";
import { pinOf, readTrust, updateEntry } from "./trust.mjs";
export { firstContactKeys } from "./trust.mjs";
import { pointerOf } from "./diagnose.mjs";

const BUNDLED_MANIFEST = new URL("../manifest.json", import.meta.url);
const installedOf = (e) => existsSync(join(e.homeDir, e.install.entry)) ? installedVersion(join(e.homeDir, e.install.extractTo ?? "bin")) : null;

/** Manifest que viaja dentro do pacote (lança se ilegível; `ensureCommand` transforma em reason). */
export function bundledManifest() {
  return JSON.parse(readFileSync(BUNDLED_MANIFEST, "utf8"));
}

/**
 * @param {string} name motor no registry.
 * @param {object} opts
 * @param {string=} opts.version pin de versão (default: a do registry).
 * @param {string=} opts.registryUrl manifest remoto (default: registry público).
 * @param {object=} opts.bundled manifest embarcado (default: o deste pacote; testes injetam).
 * @param {object=} opts.manifest manifest do registry já carregado (testes; pula rede e cache).
 * @param {Function=} opts.fetcher download injetável (testes).
 * @param {boolean=} opts.autoUpdate false = motor já instalado fica na versão dele e o retorno avisa a nova
 *        (`available`). Default true. Um `version` explícito sempre vale: foi pedido.
 *        Motor fixado (`engine-kit pin`) fica sempre na versão fixada; `version` diferente dela é recusado.
 * @returns {Promise<{ok:true, entryPath:string, version:string, kind:string, reused?:boolean, signed?:boolean,
 *          previous?:string, available?:string, pinned?:string} | {ok:false, reason:string}>} `previous` = versão
 *          substituída; `pinned` = versão em que o motor está fixado.
 */
export async function ensureCommand(name, { version, registryUrl, bundled, manifest, fetcher, autoUpdate = true, log = () => {} } = {}) {
  let local;
  try { local = bundled ?? bundledManifest(); }
  catch (e) { return { ok: false, reason: `manifest embarcado ilegível: ${e.message}` }; }

  const pinned = (local.engines ?? []).find((e) => e.name === name);
  if (!pinned) { return { ok: false, reason: semMotor(local, name, "ensure") }; }
  const publicKey = pinned.install?.publicKey;
  if (!publicKey) {
    return { ok: false, reason: `${name}: o manifest embarcado não traz publicKey → sem chave do primeiro contato não instalo (ABORT)` };
  }

  let pin;
  try { pin = pinOf(name); } catch (e) { return { ok: false, reason: e.message }; }
  if (pin && version && version !== pin) {
    return { ok: false, reason: `${name} está fixado em v${pin} → engine-kit pin ${name} --version ${version} troca a versão fixada; engine-kit unpin ${name} solta` };
  }
  // refresh: instalar quer a verdade do registry, não um descritor de cache.
  const r = await resolve(name, { version: version ?? pin, registryUrl, refresh: true, ...(manifest ? { manifest } : {}) });
  if (!r.ok) { return { ok: false, reason: r.reason }; }

  const engine = r.engine;
  const previous = installedOf(engine);
  if (!autoUpdate && !version && !pin && previous && !satisfiesPin(previous, engine.version)) {
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
    exact: Boolean(pin),
    ...(fetcher ? { fetcher } : {}),
    // Windows: arquivo em uso não se sobrescreve. Derruba o daemon pelo shutdownPath que o registry declara.
    onBeforeReplace: async () => {
      const s = await shutdown(r.engine, { log });
      if (!s.ok) { log(`aviso: ${s.reason} — o swap pode falhar com o motor vivo`); }
    },
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

/** Motivo da recusa de um nome que não é motor: app aponta o `fetch`; o resto, o kit novo. */
const semMotor = (local, name, verbo) => (local.apps ?? []).some((a) => a.name === name)
  ? `"${name}" é app, não motor: o ${verbo} não se aplica → engine-kit fetch ${name} baixa e confere`
  : `motor "${name}" não está no manifest deste engine-kit → atualize o kit (npx engine-kit@latest ${verbo} ${name})`;

/** Fixa (`version`) ou solta (null) um motor em trust.json; os outros motores não mudam. `was` = pin anterior. */
function setPin(name, version) {
  try {
    if (!version && !pinOf(name)) { return { ok: true, was: null }; }
    let was = null;
    updateEntry(name, (e) => {
      const entry = { ...e };
      was = entry.pin ?? null;
      if (version) { entry.pin = version; } else { delete entry.pin; }
      return entry;
    });
    return { ok: true, was };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

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
 * `engine-kit stop <motor>`: desliga o motor pelo `shutdownPath` que o registry declara, o mesmo pedido que o kit faz antes
 * de trocar a instalação. Motor sem `shutdownPath` é recusado com o motivo: o kit não adivinha como desligar. Nunca lança.
 * @returns {Promise<{ok:true, stopped:boolean} | {ok:false, reason:string}>} `stopped:false` = nada vivo para desligar.
 */
export async function stopCommand(name, { registryUrl, bundled, manifest, log = () => {} } = {}) {
  let local;
  try { local = bundled ?? bundledManifest(); }
  catch (e) { return { ok: false, reason: `manifest embarcado ilegível: ${e.message}` }; }
  if (!(local.engines ?? []).some((e) => e.name === name)) { return { ok: false, reason: semMotor(local, name, "stop") }; }
  return stopEngine(name, { registryUrl, manifest, log });
}
