// test-rollback-manual.mjs — `engine-kit rollback <motor>` volta o motor para a versão anterior à última troca do histórico e fixa nela.
//
// O que precisa ser verdade:
//   • sem troca gravada, ou só com a primeira instalação, recusa dizendo que não há versão anterior;
//   • depois de uma atualização, instala a versão anterior com a assinatura conferida, FIXA nela (o próximo ensure não atualiza de volta)
//     e grava a troca no histórico;
//   • instalação que não descreve o histórico (versão trocada na mão) é recusada, sem mexer no disco nem no pin;
//   • motor fora do manifest e motor self-managed são recusados com o motivo;
//   • versão anterior que não baixa não deixa pin novo e não toca o disco.
// Hermético: HOME, trust.json e histórico isolados; downloads de memória; o .tgz é real.
//
//   node tests/test-rollback-manual.mjs
import "./_tmp.mjs";
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "engine-rollback-"));
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: join(RUN, "trust-home"), ENGINE_KIT_NO_AUTO_UPDATE: "1" });
const { generateKeyPairHex, signBlob } = await import("../kit/index.mjs");
const { tarBinary } = await import("../kit/provision.mjs");
const { ensureCommand, rollbackCommand } = await import("../kit/ensure.mjs");
const { pinOf, historyPath } = await import("../kit/trust.mjs");
const { historyCommand } = await import("../kit/inspect.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const owner = generateKeyPairHex();

function tgzOf(version) {
  const src = join(RUN, `src-${version}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "fake-engine", version }));
  writeFileSync(join(src, "fake-engine.mjs"), 'console.log("ok");\n');
  execFileSync(tarBinary(), ["-czf", `${src}.tgz`, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  return readFileSync(`${src}.tgz`);
}

function serve(versions) {
  const map = {};
  for (const v of versions) {
    const blob = tgzOf(v), base = `https://github.com/x/y/releases/download/fake-engine-v${v}`;
    map[`${base}/fake-engine.tgz`] = blob;
    map[`${base}/fake-engine.tgz.sha256`] = Buffer.from(`${sha256(blob)}  fake-engine.tgz\n`);
    map[`${base}/fake-engine.tgz.sig`] = signBlob(blob, owner.privateKeyHex);
  }
  return async (url) => { if (!(url in map)) { const e = new Error("HTTP 404"); e.status = 404; throw e; } return map[url]; };
}

const HOMES = { "fake-engine": join(RUN, "home-a"), "fake-two": join(RUN, "home-b") };
const registry = (version) => ({ engines: Object.entries(HOMES).map(([name, home]) => ({
  name, version, kind: "cli", summary: "fixture", home, ...(name === "fake-two" ? { status: "self-managed" } : {}),
  install: { repo: "x/y", tag: "fake-engine-v{version}", asset: "fake-engine.tgz", checksum: "{asset}.sha256",
    extractTo: "bin", entry: "bin/fake-engine.mjs", publicKey: owner.publicKeyHex, signatureAlgorithm: "ed25519-sha256-raw" },
})) });
const onDisk = () => { try { return JSON.parse(readFileSync(join(HOMES["fake-engine"], "bin", "package.json"), "utf8")).version; } catch { return null; } };
const fetcher = serve(["1.0.0", "1.1.0"]);
const com = (version) => { const m = registry(version); return { bundled: m, manifest: m, fetcher }; };

console.log("== engine-kit rollback ==\n");

{
  const r = await rollbackCommand("fake-engine", com("1.1.0"));
  check("sem troca gravada: recusa dizendo que não há versão anterior", !r.ok && /nenhuma troca registrada/.test(r.reason), r.reason);
}

{
  const a = await ensureCommand("fake-engine", com("1.0.0"));
  const r = await rollbackCommand("fake-engine", com("1.0.0"));
  check("só a primeira instalação gravada: recusa e diz que foi a primeira", a.ok && !r.ok && /primeira instalação/.test(r.reason), r.reason);
  check("a recusa não fixa nada e não mexe no disco", pinOf("fake-engine") === undefined && onDisk() === "1.0.0");
}

{
  const up = await ensureCommand("fake-engine", com("1.1.0"));
  check("atualização para v1.1.0 gravada no histórico", up.ok && onDisk() === "1.1.0" && historyCommand("fake-engine").entries.at(-1)?.from === "1.0.0", up.reason);

  const r = await rollbackCommand("fake-engine", com("1.1.0"));
  check("rollback volta para v1.0.0 com a assinatura conferida", r.ok && r.version === "1.0.0" && r.signed === true && onDisk() === "1.0.0", r.reason ?? JSON.stringify(r));
  check("o motor fica fixado na versão anterior", r.pinned === "1.0.0" && pinOf("fake-engine") === "1.0.0");
  const last = historyCommand("fake-engine").entries.at(-1);
  check("a volta entra no histórico (de v1.1.0 para v1.0.0)", last?.from === "1.1.0" && last?.to === "1.0.0", JSON.stringify(last));

  const again = await ensureCommand("fake-engine", com("1.1.0"));
  check("o próximo ensure NÃO atualiza de volta (o pin vale)", again.ok && again.reused && again.version === "1.0.0" && onDisk() === "1.0.0", JSON.stringify(again));
}

{
  const pkg = join(HOMES["fake-engine"], "bin", "package.json");
  writeFileSync(pkg, JSON.stringify({ name: "fake-engine", version: "1.1.0" }));
  const r = await rollbackCommand("fake-engine", com("1.1.0"));
  check("instalação que não é a da última troca é recusada com o caminho certo", !r.ok && /não descreve a instalação atual/.test(r.reason) && /pin fake-engine --version/.test(r.reason), r.reason);
  check("a recusa deixa o disco e o pin como estavam", onDisk() === "1.1.0" && pinOf("fake-engine") === "1.0.0");
  writeFileSync(pkg, JSON.stringify({ name: "fake-engine", version: "1.0.0" }));
}

{
  appendFileSync(historyPath(), `${JSON.stringify({ ts: new Date().toISOString(), engine: "fantasma", from: "1.0.0", to: "1.1.0", via: "ensure" })}\n`);
  const f = await rollbackCommand("fantasma", com("1.1.0"));
  check("motor fora do manifest é recusado mandando atualizar o kit", !f.ok && /não está no manifest/.test(f.reason) && /engine-kit@latest rollback fantasma/.test(f.reason), f.reason);
  appendFileSync(historyPath(), `${JSON.stringify({ ts: new Date().toISOString(), engine: "fake-two", from: "1.0.0", to: "1.1.0", via: "ensure" })}\n`);
  const s = await rollbackCommand("fake-two", com("1.1.0"));
  check("motor self-managed é recusado: o updater dele decide a versão", !s.ok && /self-managed/.test(s.reason), s.reason);
}

{
  appendFileSync(historyPath(), `${JSON.stringify({ ts: new Date().toISOString(), engine: "fake-engine", from: "0.9.0", to: "1.0.0", via: "ensure" })}\n`);
  const r = await rollbackCommand("fake-engine", com("1.1.0"));
  check("versão anterior que não baixa: falha com o motivo e o pin anterior volta", !r.ok && /pin não aplicado/.test(r.reason) && /pin anterior v1\.0\.0 restaurado/.test(r.reason), r.reason);
  check("o disco continua em v1.0.0 e o pin em v1.0.0", onDisk() === "1.0.0" && pinOf("fake-engine") === "1.0.0");
}

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
