// engine-kit/diagnose.mjs — diagnóstico SOMENTE LEITURA de vida e de ponteiro, usado pelo doctor.
// Não sobe, não derruba e não fala com o motor: lê o runtime que o motor anuncia e o `cli.json`
// que ele publica (CONTRATO-MOTOR §4). Nunca lança.
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { readRuntime } from "./lifecycle.mjs";

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
};

/**
 * Vida do motor segundo o arquivo de runtime que ele declara: pid vivo, porta e idade do heartbeat.
 * Estados: SEM-DECLARAÇÃO (o registry não declara arquivo de runtime), PARADO (sem runtime),
 * VIVO (pid existe), ÓRFÃO (runtime aponta para pid que não existe mais).
 * @returns {{state:string, detail:string}}
 */
export function lifeOf(engine, now = Date.now()) {
  const rt = engine.runtime;
  if (!rt?.runtimeFile) { return { state: "SEM-DECLARAÇÃO", detail: rt?.transport ? `transporte ${rt.transport}, sem arquivo de runtime` : "motor sem bloco runtime" }; }
  const data = readRuntime(engine);
  if (!data) { return { state: "PARADO", detail: `sem ${rt.runtimeFile}` }; }
  let age = "";
  try {
    const ms = now - statSync(join(engine.homeDir, rt.runtimeFile)).mtimeMs;
    const limit = rt.heartbeatMs ? ` (limite ${Math.round((rt.heartbeatMs * 3) / 1000)}s)` : "";
    age = `, runtime atualizado há ${Math.round(ms / 1000)}s${limit}`;
  } catch { /* o arquivo sumiu entre a leitura e o stat */ }
  const where = `pid ${data.pid ?? "?"}${data.port ? `, porta ${data.port}` : ""}${age}`;
  return data.pid && alive(data.pid)
    ? { state: "VIVO", detail: where }
    : { state: "ÓRFÃO", detail: `${where}; o pid não existe mais` };
}

/**
 * Ponteiro `<home>/cli.json`: todo caminho absoluto que o motor publica precisa existir, e o kit
 * avisa quando o ponteiro vive fora da instalação que ele provisionou.
 * Estados: AUSENTE, ILEGÍVEL, QUEBRADO (algum caminho não existe), FORA-DA-INSTALAÇÃO, OK.
 * @returns {{state:string, detail:string}}
 */
export function pointerOf(engine) {
  const file = join(engine.homeDir, "cli.json");
  if (!existsSync(file)) { return { state: "AUSENTE", detail: "o motor ainda não publicou o ponteiro" }; }
  let data;
  try { data = JSON.parse(readFileSync(file, "utf8")); }
  catch { return { state: "ILEGÍVEL", detail: `${file} não é JSON válido` }; }
  const paths = Object.entries(data).filter(([, v]) => typeof v === "string" && isAbsolute(v));
  const missing = paths.filter(([, v]) => !existsSync(v)).map(([k]) => k);
  if (missing.length) { return { state: "QUEBRADO", detail: `aponta para caminho inexistente: ${missing.join(", ")}` }; }
  const binDir = join(engine.homeDir, engine.install.extractTo ?? "bin");
  const outside = paths.filter(([k, v]) => {
    const rel = relative(binDir, v);
    return k !== "node" && (rel.startsWith("..") || isAbsolute(rel));
  });
  return outside.length
    ? { state: "FORA-DA-INSTALAÇÃO", detail: `${outside.map(([k]) => k).join(", ")} fora de ${binDir}` }
    : { state: "OK", detail: `${paths.length} caminho(s) existem` };
}
