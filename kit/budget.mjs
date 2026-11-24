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
//   2026-11-12 runtime 28100 → 31000: bordas técnicas do ciclo de vida e da confiança, +2.8 KB — `updateEntry` (lock de arquivo e
//   rename atômico para trust.json, que três caminhos gravavam sem exclusão), cache do descritor por registry, sondagem da porta
//   quando o runtime não traz pid, `mkdir` do home com falha explícita e a recusa de destino dentro do home passando para
//   `fetchArtifact` (saiu do fetch.mjs; o ferramental encolheu), o lock de provision que confere a major, o TOFU que vira ABORT se outro processo gravou outra chave e o runtime sem pid só valendo fresco. Nenhum código funcional foi cortado.
//   2026-11-12 runtime 31000 → 32000, tooling 49200 → 51600 e adapter 6100 → 6200: defeitos com resposta óbvia. Runtime, +0.8 KB: `ensureEngine` respeita
//   `ENGINE_KIT_NO_AUTO_UPDATE` (o README já dizia que valia) e devolve `engine.updateAvailable`, e `stopEngine` sinaliza `staleCache`.
//   Ferramental, +1.6 KB: o CLI recusa flag que o verbo não aceita, o `fetch` confere a versão dentro do artefato `.tgz` e avisa registry
//   fora do ar, e o `doctor` não diz "conciliado" com motor em ERRO e fixa a chave do pacote no `--fix`; o `ensure` com atualização desligada e o `pin` avisam
//   cache vencido, e recusa de app diz que é app. Adaptador do gateway: devolve `updateAvailable`. Nenhum código funcional foi cortado.
//   2026-11-12 runtime 32000 → 33600, tooling 51600 → 51900 e adapter 6200 → 7500: decisões do dono sobre o ciclo de vida e a leitura do token. Runtime, +1.4 KB:
//   o `ensureEngine` segue servindo o motor vivo quando o registry está fora e não há cache (descritor embarcado), avisa TOFU em registry próprio e a lib exporta `unpin`;
//   `shutdown` aceita `semRelaunch` para o `stop` não relançar o harness. Ferramental, +0.2 KB: o doctor avisa chave do registry ≠ chave embarcada. Adaptador do gateway, +1.2 KB:
//   o token passa a ser lido de forma assíncrona e com limite de tempo (`readTokenAsync`), sem bloquear a ativação do host; `readToken` síncrono segue exportado. Nenhum código funcional foi cortado.
//   2026-11-12 tooling 51900 → 52200: o `doctor --fix` passou a respeitar `ENGINE_KIT_NO_AUTO_UPDATE` (pula o motor desatualizado, como o `ensure` e a lib). Nenhum código funcional foi cortado.
//   2026-11-12 runtime 33600 → 33800 e tooling 52200 → 54600: ensureEngine passa a desligar o daemon pelo shutdownPath por padrão, aceita allowDowngrade e exporta `pin`; o prazo do shutdown cobre a drenagem do gateway. Ferramental: `--json` em ensure/fetch/pin/stop (forma do doctor), `ensure --version` exato e o verify-release confere a versão dentro do .tgz. Nenhum código funcional foi cortado.
//   2026-11-13 runtime 33800 → 36700 e tooling 54600 → 59500: decisões do dono (rotação de chave, ciclo de vida e verbo `list`). Runtime, +2.9 KB:
//   rotação de chave assinada pela chave anterior (`checkTrust` aceita `install.rotation` e regrava trust.json), rollback automático quando a versão nova não sobe
//   (`ensureEngine` guarda a pasta anterior do swap e a devolve) e o registro de hashes dos arquivos extraídos (`hashTree`, `repair`). Ferramental, +4.8 KB: o
//   diagnóstico do doctor virou API (`diagnoseEngines`, `engineView`), `doctor --verify` (ADULTERADO), `engine-kit list` com checagem de `platforms`, `--rotate-from` no update-manifest
//   e o link da release exata nos cards. Nenhum código funcional foi cortado.
//   2026-11-13 tooling 59500 → 59800: `doctor --fix` limpa o cache de conferência (`verify/`) e o doctor passa a mostrar o estado SEM-BUILD (motor sem build para a plataforma).
//   Runtime fica em 36700: `ensureEngine` recusa cedo o motor sem build, pago com a remoção de duplicatas (`sleep`, o download do manifest, a extração do tar, o teste de versão servida).
//   2026-11-16 runtime 36700 → 36800: motor com atualizador próprio (`runtime.updatePath`): o `provision` e o `ensureEngine` reusam a instalação presente
//   em vez de trocá-la, para o kit e o updater do motor não desfazerem o trabalho um do outro, +0.1 KB. Nenhum código funcional foi cortado.
//   2026-11-16 client (faixa nova, baseline = medido na adoção): o cliente compartilhado da casa de embeddings e do motor de grafo (kit/client.mjs) é
//   o único arquivo do kit que os PRODUTOS importam sem ser o `index.mjs`; fora do runtime e do ferramental de autor, ele tem teto próprio.
//   2026-11-16 tooling 59800 → 60300: o doctor mostra SEM-RELEASE (entrada `pending-release`) e não pede ação nem confere hashes de motor com updater próprio, +0.5 KB.
//   2026-11-16 tooling 60300 → 62100: lembrete de chave de assinatura sem backup conferido, decidido pelo Jarvis na lente do 0.2.15
//   (kit/key-backup.mjs, a linha do doctor e o carimbo gravado pelo backup e pelo check de tools/backup-keys.mjs), +1.8 KB. Só leitura
//   de arquivo, na mão de quem publica; o caminho do `import "engine-kit"` não mudou.
//   2026-11-18 client 9000 → 9800: o `grafoClient` ganhou as rotas de tipos do motor-de-grafo (`kinds`, `nodes`, `edges`, `deleteNodes`, `deleteEdges`,
//   `neighbors`, `backup`, `symbolsOf` e `searchOf`) e passou a mostrar o `code` do erro do motor (que vem no corpo, não em `detail`), +1.1 KB. Nenhum chamador existente muda.
//   2026-11-18 runtime 36800 → 37500 e tooling 62100 → 69800: as seis funções irmãs decididas pelo dono. Runtime, +0.7 KB: o histórico local de trocas de versão
//   (`recordSwap` em trust.mjs, gravado pelo `provision` e pelo rollback do `ensureEngine`, com a falha de escrita avisada em stderr) e o `trust.json.bak` copiado antes do rename
//   do `updateEntry`, com a mensagem que ensina a restaurar; pagos em parte por duas remoções de duplicata (a gravação do `checkTrust` e a espera do `lifecycle`). Ferramental, +7.7 KB:
//   `engine-kit history`, `check <manifesto>` (faixas de versão), `url <motor>` e `doctor --report` (kit/inspect.mjs e os verbos no cli.mjs); as linhas de detalhe de cada motor passaram
//   do doctor.mjs para `detailLines` (diagnose.mjs), que o doctor e o relatório compartilham. Rodado na mão de quem instala ou diagnostica; o fecho de imports de `index.mjs` não mudou
//   e nenhum código funcional foi cortado.
//   2026-11-18 client 9800 → 10000: o `discover` passou a montar `http://127.0.0.1:<port>` quando o anúncio traz só `port` (mcp-gateway e embed-house) e a recusar porta fora de 1..65535 com erro explícito, +0.3 KB.
//   2026-11-23 client 10000 → 10700: o `ensureHome` grava a saída do executável em `<home>/run/boot.log`, escuta `exit` e `error` do processo e devolve na hora o código de saída e as últimas linhas, em vez de esperar 60 s por um anúncio que não virá; +0.64 KB.
//   2026-11-24 tooling 88300 → 95500: três funções irmãs aditivas da lente do 0.2.18 — `verify-release --all --json` (kit/verify-all.mjs, kit/verify-release.mjs),
//   `engine-kit mcp` (servidor MCP stdio só de leitura, kit/mcp.mjs) e o pré-voo opt-in `-Checar` do publish-base (kit/pre-voo.mjs); +7.1 KB. Nenhum entra no fecho
//   de kit/index.mjs: o runtime do consumidor não muda.
//   2026-11-24 tooling 95500 → 96000: `engine_doctor`, tool MCP de leitura sobre `diagnoseEngines` e `engineView` (kit/mcp.mjs), +0.4 KB; o runtime do consumidor não muda.
//   2026-11-24 tooling 96000 → 98500: `ensure --dry-run` (plano por motor, com vários motores e com `--de`, sem baixar nem gravar), em kit/ensure.mjs e kit/cli.mjs, +2.5 KB; o runtime do consumidor não muda.
//   2026-11-24 tooling 98500 → 100000: `ensure --instalados` (instaladosAtualizaveis em kit/ensure.mjs e a ramificação no kit/cli.mjs, reusando o laço de vários motores), +1.1 KB; o runtime do consumidor não muda.
//   2026-11-24 tooling 100000 → 102000: `engine-kit info <motor>` (infoCommand em kit/inspect.mjs, sobre `diagnoseEngines`, e o verbo no kit/cli.mjs), +1.7 KB; só lê; o runtime do consumidor não muda.
//   2026-11-23 tooling 84400 → 88300: `engine-kit ensure <motor> <motor>...` (uma chamada, um selfUpdate, falha de um motor sem esconder os outros) e `engine-kit update <motor>` (aciona o `runtime.updatePath` do daemon vivo, com o token do anúncio só no cabeçalho); +3.9 KB, só em kit/cli.mjs e kit/inspect.mjs. O runtime do consumidor não muda.
//   Nenhum código funcional foi cortado.
//   2026-11-18 tooling 69800 → 72000: vida real do daemon no doctor (`probeHealth` e `lifeOf` em diagnose.mjs: o `/health` pelo `healthPath` do registry, os estados TRAVADO e PID-VIVO e os
//   avisos de versão anunciada ≠ instalada e de heartbeat atrasado) e a última troca de versão de cada motor no `doctor --report` (inspect.mjs), +2.1 KB. A sondagem do `/health` saiu do
//   client.mjs (-0.2 KB, que passou a importá-la do diagnose): a mesma checagem serve ao cliente e ao doctor, sem cópia. Só leitura, rodado na mão de quem diagnostica; o fecho de imports
//   de `index.mjs` não mudou e nenhum código funcional foi cortado.
//   2026-11-18 tooling 72000 → 73400: `engine-kit ensure --de <manifesto>` decidido pelo dono (pendência f13bcf) — `ensureDeCommand` (ensure.mjs), `checkCommand` aceitando o manifest
//   dos motores e o verbo no cli.mjs, que passou a dividir com o `check` o mesmo bloco de saída, +2.4 KB. Antes de subir o teto saiu a duplicação, -1.1 KB: o pin e o manifest embarcado
//   que `ensure` e `fetch` liam cada um por si (`pinFor`, `embarcado`), o `onBeforeReplace` copiado no doctor (`derrubarAntes`), o GET anônimo repetido no `verify-release`
//   (`anonymousGet`), o preâmbulo de argumentos e manifest repetido em `update-manifest` e `verify-release` (`publish-args.mjs`) e a recusa de entrada inexistente do `update-manifest`.
//   Rodado na mão de quem instala; o fecho de imports de `index.mjs` não mudou e nenhum código funcional foi cortado.
//   2026-11-18 runtime 37500 → 38000: o artefato desce em fluxo para disco (sha256 incremental, assinatura conferida sobre o digest com `verifyDigest`) e o prazo passa a ser por
//   inatividade (`idleTimeoutMs`); o tgz de 869 MB da casa-de-embeddings estourava o prazo total e ocupava a memória inteira. O `provision.lock` passa a ser renovado (mtime, a cada `lockStaleMs / 3`) pelo `provision` e `lockStaleMs` torna o prazo de órfão injetável, para um download longo não perder o lock; a extração do `tar` passou a ser assíncrona (`extractTgz` com `execFile`) para o heartbeat seguir durante ela. +0.4 KB líquidos: antes de subir o teto saiu a duplicação, -1.0 KB
//   (a recusa `{ ok:false, reason:"<motor>: …" }` de provision e lifecycle em `refuse`, o `available:false` de lifecycle e index em `unavailable`, o manifest embarcado em `embeddedManifest`,
//   o lock velho em `dropStaleLock`, o sha256 em `sha256`, a pasta extraída em `binDirOf`, o `rm` de arquivo em `dropFile`, a linha de log com o prefixo do kit em `say` e a segunda chamada de `lifecycle` do rollback). Ferramental, sem subir o teto: o hash do marcador de extração do `fetch` passou a ser em fluxo e o `rm` da pasta usa `rmTree`. Nenhum código funcional foi cortado.
//   2026-11-21 tooling 73400 → 80300: cinco funções irmãs aditivas da lente de 0.2.18, ordenadas pelo orquestrador — `engine-kit rollback <motor>` (ensure.mjs, reusa
//   `pinCommand` e o histórico), `engine-kit trust [motor]` (inspect.mjs, só leitura do trust.json), `check` e `ensure --de` com vários manifestos (cli.mjs) e
//   `verify-release --all` (verify-all.mjs e o preâmbulo `publishArgs`), +6.9 KB. Rodadas na mão de quem instala ou publica; o fecho de imports de `index.mjs` não mudou.
//   2026-11-22 tooling 80300 → 84400: três funções irmãs aditivas da lente do 0.2.18 e a recusa do rollback após a volta automática — `engine-kit path <motor>`
//   (pathCommand, só lê), `check --rede` (checkCommand diz se a versão publicada satisfaz a faixa) e `trust --restaurar` (trustRestoreCommand, troca atômica a partir
//   do .bak), todas em inspect.mjs e cli.mjs, +4.1 KB. Rodadas na mão de quem instala; o fecho de imports de `index.mjs` não mudou.
//   2026-11-24 runtime 38000 → 38700: quarentena da versão que não subiu (decisão do dono, opção Q1) — `failedVersions` em trust.mjs lê as voltas do
//   `history.jsonl` e o `ensureEngine` mantém a versão atual em vez de baixar, derrubar e voltar a cada `ensure` (+0.6 KB). Os cortes tentados não pagaram os bytes:
//   o fecho já é denso e cada linha restante tem comportamento coberto por teste. O consumidor ganha um `ensure` que não derruba o motor à toa; o resto do runtime não mudou.
const BUDGETS = {
  runtime: { codeBytes: 38700, baseline: 24519, loc: 900 },
  client: { codeBytes: 10700, baseline: 8500, loc: 230 },
  tooling: { codeBytes: 102000, baseline: 16420, loc: 1050 },
  adapter: { codeBytes: 7500, baseline: 1859, loc: 150 },
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
const client = [join(KIT, "client.mjs")];
const tooling = all.filter((f) => !runtime.has(f) && !client.includes(f));

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
report("cliente compartilhado (importado pelos produtos)", client, BUDGETS.client);

for (const f of readdirSync(join(ROOT, "consumers")).filter((x) => x.endsWith(".mjs"))) {
  report(`adaptador ${f}`, [join(ROOT, "consumers", f)], BUDGETS.adapter);
}

console.log(failed ? "\nBUDGET ESTOURADO — kill-switch disparou." : "\nDentro do budget.");
process.exit(failed ? 1 : 0);
