// test-pages-gate.mjs — nenhum motor entra neste registro público sem a página de produto dele, com vídeo.
//
// A página nasce do repositório do próprio motor (nunca é construída aqui); o registro só aponta para ela (`pagesUrl`).
//
//   node tests/test-pages-gate.mjs          # offline: o manifest declara a página de cada motor + o verificador de ordem contra fixtures
//   node tests/test-pages-gate.mjs --live   # CI: baixa cada pagesUrl e confere que a página existe, tem <video> e segue a ordem
//
// Tolerância: só um motor com `pagesPendente` (motivo explícito no manifest) pode falhar o teste ao vivo, e o motivo é
// impresso aqui. Sem pagesPendente, página ausente, sem <video> ou fora de ordem reprova.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { problemasDeOrdem } from "../tools/product-page-order.mjs";

const REPO = join(import.meta.dirname, "..");
const live = process.argv.includes("--live");

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log(`== portão de páginas de produto (${live ? "ao vivo" : "offline"}) ==\n`);

// ---- 1) o verificador de ordem, contra fixtures ------------------------------------------------------------------------
const pagina = ({ cabecalho = '<button data-apresentar>Apresentar</button>', antes = "", video = '<video controls poster="p.jpg"><source src="v.mp4"></video>', depois = "" } = {}) =>
  `<header><a href="/">Produto</a>${cabecalho}</header><main><section class="hero"><h1>Faz uma coisa bem feita</h1><p>Instale uma vez.</p>
   <div><button data-assistir>Assistir ao vídeo</button><button data-apresentar>Apresentar com narração</button><a href="#mais">Ver o que o produto faz</a></div>${antes}${video}</section>${depois}<section id="mais"><h2>Mais</h2></section></main>`;
const falha = (html, trecho) => problemasDeOrdem(html).some((p) => p.includes(trecho));

check("fixture válida: ordem correta passa sem problemas", problemasDeOrdem(pagina()).length === 0, problemasDeOrdem(pagina()).join("; "));
check("sem botão Apresentar no cabeçalho reprova", falha(pagina({ cabecalho: "" }), "Apresentar no cabeçalho"));
check("página sem <video> reprova", falha(pagina({ video: "" }), "sem elemento <video>"));
check("vídeo depois de uma seção (h2) reprova", falha(pagina({ antes: "<h2>Sobre</h2><p>texto</p>" }), "primeiro bloco"));
check("mais de 60 palavras antes do vídeo reprova", falha(pagina({ antes: `<p>${"palavra ".repeat(70)}</p>` }), "palavras antes do vídeo"));
check("exatamente no limite de 60 palavras antes do vídeo passa", !falha(pagina({ antes: `<p>${"palavra ".repeat(40)}</p>` }), "palavras antes do vídeo"));
check("outra mídia antes do vídeo reprova", falha(pagina({ antes: '<iframe src="x"></iframe>' }), "outra mídia"));
check("caminho 'Assistir' ausente reprova", falha(pagina().replace("Assistir ao vídeo", "Tocar"), 'caminho "Assistir"'));
check("caminho 'Ver o que o produto faz' ausente reprova", falha(pagina().replace("Ver o que o produto faz", "Saiba mais"), "Ver o que o produto faz"));
check("vídeo com autoplay reprova", falha(pagina({ video: "<video autoplay></video>" }), "autoplay"));
check("vídeo com loading=lazy reprova", falha(pagina({ video: '<video loading="lazy"></video>' }), "lazy"));
check("texto de <script> e <svg> não conta como palavra antes do vídeo", !falha(pagina({ antes: `<svg><text>${"x ".repeat(80)}</text></svg><script>${"y ".repeat(80)}</script>` }), "palavras antes do vídeo"));
check("a vitrine deste registro (site/index.html) segue a ordem", problemasDeOrdem(readFileSync(join(REPO, "site", "index.html"), "utf8")).length === 0,
  problemasDeOrdem(readFileSync(join(REPO, "site", "index.html"), "utf8")).join("; "));

// ---- 2) o manifest: cada motor aponta para a página dele ou declara por que ainda não ------------------------------------------
const manifest = JSON.parse(readFileSync(join(REPO, "manifest.json"), "utf8"));
for (const e of manifest.engines) {
  const url = e.pagesUrl, motivo = e.pagesPendente;
  check(`${e.name}: tem pagesUrl ou pagesPendente com motivo`, typeof url === "string" || (typeof motivo === "string" && motivo.length >= 10));
  if (url !== undefined) { check(`${e.name}: pagesUrl é https`, /^https:\/\/[^\s]+$/.test(url), String(url)); }
  if (motivo !== undefined) { console.log(`  (pendente) ${e.name}: ${motivo}`); }
}

// ---- 3) ao vivo (CI): a página existe, tem vídeo e segue a ordem ----------------------------------------------------------------
if (live) {
  for (const e of manifest.engines.filter((x) => x.pagesUrl)) {
    let achados;
    try {
      const r = await fetch(e.pagesUrl, { redirect: "follow", signal: AbortSignal.timeout(30000) });
      const html = await r.text();
      achados = r.ok ? problemasDeOrdem(html) : [`HTTP ${r.status}`];
      if (r.ok && !/<video\b/i.test(html)) { achados = ["a página não contém elemento <video>", ...achados.filter((a) => !a.includes("<video>"))]; }
    } catch (err) { achados = [`não foi possível baixar: ${err.message}`]; }
    if (achados.length === 0) {
      check(`${e.name}: página no ar com vídeo na ordem (${e.pagesUrl})`, true);
      if (e.pagesPendente) { console.log(`  (obsoleto) ${e.name}: a página já passa — remova pagesPendente do manifest`); }
    }
    else if (e.pagesPendente) { console.log(`  (tolerado) ${e.name}: ${achados.join("; ")} — pagesPendente: ${e.pagesPendente}`); }
    else { check(`${e.name}: página no ar com vídeo na ordem (${e.pagesUrl})`, false, achados.join("; ")); }
  }
}

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
