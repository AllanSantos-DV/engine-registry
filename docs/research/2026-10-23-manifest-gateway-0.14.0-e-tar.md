# mcp-gateway 0.14.0 no manifest + tar no Windows (2026-10-23)

- Manifest em main estava em 0.13.9; ajustado para 0.14.0 com `kit/update-manifest.mjs`. O manifest não guarda SHA (vem do sidecar do release).
- `gh release view mcp-gateway-v0.14.0`: asset sha256 616e2800…c2497; `npm run verify-release mcp-gateway` → sha256 OK, assinatura ed25519-sha256-raw OK, adulterado recusado.
- `extractTgz` já usava `tarBinary()` (System32\tar.exe no Windows, `tar` do PATH nos demais). Faltava prova: `test-gateway-provision.mjs` instala via `ensureGateway` com registry local + fetcher e um `tar.exe` quebrado na frente do PATH. Sem a correção o teste cai (RED confirmado desativando o `tarBinary` nativo).
- `ensureGateway` agora repassa `registryUrl` e `fetcher`; `ensureEngine` repassa `fetcher` ao `provision`.
