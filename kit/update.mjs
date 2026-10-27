// engine-kit/update.mjs — o próprio kit se atualiza antes de instalar motores.
//
// `npx engine-kit` sem versão reusa o pacote que já está na cache do npx: quem rodou uma vez fica preso naquela
// versão (e no manifest embarcado dela, que é a raiz de confiança do ensure). Por isso o cli consulta a última
// versão publicada e, por padrão, roda de novo como `npx --yes engine-kit@<última>` com os mesmos argumentos. A
// versão nova vem do mesmo canal do primeiro `npx` (npm, publicação confiável com proveniência): não é confiança nova.
//
// ENGINE_KIT_NO_AUTO_UPDATE=1 desliga: o kit não se troca nem troca motor já instalado, só AVISA da versão nova.
// ENGINE_KIT_UPDATED_FROM marca o processo relançado, para não entrar em laço.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const LATEST_URL = "https://registry.npmjs.org/engine-kit/latest";

export const autoUpdateEnabled = (env = process.env) => !["1", "true", "yes"].includes(String(env.ENGINE_KIT_NO_AUTO_UPDATE ?? "").toLowerCase());

export const ownVersion = () => JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

/** true se `a` é versão estável maior que `b` (x.y.z; pré-release como 0.2.0-bootstrap.0 nunca é alvo). */
export function isNewer(a, b) {
  if (!/^\d+\.\d+\.\d+$/.test(a ?? "")) return false;
  const pa = a.split(".").map(Number), pb = String(b).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] > pb[i]; }
  return /-/.test(b);   // 0.2.0 > 0.2.0-bootstrap.0
}

async function fetchLatest() {
  const res = await fetch(LATEST_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
  return (await res.json()).version;
}

function runLatest(version, args, env) {
  // npx no Windows é npx.cmd: o spawn de .cmd exige shell. Argumentos aqui são nome de motor e flags simples.
  const r = spawnSync("npx", ["--yes", `engine-kit@${version}`, ...args], { stdio: "inherit", shell: process.platform === "win32", windowsHide: true, env });
  return r.error ? { status: 1, error: r.error.message } : { status: r.status ?? 1 };
}

/**
 * Decide e, se for o caso, executa a autoatualização. Nunca lança.
 * @returns {Promise<{action:"none"|"warn"|"relaunched", status?:number, latest?:string, message?:string}>}
 *          `relaunched` = a versão nova já rodou o comando (o chamador só repassa `status`).
 */
export async function selfUpdate(args, { env = process.env, current = ownVersion(), latest = fetchLatest, run = runLatest, log = console.error } = {}) {
  if (env.ENGINE_KIT_UPDATED_FROM) {
    log(`engine-kit atualizado: v${env.ENGINE_KIT_UPDATED_FROM} → v${current}`);
    return { action: "none" };
  }
  let v;
  try { v = await latest(); }
  catch (e) {
    log(`aviso: não consegui consultar a versão mais nova do engine-kit (${e.message}); seguindo com v${current}`);
    return { action: "none" };
  }
  if (!isNewer(v, current)) return { action: "none" };
  if (!autoUpdateEnabled(env)) {
    const message = `engine-kit v${v} disponível (você roda v${current}); ENGINE_KIT_NO_AUTO_UPDATE ligado — rode npx engine-kit@latest para atualizar`;
    log(message);
    return { action: "warn", latest: v, message };
  }
  log(`engine-kit v${v} disponível (você roda v${current}) → atualizando`);
  const r = run(v, args, { ...env, ENGINE_KIT_UPDATED_FROM: current });
  if (r.error) {
    log(`aviso: não consegui rodar engine-kit@${v} (${r.error}); seguindo com v${current}`);
    return { action: "none" };
  }
  return { action: "relaunched", status: r.status, latest: v };
}
