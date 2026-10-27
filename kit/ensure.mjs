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
import { readFileSync } from "node:fs";
import { resolve } from "./resolve.mjs";
import { provision } from "./provision.mjs";
import { shutdown } from "./lifecycle.mjs";

const BUNDLED_MANIFEST = new URL("../manifest.json", import.meta.url);

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
 * @returns {Promise<{ok:true, entryPath:string, version:string, kind:string, reused?:boolean, signed?:boolean} | {ok:false, reason:string}>}
 */
export async function ensureCommand(name, { version, registryUrl, bundled, manifest, fetcher, log = () => {} } = {}) {
  let local;
  try { local = bundled ?? bundledManifest(); }
  catch (e) { return { ok: false, reason: `manifest embarcado ilegível: ${e.message}` }; }

  const pinned = (local.engines ?? []).find((e) => e.name === name);
  if (!pinned) {
    return { ok: false, reason: `motor "${name}" não está no manifest deste engine-kit → atualize o kit (npx engine-kit@latest ensure ${name})` };
  }
  const publicKey = pinned.install?.publicKey;
  if (!publicKey) {
    return { ok: false, reason: `${name}: o manifest embarcado não traz publicKey → sem chave do primeiro contato não instalo (ABORT)` };
  }

  // refresh: instalar quer a verdade do registry, não um descritor de cache.
  const r = await resolve(name, { version, registryUrl, refresh: true, ...(manifest ? { manifest } : {}) });
  if (!r.ok) { return { ok: false, reason: r.reason }; }

  const p = await provision(r.engine, {
    log,
    trustedKeys: { [name]: publicKey },
    ...(fetcher ? { fetcher } : {}),
    // Windows: arquivo em uso não se sobrescreve. Derruba o daemon pelo shutdownPath que o registry declara.
    onBeforeReplace: async () => {
      const s = await shutdown(r.engine, { log });
      if (!s.ok) { log(`aviso: ${s.reason} — o swap pode falhar com o motor vivo`); }
    },
  });
  if (!p.ok) {
    // Rotação legítima de chave chega ao registry antes de chegar a este pacote: a saída é o kit novo.
    const hint = /FIXADA|não declara publicKey/.test(p.reason) ? ` — se a chave foi rotacionada de propósito, rode npx engine-kit@latest ensure ${name}` : "";
    return { ok: false, reason: p.reason + hint };
  }
  return { ok: true, entryPath: p.entryPath, version: p.version, kind: r.engine.kind, reused: p.reused === true, signed: p.signed };
}
