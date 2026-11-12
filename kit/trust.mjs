// engine-kit/trust.mjs — RAIZ DE CONFIANÇA local (fecha a circularidade do publicKey).
//
// O problema real: a `publicKey` que valida a assinatura vinha do MESMO `manifest.json` que o kit
// baixa. Quem controla o repo troca o `.tgz`, o `.sig` **e** a chave — e o fail-closed aprova
// tudo, porque as três coisas vêm da mesma origem. Integridade sem raiz de confiança externa é
// uma tranca cuja chave está pendurada na porta.
//
// O que isto resolve (e o que NÃO resolve, dito na cara):
//   • RESOLVE — troca de chave DEPOIS da primeira instalação (repo comprometido, release
//     substituída, rollback com chave nova): a chave fica gravada localmente na primeira vez
//     (TOFU) e qualquer divergência posterior é ABORT, não aviso.
//   • RESOLVE — pin explícito: o consumidor pode passar a chave que ele confia (`trustedKeys`),
//     e aí nem a primeira instalação depende do manifest. É o padrão do vox-engine (chave
//     embutida no consumidor) trazido para cá, sem obrigar todo consumidor a adotá-lo.
//   • NÃO RESOLVE — comprometimento ANTERIOR ao primeiro contato: se o repo já estava tomado na
//     primeira instalação, o TOFU grava a chave do atacante. Só transparência pública (Sigstore/
//     TUF) fecha isso, e essa é decisão de produto — está registrada, não esquecida.
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, statSync } from "node:fs";

// Lido a CADA chamada, não no import: assim um teste (ou um consumidor com HOME próprio) pode
// isolar a raiz de confiança sem depender da ordem de carregamento dos módulos. Foi a própria
// suíte que expôs isto — o motor-fake do teste de assinatura gera chave nova a cada execução e
// ficava preso na confiança da execução anterior.
const trustDir = () => process.env.ENGINE_KIT_HOME || join(homedir(), ".engine-kit");
const trustFile = () => join(trustDir(), "trust.json");

/**
 * Lê a raiz de confiança; ausente é `{}`. Existente e ilegível LANÇA: devolver `{}` faria a próxima gravação apagar
 * a chave do primeiro contato, a maior versão vista e o pin dos outros motores.
 */
export function readTrust() {
  const f = trustFile();
  if (!existsSync(f)) return {};
  try { const v = JSON.parse(readFileSync(f, "utf8")); if (v && typeof v == "object" && !Array.isArray(v)) return v; } catch {}
  throw Error(`${f} ilegível: nada foi gravado; corrija-o ou apague-o de propósito (perde chaves e pins)`);
}

/**
 * Lê, altera e grava a entrada de UM motor sob lock de arquivo, com escrita atômica (tmp + rename):
 * processos concorrentes não perdem gravação e uma queda no meio não deixa `trust.json` pela metade.
 * @param {string} name motor.
 * @param {(entry:object|undefined)=>object} change recebe a entrada atual e devolve a nova.
 * @returns {object} a entrada gravada; lança se não conseguir.
 */
export function updateEntry(name, change) {
  mkdirSync(trustDir(), { recursive: true });
  const lock = `${trustFile()}.lock`;
  const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  for (let i = 0; ; i++) {
    try { closeSync(openSync(lock, "wx")); break; }
    catch (e) {
      if ((e.code !== "EEXIST" && e.code !== "EPERM") || i > 250) { throw e; } // EPERM: Windows, lock em remoção
      try { if (Date.now() - statSync(lock).mtimeMs > 10000) { unlinkSync(lock); } } catch { /* outro processo liberou */ }
      nap(20);
    }
  }
  try {
    const store = readTrust(), next = change(store[name]), tmp = `${trustFile()}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...store, [name]: next }, null, 2));
    for (let t = 1; ; nap(50 * t++)) {
      try { renameSync(tmp, trustFile()); break; } catch (e) { if (t >= 8 || !/^(EBUSY|EPERM|EACCES)$/.test(e.code)) { throw e; } }
    }
    return next;
  } finally { try { unlinkSync(lock); } catch { /* já liberado */ } }
}

/**
 * Confronta a chave que veio do registry com a raiz de confiança local.
 * @returns {{ok:true, tofu:boolean} | {ok:false, reason:string}} lança só com trust.json ilegível (`readTrust`).
 */
export function checkTrust(engineName, publicKey, { trustedKeys } = {}) {
  const pinned = trustedKeys?.[engineName];
  if (pinned && pinned !== publicKey) {
    return { ok: false, reason: `${engineName}: chave do registry ≠ chave FIXADA pelo consumidor → ABORT (registry pode estar comprometido)` };
  }

  const store = readTrust();
  const known = store[engineName]?.publicKey;
  const mudou = () => ({
    ok: false,
    reason:
      `${engineName}: a chave pública MUDOU desde a primeira instalação → ABORT. ` +
      `Rotação legítima exige apagar a entrada em ${trustFile()} de propósito; ` +
      `se você não rotacionou, o registry pode estar comprometido.`,
  });
  if (known && known !== publicKey) { return mudou(); }
  if (known) return { ok: true, tofu: false };

  try {
    const gravada = updateEntry(engineName, (e) => (e?.publicKey ? e : { publicKey, firstSeen: new Date().toISOString(), source: pinned ? "pinned" : "tofu" }));
    if (gravada.publicKey !== publicKey) { return mudou(); }
  } catch {
    // Não poder gravar a raiz não impede a instalação, mas vira `saved:false`: a próxima execução repete o TOFU.
    return { ok: true, tofu: true, saved: false };
  }
  return { ok: true, tofu: true };
}

export const trustPath = trustFile;

/** Chave do primeiro contato: a do manifest embarcado no pacote, só no registry público. Lança se esse manifest for ilegível. */
export function firstContactKeys(name, registryUrl) {
  const key = !registryUrl && JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).engines.find((e) => e.name === name)?.install?.publicKey;
  if (key) return { [name]: key };
}

/** Compara versões `x.y.z` numericamente: negativo, zero ou positivo. */
export const cmpVer = (a, b) => String(a).localeCompare(String(b), "en", { numeric: true });

/** Motivo do ABORT se `version` é menor que a maior já instalada do motor (anti-rollback); falsy se pode seguir. */
export function rollbackReason(name, version) {
  const max = readTrust()[name]?.maxVersion;
  return max && cmpVer(version, max) < 0 && `${name}: v${version} < v${max} já instalada → ABORT (rollback; downgrade só com --version)`;
}

/** Versão em que o dono fixou o motor nesta máquina (`engine-kit pin`), ou undefined. */
export const pinOf = (name) => readTrust()[name]?.pin;

/** Grava `version` como a maior vista do motor, se superar a registrada. */
export function noteVersion(name, version) {
  const store = readTrust(), max = store[name]?.maxVersion;
  if (max && cmpVer(version, max) <= 0) return;
  try {
    updateEntry(name, (e) => (e?.maxVersion && cmpVer(version, e.maxVersion) <= 0 ? e : { ...e, maxVersion: version }));
  } catch { /* sem gravar, a proteção vale a partir da próxima instalação */ }
}
