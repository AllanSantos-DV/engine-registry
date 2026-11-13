// test-rollback-automatico.mjs — `ensureEngine` devolve a versão anterior quando a nova não sobe.
//
// Sem isto, uma atualização ruim deixava o motor quebrado no disco e `available:false` para sempre. Agora o swap guarda a
// pasta anterior até a nova responder; se não responde, volta para ela e diz o que aconteceu em `engine.rolledBack`.
// Hermético: HOME e trust.json isolados, registry em servidor local, download injetado, motores-fantasma que se encerram sozinhos.
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = mkdtempSync(join(tmpdir(), "ee-rollback-auto-"));
Object.assign(process.env, { HOME: ROOT, USERPROFILE: ROOT, ENGINE_KIT_HOME: join(ROOT, "trust-home") });
const { ensureEngine, generateKeyPairHex, signBlob } = await import("../kit/index.mjs");
const { tarBinary } = await import("../kit/provision.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const HOME = join(ROOT, "motor");
const owner = generateKeyPairHex();
const BOOM = { "1.1.0": "process.exit(1);\n" };
const motorDe = (version) => `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
${BOOM[version] ?? ""}writeFileSync(join(process.env.FAKE_HOME, "runtime.json"), JSON.stringify({ pid: process.pid, version: "${version}" }));
setTimeout(() => process.exit(0), 8000);
`;

const artefatos = {};
for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
  const src = join(ROOT, `src-${version}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "motor", version }));
  writeFileSync(join(src, "e.mjs"), motorDe(version));
  const tgz = `${src}.tgz`;
  execFileSync(tarBinary(), ["-czf", tgz, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  const blob = readFileSync(tgz);
  artefatos[version] = { blob, sig: signBlob(blob, owner.privateKeyHex) };
}
const fetcher = async (url) => {
  const [, version, file] = /download\/v([^/]+)\/(.+)$/.exec(url) ?? [];
  const a = artefatos[version];
  if (!a) { throw Object.assign(new Error("HTTP 404"), { status: 404 }); }
  if (file.endsWith(".sha256")) { return Buffer.from(`${createHash("sha256").update(a.blob).digest("hex")}  e.tgz`); }
  return file.endsWith(".sig") ? a.sig : a.blob;
};

let oferecida = "1.0.0";
const registry = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ engines: [{
  name: "motor", version: oferecida, kind: "daemon", summary: "fixture", home: HOME, runtime: { transport: "http", runtimeFile: "runtime.json" },
  install: { type: "github-release", repo: "x/y", tag: "v{version}", asset: "e.tgz", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/e.mjs", publicKey: owner.publicKeyHex, signatureRequired: true },
}] })));
await new Promise((r) => registry.listen(0, "127.0.0.1", r));

const instalada = () => JSON.parse(readFileSync(join(HOME, "bin", "package.json"), "utf8")).version;
const healthCheck = async (rt) => (rt?.version === instalada() ? { ok: true } : null);
const ensure = (log = () => {}) => ensureEngine("motor", {
  healthCheck, fetcher, refresh: true, bootTimeoutMs: 5000, log, env: { FAKE_HOME: HOME },
  registryUrl: `http://127.0.0.1:${registry.address().port}/manifest.json`, trustedKeys: { motor: owner.publicKeyHex },
});
const sobras = () => readdirSync(HOME).filter((f) => /^bin\.old-|^stage-/.test(f));

console.log("== rollback automático da atualização que não sobe ==");
const primeira = await ensure();
check("instala e sobe a v1.0.0", primeira.available === true && instalada() === "1.0.0", primeira.reason);

oferecida = "1.1.0";
const logs = [];
const ruim = await ensure((m) => logs.push(m));
check("a v1.1.0 não sobe e o ensure devolve o motor anterior no ar", ruim.available === true && ruim.engine.installedVersion === "1.0.0", JSON.stringify(ruim).slice(0, 300));
check("o retorno diz qual versão falhou e por quê", ruim.engine?.rolledBack?.version === "1.1.0" && /não anunciou/.test(ruim.engine.rolledBack.reason), JSON.stringify(ruim.engine?.rolledBack));
check("o disco voltou para a v1.0.0", instalada() === "1.0.0");
check("o log avisa a volta", logs.some((m) => /voltei para v1\.0\.0/.test(m)), logs.join(" | "));
check("não sobra pasta .old nem staging", sobras().length === 0, sobras().join(","));

oferecida = "1.2.0";
const boa = await ensure();
check("uma versão seguinte que sobe é instalada sem rollback", boa.available === true && boa.engine.installedVersion === "1.2.0" && !boa.engine.rolledBack, JSON.stringify(boa.engine?.rolledBack ?? boa.reason));
check("atualização boa também não deixa pasta anterior", sobras().length === 0 && instalada() === "1.2.0", sobras().join(","));

registry.close();
await new Promise((r) => setTimeout(r, 300));
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
