// test-cifra-do-cliente.mjs — a vitrine inteira (métrica da página, docs, roteiro, spec e legenda do vídeo) diz o mesmo
// tamanho do cliente, e esse tamanho é o do kill-switch do kit. Quem ouve o vídeo não pode ler outro número na página.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(REPO, p), "utf8");
let falhas = 0;
const check = (nome, ok, detalhe = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "  OK  " : " FALHA"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
};

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const DEZENAS = { 3: "trinta", 4: "quarenta", 5: "cinquenta", 6: "sessenta", 7: "setenta", 8: "oitenta", 9: "noventa" };
const porExtenso = (n) => (n % 10 === 0 ? DEZENAS[n / 10] : `${DEZENAS[Math.floor(n / 10)]} e ${UNIDADES[n % 10]}`);
const DEZ_A_VINTE = { 10: "dez", 11: "onze", 12: "doze", 13: "treze", 14: "catorze", 15: "quinze" };

const manifest = JSON.parse(read("manifest.json"));
const limite = Number(read("kit/budget.mjs").match(/runtime: \{ codeBytes: (\d+)/)?.[1]);
const kb = Math.ceil(limite / 1000);
const falado = porExtenso(kb);
check("o limite do runtime em kit/budget.mjs é legível", Number.isFinite(limite) && kb >= 30 && kb <= 99, `limite ${limite}`);

const html = read("site/index.html");
const metrica = html.match(/<div class="metrica"><b>&lt; (\d+) KB<\/b>/)?.[1];
check(`métrica da página diz '< ${kb} KB'`, Number(metrica) === kb, `página: ${metrica}`);

const pages = read("docs/PAGES.md").match(/`< (\d+) KB`/)?.[1];
check(`docs/PAGES.md diz '< ${kb} KB'`, Number(pages) === kb, `PAGES.md: ${pages}`);

const roteiro = read("docs/ROTEIRO-APRESENTACAO.md").match(/menos de (\d+) KB de código/)?.[1];
check(`roteiro diz 'menos de ${kb} KB'`, Number(roteiro) === kb, `roteiro: ${roteiro}`);

const variante = (e) => manifest.engines.some((o) => o !== e && e.name.startsWith(`${o.name}-`) && o.install.tag === e.install.tag);
const vitrine = manifest.engines.filter((e) => e.status !== "pending-release" && !variante(e));
const motores = DEZ_A_VINTE[vitrine.length] ?? String(vitrine.length);
const pastaDoVideo = readdirSync(join(REPO, "docs", "research")).find((d) => d.startsWith("20") && d.includes(`video-apresentacao-${motores}-motores`));
check(`existe a spec do vídeo com ${motores} motores`, Boolean(pastaDoVideo), `procurada: video-apresentacao-${motores}-motores`);

if (pastaDoVideo) {
  const spec = JSON.parse(read(`docs/research/${pastaDoVideo}/spec-motion.json`));
  const cenas = spec.cenas ?? spec.scenes ?? [];
  const tamanhos = cenas.flatMap((c) => c.numeros ?? c.metricas ?? []).filter((n) => n.sufixo?.trim() === "KB");
  check("a spec tem a cena de números com o tamanho do cliente", tamanhos.length === 1, `ocorrências: ${tamanhos.length}`);
  check(`número que aparece na tela do vídeo é ${kb}`, tamanhos[0]?.valor === kb, `spec: ${tamanhos[0]?.valor}`);
  const falas = cenas.filter((c) => /quilobytes/.test(c.fala ?? ""));
  check("a spec fala o tamanho do cliente em uma só cena", falas.length === 1, `cenas: ${falas.length}`);
  for (const campo of ["fala", "fala_fonetica"]) {
    check(`'${campo}' da spec diz 'menos de ${falado} quilobytes'`, (falas[0]?.[campo] ?? "").includes(`menos de ${falado} quilobytes`), falas[0]?.[campo]?.slice(-70));
  }
}

const vtt = read("site/media/apresentacao.vtt").replace(/\r?\n/g, " ");
const naLegenda = vtt.match(/menos de ([a-zçê ]+?) quilobytes/)?.[1];
check(`a legenda do vídeo publicado diz 'menos de ${falado} quilobytes'`, naLegenda === falado, `legenda: ${naLegenda}`);

console.log(falhas ? `\n== ${falhas} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(falhas ? 1 : 0);
