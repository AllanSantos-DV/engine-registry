// engine-registry — vitrine. Modo Apresentar (cenas com narração e diagrama revelado aos poucos) e leitura do vídeo.
// Sem dependências nem rede. A voz é a do navegador (speechSynthesis, pt-BR); sem voz disponível, as legendas e as setas
// conduzem a apresentação. As mesmas cenas ficam em docs/ROTEIRO-APRESENTACAO.md para a versão em vídeo.
(() => {
  "use strict";

  // ---- cenas: cada "parte" é uma frase narrada e revela um passo do visual -------------------------------------------
  const FICHAS = [
    ["Vox Engine", "voz: ditado, transcrição, tradução e fala", "#ff8a5c"],
    ["Cerne", "vídeo: quadros-chave, transcrição e memória", "#7cc4ff"],
    ["VXK", "explicação visual animada e narrada", "#ffd166"],
    ["mcp-gateway", "um endereço para todos os servidores MCP", "#6ef2b5"],
    ["embed-house", "vetores de busca sem repetir o modelo", "#b79cff"],
    ["neural-link", "uma decisão para cada evento de hook", "#b8e86b"],
  ];
  const CENAS = [
    { t: "engine-registry", vis: "hero", partes: [
      "Esta é a casa dos motores locais: você instala cada um uma vez e todos os seus aplicativos e agentes passam a usar.",
    ] },
    { t: "O que se repete hoje", vis: "hero", partes: [
      "Hoje, cada ferramenta de inteligência artificial costuma carregar o próprio modelo, o próprio servidor e o próprio processo.",
      "Com várias sessões abertas, o computador repete o mesmo trabalho muitas vezes.",
    ] },
    { t: "Um motor para todos", vis: "hero", partes: [
      "Um motor faz o trabalho pesado uma única vez, nesta máquina.",
      "O Claude Code, o Codex, o Copilot, o Cursor e os seus scripts pedem a ele o que precisam.",
    ] },
    { t: "Os seis motores", vis: "fichas", partes: [
      "O Vox Engine dita, transcreve, traduz e fala.",
      "O Cerne lê um vídeo e guarda o que importa numa memória que dá para pesquisar.",
      "O VXK transforma o roteiro do agente numa explicação animada e narrada.",
      "O mcp-gateway reúne todos os servidores MCP num endereço só.",
      "O embed-house serve os vetores de busca sem repetir o modelo em cada sessão.",
      "E o neural-link devolve uma decisão única para cada evento de hook do agente.",
    ] },
    { t: "Como se conectam", vis: "mapa", partes: [
      "Tudo começa nos seus agentes e aplicativos.",
      "Eles se conectam ao mcp-gateway: uma conexão por servidor e um endereço para todos.",
      "Por trás dele ficam o Vox Engine, o Cerne e o VXK, cada um com a sua ferramenta.",
      "O VXK usa o Vox para narrar as explicações. Sem o Vox, ele avisa, em vez de gerar uma página muda.",
      "O embed-house atende o agente direto, entregando vetores sem repetir o modelo.",
      "O neural-link também atende direto: recebe o evento de hook e devolve uma decisão.",
      "E embaixo de tudo, o engine-kit instala, verifica e mantém vivo cada motor.",
    ] },
    { t: "Instalação confiável", vis: "mapa", n: 7, partes: [
      "Antes de instalar, cada motor passa por duas conferências: o SHA-256 e a assinatura Ed25519. Se alguma falhar, nada é instalado.",
    ] },
    { t: "Como usar", vis: "mapa", n: 7, partes: [
      "Para começar, escolha o motor, instale pelo kit e use nos seus aplicativos.",
      "Quando um motor é atualizado, todos os aplicativos recebem a nova versão ao mesmo tempo. Engine-registry: instale uma vez, use em qualquer lugar.",
    ] },
  ];

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const el = (tag, cls, texto) => { const e = document.createElement(tag); if (cls) { e.className = cls; } if (texto) { e.textContent = texto; } return e; };

  // ---- vídeo: sem o arquivo, mostra o aviso em vez de um player quebrado ---------------------------------------------
  const video = $("#apresentacao");
  if (video) {
    const falhou = () => { video.hidden = true; $("#video-vazio").hidden = false; };
    $("source", video)?.addEventListener("error", falhou);
    video.addEventListener("error", falhou);
    // o erro da <source> pode disparar antes deste script rodar: confere o estado também depois do carregamento
    window.addEventListener("load", () => { if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) { falhou(); } });
  }

  // ---- modo Apresentar -------------------------------------------------------------------------------------------------
  const abrir = document.querySelectorAll("[data-apresentar]");
  if (!abrir.length) { return; }
  const temVoz = "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
  let ap = null;   // estado da apresentação aberta

  const vozPt = () => {
    const vozes = temVoz ? speechSynthesis.getVoices() : [];
    return vozes.find((v) => /^pt-BR/i.test(v.lang)) || vozes.find((v) => /^pt/i.test(v.lang)) || null;
  };

  function montarVisual(cena, destino) {
    destino.replaceChildren();
    if (cena.vis === "hero") {
      const svg = $(".hero-art svg").cloneNode(true);
      destino.append(svg);
    } else if (cena.vis === "fichas") {
      const caixa = el("div", "fichas");
      FICHAS.forEach(([nome, desc, cor]) => {
        const f = el("div", "ficha"); f.style.setProperty("--cor", cor);
        f.append(el("b", "", nome), el("span", "", desc));
        caixa.append(f);
      });
      destino.append(caixa);
    } else {
      const svg = $("#mapa").cloneNode(true);
      svg.removeAttribute("id"); svg.classList.add("prog");
      destino.append(svg);
    }
  }

  function mostrar(i, j) {
    const cena = CENAS[i];
    ap.i = i; ap.j = j;
    if (ap.cenaMontada !== i) { montarVisual(cena, ap.visual); ap.cenaMontada = i; }
    ap.titulo.textContent = cena.t;
    ap.texto.replaceChildren(...cena.partes.slice(j, j + 1).map((p) => el("p", "", p)));
    const passo = cena.n ?? j + 1;
    if (cena.vis === "fichas") { ap.visual.querySelectorAll(".ficha").forEach((f, k) => f.classList.toggle("on", k < passo)); }
    if (cena.vis === "mapa") { ap.visual.querySelectorAll("[data-s]").forEach((g) => g.classList.toggle("on", Number(g.dataset.s) <= passo)); }
    const total = CENAS.reduce((s, c) => s + c.partes.length, 0);
    const feitas = CENAS.slice(0, i).reduce((s, c) => s + c.partes.length, 0) + j + 1;
    ap.barra.style.width = `${(feitas / total) * 100}%`;
    ap.pos.textContent = `${i + 1} / ${CENAS.length}`;
  }

  function parar() { ap.ficha += 1; clearTimeout(ap.timer); if (temVoz) { speechSynthesis.cancel(); } }

  function falar() {
    const cena = CENAS[ap.i], texto = cena.partes[ap.j], ficha = ++ap.ficha;
    clearTimeout(ap.timer);
    if (temVoz) { speechSynthesis.cancel(); }
    const seguir = () => { if (ap && ap.ficha === ficha && ap.tocando) { setTimeout(() => ap && ap.ficha === ficha && avancar(true), 500); } };
    if (temVoz && ap.som) {
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = "pt-BR"; const v = vozPt(); if (v) { u.voice = v; }
      u.onend = seguir; u.onerror = seguir;
      speechSynthesis.speak(u);
    } else {
      ap.timer = setTimeout(seguir, Math.max(3500, texto.length * 65));
    }
  }

  function avancar(auto) {
    let { i, j } = ap;
    if (j + 1 < CENAS[i].partes.length) { j += 1; } else if (i + 1 < CENAS.length) { i += 1; j = 0; } else {
      parar(); ap.tocando = false; ap.botPausa.textContent = "Recomeçar"; return;
    }
    mostrar(i, j);
    if (ap.tocando || auto) { falar(); } else { parar(); }
  }

  function voltar() {
    let { i, j } = ap;
    if (j > 0) { j -= 1; } else if (i > 0) { i -= 1; j = CENAS[i].partes.length - 1; }
    mostrar(i, j);
    if (ap.botPausa.textContent === "Recomeçar") { ap.botPausa.textContent = "Continuar"; }
    if (ap.tocando) { falar(); } else { parar(); }
  }

  function alternar() {
    if (ap.botPausa.textContent === "Recomeçar") { ap.tocando = true; ap.botPausa.textContent = "Pausar"; mostrar(0, 0); falar(); return; }
    ap.tocando = !ap.tocando;
    ap.botPausa.textContent = ap.tocando ? "Pausar" : "Continuar";
    if (ap.tocando) { falar(); } else { parar(); }
  }

  function fechar() {
    parar();
    ap.raiz.remove();
    document.querySelectorAll("header, main, footer").forEach((e) => { e.inert = false; });
    document.removeEventListener("keydown", teclas, true);
    const voltarPara = ap.origem; ap = null;
    voltarPara?.focus();
  }

  function teclas(e) {
    if (!ap) { return; }
    if (e.key === "Escape") { e.preventDefault(); fechar(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); avancar(false); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); voltar(); }
    else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); alternar(); }
  }

  function abrirApresentacao(origem) {
    if (ap) { return; }
    const raiz = el("div", "apres"); raiz.setAttribute("role", "dialog"); raiz.setAttribute("aria-modal", "true"); raiz.setAttribute("aria-label", "Apresentação do engine-registry"); raiz.tabIndex = -1;
    const topo = el("div", "apres-topo"), pos = el("span", "pos");
    topo.append(el("strong", "", "engine-registry · apresentação"), pos);
    const corpo = el("div", "apres-corpo"), blocoTexto = el("div", "apres-texto"), titulo = el("h2"), texto = el("div"), visual = el("div", "apres-visual");
    texto.setAttribute("aria-live", "polite");
    blocoTexto.append(titulo, texto); corpo.append(blocoTexto, visual);
    const barra = el("div", "apres-barra"), barraI = el("i"); barra.append(barraI);
    const ctl = el("div", "apres-ctl");
    const bt = (rotulo, fn, cls = "btn peq") => { const b = el("button", cls, rotulo); b.type = "button"; b.addEventListener("click", fn); return b; };
    const botPausa = bt("Pausar", alternar, "btn pri peq"), botSom = bt("Som: ligado", () => {
      ap.som = !ap.som; botSom.textContent = ap.som ? "Som: ligado" : "Som: desligado";
      if (ap.tocando) { falar(); }
    });
    const aviso = el("span", "aviso", temVoz ? "Narração pela voz do navegador. Setas ← → navegam; Espaço pausa; Esc sai." : "Este navegador não tem voz de narração: use as setas ← → para avançar. Esc sai.");
    ctl.append(bt("Anterior", voltar), botPausa, bt("Próxima", () => avancar(false)), botSom, bt("Sair", fechar), aviso);
    raiz.append(topo, corpo, barra, ctl);
    document.body.append(raiz);
    document.querySelectorAll("header, main, footer").forEach((e) => { e.inert = true; });
    ap = { raiz, titulo, texto, visual, barra: barraI, pos, botPausa, i: 0, j: 0, cenaMontada: -1, tocando: true, som: temVoz, ficha: 0, timer: 0, origem };
    document.addEventListener("keydown", teclas, true);
    if (!temVoz) { botSom.disabled = true; botSom.textContent = "Som: indisponível"; }
    mostrar(0, 0);
    raiz.focus();
    falar();
  }

  abrir.forEach((b) => b.addEventListener("click", () => abrirApresentacao(b)));
  if (temVoz) { speechSynthesis.getVoices(); }   // dispara o carregamento das vozes antes do primeiro clique
})();
