// test-mcp-gateway-alignment.mjs — prova de que o manifest do engine-registry está
// alinhado com a versão REAL publicada do motor mcp-gateway.
//
// Contexto: um manifest defasado trava o consumidor numa versão antiga — `ensureGateway()`
// (consumers/mcp-gateway.mjs) resolve, baixa e "trava" qualquer consumidor, que não recebe
// fixes/features do gateway atual até o manifest ser realinhado.
//
// A versão esperada NÃO é constante no código: com --network, é a do package.json de dentro
// do .tgz publicado (baixado e verificado pelo caminho do consumidor). Offline, confere só a
// forma da entrada.
//
//   node tests/test-mcp-gateway-alignment.mjs            # offline
//   node tests/test-mcp-gateway-alignment.mjs --network  # + versão do manifest == package.json do .tgz
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../kit/resolve.mjs";
import { fetchArtifact, tarBinary } from "../kit/provision.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const MANIFEST_PATH = join(import.meta.dirname, "..", "manifest.json");

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
  check("versão do manifest é semver x.y.z", /^\d+\.\d+\.\d+$/.test(entry.version ?? ""), `manifest tem "${entry.version}"`);

  if (process.argv.includes("--network")) {
    const r = await resolve("mcp-gateway", { manifest });
    const tmp = mkdtempSync(join(tmpdir(), "mcpgw-align-"));
    try {
      const a = r.ok ? await fetchArtifact(r.engine, { destDir: tmp }) : r;
      check("release publicada baixa e passa sha256 + assinatura", a.ok, a.ok ? a.path : a.reason);
      if (a.ok) {
        execFileSync(tarBinary(), ["-xzf", a.path, "-C", tmp, "package.json"], { stdio: "ignore", windowsHide: true });
        const pub = JSON.parse(readFileSync(join(tmp, "package.json"), "utf8")).version;
        check("versão do manifest == package.json de dentro do .tgz publicado", entry.version === pub,
          `manifest "${entry.version}", .tgz "${pub}"`);
      }
    } catch (e) {
      check("conferência contra o .tgz publicado", false, e.message);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

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
