# Backlog

Melhorias encontradas durante outro trabalho e deixadas para depois.

## Técnico

Vazio.

## Negócio, espera o dono

Cada item muda o uso do produto. Os candidatos (f) a (n) trazem ganho, esforço (pequeno, médio ou grande, sem prazo), reuso e recomendação.

- **`uninstall()` no neural-link (projeto neural-link, `src/install.js`).** O `engine-kit ensure neural-link --unregister` já existe e
  chama o `uninstall()` do motor instalado, mas o neural-link só exporta `install()`: hoje o comando falha alto dizendo isso. Falta o
  motor exportar `uninstall({})` removendo os `_dispatcher-<Evento>.json` e devolvendo `{ removed: [...] }`. Não é decisão do dono:
  é trabalho do outro projeto, delegado pelo orquestrador.

- **Rotação de chave de motor sem passo manual nas máquinas.** Hoje, trocar a chave de um motor faz toda máquina que já o tinha abortar
  (`checkTrust` em `kit/trust.mjs`), e a rotação legítima exige apagar a entrada do `trust.json` à mão. **Decidido** (Jarvis, 09/11):
  fica tratada no esquema de confiança da pendência aberta 3a178e; até o dono escolher, nenhum passo manual por máquina é introduzido.
  Contexto: `docs/research/2026-11-09-pin-por-motor-acoplamento-e-custodia-de-chaves.md`.
- **Esquema de confiança do registry: assinatura sem chave e publicação do kit com aprovação.** Pendência aberta 3a178e: muda como o dono
  publica o kit (um clique de aprovação 2FA por release) e o que ele guarda. Recomendação: esquema D, com os motores assinados sem chave
  (keyless) no CI hospedado, nos três repositórios pesados (native-java, cerne, vox-engine), e o engine-kit publicado no npm só com a
  aprovação 2FA do dono. Custos: minutos pagos dos builds hospedados nos repositórios privados e o nome desses repositórios gravado para
  sempre no log público de transparência. Fontes: `docs/research/2026-11-09-confianca-do-registry-sem-custodia-de-chave.md` e
  `docs/research/2026-11-09-chaves-contra-runners-sem-acl.md`.

- **(f) `stop` do client-harness religado pelo runner.** O `shutdownPath` dele traz `relaunch=1`, e o runner pode subir o processo de novo
  logo depois do `engine-kit stop`. Ganho: o `stop` passa a significar "desligado". Esforço: pequeno no kit, mas muda o contrato do motor
  (o registry teria de declarar um desligamento sem relançamento). Reuso: `stopEngine` e `shutdownPath` do manifest. Recomendação: o
  projeto client-harness declarar um `shutdownPath` sem `relaunch`; o kit não precisa mudar.
- **(g2) `--json` nos demais verbos (`ensure`, `fetch`, `pin`, `stop`).** Hoje só o `doctor` fala JSON; agente e script leem texto.
  Ganho: automação sem raspar texto. Esforço: médio (um formato estável de retorno por verbo vira API pública). Reuso: os retornos
  `{ok, ...}` que `ensureCommand`, `fetchCommand`, `pinCommand` e `stopCommand` já devolvem; só falta imprimir. Recomendação: construir só
  quando houver um consumidor real; o formato, uma vez publicado, não muda de graça.
- **(h) Neural-link novo fica preso em `DEFAULT_PIN`.** `ensureNeuralLink()` pede a versão mínima `DEFAULT_PIN` da mesma major; uma major nova do
  motor exige subir a constante e publicar o kit. Ganho: o motor evolui sem release do kit. Esforço: pequeno. Reuso:
  `tests/test-neural-link-alignment.mjs` já trava a constante contra o manifest. Recomendação: manter; a trava é proposital, porque o adaptador
  só aceita o contrato que conhece, e a major nova é decisão do dono do neural-link.
- **(i) O `doctor` não prevê o ABORT de chave rotacionada em máquina sem `trust.json`.** Ele avisa quando a chave do registry difere da
  gravada, mas na máquina sem gravação a rotação só aparece no `ensure`. Ganho: aviso antes do ABORT. Esforço: pequeno. Reuso:
  `firstContactKeys` e o aviso que o doctor já tem. Recomendação: resolver junto da rotação de chave e do esquema de confiança (pendência
  3a178e), porque o aviso depende do que o dono escolher ali.
