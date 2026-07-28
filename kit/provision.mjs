// engine-kit/provision.mjs — PROVISION: garante o motor instalado em <home>/<extractTo>.
// Generalização do provision.mjs do embed-house (medido em produção), agora parametrizado pelo
// descritor do registry. Mantém as garantias que já funcionavam:
//   • SHA256 sidecar OBRIGATÓRIO, fail-closed (ausente/malformado/mismatch = ABORT, não instala);
//   • lock atômico ('wx') para serializar consumidores concorrentes na mesma máquina;
//   • reúso por semver same-major >= (dois consumidores com pins diferentes convergem no maior);
//   • download -> .part -> rename atômico; extração em staging -> swap;
//   • shutdown-first (Windows: DLL/EXE em uso impede sobrescrever o diretório).
// NUNCA lança: devolve { ok:false, reason }.
import { mkdirSync, existsSync, renameSync, rmSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lock mais velho que isto é considerado ÓRFÃO (processo morreu antes do finally). */
const LOCK_STALE_MS = 120000;

/**
 * Extrai o .tgz. Usa o `tar` do sistema (presente por padrão no Windows 10 1803+, macOS e Linux).
 * Se faltar, falha com razão EXPLÍCITA e acionável em vez de um erro cru de spawn — nunca
 * instala pela metade.
 */
function extractTgz(tgz, dest) {
  try {
    execFileSync("tar", ["--version"], { stdio: "ignore" });
  } catch {
    return { ok: false, reason: "`tar` não encontrado no PATH — necessário para extrair o artefato (Windows 10 1803+, macOS e Linux já trazem). Instale-o e tente de novo." };
  }
  try {
    execFileSync("tar", ["-xzf", tgz, "-C", dest], { stdio: "ignore" });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `extração (tar) falhou: ${e?.message || e}` };
  }
}

/**
 * Tenta claim do lock de provisionamento. Grava o PID para diagnóstico e reclama locks
 * órfãos (mais velhos que {@link LOCK_STALE_MS}) — sem isso, um processo morto entre o
 * `openSync` e o `finally` travaria todos os consumidores para sempre.
 */
function claimLock(lock) {
  try {
    const fd = openSync(lock, "wx");
    try { writeFileSync(lock, String(process.pid)); } catch { /* diagnóstico é best-effort */ }
    return fd;
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
        unlinkSync(lock);
        const fd = openSync(lock, "wx");
        try { writeFileSync(lock, String(process.pid)); } catch { /* ignore */ }
        return fd;
      }
    } catch { /* outro consumidor ganhou a corrida */ }
    return null;
  }
}

const parseVer = (v) => String(v || "").split(".").map((n) => parseInt(n, 10) || 0);

/** true se a versão instalada serve o pin: MESMO major e >= (protocolo é atado ao major). */
export function satisfiesPin(installed, pinned) {
  const a = parseVer(installed), b = parseVer(pinned);
  if (a[0] !== b[0]) { return false; }
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x > y) { return true; }
    if (x < y) { return false; }
  }
  return true;
}

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex").toLowerCase();
}

async function fetchBuf(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return Buffer.from(await res.arrayBuffer());
}

/** Lê a versão instalada a partir do package.json do artefato (se houver). */
function installedVersion(binDir) {
  try { return JSON.parse(readFileSync(join(binDir, "package.json"), "utf8")).version; } catch { return null; }
}

/**
 * Garante o motor instalado. `onBeforeReplace` é o gancho de shutdown do MOTOR (o kit nunca
 * adivinha como derrubar um daemon: quem sabe é o descritor/consumidor).
 * @returns {Promise<{ok:true, entryPath:string, version:string, reused?:boolean, installed?:boolean} | {ok:false, reason:string}>}
 */
