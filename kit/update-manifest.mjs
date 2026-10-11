#!/usr/bin/env node
// engine-kit/update-manifest.mjs — patch cirúrgico de UM motor no manifest.json do registry.
//
//   node kit/update-manifest.mjs <motor> --version 0.2.0 --public-key <hex> [--repo owner/name]
//                                        [--asset <template>] [--tag <template>] [--manifest <path>]
//   node kit/update-manifest.mjs --app <nome> [--version 0.3.0] [--public-key <hex>] [--repo owner/name]
//                                [--tag <template>] [--asset <template>=<plataforma> ...] [--manifest <path>]
//
// Com --app, a entrada é procurada em manifest.apps (aplicativos, que o engine-kit não
// provisiona). Cada --asset repetido SUBSTITUI a lista de assets, com sidecars
// '{asset}.sha256' e '{asset}.sig'.
//
// Existe para o publish não editar JSON com regex em PowerShell (o caminho clássico para corromper
// um manifest silenciosamente). Aqui o arquivo é parseado, validado e reescrito — e se o motor não
// existir, falha alto em vez de criar uma entrada meia-boca.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const die = (msg) => { console.error(`FALHOU: ${msg}`); process.exit(1); };

const USAGE = "uso: node kit/update-manifest.mjs <motor> --version <x.y.z> [...]\n" +
              "     node kit/update-manifest.mjs --app <nome> [--version <x.y.z>] [--public-key <hex>] [--repo owner/name]\n" +
              "                                  [--tag <template>] [--asset <template>=<plataforma> ...] [--manifest <path>]";
const args = process.argv.slice(2);
const opt = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };
const optAll = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));

const appName = args.includes("--app") ? opt("--app") : null;
if (args.includes("--app") && (!appName || appName.startsWith("--"))) { die(USAGE); }
const engineName = appName ? null : args[0];
if (!appName && (!engineName || engineName.startsWith("--"))) { die(USAGE); }

const manifestPath = opt("--manifest") ?? join(dirname(dirname(fileURLToPath(import.meta.url))), "manifest.json");
const version = opt("--version");
const publicKey = opt("--public-key");
const repo = opt("--repo");
const asset = opt("--asset");
const tag = opt("--tag");

if (version && !/^\d+\.\d+\.\d+$/.test(version)) { die(`versão inválida "${version}" (esperado x.y.z)`); }
if (publicKey && !/^[0-9a-fA-F]{64}$/.test(publicKey)) { die(`publicKey inválida (esperado 64 chars hex, veio ${publicKey.length})`); }
if (repo && !/^[^/]+\/[^/]+$/.test(repo)) { die(`repo inválido "${repo}" (esperado owner/name)`); }

let manifest;
try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
catch (e) { die(`manifest ilegível em ${manifestPath}: ${e.message}`); }

const save = (label, entry) => {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`manifest atualizado: ${manifestPath}`);
  console.log(JSON.stringify({ name: entry.name, version: entry.version, [label]: entry[label] }, null, 2));
};

// Aplicativo: a entrada mora em manifest.apps, e o que muda numa release são versão, chave e assets.
if (appName) {
  const app = (manifest.apps ?? []).find((a) => a.name === appName);
  if (!app) {
    die(`app "${appName}" não existe em manifest.apps de ${manifestPath}.\n` +
        `       Apps registrados: ${(manifest.apps ?? []).map((a) => a.name).join(", ") || "(nenhum)"}\n` +
        "       Registre a entrada à mão primeiro — este script ATUALIZA, não inventa descritor.");
  }
  if (version) { app.version = version; }
  if (publicKey) {
    if (app.release.publicKey && app.release.publicKey.toLowerCase() !== publicKey.toLowerCase()) {
      console.warn(`AVISO: publicKey de "${appName}" MUDOU — downloads assinados com a chave antiga deixam de conferir.`);
    }
    app.release.publicKey = publicKey.toLowerCase();
    app.release.signatureAlgorithm = "ed25519-sha256-raw";
    app.release.signatureRequired = true;
  }
  if (repo) { app.release.repo = repo; }
  if (tag) { app.release.tag = tag; }
  const assets = optAll("--asset");
  if (assets.length) {
    // Substitui a lista inteira: uma release é o conjunto de assets dela, não um acréscimo.
    app.release.assets = assets.map((spec) => {
      const cut = String(spec ?? "").lastIndexOf("=");
      if (cut <= 0 || cut === spec.length - 1) { die(`--asset "${spec}" inválido (esperado <template>=<plataforma>)`); }
      return { name: spec.slice(0, cut), platform: spec.slice(cut + 1), checksum: "{asset}.sha256", signature: "{asset}.sig" };
    });
  }
  save("release", app);
  process.exit(0);
}

const engine = (manifest.engines ?? []).find((e) => e.name === engineName);
if (!engine) {
  die(`motor "${engineName}" não existe em ${manifestPath}.\n` +
      `       Motores registrados: ${(manifest.engines ?? []).map((e) => e.name).join(", ") || "(nenhum)"}\n` +
      "       Registre a entrada à mão primeiro — este script ATUALIZA, não inventa descritor.");
}

if (version) { engine.version = version; }
if (publicKey) {
  // Trocar a chave de um motor já publicado invalida TODAS as releases anteriores dele nos
  // consumidores que já a pinaram. Se for rotação intencional, é consciente; se não, é acidente.
  if (engine.install.publicKey && engine.install.publicKey.toLowerCase() !== publicKey.toLowerCase()) {
    console.warn(`AVISO: publicKey de "${engineName}" MUDOU — releases assinadas com a chave antiga passam a ser recusadas.`);
  }
  engine.install.publicKey = publicKey.toLowerCase();
  engine.install.signatureAlgorithm = "ed25519-sha256-raw";
  engine.install.signatureRequired = true;
}
if (repo) { engine.install.repo = repo; }
if (asset) { engine.install.asset = asset; }
if (tag) { engine.install.tag = tag; }

save("install", engine);
