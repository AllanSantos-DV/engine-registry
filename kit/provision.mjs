// engine-kit/provision.mjs — PROVISION: garante o motor instalado em <home>/<extractTo>.
// Generalização do provision.mjs do embed-house (medido em produção), agora parametrizado pelo
// descritor do registry. Mantém as garantias que já funcionavam:
//   • SHA256 sidecar OBRIGATÓRIO, fail-closed (ausente/malformado/mismatch = ABORT, não instala);
//   • lock atômico ('wx') para serializar consumidores concorrentes na mesma máquina;
//   • reúso por semver same-major >= (dois consumidores com pins diferentes convergem no maior);
//   • download em fluxo -> .part -> rename atômico (prazo por inatividade); extração em staging -> swap;
//   • shutdown-first (Windows: DLL/EXE em uso impede sobrescrever o diretório).
// NUNCA lança: devolve { ok:false, reason }.
import { mkdirSync, existsSync, renameSync, rmSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync, readdirSync, utimesSync } from "node:fs";
import { open } from "node:fs/promises";
import { join, dirname, resolve as resolvePath, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifyDigest, sha256, DEFAULT_ALGORITHM } from "./signature.mjs";
import { checkTrust, trustPath, cmpVer, rollbackReason, noteVersion, firstContactKeys, recordSwap, dropStaleLock, dropFile } from "./trust.mjs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// No Windows o handle de quem acabou de sair solta um instante depois: rename ocupado repete com backoff, depois lança.
export async function renameRetry(a, b, tries = 8) {
  for (let i = 1; ; await sleep(100 * i++)) {
    try { return renameSync(a, b); } catch (e) { if (i >= tries || !/^(EBUSY|EPERM|EACCES)$/.test(e.code)) { throw e; } }
  }
}

/** Apaga `p` e tudo sob ele; não falha se não existe. */
export const rmTree = (p) => rmSync(p, { recursive: true, force: true });

/** Linha de log do kit: `[engine-kit] <motor>: <msg>`. */
export const say = (log, engine, msg) => log(`[engine-kit] ${engine.name}: ${msg}`);

/** Recusa uniforme do kit: `{ ok:false, reason:"<motor>: <msg>" }`. */
export const refuse = (engine, msg) => ({ ok: false, reason: `${engine.name}: ${msg}` });

/** Cria `dir`; devolve a recusa (ou undefined se criou). */
const mkdirRefusal = (dir, engine) => { try { mkdirSync(dir, { recursive: true }); } catch (e) { return refuse(engine, `não consegui criar ${dir}: ${e?.message || e}`); } };

/** Lock mais velho que isto é considerado ÓRFÃO (processo morreu antes do finally). */
export const LOCK_STALE_MS = 120000;

/**
 * Binário do tar. No Windows, o tar NATIVO (bsdtar, System32) quando existir: um processo aberto a partir de um terminal
 * Git Bash herda o GNU tar do Git na frente do PATH, e o GNU tar lê "C:\..." como host remoto ("Cannot connect to C:
 * resolve failed") — a instalação de QUALQUER motor quebrava só por onde o host foi aberto.
 * @returns {string} caminho do tar nativo ou `"tar"` (PATH).
 */
export function tarBinary({ platform = process.platform, systemRoot = process.env.SystemRoot || process.env.windir, exists = existsSync } = {}) {
  if (platform === "win32" && systemRoot) {
    const native = join(systemRoot, "System32", "tar.exe");
    if (exists(native)) return native;
  }
  return "tar";
}

/**
 * Extrai o .tgz sem bloquear o event loop (o heartbeat do lock do `provision` segue durante uma extração longa). Usa o `tar`
 * do sistema (presente por padrão no Windows 10 1803+, macOS e Linux). Se faltar, falha com razão EXPLÍCITA e acionável em vez
 * de um erro cru de spawn — nunca instala pela metade. Falha da extração leva o stderr do tar na razão.
 * @param {string} tgz arquivo a extrair.
 * @param {string} dest pasta de destino.
 * @param {string[]} [tar] comando e argumentos fixos antes dos do tar (default `[tarBinary()]`; testes injetam um tar falso).
 * @returns {Promise<{ok:true} | {ok:false, reason:string}>} nunca lança.
 */
