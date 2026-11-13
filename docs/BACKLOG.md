# Backlog

Melhorias encontradas durante outro trabalho e deixadas para depois.

## Técnico

Vazio.

## Aguardando decisão do dono

Cada item muda o uso do produto. O candidato (k) traz ganho, esforço (pequeno, médio ou grande, sem prazo), reuso e recomendação.

- **Decidido (Jarvis, 12/11): `uninstall()` do neural-link segue a recomendação; trabalho do projeto neural-link.** **`uninstall()` no neural-link (projeto neural-link, `src/install.js`).** O `engine-kit ensure neural-link --unregister` já existe e
  chama o `uninstall()` do motor instalado, mas o neural-link só exporta `install()`: hoje o comando falha alto dizendo isso. O motor passa a exportar
  `uninstall({})`, que remove os `_dispatcher-<Evento>.json` e devolve `{ removed: [...] }`. Nada a mudar neste repositório.

- **Decidido (Jarvis, 12/11): segue do dono.** **Esquema de confiança do registry: assinatura sem chave e publicação do kit com aprovação.** Pendência aberta 3a178e: muda como o dono
  publica o kit (um clique de aprovação 2FA por release) e o que ele guarda. Recomendação: esquema D, com os motores assinados sem chave
  (keyless) no CI hospedado, nos três repositórios pesados (native-java, cerne, vox-engine), e o engine-kit publicado no npm só com a
  aprovação 2FA do dono. Custos: minutos pagos dos builds hospedados nos repositórios privados e o nome desses repositórios gravado para
  sempre no log público de transparência. Fontes: `docs/research/2026-11-09-confianca-do-registry-sem-custodia-de-chave.md` e
  `docs/research/2026-11-09-chaves-contra-runners-sem-acl.md`.

- **Decidido (Jarvis, 12/11): (h) `DEFAULT_PIN` fica como está, a trava é proposital.** **(h) Neural-link novo fica preso em `DEFAULT_PIN`.** `ensureNeuralLink()` pede a versão mínima `DEFAULT_PIN` da mesma major; uma major nova do
  motor exige subir a constante e publicar o kit. O adaptador só aceita o contrato que conhece, e a major nova é decisão do dono do neural-link;
  `tests/test-neural-link-alignment.mjs` trava a constante contra o manifest.
- **Decidido (Jarvis, 12/11): segue do dono.** **(k) `trust.json` guarda chave e `maxVersion` por motor, não por registry.** Um registry próprio com chave própria faz o público abortar, e
  o contrário. Ganho: quem opera um registry próprio convive com o público. Esforço: médio (migração do arquivo de confiança). Reuso:
  `updateEntry` e a chave de cache por `registryUrl` que já existe em `kit/resolve.mjs`. Recomendação: construir por registry e nome, com
  migração; é decisão do esquema de confiança, então fica atrás da pendência 3a178e.

- **Decisão do dono: (3) retentativa com backoff em falha transitória de rede.** Muda o uso: o `ensure` deixa de abortar na primeira queda. Esforço pequeno, reusa o padrão de `renameRetry`; custa bytes do runtime, que está a ~40 B do teto (36700). Recomendação: só quando alguém pedir. **Decidido (Jarvis, 13/11):** não construir agora, conforme a recomendação do próprio item; reabrir só se alguém pedir.
- **Decisão do dono: (4) espelho de registry e proxy.** Muda o uso: instalação por trás de proxy ou de espelho próprio; a assinatura é conferida em qualquer origem. Esforço médio. Recomendação: só quando alguém pedir. **Decidido (Jarvis, 13/11):** não construir agora, conforme a recomendação do próprio item; reabrir só se alguém pedir.
- **Decisão do dono: (5) callback de progresso de download (`onProgress`).** Muda o uso de quem embute a lib. Esforço pequeno; custa bytes do runtime (teto 36700). Recomendação: só quando alguém pedir. **Decidido (Jarvis, 13/11):** não construir agora, conforme a recomendação do próprio item; reabrir só se alguém pedir.
- **Decisão do dono: (7) adaptadores prontos para embed-house e vxk.** Não muda o uso do kit; mexe nos repositórios desses motores. Esforço pequeno. Recomendação: só quando alguém pedir. **Decidido (Jarvis, 13/11):** não construir agora, conforme a recomendação do próprio item; reabrir só se alguém pedir.
- **Decisão do dono: (8) canais estável e beta (`--channel`).** Muda o uso, o schema do manifest e a publicação. Esforço grande. Recomendação: não construir agora. **Decidido (Jarvis, 13/11):** não construir agora, conforme a recomendação do próprio item; reabrir só se alguém pedir.

