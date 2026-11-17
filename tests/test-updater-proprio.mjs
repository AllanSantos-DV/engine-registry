// test-updater-proprio.mjs — motor com atualizador próprio (`runtime.updatePath`) convive com o engine-kit sem um desfazer o outro.
//
// O kit instala quando o motor não está na máquina (ou quando o dono pede uma versão exata); depois disso quem troca a versão é
// o updater do motor. Garantias: o `ensure` não baixa nem troca a instalação presente, nem para mais nova nem para mais velha
// que a do registry; o `doctor` não manda atualizar nem acusa ADULTERADO uma instalação que o motor mexeu; `--version` e `--repair` continuam
// valendo de propósito; motor `pending-release` não é ação do doctor e o `ensure` diz que a release não saiu.
// Hermético: HOME e trust.json isolados, downloads de memória, o .tgz é real.
//
//   node tests/test-updater-proprio.mjs
import "./_tmp.mjs";
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "engine-updater-"));
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: join(RUN, "trust-home"), ENGINE_KIT_NO_AUTO_UPDATE: "" });
const { generateKeyPairHex, signBlob } = await import("../kit/index.mjs");
const { tarBinary } = await import("../kit/provision.mjs");
const { ensureCommand } = await import("../kit/ensure.mjs");
const { ensureEngine } = await import("../kit/index.mjs");
const { diagnoseEngines } = await import("../kit/diagnose.mjs");

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const owner = generateKeyPairHex();

function tgzOf(name, version) {
  const src = join(RUN, `src-${name}-${version}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name, version }));
  writeFileSync(join(src, `${name}.mjs`), 'console.log("ok");\n');
  execFileSync(tarBinary(), ["-czf", `${src}.tgz`, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  return readFileSync(`${src}.tgz`);
}

function serve(names, versions) {
  const map = {};
  for (const name of names) {
    for (const v of versions) {
      const blob = tgzOf(name, v), base = `https://github.com/x/y/releases/download/${name}-v${v}`;
      map[`${base}/${name}.tgz`] = blob;
      map[`${base}/${name}.tgz.sha256`] = Buffer.from(`${sha256(blob)}  ${name}.tgz\n`);
      map[`${base}/${name}.tgz.sig`] = signBlob(blob, owner.privateKeyHex);
    }
  }
  const fetcher = async (url) => {
    fetcher.calls.push(url);
    if (!(url in map)) { const e = new Error("HTTP 404"); e.status = 404; throw e; }
    return map[url];
  };
  fetcher.calls = [];
  return fetcher;
}

const RUNTIME = { runtimeFile: "run/daemon.json", healthPath: "/health", shutdownPath: "/shutdown", updatePath: "/update" };
const engine = (name, version, extra = {}) => ({
  name, version, kind: "cli", summary: "fixture", home: join(RUN, `home-${name}`), runtime: { ...RUNTIME }, ...extra,
  install: { type: "github-release", repo: "x/y", tag: `${name}-v{version}`, asset: `${name}.tgz`, checksum: "{asset}.sha256", extractTo: "bin",
    entry: `bin/${name}.mjs`, publicKey: owner.publicKeyHex, signatureAlgorithm: "ed25519-sha256-raw", signatureRequired: true },
});
const registry = (version, status) => ({ engines: [
  engine("com-updater", version, status ? { status } : {}),
  engine("sem-updater", version, { runtime: undefined }),
] });
const onDisk = (name) => JSON.parse(readFileSync(join(RUN, `home-${name}`, "bin", "package.json"), "utf8")).version;
const selfUpdate = (name, version) => writeFileSync(join(RUN, `home-${name}`, "bin", "package.json"), JSON.stringify({ name, version }));
const ensure = (name, version, opts = {}) => { const m = registry(version); return ensureCommand(name, { bundled: m, manifest: m, ...opts }); };

console.log("== motor com atualizador próprio ==\n");
const dl = serve(["com-updater", "sem-updater"], ["1.0.0", "1.1.0", "1.2.0"]);

{
  console.log("-- o kit instala o que não está na máquina --");
  const r = await ensure("com-updater", "1.0.0", { fetcher: dl });
  check("primeira instalação baixa e instala a v1.0.0", r.ok && !r.reused && onDisk("com-updater") === "1.0.0", r.reason ?? JSON.stringify(r));
}

