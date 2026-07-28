#!/usr/bin/env node
// engine-kit/gen-key.mjs — gera o par Ed25519 de UM motor.
//
//   node kit/gen-key.mjs <motor>
//
// Uma chave POR MOTOR (não uma chave do publisher): comprometer uma chave obriga a republicar
// aquele motor, não a casa inteira. A privada fica só nesta máquina, em ~/.engine-signing/, e
// NUNCA entra em CI — é o que garante que um CI comprometido não consegue forjar um release.
//
// A pública sai no stdout para você colar em `install.publicKey` do manifest.json.
import { mkdirSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { generateKeyPairHex, publicKeyFromHex, signBlob, verifyBlob } from "./signature.mjs";
import { SIGNING_DIR, keyPathFor } from "./keystore.mjs";

const die = (msg) => { console.error(`FALHOU: ${msg}`); process.exit(1); };

const engine = process.argv[2];
if (!engine || !/^[a-z0-9][a-z0-9-]*$/.test(engine)) {
  die("uso: node kit/gen-key.mjs <motor>   (nome em minúsculas, ex.: mcp-gateway)");
}

const keyPath = keyPathFor(engine);
if (existsSync(keyPath)) {
  // Sobrescrever invalidaria TODAS as releases já assinadas deste motor: os consumidores têm a
  // pública antiga pinada e passariam a recusar tudo. Recusa alto em vez de destruir em silêncio.
  die(`já existe uma chave para "${engine}" em ${keyPath}.\n` +
      "       Sobrescrever invalidaria todas as releases assinadas com ela (os consumidores têm a pública pinada).\n" +
      "       Se a rotação for intencional, mova o arquivo antigo à mão e rode de novo.");
}

const { publicKeyHex, privateKeyHex } = generateKeyPairHex();

// Auto-prova antes de gravar: o par gerado assina e verifica de verdade, e recusa adulterado.
// Sem isto, um par quebrado só apareceria na primeira instalação de um consumidor.
const probe = Buffer.from(`engine-kit gen-key probe :: ${engine}`);
const sig = signBlob(probe, privateKeyHex);
if (!verifyBlob(probe, sig, publicKeyHex).ok) { die("o par gerado não se auto-verificou — abortando"); }
if (verifyBlob(Buffer.concat([probe, Buffer.from("x")]), sig, publicKeyHex).ok) {
  die("o par gerado ACEITOU conteúdo adulterado — abortando");
}
publicKeyFromHex(publicKeyHex); // prova que o envelope DER importa no Node desta máquina

mkdirSync(SIGNING_DIR, { recursive: true });
writeFileSync(keyPath, privateKeyHex, { encoding: "utf8", mode: 0o600 });
try { chmodSync(keyPath, 0o600); } catch { /* NTFS ignora o modo; o ACL do perfil já restringe */ }

console.log(`chave privada  : ${keyPath}  (NÃO versionar, NÃO subir para CI)`);
console.log(`chave pública  : ${publicKeyHex}`);
console.log("");
console.log(`Cole no manifest.json, no motor "${engine}":`);
console.log(JSON.stringify({
  install: { publicKey: publicKeyHex, signatureAlgorithm: "ed25519-sha256-raw", signatureRequired: true },
}, null, 2));