- **(j) A lib não exporta `unregisterNeuralLink` nem `unpin`.** Quem usa a lib e não o bin não consegue desfazer o registro nem soltar o
  pin. Ganho: simetria da API. Esforço: pequeno, mas cada export entra no teto do runtime e vira contrato público. Reuso: as duas funções
  já existem em `kit/register.mjs` e `kit/ensure.mjs`. Recomendação: exportar só quando um consumidor da lib pedir.
- **(k) `trust.json` guarda chave e `maxVersion` por motor, não por registry.** Um registry próprio com chave própria faz o público abortar, e
  o contrário. Ganho: quem opera um registry próprio convive com o público. Esforço: médio (migração do arquivo de confiança). Reuso:
  `updateEntry` e a chave de cache por `registryUrl` que já existe em `kit/resolve.mjs`. Recomendação: construir por registry e nome, com
  migração; é decisão do esquema de confiança, então fica atrás da pendência 3a178e.
- **(m) `ensureEngine` com `allowNetwork:false` ou registry próprio sem cache devolve `available:false` com o motor vivo.** O atalho "já
  vivo" vem depois do `resolve`. Ganho: o consumidor offline usa o motor que já roda. Esforço: médio (inverter a ordem muda quem decide a
  versão). Reuso: `findAlive` e o handshake do `lifecycle`. Recomendação: construir; tentar o handshake antes quando o descritor não vem,
  sem confiar em versão que ninguém conferiu.
- **(n) `readToken` do adaptador do mcp-gateway é síncrono e roda PowerShell por até 20 s na ativação da extensão.** Ganho: ativação sem
  travar o host. Esforço: médio, e a API exportada muda (`readToken` passaria a devolver Promise). Reuso: `ensureGateway` já é assíncrona e
  poderia chamar a versão nova, mantendo a antiga para quem a importa. Recomendação: construir a versão assíncrona ao lado da síncrona,
  sem remover esta; só o dono do adaptador decide quando aposentá-la.
- **(o) `ensureEngine` não passa `shutdown` por padrão.** Quem usa a lib e quer o motor parado ao atualizar tem de lembrar de passar
  `shutdown`; sem ele o motor velho segue vivo até a próxima subida. Ganho: atualização sem motor antigo vivo. Esforço: pequeno, mas
  muda o comportamento de quem já usa. Reuso: `stopEngine` e o `shutdownPath` do descritor. Recomendação: construir como padrão com
  opt-out, depois de decidir se o consumidor aceita o motor reiniciar sozinho.
- **(p) `ensureEngine` não aceita `allowDowngrade`.** O rebaixamento só existe no `pin` do CLI; a lib não tem como voltar a uma versão
  anterior. Ganho: rollback pela lib. Esforço: pequeno. Reuso: a regra de pin de `satisfiesPin`. Recomendação: construir só se um
  consumidor pedir, porque cada opção entra no teto do runtime e vira contrato público.
- **(q) `publish.yml` publica sem rodar a suíte.** A política de release hoje é o gate do orquestrador antes da tag, não o workflow
  (que fica hospedado por causa da proveniência). Ganho: segunda trava antes do npm. Esforço: pequeno. Reuso: `node kit/budget.mjs` já
  roda hospedado. Recomendação: política de release do dono; a suíte inteira não cabe no runner hospedado sem Windows.
- **(r) A lib em registry próprio não tem dica do que fazer para fixar a chave.** O retorno da lib em TOFU não diz que é TOFU nem aponta
  `trustedKeys`. Ganho: quem opera registry próprio sabe o risco no retorno. Esforço: pequeno. Reuso: `firstContactKeys` e o campo
  `trustedKeys`. Recomendação: junto do esquema de confiança (pendência 3a178e).

## Decidido

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
  `CI_RUNNER` (vazia ou `hosted`: `ubuntu-latest`; `local`: runner persistente); as checagens com rede ficam no job `live`, só no runner local.
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
