// engine-kit/inspect.mjs — verbos de leitura do CLI (`history`, `check`, `url`) e o relatório do `doctor --report`.
// Só lêem: não instalam, não sobem nem derrubam motor. Devolvem `{ ok:false, reason }` em vez de lançar; a exceção é `satisfiesRange`, que lança em faixa desconhecida.
// Importáveis como `engine-kit/kit/inspect.mjs` (ver "Verbos como API" no README).
import { readFileSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { historyPath, cmpVer, readTrust, trustPath, embeddedManifest, pinOf } from "./trust.mjs";
import { diagnoseEngines, detailLines, pointerOf } from "./diagnose.mjs";
import { resolve, fill, platformReason } from "./resolve.mjs";
import { ownVersion } from "./update.mjs";
import { discover } from "./client.mjs";

/**
 * `engine-kit history [motor]`: as trocas de versão gravadas em `history.jsonl`, da mais antiga à mais nova.
 * Arquivo ausente é histórico vazio; linha ilegível é erro com o número dela (nada é mostrado pela metade).
 * @param {string=} name filtra um motor.
 * @returns {{ok:true, entries:{ts:string, engine:string, from:string|null, to:string, via:string}[]} | {ok:false, reason:string}}
 */
export function historyCommand(name) {
  const file = historyPath();
  let text;
  try { text = readFileSync(file, "utf8"); }
  catch (e) { return e.code === "ENOENT" ? { ok: true, entries: [] } : { ok: false, reason: `não consegui ler ${file}: ${e.message}` }; }
  const entries = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (!line.trim()) { continue; }
    try { entries.push(JSON.parse(line)); }
    catch { return { ok: false, reason: `${file}: linha ${i + 1} ilegível → corrija ou apague essa linha` }; }
  }
  return { ok: true, entries: name ? entries.filter((e) => e.engine === name) : entries };
}

/**
 * `version` está na `range`? Faixas: `>=`, `>`, `<=`, `<`, `=` (ou só x.y.z) e `^x.y.z` (mesma major; em 0.x a mesma minor; em 0.0.x exata), sempre com x.y.z.
 * @throws {Error} faixa não reconhecida: nunca ignorada.
 */
export function satisfiesRange(version, range) {
  const m = /^\s*(>=|<=|>|<|=|\^)?\s*(\d+)\.(\d+)\.(\d+)\s*$/.exec(typeof range === "string" ? range : "");
  if (!m) { throw Error(`faixa não reconhecida: ${JSON.stringify(range)} (aceito: >=, >, <=, <, = ou ^ seguidos de x.y.z)`); }
  const [, op = "=", a, b, c] = m, cmp = cmpVer(version, `${a}.${b}.${c}`);
  if (op === "^") {
    const [va, vb] = String(version).split(".");
    return cmp >= 0 && va === a && (a !== "0" || (vb === b && (b !== "0" || cmp === 0)));
  }
  return { ">=": cmp >= 0, ">": cmp > 0, "<=": cmp <= 0, "<": cmp < 0, "=": cmp === 0 }[op];
}

/**
 * `engine-kit check <manifesto>`: confere o bloco `engines` do manifesto de um plugin (`{ "<motor>": "<faixa>" }`) contra o que está instalado, sem rede.
 * Estados por motor: OK, FORA-DA-FAIXA, AUSENTE, DESCONHECIDO (fora do manifest do kit), NAO-VERIFICAVEL (self-managed), FAIXA-INVALIDA, ERRO.
 * @param {string} file caminho do manifesto do plugin.
 * Com `rede`, consulta o registry e, para o motor ausente ou fora da faixa, diz se a versão publicada satisfaz a faixa (`registry`, `registrySatisfies`):
 * é o que o `ensure --de` instalaria. Motor fixado (pin) não tem versão publicada para comparar, então não recebe esses campos.
 * @param {{manifest?:object, rede?:boolean, registryUrl?:string}=} opts `manifest` = manifest dos motores no lugar do embarcado (testes).
 * @returns {Promise<{ok:boolean, manifest:string, engines:{name:string, range:*, installed:string|null, state:string, satisfied:boolean, detail:string, registry?:string, registrySatisfies?:boolean}[]} | {ok:false, reason:string}>}
 */
