// product-page-order.mjs — a ordem de uma página de produto, conferida no HTML (sem navegador, sem porta).
//
// Regra do dono (pesquisa de 26/10): cabeçalho com o botão Apresentar; primeira tela com a promessa curta, os três
// caminhos (Assistir, Apresentar, Ver o que o produto faz) e o vídeo do produto como primeiro bloco em destaque, com
// no máximo 60 palavras de texto antes dele. É a mesma regra do verificador com navegador do orquestrador
// (tools/product-page-check.mjs); aqui ela roda onde ele não existe (CI) e sobre páginas baixadas.

export const MAX_PALAVRAS_ANTES_DO_VIDEO = 60;

const semRuido = (h) => h
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<(script|style|svg|template|noscript)\b[\s\S]*?<\/\1>/gi, " ");
const texto = (h) => semRuido(h).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
const palavras = (t) => (t.match(/[\p{L}\p{N}]+/gu) ?? []).length;
// Controles (a, button, role=button) com o texto visível e aria-label.
const controles = (h) => [...semRuido(h).matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)]
  .map(([, , attrs, inner]) => `${attrs.match(/aria-label="([^"]*)"/i)?.[1] ?? ""} ${texto(inner)}`.replace(/\s+/g, " ").trim());

/** Problemas da declaração de página de um motor no manifest (`pagesUrl` https ou `pagesPendente` com motivo); lista vazia = declarada. */
export function problemasDeDeclaracao({ pagesUrl: url, pagesPendente: motivo }) {
  const problemas = [];
  if (typeof url !== "string" && !(typeof motivo === "string" && motivo.length >= 10)) { problemas.push("sem pagesUrl nem pagesPendente com motivo (mínimo 10 caracteres)"); }
  if (url !== undefined && !/^https:\/\/[^\s]+$/.test(url)) { problemas.push(`pagesUrl não é https: ${url}`); }
  return problemas;
}

/**
 * Baixa a página de produto e devolve o que a reprova (HTTP, sem `<video>`, fora de ordem); lista vazia = no ar, com vídeo e na ordem.
 * Falha de rede é problema, nunca lista vazia.
 * @param {string} url
 * @param {{buscar?:typeof fetch, timeoutMs?:number}=} opts `buscar` troca o `fetch` (testes).
 */
export async function problemasDaPaginaNoAr(url, { buscar = fetch, timeoutMs = 30000 } = {}) {
  try {
    const r = await buscar(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) { return [`HTTP ${r.status}`]; }
    const html = await r.text(), achados = problemasDeOrdem(html);
    return /<video\b/i.test(html) ? achados : ["a página não contém elemento <video>", ...achados.filter((a) => !a.includes("<video>"))];
  } catch (err) { return [`não foi possível baixar: ${err.message}`]; }
}

/** Problemas da ordem da página de produto; lista vazia = a ordem vale. */
export function problemasDeOrdem(html) {
  const problemas = [];
  const cabecalho = html.match(/<header\b[\s\S]*?<\/header>/i)?.[0] ?? "";
  if (!controles(cabecalho).some((c) => /\bapresentar\b/i.test(c))) { problemas.push("sem botão Apresentar no cabeçalho"); }

  const iMain = html.search(/<main\b/i);
  if (iMain === -1) { return [...problemas, "sem <main>"]; }
  const main = html.slice(iMain, html.search(/<\/main>/i) === -1 ? undefined : html.search(/<\/main>/i));
  const iVideo = main.search(/<video\b/i);
  if (iVideo === -1) { return [...problemas, "sem elemento <video> no <main>"]; }

  const antes = main.slice(0, iVideo);
  if (/<(audio|iframe|embed|object)\b/i.test(semRuido(antes))) { problemas.push("há outra mídia antes do vídeo"); }
  if (/<(h2|h3|ul|ol|table)\b/i.test(semRuido(antes))) { problemas.push("há seção, lista ou tabela antes do vídeo (o vídeo deve ser o primeiro bloco)"); }
  const n = palavras(texto(antes));
  if (n > MAX_PALAVRAS_ANTES_DO_VIDEO) { problemas.push(`${n} palavras antes do vídeo (máximo ${MAX_PALAVRAS_ANTES_DO_VIDEO})`); }

  const ctrl = controles(antes);
  for (const [rotulo, re] of [["Assistir", /\bassistir\b/i], ["Apresentar", /\bapresentar\b/i], ["Ver o que o produto faz", /ver o que o produto faz/i]]) {
    if (!ctrl.some((c) => re.test(c))) { problemas.push(`caminho "${rotulo}" ausente antes do vídeo`); }
  }
  const tag = main.slice(iVideo).match(/<video\b[^>]*>/i)[0];
  if (/\bautoplay\b/i.test(tag)) { problemas.push("vídeo com autoplay"); }
  if (/loading=["']?lazy/i.test(tag)) { problemas.push("vídeo com loading=lazy"); }
  return problemas;
}
