#!/usr/bin/env node
// engine-kit/verify-release.mjs — prova o CAMINHO REAL depois de publicar.
//
//   node kit/verify-release.mjs <motor> [--manifest <path>]
//   node kit/verify-release.mjs --app <nome> [--manifest <path>]   # aplicativo: TODOS os assets
//
// Baixa do release público exatamente o que um consumidor baixaria (asset + .sha256 + .sig),
// usando as URLs montadas a partir do manifest, e confere as duas garantias:
//   integridade (sha256 bate)  e  autenticidade (assinatura confere com a publicKey do registry).
//
// Por que existe: "publiquei" não é prova. Asset faltando, .sig esquecido, tag errada e artefato
// do build anterior só aparecem quando um consumidor tenta instalar — em produção. Este passo
// puxa isso para dentro do publish. Também prova a metade negativa: adulterado é RECUSADO.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolve } from "./resolve.mjs";
import { verifyBlob, DEFAULT_ALGORITHM } from "./signature.mjs";
import { findApp, appAssetUrls, verifyAppRelease } from "./app-release.mjs";

const die = (msg) => { console.error(`FALHOU: ${msg}`); process.exit(1); };

const USAGE = "uso: node kit/verify-release.mjs <motor> [--manifest <path>]\n" +
              "     node kit/verify-release.mjs --app <nome> [--manifest <path>]";
const args = process.argv.slice(2);
const opt = (flag) => { const k = args.indexOf(flag); return k === -1 ? null : args[k + 1]; };
const appName = args.includes("--app") ? opt("--app") : null;
if (args.includes("--app") && (!appName || appName.startsWith("--"))) { die(USAGE); }
const engineName = appName ? null : args[0];
if (!appName && (!engineName || engineName.startsWith("--"))) { die(USAGE); }
const manifestPath = opt("--manifest") ?? join(dirname(dirname(fileURLToPath(import.meta.url))), "manifest.json");

let manifest;
try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
catch (e) { die(`manifest ilegível em ${manifestPath}: ${e.message}`); }

// Aplicativo: não há asset único nem provision — baixa TODOS os assets da entrada, anônimo.
if (appName) {
  const f = findApp(manifest, appName);
  if (!f.ok) { die(f.reason); }
  const { tag } = appAssetUrls(f.app);
  console.log(`app            : ${f.app.name} v${f.app.version}`);
  console.log(`release        : ${f.app.release.repo} @ ${tag}`);
  if (!f.app.release.publicKey) { console.warn("AVISO: app sem publicKey — integridade será verificada, AUTENTICIDADE não."); }
  const r = await verifyAppRelease(f.app, { log: (m) => console.log(`  OK  ${m}`) });
  if (!r.ok) { die(r.reason); }
  console.log(`\nOK: os ${r.assets.length} assets de ${f.app.name} v${f.app.version} baixam sem login e conferem.`);
  process.exit(0);
}

const r = await resolve(engineName, { manifest });
if (!r.ok) { die(r.reason); }
const engine = r.engine;

async function grab(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) { throw new Error(`HTTP ${res.status} em ${url}`); }
  return Buffer.from(await res.arrayBuffer());
}

console.log(`motor          : ${engine.name} v${engine.version}`);
console.log(`origem         : ${engine.install.repo}`);
console.log(`asset          : ${engine.assetUrl}`);

let asset, sha, sig;
try { asset = await grab(engine.assetUrl); } catch (e) { die(`asset não baixou — ${e.message}`); }
try { sha = String(await grab(engine.checksumUrl)).trim().split(/\s+/)[0].toLowerCase(); }
catch (e) { die(`sidecar .sha256 não baixou — ${e.message}`); }

const actual = createHash("sha256").update(asset).digest("hex");
if (actual !== sha) { die(`SHA256 divergente (release=${sha.slice(0, 12)}… baixado=${actual.slice(0, 12)}…)`); }
console.log(`sha256         : ${actual} OK`);

const publicKey = engine.install.publicKey;
if (!publicKey) {
  if (engine.install.signatureRequired) { die("signatureRequired sem publicKey no manifest — corrija antes de anunciar"); }
  console.warn("AVISO: motor sem publicKey no registry — integridade verificada, AUTENTICIDADE não.");
  process.exit(0);
}

try { sig = await grab(engine.signatureUrl); } catch (e) { die(`sidecar .sig não baixou — ${e.message} (a release saiu SEM assinatura)`); }

const algorithm = engine.install.signatureAlgorithm ?? DEFAULT_ALGORITHM;
const v = verifyBlob(asset, sig, publicKey, { algorithm });
if (!v.ok) { die(v.reason); }

// A metade negativa: se um artefato adulterado passasse, a verificação positiva não valeria nada.
if (verifyBlob(Buffer.concat([asset, Buffer.from([0])]), sig, publicKey, { algorithm }).ok) {
  die("a verificação ACEITOU um artefato adulterado — contrato quebrado, NÃO anuncie esta release");
}

console.log(`assinatura     : ${algorithm} OK (e artefato adulterado é RECUSADO)`);
console.log("\nOK: a release publicada instala pelo caminho real de um consumidor.");
