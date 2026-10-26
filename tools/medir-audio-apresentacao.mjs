// medir-audio-apresentacao.mjs — mede o áudio gerado em site/media/narracao/: por fala, duração, silêncio no começo e no fim,
// maior pausa interna, e se o texto transcrito pelo próprio motor (Whisper) cobre o texto narrado (prova de que não cortou).
// Por cena: soma da fala x duração da cena na página (fala + 0,4 s entre falas). Grava docs/research/2026-10-26-audio-apresentacao-medicao.json.
// Uso: node tools/medir-audio-apresentacao.mjs   (daemon do Vox no ar; ffmpeg/ffprobe no PATH)
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const REPO = join(import.meta.dirname, "..");
const DIR = join(REPO, "site", "media", "narracao");
const { VoxClient } = await import(pathToFileURL(resolve(process.env.VOX_SDK || join(REPO, "..", "vox-engine", "sdk", "node", "vox-sdk.mjs"))).href);
const js = readFileSync(join(REPO, "site", "assets", "site.js"), "utf8");
const CENAS = new Function(`${js.slice(js.indexOf("const CENAS"), js.indexOf("const $ ="))}; return CENAS;`)();

const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }));
const silencios = (f) => {   // ffmpeg escreve o silencedetect no stderr
  const r = spawnSync("ffmpeg", ["-v", "info", "-i", f, "-af", "silencedetect=noise=-40dB:d=0.25", "-f", "null", "-"], { encoding: "utf8" });
  const ini = [...r.stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]));
  const fim = [...r.stderr.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map((m) => ({ fim: Number(m[1]), d: Number(m[2]) }));
  return { ini, fim };
};
const norm = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

const client = await VoxClient.tryConnect();
if (!client) { throw new Error("daemon do Vox Engine fora do ar: a transcrição de conferência precisa dele"); }
const voz = JSON.parse(readFileSync(join(DIR, "narracao.voz.json"), "utf8"));
const falas = [], cenas = [];
for (const [i, cena] of CENAS.entries()) {
  let soma = 0;
  for (const [j, texto] of cena.partes.entries()) {
    const nome = `c${String(i + 1).padStart(2, "0")}-p${j + 1}.mp3`, f = join(DIR, nome);
    const d = dur(f), s = silencios(f);
    const comeco = s.ini.length && s.ini[0] <= 0.05 ? (s.fim[0]?.fim ?? 0) : 0;                        // silêncio antes da voz
    const ultimo = s.ini.length > s.fim.length ? d - s.ini[s.ini.length - 1] : 0;                        // silêncio até o fim
    const maiorPausa = Math.max(0, ...s.fim.map((x, k) => (k === 0 && comeco > 0 ? 0 : x.d)));
    const header = await client.transcribeFile(readFileSync(f), { lang: "pt", container: "mp3" });
    const ouvido = new Set(norm(header.text || "")), esperado = norm(texto);
    const cobertura = esperado.filter((w) => ouvido.has(w)).length / esperado.length;
    falas.push({ arquivo: nome, cena: i + 1, duracaoSeg: Number(d.toFixed(2)), silencioInicioSeg: Number(comeco.toFixed(2)), silencioFimSeg: Number(ultimo.toFixed(2)), maiorPausaSeg: Number(maiorPausa.toFixed(2)), coberturaTranscricao: Number(cobertura.toFixed(2)), ouvido: header.text });
    soma += d;
  }
  const naPagina = soma + 0.4 * (cena.partes.length - 1);
  cenas.push({ cena: i + 1, titulo: cena.t, falasSeg: Number(soma.toFixed(2)), cenaNaPaginaSeg: Number(naPagina.toFixed(2)), fracaoFalada: Number((soma / naPagina).toFixed(3)) });
}
client.close();
const resumo = {
  voz: voz.voz, padraoDoMotor: voz.padraoDoMotor, motor: voz.motor, falas: falas.length,
  totalSeg: Number(falas.reduce((s, f) => s + f.duracaoSeg, 0).toFixed(2)),
  maxSilencioInicioSeg: Math.max(...falas.map((f) => f.silencioInicioSeg)), maxSilencioFimSeg: Math.max(...falas.map((f) => f.silencioFimSeg)),
  maxPausaInternaSeg: Math.max(...falas.map((f) => f.maiorPausaSeg)), menorCoberturaTranscricao: Math.min(...falas.map((f) => f.coberturaTranscricao)),
};
writeFileSync(join(REPO, "docs", "research", "2026-10-26-audio-apresentacao-medicao.json"), JSON.stringify({ medidoEm: new Date().toISOString(), resumo, cenas, falas }, null, 2) + "\n");
console.log(JSON.stringify(resumo, null, 2));
for (const c of cenas) { console.log(`cena ${c.cena} ${c.titulo}: fala ${c.falasSeg}s / cena ${c.cenaNaPaginaSeg}s (${(c.fracaoFalada * 100).toFixed(0)}% falado)`); }
for (const f of falas) { console.log(`${f.arquivo} ${f.duracaoSeg}s ini ${f.silencioInicioSeg} fim ${f.silencioFimSeg} pausa ${f.maiorPausaSeg} cob ${f.coberturaTranscricao}`); }