export async function extractTgz(tgz, dest, tar = [tarBinary()]) {
  const run = (args) => promisify(execFile)(tar[0], [...tar.slice(1), ...args], { windowsHide: true });
  try {
    await run(["--version"]);
  } catch {
    return { ok: false, reason: "`tar` não encontrado no PATH: instale-o para extrair o artefato." };
  }
  try {
    await run(["-xzf", tgz, "-C", dest]);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `extração (tar) falhou: ${e?.message || e}` };
  }
}

/**
 * Tenta claim do lock de provisionamento. Grava o PID para diagnóstico e reclama locks
 * órfãos (sem renovação há mais de `staleMs`, {@link LOCK_STALE_MS} por padrão) — sem isso, um processo morto entre o
 * `openSync` e o `finally` travaria todos os consumidores para sempre. Quem está provisionando renova o mtime (`provision`).
 */
function claimLock(lock, staleMs) {
  const open = () => {
    const fd = openSync(lock, "wx");
    try { writeFileSync(lock, String(process.pid)); } catch { /* diagnóstico é best-effort */ }
    return fd;
  };
  try { return open(); } catch {
    dropStaleLock(lock, staleMs);
    try { return open(); } catch { return null; }
  }
}

/** true se a versão instalada serve o pin: MESMO major e >= (protocolo é atado ao major). */
/** `ENGINE_KIT_NO_AUTO_UPDATE` ligado ("1", "true" ou "yes") desliga a troca automática de versão. */
export const autoUpdateEnabled = (env = process.env) => !["1", "true", "yes"].includes(String(env.ENGINE_KIT_NO_AUTO_UPDATE ?? "").toLowerCase());

export const satisfiesPin = (installed, pinned) => String(installed).split(".")[0] === String(pinned).split(".")[0] && cmpVer(installed, pinned) >= 0;

/**
 * Grava o artefato em `part` em fluxo, sem nunca tê-lo inteiro em memória, e devolve o sha256 calculado durante o fluxo.
 * O prazo vale por leitura: cada pedaço recebido reinicia a contagem; `idleMs` sem byte aborta (e aciona o `signal` do fetcher).
 * O fetcher devolve um iterável assíncrono de pedaços (o `body` do `fetch`) ou, por compatibilidade, os bytes de uma vez.
 * @returns {Promise<Buffer>} digest sha256 (32 bytes).
 */
async function streamToDisk(fetcher, url, part, idleMs) {
  const ac = new AbortController();
  const guard = (p) => new Promise((ok, no) => {
    const t = setTimeout(() => { ac.abort(); no(new Error(`inatividade: ${idleMs} ms sem receber bytes`)); }, idleMs);
    Promise.resolve(p).then(ok, no).finally(() => clearTimeout(t));
  });
  const hash = createHash("sha256");
  const fh = await open(part, "w");
  try {
    const src = await guard(fetcher(url, idleMs, { stream: true, signal: ac.signal }));
    const it = Symbol.asyncIterator in Object(src) ? src[Symbol.asyncIterator]() : [src][Symbol.iterator]();
    for (let n; !(n = await guard(it.next())).done;) { hash.update(n.value); await fh.appendFile(n.value); }
  } finally { ac.abort(); await fh.close(); }
  return hash.digest();
}

/**
 * Baixa o artefato para `part` e confere o sidecar SHA256 (obrigatório, fail-closed) sobre o digest do fluxo.
 * @returns {Promise<{digest:Buffer} | {ok:false, reason:string}>}
 */
async function downloadChecked(engine, part, { log, fetcher, idleMs }) {
  let expected;
  try {
    expected = String(await fetcher(engine.checksumUrl, 15000)).trim().split(/\s+/)[0].toLowerCase();
  } catch (e) {
    return refuse(engine, `sha256 sidecar inacessível (${e.status || e.message}) → ABORT (fail-closed)`);
  }
  if (!/^[0-9a-f]{64}$/.test(expected)) { return refuse(engine, "sha256 sidecar malformado → ABORT"); }

  log(`[engine-kit] baixando ${engine.assetUrl} …`);
  let digest;
  try { digest = await streamToDisk(fetcher, engine.assetUrl, part, idleMs); }
  catch (e) { return refuse(engine, `download falhou (${e.status || e.message})`); }

  const actual = digest.toString("hex");
  return actual === expected ? { digest } : refuse(engine, `SHA256 mismatch (esperado ${expected.slice(0, 12)}…, obtido ${actual.slice(0, 12)}…) → ABORT`);
}

