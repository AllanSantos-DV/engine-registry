# Backlog

Melhorias encontradas durante outro trabalho e deixadas para depois.

## Técnico

Vazio.

## Negócio, espera o dono

Cada item muda o uso do produto. Recomendação entre parênteses de cada um.

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

- **Candidatos da lente desta rodada que mudam o uso (recomendações entre parênteses).** (a) `doctor --fix` sai com 0 com motor em ERRO e imprime "conciliados". (Recomendo corrigir: exit 1.) (b) `fetch` não confere a versão dentro do artefato como o `ensure`; um release antigo assinado passa por novo. (Recomendo conferir, é segurança.) (c) `ENGINE_KIT_NO_AUTO_UPDATE` não vale para `ensureEngine`, ao contrário do que o README diz. (Recomendo valer.) (d) `fetch`, `pin` e `stop` não avisam registry fora do ar. (e) `ensureNeuralLink` engole a falha do `install()`. (f) `stop` do client-harness (`shutdownPath` com `relaunch=1`) pode ser religado pelo runner. (g) `--json` só no `doctor`; flags que não se aplicam são ignoradas em silêncio. (h) neural-link novo fica preso em `DEFAULT_PIN`. (i) o `doctor` não prevê o ABORT de chave rotacionada em máquina sem `trust.json`. (j) a lib não exporta `unregisterNeuralLink` nem `unpin`.

- **Candidatos da segunda lente que mudam o uso (recomendações entre parênteses).** (k) `trust.json` guarda chave e `maxVersion` por motor, não por registry: um registry próprio com chave própria faz o público abortar e o contrário (por registry e nome, com migração; ou erro explícito no uso misto); (l) o CLI com `--registry-url` sempre força a chave embarcada, enquanto o README diz TOFU para registry próprio (alinhar o README ao espelho, que é o comportamento seguro); (m) `ensureEngine` com `allowNetwork:false` ou registry próprio sem cache devolve `available:false` mesmo com o motor vivo, porque o atalho "já vivo" vem depois do `resolve` (tentar o handshake antes quando o descritor não vem); (n) `readToken` do adaptador do mcp-gateway é síncrono e exportado, e roda PowerShell por até 20 s na ativação da extensão (versão assíncrona muda a API exportada).

## Decidido

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
