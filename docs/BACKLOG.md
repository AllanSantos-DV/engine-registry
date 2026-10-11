# Backlog

Melhorias encontradas durante outro trabalho e deixadas para depois.

## Aberto

- **README: a tabela "Motores registrados" não lista o `vxk`** (está no `manifest.json` desde a
  0.4.0, `kind: cli`). Visto em 2026-10-11, durante o catálogo de apps.
- **`test-mcp-gateway-alignment.mjs` fixa `EXPECTED_VERSION` no código.** Ficou vermelho em
  silêncio da 0.13.4 até a 0.13.5. O `test-neural-link-alignment.mjs` já deriva o esperado do
  manifest; o do mcp-gateway poderia conferir o `version` do manifest contra o `package.json` de
  dentro do `.tgz` publicado, em vez de uma constante. Visto em 2026-10-11.
