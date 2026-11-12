// test-neural-link-register.mjs — `engine-kit ensure neural-link --register` registra os hooks; sem a flag o ensure só instala.
//
// O install() é o do próprio motor: aqui um fake no tarball que grava um marcador no HOME isolado. Prova que o ensure por
// si só não o roda e que `registerNeuralLink` roda o do binário instalado e propaga a falha dele.
// Hermético: HOME e trust.json em pasta temporária, download injetado, o config global de hooks real nunca é tocado.
//
//   node tests/test-neural-link-register.mjs
import { mkdirSync, writeFileSync, existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "nl-register-"));
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: join(RUN, "trust-home") });
const { generateKeyPairHex, signBlob } = await import("../kit/index.mjs");
const { tarBinary } = await import("../kit/provision.mjs");
const { ensureCommand } = await import("../kit/ensure.mjs");
const { registerNeuralLink } = await import("../consumers/neural-link.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const MARCA = join(RUN, "install-rodou.json");

function tgzOf(installJs) {
  const src = join(RUN, "src");
  mkdirSync(join(src, "src"), { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "neural-link", version: "1.0.0", type: "module" }));
  writeFileSync(join(src, "src", "index.js"), "");
  writeFileSync(join(src, "src", "install.js"), installJs);
  const tgz = `${src}.tgz`;
  execFileSync(tarBinary(), ["-czf", tgz, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  return readFileSync(tgz);
}

const owner = generateKeyPairHex();
async function instalar(home, installJs) {
  const blob = tgzOf(installJs);
  const sig = signBlob(blob, owner.privateKeyHex);
  const base = "https://github.com/x/y/releases/download/v1.0.0";
  const map = { [`${base}/nl.tgz`]: blob, [`${base}/nl.tgz.sha256`]: Buffer.from(`${sha256(blob)}  nl.tgz\n`), [`${base}/nl.tgz.sig`]: sig };
  const m = { engines: [{ name: "neural-link", version: "1.0.0", kind: "cli", summary: "fixture", home,
    install: { repo: "x/y", tag: "v{version}", asset: "nl.tgz", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/src/index.js", publicKey: owner.publicKeyHex, signatureAlgorithm: "ed25519-sha256-raw" } }] };
  return ensureCommand("neural-link", { bundled: m, manifest: m, fetcher: async (u) => map[u] });
}

const fakeInstall = `import { writeFileSync } from "node:fs";
export function install() { writeFileSync(${JSON.stringify(MARCA)}, "{}"); return { written: ["a", "b"], companions: { selados: ["c"] } }; }
`;

{
  const r = await instalar(join(RUN, "home-ok"), fakeInstall);
  check("o ensure instala o dispatcher", r.ok === true, r.ok ? "" : r.reason);
  check("o ensure sozinho não roda o install() do motor (nada é registrado sem a flag)", !existsSync(MARCA));
  const reg = await registerNeuralLink(r.entryPath);
  check("registerNeuralLink roda o install() do binário instalado e devolve o resultado dele", existsSync(MARCA) && reg.written.length === 2 && reg.companions.selados.length === 1, JSON.stringify(reg));
}

{
  const r = await instalar(join(RUN, "home-falha"), `export function install() { throw new Error("config global sem permissão de escrita"); }\n`);
  let erro = null;
  try { await registerNeuralLink(r.entryPath); } catch (e) { erro = e; }
  check("falha do install() do motor sobe para quem chamou (o CLI mostra FALHOU)", erro?.message === "config global sem permissão de escrita", String(erro));
}

const cli = (args) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["kit/cli.mjs", ...args], { cwd: new URL("..", import.meta.url), windowsHide: true, env: { ...process.env, ENGINE_KIT_NO_AUTO_UPDATE: "1" } });
  let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  p.on("close", (code) => resolve({ code, out }));
});
for (const args of [["ensure", "vxk", "--register"], ["pin", "neural-link", "--register"], ["doctor", "--register"]]) {
  const r = await cli(args);
  check(`\`${args.join(" ")}\`: --register fora do ensure neural-link é recusado`, r.code === 1 && /--register só vale para/.test(r.out), r.out.trim());
}
check("o uso do bin lista --register e o stop", /--register/.test((await cli(["--help"])).out) && /engine-kit stop/.test((await cli(["--help"])).out));
check("a CLI registra pelo kit, sem importar o adaptador de consumers/", !/consumers\//.test(readFileSync(new URL("../kit/cli.mjs", import.meta.url), "utf8")));
check("o adaptador de consumers/ segue exportando registerNeuralLink", typeof (await import("../consumers/neural-link.mjs")).registerNeuralLink === "function");

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