- **Decisão do dono: (1) `engine-kit run <motor-cli>`.** Muda o uso: o usuário deixa de digitar o caminho do entrypoint, mas o kit passa a executar código do motor. Esforço pequeno, reusa `ensureCommand` e `entryPath`. Recomendação: depois de decidir a política de executar código do motor. Fonte: `docs/research/2026-11-12-lente-feature-irma-engine-kit-0.2.14.md`. **Decidido (Jarvis, 13/11):** não construir agora, conforme a recomendação do próprio item; reabrir só se alguém pedir.
- **Decisão do dono: (4) `engine-kit stop --all`.** Muda o uso; derrubar o client-harness pode deixar hooks sem resposta. Esforço pequeno, reusa `stopCommand`. Recomendação: só se pedirem. **Decidido (Jarvis, 13/11):** não construir agora, conforme a recomendação do próprio item; reabrir só se alguém pedir.
- **Decisão do dono: (5) `doctor --project`.** Muda o uso só se algum host ler o bloco `engines`. Esforço médio. Recomendação: só se pedirem. **Decidido (Jarvis, 13/11):** não construir agora, conforme a recomendação do próprio item; reabrir só se alguém pedir.

- **Decisão do dono: rollback na CLI (`ensure` e `doctor --fix`).** Hoje só o `ensureEngine` da lib volta para a versão anterior quando a nova não sobe. A CLI não sabe o que é "subir": exigiria executar o motor (`healthCheck`) a cada `ensure`, o mesmo limite do `run`; passar só `keepPrevious` deixaria a pasta anterior sem quem a use. Esforço médio. Recomendação: decidir junto com o `run`. **Decidido (Jarvis, 13/11):** não construir agora; reabrir só se alguém pedir.
- **Decisão do dono: `doctor --json` com as versões em campos estruturados.** Hoje a versão instalada e a do registry vêm só no texto do `detail`. Esforço pequeno, reusa `engineView`. **Decidido (Jarvis, 13/11):** não construir agora; reabrir só se alguém pedir.
- **Decisão do dono: `engine-kit info <motor>`.** Um verbo que junta descritor, versão instalada, pin, plataformas e release de um motor. Esforço pequeno, reusa `diagnoseEngines` e `listCommand`. **Decidido (Jarvis, 13/11):** não construir agora; reabrir só se alguém pedir.
- **Decisão do dono: `list` mostra o pin e os apps.** Hoje `list` só traz os motores e o instalado. Esforço pequeno, reusa `pinOf` e `manifest.apps`. **Decidido (Jarvis, 13/11):** não construir agora; reabrir só se alguém pedir.

## Decidido

