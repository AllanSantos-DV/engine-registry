// test-site.mjs — a vitrine estática (site/) abre sem rede, não quebra link, diz só o que é verdade sobre o produto e
// não vaza assunto interno. Hermético: lê arquivos locais, não abre porta nem rede.
//
//   node tests/test-site.mjs                  # o que a suíte confere (mídia de apresentação ausente só é avisada)
//   node tests/test-site.mjs --require-media  # portão de publicação: exige o vídeo e o pôster em site/media/
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const REPO = join(import.meta.dirname, "..");
const SITE = join(REPO, "site");
const requireMedia = process.argv.includes("--require-media");

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const read = (p) => readFileSync(p, "utf8");

console.log("== site: vitrine dos motores ==\n");

const html = read(join(SITE, "index.html"));
const js = read(join(SITE, "assets", "site.js"));
const manifest = JSON.parse(read(join(REPO, "manifest.json")));
const engines = manifest.engines.map((e) => e.name);

// ---- 1) referências locais existem; âncoras apontam para ids reais -----------------------------------------------------
const MIDIA = new Set(["media/apresentacao.mp4", "media/apresentacao-poster.jpg"]);
const refs = [...html.matchAll(/(?:href|src|poster)="([^"#][^"]*)"/g)].map((m) => m[1]).filter((r) => !/^(https?:|data:|mailto:)/.test(r));
const quebradas = refs.filter((r) => !MIDIA.has(r) && !existsSync(join(SITE, r)));
check("toda referência local de index.html existe (fora a mídia de apresentação)", quebradas.length === 0, quebradas.join(", "));
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const ancoras = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
const orfas = ancoras.filter((a) => !ids.has(a));
check("toda âncora #... aponta para um id da página", orfas.length === 0, orfas.join(", "));
const abs = [...html.matchAll(/(?:href|src|poster)="(\/[^"]*)"/g)].map((m) => m[1]);
check("nenhuma referência absoluta (o site vive sob /engine-registry/)", abs.length === 0, abs.join(", "));

// ---- 2) offline e sem código inline ------------------------------------------------------------------------------------
check("CSP restringe tudo a 'self' (sem fonte, script ou imagem externos)", /Content-Security-Policy" content="default-src 'self'/.test(html));
check("sem <script>, <style> nem atributo style= ou on*= inline (a CSP bloquearia)", !/<script(?![^>]*\ssrc=)/.test(html) && !/<style/.test(html) && !/\sstyle="/.test(html) && !/\son[a-z]+="/.test(html));
const externos = [...html.matchAll(/(?:src|poster)="(https?:[^"]+)"/g)].map((m) => m[1]);
check("nenhum recurso externo carregado (só links de navegação saem do site)", externos.length === 0, externos.join(", "));
check("assets/site.js tem sintaxe válida", (() => { try { execFileSync(process.execPath, ["--check", join(SITE, "assets", "site.js")], { stdio: "pipe" }); return true; } catch { return false; } })());

// ---- 3) um card por motor do manifest, com o link certo -----------------------------------------------------------------
const cards = [...html.matchAll(/<article class="card c-[a-z]+" id="m-([^"]+)" data-motor="([^"]+)"[\s\S]*?<\/article>/g)].map((m) => ({ id: m[1], motor: m[2], html: m[0] }));
check("um card por motor do manifest.json, nem a mais nem a menos", JSON.stringify(cards.map((c) => c.motor).sort()) === JSON.stringify([...engines].sort()),
  `cards: ${cards.map((c) => c.motor).join(", ")} | manifest: ${engines.join(", ")}`);
const PAGES_PROPRIO = { "vox-engine": "https://allansantos-dv.github.io/vox-engine/", vxk: "https://allansantos-dv.github.io/visual-explainer/" };
for (const c of cards) {
  const href = c.html.match(/class="btn pri peq" href="([^"]+)"/)?.[1] ?? "";
  const esperado = PAGES_PROPRIO[c.motor] ?? `https://github.com/AllanSantos-DV/engine-registry/releases?q=${c.motor}`;
  check(`card ${c.motor}: ${PAGES_PROPRIO[c.motor] ? "link da página do produto" : "link da versão atual (o produto ainda não tem Pages)"}`, href === esperado, href);
  check(`card ${c.motor}: abre fora com rel noopener`, /target="_blank" rel="noopener noreferrer"/.test(c.html));
}
const semPages = engines.filter((n) => !PAGES_PROPRIO[n]);
console.log(`  (info) sem Pages próprio ainda, o card leva à versão atual: ${semPages.join(", ")}`);

// ---- 4) números da página batem com a fonte -------------------------------------------------------------------------------
const txtMetricas = [...html.matchAll(/<div class="metrica"><b>([^<]+)<\/b>/g)].map((m) => m[1].replace("&lt;", "<"));
check("métrica de motores = quantidade no manifest", txtMetricas.includes(String(engines.length)), `manifest: ${engines.length}`);
const embed = manifest.engines.find((e) => e.name === "embed-house");
check("métrica de 147 MB vem do resumo do embed-house no manifest", /147 MB/.test(embed?.summary ?? "") && txtMetricas.includes("147 MB"));
const budget = read(join(REPO, "kit", "budget.mjs"));
const limite = Number(budget.match(/runtime: \{ codeBytes: (\d+)/)?.[1]);
check("métrica '< 27 KB' acompanha o limite do kill-switch do kit", limite === 27000 && txtMetricas.includes("< 27 KB"), `limite no budget.mjs: ${limite}`);
const sistemas = new Set(manifest.engines.flatMap((e) => e.platforms).map((p) => p.split("-")[0]).filter((p) => p !== "any"));
check("métrica de sistemas (Windows, Linux, macOS) bate com as plataformas do manifest", sistemas.size === 3 && txtMetricas.includes("3"), [...sistemas].join(", "));

// ---- 5) cenas: só produto, e o texto narrado é o mesmo do roteiro ----------------------------------------------------------
const bloco = js.slice(js.indexOf("const FICHAS"), js.indexOf("const $ ="));
const falas = [...bloco.matchAll(/^\s+"([^"]{20,})",?$/gm)].map((m) => m[1]);
const titulos = [...bloco.matchAll(/t: "([^"]+)"/g)].map((m) => m[1]);
check("cenas carregadas do site.js", falas.length >= 18 && titulos.length === 7, `${falas.length} falas, ${titulos.length} cenas`);
// fronteira de palavra que entende acento (\b trata "ó" como separador: "próprio" viraria "pr")
const PALAVRAS = /(?<![\p{L}\d])(fases?|revis(?:ão|ões|or|ar)|testes?|testad[oa]s?|backlog|veredito|pull request|ADR|sprint|rodada|milestone)(?![\p{L}\d])/giu;
const SIGLAS = /(?<![\p{L}\d])(PR|r\d+)(?![\p{L}\d])/gu;
const proibidas = (txt) => [...txt.matchAll(PALAVRAS), ...txt.matchAll(SIGLAS)].map((m) => m[0]);
const visivel = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
const achados = [visivel, ...falas, ...titulos].flatMap(proibidas);
check("texto visível e narração falam só de produto (nada de fases, revisões, testes internos, backlog, veredito, PR)", achados.length === 0, achados.join(", "));
const roteiro = read(join(REPO, "docs", "ROTEIRO-APRESENTACAO.md"));
const fora = falas.filter((f) => !roteiro.includes(f));
check("toda fala narrada do site.js consta, igual, em docs/ROTEIRO-APRESENTACAO.md", fora.length === 0, fora.slice(0, 2).join(" | "));
const passosMapa = [...html.matchAll(/data-s="(\d)"/g)].map((m) => Number(m[1]));
const maxPasso = Math.max(...passosMapa);
const nMapa = (js.match(/t: "Como se conectam"[\s\S]*?partes: \[([\s\S]*?)\n    \] \}/)?.[1].match(/^\s+"/gm) ?? []).length;
check("o mapa tem 7 passos e a cena do mapa revela um por frase", maxPasso === 7 && nMapa === 7, `passos ${maxPasso}, frases da cena ${nMapa}`);

// ---- 6) mídia de apresentação (entregue pela sessão visual) ---------------------------------------------------------------
const faltam = [...MIDIA].filter((m) => !existsSync(join(SITE, m)) || statSync(join(SITE, m)).size === 0);
if (requireMedia) { check("mídia de apresentação presente (vídeo e pôster em site/media/)", faltam.length === 0, `faltam: ${faltam.join(", ")}`); }
else if (faltam.length) { console.log(`  (pendente) mídia de apresentação ainda não entregue: ${faltam.join(", ")} — o portão de publicação (--require-media) exige`); }

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