/** GET pequeno com prazo total. Com `stream`, devolve o `body` (iterável de pedaços) e o prazo fica a cargo de quem lê, via `signal`. */
export async function fetchBuf(url, timeoutMs, { stream, signal } = {}) {
  const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(timeoutMs) });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return stream ? res.body : Buffer.from(await res.arrayBuffer());
}

/** Registro dos hashes dos arquivos extraídos, gravado dentro da pasta instalada para acompanhar o swap e o rollback. */
export const FILES_MANIFEST = ".engine-kit-files.json";

/** sha256 de cada arquivo sob `dir` (caminho relativo com `/`), exceto o próprio registro. */
export function hashTree(dir, sub = "") {
  const out = {};
  for (const d of readdirSync(join(dir, sub), { withFileTypes: true })) {
    const rel = sub ? `${sub}/${d.name}` : d.name;
    if (d.isDirectory()) { Object.assign(out, hashTree(dir, rel)); }
    else if (d.isFile() && rel !== FILES_MANIFEST) { out[rel] = sha256(readFileSync(join(dir, rel)), "hex"); }
  }
  return out;
}

/** Pasta em que o artefato do motor é extraído: `<home>/<extractTo>`. */
export const binDirOf = (engine) => join(engine.homeDir, engine.install.extractTo ?? "bin");

/** Lê a versão instalada a partir do package.json do artefato (se houver). */
export function installedVersion(binDir) {
  try { return JSON.parse(readFileSync(join(binDir, "package.json"), "utf8")).version; } catch { return null; }
}

/**
 * AUTENTICIDADE do artefato (Ed25519 hash-then-sign) — o passo que o SHA256 não cobre.
 *
 * O sidecar `.sha256` só prova que o download não corrompeu: quem publica o artefato publica o
 * hash junto, então um artefato TROCADO vem com o hash certo do artefato trocado. A assinatura é
 * o que amarra o artefato a quem detém a chave privada (que nunca sai da máquina do dono).
 *
 * Política, deliberadamente fail-closed e sem meio-termo silencioso:
 *   • `publicKey` declarada no registry  → assinatura é OBRIGATÓRIA (declarar = exigir);
 *   • `signatureRequired:true` sem `publicKey` → manifesto INCONSISTENTE, aborta (não "passa");
 *   • nenhum dos dois → motor ainda não migrado: instala, mas o log SINALIZA (nunca calado).
 *
 * @param {Buffer} digest sha256 do artefato (o que a assinatura cobre), calculado durante o download.
 * @returns {Promise<{ok:true, signed:boolean} | {ok:false, reason:string}>} nunca lança.
 */
async function verifyAuthenticity(engine, digest, { log, fetcher, trustedKeys }) {
  const publicKey = engine.install?.publicKey;
  const required = engine.install?.signatureRequired === true;
  const algorithm = engine.install?.signatureAlgorithm ?? DEFAULT_ALGORITHM;

  if (publicKey && engine.publicRegistry && !trustedKeys?.[engine.name]) {
    try { trustedKeys = firstContactKeys(engine.name); } catch (e) { return refuse(engine, `manifest embarcado ilegível (${e.message})`); }
    if (!trustedKeys) { return refuse(engine, "não está no manifest embarcado deste engine-kit, então não há chave do primeiro contato → atualize o kit ou fixe a chave (trustedKeys)"); }
  }

  if (!publicKey) {
    // Chave fixada pelo consumidor e registry sem chave: tirar a publicKey do manifest não pode
    // ser o atalho para instalar sem assinatura.
    if (trustedKeys?.[engine.name]) {
      return refuse(engine, `o consumidor fixou uma chave mas o registry não declara publicKey → ABORT (registry pode estar comprometido)`);
    }
    if (required) {
      return refuse(engine, `registry pede assinatura (signatureRequired) mas não declara publicKey → ABORT (manifesto inconsistente)`);
    }
    say(log, engine, `SEM assinatura no registry — integridade (sha256) verificada, AUTENTICIDADE não`);
    return { ok: true, signed: false };
  }

  // A chave veio do MESMO manifest que o kit baixou — sozinha, ela não prova nada contra um
  // registry comprometido. Confronta com a raiz de confiança LOCAL antes de usá-la.
  const t = checkTrust(engine.name, publicKey, { trustedKeys, rotation: engine.install?.rotation });
  if (!t.ok) { return t; }
  if (t.rotated) {
    say(log, engine, `chave rotacionada, assinada pela chave anterior${t.saved === false ? ` (NÃO gravada em ${trustPath()})` : ""}`);
  } else if (t.saved === false) {
    say(log, engine, `chave aceita, mas NÃO gravada em ${trustPath()} — o próximo ensure repete o primeiro contato`);
  } else if (t.tofu) {
    const how = trustedKeys?.[engine.name] ? "chave FIXADA pelo consumidor conferiu e foi gravada" : "chave pública gravada na 1ª vez (TOFU)";
    say(log, engine, `${how} em ${trustPath()} — trocas futuras serão ABORT`);
  }

  let sig;
  try {
    sig = await fetcher(engine.signatureUrl, 15000);
  } catch (e) {
    return refuse(engine, `sidecar .sig inacessível (${e.status || e.message}) mas o registry declara publicKey → ABORT (fail-closed)`);
  }

  const v = verifyDigest(digest, sig, publicKey, { algorithm });
  if (!v.ok) { return refuse(engine, v.reason); }

  say(log, engine, `assinatura Ed25519 CONFERE (${algorithm})`);
  return { ok: true, signed: true };
}