- **Decidido (dono, 13/11): rotação de chave assinada pela chave anterior, rollback automático, diagnóstico como API, verificação da instalação, `list` e link da release nos cards; construídos na develop, cada um com teste que falha sem o código.**
  (a) Rotação: `update-manifest --rotate-from <chave privada antiga>` grava `install.rotation = { from, signature }`; a máquina aceita a chave nova só se a gravada (ou a fixada em `trustedKeys`) for a `from` e a assinatura conferir; qualquer outra troca segue ABORT (`tests/test-rotacao-de-chave.mjs`). Contexto: `docs/research/2026-11-09-pin-por-motor-acoplamento-e-custodia-de-chaves.md`.
  (b) Rollback automático: `ensureEngine` guarda a pasta anterior do swap, volta para ela se a versão nova não sobe e devolve `engine.rolledBack = { version, reason }` (`tests/test-rollback-automatico.mjs`); repete a cada `ensure` enquanto o registry oferecer a versão que falha. Cobre só o `ensureEngine` da lib: o `ensureCommand` (CLI `engine-kit ensure`) e o `doctor --fix` não têm `healthCheck`, então não voltam sozinhos (ver a entrada "rollback na CLI" em Aguardando decisão do dono).
  (c) Diagnóstico como API: `diagnoseEngines` e `engineView` em `engine-kit/kit/diagnose.mjs`, sem lançar e iguais ao `doctor --json` (`tests/test-diagnose-api.mjs`).
  (d) Verificação da instalação: o `provision` grava `.engine-kit-files.json` (sha256 por arquivo); `doctor --verify` marca ADULTERADO e `--fix` reinstala a mesma versão; o registro mora na pasta instalada, então não pega quem refaz pasta e registro juntos (`tests/test-verificacao-da-instalacao.mjs`).
  (e) `engine-kit list [--json]` e `ensure` que recusa cedo fora de `platforms` (`tests/test-list-e-plataforma.mjs`).
  (f) Cards da vitrine apontam para a release exata do motor, alinhados pelo `tools/publish-manifest.mjs` (`tests/test-site.mjs`, `tests/test-publish-manifest.mjs`).
  (g) Candidatos técnicos da lente, construídos (Jarvis, 13/11), cada um com teste que falha sem o código: `doctor --fix` limpa o cache de conferência `verify/` pela idade (mais velho que `LOCK_STALE_MS`; um `fetch` em curso fica intacto) (`tests/test-doctor-verify-cache.mjs`); o motor sem build para a plataforma é recusado cedo na lib (`available:false`) e aparece como SEM-BUILD no doctor, sem pendência (`tests/test-sem-build.mjs`); cada comando da vitrine tem botão de copiar, e sem `navigator.clipboard` ele mostra "não consegui copiar" (`tests/test-site-copiar.mjs`).
  Tetos recalibrados com entrada datada em `kit/budget.mjs`: runtime 33800 → 36700 (vitrine "< 37 KB"), ferramental 54600 → 59500. Sem bump de versão: fica para o dono.

- **Resolvido (Jarvis, 12/11): sete itens construídos na develop, cada um com teste que falha sem o código** (`tests/test-backlog-tecnico.mjs`). (1) (g2) `--json` em `ensure`, `fetch`, `pin` e `stop`: um objeto JSON na forma das linhas do `doctor --json` (`name`, `ok`, `state`, `detail`, `warns`, `pin`, mais os campos do verbo), também na falha, sem log de progresso em stdout; recusado com `--register`/`--unregister`; `unpin` não o aceita. (2) (o) `ensureEngine` desliga o daemon pelo `shutdownPath` do descritor antes do swap; `onBeforeReplace` troca o gancho e `false` desliga. (3) (p) `ensureEngine` aceita `allowDowngrade`: com `version`, instala a exata. (4) `ensure <motor> --version <x>` instala a versão exata, como o `pin`. (5) a lib exporta `pin` junto de `unpin`. (6) `verify-release` confere a versão dentro do `.tgz` contra a anunciada. (7) o manifest declara o `shutdownPath` do mcp-gateway (`/admin/shutdown`, token `shutdownToken` no cabeçalho `x-shutdown-token`): o gateway já o implementa desde a 0.17.7, nada muda no projeto mcp-gateway, e o prazo padrão do `shutdown` subiu de 5 s para 90 s porque o gateway drena até cerca de 60 s.
- **Decidido (Jarvis, 12/11): seis itens construídos na develop, cada um com teste que falha sem o código** (`tests/test-backlog-decidido.mjs`).
  (f) `stopEngine` pede o desligamento sem `relaunch=1` (`shutdown` aceita `semRelaunch`), então o client-harness fica parado depois do `stop`;
  a atualização segue com o `shutdownPath` declarado. (i) o `doctor` avisa chave do registry ≠ chave embarcada quando não há `trust.json`
  (registry público). (j) a lib exporta `unpin` (`setPin` passou para `kit/trust.mjs`) e `unregisterNeuralLink`. (m) `ensureEngine`, com o
  registry fora e sem cache, devolve o motor que já responde ao handshake, descrito pelo manifest embarcado, com a versão lida do disco
  e `engine.registryReason`. (n) `readTokenAsync` lê o token do gateway sem bloquear e com limite de 5 s; `ensureGateway` e
  `onBeforeReplace` o usam e `readToken` síncrono segue exportado. (r) em registry próprio sem `trustedKeys`, `engine.trust` vale `"tofu"` e
  `engine.trustHint` ensina a fixar a chave. O `fetch` confere a versão do artefato numa pasta estável
  (`LOCALAPPDATA/engine-kit/verify/<motor>-<versão>`, hash só como chave de reuso) em vez de pasta aleatória no tmpdir.
  Tetos: runtime 32000 → 33600 (vitrine "< 34 KB"), ferramental 51600 → 51900, adaptador 6200 → 7500, com entrada datada em `kit/budget.mjs`.