{
  console.log("\n-- depois de instalado, quem atualiza é o motor --");
  dl.calls.length = 0;
  const r = await ensure("com-updater", "1.1.0", { fetcher: dl });
  check("registry mais novo: reusa a instalada, sem baixar nem trocar", r.ok && r.reused && r.version === "1.0.0" && dl.calls.length === 0 && onDisk("com-updater") === "1.0.0", JSON.stringify(r));
  check("o retorno avisa a versão que o registry anuncia", r.available === "1.1.0", JSON.stringify(r));

  selfUpdate("com-updater", "1.2.0");
  dl.calls.length = 0;
  const up = await ensure("com-updater", "1.1.0", { fetcher: dl });
  check("o motor se atualizou para a 1.2.0: o kit não volta para a 1.1.0", up.ok && up.reused && up.version === "1.2.0" && dl.calls.length === 0 && onDisk("com-updater") === "1.2.0", JSON.stringify(up));
  check("registry mais velho que a instalada não vira aviso de atualização", up.available === undefined, JSON.stringify(up));
  selfUpdate("com-updater", "1.0.0");
}

{
  console.log("\n-- o contraste: motor sem updater próprio continua sendo atualizado pelo kit --");
  await ensure("sem-updater", "1.0.0", { fetcher: dl });
  const r = await ensure("sem-updater", "1.1.0", { fetcher: dl });
  check("sem updatePath o ensure troca 1.0.0 → 1.1.0", r.ok && r.version === "1.1.0" && onDisk("sem-updater") === "1.1.0", r.reason ?? JSON.stringify(r));
}

{
  console.log("\n-- o pedido explícito do dono continua valendo --");
  const r = await ensure("com-updater", "1.2.0", { fetcher: dl, version: "1.1.0" });
  check("--version 1.1.0 instala exatamente essa versão", r.ok && r.version === "1.1.0" && onDisk("com-updater") === "1.1.0", r.reason ?? JSON.stringify(r));
}

{
  console.log("\n-- a lib (ensureEngine) também deixa a instalação presente com o motor --");
  const servidor = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(registry("1.2.0"))));
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const registryUrl = `http://127.0.0.1:${servidor.address().port}/manifest.json`;
  dl.calls.length = 0;
  const e = await ensureEngine("com-updater", { registryUrl, refresh: true, fetcher: dl, healthCheck: async () => ({}) });
  check("registry v1.2.0 e instalada v1.1.0: não baixa nem troca", e.available && dl.calls.length === 0 && onDisk("com-updater") === "1.1.0", e.reason ?? dl.calls.join(", "));
  check("engine.updateAvailable traz a versão anunciada", e.engine?.updateAvailable === "1.2.0", JSON.stringify(e.engine?.updateAvailable));
  servidor.close();
}

{
  console.log("\n-- doctor: não manda atualizar nem acusa adulteração do que o updater do motor mexeu --");
  const m = registry("1.2.0");
  selfUpdate("com-updater", "1.0.0");
  const d = await diagnoseEngines({ local: true, manifest: m, only: "com-updater", verify: true });
  const row = d.rows?.[0];
  check("instalada abaixo do registry: estado OK e nenhuma ação", d.ok && row.state === "OK" && row.needsWork === false, JSON.stringify(row && { state: row.state, detail: row.detail }));
  check("o detalhe diz que o motor atualiza pelo próprio updater", /updater/.test(row?.detail ?? ""), row?.detail);
  check("a conferência de hashes não acusa ADULTERADO o que o updater do motor trocou", row?.integrity === undefined, JSON.stringify(row?.integrity));
  const ctl = await diagnoseEngines({ local: true, manifest: m, only: "sem-updater" });
  check("controle: motor sem updater próprio fica DESATUALIZADO", ctl.rows?.[0]?.state === "DESATUALIZADO", ctl.rows?.[0]?.state);
}

{
  console.log("\n-- motor pending-release --");
  const m = { engines: [engine("ainda-sem-release", "0.1.0", { status: "pending-release" })] };
  const d = await diagnoseEngines({ local: true, manifest: m });
  check("o doctor mostra SEM-RELEASE e não pede ação", d.ok && d.rows[0].state === "SEM-RELEASE" && d.rows[0].needsWork === false, JSON.stringify(d.rows?.[0] && { state: d.rows[0].state, needsWork: d.rows[0].needsWork }));
  const r = await ensureCommand("ainda-sem-release", { bundled: m, manifest: m, fetcher: dl });
  check("o ensure diz que a release ainda não saiu, sem baixar nada", !r.ok && /pending-release/.test(r.reason), r.reason);
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
