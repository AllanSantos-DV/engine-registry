// test-por-plataforma.mjs — `install.byPlatform` sobrepõe o asset e o entry numa plataforma sem mexer nas outras.
//
// O motor de grafo nativo tem um executável .exe no Windows e um launcher sem extensão no Linux: o mesmo template de asset e o mesmo
// entry não servem aos dois. Sem rede: o descritor é resolvido do manifest.json do repositório, com a plataforma simulada.
//
//   node tests/test-por-plataforma.mjs
import "./_tmp.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolve, platformReason } from "../kit/resolve.mjs";
import { loadSchema, manifestErrors } from "../tools/schema-check.mjs";

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "manifest.json"), "utf8"));
let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const comoEm = async (platform, arch, name, version) => {
  const real = { platform: process.platform, arch: process.arch };
  Object.defineProperty(process, "platform", { value: platform });
  Object.defineProperty(process, "arch", { value: arch });
  try { return await resolve(name, { manifest, version }); }
  finally { Object.defineProperty(process, "platform", { value: real.platform }); Object.defineProperty(process, "arch", { value: real.arch }); }
};

const grafo = manifest.engines.find((e) => e.name === "motor-de-grafo");
const BASE = "https://github.com/AllanSantos-DV/engine-registry/releases/download/motor-de-grafo-v0.1.3";

check("o manifest com byPlatform passa no schema", manifestErrors(manifest, loadSchema()).length === 0, manifestErrors(manifest, loadSchema()).join("; "));
check("o motor de grafo declara o asset e o entry do linux-x64", grafo.install.byPlatform?.["linux-x64"]?.asset === "motor-de-grafo-linux-x64.tgz" && grafo.install.byPlatform["linux-x64"].entry === "bin/motor-de-grafo");
check("os campos do Windows ficam como estavam", grafo.install.asset === "motor-de-grafo.tgz" && grafo.install.entry === "bin/motor-de-grafo.exe" && grafo.platforms.includes("win32-x64"));

const linux = await comoEm("linux", "x64", "motor-de-grafo", "0.1.3");
check("linux-x64: o asset, o entry e o sidecar sha256 são os do Linux", linux.ok && linux.engine.assetUrl === `${BASE}/motor-de-grafo-linux-x64.tgz` && linux.engine.checksumUrl === `${BASE}/motor-de-grafo-linux-x64.tgz.sha256` && linux.engine.install.entry === "bin/motor-de-grafo", JSON.stringify(linux.engine?.install));
check("linux-x64: a assinatura segue o asset do Linux", linux.engine.signatureUrl === `${BASE}/motor-de-grafo-linux-x64.tgz.sig` && linux.engine.signatureName === "motor-de-grafo-linux-x64.tgz.sig");
check("linux-x64: chave, tag e runtime ficam os do motor", linux.engine.install.publicKey === grafo.install.publicKey && linux.engine.install.signatureRequired === true && linux.engine.runtime.shutdownPath === grafo.runtime.shutdownPath && linux.engine.runtime.updatePath === grafo.runtime.updatePath);

const win = await comoEm("win32", "x64", "motor-de-grafo", "0.1.3");
check("win32-x64: continua com motor-de-grafo.tgz e o .exe", win.ok && win.engine.assetUrl === `${BASE}/motor-de-grafo.tgz` && win.engine.install.entry === "bin/motor-de-grafo.exe", win.engine?.assetUrl);

const mac = await comoEm("darwin", "arm64", "motor-de-grafo", "0.1.3");
check("plataforma sem override usa o install base", mac.ok && mac.engine.assetUrl === `${BASE}/motor-de-grafo.tgz` && mac.engine.install.entry === "bin/motor-de-grafo.exe");

const semBuild = (e, plat) => platformReason(e, plat);
check("todo motor com byPlatform declara essa plataforma em platforms (o kit não recusa o que tem asset)", manifest.engines.filter((e) => e.install.byPlatform).every((e) => Object.keys(e.install.byPlatform).every((p) => (e.platforms ?? []).includes(p))), manifest.engines.filter((e) => e.install.byPlatform && !Object.keys(e.install.byPlatform).every((p) => (e.platforms ?? []).includes(p))).map((e) => e.name).join(", "));
check("motor-de-grafo: linux-x64 não é recusado e darwin-arm64 continua recusado", semBuild(grafo, "linux-x64") === null && semBuild(grafo, "darwin-arm64") !== null);

const usaPlataforma = (e) => /\{(platform|arch)\}/.test(e.install.asset);
const plataformasSemBuild = (m) => m.engines
  .filter((e) => e.install.entry?.endsWith(".exe") && !usaPlataforma(e))
  .flatMap((e) => (e.platforms ?? []).filter((p) => !p.startsWith("win32-") && !(p in (e.install.byPlatform ?? {}))).map((p) => `${e.name}:${p}`));

const sintetico = (extra) => ({ engines: [{ name: "x", platforms: ["win32-x64"], install: { asset: "x.tgz", entry: "bin/x.exe", ...extra } }] });
check("guarda das plataformas: .exe de asset único declarando linux-x64 sem byPlatform é apontado", plataformasSemBuild({ engines: [{ ...sintetico().engines[0], platforms: ["win32-x64", "linux-x64"] }] }).join() === "x:linux-x64");
check("guarda das plataformas: 'any' num .exe de asset único é apontado", plataformasSemBuild({ engines: [{ ...sintetico().engines[0], platforms: ["any"] }] }).join() === "x:any");
check("guarda das plataformas: byPlatform que cobre a plataforma, asset com {platform}/{arch} e só win32-* passam", plataformasSemBuild({ engines: [
  { ...sintetico({ byPlatform: { "linux-x64": { asset: "x-linux.tgz", entry: "bin/x" } } }).engines[0], platforms: ["win32-x64", "linux-x64"] },
  { ...sintetico({ asset: "x-{platform}-{arch}.tgz" }).engines[0], platforms: ["win32-x64", "linux-x64", "darwin-arm64"] },
  { ...sintetico().engines[0], platforms: ["win32-x64", "win32-arm64"] },
] }).length === 0);
check("guarda das plataformas: todo .exe de asset único do manifest real só declara win32-* (a casa fica só win32-x64 sem build publicado)", plataformasSemBuild(manifest).length === 0, plataformasSemBuild(manifest).join(", "));
check("a casa de embeddings declara só win32-x64", JSON.stringify(manifest.engines.find((e) => e.name === "casa-de-embeddings").platforms) === '["win32-x64"]');

const outro = await comoEm("linux", "x64", "embed-house", "1.0.5");
check("motor sem byPlatform não muda no Linux", outro.ok && outro.engine.assetUrl.endsWith("/embed-house-linux-x64.tgz") && outro.engine.install.entry === "bin/server.mjs");

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
