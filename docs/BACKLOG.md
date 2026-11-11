# Backlog

Melhorias encontradas durante outro trabalho e deixadas para depois.

- **Rotação de chave de motor sem passo manual nas máquinas.** Hoje, trocar a chave de um motor faz toda máquina
  que já o tinha abortar (`checkTrust` em `kit/trust.mjs` compara com a chave gravada no `trust.json`), e a rotação
  legítima exige apagar a entrada à mão. Proposta: aceitar a troca quando a chave nova vem do manifest embarcado num
  engine-kit publicado com proveniência, e regravar o `trust.json`. Mexe na raiz de confiança: decisão do dono antes.
  Contexto: `docs/research/2026-11-09-pin-por-motor-acoplamento-e-custodia-de-chaves.md`.
  **Decidido** (Jarvis, 09/11): a rotação fica tratada no esquema de confiança da pendência aberta 3a178e; até o dono
  escolher o esquema, nenhum passo manual por máquina é introduzido.

- **Esquema de confiança do registry: assinatura sem chave e publicação do kit com aprovação.** Decisão de negócio do
  dono, na pendência aberta 3a178e: muda como o dono publica o kit (um clique de aprovação 2FA por release) e o que ele
  guarda. Recomendação: esquema D, com os motores assinados sem chave (keyless) no CI, em runner hospedado pelo GitHub,
  nos três repositórios pesados (native-java, cerne, vox-engine), e o engine-kit publicado no npm só com a aprovação 2FA
  do dono. Custos que entram na decisão: minutos pagos dos builds hospedados nos repositórios privados e o nome desses
  repositórios gravado para sempre no log público de transparência. Fontes:
  `docs/research/2026-11-09-confianca-do-registry-sem-custodia-de-chave.md` e
  `docs/research/2026-11-09-chaves-contra-runners-sem-acl.md`.

- **Candidatos da lente do engine-kit 0.2.6 que mudam o uso (decisão do dono).** `engine-kit fetch <motor|app>`
  (baixa e confere sem instalar), `engine-kit stop <motor>` (desliga pelo `shutdownPath` declarado; o mcp-gateway
  precisaria do drain do adaptador) e `ensureGateway` devolvendo também as instruções para agente (adaptador no teto
  de tamanho). Ganho, esforço e peças em `docs/research/2026-11-11-lente-feature-irma-engine-kit-0.2.6.md`.

## Decidido

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
