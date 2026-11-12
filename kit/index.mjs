// engine-kit — a dependência que as extensões importam para consumir um MOTOR.
//
// Um motor (embed-house, vox-engine, mcp-gateway…) é infraestrutura compartilhada: instala UMA vez
// por máquina, em `~/.<motor>`, e serve N consumidores. O consumidor não empacota o motor nem
// duplica a lógica de "achar ou baixar" — declara a dependência e chama `ensureEngine`.
//
//   import { ensureEngine } from "engine-kit";
//   const r = await ensureEngine("embed-house", { healthCheck: async (rt) => { ... } });
//   if (!r.available) { /* degrade sinalizado — NUNCA silencioso */ }
//
// Contrato: nenhuma função lança. Falha vira `{ ok:false | available:false, reason }` para o
// consumidor decidir (fail-loud no caller, não no kit).
export { resolve, DEFAULT_REGISTRY_URL, expandHome, target, fill } from "./resolve.mjs";
export { provision, satisfiesPin, fetchArtifact } from "./provision.mjs";
export { lifecycle, readRuntime, readFreshRuntime, shutdown, stopEngine } from "./lifecycle.mjs";
export {
  verifyBlob, signBlob, generateKeyPairHex, publicKeyFromHex, privateKeyFromHex, publicKeyHexFromPrivateHex,
  SUPPORTED_ALGORITHMS, DEFAULT_ALGORITHM, SIGNATURE_BYTES,
} from "./signature.mjs";
export { SIGNING_DIR, keyPathFor } from "./keystore.mjs";

import { resolve } from "./resolve.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { provision, satisfiesPin, installedVersion, autoUpdateEnabled } from "./provision.mjs";
import { lifecycle } from "./lifecycle.mjs";
import { pinOf } from "./trust.mjs";

/**
 * RESOLVE → PROVISION → LIFECYCLE numa chamada: o caminho que 99% dos consumidores querem.
 * @param {string} name nome do motor no registry.
 * @param {object} opts
 * @param {(runtime:object)=>Promise<object|null>} opts.healthCheck validação de saúde/protocolo (obrigatória).
 * @param {string=} opts.version versão-alvo do descritor (default: a do registry); uma instalada da mesma major e
 *        igual ou maior é reusada. Motor fixado pelo dono (`engine-kit pin`) fica na versão exata fixada; o pin só atende
 *        a versão pedida da mesma major e igual ou menor que ele (outra major, ou maior que o pin, é `available:false`).
 * @param {boolean=} opts.allowNetwork permite baixar/atualizar (default true).
 * Com `ENGINE_KIT_NO_AUTO_UPDATE` ligado (no process.env ou em `opts.env`) e sem `version`, um motor já instalado de versão menor
 *        que a do registry segue em uso e `engine.updateAvailable` traz a versão nova.
 * @param {Record<string,string>=} opts.trustedKeys chaves públicas FIXADAS pelo consumidor
 *        (`{ "<motor>": "<hex>" }`). Divergência com o registry = ABORT. Default no registry público: a chave do
 *        manifest embarcado no pacote; motor fora dele não instala sem `trustedKeys`. Com `registryUrl` próprio vale TOFU:
 *        a chave da 1ª instalação é gravada e qualquer troca posterior aborta.
 * @param {string=} opts.registryUrl URL do manifest (default: registry público; testes apontam para um local).
 * @param {(url:string,timeoutMs:number)=>Promise<Buffer>=} opts.fetcher download injetável (testes).
 * @param {()=>Promise<void>=} opts.onBeforeReplace shutdown do motor antes de sobrescrever (Windows).
 * @returns {Promise<{available:true, runtime:object, health:object, engine:object} | {available:false, reason:string}>}
 */
export async function ensureEngine(name, opts = {}) {
  const { healthCheck, version, allowNetwork = true, registryUrl, log = () => {}, bootTimeoutMs, onBeforeReplace, env, trustedKeys, refresh = false, fetcher } = opts;

  let pin;
  try { pin = pinOf(name); } catch (e) { return { available: false, reason: e.message }; }
  if (pin && version && !satisfiesPin(pin, version)) {
    return { available: false, reason: `${name} fixado em v${pin}; o consumidor pede v${version} → engine-kit unpin ${name}` };
  }
  const r = await resolve(name, { version: pin ?? version, allowNetwork, registryUrl, refresh });
  if (!r.ok) { return { available: false, reason: r.reason }; }

  const entryPath = join(r.engine.homeDir, r.engine.install.entry);
  const previous = existsSync(entryPath) ? installedVersion(join(r.engine.homeDir, r.engine.install.extractTo ?? "bin")) : null;
  const keep = !autoUpdateEnabled({ ...process.env, ...env }) && !version && !pin && previous && !satisfiesPin(previous, r.engine.version);
  let installed = previous, updateAvailable;
  if (keep) { updateAvailable = r.engine.version; }
  else {
    const p = await provision(r.engine, { log, allowNetwork, onBeforeReplace, trustedKeys, exact: Boolean(pin), ...(fetcher ? { fetcher } : {}) });
    if (!p.ok) { return { available: false, reason: p.reason }; }
    installed = p.version;
  }

  const l = await lifecycle(r.engine, entryPath, { healthCheck, log, bootTimeoutMs, env });
  if (!l.available) { return l; }

  return { ...l, engine: { ...r.engine, installedVersion: installed, ...(updateAvailable ? { updateAvailable } : {}) } };
}
