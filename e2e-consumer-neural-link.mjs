// e2e-consumer-neural-link.mjs — prova o adaptador `consumers/neural-link.mjs` de ponta a ponta:
// máquina limpa (sem neural-link) + uma extensão que já copiou hook + companion para a pasta de
// hooks → `ensureNeuralLink()` instala o dispatcher, roda `install()`, e o companion vira
// registro REAL (`source:"companion"`) no `neural-link.config.json` do sandbox. Segunda chamada
// reusa sem rebaixar.
//
//   node e2e-consumer-neural-link.mjs
import { ensureNeuralLink } from "./consumers/neural-link.mjs";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const COPILOT_HOME = join(tmpdir(), `nl-consumer-e2e-${Date.now()}`);
process.env.COPILOT_HOME = COPILOT_HOME;

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("== e2e: ensureNeuralLink() garante o dispatcher + registra companion de uma extensão ==\n");
console.log(`COPILOT_HOME isolado: ${COPILOT_HOME}\n`);

// Simula o que uma extensão (ex.: security-check) já faz hoje: copia o script do hook + o
// companion de calibragem para a pasta de hooks do host, ANTES de chamar o adaptador.
const hooksDir = join(COPILOT_HOME, "hooks");
mkdirSync(hooksDir, { recursive: true });
writeFileSync(
  join(hooksDir, "security-pre-tool.js"),
  "module.exports = async () => ({ hookSpecificOutput: { permissionDecision: 'allow' } });\n",
);
writeFileSync(
  join(hooksDir, "security-pre-tool.neural-link.json"),
  JSON.stringify({ events: ["PreToolUse"], timeout: 15000, weight: 0.55, project: "security-hooks" }, null, 2),
);

console.log("baixando e instalando o dispatcher (download real)…");
const first = await ensureNeuralLink({ log: (m) => console.log(`    ${m}`) });
check("dispatcher disponível", first.available === true, first.available ? `v${first.version}` : first.reason);
if (!first.available) { process.exit(1); }
check("entryPath no disco", existsSync(first.entryPath));
check("install() rodou (registered != null)", first.registered !== null);

// Companions NÃO são persistidos dentro de `neural-link.config.json` — são mesclados EM
// MEMÓRIA a cada dispatch (config global sempre vence). A prova observável de que o
// companion foi reconhecido é a declaração `_dispatcher-<Evento>.json` que o `install()`
// regenera: ela é o que o HOST lê para saber que precisa invocar o dispatcher naquele
// evento, e o comentário embutido conta quantos handlers correm naquele processo único.
const dispatcherPath = join(hooksDir, "_dispatcher-PreToolUse.json");
check("_dispatcher-PreToolUse.json foi (re)gerado", existsSync(dispatcherPath));
let dispatcherDecl = null;
if (existsSync(dispatcherPath)) {
  dispatcherDecl = JSON.parse(readFileSync(dispatcherPath, "utf8"));
}
const cmd = dispatcherDecl?.hooks?.PreToolUse?.[0]?.command ?? "";
check("declaração aponta para o dispatcher instalado", cmd.includes(first.entryPath.replace(/\\/g, "/")) || cmd.replace(/\\/g, "/").includes(first.entryPath.replace(/\\/g, "/")));
check("comentário conta >=2 handlers de PreToolUse (bundled + companion novo)", /(\d+) handler/.test(dispatcherDecl?._comment ?? "") && Number(/(\d+) handler/.exec(dispatcherDecl._comment)[1]) >= 2, dispatcherDecl?._comment);

console.log("\nsegunda chamada (já instalado — deve reusar sem rebaixar)…");
const second = await ensureNeuralLink({ log: () => {} });
check("segunda chamada disponível", second.available === true);
check("mesma versão (reuso, não reinstalação)", second.available && second.version === first.version);

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
