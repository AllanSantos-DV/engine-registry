#!/usr/bin/env node
// engine-kit/sign.mjs — assina um artefato de motor e PROVA a assinatura na hora.
//
//   node kit/sign.mjs <caminho-do-asset> --engine <motor>
//   node kit/sign.mjs <caminho-do-asset> --key <caminho-da-chave-privada>
//
// Gera, ao lado do asset:
//   <asset>.sig     — assinatura Ed25519 crua (64 bytes) do SHA-256 do asset
//   <asset>.sha256  — sidecar de integridade (o kit já exigia; gerar aqui evita esquecer)
//
// E, antes de sair, prova o que acabou de fazer: a assinatura valida contra a pública derivada
// E recusa uma cópia adulterada. Um `.sig` que só é testado no consumidor é um `.sig` que você
// descobre que está quebrado tarde demais.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { signBlob, verifyBlob, publicKeyHexFromPrivateHex } from "./signature.mjs";
import { keyPathFor } from "./keystore.mjs";

const die = (msg) => { console.error(`FALHOU: ${msg}`); process.exit(1); };

function parseArgs(argv) {
  const out = { asset: null, engine: null, key: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--engine") { out.engine = argv[++i]; }
    else if (argv[i] === "--key") { out.key = argv[++i]; }
    else if (!out.asset) { out.asset = argv[i]; }
  }
  return out;
}

const { asset, engine, key } = parseArgs(process.argv.slice(2));
if (!asset) { die("uso: node kit/sign.mjs <asset> (--engine <motor> | --key <caminho>)"); }
if (!existsSync(asset)) { die(`asset não encontrado: ${asset}`); }

const keyPath = key ?? (engine ? keyPathFor(engine) : null);
if (!keyPath) { die("informe --engine <motor> ou --key <caminho da chave privada>"); }
if (!existsSync(keyPath)) {
  die(`chave privada ausente: ${keyPath}\n       gere com: node kit/gen-key.mjs ${engine ?? "<motor>"}`);
}

const privateKeyHex = readFileSync(keyPath, "utf8").trim();
let publicKeyHex;
try {
  publicKeyHex = publicKeyHexFromPrivateHex(privateKeyHex);
} catch (e) {
  die(`chave privada ilegível em ${keyPath}: ${e.message}`);
}

const blob = readFileSync(asset);
const sig = signBlob(blob, privateKeyHex);

// PROVA (as duas metades: aceita o legítimo, recusa o adulterado).
if (!verifyBlob(blob, sig, publicKeyHex).ok) { die("a assinatura recém-gerada NÃO validou — não publique"); }
if (verifyBlob(Buffer.concat([blob, Buffer.from("x")]), sig, publicKeyHex).ok) {
  die("a verificação ACEITOU um artefato adulterado — não publique");
}

const sha256 = createHash("sha256").update(blob).digest("hex");
writeFileSync(`${asset}.sig`, sig);
writeFileSync(`${asset}.sha256`, `${sha256}  ${basename(asset)}\n`, "utf8");

console.log(`asset          : ${asset} (${blob.length} bytes)`);
console.log(`sha256         : ${sha256}`);
console.log(`assinatura     : ${asset}.sig (${sig.length} bytes crus)`);
console.log(`chave pública  : ${publicKeyHex}`);
console.log("prova          : assinatura VALIDA e artefato adulterado é RECUSADO");
