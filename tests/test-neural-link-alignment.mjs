// test-neural-link-alignment.mjs — prova de que o pin default do adaptador
// consumers/neural-link.mjs acompanha a versão publicada no manifest.json.
//
// O DEFAULT_PIN é o mínimo same-major que `ensureNeuralLink()` exige. Se o manifest sobe e o
// pin fica para trás, o consumidor continua aceitando a versão velha já instalada e só recebe
// a nova quando o cache do manifest expirar. Se o pin passa do manifest, o pin nunca é
// satisfeito e o provision tenta reinstalar a cada chamada.
//
//   node tests/test-neural-link-alignment.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "manifest.json"), "utf8"));
const entry = (Array.isArray(manifest.engines) ? manifest.engines : []).find((e) => e?.name === "neural-link");
check("existe uma entrada 'neural-link' no manifest", Boolean(entry));

const source = readFileSync(join(import.meta.dirname, "..", "consumers", "neural-link.mjs"), "utf8");
const pin = source.match(/^const DEFAULT_PIN = "(\d+\.\d+\.\d+)";$/m)?.[1];
check("consumers/neural-link.mjs declara DEFAULT_PIN x.y.z", Boolean(pin), `encontrado: ${pin}`);

check(
  "DEFAULT_PIN = versão publicada no manifest",
  Boolean(entry && pin) && pin === entry.version,
  `pin "${pin}", manifest "${entry?.version}"`,
);

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
