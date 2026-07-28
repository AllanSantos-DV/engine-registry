// e2e-neural-link.mjs — prova que o dispatcher instala do zero pelo kit, ASSINADO, e que o
// update NÃO come o estado do usuário.
//
// O detalhe que este teste existe para travar: o `extractTo` do neural-link é ANINHADO
// (`runtimes/neural-link`) porque o home guarda `weights/` e `logs/` — o aprendizado da máquina.
// Se o swap trocasse o home inteiro, cada atualização apagaria esse aprendizado em silêncio.
// Aqui o home ganha um `weights/learned.json` ANTES da instalação e é conferido depois.
//
//   node e2e-neural-link.mjs
import { resolve, provision, lifecycle } from "./kit/index.mjs";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

const HOME = join(tmpdir(), `nl-e2e-${Date.now()}`);
let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("== e2e: instalar o neural-link (kind=cli) do zero via engine-kit ==\n");
console.log(`HOME isolado: ${HOME}\n`);

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const r = await resolve("neural-link", { manifest });
check("resolve", r.ok, r.ok ? r.engine.assetUrl : r.reason);
if (!r.ok) { process.exit(1); }
check("declarado como kind=cli", r.engine.kind === "cli", r.engine.kind);

// Estado do usuário que precisa SOBREVIVER ao update.
mkdirSync(join(HOME, "weights"), { recursive: true });
const marca = JSON.stringify({ aprendizado: "do usuario" });
writeFileSync(join(HOME, "weights", "learned.json"), marca);

const engine = { ...r.engine, homeDir: HOME };

console.log("\nbaixando e instalando (download real)…");
const p = await provision(engine, { log: (m) => console.log(`    ${m}`) });
check("provision instalou", p.ok, p.ok ? `v${p.version}` : p.reason);
if (!p.ok) { process.exit(1); }
check("assinatura conferida", p.signed === true);
check("entrypoint no disco", existsSync(p.entryPath), relative(HOME, p.entryPath));
check("wrapper do Windows veio junto", existsSync(join(HOME, "runtimes", "neural-link", "bin", "neural-link.ps1")));
check("wrapper do Unix veio junto", existsSync(join(HOME, "runtimes", "neural-link", "bin", "neural-link.sh")));

// O ponto do extractTo aninhado.
const sobreviveu = existsSync(join(HOME, "weights", "learned.json"))
  && readFileSync(join(HOME, "weights", "learned.json"), "utf8") === marca;
check("o aprendizado do usuário SOBREVIVEU à instalação", sobreviveu);

// kind=cli: entrega o binário sem subir processo e sem exigir healthCheck.
const l = await lifecycle(engine, p.entryPath, {});
check("lifecycle disponível sem healthCheck", l.available, l.available ? "" : l.reason);
check("não subiu daemon (runtime nulo)", l.available && l.runtime === null);
check("devolveu o binário", l.available && l.bin === p.entryPath);

// Segunda passada: já satisfaz o pin → REUSA, não rebaixa nada.
const again = await provision(engine, {});
check("segunda chamada REUSA (não rebaixa)", again.ok && again.reused === true, again.ok ? `v${again.version}` : again.reason);

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
