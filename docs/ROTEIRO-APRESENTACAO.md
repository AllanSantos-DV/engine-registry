# Roteiro da apresentação do engine-registry

Texto narrado do modo **Apresentar** do site (`site/assets/site.js`) e roteiro do vídeo de apresentação. O vídeo e a
versão narrada com a voz do motor são produzidos pela sessão dona do VXK; o site já publica as mesmas cenas, narradas pela
voz do navegador. `tests/test-site.mjs` confere que toda fala do site consta aqui, igual: mudou o texto, muda nos dois.

## Entrega esperada da sessão visual

| Arquivo | Onde | Especificação |
|---|---|---|
| `apresentacao.mp4` | `site/media/` | MP4 H.264 + AAC, 16:9 (1920×1080), de 2 a 3 minutos, com a narração das cenas abaixo, legendas gravadas no quadro, tema escuro verde-tinta do site. |
| `apresentacao-poster.jpg` | `site/media/` | Quadro de abertura, 1920×1080, JPEG. |

Sem esses dois arquivos o site mostra um aviso no lugar do player e o portão de publicação
(`node tests/test-site.mjs --require-media`) falha. Se a versão narrada interativa do VXK for entregue como HTML, ela entra
em `site/media/` e o botão Apresentar passa a apontar para ela: pedir a mudança ao dono do site.

Regra de conteúdo: só produto. Nada de fases do projeto, revisões, testes internos, backlog, veredito ou PR.

## Identidade visual

Fundo `#07110e`, superfícies `#0c1a15`/`#12261e`, linha `#2a4a3e`, texto `#eaf4ef`. Cor de cada motor: Vox Engine coral
`#ff8a5c`, Cerne céu `#7cc4ff`, VXK âmbar `#ffd166`, mcp-gateway menta `#6ef2b5`, embed-house violeta `#b79cff`, neural-link
lima `#b8e86b`. Títulos em Bahnschrift, texto em Segoe UI, rótulos em Cascadia Mono.

## Cenas e falas

### 1. engine-registry — visual: um motor no centro, apps ao redor

- Esta é a casa dos motores locais: você instala cada um uma vez e todos os seus aplicativos e agentes passam a usar.

### 2. O que se repete hoje — visual: o mesmo diagrama; mostrar o trabalho duplicado em cada ferramenta

- Hoje, cada ferramenta de inteligência artificial costuma carregar o próprio modelo, o próprio servidor e o próprio processo.
- Com várias sessões abertas, o computador repete o mesmo trabalho muitas vezes.

### 3. Um motor para todos — visual: duplicações colapsam em um único motor

- Um motor faz o trabalho pesado uma única vez, nesta máquina.
- O Claude Code, o Codex, o Copilot, o Cursor e os seus scripts pedem a ele o que precisam.

### 4. Os seis motores — visual: uma ficha por motor, na cor dele, revelada a cada frase

- O Vox Engine dita, transcreve, traduz e fala.
- O Cerne lê um vídeo e guarda o que importa numa memória que dá para pesquisar.
- O VXK transforma o roteiro do agente numa explicação animada e narrada.
- O mcp-gateway reúne todos os servidores MCP num endereço só.
- O embed-house serve os vetores de busca sem repetir o modelo em cada sessão.
- E o neural-link devolve uma decisão única para cada evento de hook do agente.

### 5. Como se conectam — visual: o mapa, revelado em sete passos (um por frase)

Uma fala por passo; a anotação entre parênteses diz o que aparece e não é narrada:

- Tudo começa nos seus agentes e aplicativos. (passo 1: o nó Agentes e apps)
- Eles se conectam ao mcp-gateway: uma conexão por servidor e um endereço para todos. (passo 2: o mcp-gateway e a seta)
- Por trás dele ficam o Vox Engine, o Cerne e o VXK, cada um com a sua ferramenta. (passo 3: os três motores)
- O VXK usa o Vox para narrar as explicações. Sem o Vox, ele avisa, em vez de gerar uma página muda. (passo 4: seta tracejada "narração" do VXK ao Vox)
- O embed-house atende o agente direto, entregando vetores sem repetir o modelo. (passo 5: embed-house, rótulo "vetores")
- O neural-link também atende direto: recebe o evento de hook e devolve uma decisão. (passo 6: neural-link, rótulo "evento de hook")
- E embaixo de tudo, o engine-kit instala, verifica e mantém vivo cada motor. (passo 7: faixa do engine-kit)

### 6. Instalação confiável — visual: o mapa completo, destaque na faixa do engine-kit

- Antes de instalar, cada motor passa por duas conferências: o SHA-256 e a assinatura Ed25519. Se alguma falhar, nada é instalado.

### 7. Como usar — visual: o mapa completo; fecha com o nome e a frase final

- Para começar, escolha o motor, instale pelo kit e use nos seus aplicativos.
- Quando um motor é atualizado, todos os aplicativos recebem a nova versão ao mesmo tempo. Engine-registry: instale uma vez, use em qualquer lugar.

## Fatos que a narração pode afirmar (fonte: `manifest.json` e README)

- São seis motores: Vox Engine, VXK, mcp-gateway, Cerne, embed-house, neural-link.
- O VXK precisa do Vox para narrar e avisa quando ele falta, em vez de gerar uma página muda.
- O mcp-gateway reúne servidores MCP; Vox, Cerne e VXK expõem as ferramentas por MCP.
- O embed-house evita carregar cerca de 147 MB de modelo a cada sessão.
- O neural-link é chamado a cada evento de hook e não fica rodando em segundo plano.
- Cada release é conferida por SHA-256 e assinatura Ed25519 antes de instalar; falhando, nada é instalado.
- O cliente de instalação (engine-kit) tem menos de 27 KB de código.
- Sistemas: Windows, Linux e macOS, conforme o motor (embed-house cobre os três; Vox Engine e Cerne são Windows).
