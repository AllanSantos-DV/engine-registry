// test-lembrete-backup.mjs — lembrete de chave de assinatura sem backup conferido (kit/key-backup.mjs).
//
// HOME isolado e pasta de chaves temporária: a pasta real de chaves e o registro real nunca são lidos. A frase-senha
// entra pela entrada padrão do tools/backup-keys.mjs.
import "./_tmp.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { keysWithoutBackup, backupStampFor, backupReminder } from "../kit/key-backup.mjs";

const ROOT = join(import.meta.dirname, "..");
const TOOL = join(ROOT, "tools", "backup-keys.mjs");
const CLI = join(ROOT, "kit", "cli.mjs");
const RUN = mkdtempSync(join(tmpdir(), "ek-lembrete-backup-"));
const PASS = "cavalo correto bateria grampo";
let fail = 0;
const check = (name, cond, detail = "") => {
  console.log(`  ${cond ? "OK  " : "FALHOU"} ${name}${cond ? "" : ` — ${detail}`}`);
  if (!cond) fail++;
};

const isolated = (home) => ({ ...process.env, HOME: home, USERPROFILE: home, ENGINE_KIT_HOME: join(home, ".engine-kit"), ENGINE_KIT_NO_AUTO_UPDATE: "1" });
const tool = (home, args, input = PASS) => {
  const p = spawnSync(process.execPath, [TOOL, ...args], { input: `${input}\n`, encoding: "utf8", windowsHide: true, env: isolated(home) });
  return { code: p.status, out: `${p.stdout}${p.stderr}` };
};
const doctor = (home, ...extra) => spawnSync(process.execPath, [CLI, "doctor", "--local", "--engine", "vxk", ...extra],
  { encoding: "utf8", windowsHide: true, cwd: home, env: isolated(home) });
const newKey = (dir, name) => writeFileSync(join(dir, name), randomBytes(32).toString("hex"));
const media = (home) => {
  const a = join(home, "midia-a"), b = join(home, "midia-b");
  mkdirSync(a, { recursive: true }); mkdirSync(b, { recursive: true });
  return ["--to", a, "--to", b, "--allow-same-device", "--passphrase-stdin"];
};

console.log("== sem pasta de chaves ==");
{
  const r = keysWithoutBackup(join(RUN, "nao-existe"));
  check("máquina sem pasta de chaves não tem lembrete", r.missing.length === 0 && backupReminder(r) === null, JSON.stringify(r));
}

console.log("\n== chaves sem registro de backup ==");
const keys = join(RUN, "keys");
mkdirSync(keys);
newKey(keys, "motor-a_ed25519_private.key");
newKey(keys, "motor-b_ed25519_private.key");
{
  const r = keysWithoutBackup(keys);
  check("sem registro, toda chave da pasta entra no lembrete", r.missing.join() === "motor-a_ed25519_private.key,motor-b_ed25519_private.key", JSON.stringify(r));
  const msg = backupReminder(r) ?? "";
  check("o lembrete nomeia as chaves e o comando de backup", /2 chave\(s\)/.test(msg) && /motor-a_ed25519_private\.key/.test(msg) && /tools\/backup-keys\.mjs backup --to/.test(msg), msg);
}

console.log("\n== backup conferido grava o registro ==");
const home = join(RUN, "home");
mkdirSync(home);
{
  const b = tool(home, ["backup", "--from", keys, ...media(home)]);
  check("(pré) backup das duas mídias passou", b.code === 0, b.out);
  check("o backup grava o registro ao lado da pasta de chaves", existsSync(backupStampFor(keys)), backupStampFor(keys));
  check("depois do backup, nenhuma chave fica no lembrete", keysWithoutBackup(keys).missing.length === 0, JSON.stringify(keysWithoutBackup(keys)));
  const stamp = readFileSync(backupStampFor(keys), "utf8");
  const secret = readFileSync(join(keys, "motor-a_ed25519_private.key"), "utf8");
  check("o registro não guarda a chave em claro", !stamp.includes(secret));
}

console.log("\n== chave nova ou trocada depois do backup ==");
{
  newKey(keys, "motor-c_ed25519_private.key");
  check("só a chave criada depois do backup entra no lembrete", keysWithoutBackup(keys).missing.join() === "motor-c_ed25519_private.key", JSON.stringify(keysWithoutBackup(keys)));
  rmSync(join(keys, "motor-c_ed25519_private.key"));
  newKey(keys, "motor-b_ed25519_private.key");
  check("chave com conteúdo diferente do conferido entra no lembrete", keysWithoutBackup(keys).missing.join() === "motor-b_ed25519_private.key", JSON.stringify(keysWithoutBackup(keys)));
}

