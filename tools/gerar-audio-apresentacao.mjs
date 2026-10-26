// gerar-audio-apresentacao.mjs — gera, pelo Vox Engine (voz PADRÃO do motor, sem escolher voz), um áudio por fala das
// cenas do modo Apresentar (site/assets/site.js) em site/media/narracao/cNN-pN.mp3 e o manifesto narracao.voz.json.
// Uso: node tools/gerar-audio-apresentacao.mjs   (o daemon do Vox precisa estar no ar; ffmpeg/ffprobe no PATH)
// O SDK do motor vem de ../vox-engine/sdk/node/vox-sdk.mjs (ou de VOX_SDK=<caminho>). Fail-loud: sem motor, sem voz padrão
// ou com voz diferente da padrão, não gera.
import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const REPO = join(import.meta.dirname, "..");
const SAIDA = join(REPO, "site", "media", "narracao");
const sdkPath = resolve(process.env.VOX_SDK || join(REPO, "..", "vox-engine", "sdk", "node", "vox-sdk.mjs"));
const { VoxClient } = await import(pathToFileURL(sdkPath).href);

const js = readFileSync(join(REPO, "site", "assets", "site.js"), "utf8");
const CENAS = new Function(`${js.slice(js.indexOf("const CENAS"), js.indexOf("const $ ="))}; return CENAS;`)();
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }));

const client = await VoxClient.tryConnect();
if (!client) { throw new Error("daemon do Vox Engine fora do ar: suba o motor e rode de novo (nada foi gerado)"); }
const info = await client.info();
const voz = info.default_voice;
if (!voz) { throw new Error("o motor não informou a voz padrão"); }
if (!(info.encode_formats || []).includes("mp3")) { throw new Error(`o motor não codifica mp3 (só ${(info.encode_formats || []).join(",")})`); }

rmSync(SAIDA, { recursive: true, force: true }); mkdirSync(SAIDA, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "vox-ap-"));
let falas = 0, total = 0;
for (const [i, cena] of CENAS.entries()) {
  for (const [j, texto] of cena.partes.entries()) {
    const { header, audio } = await client.tts(texto, { voice: voz, speed: 1, format: "mp3" });
    if (header?.event === "error" || header?.error) { throw new Error(`motor falhou em c${i + 1}-p${j + 1}: ${header.error || header.event}`); }
    if (header?.voice && header.voice !== voz) { throw new Error(`voz errada em c${i + 1}-p${j + 1}: padrão "${voz}", motor usou "${header.voice}"`); }
    const buf = Buffer.from(audio);
    if (!buf.length) { throw new Error(`áudio vazio em c${i + 1}-p${j + 1}`); }
    const nome = `c${String(i + 1).padStart(2, "0")}-p${j + 1}.mp3`, bruto = join(tmp, nome);
    writeFileSync(bruto, buf);
    // fala mono a 32 kbps: leve e sem perda de inteligibilidade (medida na entrega); toca em qualquer navegador
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", bruto, "-ac", "1", "-c:a", "libmp3lame", "-b:a", "32k", join(SAIDA, nome)]);
    total += dur(join(SAIDA, nome)); falas += 1;
    console.log(`OK ${nome}  ${dur(join(SAIDA, nome)).toFixed(2)} s`);
  }
}
client.close();
rmSync(tmp, { recursive: true, force: true });
writeFileSync(join(SAIDA, "narracao.voz.json"), JSON.stringify({
  origem: "vox-engine", voz, motor: info.version, padraoDoMotor: info.default_voice, pedidaPeloDono: false,
  formato: "mp3 32 kbps mono", falas, audioSeg: Number(total.toFixed(2)), geradoEm: new Date().toISOString(),
}, null, 2) + "\n");
console.log(`\n${falas} falas, ${total.toFixed(1)} s, voz ${voz}, motor ${info.version}; ${readdirSync(SAIDA).length} arquivos em ${SAIDA}`);
