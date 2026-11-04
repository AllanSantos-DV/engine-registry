# Lente de feature irmã do client-harness 0.1.3 (2026-11-03)

Haiku, esforço alto, só código e docs, só candidatos novos além das lentes anteriores.

| # | Achado | Resolução |
|---|---|---|
| 1 | `docs/PAGES.md` dizia que só Vox Engine e VXK têm Pages e mandava trocar `PAGES_PROPRIO` à mão | corrigido: lista inclui client-harness e `PAGES_PROPRIO` vem do manifest |
| 2 | Release `client-harness-v0.1.3` precisa existir e trazer `package.json` 0.1.3 | verificada: `verify-release` (sha256 `a6ec189b…f5de`, Ed25519 OK) e instalação real em HOME isolado resolveu v0.1.3 (log `2026-11-03-client-harness-0.1.3-consumidor.log`) |

Sem outras menções à versão em `kit/`, `consumers/`, `schema.json`, `CONTRATO-MOTOR.md`, roteiro e site.