- **Decidido (Jarvis, 12/11): (q) `publish.yml` fica sem a suíte, não construído.** O check de release do orquestrador roda os testes antes
  da tag, e a suíte inteira não cabe no runner hospedado.

- **Resolvido (Jarvis, 2026-11-12): defeitos com resposta óbvia, cada um com teste que falha sem a correção** (`tests/test-defeitos.mjs`).
  (a) `doctor --fix` conta o motor em ERRO como falha (exit 1) e não imprime "conciliado"; (b) `fetch` confere a versão dentro do artefato
  `.tgz` e remove o arquivo de release antiga assinada; (c) `ensureEngine` respeita `ENGINE_KIT_NO_AUTO_UPDATE` e devolve
  `engine.updateAvailable`; (d) `fetch`, `pin` e `stop` avisam registry fora do ar (`staleCache`); (e) `ensureNeuralLink` devolve
  `registerError` quando o `install()` falha; (g) o CLI recusa flag que o verbo não aceita, argumento solto e `--json` com `--fix`; (l) o
  README diz que o CLI, mesmo com `--registry-url`, usa a chave do pacote, e que só a lib em registry próprio segue em TOFU. Teto do runtime
  31000 → 32000, do ferramental 49200 → 51600 e do adaptador 6100 → 6200, com entrada datada em `kit/budget.mjs`.
  Da segunda lente, também com teste: o `doctor --fix` fixa a chave do pacote (`firstContactKeys`); o `ensure` com atualização desligada
  e o `pin` sem versão avisam cache vencido (`staleCache`) e o `ensure` devolve o ponteiro; o gateway repassa `updateAvailable`;
  recusa de app diz que é app e aponta o `fetch`; o USAGE lista `--registry-url`, `--local` e `--version` onde valem. O `doctor --fix`
  com chave embarcada fica sem teste e2e: o `provision` baixa do GitHub antes de checar a chave, então só há prova com rede.
- **Resolvido (Jarvis, 2026-11-12): CI hospedado só com checagem estática.** `test.yml` e `pages.yml` roteiam `runs-on` pela variável de repositório
  `CI_RUNNER` (vazia ou `hosted`: `ubuntu-latest`; `local`: runner persistente); as checagens com rede (`test:pages-live`, `test:versions-live`) rodam só na checagem local antes do push.
  Teste: `tests/test-workflows-hospedados.mjs`; contingência em `docs/billing-fallback.md`. O repositório ainda não tem runner local
  registrado: isso é do self-forge.
- **Resolvido (Jarvis, 2026-11-12): achados técnicos da segunda lente.** Adaptador do mcp-gateway não sinaliza pid cuja porta não responde como o gateway; `shutdown` sem pid só age com runtime fresco; o lock do `provision` confere a major e espera até `LOCK_STALE_MS`; `checkTrust` aborta se outro processo gravou outra chave e sinaliza `saved:false`; `updateEntry` repete o `rename`; docs de `version` corrigidos. Testes em `tests/test-tecnico.mjs`.
- **Resolvido (Jarvis, 2026-11-12): nove achados técnicos da lente construídos, cada um com teste que falha sem a correção.** (1) o cache do
  descritor é por `registryUrl` (`kit/resolve.mjs`; registry próprio não envenena o público); (2) `findAlive` trata `healthCheck` que lança
  como motor não saudável; (3) `mkdir` do home em `provision` devolve `{ok:false}`; (4) `trust.json` passa a ser gravado por `updateEntry`
  (lock de arquivo, tmp + rename; lock órfão reclamado por idade) nos três caminhos que gravavam; (5) `shutdown` sem pid confirma a saída pela
  porta; (6) a mensagem do `stopEngine` para motor `kind=cli` diz que não há processo; (7) `LOCK_STALE_MS` exportado e usado pelo doctor, e a
  recusa de destino dentro do home vive no `fetchArtifact` (a lib também); (8) docs de `index.mjs` e `consumers/neural-link.mjs` descrevem a versão como alvo do descritor (instalada da mesma major e igual ou maior é reusada; só o pin é exato); (9) testes novos em `tests/test-tecnico.mjs` e `tests/test-stop.mjs`. Teto do runtime 28100 → 31000 com entrada datada em
  `kit/budget.mjs`. Os testes de `doctor --fix` com ERRO, `fetch` com versão divergente do artefato, `ensureNeuralLink` com `install()` falho e
  `NO_AUTO_UPDATE` na lib não foram escritos: cada um fixaria um comportamento que os candidatos (a), (b), (c) e (e) do dono ainda vão decidir.
