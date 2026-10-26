// engine-registry — vitrine. Modo Apresentar (cenas com narração e diagrama revelado aos poucos) e leitura do vídeo.
// Sem dependências nem rede. A voz é a do Vox Engine (voz padrão do motor), gravada em media/narracao/cNN-pN.mp3 por
// tools/gerar-audio-apresentacao.mjs: uma fala por arquivo, e a cena avança pela duração real do áudio. Sem o áudio, só as
// legendas e as setas conduzem; o site nunca usa a voz do navegador. As mesmas cenas ficam em docs/ROTEIRO-APRESENTACAO.md.
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
    // "Assistir ao vídeo": só por clique (com som, que o clique libera); nada toca sozinho ao abrir a página
    document.querySelectorAll("[data-assistir]").forEach((b) => b.addEventListener("click", () => {
      video.scrollIntoView({ block: "center" }); video.focus({ preventScroll: true }); video.play();
    }));
  }

  // ---- modo Apresentar -------------------------------------------------------------------------------------------------
  const abrir = document.querySelectorAll("[data-apresentar]");
  if (!abrir.length) { return; }
  const AVISO = "Narração pela voz do Vox Engine. Setas ← → navegam; Espaço pausa; Esc sai.";
  const AVISO_SEM_AUDIO = "Narração em áudio indisponível: acompanhe pelas legendas e use as setas ← →. Esc sai.";
  const VELOCIDADES = [0.85, 1, 1.15, 1.3];
  const rotuloVel = (v) => `Velocidade: ${String(v).replace(".", ",")}×`;
  const srcAudio = (i, j) => `media/narracao/c${String(i + 1).padStart(2, "0")}-p${j + 1}.mp3`;
  let ap = null;   // estado da apresentação aberta

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
    ap.indice.value = String(i);
  }

  function parar() { ap.ficha += 1; clearTimeout(ap.timer); ap.audio.pause(); }

  // sem áudio (arquivo ausente, som desligado ou reprodução negada): as legendas seguem pelo tempo de leitura
  function porLegenda(seguir, texto) { ap.timer = setTimeout(seguir, Math.max(3500, texto.length * 65) / ap.vel); }

  function falar(retomar = false) {
    const cena = CENAS[ap.i], texto = cena.partes[ap.j], ficha = ap.ficha + (retomar ? 0 : 1);
    ap.ficha = ficha;
    clearTimeout(ap.timer);
    const seguir = () => { if (ap && ap.ficha === ficha && ap.tocando) { ap.timer = setTimeout(() => ap && ap.ficha === ficha && avancar(true), 400 / ap.vel); } };
    if (!ap.som || ap.semAudio) { ap.audio.pause(); porLegenda(seguir, texto); return; }
    const a = ap.audio, src = srcAudio(ap.i, ap.j);
    if (!(retomar && a.getAttribute("src") === src && !a.ended)) { a.src = src; }
    a.playbackRate = ap.vel;
    a.onended = seguir;
    a.onerror = () => { if (ap && ap.ficha === ficha) { ap.semAudio = true; ap.aviso.textContent = AVISO_SEM_AUDIO; ap.aviso.classList.add("falha"); porLegenda(seguir, texto); } };
    a.play().catch((e) => {
      if (!ap || ap.ficha !== ficha || e?.name === "AbortError") { return; }
      ap.semAudio = true; ap.aviso.textContent = AVISO_SEM_AUDIO; ap.aviso.classList.add("falha"); porLegenda(seguir, texto);
    });
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
    if (ap.tocando) { falar(true); } else { parar(); }
  }

  function irPara(i) { ap.botPausa.textContent = ap.tocando ? "Pausar" : "Continuar"; mostrar(i, 0); if (ap.tocando) { falar(); } else { parar(); } }

  function fechar() {
    parar(); ap.audio.removeAttribute("src"); ap.audio.load();
    ap.raiz.remove();
    ap.inertes.forEach((e) => { e.inert = false; });
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
    video?.pause();   // uma voz por vez: o vídeo não segue falando por baixo da narração
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
      if (ap.tocando) { falar(); } else { parar(); }
    });
    let v = 1;
    const botVel = bt(rotuloVel(1), () => {
      v = VELOCIDADES[(VELOCIDADES.indexOf(v) + 1) % VELOCIDADES.length]; ap.vel = v; ap.audio.playbackRate = v; botVel.textContent = rotuloVel(v);
    });
    const indice = el("select", "apres-indice"); indice.setAttribute("aria-label", "Tópicos da apresentação");
    CENAS.forEach((c, k) => { const o = el("option", "", `${k + 1}. ${c.t}`); o.value = String(k); indice.append(o); });
    indice.addEventListener("change", () => { irPara(Number(indice.value)); raiz.focus(); });
    const aviso = el("span", "aviso", AVISO);
    ctl.append(bt("Anterior", voltar), botPausa, bt("Próxima", () => avancar(false)), indice, botSom, botVel, bt("Sair", fechar), aviso);
    raiz.append(topo, corpo, barra, ctl);
    document.body.append(raiz);
    const inertes = [...document.body.children].filter((e) => e !== raiz && !e.inert);   // o link de pular é filho do body: também fica inerte
    inertes.forEach((e) => { e.inert = true; });
    ap = { inertes, raiz, titulo, texto, visual, barra: barraI, pos, botPausa, aviso, indice, audio: new Audio(), vel: 1, i: 0, j: 0, cenaMontada: -1, tocando: true, som: true, semAudio: false, ficha: 0, timer: 0, origem };
    document.addEventListener("keydown", teclas, true);
    mostrar(0, 0);
    raiz.focus();
    falar();
  }

  abrir.forEach((b) => b.addEventListener("click", () => abrirApresentacao(b)));
})();
