// test-voz-padrao.mjs — a voz da narração é a que o Vox Engine reporta como padrão, nunca uma que o dono não pediu, e a
// página não fala com voz do navegador. Silencioso: lê os manifestos .voz.json e o código, não chama o motor.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(REPO, p), "utf8");
let falhas = 0;
const check = (nome, ok, detalhe = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "  OK  " : " FALHA"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
};

/** Motivo da reprovação do manifesto da voz, ou null. */
export function reprova(m) {
  if (m.origem !== "vox-engine") return `origem ${m.origem}`;
  if (!m.voz || !m.padraoDoMotor) return "sem voz ou sem padraoDoMotor";
  if (m.pedidaPeloDono === false && m.voz !== m.padraoDoMotor) return `voz ${m.voz} difere do padrão ${m.padraoDoMotor} sem pedido do dono`;
  if (!m.motor) return "sem a versão do motor";
  return null;
}

const base = { origem: "vox-engine", voz: "pt-BR-Chirp3-HD-Iapetus", padraoDoMotor: "pt-BR-Chirp3-HD-Iapetus", pedidaPeloDono: false, motor: "0.33.8" };
check("manifesto coerente passa", reprova(base) === null);
check("voz diferente do padrão sem pedido do dono reprova", reprova({ ...base, voz: "pt-BR-Chirp3-HD-Kore" }) !== null);
check("voz diferente do padrão com pedido do dono passa", reprova({ ...base, voz: "clone:allan", pedidaPeloDono: true }) === null);
check("origem que não é o Vox Engine reprova", reprova({ ...base, origem: "speechSynthesis" }) !== null);

for (const arquivo of ["site/media/apresentacao.voz.json", "site/media/narracao/narracao.voz.json"]) {
  const m = JSON.parse(read(arquivo));
  check(`${arquivo}: a voz é a padrão do motor, sem escolha da sessão`, reprova(m) === null && m.pedidaPeloDono === false, reprova(m) ?? `${m.voz}, motor ${m.motor}`);
}

const codigo = ["site/index.html", "site/assets/site.js"].map(read).join("\n");
check("a página não usa speechSynthesis nem SpeechSynthesisUtterance", !/speechSynthesis|SpeechSynthesisUtterance/.test(codigo));

const falasDoApresentar = [...read("site/assets/site.js").matchAll(/"([^"\n]{40,})"/g)].map((x) => x[1]);
const spec = JSON.parse(read("docs/research/2026-11-18-video-apresentacao-dez-motores/spec-motion.json"));
const falasDoVideo = (spec.cenas ?? []).map((c) => c.fala).filter(Boolean);
const proibidas = /(?<!\p{L})(fase|fases|revis[aã]o|revis[oõ]es|teste interno|testes internos|backlog|veredito|pull request|PR)(?!\p{L})/iu;
const todas = [...falasDoApresentar, ...falasDoVideo];
check("há falas para conferir", todas.length > 20, `falas: ${todas.length}`);
check("nenhuma fala fala de fase do projeto, revisão, teste interno, backlog ou veredito", todas.every((f) => !proibidas.test(f)), todas.find((f) => proibidas.test(f)));

console.log(falhas ? `\n== ${falhas} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(falhas ? 1 : 0);
