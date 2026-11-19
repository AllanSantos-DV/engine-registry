// test-historico.mjs — cada troca de versão vira uma linha de `history.jsonl` (ts, engine, from, to, via), e `engine-kit history` a lê.
//
// Origens gravadas: ensure (primeira instalação), auto-update (troca sem versão pedida), version (versão exata: pin ou --version) e
// rollback (a atualização que não subiu). Reuso de instalação não é troca. Falha de escrita não derruba a instalação, mas é avisada.
// Hermético: HOME e ENGINE_KIT_HOME isolados, registry em servidor local, download injetado, motores-fantasma que se encerram sozinhos.
//
//   node tests/test-historico.mjs
import "./_tmp.mjs";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const ROOT = mkdtempSync(join(tmpdir(), "ee-historico-"));
const KIT_HOME = join(ROOT, "kit-home");
Object.assign(process.env, { HOME: ROOT, USERPROFILE: ROOT, ENGINE_KIT_HOME: KIT_HOME });
const { ensureEngine, generateKeyPairHex, signBlob } = await import("../kit/index.mjs");
const { tarBinary } = await import("../kit/provision.mjs");
const { ensureCommand } = await import("../kit/ensure.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

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
for (const version of ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]) {
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

const descritor = (version) => ({
  name: "motor", version, kind: "daemon", summary: "fixture", home: HOME, runtime: { transport: "http", runtimeFile: "runtime.json" },
  install: { type: "github-release", repo: "x/y", tag: "v{version}", asset: "e.tgz", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/e.mjs", publicKey: owner.publicKeyHex, signatureRequired: true },
});
let oferecida = "1.0.0";
const registry = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ engines: [descritor(oferecida)] })));
await new Promise((r) => registry.listen(0, "127.0.0.1", r));

