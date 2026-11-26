// engine-kit/ensure.mjs — `npx engine-kit ensure <motor>`: instala um motor com um comando, sem clonar o repo.
//
// O mesmo caminho do doctor --fix (resolve → provision: sha256 + Ed25519 fail-closed, lock, swap), com uma
// diferença na raiz de confiança: a chave pública do PRIMEIRO contato vem do manifest.json que viaja DENTRO deste
// pacote (publicado no npm com proveniência), não do registry baixado na hora. Ela entra como `trustedKeys`: se o
// registry servir outra chave, é ABORT já na primeira instalação — quem toma o repositório não troca a chave sem
// também publicar um engine-kit novo, e essa publicação deixa rastro público (proveniência do npm).
//
// Motor que não está no manifest deste pacote é recusado: sem a chave embarcada não há primeiro contato
// verificável, e cair no TOFU calado seria justamente o buraco que o pacote fecha. Saída: atualizar o kit.
// NUNCA lança: devolve { ok, reason } para o cli decidir o exit code.
import { readFileSync, existsSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { resolve, fill, target, expandHome, platformReason } from "./resolve.mjs";
export { platformReason };
import { provision, installedVersion, satisfiesPin } from "./provision.mjs";
import { shutdown, stopEngine } from "./lifecycle.mjs";
import { pinOf, setPin, rollbackReason } from "./trust.mjs";
export { firstContactKeys } from "./trust.mjs";
import { pointerOf, quarantineOf, quarantineWarn } from "./diagnose.mjs";
import { checkCommand, historyCommand } from "./inspect.mjs";
import { religador, vivoParaReligar, aposReligar } from "./religar.mjs";

const BUNDLED_MANIFEST = new URL("../manifest.json", import.meta.url);
const installedOf = (e) => existsSync(join(e.homeDir, e.install.entry)) ? installedVersion(join(e.homeDir, e.install.extractTo ?? "bin")) : null;

/** Manifest que viaja dentro do pacote (lança se ilegível; `embarcado` transforma em reason). */
export function bundledManifest() {
  return JSON.parse(readFileSync(BUNDLED_MANIFEST, "utf8"));
}

/** O manifest embarcado (ou o injetado por teste): `{ local }`, ou `{ reason }` quando ilegível. */
export function embarcado(bundled) {
  try { return { local: bundled ?? bundledManifest() }; }
  catch (e) { return { reason: `manifest embarcado ilegível: ${e.message}` }; }
}

/** Motores que dividem home e entrada na `platform` são o mesmo binário: a chave da instalação. */
const instalacaoDe = (e, platform) => {
  const entry = { ...e.install, ...e.install?.byPlatform?.[platform] }.entry;
  return e.home && entry ? `${expandHome(e.home)}|${entry}` : e.name;
};

/**
 * Pin do motor ou, sem ele, o de outro nome da mesma instalação (o do sufixo `-<plataforma>`); nada é gravado. Lança se o `trust.json` é ilegível.
 * @returns {{pin?:string, dono?:string}} `dono` = o nome que tem o pin gravado.
 */
export function pinDaInstalacao(local, name, platform = target()) {
  const proprio = pinOf(name);
  if (proprio) { return { pin: proprio, dono: name }; }
  const todos = local?.engines ?? [], eu = todos.find((e) => e.name === name);
  for (const e of eu ? todos : []) {
    const pin = e.name !== name && instalacaoDe(e, platform) === instalacaoDe(eu, platform) ? pinOf(e.name) : undefined;
    if (pin) { return { pin, dono: e.name }; }
  }
  return {};
}

/**
 * Pin do motor (`trust.json`, ou o de um nome da mesma instalação no manifest `local`), recusando uma `version` pedida que o contradiz.
 * @returns {{pin?:string, reason?:string}}
 */
export function pinFor(name, version, local) {
  let pin, dono;
  try { ({ pin, dono } = pinDaInstalacao(local, name)); } catch (e) { return { reason: e.message }; }
  return pin && version && version !== pin
    ? { reason: `${name} está fixado em v${pin}${dono === name ? "" : ` (por ${dono}, que divide a instalação)`} → engine-kit pin ${name} --version ${version} troca a versão fixada; engine-kit unpin ${dono} solta` }
    : { pin };
}

const AUTO_GERIDO = "é self-managed: instala e atualiza pelo próprio updater, não pelo engine-kit";

/** Recusa de motor self-managed com o caminho do instalador dele: a página da release e o `fetch`, que baixa e confere sem instalar. */
const instaladorProprio = (engine, motivo) => {
  const { repo, tag } = engine.install;
  const release = `https://github.com/${repo}/releases/tag/${fill(tag, { version: engine.version, platform: process.platform, arch: process.arch })}`;
  return `${motivo} → instalador da v${engine.version}: ${release}; engine-kit fetch ${engine.name} baixa e confere hash e assinatura sem instalar`;
};

/** `onBeforeReplace` do `provision`: derruba o daemon pelo `shutdownPath` que o registry declara, porque no Windows arquivo em uso não se sobrescreve; devolve o retorno do `shutdown`. */
export const derrubarAntes = (engine, log) => async () => {
  const s = await shutdown(engine, { log });
  if (!s.ok) { log(`aviso: ${s.reason} — o swap pode falhar com o motor vivo`); }
  return s;
};

/**
 * `engine-kit list`: os motores do manifest embarcado, a plataforma que cada um atende e o que está instalado aqui. Não usa rede. Nunca lança.
 * Com `apps`, acrescenta `apps` (os de `manifest.apps`: nome, versão, resumo, plataformas, se esta máquina é atendida e o pin do trust.json); sem ela o retorno não muda.
 * @param {{bundled?:object, platform?:string, apps?:boolean}=} opts `bundled` = manifest embarcado (testes).
 * @returns {{ok:true, platform:string, engines:{name:string, version:string, kind:string, platforms:string[], supported:boolean, installed:string|null, selfManaged:boolean}[], apps?:{name:string, version:string, summary:string, platforms:string[], supported:boolean, pin:string|null}[]} | {ok:false, reason:string}}
 */
export function listCommand({ bundled, platform = target(), apps = false } = {}) {
  const { local, reason } = embarcado(bundled);
  if (!local) { return { ok: false, reason }; }
  const engines = (local.engines ?? []).map((e) => {
    let installed = null;
    const install = { ...e.install, ...e.install?.byPlatform?.[platform] };
    try { installed = e.status !== "self-managed" && install.entry && e.home ? installedOf({ homeDir: expandHome(e.home), install }) : null; } catch { /* instalação ilegível = não instalado */ }
    return { name: e.name, version: e.version, kind: e.kind, platforms: e.platforms ?? [], supported: platformReason(e, platform) === null, installed, selfManaged: e.status === "self-managed" };
  });
  if (!apps) { return { ok: true, platform, engines }; }
  try {
    return { ok: true, platform, engines, apps: (local.apps ?? []).map((a) => ({ name: a.name, version: a.version, summary: a.summary, platforms: a.platforms ?? [], supported: platformReason(a, platform) === null, pin: pinOf(a.name) ?? null })) };
  } catch (e) { return { ok: false, reason: e.message }; }
}

/** O que o kit faria, em texto, a partir do retorno de `ensure`, `pin` ou `rollback` com `dryRun:true`. */
export const planoEm = (r) => { const plano = ({
  instalar: `instalaria v${r.version}`, atualizar: `atualizaria v${r.installed} → v${r.version}`, reusar: `reusaria v${r.version}, já em dia`, manter: r.quarantined ? `manteria v${r.version} (v${r.quarantined.version} em quarentena)` : `manteria v${r.version} (v${r.available} disponível; ENGINE_KIT_NO_AUTO_UPDATE ligado)`,
  fixar: `fixaria v${r.version} (já instalada)`, "instalar-e-fixar": `instalaria v${r.version} e fixaria`, "trocar-e-fixar": `trocaria v${r.installed} → v${r.version} e fixaria`, reverter: `reverteria v${r.installed} → v${r.version} e fixaria`,
})[r.plan]; return plano && plano + (r.religaria ? "; derrubaria e religaria o daemon vivo" : ""); };

/**
 * Fetcher de `ensureDeArquivo`: o artefato e os sidecars `<tgz>.sha256` e `<tgz>.sig` (os três assets da release) saem do disco,
 * em vez da rede. A conferência de sha256, assinatura e versão é a de sempre: sidecar ausente é ABORT, nunca instalação sem prova.
 * @param {string} tgz caminho do artefato.
 * @returns {Function} no formato `fetcher(url, timeoutMs, { stream })` do `provision`.
 */
const fetcherDeArquivo = (tgz) => async (url, _prazo, { stream } = {}) => {
  const arquivo = /\.sha256$/.test(url) ? `${tgz}.sha256` : /\.sig$/.test(url) ? `${tgz}.sig` : tgz;
  return stream ? createReadStream(arquivo) : readFileSync(arquivo);
};

/**
 * `engine-kit ensure <motor> --de-arquivo <tgz>`: o `ensureCommand` com o artefato lido do disco. O arquivo foi pedido, então troca o motor instalado mesmo com a
 * atualização automática desligada. Mesmas opções do `ensureCommand`, menos `fetcher` e `autoUpdate`.
 * @param {string} name motor.
 * @param {string} tgz artefato, com `<tgz>.sha256` e `<tgz>.sig` ao lado.
 */
export const ensureDeArquivo = (name, tgz, { log = () => {}, ...opts } = {}) => ensureCommand(name, { ...opts, autoUpdate: true, quarentena: false, fetcher: fetcherDeArquivo(tgz), log: (m) => log(m.replace(/baixando \S+/, `lendo ${tgz} (sem baixar)`)) });

/**
 * Um motor por instalação: os que dividem home e entrada na `platform` são o mesmo binário, e fica o de nome sem o sufixo `-<plataforma>` ou, sem ele, o primeiro do manifest.
 */
export function semDuplicados(local, nomes, platform) {
  const dono = new Map(), chave = new Map();
  for (const e of (local.engines ?? []).filter((x) => nomes.includes(x.name))) {
    const k = instalacaoDe(e, platform);
    chave.set(e.name, k);
    if (!dono.has(k) || dono.get(k).endsWith(`-${platform}`)) { dono.set(k, e.name); }
  }
  return nomes.filter((n) => dono.get(chave.get(n)) === n);
}

/**
 * Os motores que `engine-kit ensure --instalados` atualiza: os instalados aqui que o ensure sabe atualizar (self-managed e motor de outra plataforma ficam de fora), um por instalação.
 * @returns {{ok:true, names:string[]} | {ok:false, reason:string}}
 */
export function instaladosAtualizaveis(opts) {
  const l = listCommand(opts);
  return l.ok ? { ok: true, names: semDuplicados(embarcado(opts?.bundled).local, l.engines.filter((e) => e.installed && !e.selfManaged && e.supported).map((e) => e.name), l.platform) } : l;
}

/**
 * @param {string} name motor no registry.
 * @param {object} opts
 * @param {string=} opts.version versão EXATA (default: a do registry): uma instalada diferente, maior ou menor, é trocada por ela.
 * @param {string=} opts.registryUrl manifest remoto (default: registry público).
 * @param {object=} opts.bundled manifest embarcado (default: o deste pacote; testes injetam).
 * @param {object=} opts.manifest manifest do registry já carregado (testes; pula rede e cache).
 * @param {Function=} opts.fetcher download injetável (testes).
 * @param {boolean=} opts.autoUpdate false = motor já instalado fica na versão dele e o retorno avisa a nova
 *        (`available`). Default true. Um `version` explícito sempre vale: foi pedido.
 *        Motor fixado (`engine-kit pin`) fica sempre na versão fixada; `version` diferente dela é recusado.
 * @param {boolean=} opts.dryRun true = só diz o que faria, sem baixar nem gravar: devolve `{ ok:true, dryRun:true, plan }` com `plan` = instalar, atualizar, reusar ou manter.
 * @param {boolean=} opts.quarentena false = a versão que o histórico marca como volta é instalada mesmo sem `version` (default true: motor instalado, sem `version` nem pin, fica na instalada, como o `ensureEngine`).
 * @param {boolean=} opts.fixar com `dryRun` e `version`: o plano de um `pin --version`, em que o pin gravado não contradiz a versão pedida porque ela é a que vai ser fixada.
 * @param {number=} opts.religarPrazoMs prazo para o daemon religado anunciar e responder o `/health` (default `PRAZO_RELIGAR_MS`, 60 s).
 * Daemon vivo que o ensure derruba para trocar a instalação é religado com o executável novo (`restarted: {ok:true, pid, version, bootLog}`); se não sobe, o retorno é
 * `{ ok:false, reason, restarted: {ok:false, reason, bootLog, pid?}, version }` (a instalação ficou feita, o daemon NÃO está no ar). Se a troca falha depois de o daemon cair, o retorno é `{ ok:false, reason, restarted }` e `restarted` é o religar da instalação ANTIGA (a razão diz se subiu). Daemon parado antes não é lançado. No `dryRun`, `religaria:true` avisa o que o ensure faria.
 * @returns {Promise<{ok:true, entryPath:string, version:string, kind:string, reused?:boolean, signed?:boolean,
 *          previous?:string, available?:string, pinned?:string, quarantined?:{version:string}} | {ok:false, reason:string}>} `previous` = versão
 *          substituída; `pinned` = versão em que o motor está fixado; `quarantined` = versão oferecida que não subiu aqui e ficou de lado.
 */
export async function ensureCommand(name, { version, registryUrl, bundled, manifest, fetcher, autoUpdate = true, dryRun = false, fixar = false, quarentena = true, religarPrazoMs, log = () => {} } = {}) {
  const { local, reason } = embarcado(bundled);
  if (!local) { return { ok: false, reason }; }

  const pinned = (local.engines ?? []).find((e) => e.name === name);
  if (!pinned) { return { ok: false, reason: semMotor(local, name, "ensure") }; }
  const fora = platformReason(pinned);
  if (fora) { return { ok: false, reason: fora }; }
  const publicKey = pinned.install?.publicKey;
  if (!publicKey) {
    return { ok: false, reason: `${name}: o manifest embarcado não traz publicKey → sem chave do primeiro contato não instalo (ABORT)` };
  }

  const { pin, reason: recusa } = dryRun && fixar ? { pin: version } : pinFor(name, version, local);
  if (recusa) { return { ok: false, reason: recusa }; }
  // refresh: instalar quer a verdade do registry, não um descritor de cache.
  const r = await resolve(name, { version: version ?? pin, registryUrl, refresh: true, ...(manifest ? { manifest } : {}) });
  if (!r.ok) { return { ok: false, reason: r.reason }; }

  const engine = r.engine;
  const previous = installedOf(engine);
  const quarantined = quarentena && !version && !pin ? quarantineOf(name, engine.version, previous) : undefined;
  const manter = (!autoUpdate || engine.runtime?.updatePath || quarantined) && !version && !pin && previous && !satisfiesPin(previous, engine.version);
  if (dryRun) {
    const serve = previous && (version || pin ? previous === engine.version : engine.runtime?.updatePath || satisfiesPin(previous, engine.version));
    const religaria = !manter && !serve && previous && await vivoParaReligar(engine);
    if (engine.status === "pending-release" && !serve && !manter) { return { ok: false, reason: `${name}: ainda não publicou release (status: pending-release)` }; }
    if (engine.status === "self-managed" && !serve && !manter) { return { ok: false, reason: instaladorProprio(engine, `${name}: ${AUTO_GERIDO}`) }; }
    const rb = !manter && !serve && !version && !pin && rollbackReason(name, engine.version);
    if (rb) { return { ok: false, reason: rb }; }
    return {
      ok: true, dryRun: true, plan: manter ? "manter" : serve ? "reusar" : previous ? "atualizar" : "instalar", kind: engine.kind,
      version: manter || serve ? previous : engine.version,
      ...(previous ? { installed: previous } : {}), ...(manter && !quarantined ? { available: engine.version } : {}), ...(pin ? { pinned: pin } : {}), ...(engine.staleCache ? { staleCache: true } : {}),
      ...(religaria ? { religaria: true } : {}),
      ...(quarantined ? { quarantined, warns: [quarantineWarn(quarantined.version)] } : {}),
    };
  }
  if (manter) {
    if (quarantined) { log(`aviso: ${name}: ${quarantineWarn(quarantined.version)}`); }
    return {
      ok: true, entryPath: join(engine.homeDir, engine.install.entry), version: previous, kind: engine.kind, reused: true,
      ...(quarantined ? { quarantined, warns: [quarantineWarn(quarantined.version)] } : { available: engine.version }),
      ...(engine.staleCache ? { staleCache: true } : {}),
      ...(engine.kind === "cli" ? { pointer: pointerOf(engine) } : {}),
    };
  }

  const rel = religador(engine, { log, ...(religarPrazoMs ? { prazoMs: religarPrazoMs } : {}) });
  const p = await provision(r.engine, {
    log,
    trustedKeys: { [name]: publicKey },
    allowDowngrade: Boolean(version),
    exact: Boolean(pin || version),
    ...(fetcher ? { fetcher } : {}),
    onBeforeReplace: rel.antes,
  });
  if (!p.ok && engine.status === "self-managed") { return { ok: false, reason: instaladorProprio(engine, p.reason) }; }
  if (!p.ok) {
    // Rotação legítima de chave chega ao registry antes de chegar a este pacote: a saída é o kit novo.
    const hint = /FIXADA|não declara publicKey/.test(p.reason) ? ` — se a chave foi rotacionada de propósito, rode npx engine-kit@latest ensure ${name}` : "";
    const restarted = await rel.religar(previous);
    return { ok: false, reason: p.reason + hint + aposReligar(restarted, false), ...(restarted ? { restarted } : {}) };
  }
  const restarted = await rel.religar(p.version);
  const base = { entryPath: p.entryPath, version: p.version, kind: engine.kind, ...(p.installed && previous && previous !== p.version ? { previous } : {}), ...(restarted ? { restarted } : {}) };
  if (restarted?.ok === false) { return { ok: false, reason: `${name}: v${p.version} instalada${aposReligar(restarted, true)}`, ...base }; }
  return {
    ok: true, reused: p.reused === true, signed: p.signed, ...base,
    ...(pin ? { pinned: pin } : {}),
    ...(engine.staleCache ? { staleCache: true } : {}),
    ...(engine.kind === "cli" ? { pointer: pointerOf(engine) } : {}),
  };
}

/**
 * `engine-kit ensure --de <manifesto>`: instala ou atualiza, pelo `ensureCommand`, cada motor que o `checkCommand` reprova por AUSENTE ou FORA-DA-FAIXA,
 * e reconfere no fim pelo mesmo check. Quem já satisfaz não é tocado (`reusado`); self-managed fica `pulado`; DESCONHECIDO e ERRO ficam `recusado`.
 * Faixa inválida aborta antes de instalar qualquer motor. Uma última versão que não satisfaz a faixa reprova como FORA-DA-FAIXA. Nunca lança.
 * @param {string} file manifesto do plugin.
 * @param {object=} opts as do `ensureCommand`, menos `version`.
 * @returns {Promise<{ok:boolean, manifest:string, reason?:string, engines:object[]} | {ok:false, reason:string}>} cada motor traz as chaves do
 *          `checkCommand` e `acao` (reusado, pulado, recusado, instalado, atualizado, mantido, falhou, abortado), `version`, `previous` e `available`.
 */
export async function ensureDeCommand(file, opts = {}) {
  const antes = await checkCommand(file, { manifest: opts.manifest });
  if (!antes.engines) { return antes; }
  const ruins = antes.engines.filter((e) => e.state === "FAIXA-INVALIDA").map((e) => e.name);
  if (ruins.length) {
    return { ...antes, ok: false, reason: `faixa inválida em ${ruins.join(", ")}: nada foi instalado`, engines: antes.engines.map((e) => ({ ...e, acao: "abortado" })) };
  }
  const extra = {};
  for (const e of antes.engines) {
    if (!["AUSENTE", "FORA-DA-FAIXA"].includes(e.state)) { extra[e.name] = { acao: { OK: "reusado", "NAO-VERIFICAVEL": "pulado" }[e.state] ?? "recusado" }; continue; }
    const r = await ensureCommand(e.name, opts);
    extra[e.name] = r.ok
      ? { acao: opts.dryRun ? { instalar: "instalaria", atualizar: "atualizaria" }[r.plan] ?? "mantido" : r.previous ? "atualizado" : r.reused ? "mantido" : "instalado", version: r.version, previous: r.previous ?? r.installed, available: r.available, ...(r.quarantined ? { quarantined: r.quarantined, warns: r.warns } : {}) }
      : { acao: "falhou", detail: r.reason };
  }
  if (opts.dryRun) {
    const engines = antes.engines.map((e) => ({ ...e, ...extra[e.name] }));
    return { ok: engines.every((e) => !["recusado", "falhou"].includes(e.acao)), manifest: file, dryRun: true, engines };
  }
  const depois = await checkCommand(file, { manifest: opts.manifest });
  if (!depois.engines) { return depois; }
  const engines = depois.engines.map((e) => ({ ...e, ...extra[e.name] }));
  return { ok: engines.every((e) => e.satisfied), manifest: file, engines };
}

/** Motivo da recusa de um nome que não é motor: app aponta o `fetch`; o resto, o kit novo. */
const semMotor = (local, name, verbo) => (local.apps ?? []).some((a) => a.name === name)
  ? `"${name}" é app, não motor: o ${verbo} não se aplica → engine-kit fetch ${name} baixa e confere`
  : `motor "${name}" não está no manifest deste engine-kit → atualize o kit (npx engine-kit@latest ${verbo} ${name})`;

/**
 * `engine-kit pin <motor> [--version x.y.z]`: congela UM motor. Sem `version`, fixa a versão instalada; com ela,
 * instala essa versão (sha256 + Ed25519, downgrade permitido) e fixa. A autoatualização pula só este motor.
 * Com `dryRun` só devolve o plano, sem instalar, baixar nem gravar o pin: `{ ok:true, dryRun:true, plan, version, installed?, pinned }` com `plan` = fixar,
 * instalar-e-fixar ou trocar-e-fixar; as recusas são as mesmas. Nunca lança. Opções de teste iguais às de `ensureCommand`.
 * @returns {Promise<{ok:true, version:string, pinned:string} | {ok:false, reason:string}>}
 */
export async function pinCommand(name, { version, ...opts } = {}) {
  if (opts.dryRun) {
    try { pinOf(name); } catch (e) { return { ok: false, reason: e.message }; }
  }
  if (version && opts.dryRun) {
    const e = await ensureCommand(name, { ...opts, version, fixar: true });
    return e.ok ? { ...e, plan: { reusar: "fixar", atualizar: "trocar-e-fixar", instalar: "instalar-e-fixar" }[e.plan] } : e;
  }
  if (version) {
    const s = setPin(name, version), before = s.was;
    if (!s.ok) { return s; }
    const e = await ensureCommand(name, opts);
    if (!e.ok && !e.entryPath) {
      const back = setPin(name, before);
      return { ok: false, reason: `${e.reason} → pin não aplicado${back.ok ? (before ? ` (pin anterior v${before} restaurado)` : "") : `; ${back.reason}`}` };
    }
    return e;
  }
  const r = await resolve(name, { registryUrl: opts.registryUrl, ...(opts.manifest ? { manifest: opts.manifest } : {}) });
  if (!r.ok) { return { ok: false, reason: r.reason }; }
  if (r.engine.status === "self-managed") {
    return { ok: false, reason: `${name} é self-managed: atualiza pelo próprio updater, o engine-kit não fixa a versão dele` };
  }
  const inst = installedOf(r.engine);
  if (!inst) {
    return { ok: false, reason: `${name} não está instalado (ou a versão é ilegível) → engine-kit pin ${name} --version <x.y.z> instala e fixa` };
  }
  if (opts.dryRun) { return { ok: true, dryRun: true, plan: "fixar", kind: r.engine.kind, version: inst, installed: inst, pinned: inst, ...(r.engine.staleCache ? { staleCache: true } : {}) }; }
  const s = setPin(name, inst);
  return s.ok ? { ok: true, version: inst, pinned: inst, ...(r.engine.staleCache ? { staleCache: true } : {}) } : s;
}

/**
 * `engine-kit unpin <motor>`: o motor volta a receber atualizações. Nunca lança. Se o pin continua valendo por outro nome que divide a instalação (`pinDaInstalacao`),
 * o resultado segue ok e traz `warns` dizendo quem soltar. Opção de teste: `bundled`, como no `ensureCommand`.
 */
export function unpinCommand(name, { bundled } = {}) {
  const s = setPin(name, null);
  if (!s.ok) { return s; }
  const { pin, dono } = pinDaInstalacao(embarcado(bundled).local, name);
  return { ok: true, was: s.was, ...(pin ? { warns: [`continua fixado em v${pin} por ${dono}, que divide a instalação: engine-kit unpin ${dono}`] } : {}) };
}

/**
 * `engine-kit rollback <motor>`: volta o motor para a versão que ele tinha antes da última troca gravada no histórico (`history`), instalando-a
 * por `pin --version` (sha256 + Ed25519, downgrade permitido) e FIXANDO: sem o pin o próximo `ensure` atualizaria de volta. Só desfaz uma troca
 * que ainda vale: a versão instalada precisa ser a que a última troca gravou. Com `dryRun` devolve só o plano (`plan:"reverter"`, de `installed` para `version`), sem trocar a versão nem gravar o pin.
 * Nunca lança. Opções de teste iguais às do `pinCommand`.
 * @returns {Promise<{ok:true, version:string, pinned:string} | {ok:false, reason:string}>}
 */
export async function rollbackCommand(name, { bundled, ...opts } = {}) {
  const h = historyCommand(name);
  if (!h.ok) { return h; }
  const last = h.entries.at(-1);
  if (!last) { return { ok: false, reason: `nenhuma troca registrada nesta máquina; não há versão anterior para voltar` }; }
  if (!last.from) { return { ok: false, reason: `a última troca (→ v${last.to}) foi a primeira instalação; não há versão anterior para voltar` }; }
  if (last.via === "rollback") { return { ok: false, reason: `a última troca foi a volta automática de v${last.from} para v${last.to}: v${last.from} não subiu e voltar a ela repetiria a falha → engine-kit pin ${name} --version <x.y.z> escolhe outra` }; }
  const row = listCommand({ bundled }).engines?.find((e) => e.name === name);
  if (!row) { return { ok: false, reason: `motor "${name}" não está no manifest deste engine-kit → atualize o kit (npx engine-kit@latest rollback ${name})` }; }
  if (row.selfManaged) { return { ok: false, reason: `${name} é self-managed: atualiza pelo próprio updater, o engine-kit não troca a versão dele` }; }
  if (row.installed !== last.to) { return { ok: false, reason: `instalado v${row.installed ?? "nenhuma"}, mas a última troca gravada terminou em v${last.to} → o histórico não descreve a instalação atual; use engine-kit pin ${name} --version <x.y.z>` }; }
  const r = await pinCommand(name, { ...opts, bundled, version: last.from });
  return r.ok && r.dryRun ? { ...r, plan: "reverter" } : r;
}

/**
 * `engine-kit stop <motor>`: desliga o motor pelo `shutdownPath` que o registry declara, o mesmo pedido que o kit faz antes
 * de trocar a instalação. Motor sem `shutdownPath` é recusado com o motivo: o kit não adivinha como desligar. Nunca lança.
 * @returns {Promise<{ok:true, stopped:boolean} | {ok:false, reason:string}>} `stopped:false` = nada vivo para desligar.
 */
export async function stopCommand(name, { registryUrl, bundled, manifest, log = () => {} } = {}) {
  const { local, reason } = embarcado(bundled);
  if (!local) { return { ok: false, reason }; }
  if (!(local.engines ?? []).some((e) => e.name === name)) { return { ok: false, reason: semMotor(local, name, "stop") }; }
  return stopEngine(name, { registryUrl, manifest, log });
}
