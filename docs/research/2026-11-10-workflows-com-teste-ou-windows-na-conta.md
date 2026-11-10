# Workflows hospedados com suíte de testes ou runner Windows/macOS na conta (2026-11-10)

Regra do dono: o GitHub Actions hospedado não roda suíte de testes nem runner Windows ou macOS em projeto nenhum; a checagem local antes
do push já roda testes e checagens, e a cota gratuita acabou. Varredura só de leitura com `gh` (keyring, `GH_TOKEN` e `GITHUB_TOKEN`
vazios) nos 140 repositórios da conta: `.github/workflows/*.yml` com `runs-on` ou `os` de windows/macos (inclui matriz) ou linha que roda
suíte (`npm test`, `pytest`, `node tests/...`, `mvn test`, `go test`, `vitest`, etc.). Minutos dos últimos 30 dias: API de billing
(`users/<conta>/settings/billing/usage`, ciclos 2026-10 e 2026-11, itens com data a partir de 2026-10-11). Dono: a pasta de
`Desktop/Projetos` cujo `.git/config` aponta para o repositório.

Limites: a detecção é por texto, então pode marcar linha de comentário em bloco de script ou comando que não é suíte; o arquivo e as
linhas vão no JSON da varredura para conferir. `runs-on` por variável (`vars.CI_RUNNER`) conta como Windows quando o valor padrão é
`windows-latest`. Os repositórios sem dono local (forks de terceiros como OpenHands, omniroute, OpenJarvis, opencode, openclaw-memory e
hermes-agent-fork) têm 0 minuto nos 30 dias.

Colunas: minutos em 30 dias (Linux/Windows/macOS), visibilidade, repositório, projeto dono, arquivos com Windows/macOS, arquivos com suíte.

```
  972 min (L125/W847/M0) priv vox-engine -> vox-engine | win/mac: checks.yml,desktop-tests.yml,installer-private-python.yml,pages.yml,release.yml,update-from-old.yml | teste: desktop-tests.yml
  686 min (L338/W348/M0) pub token-guard -> token-guard | win/mac: ci.yml | teste: ci.yml,publish.yml
  543 min (L543/W0/M0) priv curso-template -> curso-template | win/mac: - | teste: ci.yml
  412 min (L412/W0/M0) priv ia-na-pratica -> curso-ia | win/mac: - | teste: ci.yml
  266 min (L173/W93/M0) priv agent-launcher -> agent-launcher | win/mac: ci.yml,pages.yml,release.yml | teste: -
  250 min (L198/W52/M0) priv smart-tool -> smart-tool | win/mac: pages.yml,release.yml | teste: -
  242 min (L109/W133/M0) pub engine-registry -> engine-registry | win/mac: pages.yml,test.yml | teste: pages.yml,publish.yml,test.yml
  199 min (L96/W103/M0) priv cerne -> cerne | win/mac: ci.yml | teste: ci.yml
  182 min (L70/W112/M0) priv whatsapp-plugin-copilot -> whatsapp-bridge | win/mac: ci.yml,release-candidate.yml | teste: ci.yml,release-candidate.yml
  150 min (L150/W0/M0) priv Byte-Craft -> Joao | win/mac: - | teste: ci.yml
   94 min (L9/W85/M0) pub like-move -> like-move | win/mac: npm-publish.yml,release.yml,tests.yml | teste: npm-publish.yml,tests.yml
   87 min (L87/W0/M0) priv action -> Action | win/mac: - | teste: ci.yml,release.yml
   76 min (L75/W1/M0) priv pages-index -> Pages | win/mac: pages.yml | teste: -
   68 min (L68/W0/M0) priv native-java -> native-java | win/mac: pages.yml,release-server.yml,release-sidecar.yml,server-ci.yml,sidecar-build.yml | teste: docs-guard.yml,full-tests.yml,server-ci.yml
   67 min (L67/W0/M0) priv skill-manager -> skill-repo | win/mac: - | teste: ci.yml,release-cli.yml,release-core.yml
   62 min (L62/W0/M0) priv openhands-private -> - | win/mac: desktop-macos.yml,desktop-windows.yml | teste: ci-script-tests.yml,ci.yml,mock-llm-docker-e2e.yml,mock-llm-e2e-comment.yml,mock-llm-e2e.yml,npm-publish.yml
   49 min (L43/W6/M0) priv security-check -> security-check | win/mac: pages.yml | teste: ci.yml
   41 min (L36/W0/M5) priv harness-padroes-cliente -> harness-padroes-cliente | win/mac: suite-macos.yml | teste: suite-macos.yml
   40 min (L32/W8/M0) pub skill-kit -> skill-kit | win/mac: ci.yml | teste: ci.yml
   24 min (L22/W2/M0) priv visual-explainer -> visual | win/mac: pages.yml | teste: -
   19 min (L3/W16/M0) priv smart-design -> smart-design | win/mac: pages.yml,tests.yml | teste: tests.yml
    9 min (L9/W0/M0) priv skill-engine -> skill-manager | win/mac: pages.yml | teste: pages.yml
    9 min (L9/W0/M0) priv opencode-memory -> - | win/mac: - | teste: publish.yml
    8 min (L8/W0/M0) priv neural-link -> neural-link | win/mac: - | teste: ci.yml
    6 min (L6/W0/M0) priv copilot-delegate -> vscode | win/mac: - | teste: ci.yml
    5 min (L5/W0/M0) priv powerred-apps -> powerred-apps | win/mac: - | teste: ci.yml
    2 min (L2/W0/M0) priv copilot-mobile -> copilot-mobile | win/mac: - | teste: tests.yml
    2 min (L2/W0/M0) priv exam-simulator -> exam-simulator | win/mac: - | teste: ci.yml
    0 min (L0/W0/M0) priv opencode-brain-keeper -> opencode-brain-keeper | win/mac: - | teste: ci.yml
    0 min (L0/W0/M0) priv remote-vscode -> remote-vscode | win/mac: release-runtime.yml | teste: -
    0 min (L0/W0/M0) pub local-ci-forge -> local-ci-forge | win/mac: - | teste: ci.yml
    0 min (L0/W0/M0) pub OpenHands -> OpenHands (pasta de mesmo nome, sem .git ou outro remote) | win/mac: desktop-macos.yml,desktop-windows.yml | teste: ci-script-tests.yml,ci.yml,mock-llm-docker-e2e.yml,mock-llm-e2e-comment.yml,mock-llm-e2e.yml,npm-publish.y
    0 min (L0/W0/M0) pub omniroute -> - | win/mac: ci.yml | teste: ci.yml,nightly-compat.yml,nightly-property.yml,nightly-resilience.yml,npm-publish.yml,opencode-plugin-ci.yml,opencode-provider-ci.yml,quality.yml
    0 min (L0/W0/M0) pub OpenJarvis -> - | win/mac: ci.yml,installer-integration.yml | teste: ci.yml,claude-issues.yml,desktop.yml
    0 min (L0/W0/M0) priv openclaw-memory -> - | win/mac: ci.yml,codeql-macos-critical-security.yml,website-installer-sync.yml,windows-node-release.yml | teste: ci.yml,npm-telegram-beta-e2e.yml,openclaw-live-and-e2e-checks-reusable.yml,openclaw-performance.yml
    0 min (L0/W0/M0) pub opencode -> - | win/mac: publish.yml | teste: -
    0 min (L0/W0/M0) priv hermes-agent-fork -> - | win/mac: build-windows-installer.yml,nix.yml | teste: docker-publish.yml,tests.yml
```
