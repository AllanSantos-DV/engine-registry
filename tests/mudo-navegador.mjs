// mudo-navegador.mjs — preload (`node --import`) para ferramenta de fora do projeto que sobe navegador num teste.
// Todo spawn de msedge/chrome sai com --mute-audio e --headless, sem janela; cada subida vira uma linha JSON em
// ENGINE_TEST_BROWSER_LOG, que o teste confere (subiu mudo e sem janela?). syncBuiltinESMExports faz o
// `import { spawn } from "node:child_process"` da ferramenta enxergar a troca.
import cp from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { silenceBrowser } from "./silencio.mjs";

const original = cp.spawn;
cp.spawn = function (file, args, opts) {
  const s = silenceBrowser(file, Array.isArray(args) ? args : [], Array.isArray(args) ? opts : args);
  if (!s.browser) return original.apply(this, arguments);
  if (process.env.ENGINE_TEST_BROWSER_LOG) {
    appendFileSync(process.env.ENGINE_TEST_BROWSER_LOG, JSON.stringify({ file: String(file), args: s.args, windowsHide: s.opts.windowsHide }) + "\n");
  }
  return original.call(this, file, s.args, s.opts);
};
syncBuiltinESMExports();
