// test-site-copiar.mjs — cada comando da vitrine ganha um botão de copiar; sem `navigator.clipboard` o botão diz "não consegui copiar".
//
// Sem navegador nem rede: o site.js roda num contexto isolado, com um DOM mínimo.
//
//   node tests/test-site-copiar.mjs
import "./_tmp.mjs";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const js = readFileSync(new URL("../site/assets/site.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
const comandos = [...html.matchAll(/<p class="cmd">[^]*?<code>([^<]+)<\/code>/g)].map((m) => m[1]);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const elemento = () => ({
  className: "", textContent: "", attrs: {}, filhos: [], ouvintes: {},
  setAttribute(k, v) { this.attrs[k] = v; },
  addEventListener(tipo, fn) { this.ouvintes[tipo] = fn; },
  append(...n) { this.filhos.push(...n); },
});

const montar = (navigator) => {
  const linhas = comandos.map((c) => { const code = { textContent: c }; return { code, filhos: [], querySelector: () => code, append(...n) { this.filhos.push(...n); } }; });
  const document = {
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === ".cmd" ? linhas : []),
    createElement: elemento,
  };
  runInNewContext(js, { document, window: { addEventListener() {} }, navigator, setTimeout: () => 0 });
  return linhas;
};

check("a vitrine tem os oito comandos", comandos.length === 8, String(comandos.length));

let copiado = [];
const comClipboard = montar({ clipboard: { writeText: async (t) => { copiado.push(t); } } });
const botoes = comClipboard.map((l) => l.filhos.find((f) => f.className === "copiar"));
check("cada comando ganha um botão de copiar", botoes.every(Boolean), `${botoes.filter(Boolean).length}/${comClipboard.length}`);
check("o botão tem nome acessível com o comando", botoes[0]?.attrs["aria-label"]?.includes(comandos[0]));
await botoes[0].ouvintes.click();
check("clicar copia exatamente o comando e confirma", copiado[0] === comandos[0] && botoes[0].textContent === "Copiado", `${copiado[0]} / ${botoes[0].textContent}`);

const semClipboard = montar({});
const botao = semClipboard[0].filhos.find((f) => f.className === "copiar");
await botao.ouvintes.click();
check('sem navigator.clipboard o botão mostra "não consegui copiar"', botao.textContent === "não consegui copiar", botao.textContent);

const recusa = montar({ clipboard: { writeText: async () => { throw new Error("negado"); } } });
const b2 = recusa[0].filhos.find((f) => f.className === "copiar");
await b2.ouvintes.click();
check('permissão negada também mostra "não consegui copiar"', b2.textContent === "não consegui copiar", b2.textContent);

console.log(failures ? `\nFALHAS: ${failures}` : "\nTUDO VERDE");
process.exit(failures ? 1 : 0);
