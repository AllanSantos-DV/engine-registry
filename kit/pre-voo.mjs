#!/usr/bin/env node
// engine-kit/pre-voo.mjs — pré-voo da publicação: prova, ANTES de criar a release, o que o consumidor vai conferir depois.
//
//   node kit/pre-voo.mjs <asset>... --engine <motor> --version <x.y.z> --public-key <hex>
//
// Para cada asset já assinado (`.sig` e `.sha256` ao lado): o sha256 do sidecar bate com o arquivo, a assinatura Ed25519 confere com a chave
// pública e, num `.tgz`, a versão do `package.json` de dentro é a que vai para a tag. Usa as mesmas funções do `provision` e do `verify-release`
// (`verifyDigest`, `versaoDivergente`), não uma cópia. Ferramental de autor: nunca importado por consumidor.
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDigest } from "./signature.mjs";
import { versaoDivergente } from "./fetch.mjs";

/**
 * @param {string[]} assets caminhos dos artefatos.
 * @param {{engine:string, version:string, publicKey:string}} opts
 * @returns {Promise<{ok:boolean, falhas:string[]}>} `falhas` traz uma frase por problema, com o nome do arquivo.
 */
export async function preVoo(assets, { engine, version, publicKey }) {
  const falhas = [];
  for (const a of assets) {
    const nome = basename(a);
    const h = createHash("sha256");
    for await (const pedaco of createReadStream(a)) { h.update(pedaco); }
    const digest = h.digest();
    let lido, sig;
    try { lido = readFileSync(`${a}.sha256`, "utf8").trim().split(/\s+/)[0].toLowerCase(); } catch (e) { falhas.push(`${nome}: sidecar .sha256 ilegível (${e.code ?? e.message})`); continue; }
    try { sig = readFileSync(`${a}.sig`); } catch (e) { falhas.push(`${nome}: sidecar .sig ilegível (${e.code ?? e.message})`); continue; }
    if (lido !== digest.toString("hex")) { falhas.push(`${nome}: o .sha256 não bate com o arquivo (sidecar ${lido}, arquivo ${digest.toString("hex")})`); }
    const s = verifyDigest(digest, sig, publicKey);
    if (!s.ok) { falhas.push(`${nome}: ${s.reason}`); }
    const v = await versaoDivergente(a, { name: engine, version });
    if (v) { falhas.push(`${nome}: ${v}`); }
  }
  return { ok: falhas.length === 0, falhas };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
  const assets = args.filter((x, i) => !x.startsWith("--") && !["--engine", "--version", "--public-key"].includes(args[i - 1]));
  const [engine, version, publicKey] = [opt("--engine"), opt("--version"), opt("--public-key")];
  if (!assets.length || !engine || !version || !publicKey) { console.error("uso: node kit/pre-voo.mjs <asset>... --engine <motor> --version <x.y.z> --public-key <hex>"); process.exit(2); }
  const r = await preVoo(assets, { engine, version, publicKey });
  for (const f of r.falhas) { console.error(`FALHOU ${f}`); }
  if (r.ok) { console.log(`OK pré-voo: ${assets.length} asset(s) de ${engine} v${version} conferem (sha256, assinatura, versão do .tgz)`); }
  process.exit(r.ok ? 0 : 1);
}
