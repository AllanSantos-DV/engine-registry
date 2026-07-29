// engine-kit/budget.mjs — o KILL-SWITCH de tamanho, auto-aplicado.
//
//   node kit/budget.mjs          # mede e falha (exit 1) se estourar
//
// Por que existe: o budget vivia como um NÚMERO NUM PLANO, e número em plano apodrece —
// o plano dizia "393 linhas" quando o real já era 1087. Um kill-switch que ninguém mede
// não é kill-switch, é decoração. Aqui ele se mede sozinho e falha loud.
//
// O que ele mede (a distinção que faltava): o budget existe para impedir que **as extensões**
// carreguem um monstro. Então o que conta é o CAMINHO DO CONSUMIDOR — o fecho transitivo dos
// imports a partir de `index.mjs`, que é o que um `import "engine-kit"` realmente traz. O
// ferramental de AUTOR (assinar, gerar chave, publicar, diagnosticar) nunca é importado por
// consumidor: roda como comando na mão de quem publica. Misturar os dois numa soma só compara
// alhos com bugalhos e faz o kill-switch disparar pelo motivo errado.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const KIT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(KIT, "..");

// Budgets. A métrica ENFORÇADA é **bytes de código** (linhas em branco e comentários fora), não
// linhas: uma review corroborada apontou, com razão, que LOC é proxy ruim — o que custa ao
// consumidor é o que ele carrega e parseia, e este kit é comentado em pt-BR (comentário engorda
// LOC sem custar comportamento). LOC fica como informação, não como portão.
//
// Contra o "mover a trave": cada faixa registra `baseline` — o valor MEDIDO quando a métrica foi
// adotada (2026-07-29, já com a raiz de confiança). O relatório imprime o crescimento desde essa
// marca, então subir o teto depois deixa de ser invisível: vira um número na tela e um diff.
// Calibrar uma vez, na adoção da métrica, é linha de base; recalibrar toda vez que dispara é
// contornar o guarda-corpo — e é isso que o baseline expõe.
const BUDGETS = {
  runtime: { codeBytes: 27000, baseline: 24519, loc: 900 },
  tooling: { codeBytes: 18000, baseline: 16420, loc: 600 },
  adapter: { codeBytes: 4000, baseline: 1859, loc: 150 },
};

// `split("\n")` num arquivo terminado em newline devolve um elemento vazio no fim — linha
// fantasma. Sem o `replace`, cada arquivo inflava a conta em 1 e o kill-switch disparava
// por medição errada (foi o que aconteceu na primeira execução deste arquivo).
const linesOf = (f) => readFileSync(f, "utf8").replace(/\n$/, "").split("\n");
const lines = (f) => linesOf(f).length;

/** Bytes que não são linha em branco nem comentário de linha inteira. */
const codeBytes = (f) =>
  linesOf(f)
    .filter((l) => {
      const t = l.trim();
      return t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .reduce((n, l) => n + Buffer.byteLength(l, "utf8") + 1, 0);

/** Fecho transitivo dos imports relativos a partir de um entrypoint. */
function closure(entry) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) { return; }
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/from\s+"(\.[^"]+)"/g)) {
      walk(resolvePath(dirname(file), m[1]));
    }
  };
  walk(entry);
  return seen;
}

const runtime = closure(join(KIT, "index.mjs"));
const all = readdirSync(KIT).filter((f) => f.endsWith(".mjs")).map((f) => join(KIT, f));
const tooling = all.filter((f) => !runtime.has(f));

const rel = (f) => f.replace(ROOT + "\\", "").replace(ROOT + "/", "").replaceAll("\\", "/");

let failed = false;
const report = (label, files, budget) => {
  const bytes = files.reduce((n, f) => n + codeBytes(f), 0);
  const loc = files.reduce((n, f) => n + lines(f), 0);
  const over = bytes > budget.codeBytes;
  failed ||= over;
  console.log(`\n${over ? "!!" : "OK"}  ${label}`);
  const growth = bytes - budget.baseline;
  const pct = ((growth / budget.baseline) * 100).toFixed(1);
  console.log(`      ${bytes}/${budget.codeBytes} bytes de código   (${loc} linhas, informativo)`);
  console.log(`      baseline ${budget.baseline} B → ${growth >= 0 ? "+" : ""}${growth} B (${pct}%) desde a adoção da métrica`);
  for (const f of [...files].sort((a, b) => codeBytes(b) - codeBytes(a))) {
    console.log(`      ${String(codeBytes(f)).padStart(6)} B  ${String(lines(f)).padStart(4)} L  ${rel(f)}`);
  }
  if (over) { console.log(`      ESTOUROU em ${bytes - budget.codeBytes} bytes → decidir: cortar ou re-baselinar com delta justificado.`); }
};

console.log("== engine-kit budget ==  (kill-switch auto-aplicado; métrica = bytes de código)");
report("runtime do consumidor (fecho de index.mjs)", [...runtime], BUDGETS.runtime);
report("ferramental de autor (nunca importado por consumidor)", tooling, BUDGETS.tooling);

for (const f of readdirSync(join(ROOT, "consumers")).filter((x) => x.endsWith(".mjs"))) {
  report(`adaptador ${f}`, [join(ROOT, "consumers", f)], BUDGETS.adapter);
}

console.log(failed ? "\nBUDGET ESTOURADO — kill-switch disparou." : "\nDentro do budget.");
process.exit(failed ? 1 : 0);
