// test-site-tokens.mjs — a vitrine se estiliza só pelos tokens do Smart Design: nenhuma cor literal fora de site/tokens.css, e os
// tokens mantêm os valores da página publicada.
//
// Sem navegador nem rede. Cor literal é #rgb, #rrggbb, #rrggbbaa e rgb()/rgba()/hsl()/hsla() com número. Exceções declaradas:
//   - site/assets/mark.svg é um favicon: um SVG avulso não herda as variáveis da página e leva o próprio bloco :root, gerado
//     de site/tokens.css por tools/gerar-favicon.mjs; o arquivo tem de ser igual ao que o gerador produz.
//   - <meta name="theme-color"> não aceita var(): o valor tem de ser o de --color-bg.
//
//   node tests/test-site-tokens.mjs
import "./_tmp.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gerarFavicon } from "../tools/gerar-favicon.mjs";

const SITE = join(import.meta.dirname, "..", "site");
const read = (p) => readFileSync(join(SITE, p), "utf8");

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const HEX = /(?<![\w&-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const FUNCAO = /\b(?:rgba?|hsla?)\(\s*[\d.]/gi;
const TEMA = /<meta\s+name="theme-color"\s+content="([^"]*)">/;
const ALFA_TOLERANCIA = 1 / 255;

/** Cores literais de um texto, cada uma como aparece. */
const literais = (texto) => [...(texto.match(HEX) ?? []), ...(texto.match(FUNCAO) ?? [])];

/** [r, g, b, a] de #rgb, #rrggbb, #rrggbbaa, rgb() ou rgba(); null quando não é cor. */
function cor(texto) {
  const t = texto.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) { h = [...h].map((c) => c + c).join(""); }
    if (h.length !== 6 && h.length !== 8) { return null; }
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(t);
  if (m) { return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4]]; }
  return null;
}

/** {nome: valor} das declarações `--nome: valor;` de uma folha de estilo. */
function declaracoes(css) {
  const out = {};
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) { out[m[1]] = m[2].trim(); }
  return out;
}

const iguais = (a, b) => a && b && a.slice(0, 3).every((v, i) => v === b[i]) && Math.abs(a[3] - b[3]) <= ALFA_TOLERANCIA;

console.log("== site: vitrine só pelos tokens ==\n");

let tokensCss = "";
try { tokensCss = read("tokens.css"); } catch { /* o check abaixo falha com o motivo */ }
check("site/tokens.css existe", tokensCss.length > 0);
const tokens = declaracoes(tokensCss);

const html = read("index.html");
const css = read("assets/styles.css");
const js = read("assets/site.js");
const marca = read("assets/mark.svg");

const ordem = [html.indexOf('href="tokens.css"'), html.indexOf('href="assets/styles.css"')];
check("index.html liga tokens.css antes do styles.css", ordem[0] >= 0 && ordem[1] > ordem[0], `posições ${ordem.join(", ")}`);

const semTema = html.replace(TEMA, "");
const arquivos = { "index.html": semTema, "assets/styles.css": css, "assets/site.js": js };
for (const [nome, texto] of Object.entries(arquivos)) {
  const achadas = literais(texto);
  check(`${nome}: nenhuma cor literal`, achadas.length === 0, `${achadas.length} (${[...new Set(achadas)].slice(0, 6).join(", ")})`);
}

let marcaGerada = null, motivo = "rode: node tools/gerar-favicon.mjs";
try { marcaGerada = gerarFavicon(tokensCss); } catch (e) { motivo = e.message; }
check("assets/mark.svg é o que tools/gerar-favicon.mjs produz de tokens.css", marca.replaceAll("\r\n", "\n") === marcaGerada, motivo);
const marcaSemRaiz = marca.replace(/:root\s*\{[^}]*\}/, "");
check("assets/mark.svg: fora do bloco :root, nenhuma cor literal", literais(marcaSemRaiz).length === 0, literais(marcaSemRaiz).join(", "));

const tema = TEMA.exec(html);
check('<meta name="theme-color"> tem o valor de --color-bg', !!tema && iguais(cor(tema[1]), cor(tokens["--color-bg"] ?? "")), `${tema?.[1]} x ${tokens["--color-bg"]}`);

const usadas = new Set();
for (const texto of [html, css, js]) { for (const m of texto.matchAll(/var\(\s*(--[\w-]+)/g)) { usadas.add(m[1]); } }
const proprias = new Set(Object.keys(declaracoes(css)));
const soltas = [...usadas].filter((v) => !(v in tokens) && !proprias.has(v));
check("toda var(--x) usada vem de tokens.css ou é declarada no styles.css", soltas.length === 0, soltas.join(", "));
const duplicadas = Object.keys(declaracoes(css)).filter((v) => v in tokens);
check("styles.css não redeclara um token", duplicadas.length === 0, duplicadas.join(", "));

const PUBLICADOS = {
  "--color-bg": "#07110e", "--color-surface": "#0c1a15", "--color-surface-alt": "#12261e", "--color-border": "#2a4a3e",
  "--color-text": "#eaf4ef", "--color-text-muted": "#a8c2b5", "--color-text-faint": "#7fa092",
  "--color-accent": "#6ef2b5", "--color-coral": "#ff8a5c", "--color-sky": "#7cc4ff", "--color-violet": "#b79cff",
  "--color-amber": "#ffd166", "--color-lime": "#b8e86b", "--color-focus": "#ffd166", "--color-on-accent": "#04110c",
  "--color-accent-hover": "#a8ffd8", "--color-video-bg": "#000000",
  "--color-glow-accent": "rgba(110,242,181,.10)", "--color-glow-accent-strong": "rgba(110,242,181,.12)",
  "--color-grid-line": "rgba(110,242,181,.035)", "--color-glow-sky": "rgba(124,196,255,.07)", "--color-topbar": "rgba(7,17,14,.92)",
};
const resolve = (valor, fundo = tokens) => {
  for (let i = 0; i < 5; i++) {
    const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(valor ?? "");
    if (!m) { break; }
    valor = fundo[m[1]];
  }
  return valor;
};
for (const [nome, esperado] of Object.entries(PUBLICADOS)) {
  const atual = resolve(tokens[nome]);
  check(`${nome} mantém o valor da página publicada`, iguais(cor(atual ?? ""), cor(esperado)), `${atual} x ${esperado}`);
}

const sombra = tokens["--elevation-video"] ?? "";
check("--elevation-video mantém a sombra do vídeo (0 24px 60px, preto a 35%)", /^0(px)?\s+24px\s+60px\s+0(px)?\s+/.test(sombra) && iguais(cor(sombra.split(/\s+/).pop()), [0, 0, 0, 0.35]), sombra);

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