/**
 * Baixa e VERIFICA um artefato sem instalar — o caminho dos motores `self-managed`.
 *
 * Existe para fechar o ovo-e-galinha do primeiro install: um motor que traz o próprio
 * instalador (o `vox-engine` é um app Python com `install.ps1`) não pode se instalar sozinho
 * numa máquina onde ainda não está. Alguém tem de buscar o instalador — e esse alguém estava
 * sendo CADA consumidor, cada um com sua cópia de resolução de release, SHA256 e Ed25519.
 *
 * Aqui o kit faz o que já sabe fazer (integridade + autenticidade fail-closed) e devolve o
 * caminho do arquivo verificado. Quem sabe o que fazer com ele — rodar um instalador, extrair,
 * conferir uma assinatura extra — é o consumidor. O kit não executa nada.
 *
 * O artefato desce em FLUXO para `<assetName>.part` (nunca inteiro em memória), com o sha256 calculado no caminho; o
 * `.part` só vira `<assetName>` depois de sha256 e assinatura conferirem, e é apagado se qualquer passo falhar.
 * O prazo é por INATIVIDADE: o download aborta se ficar `idleTimeoutMs` sem receber nenhum byte, e um download lento
 * que continua recebendo não expira por maior que seja. `downloadTimeoutMs` é o nome antigo e vale como `idleTimeoutMs`.
 * `fetcher(url, timeoutMs, { stream, signal })` devolve Buffer/string (sidecars; por compatibilidade, o artefato também)
 * ou, com `stream:true`, um iterável assíncrono de pedaços.
 *
 * @returns {Promise<{ok:true, path:string, version:string, signed:boolean} | {ok:false, reason:string}>} nunca lança.
 */
export async function fetchArtifact(engine, { log = () => {}, destDir = process.cwd(), idleTimeoutMs, downloadTimeoutMs, fetcher = fetchBuf, trustedKeys, intoHome = false } = {}) {
  const dir = destDir;
  const dentro = relative(resolvePath(engine.homeDir), resolvePath(dir));
  if (!intoHome && !dentro.startsWith("..") && !isAbsolute(dentro)) {
    return refuse(engine, `destino ${dir} está dentro do home de ${engine.name} (${engine.homeDir}): o doctor --fix trata o artefato ali como sobra de instalação e o apagaria → escolha outra pasta`);
  }
  const mk = mkdirRefusal(dir, engine);
  if (mk) { return mk; }

  // .part → rename: nunca entregar um caminho que aponta para download pela metade nem não conferido.
  const part = join(dir, `${engine.assetName}.part`);

  const dl = await downloadChecked(engine, part, { log, fetcher, idleMs: idleTimeoutMs ?? downloadTimeoutMs ?? 60000 });
  const auth = dl.digest ? await verifyAuthenticity(engine, dl.digest, { log, fetcher, trustedKeys }) : dl;
  if (!auth.ok) { dropFile(part); return auth; }

  const out = join(dir, engine.assetName);
  try {
    renameSync(part, out);
  } catch (e) {
    dropFile(part);
    return refuse(engine, `não consegui gravar ${out}: ${e?.message || e}`);
  }
  log(`[engine-kit] ${engine.name} v${engine.version} verificado em ${out}`);
  return { ok: true, path: out, version: engine.version, signed: auth.signed };
}

