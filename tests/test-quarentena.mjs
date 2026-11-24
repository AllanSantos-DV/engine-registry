// test-quarentena.mjs — a versão que não subiu fica de lado até o registry oferecer outra; `version` explícito sempre vale.
//
// Sem isto, enquanto o registry oferecesse a versão ruim, cada `ensure` baixava, derrubava o motor, trocava, falhava e voltava.
// A quarentena sai do `history.jsonl` (volta gravada com via "rollback"), sem arquivo novo.
// Hermético: HOME e trust.json isolados, registry em servidor local, download injetado, motores-fantasma que se encerram sozinhos.
import "./_tmp.mjs";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = mkdtempSync(join(tmpdir(), "ee-quarentena-"));
Object.assign(process.env, { HOME: ROOT, USERPROFILE: ROOT, ENGINE_KIT_HOME: join(ROOT, "trust-home") });
const { ensureEngine, generateKeyPairHex, signBlob } = await import("../kit/index.mjs");
const { tarBinary } = await import("../kit/provision.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const HOME = join(ROOT, "motor");
const owner = generateKeyPairHex();
const RUINS = new Set(["1.1.0"]);
const motorDe = (version) => `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
${RUINS.has(version) ? "process.exit(1);\n" : ""}writeFileSync(join(process.env.FAKE_HOME, "runtime.json"), JSON.stringify({ pid: process.pid, version: "${version}" }));
setTimeout(() => process.exit(0), 8000);
`;

const artefatos = {};
for (const version of ["1.0.0", "1.1.0", "1.1.1"]) {
  const src = join(ROOT, `src-${version}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "motor", version }));
  writeFileSync(join(src, "e.mjs"), motorDe(version));
  const tgz = `${src}.tgz`;
  execFileSync(tarBinary(), ["-czf", tgz, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  const blob = readFileSync(tgz);
  artefatos[version] = { blob, sig: signBlob(blob, owner.privateKeyHex) };
}
const baixados = [];
const fetcher = async (url) => {
  const [, version, file] = /download\/v([^/]+)\/(.+)$/.exec(url) ?? [];
  const a = artefatos[version];
  if (!a) { throw Object.assign(new Error("HTTP 404"), { status: 404 }); }
  if (file.endsWith(".sha256")) { return Buffer.from(`${createHash("sha256").update(a.blob).digest("hex")}  e.tgz`); }
  if (file.endsWith(".sig")) { return a.sig; }
  baixados.push(version);
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
const ensure = (extra = {}, log = () => {}) => ensureEngine("motor", {
  healthCheck, fetcher, refresh: true, bootTimeoutMs: 3000, log, env: { FAKE_HOME: HOME },
  registryUrl: `http://127.0.0.1:${registry.address().port}/manifest.json`, trustedKeys: { motor: owner.publicKeyHex }, ...extra,
});
const historico = () => readFileSync(join(ROOT, "trust-home", "history.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const quedas = () => historico().filter((e) => e.via === "rollback").length;

console.log("== quarentena da versão que não subiu ==");
const primeira = await ensure();
check("instala e sobe a v1.0.0", primeira.available === true && instalada() === "1.0.0", primeira.reason);

oferecida = "1.1.0";
const um = await ensure();
check("1º ensure com a v1.1.0 ruim: tenta, não sobe e volta (como antes)", um.available === true && um.engine.installedVersion === "1.0.0" && um.engine.rolledBack?.version === "1.1.0", JSON.stringify(um.engine?.rolledBack ?? um.reason));
check("a tentativa baixou a v1.1.0 uma vez", baixados.filter((v) => v === "1.1.0").length === 1, baixados.join(","));

const logs = [];
const dois = await ensure({}, (m) => logs.push(m));
const tres = await ensure();
check("2º e 3º ensure não baixam de novo a versão que falhou", baixados.filter((v) => v === "1.1.0").length === 1, baixados.join(","));
check("2º e 3º ensure não derrubam o motor: nenhuma queda nova no histórico", quedas() === 1 && historico().length === 3, JSON.stringify(historico().map((e) => e.via)));
check("o motor da v1.0.0 segue no ar e o disco fica na v1.0.0", dois.available === true && tres.available === true && instalada() === "1.0.0" && dois.engine.installedVersion === "1.0.0");
check("o retorno diz qual versão está em quarentena", dois.engine?.quarantined?.version === "1.1.0" && !dois.engine.rolledBack, JSON.stringify(dois.engine?.quarantined));
check("o aviso é visível e diz como sair", logs.some((m) => /v1\.1\.0 em quarentena/.test(m) && /--version/.test(m)), logs.join(" | "));
check("a versão nova disponível continua anunciada", dois.engine?.updateAvailable === "1.1.0", dois.engine?.updateAvailable);

const explicita = await ensure({ version: "1.1.0" });
check("`version` explícita ignora a quarentena e tenta a versão", baixados.filter((v) => v === "1.1.0").length === 2 && explicita.engine?.rolledBack?.version === "1.1.0", baixados.join(","));
check("a tentativa explícita não instala a ruim sem subir: o disco volta à v1.0.0", instalada() === "1.0.0");

oferecida = "1.1.1";
const nova = await ensure();
check("o registry oferece outra versão: sai da quarentena e instala sem rollback", nova.available === true && nova.engine.installedVersion === "1.1.1" && !nova.engine.quarantined && !nova.engine.rolledBack, JSON.stringify(nova.engine?.quarantined ?? nova.reason));
check("a versão nova instalada é a v1.1.1", instalada() === "1.1.1");

registry.close();
await new Promise((r) => setTimeout(r, 300));
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
