# Backlog

Melhorias encontradas durante outro trabalho e deixadas para depois.

## Técnico

Vazio.

## Negócio, espera o dono

Cada item muda o uso do produto. Recomendação entre parênteses de cada um.

- **Ciclo de vida do neural-link.** `ensure neural-link --unregister`: desfaz o `--register`; depende de o motor expor a desinstalação
  dos hooks. (Recomendo esperar o motor expor `uninstall()`; sem ele o kit teria de adivinhar quais entradas do config global são do motor.)
- **Estado dos hooks no `doctor`.** Uma linha dizendo se os hooks do neural-link estão registrados. (Recomendo construir só depois do
  `--unregister`: sem o par, a linha informa um estado que o usuário não consegue desfazer pelo kit.)
- **Campo `stoppable` no `doctor --json`.** Diz a agentes e hooks se `engine-kit stop` se aplica ao motor (o manifest declara `shutdownPath`).
  (Recomendo construir quando um agente de fato precisar decidir isso; hoje o `stop` já recusa com o motivo.)
- **`--register` listando os arquivos gravados.** `reg.written` já tem os caminhos; a CLI hoje só diz que registrou. (Recomendo construir:
  é a única forma de o usuário saber o que mudou no config global dele, e custa poucas linhas.)
- **Aviso do `stop` enquanto espera um motor ocupado.** Hoje a CLI fica em silêncio até 120 s. (Recomendo construir: uma linha de
  progresso evita que o usuário ache que travou.)
- **`stopEngine(name)` na lib.** Não cabe no teto do runtime (27000 B) sem cortar outra coisa; o teto nunca foi recalibrado. (Recomendo
  manter o teto e a lib sem `stop`: quem precisa desligar usa a CLI.)
- **Chave do pacote como default também em `provision` e `fetchArtifact` da lib.** Só `ensureEngine` ganhou o default; quem chama
  essas duas direto segue em TOFU (a CLI e o `fetch` já passam a chave). Muda o comportamento de quem já as usa. (Recomendo construir: é a
  mesma garantia, e uma rotação já aborta no `ensureEngine`; avisar na nota de versão.)
- **Lib recusar quando não há chave do pacote.** Motor fora do manifest embarcado, ou manifest ilegível, cai em TOFU calado no
  `ensureEngine`; a CLI e o `fetch` recusam esse caso. Recusar na lib quebra quem instala motores de registry próprio ou fora do pacote.
  (Recomendo manter o TOFU para motor fora do pacote, que é o contrato declarado, e só falhar alto quando o manifest embarcado existir e
  estiver ilegível.)
- **`fetch --dest` dentro do home do motor e `doctor --fix`.** Um `vxk.tgz` baixado de propósito no home do motor é igual a uma sobra do
  `provision` e o `--fix` o apaga. (Recomendo recusar `--dest` dentro do home de um motor do manifest: um erro claro no `fetch` custa
  menos do que distinguir os dois arquivos.)
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

## Decidido

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
