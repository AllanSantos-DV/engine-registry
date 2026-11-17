// engine-kit/key-backup.mjs — quais chaves de assinatura ainda não têm backup conferido.
//
// O `backup` e o `check` de tools/backup-keys.mjs gravam, ao lado da pasta de chaves, o sha256 de cada chave que
// conferiram; a mídia offline não é lida aqui. Chave nova ou trocada depois disso entra no lembrete.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { SIGNING_DIR } from "./keystore.mjs";

/** Registro do último backup conferido de uma pasta de chaves. */
export const backupStampFor = (dir) => `${dir}.backup.json`;

const hashes = (dir) => Object.fromEntries(readdirSync(dir).sort()
  .filter((n) => statSync(join(dir, n)).isFile())
  .map((n) => [n, createHash("sha256").update(readFileSync(join(dir, n))).digest("hex")]));

/** Grava o sha256 das chaves que acabaram de ser conferidas contra o backup. */
export function stampBackup(dir) {
  const out = backupStampFor(dir), tmp = `${out}.tmp`;
  writeFileSync(tmp, JSON.stringify({ checkedAt: new Date().toISOString(), keys: hashes(dir) }, null, 2));
  renameSync(tmp, out);
}

/**
 * Chaves da pasta sem backup conferido: sem registro, ausentes dele ou com conteúdo diferente do conferido.
 * @returns {{dir: string, missing: string[], reason?: string}}
 */
export function keysWithoutBackup(dir = SIGNING_DIR) {
  if (!existsSync(dir)) return { dir, missing: [] };
  const now = hashes(dir), stamp = backupStampFor(dir);
  let seen = {}, reason;
  if (existsSync(stamp)) {
    try { seen = JSON.parse(readFileSync(stamp, "utf8")).keys ?? {}; }
    catch (e) { reason = `registro ${stamp} ilegível (${e.message})`; }
  }
  return { dir, missing: Object.keys(now).filter((n) => seen[n] !== now[n]), ...(reason && { reason }) };
}

/** Texto do lembrete, ou null quando toda chave tem backup conferido. */
export function backupReminder({ dir, missing, reason }) {
  if (!missing.length) return null;
  return `lembrete: ${missing.length} chave(s) de assinatura sem backup conferido em ${dir}: ${missing.join(", ")}`
    + `${reason ? ` (${reason})` : ""}. Sem a chave não há rotação; no clone do engine-registry: `
    + "node tools/backup-keys.mjs backup --to <mídia A> --to <mídia B>";
}
