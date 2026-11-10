# Chaves de assinatura contra os runners self-hosted, sem depender de ACL (2026-11-09)

Pedido do orquestrador, a partir do endurecimento dos runners no self-forge. Uma ACL de arquivo não protege
`~/.engine-signing` de um processo elevado. ACEs condicionais (Member_of HI/BA) foram testadas, e o token elevado da tarefa
`self-forge-runners` abriu as chaves mesmo assim. Três repositórios (native-java, cerne, vox-engine) seguem em runners
self-hosted persistentes nesta máquina, então um job deles alcança as chaves. A pergunta é qual mitigação sem ACL fecha isso.

Só pesquisa e leitura. Nenhuma chave, runner ou conta foi alterada. Fontes externas acessadas em 2026-11-09.

## A ameaça, com a evidência do self-forge

Fonte: `self-forge/docs/research/runners-alcancam-chaves-2026-11-09.md` e `self-forge/docs/research/plano-conta-dedicada-runners.md`,
lidos sem alteração.

- **Elevado:** o runner Windows persistente roda pela tarefa `self-forge-runners`, como o usuário dono da pasta de chaves,
  com `RunLevel=Highest` (elevado) e sem sandbox.
- **Persistência:** o job escreve em Startup e em tarefas agendadas, então o código dele sobrevive ao job e espera o
  próximo evento.
- **WSL:** o runner WSL persistente lê `/mnt/c/.../.engine-signing` (as 7 chaves listadas do WSL).
- **Quem dispara:** quem empurra um workflow escolhe o `runs-on`. Uma conta pessoal não tem runner groups.

