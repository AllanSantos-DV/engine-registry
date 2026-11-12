// engine-kit/register.mjs — registra os hooks do neural-link pelo `install()` do próprio motor.
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Roda o `install()` do próprio neural-link: grava a declaração global de cada evento em `~/.copilot/hooks/` e sela os
 * companions. Lança se o binário não traz `install.js` ou se o `install()` falha: quem chama decide o que fazer.
 * @param {string} entryPath entrypoint instalado do dispatcher.
 */
export async function registerNeuralLink(entryPath) {
  return (await installModule(entryPath)).install({});
}

/**
 * Roda o `uninstall()` do próprio neural-link, que desfaz o que o `install()` gravou. Lança se o motor instalado ainda não
 * expõe `uninstall()`: o kit não adivinha quais arquivos do config global são do motor.
 * @param {string} entryPath entrypoint instalado do dispatcher.
 */
export async function unregisterNeuralLink(entryPath) {
  const mod = await installModule(entryPath);
  if (typeof mod.uninstall !== "function") { throw new Error("o neural-link instalado não expõe uninstall(): atualize o motor (engine-kit ensure neural-link)"); }
  return mod.uninstall({});
}

const installModule = (entryPath) => import(pathToFileURL(join(dirname(entryPath), "install.js")).href);
