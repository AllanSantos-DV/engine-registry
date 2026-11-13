// test-verificacao-da-instalacao.mjs — `doctor --verify` e `diagnoseEngines({verify})` acusam ADULTERADO quando um arquivo extraído muda ou some.
//
// O provision grava o sha256 de cada arquivo extraído dentro da pasta instalada; a conferência é sob demanda e `--fix` reinstala.
// Hermético: HOME e trust.json isolados, registry local, download injetado.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = mkdtempSync(join(tmpdir(), "ee-verifica-"));
const env = { ...process.env, HOME: ROOT, USERPROFILE: ROOT, ENGINE_KIT_HOME: join(ROOT, "trust-home") };
Object.assign(process.env, env);
const { provision, generateKeyPairHex, signBlob } = await import("../kit/index.mjs");
const { tarBinary } = await import("../kit/provision.mjs");
const { diagnoseEngines, verifyInstall } = await import("../kit/diagnose.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const src = join(ROOT, "src");
mkdirSync(join(src, "lib"), { recursive: true });
writeFileSync(join(src, "package.json"), JSON.stringify({ name: "motor", version: "1.0.0" }));
writeFileSync(join(src, "e.mjs"), "console.log(1);\n");
writeFileSync(join(src, "lib", "dentro.mjs"), "export const x = 1;\n");
const tgz = join(ROOT, "e.tgz");
execFileSync(tarBinary(), ["-czf", tgz, "-C", src, "."], { stdio: "ignore", windowsHide: true });
const blob = readFileSync(tgz);
const dono = generateKeyPairHex();
const fetcher = async (url) => {
  if (url.endsWith(".sha256")) { return Buffer.from(createHash("sha256").update(blob).digest("hex")); }
  if (url.endsWith(".sig")) { return signBlob(blob, dono.privateKeyHex); }
  return blob;
};
const manifest = { engines: [{ name: "motor", version: "1.0.0", kind: "cli", summary: "fixture", home: join(ROOT, "home"),
  install: { type: "github-release", repo: "x/y", tag: "v{version}", asset: "e.tgz", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/e.mjs", publicKey: dono.publicKeyHex, signatureRequired: true } }] };
const verificar = async () => (await diagnoseEngines({ local: true, verify: true, manifest })).rows[0];
const engine = (await diagnoseEngines({ local: true, manifest })).rows[0].engine;

const p = await provision(engine, { fetcher });
check("instala o motor", p.ok, p.reason);

let r = await verificar();
check("instalação intacta confere", r.state === "OK" && r.integrity.state === "OK", JSON.stringify(r.integrity));

writeFileSync(join(engine.homeDir, "bin", "lib", "dentro.mjs"), "export const x = 2;\n");
r = await verificar();
check("arquivo alterado vira ADULTERADO e o detalhe diz qual", r.state === "ADULTERADO" && /alterado: lib\/dentro\.mjs/.test(r.detail) && r.needsWork, r.detail);

rmSync(join(engine.homeDir, "bin", "lib", "dentro.mjs"));
r = await verificar();
check("arquivo removido vira ADULTERADO", r.state === "ADULTERADO" && /ausente: lib\/dentro\.mjs/.test(r.detail), r.detail);

const sem = (await diagnoseEngines({ local: true, manifest })).rows[0];
check("sem --verify o diagnóstico não confere hashes e segue como antes", sem.state === "OK" && !sem.integrity, sem.state);

const repara = await provision(engine, { fetcher, repair: true });
check("provision com repair reinstala a mesma versão", repara.ok && repara.installed === true, JSON.stringify(repara));
r = await verificar();
check("depois do reparo volta a conferir", r.state === "OK" && r.integrity.state === "OK", r.detail);

rmSync(join(engine.homeDir, "bin", ".engine-kit-files.json"));
check("instalação sem registro de hashes é SEM-REGISTRO, não ADULTERADO", verifyInstall(engine).state === "SEM-REGISTRO");

const cli = spawnSync(process.execPath, [join(import.meta.dirname, "..", "kit", "doctor.mjs"), "--local", "--verify", "--json", "--engine", "embed-house"], { env, encoding: "utf8", windowsHide: true });
check("o doctor aceita --verify sem erro de uso", cli.status === 0 || cli.status === 1, cli.stderr);

rmSync(ROOT, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
