// engine-kit/register.mjs — registra os hooks do neural-link pelo `install()` do próprio motor.
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Roda o `install()` do próprio neural-link: grava a declaração global de cada evento em `~/.copilot/hooks/` e sela os
 * companions. Lança se o binário não traz `install.js` ou se o `install()` falha: quem chama decide o que fazer.
 * @param {string} entryPath entrypoint instalado do dispatcher.
 */
export async function registerNeuralLink(entryPath) {
  const installMod = await import(pathToFileURL(join(dirname(entryPath), "install.js")).href);
  return installMod.install({});
}
