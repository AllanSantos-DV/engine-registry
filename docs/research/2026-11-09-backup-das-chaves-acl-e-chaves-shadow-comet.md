# Backup cifrado das chaves, ACL da pasta de chaves e as chaves "shadow"/"comet" (2026-11-09)

Continuação de `2026-11-09-pin-por-motor-acoplamento-e-custodia-de-chaves.md`, que registrou a falta de backup das chaves
privadas e a concessão de leitura a `CodexSandboxUsers` na pasta de chaves.

## Backup cifrado

- `tools/backup-keys.mjs` (fora do orçamento do kit): `backup` cifra a pasta de chaves (padrão `~/.engine-signing`) num
  arquivo `.ekb` e grava a mesma cópia em duas mídias; `check` decifra e compara com a pasta; `restore` grava as chaves
  numa pasta sem arquivos de mesmo nome.
- Cifra: scrypt (N=2^17, r=8, p=1) deriva a chave da frase-senha; AES-256-GCM cifra e autentica, com o cabeçalho
  (parâmetros, sal, IV) como dado autenticado. Frase-senha errada ou um byte adulterado falham sem decifrar nada.
- A frase-senha vem do terminal sem eco (com confirmação no backup) ou da entrada padrão (`--passphrase-stdin`); opção
  desconhecida é recusada, então ela não entra em argumento. Mínimo de 12 caracteres.
- Recusas antes de gravar: menos de duas mídias, mídia ausente, destino dentro da pasta de chaves, as duas mídias no
  mesmo disco (`--allow-same-device` existe para o teste, que usa pastas temporárias). Cada cópia é relida e decifrada
  antes do OK.
- `tests/test-backup-keys.mjs` usa só pasta de chaves temporária e HOME isolado; confere que nem a chave em claro nem a
  frase-senha aparecem no arquivo ou na saída.
- A chave do vox-engine mora fora de `~/.engine-signing` (keystore do próprio projeto); `--from <pasta>` cobre essa pasta
  num segundo backup, se o dono quiser.
- O caminho do terminal sem eco não tem teste automático (exige console interativo); o teste cobre o caminho da entrada
  padrão, que usa a mesma cifra.

## ACL de `~/.engine-signing`

- Antes: `CodexSandboxUsers:(OI)(CI)(RX)` explícito, mais SISTEMA, Administradores e o usuário dono herdados do perfil.
- Backup do ACL anterior com `icacls <pasta> /save <arquivo> /t`, em `%LOCALAPPDATA%\engine-registry\acl-backup\`.
  Desfazer: `icacls <pasta-pai> /restore <arquivo>`.
- Depois: herança desligada e uma ACE só, o usuário dono com controle total (`(OI)(CI)(F)`); as nove chaves herdam só
  essa ACE.
- Verificado: `kit/sign.mjs` assinou um arquivo de teste com cada uma das nove chaves e a assinatura conferiu com a
  `publicKey` do `manifest.json` em oito delas (a do whatsapp-bridge não tem entrada no formato lido pela conferência; a
  assinatura dela se auto-verificou no `sign.mjs`).
- Limite do Windows: um administrador ainda pode tomar posse da pasta; a ACL tira a leitura de contas e processos
  sandbox que não são o dono.

## Chaves "shadow" e "comet"

Não existem nesta máquina nem na conta do GitHub:

- nenhum arquivo de chave (`.key`, `.pem`, `.pub`, `.asc`, `.gpg`, `.p12`, `.pfx`, `id_*`, `*_private*`) com esses nomes
  ou rótulos em `~/.ssh`, `~/.gnupg`, no keystore do vox-engine, em `~/.engine-signing`, nos projetos e na raiz do perfil;
- nenhuma das chaves SSH da conta, nenhum repositório da conta e nenhum secret deste repositório tem esses nomes;
- sem chave de assinatura no git global e sem chaves GPG locais (a listagem das chaves GPG da conta pede um escopo que o
  `gh` desta máquina não tem);
- o que tem esses nomes não é chave: a pasta de log de transação `ShadowNoFileLockStore` de um Keycloak local, os
  arquivos de verificação "shadow" do modo-auto e um atalho de programa chamado Comet.
