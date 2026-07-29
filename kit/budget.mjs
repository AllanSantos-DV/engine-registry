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

// Budgets re-baselinados em 2026-07-29 com DELTA JUSTIFICADO, não bump arbitrário:
//   600 (original: resolve+provision+lifecycle) + 137 (autenticidade Ed25519: signature+keystore,
//   pedida por review e aprovada pelo dono) = 737 real medido → 800 com ~8% de folga, para que
//   uma correção de 2 linhas não dispare o kill-switch (ruído) mas uma FEATURE nova dispare (sinal).
const BUDGETS = { runtime: 800, tooling: 500, adapter: 150 };

// `split("\n")` num arquivo terminado em newline devolve um elemento vazio no fim — linha
// fantasma. Sem o `replace`, cada arquivo inflava a conta em 1 e o kill-switch disparava
// por medição errada (foi o que aconteceu na primeira execução deste arquivo).
const lines = (f) => readFileSync(f, "utf8").replace(/\n$/, "").split("\n").length;

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

const sum = (files) => files.reduce((n, f) => n + lines(f), 0);
const rel = (f) => f.replace(ROOT + "\\", "").replace(ROOT + "/", "").replaceAll("\\", "/");

let failed = false;
const report = (label, files, budget) => {
  const total = sum(files);
  const over = total > budget;
  failed ||= over;
  console.log(`\n${over ? "!!" : "OK"}  ${label}: ${total}/${budget} linhas`);
  for (const f of [...files].sort((a, b) => lines(b) - lines(a))) {
    console.log(`      ${String(lines(f)).padStart(4)}  ${rel(f)}`);
  }
  if (over) { console.log(`      ESTOUROU em ${total - budget} linhas → decidir: cortar ou re-baselinar com delta justificado.`); }
};

console.log("== engine-kit budget ==  (kill-switch auto-aplicado)");
report("runtime do consumidor (fecho de index.mjs)", [...runtime], BUDGETS.runtime);
report("ferramental de autor (nunca importado por consumidor)", tooling, BUDGETS.tooling);

for (const f of readdirSync(join(ROOT, "consumers")).filter((x) => x.endsWith(".mjs"))) {
  report(`adaptador ${f}`, [join(ROOT, "consumers", f)], BUDGETS.adapter);
}

console.log(failed ? "\nBUDGET ESTOURADO — kill-switch disparou." : "\nDentro do budget.");
process.exit(failed ? 1 : 0);
