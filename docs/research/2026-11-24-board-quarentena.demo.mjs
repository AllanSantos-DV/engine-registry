/**
 * Mede o que o `ensure` faz hoje quando o registry continua oferecendo uma versão que já falhou: três `ensure` seguidos, com a
 * v1.1.0 oferecida e sem subir. Hermético: HOME e trust.json isolados, registry local, download injetado, motor-fantasma.
 *
 *   node docs/research/2026-11-24-board-quarentena.demo.mjs > docs/research/2026-11-24-board-quarentena.saida.txt
 */
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const ROOT = mkdtempSync(join(tmpdir(), "ee-quarentena-"));
Object.assign(process.env, { HOME: ROOT, USERPROFILE: ROOT, ENGINE_KIT_HOME: join(ROOT, "trust-home") });
const kit = (f) => import(pathToFileURL(join(process.cwd(), "kit", f)).href);
const { ensureEngine, generateKeyPairHex, signBlob } = await kit("index.mjs");
const { tarBinary } = await kit("provision.mjs");

const say = (s) => console.log(String(s).split(ROOT).join("<tmp>"));
const HOME = join(ROOT, "motor");
const owner = generateKeyPairHex();
const motorDe = (version) => `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
${version === "1.1.0" ? "process.exit(1);\n" : ""}writeFileSync(join(process.env.FAKE_HOME, "runtime.json"), JSON.stringify({ pid: process.pid, version: "${version}" }));
setTimeout(() => process.exit(0), 8000);
`;
const artefatos = {};
for (const version of ["1.0.0", "1.1.0"]) {
  const src = join(ROOT, `src-${version}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "motor", version }));
  writeFileSync(join(src, "e.mjs"), motorDe(version));
  execFileSync(tarBinary(), ["-czf", `${src}.tgz`, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  const blob = readFileSync(`${src}.tgz`);
  artefatos[version] = { blob, sig: signBlob(blob, owner.privateKeyHex) };
}
let baixados = 0;
const fetcher = async (url) => {
  const [, version, file] = /download\/v([^/]+)\/(.+)$/.exec(url) ?? [];
  const a = artefatos[version];
  if (file.endsWith(".sha256")) { return Buffer.from(`${createHash("sha256").update(a.blob).digest("hex")}  e.tgz`); }
  if (file.endsWith(".sig")) { return a.sig; }
  baixados++;
  return a.blob;
};
let oferecida = "1.0.0";
const registry = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ engines: [{
  name: "motor", version: oferecida, kind: "daemon", summary: "fixture", home: HOME, runtime: { transport: "http", runtimeFile: "runtime.json" },
  install: { type: "github-release", repo: "x/y", tag: "v{version}", asset: "e.tgz", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/e.mjs", publicKey: owner.publicKeyHex, signatureRequired: true },
}] })));
await new Promise((r) => registry.listen(0, "127.0.0.1", r));

const instalada = () => JSON.parse(readFileSync(join(HOME, "bin", "package.json"), "utf8")).version;
const healthCheck = async (rt) => (rt?.version === instalada() ? { ok: true } : null);
const ensure = (log) => ensureEngine("motor", {
  healthCheck, fetcher, refresh: true, bootTimeoutMs: 3000, log, env: { FAKE_HOME: HOME },
  registryUrl: `http://127.0.0.1:${registry.address().port}/manifest.json`, trustedKeys: { motor: owner.publicKeyHex },
});

await ensure(() => {});
say(`motor v${instalada()} instalado e no ar; o registry passa a oferecer a v1.1.0, que não sobe.\n`);
oferecida = "1.1.0";
for (let n = 1; n <= 3; n++) {
  const antes = baixados;
  const logs = [];
  const t0 = Date.now();
  const r = await ensure((m) => logs.push(m));
  say(`--- ensure nº ${n} (versão que já falhou continua oferecida) ---`);
  logs.forEach((l) => say(l));
  say(`resultado: available=${r.available} instalada=v${r.engine?.installedVersion} rolledBack=${JSON.stringify(r.engine?.rolledBack)}`);
  say(`downloads neste ensure: ${baixados - antes}; ${Date.now() - t0} ms\n`);
}
const hist = readFileSync(join(ROOT, "trust-home", "history.jsonl"), "utf8").trim().split("\n");
say(`history.jsonl (${hist.length} linhas):`);
hist.forEach((l) => { const j = JSON.parse(l); say(`  ${j.engine} ${j.from ?? "-"} -> ${j.to} via ${j.via}`); });
registry.close();
await new Promise((r) => setTimeout(r, 300));
rmSync(ROOT, { recursive: true, force: true });
