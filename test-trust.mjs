// test-trust.mjs — prova a RAIZ DE CONFIANÇA local (kit/trust.mjs).
//
// Cenário que motivou: a `publicKey` vinha do mesmo manifest que o kit baixa. Quem controla o
// repo troca artefato + assinatura + chave, e o fail-closed aprova — a tranca com a chave
// pendurada na porta. Aqui o kit passa a lembrar a chave e recusar a troca.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const KIT = pathToFileURL(join(import.meta.dirname, "kit", "trust.mjs")).href;
let fail = 0;
const check = (name, cond, detail = "") => {
  console.log(`  ${cond ? "OK  " : "FALHOU"} ${name}${cond ? "" : ` — ${detail}`}`);
  if (!cond) fail++;
};

/** Roda `checkTrust` num HOME de kit isolado (ENGINE_KIT_HOME), como um processo novo faria. */
function trust(home, args) {
  const code =
    `import { checkTrust, trustPath } from ${JSON.stringify(KIT)};` +
    `const r = checkTrust(${args});` +
    `process.stdout.write(JSON.stringify({ ...r, path: trustPath() }));`;
  const p = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    encoding: "utf8",
    env: { ...process.env, ENGINE_KIT_HOME: home },
  });
  try { return JSON.parse(p.stdout); } catch { return { ok: false, reason: `saída inesperada: ${p.stdout}${p.stderr}` }; }
}

console.log("== raiz de confiança (trust root) ==");
const home = mkdtempSync(join(tmpdir(), "trust-"));

// 1. Primeiro contato: grava a chave (TOFU) e deixa passar.
const primeiro = trust(home, `"mcp-gateway", "aaaa1111"`);
check("1ª vez grava a chave (TOFU) e aprova", primeiro.ok === true && primeiro.tofu === true, JSON.stringify(primeiro));
check("gravou o arquivo de confiança", existsSync(join(home, "trust.json")), join(home, "trust.json"));

// 2. Mesma chave depois: aprova sem TOFU (não fica re-gravando).
const mesma = trust(home, `"mcp-gateway", "aaaa1111"`);
check("mesma chave aprova sem re-gravar", mesma.ok === true && mesma.tofu === false, JSON.stringify(mesma));

// 3. O ATAQUE: registry comprometido devolve outra chave (com .sig que casa com ela).
const trocada = trust(home, `"mcp-gateway", "bbbb2222"`);
check("chave TROCADA pelo registry = ABORT", trocada.ok === false && /MUDOU/.test(trocada.reason ?? ""), JSON.stringify(trocada));

// 4. Motor diferente não é contaminado pela confiança do vizinho.
const outro = trust(home, `"embed-house", "cccc3333"`);
check("outro motor tem confiança independente", outro.ok === true && outro.tofu === true, JSON.stringify(outro));

// 5. Pin explícito do consumidor: registry divergente = ABORT já no 1º contato (sem TOFU).
const virgem = mkdtempSync(join(tmpdir(), "trust-pin-"));
const pinRuim = trust(virgem, `"vox-engine", "dddd4444", { trustedKeys: { "vox-engine": "eeee5555" } }`);
check("pin do consumidor vence o registry (divergiu = ABORT)", pinRuim.ok === false && /FIXADA/.test(pinRuim.reason ?? ""), JSON.stringify(pinRuim));
check("ABORT por pin NÃO grava confiança", !existsSync(join(virgem, "trust.json")) || !JSON.parse(readFileSync(join(virgem, "trust.json"), "utf8"))["vox-engine"], "gravou mesmo abortando");

// 6. Pin batendo com o registry: aprova e registra a origem como "pinned".
const pinBom = trust(virgem, `"vox-engine", "eeee5555", { trustedKeys: { "vox-engine": "eeee5555" } }`);
check("pin coincidente aprova", pinBom.ok === true, JSON.stringify(pinBom));
check("origem registrada como 'pinned'", JSON.parse(readFileSync(join(virgem, "trust.json"), "utf8"))["vox-engine"]?.source === "pinned", readFileSync(join(virgem, "trust.json"), "utf8"));

// 7. Arquivo de confiança corrompido não trava o kit (mas também não vira aprovação cega:
//    volta ao TOFU, que é o comportamento de quem nunca viu a chave).
const corrompido = mkdtempSync(join(tmpdir(), "trust-corr-"));
mkdirSync(corrompido, { recursive: true });
writeFileSync(join(corrompido, "trust.json"), "{ isto nao e json");
const corr = trust(corrompido, `"mcp-gateway", "aaaa1111"`);
check("trust.json corrompido → volta ao TOFU, sem crash", corr.ok === true && corr.tofu === true, JSON.stringify(corr));

for (const d of [home, virgem, corrompido]) rmSync(d, { recursive: true, force: true });
console.log(fail ? `\n${fail} FALHA(S)` : "\nTUDO VERDE");
process.exit(fail ? 1 : 0);