export async function checkCommand(file, { manifest, rede, registryUrl } = {}) {
  let block;
  try { block = JSON.parse(readFileSync(file, "utf8"))?.engines; }
  catch (e) { return { ok: false, reason: `não consegui ler ${file}: ${e.message}` }; }
  if (!block || typeof block !== "object" || Array.isArray(block)) { return { ok: false, reason: `${file}: sem bloco "engines" (esperado { "<motor>": "<faixa>" }, ex.: { "embed-house": ">=1.0.0" })` }; }
  const diag = await diagnoseEngines({ local: !rede, manifest, registryUrl });
  if (!diag.ok) { return { ok: false, reason: diag.reason }; }
  const engines = Object.entries(block).map(([name, range]) => {
    const row = diag.rows.find((r) => r.name === name);
    const out = (state, detail, installed = null) => {
      const o = { name, range, installed, state, satisfied: state === "OK", detail };
      const publicada = rede && !row?.pin && ["AUSENTE", "FORA-DA-FAIXA"].includes(state) ? row.engine?.version : null;
      if (!publicada) { return o; }
      const registrySatisfies = satisfiesRange(publicada, range);
      return { ...o, registry: publicada, registrySatisfies, detail: `${detail} | registry v${publicada} ${registrySatisfies ? "satisfaz: ensure --de instala" : "NÃO satisfaz: ensure --de reprova, ajuste a faixa ou use --version"}` };
    };
    try { satisfiesRange("0.0.0", range); } catch (e) { return out("FAIXA-INVALIDA", e.message); }
    if (!row) { return out("DESCONHECIDO", `"${name}" não existe no manifest deste engine-kit → atualize o kit (npx engine-kit@latest ensure ${name})`); }
    if (row.state === "ERRO") { return out("ERRO", row.detail); }
    if (row.state === "SELF-MANAGED") { return out("NAO-VERIFICAVEL", "self-managed: instala e atualiza pelo próprio updater, o kit não lê a versão instalada"); }
    if (!row.installed) { return out("AUSENTE", `não instalado (${row.state}: ${row.detail}) → engine-kit ensure ${name}`); }
    return satisfiesRange(row.installed, range)
      ? out("OK", `v${row.installed} satisfaz ${range}`, row.installed)
      : out("FORA-DA-FAIXA", `v${row.installed} não satisfaz ${range} → engine-kit ensure ${name} [--version x.y.z]`, row.installed);
  });
  return { ok: engines.every((e) => e.satisfied), manifest: file, engines };
}

/**
 * `engine-kit trust [motor]`: o que o kit guarda em `trust.json` por motor (chave pública do primeiro contato, de onde veio, maior versão vista e pin),
 * se a chave bate com a do manifest embarcado e se o arquivo e a cópia `.bak` estão legíveis. Só lê: nada é gravado nem restaurado.
 * Mostra só chave PÚBLICA. Arquivo ilegível devolve o motivo do `readTrust` (que já diz como restaurar), junto com o estado do `.bak`.
 * @param {string=} name filtra um motor.
 * @param {{bundled?:object}=} opts `bundled` = manifest embarcado (testes).
 * @returns {{ok:boolean, file:string, backup:{exists:boolean, readable:boolean}, engines:object[], reason?:string}}
 */
export function trustCommand(name, { bundled } = {}) {
  const file = trustPath(), bak = `${file}.bak`;
  const backup = { exists: existsSync(bak), readable: false };
  if (backup.exists) { try { backup.readable = typeof JSON.parse(readFileSync(bak, "utf8")) === "object"; } catch { /* .bak ilegível */ } }
  let store;
  try { store = readTrust(); } catch (e) { return { ok: false, file, backup, engines: [], reason: e.message }; }
  let known;
  try { known = (bundled ?? embeddedManifest()).engines ?? []; } catch (e) { return { ok: false, file, backup, engines: [], reason: `manifest embarcado ilegível: ${e.message}` }; }
  if (name && !(name in store) && !known.some((e) => e.name === name)) { return { ok: false, file, backup, engines: [], reason: `motor "${name}" não está no trust.json nem no manifest deste engine-kit → atualize o kit (npx engine-kit@latest trust)` }; }
  const names = name ? [name] : [...new Set([...Object.keys(store), ...known.map((e) => e.name)])];
  const engines = names.map((n) => {
    const e = store[n] ?? {}, embedded = known.find((k) => k.name === n)?.install?.publicKey ?? null;
    const state = !e.publicKey ? "SEM-CONTATO" : embedded && embedded.toLowerCase() !== String(e.publicKey).toLowerCase() ? "CHAVE-DIFERENTE" : "OK";
    return { name: n, state, publicKey: e.publicKey ?? null, source: e.source ?? null, firstSeen: e.firstSeen ?? null, maxVersion: e.maxVersion ?? null, pin: e.pin ?? null, embeddedKey: embedded };
  });
  return { ok: true, file, backup, engines };
}

