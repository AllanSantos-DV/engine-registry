// consumers/neural-link.mjs — adaptador pronto do motor `neural-link` (dispatcher de hooks).
//
// Qualquer extensão que traga hook (`.js` + companion `<hook>.neural-link.json`) importa isto e
// chama `ensureNeuralLink()` na ativação, DEPOIS de copiar seus arquivos para a pasta de hooks.
// O adaptador garante o dispatcher instalado/atualizado (achar-ou-baixar-ou-atualizar — o kit
// cuida disso) e roda o `install()` do próprio motor para que os companions recém-entregues
// virem registro REAL no `neural-link.config.json` — sem isso, o hook fica instalado mas
// nunca é chamado por nenhum evento.
//
//   import { ensureNeuralLink } from "engine-kit/consumers/neural-link.mjs";
//
//   const n = await ensureNeuralLink({ log });
//   if (!n.available) { log(`hooks desativados: ${n.reason}`); /* degrade SINALIZADO */ }
//   // n.entryPath -> caminho do dispatcher instalado (kind=cli, sem processo persistente)
//
// Contrato: nunca lança.
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureEngine } from "../kit/index.mjs";

/** Pin default: última versão do neural-link confirmada publicada no manifest deste kit. */
const DEFAULT_PIN = "0.7.6";

/**
 * Garante o dispatcher de hooks `neural-link` instalado/atualizado, e roda o `install()` dele
 * para que os companions (`<hook>.neural-link.json`) recém-entregues pela extensão virem
 * registro real no config global — o `install()` é quem lê os companions; `provision()` só
 * garante o binário no disco, ele não sabe nada sobre config de hooks.
 *
 * Sem `healthCheck`: `kind=cli` não sobe processo persistente — o kit devolve o caminho do
 * binário e sai (ver `kit/lifecycle.mjs`).
 *
 * @param {object} opts
 * @param {string=} opts.version pin de versão mínima (default: {@link DEFAULT_PIN}).
 * @param {(msg:string)=>void=} opts.log
 * @param {boolean=} opts.allowNetwork permite baixar/atualizar (default true). Com `false` e um
 *        neural-link já instalado que satisfaça o pin, reusa sem tocar rede (comportamento do
 *        próprio `provision()` — não há necessidade de um caminho manual separado: o kit já
 *        reusa QUALQUER instalação existente que satisfaça o pin antes de olhar para a rede).
 * @returns {Promise<{available:true, entryPath:string, version:string, registered:object|null}
 *                  | {available:false, reason:string}>}
 */
export async function ensureNeuralLink({ version = DEFAULT_PIN, log = () => {}, allowNetwork = true } = {}) {
  const r = await ensureEngine("neural-link", { version, allowNetwork, log });
  if (!r.available) { return r; }

  const entryPath = r.bin;
  let registered = null;
  try {
    const installMod = await import(pathToFileURL(join(dirname(entryPath), "install.js")).href);
    registered = installMod.install({});
    log(`[engine-kit] neural-link: install() rodou — ${registered.written?.length ?? 0} declarado(s), ${registered.companions?.selados?.length ?? 0} companion(s) selado(s)`);
  } catch (e) {
    // O dispatcher está presente e é invocável por evento mesmo se o `install()` falhar aqui
    // (ex.: permissão de escrita no config, layout inesperado do binário) — não travamos a
    // extensão por isso; só sinalizamos que o registro pode não ter acontecido.
    log(`[engine-kit] neural-link: install() falhou (${e?.message || e}) — companions podem não estar registrados`);
  }

  return {
    available: true,
    entryPath,
    version: r.engine?.installedVersion ?? version,
    registered,
  };
}
