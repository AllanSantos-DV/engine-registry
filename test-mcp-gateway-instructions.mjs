// test-mcp-gateway-instructions.mjs — prova de que o pacote de instruções para agente
// (docs/AGENT-INSTRUCTIONS.md, hoje só no repo PRIVADO mcp-gateway) chega ao consumidor.
//
// Contexto (RED): hoje o artefato publicado (mcp-gateway.tgz) NÃO leva o arquivo de
// instruções, o schema.json/manifest.json do engine-registry não declaram onde ele mora
// dentro do artefato, e `consumers/mcp-gateway.mjs` só devolve dados de conexão
// (url/token/port/backends) — nenhum campo aponta para a instrução. Um host de agente
// (Copilot, Claude, Cursor, ou qualquer outro cliente MCP) que queira exibir/injetar o
// pacote de instrução no próprio setup não tem de onde ler.
//
// Este teste é de CONTRATO: não sobe o daemon, não fala com nenhuma IDE — só prova que
// (1) o schema aceita o campo, (2) o manifest do motor mcp-gateway o declara, (3) o
// consumidor genérico expõe uma função PURA (sem rede, sem healthcheck) que resolve o
// caminho a partir do MESMO manifest (nunca hardcoded) e do layout REAL de instalação —
// <HOME>/<install.extractTo>/<install.agentInstructions>, a mesma pasta onde
// kit/provision.mjs desempacota o artefato (`binDir = join(home, install.extractTo)`) — e
// (4), de ponta a ponta e SEM pular, que o mcp-gateway.tgz publicado de verdade contém o
// arquivo nesse layout. Qualquer host pode chamar essa função no próprio setup.
//
//   node test-mcp-gateway-instructions.mjs
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { resolve } from "./kit/resolve.mjs";
import { fetchArtifact } from "./kit/provision.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("== contrato: agent instructions do mcp-gateway ==\n");

// --- 1) schema.json declara o campo no contrato do motor -------------------------------
const SCHEMA_PATH = join(import.meta.dirname, "schema.json");
let schema;
try {
  schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
} catch (e) {
  check("schema.json é JSON válido e legível", false, e.message);
}

if (schema) {
  const installProps = schema?.definitions?.engine?.properties?.install?.properties ?? {};
  check(
    "schema declara 'install.agentInstructions' (string)",
    installProps.agentInstructions?.type === "string",
    `propriedade encontrada: ${JSON.stringify(installProps.agentInstructions)}`,
  );
}

// --- 2) manifest.json: a entrada 'mcp-gateway' aponta o caminho dentro do artefato -----
const MANIFEST_PATH = join(import.meta.dirname, "manifest.json");
let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
} catch (e) {
  check("manifest.json é JSON válido e legível", false, e.message);
}

const entry = manifest && (Array.isArray(manifest.engines) ? manifest.engines : []).find((e) => e?.name === "mcp-gateway");
check("existe a entrada 'mcp-gateway' no manifest", Boolean(entry));

const EXPECTED_REL_PATH = "docs/AGENT-INSTRUCTIONS.md";
if (entry) {
  check(
    `install.agentInstructions === "${EXPECTED_REL_PATH}"`,
    entry.install?.agentInstructions === EXPECTED_REL_PATH,
    `valor atual: ${JSON.stringify(entry.install?.agentInstructions)}`,
  );

  // Caso-limite: o caminho tem que ser RELATIVO ao home do motor — um caminho absoluto ou
  // com ".." vazaria o layout de instalação de uma máquina para o manifesto público, e
  // quebraria em qualquer SO diferente do que gerou o valor.
  const rel = entry.install?.agentInstructions ?? "";
  check(
    "caminho é relativo (sem raiz absoluta, sem '..' de escape)",
    typeof rel === "string" && rel.length > 0 && !rel.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(rel) && !rel.includes(".."),
    `valor: ${JSON.stringify(rel)}`,
  );
}

// --- 3) consumers/mcp-gateway.mjs expõe uma função PURA de leitura, sem rede -----------
// Import dinâmico: se o módulo ainda não exportar os símbolos, o teste falha aqui mesmo
// (RED), sem exceção não tratada escondendo o motivo real.
const mod = await import("./consumers/mcp-gateway.mjs");

check(
  "consumers/mcp-gateway.mjs exporta 'instructionsPath' (função pura)",
  typeof mod.instructionsPath === "function",
);
check(
  "consumers/mcp-gateway.mjs exporta 'readInstructions' (carregamento, sem rede/healthcheck)",
  typeof mod.readInstructions === "function",
);