/**
 * `engine-kit trust --restaurar`: devolve o `trust.json` a partir da cópia `.bak` quando o arquivo principal está ilegível. A cópia é validada antes
 * (JSON de objeto) e a troca é atômica (tmp + rename). Recusa se o principal está legível ou ausente (nada a restaurar) e se a cópia também falha.
 * A cópia guarda a última escrita que o kit tentou, mesmo a que chegou ao chamador como falha: confira os motores devolvidos em `restored`.
 * @returns {{ok:true, file:string, restored:string[]} | {ok:false, reason:string}}
 */
export function trustRestoreCommand() {
  const file = trustPath(), bak = `${file}.bak`;
  try { readTrust(); return { ok: false, reason: `${file} está legível ou ausente: nada a restaurar` }; } catch { /* ilegível: segue para a cópia */ }
  let text, restored;
  try {
    text = readFileSync(bak, "utf8");
    const o = JSON.parse(text);
    if (!o || typeof o !== "object" || Array.isArray(o)) { throw Error("não é um objeto"); }
    restored = Object.keys(o);
  } catch (e) { return { ok: false, reason: `a cópia ${bak} está ausente ou ilegível (${e.message}): nada foi gravado` }; }
  try { writeFileSync(`${file}.tmp`, text); renameSync(`${file}.tmp`, file); }
  catch (e) { return { ok: false, reason: `não consegui gravar ${file}: ${e.message}` }; }
  return { ok: true, file, restored };
}

/**
 * `engine-kit path <motor>`: o caminho do executável de um motor instalado, sem rede, sem subir nada e sem trocar versão. Mostra também o estado do
 * ponteiro `cli.json` que o motor publica. Motor não instalado, self-managed ou fora do manifest é recusado com o motivo, nunca com um caminho inventado.
 * @param {string} name motor.
 * @param {{bundled?:object}=} opts `bundled` = manifest embarcado (testes).
 * @returns {Promise<{ok:true, name:string, path:string, pointer:{state:string, detail:string}} | {ok:false, reason:string}>}
 */
export async function pathCommand(name, { bundled } = {}) {
  let local;
  try { local = bundled ?? embeddedManifest(); } catch (e) { return { ok: false, reason: `manifest embarcado ilegível: ${e.message}` }; }
  if (!(local.engines ?? []).some((e) => e.name === name)) { return { ok: false, reason: `motor "${name}" não está no manifest deste engine-kit → atualize o kit (npx engine-kit@latest path ${name})` }; }
  const r = await resolve(name, { allowNetwork: false, manifest: local });
  if (!r.ok) { return { ok: false, reason: r.reason }; }
  const e = r.engine, path = join(e.homeDir, e.install.entry);
  if (e.status === "self-managed") { return { ok: false, reason: `${name} é self-managed: o kit não o instala nem sabe onde o próprio updater o pôs` }; }
  if (!existsSync(path)) { return { ok: false, reason: `${name} não está instalado (falta ${path}) → engine-kit ensure ${name}` }; }
  return { ok: true, name, path, pointer: pointerOf(e) };
}

const releaseUrl = (repo, tag, version) => repo && tag ? `https://github.com/${repo}/releases/tag/${fill(tag, { version, platform: process.platform, arch: process.arch })}` : null;

