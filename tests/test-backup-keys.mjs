// test-backup-keys.mjs — backup cifrado das chaves de assinatura (tools/backup-keys.mjs).
//
// Só com pasta de chaves TEMPORÁRIA e HOME isolado: a pasta real de chaves nunca é lida. A frase-senha entra pela
// entrada padrão e não pode aparecer na saída nem nos arquivos.
import "./_tmp.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const TOOL = join(import.meta.dirname, "..", "tools", "backup-keys.mjs");
const RUN = mkdtempSync(join(tmpdir(), "ek-backup-keys-"));
const PASS = "cavalo correto bateria grampo";
let fail = 0;
const check = (name, cond, detail = "") => {
  console.log(`  ${cond ? "OK  " : "FALHOU"} ${name}${cond ? "" : ` — ${detail}`}`);
  if (!cond) fail++;
};

const run = (args, input = PASS) => {
  const p = spawnSync(process.execPath, [TOOL, ...args], {
    input: `${input}\n`, encoding: "utf8", windowsHide: true,
    env: { ...process.env, HOME: RUN, USERPROFILE: RUN },
  });
  return { code: p.status, out: `${p.stdout}${p.stderr}` };
};

const keys = join(RUN, "keys");
mkdirSync(keys);
const secrets = { "motor-a_ed25519_private.key": randomBytes(32).toString("hex"), "motor-b_ed25519_private.key": randomBytes(32).toString("hex") };
for (const [n, v] of Object.entries(secrets)) writeFileSync(join(keys, n), v);
const mediaA = join(RUN, "midia-a"), mediaB = join(RUN, "midia-b");
mkdirSync(mediaA); mkdirSync(mediaB);
const backupArgs = ["backup", "--from", keys, "--to", mediaA, "--to", mediaB, "--passphrase-stdin"];

console.log("== recusas antes de gravar ==");
const short = run([...backupArgs, "--allow-same-device"], "curta");
check("frase-senha curta é recusada", short.code === 1 && /curta demais/.test(short.out), short.out);
const one = run(["backup", "--from", keys, "--to", mediaA, "--passphrase-stdin", "--allow-same-device"]);
check("uma mídia só é recusada", one.code === 1 && /duas mídias/.test(one.out), one.out);
const same = run(backupArgs);
check("duas pastas no mesmo disco são recusadas", same.code === 1 && /mesmo disco/.test(same.out), same.out);
const inArg = run([...backupArgs, "--allow-same-device", "--passphrase", PASS]);
check("frase-senha em argumento é recusada", inArg.code === 1 && /opção desconhecida/.test(inArg.out), inArg.out);
check("nenhuma recusa gravou arquivo", readdirSync(mediaA).length + readdirSync(mediaB).length === 0, `${readdirSync(mediaA)} ${readdirSync(mediaB)}`);

console.log("\n== backup ==");
const b = run([...backupArgs, "--allow-same-device"]);
check("backup grava e confere as duas cópias", b.code === 0 && /relida e decifrada/.test(b.out), b.out);
const [fa] = readdirSync(mediaA), [fb] = readdirSync(mediaB);
const blobA = readFileSync(join(mediaA, fa)), blobB = readFileSync(join(mediaB, fb));
check("as duas mídias têm o mesmo arquivo", fa === fb && blobA.equals(blobB), `${fa} ${fb}`);
const leaks = Object.values(secrets).flatMap((v) => [v, Buffer.from(v).toString("base64")]).concat(PASS);
check("o arquivo não contém chave em claro nem a frase-senha", leaks.every((l) => !blobA.toString("latin1").includes(l)));
check("a saída não mostra a frase-senha nem as chaves", leaks.every((l) => !b.out.includes(l)), b.out);

console.log("\n== conferência de restauração ==");
const ok = run(["check", join(mediaA, fa), "--from", keys, "--passphrase-stdin"]);
check("check com a frase-senha certa confere as chaves", ok.code === 0 && /restaura as 2 chave/.test(ok.out), ok.out);
const wrong = run(["check", join(mediaA, fa), "--from", keys, "--passphrase-stdin"], "outra frase bem comprida");
check("frase-senha errada falha sem decifrar", wrong.code === 1 && /frase-senha errada ou arquivo adulterado/.test(wrong.out), wrong.out);
const tampered = join(RUN, "adulterado.ekb");
const t = Buffer.from(blobA); t[t.length - 1] ^= 1;
writeFileSync(tampered, t);
const bad = run(["check", tampered, "--from", keys, "--passphrase-stdin"]);
check("um byte adulterado falha sem decifrar", bad.code === 1 && /adulterado/.test(bad.out), bad.out);
const drift = join(RUN, "keys-drift");
mkdirSync(drift);
writeFileSync(join(drift, "motor-a_ed25519_private.key"), randomBytes(32).toString("hex"));
const diff = run(["check", join(mediaA, fa), "--from", drift, "--passphrase-stdin"]);
check("pasta de chaves diferente do backup é apontada", diff.code === 1 && /DIFERENTE/.test(diff.out) && /SÓ NO BACKUP|FALTA/.test(diff.out), diff.out);

console.log("\n== restauração ==");
const restored = join(RUN, "restaurada");
const r = run(["restore", join(mediaB, fb), "--to", restored, "--passphrase-stdin"]);
check("restore grava as chaves iguais às originais", r.code === 0 &&
  Object.entries(secrets).every(([n, v]) => existsSync(join(restored, n)) && readFileSync(join(restored, n), "utf8") === v), r.out);
const again = run(["restore", join(mediaB, fb), "--to", drift, "--passphrase-stdin"]);
check("restore não sobrescreve chave existente", again.code === 1 && /não sobrescrevo/.test(again.out) &&
  readFileSync(join(drift, "motor-a_ed25519_private.key"), "utf8") !== secrets["motor-a_ed25519_private.key"], again.out);

rmSync(RUN, { recursive: true, force: true });
console.log(fail ? `\n${fail} FALHA(S)` : "\nTUDO VERDE");
process.exit(fail ? 1 : 0);