- **Resolvido (Jarvis, 2026-11-12): nove candidatos do 0.2.13 e da lente construídos.** (1) `engine-kit ensure neural-link --unregister`
  (`kit/register.mjs`, falha alto enquanto o motor não expõe `uninstall()`); (2) o `doctor` mostra o estado dos hooks do neural-link
  (`_dispatcher-*.json` no config global); (3) `doctor --json` traz `stoppable`; (4) `--register` lista os eventos gravados;
  (5) o `stop` avisa que está esperando um motor ocupado; (6) `stopEngine(name)` na lib, com o teto do runtime recalibrado
  (27000 → 28100, entrada datada em `kit/budget.mjs`); (7) a chave do pacote é default também em `provision` e `fetchArtifact`
  (`verifyAuthenticity`); (8) no registry público, a lib recusa motor que não está no manifest embarcado quando o consumidor não passa
  `trustedKeys`, e falha alto se esse manifest estiver ilegível (registry próprio e manifest entregue na mão seguem em TOFU); (9)
  `fetch --dest` dentro do home do motor é recusado, porque o `doctor --fix` apagaria o artefato como sobra. Itens 7 e 8 mudam o
  comportamento de quem chamava a lib direto: entram na nota da próxima versão. Testes: `tests/test-neural-link-register.mjs`,
  `tests/test-doctor-cli.mjs`, `tests/test-stop.mjs`, `tests/test-ensure-engine-first-contact.mjs`, `tests/test-fetch.mjs`.

- **Resolvido (Jarvis, 2026-11-12): backlog técnico zerado.** (1) `ensureEngine` da lib fixa a chave do manifest embarcado quando o
  consumidor não passa `trustedKeys` (só no registry público; `registryUrl` próprio segue em TOFU): `firstContactKeys` agora mora em
  `kit/trust.mjs`; teste `tests/test-ensure-engine-first-contact.mjs`. (2) `doctor --fix` remove `stage-<versão>`, o artefato
  (`.tgz`/`.part`) e `<bin>.old-<pid>`, nunca com `provision.lock` fresco, e o diagnóstico avisa quando existem; teste
  `tests/test-doctor-leftovers.mjs`. (3) `registerNeuralLink` mora em `kit/register.mjs`; a CLI não importa mais de `consumers/`.

- **Decidido (dono, pendência 929130, 2026-11-12): três verbos do ciclo de vida.** N3 construído: `engine-kit ensure neural-link --register`
  roda o `install()` do motor, e o padrão segue sem registrar (só dica). R2 construído: `engine-kit stop <motor>` desliga pelo
  `shutdownPath` declarado; remover motor fica para depois, porque o manifest não declara quais pastas do home são estado do usuário.
  S1 não construído: o kit não sobe daemon, quem sobe é o consumidor (o kit não adivinha a saúde do motor). Testes:
  `tests/test-stop.mjs`, `tests/test-neural-link-register.mjs`.