/**
 * Garante o motor instalado. `onBeforeReplace` é o gancho de shutdown do MOTOR (o kit nunca
 * adivinha como derrubar um daemon: quem sabe é o descritor/consumidor).
 * @returns {Promise<{ok:true, entryPath:string, version:string, reused?:boolean, installed?:boolean} | {ok:false, reason:string}>}
 */
export async function provision(engine, { log = () => {}, allowNetwork = true, onBeforeReplace, idleTimeoutMs, downloadTimeoutMs, fetcher = fetchBuf, trustedKeys, allowDowngrade, exact, keepPrevious, repair, lockStaleMs = LOCK_STALE_MS, lockWaitMs = lockStaleMs, tar } = {}) {
  const home = engine.homeDir;
  const binDir = binDirOf(engine);
  const entryPath = join(home, engine.install.entry);
  const lock = join(home, "provision.lock");
  const serves = (v) => v && (exact ? v === engine.version : engine.runtime?.updatePath || satisfiesPin(v, engine.version));

  // Já instalado? Só reusa se a versão instalada for LEGÍVEL e satisfizer o pin.
  // Versão ilegível (package.json ausente/corrompido = extração interrompida, disco cheio,
  // arquivo truncado) NÃO é motivo para reusar: é estado desconhecido → reprovisiona.
  // Reusar aqui seria fail-open silencioso — o oposto do resto do kit — e congelaria a máquina
  // numa instalação quebrada para sempre, ignorando o pin do registry.
  if (!repair && existsSync(entryPath)) {
    const inst = installedVersion(binDir);
    if (serves(inst)) {
      noteVersion(engine.name, inst);
      return { ok: true, entryPath, version: inst, reused: true };
    }
    if (!inst && engine.status !== "self-managed") {
      say(log, engine, `instalação em estado desconhecido (versão ilegível) → reprovisionando`);
      if (!allowNetwork) {
        return refuse(engine, `instalação em estado desconhecido (package.json ausente/corrompido em ${binDir}) e rede desabilitada: sem como reparar`);
      }
    } else if (inst) {
      say(log, engine, `instalada v${inst} não satisfaz o pin v${engine.version} → atualizando`);
    }
  }

  // Antes de qualquer teste de rede/estado local: o que o kit NÃO faz com este motor vale
  // independente de como ele está instalado.
  // Motor que traz o PRÓPRIO instalador (ex.: um app com updater embutido). A entrada no registry
  // existe como descritor de registro — release, chave, versão — mas quem instala é ele mesmo.
  // Tentar provisionar aqui daria erro obscuro (o artefato é um instalador, não um tarball de
  // `extractTo`); melhor recusar dizendo QUEM instala.
  if (engine.status === "self-managed") {
    return refuse(engine, "é self-managed: instala e atualiza pelo próprio updater, não pelo engine-kit");
  }

  if (!allowNetwork) { return refuse(engine, "ausente/desatualizado e rede desabilitada"); }
  if (engine.status === "pending-release") {
    return refuse(engine, "ainda não publicou release (status: pending-release)");
  }

  const rb = !allowDowngrade && !exact && rollbackReason(engine.name, engine.version);
  if (rb) { return { ok: false, reason: rb }; }

  const mk = mkdirRefusal(home, engine);
  if (mk) { return mk; }

  // LOCK atômico: só um consumidor provisiona; os demais aguardam o resultado dele.
  // Um lock órfão (processo morto) é reclamado por idade — não trava a máquina para sempre.
  const lockFd = claimLock(lock, lockStaleMs);
  if (lockFd === null) {
    for (const fim = Date.now() + lockWaitMs; Date.now() < fim; await sleep(1000)) {
      const inst = existsSync(entryPath) && installedVersion(binDir);
      if (serves(inst)) { return { ok: true, entryPath, version: inst, reused: true }; }
    }
    return refuse(engine, `provision-locked-timeout (outro consumidor está instalando há >${lockWaitMs / 1000}s)`);
  }

  // O mtime do lock acompanha a vida do processo: download e extração longos não o deixam parecer órfão.
  const beat = setInterval(() => { const s = Date.now() / 1000; try { utimesSync(lock, s, s); } catch { /* o lock some ao fim */ } }, lockStaleMs / 3).unref();
  try {
    // 1-3.5) Sidecar SHA256 obrigatório, integridade e AUTENTICIDADE antes de qualquer byte tocar o disco.
    const auth = await fetchArtifact(engine, { log, destDir: home, intoHome: true, idleTimeoutMs, downloadTimeoutMs, fetcher, trustedKeys });
    if (!auth.ok) { return auth; }
    const tgz = auth.path;

    // 4) Extrai em staging e faz o swap (com shutdown-first se já existe).
    const staging = join(home, `stage-${engine.version}`);
    rmTree(staging);
    mkdirSync(staging, { recursive: true });
    const ex = await extractTgz(tgz, staging, tar);
    if (!ex.ok) { return refuse(engine, ex.reason); }

    // 4.5) VERSÃO — a assinatura prova QUEM publicou o artefato, não QUAL versão ele é. Uma release
    //      antiga, legitimamente assinada, servida no lugar da nova (replay/downgrade) passaria pelo
    //      sha256 e pela Ed25519. O package.json do artefato tem de dizer a versão que o registry pede.
    const got = installedVersion(staging);
    const abort = (reason) => { rmTree(staging); dropFile(tgz); return { ok: false, reason }; };
    if (got !== engine.version) {
      return abort(`${engine.name}: o artefato diz v${got ?? "? (package.json ausente/ilegível)"} e o registry pede v${engine.version} → ABORT`);
    }

    writeFileSync(join(staging, FILES_MANIFEST), JSON.stringify(hashTree(staging)));

    // A instalação atual sai do caminho por RENAME, não por rmSync: no Windows, com o motor em uso
    // (sem shutdownPath, ou um host segurando o processo), o rmSync apagava metade da pasta antes do
    // EPERM e deixava a máquina sem motor nenhum. O rename falha inteiro ou passa inteiro.
    let aside = null;
    const from = installedVersion(binDir);
    if (existsSync(binDir)) {
      if (onBeforeReplace) { try { await onBeforeReplace(); } catch { /* best-effort */ } }
      aside = `${binDir}.old-${process.pid}`;
      rmTree(aside);
      try {
        await renameRetry(binDir, aside);
      } catch (e) {
        return abort(`${engine.name}: não consegui trocar ${binDir} (${e.code || e.message}): arquivos em uso — feche quem usa o motor e rode de novo; a instalação atual ficou intacta`);
      }
    }
    // `extractTo` pode ser ANINHADO (ex.: "runtimes/<motor>", quando o home guarda estado que
    // precisa sobreviver ao swap — pesos, logs). O rename exige o diretório-pai existente: sem
    // isto, funciona na máquina que já tem a pasta e falha justamente na máquina limpa.
    mkdirSync(dirname(binDir), { recursive: true });
    try {
      await renameRetry(staging, binDir);
    } catch (e) {
      if (aside) { try { renameSync(aside, binDir); } catch { /* o reason abaixo diz onde ficou */ } }
      return refuse(engine, `swap falhou (${e.code || e.message})${aside && existsSync(aside) ? `; a instalação anterior está em ${aside}` : ""}`);
    }
    if (aside && !keepPrevious) {
      try { rmTree(aside); }
      catch (e) { say(log, engine, `instalado, mas a versão anterior ficou em ${aside} (${e.code || e.message})`); }
    }
    dropFile(tgz);

    if (!existsSync(entryPath)) {
      return refuse(engine, `artefato extraído incompleto (sem ${engine.install.entry})`);
    }
    noteVersion(engine.name, engine.version);
    recordSwap(engine.name, from, engine.version, exact ? "version" : from ? "auto-update" : "ensure");
    log(`[engine-kit] ${engine.name} instalado em ${binDir} (v${engine.version})`);
    return { ok: true, entryPath, version: engine.version, installed: true, signed: auth.signed, ...(keepPrevious && aside ? { previousDir: aside } : {}) };
  } catch (e) {
    return refuse(engine, `provision falhou: ${e?.message || e}`);
  } finally {
    clearInterval(beat);
    try { closeSync(lockFd); unlinkSync(lock); } catch { /* ignore */ }
  }
}
