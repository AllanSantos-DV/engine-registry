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
//   2026-11-24 runtime 38700 → 39000 e tooling 103500 → 104500: retentativa de rede opt-in (`ENGINE_KIT_RETRY` ou `--retry N`, 0 a 5, desligada por padrão): `fetchBuf` repete a conexão
//   que caiu, o 5xx e o 429 com espera crescente (kit/provision.mjs, +0.3 KB no runtime) e a flag e a validação ficam no kit/cli.mjs (+0.4 KB no ferramental). O teto do runtime fica
//   em 39000, o que mantém a cifra de 39 KB da vitrine. Sem a opção o comportamento é o de antes; a primeira falha continua abortando.
//   2026-11-24 tooling 102000 → 103500: `engine-kit ensure <motor> --de-arquivo <tgz>` (ensureDeArquivo e o fetcher de disco em kit/ensure.mjs, a flag e as recusas no kit/cli.mjs; a conferência de sha256, assinatura e versão é a do provision, sem caminho novo), +1.4 KB; o runtime do consumidor não muda.
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
//   2026-11-25 tooling 104500 → 109500: três funções irmãs aditivas da lente do 0.2.19, +4.9 KB (mcp.mjs +1.5, ensure.mjs +1.5, cli.mjs +1.1, inspect.mjs +0.7). As tools `engine_info` e `engine_plan` do `engine-kit mcp` e a opção `rede`
//   do `engine_check`, com a injeção de teste e a checagem de tipo dos argumentos; `rollback --dry-run` e `pin --dry-run` (o plano de troca de versão; o texto do plano, `planoEm`, passou do cli.mjs para o ensure.mjs para servir também ao MCP);
//   `info <app>` e `list --apps` (o descritor do app com o pin do trust.json). Rodadas na mão de quem instala; o fecho de `kit/index.mjs` não mudou (runtime 38984/39000, a cifra de 39 KB da vitrine segue),
//   e sem as flags e tools novas o comportamento é o de antes.
//   2026-11-25 tooling 109500 → 113000: `engine-kit fetch <motor>... --com-assinaturas`, +3.5 KB (kit/fetch.mjs +2.1, kit/cli.mjs +1.5). `salvarSidecars` confere e grava ao lado do .tgz o `.sha256` e o `.sig`
//   (sha256 do sidecar = hash do artefato gravado, Ed25519 com a chave do manifest embarcado; .part e rename; falha apaga o que gravou) e o `fetchCommand` captura os sidecars que o `fetchArtifact` já conferiu,
//   sem segundo download; o CLI aceita vários motores com a flag. Tudo no ferramental, reusando `fetchArtifact`, `verifyDigest` e `dropFile` como já são exportados: provision, resolve, trust e index não mudaram
//   (runtime 38990/39000, a cifra de 39 KB da vitrine segue). Sem a flag o comportamento é o de antes.
//   2026-11-25 tooling 113000 → 119000: `engine-kit export [arquivo]` e `engine-kit import <arquivo> [--dry-run]`, +5.9 KB (kit/export-import.mjs +3.9, kit/cli.mjs +2.0). O export grava (ou imprime) só nome, versão
//   instalada e pin por motor, mais a versão do kit; o import valida o formato (chaves conhecidas, nome e versão x.y.z, sem repetido nem `__proto__`) antes de instalar qualquer coisa e então reusa `ensureCommand`
//   com `version` (sha256, Ed25519 e chave do manifest embarcado), `pinCommand` e o plano do `ensure --dry-run`. O validador é a maior parte dos bytes: o documento vem de fora e não pode poluir nada. Tudo no ferramental, fora do
//   fecho de `kit/index.mjs` (runtime 38990/39000, a cifra de 39 KB da vitrine segue). Sem os verbos novos o comportamento é o de antes.
//   2026-11-25 tooling 119000 → 119500: correções da revisão independente dos verbos novos, +71 bytes — o `fetch --com-assinaturas` confere os sidecars com a chave que o `fetchArtifact` aceitou (rotação legítima), o `import` recusa documento com `pin` diferente da versão e só rebaixa com `--permitir-rebaixar`. O runtime não mudou (38990/39000).
//   2026-11-25 tooling 119500 → 120000: segunda rodada da revisão independente, +545 bytes (kit/ensure.mjs +214, kit/export-import.mjs +177, kit/cli.mjs +154) — o `list` aplica o `install.byPlatform` da plataforma atual ao achar o motor instalado (o export e a trava de rebaixamento do `import` passam a enxergá-lo), o `export` omite o pin que difere da versão instalada e devolve `pinOmitido` (o CLI avisa em stderr), e o `pin --version --dry-run` recusa motor self-managed como o pin de verdade. O runtime não mudou (38990/39000).
//   2026-11-26 tooling 120000 → 122000: cinco candidatos aditivos, +2.2 KB medidos, 119638 → 121803 (kit/cli.mjs +1.2, kit/mcp.mjs +0.9, kit/export-import.mjs +0.06). No MCP, `engine_doctor` aceita `engine` e `verify`, `engine_list` aceita `apps` e a tool de leitura `engine_export` devolve o documento do `exportCommand` sem gravar (reusam `diagnoseEngines`, `listCommand` e `exportCommand`; as descrições das tools são a maior parte dos bytes);
//   2026-11-26 tooling 122000 → 122500: correções da revisão independente, +367 bytes medidos, 121803 → 122170 — `import -` recusa a entrada padrão em terminal com uma linha de uso (kit/cli.mjs), a validação de argumentos do MCP só aceita chaves próprias do esquema (`Object.hasOwn`, kit/mcp.mjs) e `engine_doctor` recusa `engine` vazio. O runtime não mudou (38990/39000).
//   no CLI, `--falhar-se-desatualizado` no `ensure --dry-run` e no `ensure --instalados --dry-run` (exit 1 se algum motor teria plano diferente de reusar), `import -` (lê o documento da entrada padrão, a validação é a do `importCommand`) e o `pin` de cada motor no `list --json`; o texto do uso cresceu junto. A seção Receitas do README não pesa aqui. Tudo no ferramental, fora do fecho de `kit/index.mjs` (runtime 38990/39000, a cifra de 39 KB da vitrine segue). Sem as flags, argumentos e tools novos o comportamento é o de antes, salvo o `list --json`: com o trust.json ilegível ele agora falha com exit 1 (em vez de listar) e cada motor ganha o campo `pin`.
//   2026-11-26 tooling 122500 → 126000: o `ensure` religa o daemon vivo que ele próprio derrubou para trocar a instalação, +3.64 KB medidos, 122170 → 125808 (kit/religar.mjs novo +2.80, kit/ensure.mjs +0.70, kit/cli.mjs +0.14): `religador` (ganchos `antes` e `religar` sobre o `derrubarAntes`), `religavel`, subida e espera do anúncio reusando `launchDetached` e `discover` do cliente, `restarted` no retorno e no `--json`, `religaria` no plano do `--dry-run`. O runtime não mudou (38990/39000, a cifra de 39 KB da vitrine segue); o cliente compartilhado ficou em 10670/10700 (+32 bytes: `launchDetached` exportada, aceita `args` e devolve o `pid`), teto mantido.
//   2026-11-26 tooling 126000 → 127500: correções da revisão independente do religar, +1.30 KB medidos, 125841 → 127139 (kit/religar.mjs +0.94, kit/ensure.mjs +0.35, kit/diagnose.mjs +0.01). O `subir` reconhece o daemon novo que outro consumidor já pôs no ar
//   (sem lançar nem apagar o anúncio de um pid vivo, e com um segundo `discover` se o lançado sai), recusa `entry` e `runtimeFile` fora do home e sobe na pasta do executável, sem `NODE_OPTIONS` nem `COPILOT_SDK_PATH`;
//   o `religavel` exclui o motor que se relança sozinho (`relaunch=1`); o `ensure` cuja troca falha depois de o daemon cair religa a instalação anterior e diz na razão se subiu; o `planoEm` não escreve "undefined".
//   O runtime não mudou (38990/39000, a cifra de 39 KB da vitrine segue); o cliente compartilhado ficou em 10685/10700 (+15 bytes: `launchDetached` repassa `opts` ao `spawn`), teto mantido.
//   2026-11-26 tooling 127500 → 129500: `engine-kit pin` com vários motores e com `--instalados`, e `engine-kit unpin --todos`, +1.87 KB medidos, 127139 → 129013 (só kit/cli.mjs; o texto do uso e as mensagens de recusa são boa parte dos bytes). O `pin` de vários motores reusa o laço de vários motores do `ensure` e o `pinCommand`; `--instalados` reusa o `instaladosAtualizaveis`; o `unpin --todos` lê os pins do `trust.json` (`readTrust`, já exportada) e reusa o `unpinCommand`. Sem os nomes extras e as flags novas o comportamento é o de antes. O runtime não mudou (38990/39000, a cifra de 39 KB da vitrine segue) e o cliente compartilhado segue em 10685/10700.
//   2026-11-26 tooling 129500 → 130200: cinco correções da revisão independente do diff main..develop, +0.74 KB medidos, 129013 → 129757 (kit/export-import.mjs +0.40, kit/religar.mjs +0.18, kit/ensure.mjs +0.16). O `import` compara o rebaixamento com a maior entre a versão instalada e a `maxVersion` do `trust.json` (motor não instalado também) e grava o pin do documento mesmo quando o daemon não sobe, dizendo na razão se foi aplicado; o `ensure --dry-run` recusa, com a razão do `rollbackReason`, o que o ensure real recusaria por anti-rollback; o fim do `boot.log` na razão do religar sai sem o `shutdownToken` do runtime.json e sem hexadecimal de 32+ caracteres. O runtime não mudou (38990/39000) e o cliente compartilhado segue em 10685/10700. As outras duas correções (a guarda do `pages.yml` e o texto do `docs/PAGES.md`) não contam bytes de código.
//   2026-11-27 tooling 130200 → 134000: a quarentena visível nos verbos de leitura e o `engine-kit completion`, +3.97 KB medidos, 129757 → 133728 (kit/completion.mjs novo +2.17, kit/cli.mjs +1.02, kit/diagnose.mjs +0.50, kit/ensure.mjs +0.22, kit/inspect.mjs +0.05).
//   `quarantineOf` e `quarantineWarn` (diagnose.mjs, reusam `failedVersions` do trust.mjs) põem o aviso em `warns` do doctor e do info, o campo `quarantined` no info e no plano do `ensure --dry-run`; as tools MCP herdam. O aviso não muda estado, exit code nem plano.
//   `completion <bash|zsh|powershell>` gera o script de VERBS, FLAGS e dos nomes do manifest embarcado. Rodadas na mão de quem instala; o fecho de `kit/index.mjs` não mudou (runtime 38990/39000, a cifra de 39 KB da vitrine segue) e o cliente ficou em 10685/10700.
//   2026-11-27 tooling 134000 → 137000: o espelho em lote do `fetch` e a quarentena no `ensure` do CLI, +3.03 KB medidos, 133728 → 136758 (kit/cli.mjs +2.39, kit/ensure.mjs +0.35, kit/fetch.mjs +0.15, kit/export-import.mjs +0.14).
//   `fetch --instalados` e `fetch --de-export <documento>` baixam e conferem o artefato de vários motores sem instalar: reusam `instaladosAtualizaveis`, o `validarDocumento` (agora atrás de `lerDocumento`, que o `import` também usa), o laço e o envelope `{ ok, engines }` do `fetch` de vários motores e a opção `soMotor` do `fetchCommand`; o texto do uso e as recusas das flags são boa parte dos bytes.
//   O `ensureCommand` passa a aplicar a quarentena como o `ensureEngine` (`quarantineOf` e `quarantineWarn` do diagnose.mjs, o ramo `manter` já existente): mantém a instalada, devolve `quarantined` e o `--dry-run` planeja `manter`; `--version`, pin e `--de-arquivo` mandam. Tudo no ferramental, fora do fecho de `kit/index.mjs` (runtime 38990/39000, a cifra de 39 KB da vitrine segue) e o cliente ficou em 10685/10700. Sem as flags novas e sem histórico de volta o comportamento é o de antes.
//   2026-11-27 tooling 137000 → 138500: cinco correções da revisão independente do diff main..develop, +1.41 KB medidos, 136758 → 138170 (kit/ensure.mjs +0.64, kit/completion.mjs +0.25, kit/cli.mjs +0.19, kit/export-import.mjs +0.17, kit/doctor.mjs +0.17).
//   O `doctor --fix` pula o motor em quarentena (`PULADO`) em vez de reinstalar a versão que não subiu; o `ensure --de` devolve `quarantined` e `warns` do motor mantido (o texto do --dry-run mostra o aviso); `semDuplicados` reduz o export e o `--instalados` (ensure, pin e fetch)
//   a um motor por home e entrada na plataforma, o de nome canônico, para o `motor-de-grafo` e o `motor-de-grafo-linux-x64` não contarem o mesmo binário duas vezes; o `completion` recusa nome de motor fora de /^[a-z0-9][a-z0-9._-]*$/; o uso e o README do `fetch --instalados` dizem "versão do registry (ou o pin)".
//   Runtime 38990 → 38974 de 39000 (a cifra de 39 KB da vitrine segue): `failedVersions` (kit/trust.mjs) ignora o `from` de uma volta se uma linha posterior do motor tem `to` igual (a versão voltou a subir por escolha), +0.09 KB pagos mudando para linha própria um comentário que o kill-switch contava como código. O cliente ficou em 10685/10700.
//   2026-11-27 tooling 138500 → 140000: três correções P2 da revisão independente, +1.74 KB medidos, 138170 → 139912 (kit/religar.mjs +0.85, kit/ensure.mjs +0.66, kit/doctor.mjs +0.17, kit/export-import.mjs +0.06, kit/fetch.mjs +0.01).
//   O `doctor --fix` conta como falha (exit 1) o motor ADULTERADO cuja versão oferecida está em quarentena, em vez de pulá-lo e dizer "conciliado"; o `subir` do religar compara a versão anunciada sem o sufixo `+metadata`, devolve ok:false sem matar o daemon saudável que anuncia outra versão e espera o pid vivo já anunciado em vez de lançar um segundo;
//   `pinDaInstalacao` (kit/ensure.mjs, reusado pelo `pinFor`, pelo export e pelo fetch) faz o canônico herdar o pin gravado em outro nome do mesmo home e entrada, e `instalacaoDe` passou a ser a chave única que o `semDuplicados` também usa. Runtime 38974/39000 e cliente 10685/10700 não mudaram.
//   2026-11-27 tooling 140000 → 140500: quatro correções P2 da segunda revisão independente, +0.30 KB medidos, 139912 → 140207 (kit/ensure.mjs +0.23, kit/cli.mjs +0.03, kit/religar.mjs +0.03).
//   O `unpin` de um nome cujo pin continua valendo por outro que divide a instalação devolve ok com `warns` ("continua fixado em vX por <dono>") e o CLI imprime a linha `aviso:` (fora do `--todos`); o `subir` do religar volta a lançar por node só o entry `.js/.mjs/.cjs` (a barra invertida da regex tinha sido apagada), encerra o filho lançado quando outro pid anuncia versão diferente e usa um prazo único para a espera do pid anterior e a do filho.
//   Runtime 38974/39000 e cliente 10685/10700 não mudaram.
//   2026-11-27 tooling 140500 → 140700: dois P2 do `subir` do religar da terceira revisão independente, +0.32 KB medidos, 140207 → 140526 (kit/religar.mjs +0.32).
//   O filho lançado espera sempre ao menos o piso (`PISO_FILHO_MS`, nunca maior que o prazo) e a falha diz o tempo concedido a ele; o daemon que anuncia a versão esperada no último olhar é devolvido ok, sem matar o filho. Runtime 38974/39000 e cliente 10685/10700 não mudaram.
//   2026-11-27 tooling 140700 → 140800: quatro P2 da quarta revisão independente, +0.19 KB medidos, 140526 → 140717 (kit/religar.mjs +0.26, kit/doctor.mjs +0.20, kit/ensure.mjs -0.27).
//   O `doctor --fix` usa o `religador` do `ensure` (religa só o daemon que derrubou, com prazo; a falha ao religar conta em `failures`; a troca que falha religa a instalação anterior) e `aposReligar` passou a montar o texto da razão nos dois verbos; o `subir` do religar encerra o filho lançado sempre que o anunciante é outro pid. Runtime 38974 → 38982 de 39000 (a cifra de 39 KB da vitrine segue):
//   o `fetchArtifact` recusa `assetName` com separador de caminho ou `..` antes de gravar qualquer coisa (+0.16 KB), pagos compactando try/catch e ifs do mesmo fecho em `kit/provision.mjs`. Cliente 10685/10700 não mudou.
//   2026-11-27 tooling 140800 → 141400: seis P2 da quinta revisão independente, +0.64 KB medidos, 140717 → 141358 (kit/religar.mjs +0.52, kit/fetch.mjs +0.13).
//   2026-11-27 tooling 141400 → 141500: três P2 da revisão do delta, +0.1 KB medidos, 141358 → 141453 (kit/religar.mjs): a redação do boot.log cobre base64 padrão, o filho lançado é encerrado quando outro daemon da versão certa anuncia primeiro.
//   2026-11-27 tooling 141500 → 141600: o filho lançado só é encerrado se ainda vive, antes e depois da espera do `divergiu`, e a morte do filho nessa janela volta a dizer "saiu ao subir" com o `boot.log`; +0.1 KB medidos, 141453 → 141550 (kit/religar.mjs).
//   O religar passa a religar também o daemon TRAVADO (pid e porta, `/health` lento) e avisa na saída quando o gancho derrubou o daemon de um motor que o kit não religa; a razão só diz "o daemon anterior foi religado" se o executável anterior existe, senão diz que a instalação anterior não existe mais e nada é lançado;
//   anúncio sem pid não encerra ninguém e a razão diz isso; o fim do `boot.log` omite qualquer sequência de 24+ caracteres `[A-Za-z0-9_-]` e fica em 5 linhas e 400 caracteres. O `versaoDivergente` do fetch recusa versão que não é semver antes de extrair ou apagar.
//   Runtime 38982 → 38941 de 39000 (a cifra de 39 KB da vitrine segue): o `fetchArtifact` passou a recusar `assetName` fora de /^[A-Za-z0-9][w.+-]*$/ ou com nome de dispositivo do Windows e `version` que não casa com `SEMVER` (+0.2 KB), antes de baixar, gravar ou apagar;
//   pagos juntando em linha única blocos curtos de `kit/lifecycle.mjs`, `kit/trust.mjs`, `kit/index.mjs`, `kit/resolve.mjs` e `kit/provision.mjs`, sem mudar comportamento. Cliente 10685/10700 não mudou.
const BUDGETS = {
  runtime: { codeBytes: 39000, baseline: 24519, loc: 900 },
  client: { codeBytes: 10700, baseline: 8500, loc: 230 },
  tooling: { codeBytes: 141600, baseline: 16420, loc: 1050 },
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