const instalada = () => JSON.parse(readFileSync(join(HOME, "bin", "package.json"), "utf8")).version;
const healthCheck = async (rt) => (rt?.version === instalada() ? { ok: true } : null);
const ensure = (extra = {}) => ensureEngine("motor", {
  healthCheck, fetcher, refresh: true, bootTimeoutMs: 15000, env: { FAKE_HOME: HOME },
  registryUrl: `http://127.0.0.1:${registry.address().port}/manifest.json`, trustedKeys: { motor: owner.publicKeyHex }, ...extra,
});
const historico = () => {
  try { return readFileSync(join(process.env.ENGINE_KIT_HOME, "history.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};
const troca = (l) => (l ? `${l.from ?? "-"}>${l.to}:${l.via}` : "(sem linha)");

console.log("== histórico local de trocas de versão ==");
await ensure();
check("a primeira instalação grava from:null, via ensure", historico().map(troca).join() === "->1.0.0:ensure", historico().map(troca).join());
const [primeira] = historico();
check("a linha traz ts ISO, engine, from, to e via", primeira && !Number.isNaN(Date.parse(primeira.ts)) && new Date(primeira.ts).toISOString() === primeira.ts && primeira.engine === "motor" && primeira.from === null, JSON.stringify(primeira));

await ensure();
check("reusar a instalação não é troca: nenhuma linha nova", historico().length === 1, historico().map(troca).join());

oferecida = "1.1.0";
await ensure();
check("atualização que não sobe grava a troca e a volta (rollback)", historico().slice(1).map(troca).join() === "1.0.0>1.1.0:auto-update,1.1.0>1.0.0:rollback", historico().map(troca).join());

oferecida = "1.2.0";
await ensure();
check("atualização que sobe grava auto-update", troca(historico().at(-1)) === "1.0.0>1.2.0:auto-update", historico().map(troca).join());

const rebaixada = await ensure({ version: "1.0.0", allowDowngrade: true });
check("versão exata (allowDowngrade) grava via version", troca(historico().at(-1)) === "1.2.0>1.0.0:version", `${historico().map(troca).join()} | ${rebaixada.engine?.rolledBack?.reason ?? rebaixada.reason ?? ""}`);

const m = { engines: [descritor("1.2.0")] };
const cmd = await ensureCommand("motor", { version: "1.2.0", bundled: m, manifest: m, fetcher });
check("`ensure --version` (ensureCommand) grava via version", cmd.ok && troca(historico().at(-1)) === "1.0.0>1.2.0:version", cmd.ok ? historico().map(troca).join() : cmd.reason);
const cmd2 = await ensureCommand("motor", { bundled: { engines: [descritor("1.3.0")] }, manifest: { engines: [descritor("1.3.0")] }, fetcher });
check("ensureCommand sem versão atualiza com via auto-update", cmd2.ok && troca(historico().at(-1)) === "1.2.0>1.3.0:auto-update", cmd2.ok ? historico().map(troca).join() : cmd2.reason);

console.log("\n-- falha de escrita: instala, mas avisa em voz alta --");
const bloqueado = join(ROOT, "kit-home-bloqueado");
mkdirSync(join(bloqueado, "history.jsonl"), { recursive: true });
process.env.ENGINE_KIT_HOME = bloqueado;
oferecida = "1.2.0";
const avisos = [];
const aviso = console.warn;
console.warn = (...a) => avisos.push(a.join(" "));
const r = await ensure({ version: "1.2.0", allowDowngrade: true });
console.warn = aviso;
check("a instalação segue de pé apesar de o histórico não gravar", r.available === true && instalada() === "1.2.0", r.reason);
check("o aviso diz que o histórico não foi gravado e onde", avisos.some((a) => /histórico/.test(a) && a.includes("history.jsonl")), avisos.join(" | "));
process.env.ENGINE_KIT_HOME = KIT_HOME;

console.log("\n-- engine-kit history --");
const stub = join(ROOT, "offline.mjs");
writeFileSync(stub, `globalThis.fetch = async () => { throw Object.assign(new Error("offline"), { cause: { code: "ECONNREFUSED" } }); };\n`);
const cli = (...args) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["--import", pathToFileURL(stub).href, "kit/cli.mjs", ...args], {
    cwd: new URL("..", import.meta.url), windowsHide: true,
    env: { ...process.env, ENGINE_KIT_NO_AUTO_UPDATE: "1" },
  });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ code, out, err }));
});
const todas = historico();
const txt = await cli("history");
check("history lista cada troca, em ordem, com from → to e a origem", txt.code === 0 && /motor/.test(txt.out) && /1\.0\.0 → 1\.1\.0/.test(txt.out) && /rollback/.test(txt.out) && txt.out.trim().split("\n").length === todas.length, `exit ${txt.code} ${txt.out}${txt.err}`);
check("a primeira instalação aparece como instalação, sem 'null'", /\(nenhuma\) → 1\.0\.0/.test(txt.out) && !/null/.test(txt.out), txt.out);
const js = await cli("history", "motor", "--json");
const parsed = (() => { try { return JSON.parse(js.out); } catch { return null; } })();
check("history <motor> --json imprime só o array JSON", js.code === 0 && Array.isArray(parsed) && parsed.length === todas.length && parsed.every((l) => l.engine === "motor"), js.out.slice(0, 200));
const outro = await cli("history", "outro-motor");
check("motor sem trocas: diz que não há, exit 0", outro.code === 0 && /nenhuma troca/.test(outro.out), outro.out + outro.err);
const outroJson = await cli("history", "outro-motor", "--json");
check("motor sem trocas em --json: array vazio", outroJson.code === 0 && JSON.parse(outroJson.out).length === 0, outroJson.out);
const so = await cli("history", "--json");
check("`history --json` sem motor lista todos", so.code === 0 && JSON.parse(so.out).length === todas.length, so.out.slice(0, 100));
const flag = await cli("history", "motor", "--fix");
check("flag que o verbo não aceita é recusada", flag.code === 1 && /--fix não vale/.test(flag.err), flag.err);
const uso = await cli("--help");
check("o uso lista o verbo history", /engine-kit history/.test(uso.out), uso.out);

appendFileSync(join(KIT_HOME, "history.jsonl"), "isto não é json\n");
const ruim = await cli("history");
check("linha ilegível no histórico: erro com o número da linha, exit 1", ruim.code === 1 && new RegExp(`linha ${todas.length + 1}\\b`).test(ruim.err), `exit ${ruim.code} ${ruim.err}`);

registry.close();
await new Promise((r2) => setTimeout(r2, 300));
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