console.log("\n== check ==");
{
  const keys2 = join(RUN, "keys2"), home2 = join(RUN, "home2");
  mkdirSync(keys2); mkdirSync(home2);
  newKey(keys2, "motor-x_ed25519_private.key");
  const b = tool(home2, ["backup", "--from", keys2, ...media(home2)]);
  const ekb = /gravado e conferido (.+\.ekb)/.exec(b.out)?.[1];
  rmSync(backupStampFor(keys2));
  const wrong = tool(home2, ["check", ekb, "--from", keys2, "--passphrase-stdin"], "outra frase bem comprida");
  check("check que falha não grava o registro", wrong.code === 1 && !existsSync(backupStampFor(keys2)), wrong.out);
  const ok = tool(home2, ["check", ekb, "--from", keys2, "--passphrase-stdin"]);
  check("check que confere grava o registro e tira a chave do lembrete", ok.code === 0 && keysWithoutBackup(keys2).missing.length === 0, ok.out);
}

console.log("\n== registro ilegível ==");
{
  const keys3 = join(RUN, "keys3");
  mkdirSync(keys3);
  newKey(keys3, "motor-y_ed25519_private.key");
  writeFileSync(backupStampFor(keys3), "{ não é json");
  const r = keysWithoutBackup(keys3);
  check("registro corrompido põe toda chave no lembrete e diz por quê", r.missing.join() === "motor-y_ed25519_private.key" && /ilegível/.test(backupReminder(r) ?? ""), JSON.stringify(r));
}

console.log("\n== doctor do bin ==");
{
  const homeD = join(RUN, "home-doctor"), signing = join(homeD, ".engine-signing");
  mkdirSync(signing, { recursive: true });
  newKey(signing, "motor-novo_ed25519_private.key");
  const sem = doctor(homeD);
  check("doctor mostra o lembrete quando uma chave não tem backup", /lembrete: 1 chave\(s\) de assinatura sem backup conferido/.test(sem.stdout) && /motor-novo_ed25519_private\.key/.test(sem.stdout), sem.stdout + sem.stderr);
  const json = doctor(homeD, "--json");
  let parsed = null;
  try { parsed = JSON.parse(json.stdout); } catch { /* o check abaixo reporta */ }
  check("doctor --json segue sendo JSON puro no stdout, com o lembrete no stderr", Array.isArray(parsed) && /lembrete: 1 chave/.test(json.stderr), json.stdout.slice(0, 200) + json.stderr);
  const b = tool(homeD, ["backup", ...media(homeD)]);
  check("(pré) backup da pasta padrão passou", b.code === 0, b.out);
  const com = doctor(homeD);
  check("doctor fica calado depois do backup conferido", !/lembrete/.test(com.stdout + com.stderr), com.stdout);
  const homeVazio = join(RUN, "home-sem-chaves");
  mkdirSync(homeVazio);
  const nenhuma = doctor(homeVazio);
  check("doctor fica calado numa máquina sem pasta de chaves", !/lembrete/.test(nenhuma.stdout + nenhuma.stderr), nenhuma.stdout);
}

console.log("\n== publish-base ==");
{
  const ps1 = readFileSync(join(ROOT, "kit", "publish-base.ps1"), "utf8");
  const line = /^\$lembrete = node -e "(.+)" \(Join-Path \$kit "key-backup\.mjs"\)$/m.exec(ps1);
  check("publish-base consulta o lembrete antes de assinar", line && line.index < ps1.indexOf("node (Join-Path $kit \"sign.mjs\")"), line ? "depois da assinatura" : "linha ausente");
  const homeP = join(RUN, "home-publish"), signing = join(homeP, ".engine-signing");
  mkdirSync(signing, { recursive: true });
  newKey(signing, "motor-pub_ed25519_private.key");
  const run = () => spawnSync(process.execPath, ["-e", line[1], join(ROOT, "kit", "key-backup.mjs")], { encoding: "utf8", windowsHide: true, env: isolated(homeP) });
  const sem = run();
  check("o trecho do publish-base imprime o lembrete da chave sem backup", sem.status === 0 && /motor-pub_ed25519_private\.key/.test(sem.stdout), sem.stdout + sem.stderr);
  tool(homeP, ["backup", ...media(homeP)]);
  const com = run();
  check("o trecho do publish-base fica calado depois do backup conferido", com.status === 0 && com.stdout.trim() === "", com.stdout + com.stderr);
}

rmSync(RUN, { recursive: true, force: true });
console.log(fail ? `\n${fail} FALHA(S)` : "\nTUDO VERDE");
process.exit(fail ? 1 : 0);