- **Resolvido (Jarvis, 2026-11-12): achados técnicos da lente de feature irmã.** (1) `ensureGateway` devolve `tokenReason`
  quando `token` é null; (2) `npx engine-kit doctor [--fix] [--engine <motor>]` existe e lista os fixados; (3) o adaptador
  repassa `trustedKeys` (a chave embarcada, só no registry público) e `refresh`, e devolve `version` e `staleCache`;
  (4) cada card de motor traz o comando (`ensure` ou `fetch`) e a vitrine ensina `pin`, `--version` e
  `ENGINE_KIT_NO_AUTO_UPDATE`; (5) o `ensure` de motor self-managed aponta a release do instalador e o `fetch`.
  Testes: `tests/test-gateway-adapter-fields.mjs`, `tests/test-doctor-cli.mjs`, `tests/test-ensure-self-managed.mjs`,
  `tests/test-site.mjs`. Detalhe em `docs/research/2026-11-12-backlog-zerado-doctor-pelo-bin-e-campos-do-adaptador.md`.

- **Decidido (Jarvis, 2026-11-12): CLI mostrar o pacote de instruções do agente: não construído, ganho baixo.** O adaptador do
  gateway já devolve `instructions`; na CLI o texto não muda a decisão de quem instala.

- **Decidido (Jarvis, 2026-11-12): atualizar o mcp-gateway vivo pela CLI é do projeto mcp-gateway.** O gateway só derruba por
  `POST /admin/drain` com bearer e corpo; o `shutdown` do kit usa só o declarado no manifest. Repassado ao projeto dono.

- **Resolvido (Jarvis, 2026-11-09): `trust.json` ilegível falha fechado.** `readTrust` lança quando o arquivo existe e não
  se lê; `ensure`, `pin`, `unpin`, `ensureEngine` e o doctor recusam explicando e não regravam o arquivo
  (`tests/test-pin.mjs`, `tests/test-trust.mjs`).

- **Decidido (dono, 2026-11-09): distribuição só online; pin por motor aprovado.** O bundle offline foi descartado e
  saiu do design. O pin por motor foi construído na develop (`docs/ADR-registry-repositorio-e-pin-por-motor.md`). O
  manifest assinado espera a custódia da chave do registry
  (`docs/research/2026-11-09-pin-por-motor-acoplamento-e-custodia-de-chaves.md`).

- **Decidido (Jarvis, 2026-11-09): tratado fora deste backlog.** Os candidatos de feature da lente do engine-kit
  0.2.4 (pin por motor, monitor agendado de integridade, manifest assinado) vão ao dono como decisão, e
  os ponteiros `cli.json` fora da instalação (skill-engine, client-harness) vão aos projetos donos dos motores. Detalhe e
  evidência em `docs/research/2026-11-09-candidatos-ao-dono-e-ponteiros-cli-json.md`.

- **Decidido (Jarvis, 27/10): canal npm aprovado pelo dono, implementado e publicado.** `npx engine-kit ensure <motor>`
  instala sem clonar o repositório, verificando sha256, assinatura Ed25519 e versão do artefato, com a chave do primeiro
  contato embarcada no pacote. Publicado no npm (https://www.npmjs.com/package/engine-kit) por publicação confiável
  (GitHub Actions com OIDC, `.github/workflows/publish.yml`) com proveniência. O kit e os motores se atualizam por
  padrão; `ENGINE_KIT_NO_AUTO_UPDATE=1` desliga. Candidatos da lente de feature irmã, fora de escopo:
  `docs/research/2026-10-27-lente-feature-irma-ensure.md`.

- **Decidido (Jarvis, 28/10): `ensure vxk` atualiza com o daemon vivo.** O vxk 0.19.0 passou a ter um daemon único por
  máquina; o manifest agora declara o `runtime` dele (`run/daemon.json`, `POST /shutdown` com `x-shutdown-token`) e o
  `engine-kit ensure vxk` o desliga antes de trocar a instalação, em vez de falhar com "arquivos em uso" no Windows
  (`tests/test-ensure-daemon.mjs`). A vitrine e o README passaram a dizer que o vxk entrega HTML, vídeo MP4 e PDF.

- **Decidido (dono, via Jarvis, 2026-11-12): construídos na develop.** `engine-kit fetch <motor|app>` (baixa e confere sem
  instalar), `ensureGateway` devolvendo `instructions`, o passo "Instale pelo kit" da vitrine ensinando
  `npx engine-kit ensure <motor>` e os cartões dos apps lidos de `manifest.apps`. Detalhe em
  `docs/research/2026-11-12-fetch-instrucoes-e-cards-de-apps.md`.
