// test-hash-em-fluxo.mjs — o registro de hashes dos arquivos extraídos (`hashTree`) lê cada arquivo em pedaços.
//
// Um motor cujo .tgz traz um arquivo de GB (pesos de modelo) não pode ocupar esse tamanho em memória depois de extraído:
//   • `provision` instala um artefato com um arquivo de 192 MiB e o pico de RSS fica muito abaixo desse tamanho;
//   • o hash gravado em `.engine-kit-files.json` é o sha256 verdadeiro do arquivo;
//   • um byte alterado no arquivo grande é acusado por `verifyInstall` (ADULTERADO), e o intacto confere (OK);
//   • artefato com sha256 errado continua recusado, sem instalar nada.
// Hermético: fetcher falso, tar do sistema, pasta temporária.
//
//   node tests/test-hash-em-fluxo.mjs
import "./_tmp.mjs";
import { mkdirSync, writeFileSync, readFileSync, existsSync, openSync, writeSync, closeSync, createReadStream } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairHex, signBlob } from "../kit/index.mjs";
import { provision, tarBinary, FILES_MANIFEST } from "../kit/provision.mjs";
import { verifyInstall } from "../kit/diagnose.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const RUN = join(tmpdir(), `engine-hash-${Date.now()}`);
mkdirSync(RUN, { recursive: true });
process.env.ENGINE_KIT_HOME = join(RUN, "trust-home");
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, LOCALAPPDATA: join(RUN, "local-app-data") });

const MIB = 1024 * 1024;
const GRANDE = 192 * MIB;
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const owner = generateKeyPairHex();
const ASSET = "https://example.invalid/hash.tgz";

const src = join(RUN, "src");
mkdirSync(join(src, "pesos"), { recursive: true });
writeFileSync(join(src, "package.json"), JSON.stringify({ name: "hash-engine", version: "1.0.0" }));
writeFileSync(join(src, "hash.mjs"), "export {};\n");
{
  const fd = openSync(join(src, "pesos", "modelo.bin"), "w");
  const pedaco = Buffer.alloc(MIB, 7);
  for (let i = 0; i < GRANDE / MIB; i++) { writeSync(fd, pedaco); }
  closeSync(fd);
}
execFileSync(tarBinary(), ["-czf", `${src}.tgz`, "-C", src, "."], { stdio: "ignore", windowsHide: true });
const body = readFileSync(`${src}.tgz`);

const engineOf = (n) => ({
  name: "hash-engine", version: "1.0.0", kind: "cli", homeDir: join(RUN, `home-${n}`),
  assetName: "hash.tgz", assetUrl: ASSET, checksumUrl: `${ASSET}.sha256`, signatureUrl: `${ASSET}.sig`,
  install: { entry: "bin/hash.mjs", extractTo: "bin", publicKey: owner.publicKeyHex, signatureRequired: true },
});
const fetcherOf = (sha, sig) => async (url, ms, opts = {}) => {
  if (url === `${ASSET}.sha256`) { return Buffer.from(`${sha}  hash.tgz\n`); }
  if (url === `${ASSET}.sig`) { return sig; }
  return body;
};
const keys = { "hash-engine": owner.publicKeyHex };

async function hashDoArquivo(path) {
  const h = createHash("sha256");
  for await (const pedaco of createReadStream(path)) { h.update(pedaco); }
  return h.digest("hex");
}

console.log("\n-- arquivo grande extraído --");
const engine = engineOf(1);
const base = process.resourceUsage().maxRSS;
const r = await provision(engine, { trustedKeys: keys, fetcher: fetcherOf(sha256(body), signBlob(body, owner.privateKeyHex)) });
const cresceuMiB = (process.resourceUsage().maxRSS - base) / 1024;
check("instalou", r.ok && r.installed === true, r.ok ? "" : r.reason);
check(`o pico de RSS ficou muito abaixo do arquivo extraído (+${cresceuMiB.toFixed(1)} MiB de ${GRANDE / MIB})`, cresceuMiB < GRANDE / MIB / 2);

const bin = join(engine.homeDir, "bin");
const registro = JSON.parse(readFileSync(join(bin, FILES_MANIFEST), "utf8"));
check("o registro tem o hash verdadeiro do arquivo grande", registro["pesos/modelo.bin"] === await hashDoArquivo(join(bin, "pesos", "modelo.bin")));
check("o registro cobre os arquivos pequenos e não a si mesmo", !!registro["package.json"] && !!registro["hash.mjs"] && !(FILES_MANIFEST in registro));
check("verifyInstall confere a instalação intacta", verifyInstall(engine).state === "OK", verifyInstall(engine).detail);

{
  const fd = openSync(join(bin, "pesos", "modelo.bin"), "r+");
  writeSync(fd, Buffer.from([99]), 0, 1, GRANDE - 1);
  closeSync(fd);
  const v = verifyInstall(engine);
  check("um byte alterado no arquivo grande é acusado", v.state === "ADULTERADO" && v.changed.includes("pesos/modelo.bin"), v.detail);
}

console.log("\n-- artefato corrompido continua recusado --");
{
  const e2 = engineOf(2);
  const ruim = await provision(e2, { trustedKeys: keys, fetcher: fetcherOf(sha256(Buffer.from("outro")), signBlob(body, owner.privateKeyHex)) });
  check("sha256 errado recusa", !ruim.ok && /SHA256 mismatch/.test(ruim.reason), ruim.reason);
  check("nada instalado", !existsSync(join(e2.homeDir, "bin")));
}

console.log(failures ? `\n${failures} falha(s)` : "\nOK");
process.exit(failures ? 1 : 0);
