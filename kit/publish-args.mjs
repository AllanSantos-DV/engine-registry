// engine-kit/publish-args.mjs — preâmbulo comum dos scripts de publicação (`update-manifest`, `verify-release`).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Falha alto: mensagem em stderr e exit 1. */
export const die = (msg) => { console.error(`FALHOU: ${msg}`); process.exit(1); };

/**
 * Lê os argumentos do processo: o alvo (`<motor>` ou `--app <nome>`) e o `manifest.json` (`--manifest <path>`, default o do repositório), já parseado.
 * Alvo ausente ou manifest ilegível terminam o processo com `die`. Com `{ all: true }`, `--all` dispensa o alvo e vira `todos:true`.
 * @param {string} usage texto de uso mostrado quando falta o alvo.
 * @param {{all?:boolean}=} opts
 * @returns {{args:string[], opt:(flag:string)=>(string|null), appName:string|null, engineName:string|null, todos:boolean, manifestPath:string, manifest:object}}
 */
export function publishArgs(usage, { all = false } = {}) {
  const args = process.argv.slice(2);
  const opt = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };
  const todos = all && args.includes("--all");
  const appName = args.includes("--app") ? opt("--app") : null;
  if (args.includes("--app") && (!appName || appName.startsWith("--"))) { die(usage); }
  const engineName = appName ? null : args[0];
  if (!todos && !appName && (!engineName || engineName.startsWith("--"))) { die(usage); }
  const manifestPath = opt("--manifest") ?? join(dirname(dirname(fileURLToPath(import.meta.url))), "manifest.json");
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch (e) { die(`manifest ilegível em ${manifestPath}: ${e.message}`); }
  return { args, opt, appName, engineName, todos, manifestPath, manifest };
}
