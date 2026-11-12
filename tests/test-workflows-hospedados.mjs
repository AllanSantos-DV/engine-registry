// test-workflows-hospedados.mjs — o CI hospedado do GitHub só roda checagem estática leve em Linux: nenhum workflow usa
// Windows/macOS nem roda teste fora do runner local, e test.yml e pages.yml obedecem à variável CI_RUNNER (hospedado sem ela ou
// com "hosted", runner local com "local"). O publish.yml fica hospedado de propósito (proveniência do npm).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows");
const ROTEADO = "${{ vars.CI_RUNNER == 'local' && fromJSON('[\"self-hosted\",\"Linux\"]') || 'ubuntu-latest' }}";
const LOCAL = "vars.CI_RUNNER == 'local'";
const TESTE = /\bnpm\s+(run\s+)?test\b|\bnpm\s+run\s+test:|\bnode\s+(--test\s|tests\/)|\bpytest\b|\b(go|cargo|mvn)\s+test\b/;
const SO_PROIBIDO = /\b(windows|macos|osx)[-\w.]*/i;
const ROTEAVEIS = ["test.yml", "pages.yml"];

let falhas = 0;
const check = (nome, ok, detalhe = "") => { console.log(`  ${ok ? "OK  " : "FALHA"} ${nome}${ok ? "" : ` — ${detalhe}`}`); if (!ok) { falhas++; } };

const semComentario = (texto) => texto.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim() && !l.trimStart().startsWith("#")).join("\n");

/** Jobs de um workflow: nome, cabeçalho (antes de steps) e passos. */
function jobs(texto) {
  const corpo = texto.slice(texto.search(/^jobs:/m));
  const partes = corpo.split(/^  ([\w-]+):\n/m).slice(1);
  const lista = [];
  for (let i = 0; i < partes.length; i += 2) {
    const [cabecalho, ...passos] = partes[i + 1].split(/^      - /m);
    lista.push({ nome: partes[i], cabecalho, passos });
  }
  return lista;
}

/** Violações: runner proibido e teste que roda fora do runner local. */
export function violacoes(nome, bruto) {
  const texto = semComentario(bruto);
  const achadas = [];
  for (const linha of texto.split("\n")) {
    if (/\b(runs-on|os)\s*:|^\s*-\s*[\w.-]+-latest\b/.test(linha) && SO_PROIBIDO.test(linha)) { achadas.push(`runner: ${linha.trim()}`); }
  }
  for (const job of jobs(texto)) {
    const jobLocal = new RegExp(`^    if: ${LOCAL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").test(job.cabecalho);
    for (const passo of job.passos) {
      const rodaTeste = passo.split("\n").some((l) => /\brun:/.test(l) && TESTE.test(l));
      const passoLocal = passo.includes(`if: ${LOCAL}`);
      if (rodaTeste && !jobLocal && !passoLocal) { achadas.push(`teste fora do runner local em ${nome}/${job.nome}: ${passo.split("\n")[0].trim()}`); }
    }
  }
  return achadas;
}

const arquivos = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const texto = Object.fromEntries(arquivos.map((f) => [f, readFileSync(join(DIR, f), "utf8")]));

console.log("== workflows hospedados ==");

check("os três workflows do projeto existem", ["publish.yml", ...ROTEAVEIS].every((f) => f in texto), arquivos.join(", "));

for (const f of arquivos) {
  check(`${f}: sem Windows/macOS e sem teste fora do runner local`, violacoes(f, texto[f]).length === 0, violacoes(f, texto[f]).join(" | "));
}

for (const f of ROTEAVEIS) {
  const runners = [...semComentario(texto[f]).matchAll(/^\s*runs-on:\s*(.+)$/gm)].map((m) => m[1].trim());
  check(`${f}: todo runs-on passa por CI_RUNNER (local com "local", hospedado nos demais casos)`,
    runners.length > 0 && runners.every((r) => r === ROTEADO), runners.join(" | "));
  for (const job of jobs(semComentario(texto[f]))) {
    const idxCheckout = job.passos.findIndex((p) => p.includes("actions/checkout"));
    const limpa = job.passos.findIndex((p) => p.includes("-mindepth 1 -delete"));
    check(`${f}/${job.nome}: o runner persistente limpa as pastas de trabalho antes do checkout`,
      limpa >= 0 && limpa < idxCheckout, `limpa=${limpa} checkout=${idxCheckout}`);
  }
}

check("test.yml: PR de fork não roda nada (o código de fora não chega ao runner local)",
  jobs(semComentario(texto["test.yml"])).every((j) => j.cabecalho.includes("github.event.pull_request.head.repo.full_name == github.repository")));
check("test.yml: as checagens com rede só existem no runner local (job live)",
  jobs(semComentario(texto["test.yml"])).filter((j) => j.passos.some((p) => /test:(pages|versions)-live/.test(p)))
    .every((j) => j.nome === "live" && new RegExp(`^    if: ${LOCAL}`, "m").test(j.cabecalho)));
check("pages.yml: o site completo (teste) só roda no runner local",
  jobs(semComentario(texto["pages.yml"])).flatMap((j) => j.passos).filter((p) => /tests\/test-site/.test(p)).every((p) => p.includes(`if: ${LOCAL}`)));
check("publish.yml continua hospedado em Linux (proveniência do npm)", /runs-on: ubuntu-latest/.test(texto["publish.yml"]) && !/self-hosted/.test(semComentario(texto["publish.yml"])));

console.log("== detector: o que a regra pega ==");
{
  const ruim = "jobs:\n  a:\n    runs-on: windows-latest\n    steps:\n      - run: npm test\n";
  check("pega runner Windows e npm test sem a guarda do runner local", violacoes("x.yml", ruim).length === 2, violacoes("x.yml", ruim).join(" | "));
  const bom = `jobs:\n  a:\n    if: ${LOCAL}\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n`;
  check("aceita teste em job só do runner local", violacoes("x.yml", bom).length === 0);
  const hospedado = "jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run test:pages-live\n";
  check("pega teste ao vivo num job hospedado", violacoes("x.yml", hospedado).length === 1);
}

console.log(falhas ? `\n== ${falhas} FALHA(S) ==` : "\n== workflows hospedados: tudo OK ==");
process.exit(falhas ? 1 : 0);
