// engine-kit/diagnose.mjs — diagnóstico SOMENTE LEITURA de vida e de ponteiro, usado pelo doctor.
// Não sobe, não derruba e não fala com o motor: lê o runtime que o motor anuncia e o `cli.json`
// que ele publica (CONTRATO-MOTOR §4). Nunca lança.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { readRuntime } from "./lifecycle.mjs";
import { resolve, platformReason } from "./resolve.mjs";
import { satisfiesPin, installedVersion, hashTree, FILES_MANIFEST, LOCK_STALE_MS } from "./provision.mjs";
import { pinOf, readTrust, firstContactKeys } from "./trust.mjs";

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

/**
 * Sobras que o `provision` deixa quando extração, swap ou remoção falham: `stage-<versão>`, o artefato (`.tgz` e `.part`) e
 * `<bin>.old-<pid>`. Com `provision.lock` fresco há instalação em curso: nada é sobra.
 */
export function leftovers(engine) {
  const bin = join(engine.homeDir, engine.install.extractTo ?? "bin");
  const lock = join(engine.homeDir, "provision.lock");
  try {
    const pid = Number(readFileSync(lock, "utf8"));
    if (Date.now() - statSync(lock).mtimeMs < LOCK_STALE_MS || (pid > 0 && (process.kill(pid, 0), true))) return [];
  } catch (e) { if (e.code === "EPERM") return []; }
  const ls = (dir, isLeft) => { try { return readdirSync(dir).filter(isLeft).map((n) => join(dir, n)); } catch { return []; } };
  const asset = engine.assetName;
  return [
    ...ls(engine.homeDir, (n) => n.startsWith("stage-") || n === asset || n === `${asset}.part`),
    ...ls(dirname(bin), (n) => n.startsWith(`${basename(bin)}.old-`)),
  ];
}

/** Hooks do neural-link no config global: um `_dispatcher-<Evento>.json` por evento (convenção do próprio motor, gravada pelo `install()`). */
function hooksOf() {
  const dir = join(homedir(), ".copilot", "hooks");
  try {
    const events = readdirSync(dir).filter((n) => n.startsWith("_dispatcher-") && n.endsWith(".json")).map((n) => n.slice(12, -5));
    return { registered: events.length > 0, events };
  } catch { return { registered: false, events: [] }; }
}

export const SEM_ACAO = ["OK", "SELF-MANAGED", "FIXADO", "SEM-BUILD"];

/** Raiz estável das conferências de artefato; o `verify-release` põe aqui o asset baixado. */
export const verifyRoot = () => join(process.env.LOCALAPPDATA || join(homedir(), ".cache"), "engine-kit", "verify");

/**
 * Entradas do cache de conferência (`verifyRoot`) mais velhas que o lock de instalação: um `fetch` em curso escreve agora, e o cache se refaz sob demanda.
 * @returns {string[]} caminhos a remover.
 */
export function staleVerify(now = Date.now()) {
  const root = verifyRoot();
  let names;
  try { names = readdirSync(root); } catch { return []; }
  return names.map((n) => join(root, n)).filter((p) => { try { return now - statSync(p).mtimeMs > LOCK_STALE_MS; } catch { return false; } });
}

/**
 * Confere a pasta instalada contra os hashes gravados na extração: arquivo alterado ou sumido é ADULTERADO.
 * Arquivos novos não contam (o motor pode criar estado dentro da pasta). Instalação anterior ao registro volta SEM-REGISTRO.
 * Nunca lança.
 * @returns {{state:"OK"|"ADULTERADO"|"SEM-REGISTRO"|"ILEGÍVEL", detail:string, changed?:string[], missing?:string[]}}
 */
export function verifyInstall(engine) {
  const bin = join(engine.homeDir, engine.install.extractTo ?? "bin");
  let expected;
  try { expected = JSON.parse(readFileSync(join(bin, FILES_MANIFEST), "utf8")); }
  catch (e) { return e.code === "ENOENT" ? { state: "SEM-REGISTRO", detail: "instalação anterior ao registro de hashes: reprovisionar para poder conferir" } : { state: "ILEGÍVEL", detail: `registro de hashes corrompido: ${e.message}` }; }
  let actual;
  try { actual = hashTree(bin); } catch (e) { return { state: "ILEGÍVEL", detail: `não consegui ler ${bin}: ${e.message}` }; }
  const missing = Object.keys(expected).filter((f) => !(f in actual));
  const changed = Object.keys(expected).filter((f) => f in actual && actual[f] !== expected[f]);
  return missing.length || changed.length
    ? { state: "ADULTERADO", detail: [...changed.map((f) => `alterado: ${f}`), ...missing.map((f) => `ausente: ${f}`)].join("; "), changed, missing }
    : { state: "OK", detail: `${Object.keys(expected).length} arquivo(s) conferem` };
}