if (typeof mod.instructionsPath === "function" && typeof mod.readInstructions === "function") {
  // Ambiente isolado: nunca tocar o ~/.mcp-gateway real da máquina que roda o teste.
  const FAKE_HOME = join(tmpdir(), `mcp-gateway-instructions-test-${Date.now()}`);
  const prevOverride = process.env.MCP_GATEWAY_DATA_DIR;
  process.env.MCP_GATEWAY_DATA_DIR = FAKE_HOME;

  try {
    // 3a) HOME ainda vazio (artefato nunca instalado): ausência é ESTADO, não exceção.
    const missing = mod.readInstructions();
    check(
      "sem artefato instalado → { available:false } explícito (não lança, não inventa conteúdo)",
      missing && missing.available === false && typeof missing.reason === "string",
      JSON.stringify(missing),
    );

    // 3b) Simula o artefato desempacotado NO LUGAR REAL onde o `provision` extrai
    //     (kit/provision.mjs: `binDir = join(home, install.extractTo ?? "bin")`) — não em
    //     <HOME>/docs/... direto, que nunca é onde o tgz cai no disco. Layout e caminho
    //     relativo vêm do PRÓPRIO manifest (seção 2), nunca hardcoded aqui — se o manifest
    //     mudar o valor, este teste acompanha em vez de ficar com uma premissa velha.
    const extractTo = entry.install.extractTo ?? "bin";
    const relInstructions = entry.install.agentInstructions;
    const docsDir = join(FAKE_HOME, extractTo, join(relInstructions, ".."));
    mkdirSync(docsDir, { recursive: true });
    const MARKER = "# mcp-gateway — Agent Instructions (teste)";
    writeFileSync(join(FAKE_HOME, extractTo, relInstructions), MARKER, "utf8");

    const path = mod.instructionsPath();
    const expectedPath = join(FAKE_HOME, extractTo, relInstructions);
    check(
      "instructionsPath() resolve para <HOME>/<extractTo>/<agentInstructions> (layout real de provision)",
      path === expectedPath,
      `path: ${path} — esperado: ${expectedPath}`,
    );

    const loaded = mod.readInstructions();
    check(
      "com o artefato presente → { available:true, path, content } carregável pelo setup do host",
      loaded?.available === true && loaded.path === path && loaded.content.includes(MARKER),
      JSON.stringify(loaded),
    );

    // Caso-limite: conteúdo não pode ser hardcoded/estático no consumidor — tem que ser o
    // arquivo REAL do disco. Muda o arquivo, o retorno tem que acompanhar.
    const MARKER2 = "# conteudo trocado — nao pode estar em cache no modulo";
    writeFileSync(join(FAKE_HOME, extractTo, relInstructions), MARKER2, "utf8");
    const loaded2 = mod.readInstructions();
    check(
      "leitura não fica em cache: reflete o arquivo atual no disco",
      loaded2?.available === true && loaded2.content.includes(MARKER2) && !loaded2.content.includes(MARKER),
      JSON.stringify(loaded2),
    );
  } finally {
    if (prevOverride === undefined) { delete process.env.MCP_GATEWAY_DATA_DIR; }
    else { process.env.MCP_GATEWAY_DATA_DIR = prevOverride; }
    rmSync(FAKE_HOME, { recursive: true, force: true });
  }
}

// --- 4) O artefato PUBLICADO (mcp-gateway.tgz) realmente contém o doc, no lugar certo -----
// Prova de ponta a ponta, NÃO opcional/pulável: baixa o mesmo release que um consumidor real
// baixaria (reusando kit/resolve.mjs + kit/provision.mjs::fetchArtifact — mesmo caminho de
// integridade/assinatura do provision de verdade, sem duplicar essa lógica aqui), extrai com
// `tar` (mesma ferramenta do kit/provision.mjs) e confere o arquivo dentro do layout real
// (<extractTo>/<agentInstructions>). Roda sempre — se a release publicada ainda não empacota
// o doc, o teste FALHA (alto, visível), em vez de ficar pulado escondendo a lacuna.
if (entry) {
  const r = await resolve("mcp-gateway", { manifest });
  if (!r.ok) {
    check("consegue resolver o descritor 'mcp-gateway' para baixar o artefato publicado", false, r.reason);
  } else {
    const workDir = join(tmpdir(), `mcp-gateway-artifact-test-${Date.now()}`);
    try {
      const fetched = await fetchArtifact(r.engine, { destDir: workDir });
      check(
        "baixa e verifica (sha256 + assinatura) o mcp-gateway.tgz REALMENTE publicado no release",
        fetched.ok === true,
        fetched.ok ? fetched.path : fetched.reason,
      );

      if (fetched.ok) {
        const extractDir = join(workDir, "extracted");
        mkdirSync(extractDir, { recursive: true });
        try {
          execFileSync("tar", ["-xzf", fetched.path, "-C", extractDir], { stdio: "ignore" });

          const extractTo = entry.install.extractTo ?? "bin";
          const relInstructions = entry.install.agentInstructions;
          const packagedPath = join(extractDir, extractTo, relInstructions);
          let packagedContent = null;
          try {
            packagedContent = readFileSync(packagedPath, "utf8");
          } catch (e) {
            check(
              "docs/AGENT-INSTRUCTIONS.md está DENTRO do mcp-gateway.tgz publicado, no layout que o provision extrai",
              false,
              `${packagedPath}: ${e.message}`,
            );
          }

          if (packagedContent !== null) {
            check(
              "docs/AGENT-INSTRUCTIONS.md está DENTRO do mcp-gateway.tgz publicado, no layout que o provision extrai",
              packagedContent.length > 0,
            );

            // Caso-limite "sem acoplar a IDE", conferido contra o CONTEÚDO REAL empacotado —
            // não um marcador neutro escrito pelo próprio teste (isso sempre passaria e não
            // provaria nada sobre o arquivo de verdade).
            const lower = packagedContent.toLowerCase();
            check(
              "conteúdo REAL empacotado não força acoplamento a uma IDE específica (sem 'vscode'/'.vsix')",
              !lower.includes("vscode") && !lower.includes(".vsix"),
            );
          }
        } catch (e) {
          check("extrai o mcp-gateway.tgz publicado com `tar` para inspecionar o conteúdo real", false, e.message);
        }
      }
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
if (failures !== 0) { process.exitCode = 1; }
