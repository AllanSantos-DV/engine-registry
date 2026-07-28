<#
publish-base.ps1 - Publica UM motor no engine-registry, assinado, com prova do caminho real.

  Por que existe: o publish.ps1 do vox-engine ja resolvia, na marra, quatro armadilhas que
  nenhum README impede alguem de esquecer. Este script generaliza esses passos para QUALQUER
  motor, para que um motor novo nao repita a licao a partir do zero:

    1. o app Copilot injeta o token de uma conta de TRABALHO em todo processo filho, e o gh
       publica pela conta ERRADA (a release aparece no lugar errado, ou some);
    2. assinar so tem valor se a assinatura for CONFERIDA antes de sair do computador;
    3. "publiquei" nao e prova: asset faltando, .sig esquecido ou tag errada so aparecem
       quando um consumidor tenta instalar -- em producao;
    4. editar o manifest.json com regex corrompe o arquivo em silencio.

  Este script NAO builda o motor. Cada motor tem seu build (wheel Python, bundle esbuild, tgz
  multi-plataforma) -- parametrizar isso seria reescrever cada build dentro daqui. O motor
  builda e chama este script com o(s) artefato(s) prontos.

  PUBLICACAO DUPLA: o engine-registry (publico) e o CANONICO de consumo -- e o unico que o
  manifest aponta e o unico cuja falha aborta. O espelho no repo privado do motor (-SourceRepo)
  e historico/rollback: se falhar, AVISA alto mas nao invalida a publicacao. Dois canonicos
  seriam duas verdades, e a divergencia apareceria como "atualizei e voltou a versao velha".

  PONTE DE MIGRACAO (-MarketplaceMirror): enquanto existir consumidor com a URL ANTIGA gravada
  no codigo (SDK vendorizado, provision copiado), a release precisa continuar aparecendo la
  tambem -- senao a migracao quebra quem ainda nao foi repontado. Tambem e o rollback: para
  voltar atras, o consumidor so reaponta a URL, sem rebuild. Como o -SourceRepo, a falha aqui
  AVISA e segue: o canonico ja esta de pe. Desligue quando um grep nos consumidores pela URL
  antiga daquele motor voltar VAZIO.

Uso:
  ./publish-base.ps1 -Engine mcp-gateway -Version 0.2.0 -Asset dist/mcp-gateway.tgz
  ./publish-base.ps1 -Engine vox-engine -Version 0.23.0 -Asset a.tgz,b.tgz -SourceRepo AllanSantos-DV/vox-engine
  ./publish-base.ps1 -Engine embed-house -Version 1.0.5 -Asset x.tgz -MarketplaceMirror AllanSantos-DV/copilot-marketplace
  ./publish-base.ps1 -Engine mcp-gateway -Version 0.2.0 -Asset dist/x.tgz -DryRun
#>
param(
    [Parameter(Mandatory = $true)][string]$Engine,
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string[]]$Asset,
    [string]$Registry = "AllanSantos-DV/engine-registry",
    [string]$SourceRepo = "",
    [string]$MarketplaceMirror = "",
    [string]$RegistryPath = "",
    [string]$Notes = "",
    [switch]$SkipManifest,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$kit = $PSScriptRoot
if (-not $RegistryPath) { $RegistryPath = Split-Path -Parent $kit }
$manifest = Join-Path $RegistryPath "manifest.json"

function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "AVISO: $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "FALHOU: $m" -ForegroundColor Red; exit 1 }

if ($Version -notmatch '^\d+\.\d+\.\d+$') { Fail "versao '$Version' invalida (esperado x.y.z)" }
if ($Engine -notmatch '^[a-z0-9][a-z0-9-]*$') { Fail "motor '$Engine' invalido (minusculas, hifens)" }

# --- 1. A armadilha da conta de TRABALHO --------------------------------------------------
# O token injetado pelo app vence o keyring pessoal. Sem zerar, o gh autentica como a conta
# errada e a release vai parar em outro lugar (ou falha com 404 num repo que existe).
$env:GH_TOKEN = ''
$env:GITHUB_TOKEN = ''
$env:GIT_CONFIG_PARAMETERS = ''

Step "Conferindo identidade do gh"
$who = (gh api user --jq '.login' 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $who) { Fail "gh nao autenticado - rode 'gh auth login' com a conta dona dos repos" }
$owner = $Registry.Split('/')[0]
if ($who.Trim() -ne $owner) { Fail "gh autenticado como '$($who.Trim())' mas o registry e de '$owner' (token da conta errada)" }
Write-Host "    gh=$($who.Trim())  registry=$Registry"

Step "Conferindo os artefatos"
$assets = @()
foreach ($a in $Asset) {
    if (-not (Test-Path $a)) { Fail "artefato nao encontrado: $a" }
    $full = (Resolve-Path $a).Path
    if ((Get-Item $full).Length -eq 0) { Fail "artefato vazio: $full" }
    $assets += $full
    Write-Host "    $([IO.Path]::GetFileName($full))  ($((Get-Item $full).Length) bytes)"
}

