# Contrato de um motor no `engine-registry`

O que o repositório de **cada motor** precisa fazer para entrar aqui — e ser instalado com
integridade e autenticidade pelo `engine-kit`. Este documento é o insumo das sessões de
alinhamento: uma sessão por motor, seguindo este checklist.

> **Regra da casa:** o `engine-registry` (público) é o **canônico de consumo** — é o único que o
> `manifest.json` aponta e o único cuja falha de publicação aborta o release. O repositório
> privado do motor guarda **fonte, CI e histórico**, e pode receber um espelho da release. Dois
> canônicos seriam duas verdades, e a divergência apareceria para o usuário como *"atualizei e
> voltou a versão velha"*.

---

## 1. Uma vez por motor: a chave

```sh
node kit/gen-key.mjs <motor>
```

- grava a privada em `~/.engine-signing/<motor>_ed25519_private.key` (**nunca** versionar, **nunca**
  subir para CI);
- imprime a **pública** para colar no `manifest.json`, em `install.publicKey`;
- recusa sobrescrever uma chave existente: trocá-la invalidaria todas as releases já assinadas
  daquele motor nos consumidores que já a pinaram.

**Uma chave por motor.** Um vazamento obriga a republicar aquele motor, não a casa inteira.

## 2. O artefato

O motor builda o próprio artefato — o `publish-base.ps1` **não** builda nada. Um wheel Python, um
bundle esbuild e um `.tgz` multi-plataforma não têm nada em comum: "parametrizar" o build seria
reescrever cada build dentro do script.

Requisitos do artefato:

- **self-contained**: sobe numa máquina limpa, sem depender do consumidor (traz o próprio
  `node_modules` trimado, ou o runtime que precisar);
- o conteúdo vai na **raiz** do `.tgz` (o kit renomeia o staging inteiro para `<home>/<extractTo>`);
- traz um `package.json` com o **mesmo `version`** que vai para o `manifest.json`.

> **Armadilha real:** o `provision` compara a versão do `package.json` **de dentro** do artefato
> com o pin do registry. Se o manifest disser `0.1.1` e o artefato disser `0.1.0`, o pin nunca é
> satisfeito e a máquina **reinstala o motor em toda chamada**. Bump de versão exige rebuild.

## 3. Publicar

```sh
pwsh kit/publish-base.ps1 -Engine <motor> -Version <x.y.z> -Asset <artefato.tgz> -DryRun
pwsh kit/publish-base.ps1 -Engine <motor> -Version <x.y.z> -Asset <artefato.tgz> `
     -SourceRepo AllanSantos-DV/<repo-privado>
```

O script faz, em ordem e com *fail-loud* em cada passo:

1. **zera `GH_TOKEN`/`GITHUB_TOKEN`/`GIT_CONFIG_PARAMETERS`** e confere `gh api user` contra o dono
   do registry — o app Copilot injeta o token de uma conta de trabalho em todo processo filho, e
   sem isso o `gh` publica pela conta errada;
2. assina cada artefato e **prova a assinatura na hora** (valida o legítimo, recusa o adulterado);
3. cria a release no registry (recusa se a tag já existir — artefato assinado não se sobrescreve);
4. espelha no repo privado, se `-SourceRepo` (falha aqui **avisa**, não aborta: não é o canônico);
5. atualiza o `manifest.json` **parseado** (nunca regex em JSON);
6. **prova o caminho real**: baixa a release publicada e valida `sha256` + assinatura como um
   consumidor faria. *"Publiquei"* não é prova — asset faltando, `.sig` esquecido e tag errada só
   aparecem quando alguém tenta instalar, em produção.

Depois: commitar e enviar o `manifest.json`. **Consumidores só enxergam a mudança após o push** —
até lá o registry publicado continua descrevendo a versão anterior.

## 4. Checklist por motor

```
[ ] chave gerada em ~/.engine-signing/<motor>_ed25519_private.key
[ ] entrada do motor existe no manifest.json (kind, home, install.entry, platforms)
[ ] build produz artefato self-contained, com package.json na versão certa
[ ] publish-base.ps1 rodado em -DryRun sem erro
[ ] release publicada no engine-registry com .tgz + .sig + .sha256
[ ] manifest.json com publicKey, signatureAlgorithm, signatureRequired:true, repo=engine-registry
[ ] node kit/verify-release.mjs <motor>  → verde
[ ] node e2e-install.mjs --local          → instala e sobe num HOME isolado
[ ] consumidores apontados para o engine-registry (o repo antigo deixou de ser consultado)
[ ] grep nos repos dos consumidores pela URL antiga retorna ZERO   ← critério de remoção da ponte
[ ] só então: release antiga marcada como deprecated / removida
```

## 5. Estado da migração

| Motor | `kind` | Fonte | Release canônica | Assinado | Pendências |
|---|---|---|---|---|---|
| `mcp-gateway` | daemon | `mcp-bridge` (branch `feat/mcp-gateway`) | `engine-registry` | **sim** | script de build/publish no repo do motor |
| `vox-engine` | daemon (`pipe`) | `vox-engine` (privado) | `copilot-marketplace` ❌ | sim, **por conta própria** | migrar release; `RELEASES_API` está hard-coded em 3 arquivos; mover o `vox-sdk-flats.zip` junto |
| `embed-house` | daemon (http) | `embed-house` (privado, não clonado) | `copilot-marketplace` ❌ | não | clonar, gerar chave, build multi-plataforma, publicar |
| `neural-link` | **cli** | `neural-link` (privado) | `neural-link-runtime` (público) | não | virar asset do registry; hoje há 3 cópias na máquina |

### O que ainda prende o `vox-engine` ao `copilot-marketplace`

A URL da vitrine está **hard-coded** em três lugares, e o SDK é **vendorizado** dentro dos
consumidores — quem já copiou a versão antiga continua procurando release no repo velho:

- `src/vox_engine/core/updater.py` → `RELEASES_API`
- `sdk/python/vox_lifecycle.py` → `RELEASES_API`
- `sdk/node/vox-sdk.mjs` → `RELEASES_API`

Duas boas notícias, ambas **medidas**, não supostas:

1. o `latest_release()` do vox **filtra por prefixo de tag** (`vox-engine-v`), então hospedar vários
   motores no mesmo repositório de releases é seguro — nenhum motor instala o outro;
2. o contrato de assinatura do vox (assinado em **Python**) foi verificado pelo `engine-kit` em
   **Node** contra a release real `vox-engine-v0.22.8`: **valida o legítimo e recusa o adulterado**.
   A migração **não exige reassinar** nada. Esse caso vive em `test-signature.mjs --network`.

O `vox-sdk-flats.zip` (canônico público do gate anti-drift) **precisa ser publicado junto** com a
release, no mesmo lugar que o consumidor consulta: sem ele, o `publish` dos consumidores quebra.

### Sobre remover as releases do `copilot-marketplace`

**Não apague antes do critério bater.** Existem ~45 releases `vox-engine-v*` e 5 `embed-house-v*` lá,
e consumidores com SDK vendorizado antigo apontam para elas. O critério de remoção é binário:

> um `grep` nos repositórios dos consumidores pela URL antiga daquele motor retorna **zero**.

Enquanto não bater, mantenha a última release como ponte, com aviso de depreciação no corpo.
