// test-diagnose.mjs — prova o diagnóstico de vida e de ponteiro do doctor (kit/diagnose.mjs).
// Só leitura, em pastas temporárias: nenhum motor real é consultado e nenhum daemon é tocado.
import "./_tmp.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lifeOf, pointerOf } from "../kit/diagnose.mjs";

let fail = 0;
const check = (name, cond, detail = "") => {
  console.log(`  ${cond ? "OK  " : "FALHOU"} ${name}${cond ? "" : ` — ${detail}`}`);
  if (!cond) fail++;
};

const tmp = mkdtempSync(join(tmpdir(), "ek-diagnose-"));
const PID_INEXISTENTE = 2147483646;
const motor = (nome, runtime) => {
  const homeDir = join(tmp, nome);
  mkdirSync(join(homeDir, "run"), { recursive: true });
  mkdirSync(join(homeDir, "bin"), { recursive: true });
  return { name: nome, homeDir, install: { entry: "bin/cli.mjs", extractTo: "bin" }, runtime };
};
const rt = { transport: "http", runtimeFile: "run/daemon.json", heartbeatMs: 30000 };
const escreve = (e, arquivo, obj) => writeFileSync(join(e.homeDir, arquivo), JSON.stringify(obj));

console.log("== vida ==");
const semBloco = motor("sem-bloco");
check("motor sem bloco runtime → SEM-DECLARAÇÃO (o doctor não inventa vida)", lifeOf(semBloco).state === "SEM-DECLARAÇÃO");
check("transporte por pipe, sem arquivo de runtime → SEM-DECLARAÇÃO e diz o transporte",
  /pipe/.test(lifeOf(motor("pipe", { transport: "pipe", pipeName: "x" })).detail));

const parado = motor("parado", rt);
check("sem arquivo de runtime → PARADO", lifeOf(parado).state === "PARADO");

const vivo = motor("vivo", rt);
escreve(vivo, "run/daemon.json", { pid: process.pid, port: 47123 });
const v = lifeOf(vivo);
check("runtime com pid existente → VIVO, com pid e porta no detalhe", v.state === "VIVO" && v.detail.includes(`pid ${process.pid}`) && v.detail.includes("47123"), JSON.stringify(v));

const orfao = motor("orfao", rt);
escreve(orfao, "run/daemon.json", { pid: PID_INEXISTENTE, port: 47124 });
const o = lifeOf(orfao);
check("runtime apontando para pid que não existe → ÓRFÃO, nunca VIVO", o.state === "ÓRFÃO" && /não existe/.test(o.detail), JSON.stringify(o));

const velho = motor("velho", rt);
escreve(velho, "run/daemon.json", { pid: process.pid });
const antes = new Date(Date.now() - 3600_000);
utimesSync(join(velho.homeDir, "run/daemon.json"), antes, antes);
check("a idade do runtime aparece no detalhe (3600s) com o limite declarado", /há 3600s \(limite 90s\)/.test(lifeOf(velho).detail), lifeOf(velho).detail);

console.log("\n== ponteiro cli.json ==");
const sem = motor("sem-ponteiro");
check("sem cli.json → AUSENTE", pointerOf(sem).state === "AUSENTE");

const ruim = motor("ilegivel");
writeFileSync(join(ruim.homeDir, "cli.json"), "{ não é json");
check("cli.json corrompido → ILEGÍVEL", pointerOf(ruim).state === "ILEGÍVEL");

const dentro = motor("dentro");
writeFileSync(join(dentro.homeDir, "bin", "cli.mjs"), "");
escreve(dentro, "cli.json", { cli: join(dentro.homeDir, "bin", "cli.mjs"), node: process.execPath, version: "1.0.0" });
check("todo caminho existe e o motor está na instalação do kit → OK (campo node e versão não contam como fora)", pointerOf(dentro).state === "OK", JSON.stringify(pointerOf(dentro)));

const quebrado = motor("quebrado");
escreve(quebrado, "cli.json", { cli: join(quebrado.homeDir, "bin", "sumiu.mjs"), node: process.execPath });
const q = pointerOf(quebrado);
check("ponteiro para arquivo inexistente → QUEBRADO, nomeando o campo", q.state === "QUEBRADO" && /cli/.test(q.detail), JSON.stringify(q));

const fora = motor("fora");
const alheio = join(tmp, "outro-lugar.mjs");
writeFileSync(alheio, "");
escreve(fora, "cli.json", { cli: alheio, node: process.execPath });
check("ponteiro para executável que existe mas fica fora da instalação do kit → FORA-DA-INSTALAÇÃO", pointerOf(fora).state === "FORA-DA-INSTALAÇÃO", JSON.stringify(pointerOf(fora)));

rmSync(tmp, { recursive: true, force: true });
console.log(fail === 0 ? "\n== TUDO VERDE ==" : `\n== ${fail} FALHA(S) ==`);
process.exitCode = fail === 0 ? 0 : 1;
