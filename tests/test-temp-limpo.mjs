// test-temp-limpo.mjs — rodar os testes não deixa arquivo no %TEMP% da máquina nem na pasta tmp do produto.
//
// Roda quatro testes que antes vazavam (nome com Date.now sem rmSync, mkdtemp sem rmSync) duas vezes e exige
// que a segunda rodada não crie nenhuma entrada nova no %TEMP% real (nos prefixos que os testes usam) nem na pasta
// tmp do produto. Um teste sem o import de _tmp.mjs aparece aqui como sobra.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const TEMP_REAL = process.env.TEMP;
const { pastaTmpDoProduto } = await import("./_tmp.mjs");
const AQUI = dirname(fileURLToPath(import.meta.url));
const AMOSTRA = ["test-signature.mjs", "test-fetch.mjs", "test-doctor-exit.mjs", "test-resolve-cache.mjs"];

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const testes = readdirSync(AQUI).filter((f) => f.endsWith(".mjs") && f !== "_tmp.mjs");
const prefixos = new Set();
for (const f of testes) {
  for (const m of readFileSync(join(AQUI, f), "utf8").matchAll(/tmpdir\(\)\s*,\s*([`"'])([\w.-]+?)-?(?:\$\{|\1)/g)) prefixos.add(m[2]);
}
const dosTestes = (nome) => [...prefixos].some((p) => nome.startsWith(p));
const entradasReais = () => readdirSync(TEMP_REAL).filter(dosTestes);
const entradasProduto = () => readdirSync(pastaTmpDoProduto());

check("prefixos de temporários dos testes foram descobertos", prefixos.size >= 10, `${prefixos.size}`);
const semHelper = testes.filter((f) => f !== "test-temp-limpo.mjs" && /tmpdir/.test(readFileSync(join(AQUI, f), "utf8")) && !readFileSync(join(AQUI, f), "utf8").includes("_tmp.mjs"));
check("todo teste que usa tmpdir importa _tmp.mjs", semHelper.length === 0, semHelper.join(","));

const roda = () => AMOSTRA.map((f) => spawnSync(process.execPath, [join(AQUI, f)], {
  env: { ...process.env, TEMP: TEMP_REAL, TMP: TEMP_REAL, TMPDIR: TEMP_REAL }, encoding: "utf8", windowsHide: true, timeout: 300000,
}).status);

check("primeira rodada da amostra passa", roda().every((s) => s === 0));
const reaisAntes = new Set(entradasReais()), produtoAntes = new Set(entradasProduto());
check("segunda rodada da amostra passa", roda().every((s) => s === 0));
const reaisNovas = entradasReais().filter((n) => !reaisAntes.has(n));
const produtoNovas = entradasProduto().filter((n) => !produtoAntes.has(n));
check("segunda rodada não cria entrada nova no %TEMP% real", reaisNovas.length === 0, reaisNovas.slice(0, 5).join(","));
check("segunda rodada não cria entrada nova na pasta tmp do produto", produtoNovas.length === 0, produtoNovas.slice(0, 5).join(","));

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