/**
 * Concilia os motores do manifest com o disco, sem baixar nem alterar nada (o que o `engine-kit doctor` mostra).
 * Estados: OK, AUSENTE, DESATUALIZADO, FIXADO, FORA DO PIN, ILEGÍVEL, SELF-MANAGED, SEM-BUILD (motor sem build para esta plataforma), ERRO. Nunca lança.
 * @param {{only?:string, local?:boolean, verify?:boolean, registryUrl?:string, manifest?:object}=} opts `local` usa o manifest em vez do publicado;
 *        `verify` confere os hashes dos arquivos instalados (estado ADULTERADO); `manifest` default = o embarcado no pacote.
 * @returns {Promise<{ok:true, rows:object[]} | {ok:false, reason:string}>}
 */
export async function diagnoseEngines({ only = null, local = false, verify = false, registryUrl, manifest } = {}) {
  try {
    manifest ??= JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    readTrust();
  } catch (e) { return { ok: false, reason: e.message }; }
  const names = (manifest.engines ?? []).map((e) => e.name).filter((n) => !only || n === only);
  if (only && names.length === 0) { return { ok: false, reason: `motor "${only}" não existe no manifest` }; }

  const rows = [];
  for (const name of names) {
    // `refresh`: diagnóstico com cache velho mente — dizer "atualizado" olhando um descritor vencido é pior do que não diagnosticar.
    const opts = { allowNetwork: !local, manifest: local ? manifest : undefined, refresh: !local, registryUrl };
    let r = await resolve(name, opts);
    const latest = r.engine?.version, pin = r.ok && r.engine.status !== "self-managed" && pinOf(name);
    if (pin && pin !== latest) { r = await resolve(name, { ...opts, version: pin }); }
    if (!r.ok) { rows.push({ name, state: "ERRO", detail: r.reason }); continue; }

    const engine = r.engine;
    const present = existsSync(join(engine.homeDir, engine.install.entry));
    const inst = present ? installedVersion(join(engine.homeDir, engine.install.extractTo ?? "bin")) : null;

    let state, detail, semBuild;
    if (engine.status === "self-managed") {
      // O doctor não opina sobre a versão: olhar o disco pelo caminho do manifest daria "ausente" para um motor instalado em outro lugar.
      state = "SELF-MANAGED"; detail = `v${engine.version} no registry — atualiza pelo próprio updater`;
    } else if ((semBuild = platformReason(engine))) {
      state = "SEM-BUILD"; detail = semBuild;
    } else if (pin && inst === pin) {
      state = "FIXADO"; detail = `v${pin} fixado (registry v${latest}) → engine-kit unpin ${name} volta a atualizar`;
    } else if (!present) {
      state = "AUSENTE"; detail = `baixar v${engine.version}`;
    } else if (!inst) {
      state = "ILEGÍVEL"; detail = "instalado, mas package.json ausente/corrompido → reprovisionar";
    } else if (pin) {
      state = "FORA DO PIN"; detail = `v${inst} → v${pin} fixada`;
    } else if (satisfiesPin(inst, engine.version)) {
      state = "OK"; detail = `v${inst} satisfaz o pin v${engine.version} → reusar`;
    } else {
      state = "DESATUALIZADO"; detail = `v${inst} → v${engine.version}`;
    }
    let integrity;
    if (verify && inst && engine.status !== "self-managed") {
      integrity = verifyInstall(engine);
      if (integrity.state === "ADULTERADO") { state = "ADULTERADO"; detail = `v${inst} em disco difere do que foi extraído (${integrity.detail}) → doctor --fix reinstala`; }
    }
    const warns = [];
    if (!local && engine.offline) warns.push(engine.staleCache ? "registry fora do ar: descritor do cache vencido" : "registry não consultado nesta execução");
    const known = readTrust()[name]?.publicKey;
    if (known && engine.install.publicKey && known !== engine.install.publicKey && !engine.install.rotation) warns.push("chave do registry ≠ chave gravada em trust.json e sem rotação assinada: o próximo ensure/--fix aborta");
    const first = !known && !registryUrl && firstContactKeys(name)?.[name];
    if (first && engine.install.publicKey && first !== engine.install.publicKey && !engine.install.rotation) warns.push("chave do registry ≠ chave embarcada no kit: o próximo ensure/--fix aborta já na primeira instalação (rotação chega com npx engine-kit@latest)");
    const left = engine.status === "self-managed" ? [] : leftovers(engine);
    if (left.length) warns.push(`${left.length} sobra(s) de instalação interrompida em ${engine.homeDir}: doctor --fix as remove`);
    rows.push({ name, state, detail, warns, integrity, engine, pin, left, hooks: name === "neural-link" ? hooksOf() : undefined, needsWork: !SEM_ACAO.includes(state) });
  }
  return { ok: true, rows };
}

/** Linha de `diagnoseEngines` no formato do `engine-kit doctor --json`. */
export function engineView({ name, state, detail, warns, pin, engine, hooks, integrity }) {
  return {
    name, state, detail, warns: warns ?? [], pin: pin || null,
    ...(engine && engine.status !== "self-managed" ? { life: lifeOf(engine), pointer: pointerOf(engine), stoppable: Boolean(engine.runtime?.shutdownPath) } : {}),
    ...(hooks ? { hooks } : {}),
    ...(integrity ? { integrity: { state: integrity.state, detail: integrity.detail } } : {}),
  };
}
