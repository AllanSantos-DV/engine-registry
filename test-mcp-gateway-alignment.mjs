// test-mcp-gateway-alignment.mjs — prova de que o manifest do engine-registry está
// alinhado com a versão REAL publicada do motor mcp-gateway (0.13.2).
//
// Contexto (RED): o manifest.json hoje trava o consumidor em "mcp-gateway" v0.8.4,
// mas o motor já está em 0.13.2 (package.json do repo mcp-gateway). Enquanto o
// manifest não for atualizado, `ensureGateway()` (consumers/mcp-gateway.mjs) resolve,
// baixa e "trava" qualquer consumidor numa versão 5 minors atrás — nenhum agente
// consumidor (mcp-bridge, etc.) recebe fixes/features do gateway atual até o
// manifest ser realinhado.
//
//   node test-mcp-gateway-alignment.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const MANIFEST_PATH = join(import.meta.dirname, "manifest.json");
const EXPECTED_VERSION = "0.13.2"; // versão publicada em mcp-gateway/package.json nesta fase

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
} catch (e) {
  check("manifest.json é JSON válido e legível", false, e.message);
  console.log(`\n== ${failures} FALHA(S) ==`);
  process.exit(1);
}

const entry = (Array.isArray(manifest.engines) ? manifest.engines : []).find((e) => e?.name === "mcp-gateway");

check("existe uma entrada 'mcp-gateway' no manifest", Boolean(entry), `encontrado: ${JSON.stringify(entry)}`);

if (entry) {
  check(
    `versão do manifest está alinhada com ${EXPECTED_VERSION} (release atual do motor)`,
    entry.version === EXPECTED_VERSION,
    `manifest tem "${entry.version}", esperado "${EXPECTED_VERSION}"`,
  );

  // Caso-limite: a tag de release e o asset devem seguir o template {version} —
  // um realinhamento de versão feito só em parte (ex.: só o número, sem a tag)
  // quebra o download em runtime sem avisar em code review.
  check(
    "tag de release usa o template {version} (não hardcoded)",
    typeof entry.install?.tag === "string" && entry.install.tag.includes("{version}"),
    `tag atual: ${entry.install?.tag}`,
  );

  // Caso-limite: home deve continuar apontando para ~/.mcp-gateway — realinhar a
  // versão não pode, de quebra, mudar o diretório de dados do motor já instalado.
  check(
    "home do motor permanece ~/.mcp-gateway (realinhamento não pode migrar o data dir)",
    entry.home === "~/.mcp-gateway",
    `home atual: ${entry.home}`,
  );
}

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
