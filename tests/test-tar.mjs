// test-tar.mjs — o engine-kit extrai com o tar NATIVO no Windows, mesmo com o GNU tar do Git Bash na
// frente do PATH (caso real: Copilot/Claude abertos de um terminal Git Bash). Antes, `tar -xzf C:\...`
// pelo PATH caía no GNU tar, que lê "C:" como host remoto, e a instalação de qualquer motor falhava.
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { tarBinary } from "../kit/provision.mjs";

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

// escolha do binário (pura)
check("win32 com System32\\tar.exe → nativo", tarBinary({ platform: "win32", systemRoot: "C:\\Windows", exists: () => true }) === join("C:\\Windows", "System32", "tar.exe"));
check("win32 sem tar nativo → PATH", tarBinary({ platform: "win32", systemRoot: "C:\\Windows", exists: () => false }) === "tar");
check("linux/mac → tar do PATH", tarBinary({ platform: "linux", systemRoot: undefined }) === "tar");

// extração real com o GNU tar na frente do PATH (só onde o cenário existe)
const gitTar = "C:\\Program Files\\Git\\usr\\bin";
if (process.platform === "win32" && existsSync(join(gitTar, "tar.exe"))) {
  const root = join(tmpdir(), `engine-kit-tar-${Date.now()}`), src = join(root, "src"), dest = join(root, "dest");
  mkdirSync(src, { recursive: true }); mkdirSync(dest);
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
  const tgz = join(root, "x.tgz");
  execFileSync(tarBinary(), ["-czf", tgz, "-C", src, "."]);
  const env = { ...process.env, PATH: gitTar + ";" + process.env.PATH };
  let gnuFails = false;
  try { execFileSync("tar", ["-xzf", tgz, "-C", dest], { env, stdio: "ignore" }); } catch { gnuFails = true; }
  check("cenário reproduzido: GNU tar do PATH falha com caminho C:\\", gnuFails);
  let ok = true;
  try { execFileSync(tarBinary(), ["-xzf", tgz, "-C", dest], { env, stdio: "ignore" }); } catch { ok = false; }
  check("tarBinary() extrai mesmo com o Git Bash na frente do PATH", ok && existsSync(join(dest, "package.json")));
  rmSync(root, { recursive: true, force: true });
} else {
  console.log("  --   (sem Git Bash nesta máquina: a extração real não se aplica)");
}
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
