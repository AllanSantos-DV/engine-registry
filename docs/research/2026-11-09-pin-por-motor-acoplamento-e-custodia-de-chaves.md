# Pin por motor, acoplamento entre motores e custódia de chaves (2026-11-09)

Pedido do dono, via orquestrador:

- distribuição só online, com o bundle offline descartado;
- pin por motor;
- o registry descrito como repositório de motores independentes;
- uma explicação sobre a chave de assinatura, sem construir o manifest assinado.

Fontes externas acessadas em 2026-11-09.

## 1. Pin por motor: o que o mercado faz

| Gerenciador | Semântica | Fonte |
|---|---|---|
| Homebrew | `brew pin` impede que o `brew upgrade` atualize a fórmula, mesmo com o nome dado explicitamente; `brew unpin` solta | https://docs.brew.sh/Manpage |
| winget | `upgrade --all` pula apps fixados, salvo `--include-pinned` | https://learn.microsoft.com/en-us/windows/package-manager/winget/upgrade |
| apt | `apt-mark hold` marca o pacote como retido; o `apt-get` só passa por cima com `--ignore-hold` | https://manpages.debian.org/bookworm/apt/apt-mark.8.en.html, https://manpages.debian.org/bookworm/apt/apt-get.8.en.html |
| Scoop | `scoop hold` (a documentação oficial não detalha; relato de usuário diz que app retido não atualiza em nenhum cenário) | https://github.com/ScoopInstaller/Scoop/issues/4625 |

O engine-kit segue o desenho do Homebrew:

- **O pin é por motor.** Ele fica gravado no `trust.json` da máquina, ao lado do estado que já era por motor (chave do primeiro contato e maior versão vista).
- **O pin vence a atualização automática nos três caminhos.** Valem para `ensure`, `doctor --fix` e `ensureEngine`.
- **Pedido explícito diferente da versão fixada é recusado.** O `ensure --version` de outra versão não passa e mostra a saída: trocar o pin ou fazer `unpin`.
- **Consumidor que exige mais do que o pin recebe `available:false`.** A mensagem explica o `unpin`.

Implementação e fases: `docs/ADR-registry-repositorio-e-pin-por-motor.md`.

## 2. Acoplamento entre motores (conferido no código)

**Acoplamento duro: nenhum.** O `schema.json` não tem campo de dependência entre motores. Cada motor tem:

- release, tag e chave próprias;
- uma entrada própria no `trust.json`;
- um `home` próprio.

O `doctor` resolve e concilia cada motor isoladamente, e o pin agora também é por motor.

Acoplamentos brandos que existem:

| # | Onde | Efeito |
|---|---|---|
| a | O pacote npm `engine-kit` embarca o `manifest.json` inteiro, com a chave pública de todos os motores | Motor novo ou chave rotacionada exige publicar um kit novo (é a raiz de confiança do primeiro contato, de propósito) |
| b | Um único `manifest.json` para todos os motores | Publicações de motores diferentes disputam o mesmo arquivo (conflitos de merge no histórico) |
| c | `consumers/neural-link.mjs` tem `DEFAULT_PIN` atado à versão do manifest (`tests/test-neural-link-alignment.mjs`) | Publicar o neural-link exige mexer no adaptador |
| d | `tests/test-readme-versions.mjs` amarra a tabela do README ao manifest | Documentação, não execução |
| e | Uma versão única do kit para todos os motores | O kit é a ferramenta da prateleira, não um motor; aceitável |
| f | A narração do `vxk` usa o `vox-engine` em execução | Dependência no nível dos motores, que o registry não codifica nem resolve |

Nenhum desses itens faz um motor instalar, atualizar ou travar outro. A recomendação é não criar campo de dependência: o registry continua como prateleira.

## 3. Custódia de chaves

### O que existe hoje (conferido no repositório e na máquina de publicação)

| Chave | Para quê | Onde mora | Quem usa |
|---|---|---|---|
| Uma chave privada Ed25519 **por motor** (9 em `~/.engine-signing`; a do vox-engine fica no keystore do próprio projeto) | Assinar o `.tgz` de cada release do motor | Só na máquina de publicação; nunca entra em CI (`kit/keystore.mjs`, `kit/publish-base.ps1`) | O script de publicação, rodado pelos agentes do orquestrador |
| A chave pública correspondente | Conferir a assinatura antes de instalar | `manifest.json` (`install.publicKey`), embarcada no pacote npm e gravada no `trust.json` de cada máquina | O engine-kit |
| `PAGES_DEPLOY_KEY` (secret do repositório) + deploy key "pages-deploy" com escrita | Publicar `site/` na branch `gh-pages` | GitHub encrypted secrets | `.github/workflows/pages.yml` |
| Nenhuma (OIDC) | Publicar o `engine-kit` no npm | Não há segredo guardado: publicação confiável por OIDC, com proveniência | `.github/workflows/publish.yml` |
| **Chave do registry** | Assinaria o `manifest.json` | **Não existe** (o manifest não é assinado) | — |

