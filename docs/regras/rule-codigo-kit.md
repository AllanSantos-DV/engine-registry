---
id: rule:codigo:engine-registry-kit
work_kind: code
paths:
  - kit/**
  - consumers/**
---
Código do kit: o orçamento do consumidor é 27000 B (`node kit/budget.mjs`), então não cresce sem tirar outra coisa. Toda chamada de child_process leva `windowsHide: true`. Verificação de sha256 e de assinatura Ed25519 falha fechada: erro com contexto, nunca um fallback que deixa passar.