/** O `info` de uma entrada de `manifest.apps`: o kit não instala app (só `fetch`), então não há versão instalada nem estado de diagnóstico; `app:true` marca a diferença. */
function infoDeApp(a) {
  let pin;
  try { pin = pinOf(a.name); } catch (e) { return { ok: false, reason: e.message }; }
  return {
    ok: true, name: a.name, kind: "app", app: true, summary: a.summary, version: a.version, installed: null, state: "APP", detail: `o kit baixa e confere, não instala → engine-kit fetch ${a.name}`, pin: pin || null,
    platforms: a.platforms ?? [], supported: platformReason(a) === null, selfManaged: false, release: releaseUrl(a.release?.repo, a.release?.tag, a.version), warns: [],
  };
}

/**
 * `engine-kit info <motor|app>`: o que o kit sabe de um motor num lugar só — descritor do manifest embarcado, versão instalada, estado do diagnóstico, pin, plataformas e release.
 * Nome de `manifest.apps` devolve o descritor do app (`kind:"app"`, `app:true`, `installed:null`, `state:"APP"`) e o pin do trust.json.
 * Sem rede e sem gravar: `version` é a do manifest deste kit, não a publicada agora (para essa, `doctor` ou `check --rede`).
 * @param {string} name motor ou app.
 * @param {{bundled?:object}=} opts `bundled` = manifest embarcado (testes).
 * @returns {Promise<{ok:true, name:string, kind:string, summary:string, version:string, installed:string|null, state:string, detail:string, pin:string|null, platforms:string[], supported:boolean, selfManaged:boolean, release:string|null, warns:string[], quarantined?:{version:string}, app?:true} | {ok:false, reason:string}>}
 */
export async function infoCommand(name, { bundled } = {}) {
  let local;
  try { local = bundled ?? embeddedManifest(); } catch (e) { return { ok: false, reason: `manifest embarcado ilegível: ${e.message}` }; }
  if (!(local.engines ?? []).some((e) => e.name === name)) {
    const app = (local.apps ?? []).find((a) => a.name === name);
    return app ? infoDeApp(app) : { ok: false, reason: `motor "${name}" não está no manifest deste engine-kit → atualize o kit (npx engine-kit@latest info ${name})` };
  }
  const d = await diagnoseEngines({ only: name, local: true, manifest: local });
  if (!d.ok) { return d; }
  const { state, detail, installed, pin, engine: e, warns, quarantined } = d.rows[0];
  if (!e) { return { ok: false, reason: detail }; }
  return {
    ok: true, name, kind: e.kind, summary: e.summary, version: e.version, installed: installed ?? null, state, detail, pin: pin || null, platforms: e.platforms ?? [],
    supported: platformReason(e) === null, selfManaged: e.status === "self-managed", release: releaseUrl(e.install.repo, e.install.tag, e.version), warns: warns ?? [], ...(quarantined ? { quarantined } : {}),
  };
}

/**
 * `engine-kit url <motor>`: o endereço do daemon vivo, lido do anúncio dele (`discover`). Só url, versão e pid: o `shutdownToken` do anúncio não sai daqui.
 * @returns {Promise<{ok:true, name:string, url:string, version:string|null, pid:number|null} | {ok:false, reason:string}>}
 */
export async function urlCommand(name) {
  const d = await discover(name);
  return d.ok ? { ok: true, name, url: d.url, version: d.version ?? null, pid: d.pid ?? null } : { ok: false, reason: d.reason };
}

/**
 * `engine-kit doctor --report`: texto colável para suporte (kit, Node, plataforma, variáveis ENGINE_KIT_*, estado de cada motor, a última troca de versão dele, sobras e hooks).
 * Só o que o diagnóstico e o histórico já calculam: o anúncio (runtime) entra só como pid e porta; token, chave privada, caminho de chave e `--registry-url` (pode levar credencial) ficam de fora.
 * @param {{only?:string, local?:boolean, verify?:boolean, registryUrl?:string}=} opts as mesmas do `diagnoseEngines`.
 * @returns {Promise<{ok:true, text:string} | {ok:false, reason:string}>}
 */
