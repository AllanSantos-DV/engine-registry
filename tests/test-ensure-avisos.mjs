// test-ensure-avisos.mjs — o `ensure` não instala calado em situação degradada:
//   • registry inacessível e descritor em cache vencido → o retorno marca `staleCache` (o CLI avisa);
//   • motor `cli` com ponteiro `cli.json` quebrado → o retorno traz o estado do ponteiro (o CLI avisa).
// HOME, cache do registry e raiz de confiança isolados antes de importar o kit; nada de rede real.
//
//   node tests/test-ensure-avisos.mjs
import { mkdirSync, writeFileSync, readFileSync, utimesSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const RUN = join(tmpdir(), `engine-ensure-avisos-${process.pid}-${Date.now()}`);
mkdirSync(RUN, { recursive: true });
process.env.USERPROFILE = RUN;
process.env.HOME = RUN;
process.env.ENGINE_KIT_HOME = join(RUN, "trust-home");
const { generateKeyPairHex, signBlob } = await import("../kit/index.mjs");
const { tarBinary } = await import("../kit/provision.mjs");
const { ensureCommand } = await import("../kit/ensure.mjs");

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const owner = generateKeyPairHex();
const src = join(RUN, "src");
mkdirSync(src);
writeFileSync(join(src, "package.json"), JSON.stringify({ name: "fake-engine", version: "1.2.3" }));
writeFileSync(join(src, "fake-engine.mjs"), 'console.log("ok");\n');
execFileSync(tarBinary(), ["-czf", join(RUN, "fake.tgz"), "-C", src, "."], { stdio: "ignore", windowsHide: true });
const tgz = readFileSync(join(RUN, "fake.tgz"));
const base = "https://github.com/x/y/releases/download/fake-engine-v1.2.3/fake-engine.tgz";
const files = { [base]: tgz, [`${base}.sha256`]: Buffer.from(`${sha256(tgz)}  fake-engine.tgz\n`), [`${base}.sig`]: signBlob(tgz, owner.privateKeyHex) };
const fetcher = async (url) => { if (!(url in files)) { const e = new Error("HTTP 404"); e.status = 404; throw e; } return files[url]; };
const manifestWith = (home) => ({ engines: [{
  name: "fake-engine", version: "1.2.3", kind: "cli", summary: "fixture", home,
  install: { repo: "x/y", tag: "fake-engine-v{version}", asset: "fake-engine.tgz", checksum: "{asset}.sha256",
    extractTo: "bin", entry: "bin/fake-engine.mjs", publicKey: owner.publicKeyHex, signatureAlgorithm: "ed25519-sha256-raw" },
}] });
// Porta 9 (discard) no loopback: recusa a conexão na hora, sem tocar a rede.
const REGISTRY_FORA = "http://127.0.0.1:9/manifest.json";

console.log("== avisos do ensure ==\n");

{
  const m = manifestWith(join(RUN, "home-cache"));
  const cache = join(RUN, ".engine-kit", "manifest.json");
  mkdirSync(join(RUN, ".engine-kit"), { recursive: true });
  writeFileSync(cache, JSON.stringify(m));
  const seteHorasAtras = new Date(Date.now() - 7 * 3600 * 1000);
  utimesSync(cache, seteHorasAtras, seteHorasAtras);
  const r = await ensureCommand("fake-engine", { bundled: m, registryUrl: REGISTRY_FORA, fetcher });
  check("registry fora do ar e cache vencido: instala e marca staleCache", r.ok && r.staleCache === true, r.ok ? JSON.stringify({ staleCache: r.staleCache }) : r.reason);
  rmSync(join(RUN, ".engine-kit"), { recursive: true, force: true });
}

{
  const home = join(RUN, "home-ponteiro");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "cli.json"), JSON.stringify({ mcp: join(RUN, "nao-existe", "mcp.mjs") }));
  const m = manifestWith(home);
  const r = await ensureCommand("fake-engine", { bundled: m, manifest: m, fetcher });
  check("motor cli com cli.json apontando para caminho inexistente: o retorno traz QUEBRADO", r.ok && r.pointer?.state === "QUEBRADO", r.ok ? JSON.stringify(r.pointer) : r.reason);
  check("registry respondeu (manifest entregue): sem staleCache", r.ok && r.staleCache === undefined);
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