A ameaça que importa não é "um job lê um arquivo uma vez". É "**código de administrador, persistente, na mesma máquina
e na mesma sessão de usuário de quem assina**". O GitHub descreve exatamente esse risco: self-hosted runners "can be
persistently compromised by untrusted code in a workflow"
(https://docs.github.com/en/actions/reference/security/secure-use, acessado em 2026-11-09).

Dois direitos de administrador derrubam qualquer proteção local baseada em dono ou permissão:

- **Take ownership:** quem tem o direito "can take control of any object, regardless of the permissions on that object".
  Por padrão ele é do grupo Administrators
  (https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/take-ownership-of-files-or-other-objects,
  acessado em 2026-11-09).
- **Debug programs:** permite "attach to or open any process, even a process they do not own" e "capture sensitive device
  information from system memory". Por padrão também é do grupo Administrators
  (https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/debug-programs,
  acessado em 2026-11-09).

## As três opções contra essa ameaça

| | (a) Cifrar as chaves em repouso com segredo do dono | (b) Assinar de uma conta dedicada não elevada | (c) Assinatura keyless |
|---|---|---|---|
| Job que só lê o disco | **Para.** Lê só o arquivo cifrado | **Não para.** O admin toma posse do arquivo da outra conta | **Nada a ler.** Não existe chave de longa duração |
| Job persistente que espera a próxima assinatura | **Não para.** Com Debug programs lê a chave decifrada da memória do processo que assina, ou captura a frase-senha | **Não para.** Abre o processo da outra conta pelo mesmo direito, ou troca a senha dela | **Para no roubo de chave**, porque não há chave para esperar. Ver o residual abaixo |
| Job pede um token OIDC e assina como se fosse a release | não se aplica | não se aplica | **Recusado na verificação**, se o kit fixar a identidade (ver abaixo) |
| Artefato adulterado antes de assinar, num build em runner persistente | **Não para** | **Não para** | **Não para**, se o build da release roda no runner persistente |
| Release automática | Não. Cada release pede a frase-senha ao dono, e um agente de chaves em memória volta à linha 2 | Não. Exige sessão interativa na outra conta | Sim |
| Chave para guardar, perder ou rotacionar | A mesma de hoje, mais a frase-senha | A mesma de hoje | Nenhuma |
| Depende da decisão 3a178e | Não | Não | Sim. Os esquemas B, D e D estrito usam keyless para os motores |

### (a) Cifrar em repouso

- **Reuso:** o formato já existe no projeto. `tools/backup-keys.mjs` cifra com scrypt e AES-256-GCM, e lê a frase-senha
  do terminal sem eco, nunca de argumento ou variável.
- **Dois assinadores mudariam:** `kit/sign.mjs` (Node) e o `tools/sign_release.py` do vox-engine. A chave do vox vive
  fora de `~/.engine-signing`, em `~/.action/signing/vox_engine_ed25519_private.key` (constante `PRIVATE_PATH` do
  `sign_release.py`; o `kit/keystore.mjs` a alcança pelo override `ENGINE_SIGNING_KEY_VOX_ENGINE`). Está no mesmo
  perfil, portanto ao mesmo alcance, e também precisaria ser cifrada.
- **DPAPI não serve como atalho:** decifra para qualquer processo com "the same logon credential as the user who
  encrypted the data", e o job do runner é esse mesmo usuário
  (https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata, acessado em 2026-11-09).
- **Contra a ameaça real, só sobe a barra:** o job que copia o disco e vai embora leva só o arquivo cifrado. O job
  persistente e elevado espera a próxima release e pega a chave em claro na memória do assinador. O self-forge
  confirma que o job pode deixar código em Startup e em tarefas.

### (b) Conta dedicada de assinatura

- **Não fecha nada enquanto os runners forem administradores.** O achado do orquestrador (a ACL não segurou o token
  elevado) e os dois direitos citados acima mostram que um administrador alcança arquivos e processos de qualquer conta
  local.
- **Quando os runners deixarem de ser admin, ela vira redundante.** O plano do self-forge (`svc-runners`, sem admin, com
  Deny no perfil) já põe as chaves fora de alcance na conta atual. A conta de assinatura separada passa a ser uma
  segunda camada que exige sessão interativa a cada release.
- **Resumo:** quem fecha é o rebaixamento dos runners, não a conta de assinatura.

### (c) Keyless

**Nada para roubar.** O certificado do Fulcio dura minutos e a chave efêmera vive só no job da release. O job
persistente não tem o que esperar.

**Job forjando a identidade da release:** um job num desses três repositórios pode pedir um token OIDC e conseguir um
certificado válido. O certificado, porém, carrega a origem, e o kit recusa o que não for exatamente o workflow da
release num runner hospedado:

| OID | Campo | O que diz | O kit fixa |
|---|---|---|---|
| `1.3.6.1.4.1.57264.1.9` | Build Signer URI | as instruções de build "responsible for signing" | o caminho do workflow de release na tag |
| `1.3.6.1.4.1.57264.1.11` | Runner Environment | "whether the build took place in platform-hosted cloud infrastructure or customer/self-hosted infrastructure", com os valores `[platform]-hosted` e `self-hosted` | `github-hosted` |
| `1.3.6.1.4.1.57264.1.12` | Source Repository URI | o repositório de origem | o repositório do motor |

- Fonte dos OIDs: https://raw.githubusercontent.com/sigstore/fulcio/main/docs/oid-info.md, acessado em 2026-11-09.
- O valor `github-hosted` aparece no claim `runner_environment` do token de exemplo do GitHub
  (https://docs.github.com/en/actions/concepts/security/openid-connect, acessado em 2026-11-09).
- Resultado: o certificado de um job self-hosted sai com `self-hosted` e com outro workflow, e o kit o recusa.

**Residual de build, que vale igual para (a) e (b):** se o artefato da release é construído no runner persistente
comprometido, ele pode ser adulterado antes de qualquer assinatura. Isso fura a cifra de (a), a conta de (b) e o
keyless de (c). O SLSA Build L3 pede justamente "prevent runs from influencing one another" e "prevent secret material
used to sign the provenance from being accessible to the user-defined build steps" (https://slsa.dev/spec/v1.0/levels,
acessado em 2026-11-09). Por isso, em (c), **o job que constrói e assina a release** dos três repositórios roda em
runner hospedado pelo GitHub, que é efêmero: "there is no way to persistently compromise this environment"
(https://docs.github.com/en/actions/reference/security/secure-use, acessado em 2026-11-09). O CI do dia a dia pode seguir
no runner local.

**Custo de (c) que o dono precisa saber:**

- **Minutos pagos:** os três repositórios são privados, e o runner hospedado em repositório privado consome a cota
  incluída. No GitHub Free são US$ 12 por mês, e o minuto Windows 2-core custa US$ 0,010 contra US$ 0,006 no Linux
  (https://docs.github.com/en/billing/concepts/product-billing/github-actions, acessado em 2026-11-09). Só a release usa
  esses minutos, não o CI do dia a dia.
- **Nome do repositório público:** o certificado traz o Source Repository URI, e o log público do Sigstore é de entradas
  que "are never mutated or removed" (https://docs.sigstore.dev/logging/overview/, acessado em 2026-11-09). Assinar pelo
  Sigstore público deixa o nome e o caminho do workflow dos repositórios privados permanentemente públicos. As releases
  já são públicas no engine-registry, mas os nomes dos repositórios de código passam a ser também.

## Recomendação

**(c), keyless**, com o job de build e assinatura da release em runner hospedado pelo GitHub e a identidade fixada no
kit (Build Signer URI do workflow de release na tag, Runner Environment `github-hosted` e Source Repository URI). É a
única das três que tira o segredo da máquina. As outras duas guardam a mesma chave no alcance de um administrador
persistente.

**Quando aplicar** (amarrado à pendência 3a178e):

| Resposta do dono | O que se aplica |
|---|---|
| Esquema D, D estrito ou B | (c) entra junto com o esquema escolhido, motor a motor: native-java, cerne e vox-engine primeiro, porque são os que rodam em runner persistente |
| Manter como está | (a) como paliativo, reusando o formato do `backup-keys`, com o aviso de que não para um job persistente. O fechamento real fica com o plano `svc-runners` do self-forge |
| Qualquer resposta | (b) não entra, porque é dominada: sem rebaixar os runners não fecha, e com eles rebaixados não acrescenta |

**Independente da 3a178e:** o rebaixamento dos runners (conta `svc-runners`, automount do WSL) é do self-forge e reduz
todo o resto do perfil (`~/.ssh`, credenciais do `gh`), que nenhuma das três opções protege.