export async function reportCommand({ only, local, verify, registryUrl } = {}) {
  const diag = await diagnoseEngines({ only, local, verify, registryUrl });
  if (!diag.ok) { return { ok: false, reason: diag.reason }; }
  const env = (n) => process.env[n] ?? "(não definido)";
  const hist = historyCommand();
  const lastSwap = (name) => {
    if (!hist.ok) { return `indisponível (${hist.reason})`; }
    const e = hist.entries.findLast((x) => x.engine === name);
    return e ? `${e.from ?? "(nenhuma)"} → ${e.to} (${e.via}) em ${e.ts}` : "nenhuma registrada";
  };
  const w = Math.max(...diag.rows.map((r) => r.name.length));
  const lines = [
    `engine-kit v${ownVersion()}`, `node: ${process.version}`, `plataforma: ${process.platform} ${process.arch}`,
    `ENGINE_KIT_NO_AUTO_UPDATE: ${env("ENGINE_KIT_NO_AUTO_UPDATE")}`, `ENGINE_KIT_HOME: ${env("ENGINE_KIT_HOME")}`,
    `registry: ${local ? "manifest LOCAL" : registryUrl ? "próprio (--registry-url)" : "publicado"}`, "", "motores:",
  ];
  for (const r of diag.rows) {
    lines.push(`  ${r.name.padEnd(w)}  ${r.state}  ${r.detail}`, ...(await detailLines(r)).map((l) => `      ${l}`), `      última troca: ${lastSwap(r.name)}`);
    if (r.left?.length) { lines.push(`      sobras: ${r.left.length} (${r.left.map((p) => basename(p)).join(", ")})`); }
  }
  return { ok: true, text: lines.join("\n") };
}

/**
 * `engine-kit update <motor>`: pede ao updater do daemon vivo (`runtime.updatePath`) que se atualize; o motor confere a release
 * por conta própria. O token do anúncio vai só no cabeçalho do pedido e nunca volta no resultado.
 * @param {string} name motor com `runtime.updatePath`.
 * @param {{check?:boolean}} [opts] `check`: só compara as versões, sem baixar nem aplicar.
 * @returns {Promise<{ok:true, name:string, state:string, detail:string, current?:string, available?:string} | {ok:false, reason:string}>}
 */
export async function updateCommand(name, { check = false } = {}) {
  const d = await discover(name);
  if (!d.ok) { return { ok: false, reason: d.reason }; }
  const rt = d.engine.runtime;
  const file = join(d.engine.homeDir, rt.runtimeFile);
  if (!rt.updatePath) { return { ok: false, reason: `${name} não tem updater próprio (runtime.updatePath); o kit o atualiza: engine-kit ensure ${name}` }; }
  if (!d.shutdownToken) { return { ok: false, reason: `${name}: o anúncio ${file} não traz ${rt.shutdownTokenField}; sem ele o motor recusa o pedido` }; }
  let res;
  try {
    res = await fetch(d.url + rt.updatePath, {
      method: "POST", signal: AbortSignal.timeout(120000),
      headers: { [rt.shutdownTokenHeader]: d.shutdownToken, ...(check ? { "content-type": "application/json" } : {}) },
      ...(check ? { body: JSON.stringify({ check: true }) } : {}),
    });
  } catch (e) { return { ok: false, reason: `${name} sem resposta em ${d.url}${rt.updatePath} (${e?.cause?.code ?? e.message}) → engine-kit ensure ${name}` }; }
  const j = (await res.json().catch(() => null)) ?? {};
  if (res.status !== 200 && res.status !== 202) {
    const dica = res.status === 401 || res.status === 403 ? `; o token vem do anúncio ${file}` : "";
    return { ok: false, reason: `${name} respondeu HTTP ${res.status}${j.code ? ` ${j.code}` : ""}${j.message ? `: ${j.message}` : ""}${dica}` };
  }
  const { current, available } = j;
  const state = res.status === 202 ? "applying" : j.state ?? (j.updateAvailable ? "available" : "up-to-date");
  const detail = state === "applying" ? `troca agendada para v${j.version}; o motor reinicia sozinho e anuncia o novo pid em ${rt.runtimeFile}`
    : state === "available" ? `v${current} instalada; v${available} disponível` : `em dia (v${current ?? available ?? d.version})`;
  return { ok: true, name, state, detail, ...(current ? { current } : {}), ...(available ? { available } : {}) };
}
