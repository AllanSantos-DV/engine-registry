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
//
// Recalibrações com delta justificado (o baseline NÃO muda; só o teto):
//   2026-10-11 tooling 18000 → 24000: catálogo de APLICATIVOS (manifest.apps) — app-release.mjs e
//   os modos --app de update-manifest/verify-release, +6.4 KB. É escopo novo (segundo tipo de
//   entrada no registry), não inchaço; e é ferramental de autor: o caminho do consumidor não mudou.
//   2026-10-23 adapter 4000 → 5000: o token do mcp-gateway passou ao cofre DPAPI (0.13.8) e o
//   adaptador precisa lê-lo (cofre → env → arquivo, a regra do daemon), +1.4 KB. Não é gordura:
//   é o contrato de autenticação do motor, que só o adaptador do motor pode conhecer.
//   2026-10-27 tooling 24000 → 31000 (loc 800 → 950): canal npm aprovado pelo dono — cli.mjs, ensure.mjs
//   e update.mjs (`npx engine-kit ensure <motor>` com autoatualização exigida pelo gate de release), +6.3 KB.
//   Escopo novo (comando de instalação), rodado pela mão de quem instala, nunca importado por consumidor:
//   o caminho do `import "engine-kit"` não mudou.
//   2026-11-09 tooling 31000 → 34000: diagnóstico de vida (pid, porta, idade do runtime) e do ponteiro
//   `cli.json` no doctor (diagnose.mjs), +2.7 KB. Só leitura, rodado na mão de quem diagnostica; o caminho do
//   `import "engine-kit"` não mudou.
//  2026-11-09 tooling 34000 → 37000 (loc 950 → 1050): pin por motor aprovado pelo dono — `engine-kit pin/unpin`
//   (ensure.mjs, cli.mjs) e o estado FIXADO do doctor, +3.6 KB. No runtime o pin entrou sem subir o teto
//   (dedup em provision/lifecycle pagou os bytes).
//   2026-11-11 adapter 5000 → 5500: o adaptador do mcp-gateway passou a pedir `POST /admin/drain` (bearer) antes
//   de sinalizar o daemon, +0.6 KB. É o contrato de desligamento do motor, que só o adaptador do motor conhece:
//   no Windows o SIGTERM mata na hora e corta as chamadas em curso. O caminho do `import "engine-kit"` não mudou.
//   2026-11-11 tooling 37000 → 37500: o `ensure` passou a avisar quando instala a partir do descritor em cache
//   vencido (registry fora do ar) e quando o ponteiro `cli.json` do motor está quebrado, +0.3 KB (cli.mjs,
//   ensure.mjs, reusando `pointerOf` do diagnose). O caminho do `import "engine-kit"` não mudou.
//   2026-11-12 tooling 37500 → 40500: `engine-kit fetch <motor|app>` aprovado pelo dono (kit/fetch.mjs, o verbo no cli.mjs e a
//   gravação opcional dos assets em app-release.mjs), +3.0 KB. Baixa e confere (sha256 + Ed25519) sem instalar, reusando
//   `fetchArtifact` e `verifyAppRelease`; rodado na mão de quem instala, nunca importado por consumidor: o caminho do
//   `import "engine-kit"` não mudou.
//   2026-11-12 tooling 40500 → 41200: o `fetch` passou a respeitar o pin do motor e a recusar `--registry-url` em app, e o CLI
//   a recusar `--dest` e `--registry-url` sem valor (antes a flag seguinte virava nome de pasta), +0.6 KB. Fail-loud no
//   ferramental de quem instala; o caminho do `import "engine-kit"` não mudou.
//   2026-11-12 adapter 5500 → 5600: `ensureGateway` passou a devolver `instructions` (a leitura de `readInstructions`, que o
//   adaptador já tinha), +0.03 KB. O host recebe url, token e o pacote de instruções do motor numa chamada só.
//   2026-11-12 tooling 41200 → 42000: o bin ganhou o verbo `doctor` (quem usa npx não clonou o repositório) e o `ensure` de motor
//   self-managed passou a apontar a página da release e o `fetch`, +0.5 KB. Roda na mão de quem instala; o caminho do
//   `import "engine-kit"` não mudou.
//   2026-11-12 adapter 5600 → 6100: `ensureGateway` passou a devolver `version`, `staleCache` e `tokenReason`, a repassar `refresh` e a fixar
//   a chave do primeiro contato do manifest embarcado (`firstContactKeys`, em kit/ensure.mjs), +0.5 KB. O host decide com o retorno, em vez de
//   descobrir pelo 401 ou por uma chave trocada no registry.
//   2026-11-12 tooling 42000 → 42200: `firstContactKeys` (a chave do primeiro contato do manifest embarcado) saiu do adaptador do gateway
//   para o ensure.mjs e passou a servir também ao adaptador do neural-link, que estava em TOFU, +0.2 KB. O caminho do
//   `import "engine-kit"` não mudou.
//   2026-11-12 tooling 42200 → 43000: o doctor ganhou `--json` (estado, vida e ponteiro de cada motor para agentes e hooks) e dois
//   avisos de só leitura (registry sem resposta, chave do registry diferente da gravada no trust.json), +0.7 KB. Rodado na mão de
//   quem diagnostica; o caminho do `import "engine-kit"` não mudou.
//   2026-11-12 tooling 43000 → 45300: `engine-kit stop <motor>` (desliga pelo shutdownPath declarado, reusando `shutdown`) e
//   `ensure neural-link --register` (reusa o `install()` do motor, agora exportado como `registerNeuralLink`), aprovados pelo
//   dono, +2.3 KB (verbos e textos de uso no cli.mjs, stopCommand no ensure.mjs). Rodados na mão de quem instala; o caminho do `import "engine-kit"` não mudou.
//   2026-11-12 tooling 45300 → 46800: `doctor --fix` passou a limpar as sobras do `provision` (`stage-*`, artefato e `.old-<pid>`,
//   respeitando o `provision.lock` fresco ou de processo vivo) e o diagnóstico avisa quando elas existem, +1.7 KB. Rodado na mão de quem diagnostica; o
//   caminho do `import "engine-kit"` não mudou.
//   2026-11-12 runtime 27000 → 28100 (único recalibre do runtime): `stopEngine` na lib, o aviso do `shutdown` enquanto espera motor ocupado, e a chave
//   do pacote como default em `provision` e `fetchArtifact` (verifyAuthenticity: recusa motor do registry público sem chave do
//   pacote e falha alto se o manifest embarcado for ilegível). +1.1 KB, aprovados pelo orquestrador; o runtime já tinha sido
//   enxugado por duplicação antes de crescer.
//   2026-11-12 tooling 46800 → 49200: `ensure neural-link --unregister`, `--register` listando os eventos gravados, o estado dos hooks e o
//   `stoppable` no doctor, e `fetch` recusando `--dest` dentro do home do motor, +2.4 KB (inclui a recusa do `fetch` para motor pending-release). Rodados na mão de quem instala ou diagnostica.
//   2026-11-12 runtime 28100 → 30300: nove bordas técnicas do ciclo de vida e da confiança, +2.2 KB — `updateEntry` (lock de arquivo e
//   rename atômico para trust.json, que três caminhos gravavam sem exclusão), cache do descritor por registry, sondagem da porta
//   quando o runtime não traz pid, `mkdir` do home com falha explícita e a recusa de destino dentro do home passando para
//   `fetchArtifact` (saiu do fetch.mjs; o ferramental encolheu). Nenhum código funcional foi cortado.
const BUDGETS = {
  runtime: { codeBytes: 30300, baseline: 24519, loc: 900 },
  tooling: { codeBytes: 49200, baseline: 16420, loc: 1050 },
  adapter: { codeBytes: 6100, baseline: 1859, loc: 150 },
};

// `split("\n")` num arquivo terminado em newline devolve um elemento vazio no fim — linha
// fantasma. Sem o `replace`, cada arquivo inflava a conta em 1 e o kill-switch disparava
// por medição errada (foi o que aconteceu na primeira execução deste arquivo).
// `\r?\n`: o checkout do Windows (autocrlf) traz CRLF, e o `\r` contaria 1 byte por linha — a mesma
// árvore mediria diferente no Linux e no Windows.
const linesOf = (f) => readFileSync(f, "utf8").replace(/\r?\n$/, "").split(/\r?\n/);
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
