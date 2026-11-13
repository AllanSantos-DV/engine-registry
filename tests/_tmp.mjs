// tests/_tmp.mjs — pasta temporária dos testes: importado por todo teste, nunca deixa nada no %TEMP% da máquina.
//
// O import redireciona TEMP/TMP/TMPDIR para %LOCALAPPDATA%\engine-kit\tmp\<run>; `os.tmpdir()` (do teste, do kit e dos
// processos filhos que herdam o ambiente) passa a cair ali, e a pasta da rodada some quando o processo sai, passando
// ou falhando. Sobras de rodadas mortas à força são removidas na próxima partida.
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SOBRA_MS = 6 * 3600 * 1000;

/** Pasta-mãe das rodadas: estável, fora do %TEMP%. */
export function pastaTmpDoProduto() {
  const base = process.env.LOCALAPPDATA || join(homedir(), ".local", "share");
  return join(base, "engine-kit", "tmp");
}

const mae = pastaTmpDoProduto();
const rodada = join(mae, `${process.pid}-${Date.now()}`);

mkdirSync(mae, { recursive: true });
for (const nome of readdirSync(mae)) {
  const p = join(mae, nome);
  try { if (Date.now() - statSync(p).mtimeMs > SOBRA_MS) rmSync(p, { recursive: true, force: true }); } catch { /* outra rodada a apagou */ }
}
mkdirSync(rodada, { recursive: true });
process.env.TEMP = process.env.TMP = process.env.TMPDIR = rodada;

process.on("exit", () => {
  rmSync(rodada, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