$keyPath = Join-Path $env:USERPROFILE ".engine-signing\${Engine}_ed25519_private.key"
$envVar = "ENGINE_SIGNING_KEY_" + ($Engine -replace '-', '_').ToUpper()
if (Test-Path "env:$envVar") { $keyPath = (Get-Item "env:$envVar").Value }
if (-not (Test-Path $keyPath)) {
    Fail "chave privada ausente: $keyPath`n       gere com: node `"$kit\gen-key.mjs`" $Engine`n       ou aponte a existente com: `$env:$envVar = '<caminho>'"
}

# --- 2. Assinar e PROVAR a assinatura antes de publicar -----------------------------------
Step "Assinando (Ed25519 hash-then-sign; a chave privada nunca entra no CI)"
$upload = @()
foreach ($a in $assets) {
    node (Join-Path $kit "sign.mjs") $a --engine $Engine
    if ($LASTEXITCODE -ne 0) { Fail "assinatura de $a" }
    if (-not (Test-Path "$a.sig")) { Fail ".sig nao foi gerado para $a" }
    if (-not (Test-Path "$a.sha256")) { Fail ".sha256 nao foi gerado para $a" }
    $upload += @($a, "$a.sig", "$a.sha256")
}

$pubKey = node -e "import('file:///' + process.argv[1].replace(/\\/g,'/')).then(async s => { const fs = await import('node:fs'); console.log(s.publicKeyHexFromPrivateHex(fs.readFileSync(process.argv[2],'utf8').trim())); })" (Join-Path $kit "signature.mjs") $keyPath
if ($LASTEXITCODE -ne 0 -or -not $pubKey) { Fail "nao foi possivel derivar a chave publica de $keyPath" }
$pubKey = $pubKey.Trim()
Write-Host "    chave publica: $pubKey"

$tag = "$Engine-v$Version"
if ($DryRun) {
    Step "DRY-RUN: publicaria a tag '$tag' em $Registry com:"
    $upload | ForEach-Object { Write-Host "      $([IO.Path]::GetFileName($_))" }
    if ($SourceRepo) { Write-Host "      + espelho no repo privado $SourceRepo (nao-fatal)" }
    if ($MarketplaceMirror) { Write-Host "      + ponte no canal antigo $MarketplaceMirror (nao-fatal)" }
    Write-Host "    e atualizaria $manifest (publicKey=$pubKey, signatureRequired=true, repo=$Registry)"
    exit 0
}

# --- 3. Publicar no CANONICO (falha aqui aborta) ------------------------------------------
Step "Publicando a release no registry ($Registry, tag $tag)"
if (-not $Notes) {
    $Notes = "$Engine $Version. Artefato assinado com Ed25519 (ed25519-sha256-raw): o engine-kit e fail-closed e recusa artefato sem assinatura valida."
}
gh release view $tag --repo $Registry 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { Fail "a release '$tag' ja existe em $Registry - suba a versao ou apague a release antes (nao sobrescreva um artefato ja assinado)" }

gh release create $tag --repo $Registry --title "$Engine $Version" --notes $Notes @upload
if ($LASTEXITCODE -ne 0) { Fail "gh release create em $Registry" }

# --- 4. Espelho no repo privado: historico/rollback, NAO canonico --------------------------
if ($SourceRepo) {
    Step "Espelhando no repo do codigo ($SourceRepo) - historico, nao canonico"
    gh release create $tag --repo $SourceRepo --title "$Engine $Version" --notes "Espelho do release canonico: https://github.com/$Registry/releases/tag/$tag" @upload
    if ($LASTEXITCODE -ne 0) {
        Warn "o espelho em $SourceRepo falhou. A publicacao CANONICA esta de pe (consumidores nao sao afetados); refaca o espelho a mao se quiser o historico la."
    }
}

# --- 4b. Ponte no canal ANTIGO: para quem ainda tem a URL velha gravada no codigo ----------
if ($MarketplaceMirror) {
    Step "Publicando a ponte no canal antigo ($MarketplaceMirror) - consumidores nao repontados"
    $bridgeNotes = "PONTE DE MIGRACAO. O canonico deste motor agora e https://github.com/$Registry/releases/tag/$tag - esta copia existe so para os consumidores que ainda apontam para ca e sera removida quando nao restar nenhum."
    gh release create $tag --repo $MarketplaceMirror --title "$Engine $Version (ponte)" --notes $bridgeNotes @upload
    if ($LASTEXITCODE -ne 0) {
        Warn "a ponte em $MarketplaceMirror falhou. O canonico esta de pe, mas quem AINDA aponta para o canal antigo nao vera esta versao - publique a ponte a mao ou reponte esses consumidores."
    }
}

# --- 5. Manifest: parseado, nao editado com regex -----------------------------------------
if (-not $SkipManifest) {
    Step "Atualizando o manifest do registry"
    node (Join-Path $kit "update-manifest.mjs") $Engine --version $Version --public-key $pubKey --repo $Registry --manifest $manifest
    if ($LASTEXITCODE -ne 0) { Fail "update-manifest (a release esta publicada; corrija o manifest e commite)" }
}

# --- 6. A prova: baixar do release como um consumidor faria -------------------------------
Step "Provando o caminho REAL (baixa do release publicado e confere sha256 + assinatura)"
node (Join-Path $kit "verify-release.mjs") $Engine --manifest $manifest
if ($LASTEXITCODE -ne 0) { Fail "a release publicada NAO passa pelo caminho do consumidor - conserte antes de anunciar" }

Write-Host ""
Write-Host "OK: $Engine v$Version publicado e VERIFICADO em $Registry." -ForegroundColor Green
Write-Host "Falta: commitar e enviar o manifest.json ($manifest) para o registry publico."