Chaves "shadow" e "comet" não aparecem neste repositório, nos workflows nem nos secrets dele. Se existirem, pertencem a outro projeto, e o orquestrador confere lá.

Hoje não existe backup conhecido das chaves privadas dos motores.

### Boa prática (fontes primárias)

- **Chave raiz offline e chave de uso online.** O TUF manda: "The root role's private keys MUST be kept very secure and thus should be kept offline". A rotação é feita por um novo `root.json`, assinado pelas chaves antiga e nova. Fonte: https://github.com/theupdateframework/specification/blob/master/tuf-spec.md
- **Secret do GitHub não é cofre contra quem tem escrita no repositório.** Citação: "Any user with write access to your repository has read access to all secrets configured in your repository". Também: "A workflow job cannot access environment secrets until approval is granted by a reviewer". Fonte: https://docs.github.com/en/actions/reference/security/secure-use
- **Secret do GitHub também não serve de backup.** O valor só chega a um workflow que o declara: "GitHub Actions can only read a secret if you explicitly include the secret in a workflow". Fonte: https://docs.github.com/en/actions/concepts/security/secrets
- **OIDC elimina credenciais de longa duração.** Fontes: https://docs.github.com/en/actions/concepts/security/openid-connect e https://docs.npmjs.com/trusted-publishers/. É o que o publish do npm já faz.
- **Keyless (Sigstore).** Assina com identidade OIDC e uma chave efêmera destruída logo depois; a prova fica no log público Rekor. Fonte: https://docs.sigstore.dev/cosign/signing/overview/. Não sobra chave para perder ou vazar, mas a verificação exige a raiz de confiança do Sigstore no cliente. O runtime tem orçamento de 27000 B.
- **Backup da chave privada.** O minisign recomenda: "create a backup and do not commit or share your generated private key file". Fonte: https://github.com/jedisct1/minisign
- **Revogação e cripto-período.** A revogação encerra o uso de uma chave antes do fim do cripto-período ou quando ela é comprometida (NIST SP 800-57 Parte 1 Rev. 5, §8.3.5). Fonte: https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-57pt1r5.pdf

### Impacto

| Evento | Chave de motor (existe) | Chave do registry (futura) |
|---|---|---|
| **Perda** (disco morre, sem backup) | Não se publica mais versão daquele motor com a mesma chave. A saída é chave nova e kit novo, e hoje cada máquina **aborta** até alguém apagar a entrada do motor no `trust.json` (ver lacuna abaixo) | Não se assina mais o manifest. A saída é um kit novo com a nova chave pública, que chega por autoatualização às máquinas que não a desligaram |
| **Vazamento** | Com o vazamento **e** controle da release, um atacante assina um binário malicioso aceito em máquinas novas e existentes. Resposta: rotacionar | Sozinha, não instala binário malicioso: cada artefato continua exigindo a assinatura da chave do motor. Permite congelar atualizações ou anunciar versões velhas, e o anti-rollback local barra estas |

### Rotação, hoje

1. Gerar o par novo (`kit/gen-key.mjs`).
2. Publicar a release do motor assinada com a chave nova e trocar o `install.publicKey` no manifest.
3. Publicar um `engine-kit` novo, que embarca a chave nova.
4. **Lacuna:** cada máquina que já tinha o motor aborta ("a chave pública MUDOU desde a primeira instalação"), porque o `trust.json` guarda a chave antiga. A rotação legítima exige apagar a entrada à mão.

### O que automatizar para o dono nunca tocar na chave

1. **Backup cifrado das chaves privadas** em dois meios offline. O dono guarda uma única frase-senha no gerenciador de senhas, uma vez só; não existe backup que dispense algum segredo guardado fora da máquina.
2. **Rotação sem passo manual nas máquinas.** Quando a chave nova chega pelo manifest embarcado num kit publicado com proveniência, o kit aceita a troca e regrava o `trust.json`. Hoje ele aborta. Registrado em `docs/BACKLOG.md`.
3. **Conferência periódica das permissões da pasta de chaves.** Só o usuário dono deveria ler `~/.engine-signing`.
4. **Chave do registry, quando o manifest assinado for decidido.** Raiz offline (com o mesmo backup do item 1) e chave de uso num GitHub environment restrito à `main`, assinando o manifest no workflow. A troca da chave de uso é assinada pela raiz, no padrão do TUF.

## Board

A explicação narrada para o dono está em `visual-explanations/registry-custodia-de-chaves.html`, fora do repositório.