export async function provision(engine, { log = () => {}, allowNetwork = true, onBeforeReplace, downloadTimeoutMs = 120000 } = {}) {
  const home = engine.homeDir;
  const binDir = join(home, engine.install.extractTo ?? "bin");
  const entryPath = join(home, engine.install.entry);
  const lock = join(home, "provision.lock");

  // Já instalado? Só reusa se a versão instalada for LEGÍVEL e satisfizer o pin.
  // Versão ilegível (package.json ausente/corrompido = extração interrompida, disco cheio,
  // arquivo truncado) NÃO é motivo para reusar: é estado desconhecido → reprovisiona.
  // Reusar aqui seria fail-open silencioso — o oposto do resto do kit — e congelaria a máquina
  // numa instalação quebrada para sempre, ignorando o pin do registry.
  if (existsSync(entryPath)) {
    const inst = installedVersion(binDir);
    if (inst && satisfiesPin(inst, engine.version)) {
      return { ok: true, entryPath, version: inst, reused: true };
    }
    if (!inst) {
      log(`[engine-kit] ${engine.name}: instalação em estado desconhecido (versão ilegível) → reprovisionando`);
      if (!allowNetwork) {
        return { ok: false, reason: `${engine.name}: instalação em estado desconhecido (package.json ausente/corrompido em ${binDir}) e rede desabilitada — não dá para validar nem reparar` };
      }
    } else {
      log(`[engine-kit] ${engine.name}: instalada v${inst} não satisfaz o pin v${engine.version} → atualizando`);
    }
  }

  if (!allowNetwork) { return { ok: false, reason: `${engine.name} ausente/desatualizado e rede desabilitada` }; }
  if (engine.status === "pending-release") {
    return { ok: false, reason: `${engine.name} ainda não publicou release (status: pending-release)` };
  }

  mkdirSync(home, { recursive: true });

  // LOCK atômico: só um consumidor provisiona; os demais aguardam o resultado dele.
  // Um lock órfão (processo morto) é reclamado por idade — não trava a máquina para sempre.
  const lockFd = claimLock(lock);
  if (lockFd === null) {
    for (let i = 0; i < 40; i++) {
      if (existsSync(entryPath)) {
        const inst = installedVersion(binDir);
        // Se o vencedor terminou mas a versão continua ilegível, não invente: sinalize.
        if (inst) { return { ok: true, entryPath, version: inst, reused: true }; }
      }
      await sleep(1000);
    }
    return { ok: false, reason: `${engine.name}: provision-locked-timeout (outro consumidor está instalando há >40s)` };
  }

  try {
    // 1) SHA256 sidecar OBRIGATÓRIO (fail-closed).
    let expected;
    try {
      const buf = await fetchBuf(engine.checksumUrl, 15000);
      expected = String(buf).trim().split(/\s+/)[0].toLowerCase();
    } catch (e) {
      return { ok: false, reason: `${engine.name}: sha256 sidecar inacessível (${e.status || e.message}) → ABORT (fail-closed)` };
    }
    if (!/^[0-9a-f]{64}$/.test(expected)) {
      return { ok: false, reason: `${engine.name}: sha256 sidecar malformado → ABORT` };
    }

    // 2) Download → .part → rename atômico.
    log(`[engine-kit] baixando ${engine.assetUrl} …`);
    let buf;
    try { buf = await fetchBuf(engine.assetUrl, downloadTimeoutMs); }
    catch (e) { return { ok: false, reason: `${engine.name}: download falhou (${e.status || e.message})` }; }
    const part = join(home, `${engine.assetName}.part`);
    const tgz = join(home, engine.assetName);
    writeFileSync(part, buf);
    renameSync(part, tgz);

    // 3) Integridade (mismatch = apaga + ABORT).
    const actual = sha256File(tgz);
    if (actual !== expected) {
      try { unlinkSync(tgz); } catch { /* ignore */ }
      return { ok: false, reason: `${engine.name}: SHA256 mismatch (esperado ${expected.slice(0, 12)}…, obtido ${actual.slice(0, 12)}…) → ABORT` };
    }

    // 4) Extrai em staging e faz o swap (com shutdown-first se já existe).
    const staging = join(home, `stage-${engine.version}`);
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    const ex = extractTgz(tgz, staging);
    if (!ex.ok) { return { ok: false, reason: `${engine.name}: ${ex.reason}` }; }

    if (existsSync(binDir)) {
      if (onBeforeReplace) { try { await onBeforeReplace(); } catch { /* best-effort */ } }
      rmSync(binDir, { recursive: true, force: true });
    }
    renameSync(staging, binDir);
    try { unlinkSync(tgz); } catch { /* ignore */ }

    if (!existsSync(entryPath)) {
      return { ok: false, reason: `${engine.name}: artefato extraído incompleto (sem ${engine.install.entry})` };
    }
    log(`[engine-kit] ${engine.name} instalado em ${binDir} (v${engine.version})`);
    return { ok: true, entryPath, version: engine.version, installed: true };
  } catch (e) {
    return { ok: false, reason: `${engine.name}: provision falhou: ${e?.message || e}` };
  } finally {
    try { closeSync(lockFd); unlinkSync(lock); } catch { /* ignore */ }
  }
}
