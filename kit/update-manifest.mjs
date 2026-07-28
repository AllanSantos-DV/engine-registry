#!/usr/bin/env node
// engine-kit/update-manifest.mjs — patch cirúrgico de UM motor no manifest.json do registry.
//
//   node kit/update-manifest.mjs <motor> --version 0.2.0 --public-key <hex> [--repo owner/name]
//                                        [--asset <template>] [--tag <template>] [--manifest <path>]
//
// Existe para o publish não editar JSON com regex em PowerShell (o caminho clássico para corromper
// um manifest silenciosamente). Aqui o arquivo é parseado, validado e reescrito — e se o motor não
// existir, falha alto em vez de criar uma entrada meia-boca.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const die = (msg) => { console.error(`FALHOU: ${msg}`); process.exit(1); };

const args = process.argv.slice(2);
const engineName = args[0];
if (!engineName || engineName.startsWith("--")) { die("uso: node kit/update-manifest.mjs <motor> --version <x.y.z> [...]"); }

const opt = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };

const manifestPath = opt("--manifest") ?? join(dirname(dirname(fileURLToPath(import.meta.url))), "manifest.json");
const version = opt("--version");
const publicKey = opt("--public-key");
const repo = opt("--repo");
const asset = opt("--asset");
const tag = opt("--tag");

let manifest;
try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
catch (e) { die(`manifest ilegível em ${manifestPath}: ${e.message}`); }

const engine = (manifest.engines ?? []).find((e) => e.name === engineName);
if (!engine) {
  die(`motor "${engineName}" não existe em ${manifestPath}.\n` +
      `       Motores registrados: ${(manifest.engines ?? []).map((e) => e.name).join(", ") || "(nenhum)"}\n` +
      "       Registre a entrada à mão primeiro — este script ATUALIZA, não inventa descritor.");
}

if (version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) { die(`versão inválida "${version}" (esperado x.y.z)`); }
  engine.version = version;
}
if (publicKey) {
  if (!/^[0-9a-fA-F]{64}$/.test(publicKey)) { die(`publicKey inválida (esperado 64 chars hex, veio ${publicKey.length})`); }
  // Trocar a chave de um motor já publicado invalida TODAS as releases anteriores dele nos
  // consumidores que já a pinaram. Se for rotação intencional, é consciente; se não, é acidente.
  if (engine.install.publicKey && engine.install.publicKey.toLowerCase() !== publicKey.toLowerCase()) {
    console.warn(`AVISO: publicKey de "${engineName}" MUDOU — releases assinadas com a chave antiga passam a ser recusadas.`);
  }
  engine.install.publicKey = publicKey.toLowerCase();
  engine.install.signatureAlgorithm = "ed25519-sha256-raw";
  engine.install.signatureRequired = true;
}
if (repo) {
  if (!/^[^/]+\/[^/]+$/.test(repo)) { die(`repo inválido "${repo}" (esperado owner/name)`); }
  engine.install.repo = repo;
}
if (asset) { engine.install.asset = asset; }
if (tag) { engine.install.tag = tag; }

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`manifest atualizado: ${manifestPath}`);
console.log(JSON.stringify({ name: engine.name, version: engine.version, install: engine.install }, null, 2));
