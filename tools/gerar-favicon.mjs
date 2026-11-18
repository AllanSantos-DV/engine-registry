#!/usr/bin/env node
/**
 * Gera site/assets/mark.svg a partir de site/tokens.css: as quatro cores do favicon saem dos tokens, sem repetir hex à mão.
 * O SVG avulso não herda as variáveis da página, então leva o próprio bloco :root com os mesmos nomes e valores do tokens.css.
 *
 *   node tools/gerar-favicon.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = join(import.meta.dirname, "..", "site");
const CORES = [
  ["--color-surface-alt", "f"],
  ["--color-accent", "a"],
  ["--color-amber", "b"],
  ["--color-coral", "c"],
];

/**
 * SVG do favicon com as cores de `tokensCss` (texto do tokens.css).
 * @param {string} tokensCss
 * @returns {string}
 * @throws {Error} quando um token do favicon não está no tokens.css.
 */
export function gerarFavicon(tokensCss) {
  const valor = (nome) => {
    const m = new RegExp(`${nome}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(tokensCss);
    if (!m) { throw new Error(`tokens.css não define ${nome} como #rrggbb`); }
    return m[1];
  };
  const raiz = CORES.map(([nome]) => `${nome}:${valor(nome)}`).join(";");
  const regras = CORES.map(([nome, classe]) => `.${classe}{fill:var(${nome})}`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>:root{${raiz}}${regras}</style>`
    + `<rect class="f" width="32" height="32" rx="8"/><circle class="a" cx="9" cy="21" r="3"/>`
    + `<circle class="b" cx="16" cy="11" r="3"/><circle class="c" cx="23" cy="21" r="3"/></svg>\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(SITE, "assets", "mark.svg"), gerarFavicon(readFileSync(join(SITE, "tokens.css"), "utf8")));
  console.log("site/assets/mark.svg gerado a partir de site/tokens.css");
}
