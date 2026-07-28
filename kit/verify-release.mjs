#!/usr/bin/env node
// engine-kit/verify-release.mjs — prova o CAMINHO REAL depois de publicar.
//
//   node kit/verify-release.mjs <motor> [--manifest <path>]
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

const die = (msg) => { console.error(`FALHOU: ${msg}`); process.exit(1); };

const args = process.argv.slice(2);
const engineName = args[0];
if (!engineName || engineName.startsWith("--")) { die("uso: node kit/verify-release.mjs <motor> [--manifest <path>]"); }
const i = args.indexOf("--manifest");
const manifestPath = i === -1 ? join(dirname(dirname(fileURLToPath(import.meta.url))), "manifest.json") : args[i + 1];

let manifest;
try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
catch (e) { die(`manifest ilegível em ${manifestPath}: ${e.message}`); }

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
