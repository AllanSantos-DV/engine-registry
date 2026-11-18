#!/usr/bin/env node
/**
 * Compara capturas PNG de duas pastas, par a par pelo nome do arquivo, pixel a pixel.
 *
 *   node tools/comparar-capturas.mjs <pasta-antes> <pasta-depois> [--canal 2] [--fracao 0.001]
 *
 * Um pixel difere quando algum canal RGB muda mais que `--canal` (de 255). A comparação passa quando a fração de pixels
 * diferentes fica abaixo de `--fracao` em todos os pares. Aceita PNG de 8 bits, RGB ou RGBA, sem entrelaçamento.
 * Sai com 1 quando algum par reprova, tem tamanho diferente ou falta na outra pasta.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

export const CANAL_PADRAO = 2;
export const FRACAO_PADRAO = 0.001;

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decodifica um PNG de 8 bits, RGB ou RGBA, sem entrelaçamento.
 * @param {Buffer} png
 * @returns {{largura: number, altura: number, canais: number, pixels: Buffer}}
 * @throws {Error} para qualquer outro formato.
 */
export function decodificarPng(png) {
  if (!png.subarray(0, 8).equals(ASSINATURA)) { throw new Error("não é um PNG"); }
  let cabecalho = null;
  const dados = [];
  for (let i = 8; i < png.length;) {
    const tamanho = png.readUInt32BE(i), tipo = png.toString("latin1", i + 4, i + 8);
    const corpo = png.subarray(i + 8, i + 8 + tamanho);
    if (tipo === "IHDR") { cabecalho = { largura: corpo.readUInt32BE(0), altura: corpo.readUInt32BE(4), profundidade: corpo[8], cor: corpo[9], entrelacado: corpo[12] }; }
    else if (tipo === "IDAT") { dados.push(corpo); }
    else if (tipo === "IEND") { break; }
    i += 12 + tamanho;
  }
  if (!cabecalho) { throw new Error("PNG sem IHDR"); }
  const { largura, altura, profundidade, cor, entrelacado } = cabecalho;
  if (profundidade !== 8 || (cor !== 2 && cor !== 6) || entrelacado) {
    throw new Error(`PNG não suportado (profundidade ${profundidade}, tipo de cor ${cor}, entrelaçado ${entrelacado}): só 8 bits RGB/RGBA sem entrelaçamento`);
  }
  const canais = cor === 2 ? 3 : 4, linha = largura * canais;
  const bruto = inflateSync(Buffer.concat(dados));
  if (bruto.length !== altura * (linha + 1)) { throw new Error("PNG com dados de tamanho inesperado"); }
  const pixels = Buffer.alloc(altura * linha);
  for (let y = 0; y < altura; y++) {
    const filtro = bruto[y * (linha + 1)], de = y * (linha + 1) + 1, para = y * linha;
    if (filtro > 4) { throw new Error(`filtro PNG ${filtro} inválido`); }
    for (let x = 0; x < linha; x++) {
      const a = x >= canais ? pixels[para + x - canais] : 0;
      const b = y > 0 ? pixels[para - linha + x] : 0;
      const c = x >= canais && y > 0 ? pixels[para - linha + x - canais] : 0;
      const v = bruto[de + x];
      pixels[para + x] = (filtro === 0 ? v : filtro === 1 ? v + a : filtro === 2 ? v + b : filtro === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255;
    }
  }
  return { largura, altura, canais, pixels };
}

/**
 * Compara dois PNG pixel a pixel.
 * @param {Buffer} antes
 * @param {Buffer} depois
 * @param {number} [canal] diferença máxima por canal (de 255) que ainda conta como igual.
 * @returns {{largura: number, altura: number, diferentes: number, total: number, fracao: number, maior: number}}
 * @throws {Error} quando as imagens têm tamanhos diferentes.
 */
export function compararPng(antes, depois, canal = CANAL_PADRAO) {
  const a = decodificarPng(antes), b = decodificarPng(depois);
  if (a.largura !== b.largura || a.altura !== b.altura) {
    throw new Error(`tamanhos diferentes: ${a.largura}x${a.altura} x ${b.largura}x${b.altura}`);
  }
  let diferentes = 0, maior = 0;
  for (let p = 0; p < a.largura * a.altura; p++) {
    let delta = 0;
    for (let k = 0; k < 3; k++) { delta = Math.max(delta, Math.abs(a.pixels[p * a.canais + k] - b.pixels[p * b.canais + k])); }
    maior = Math.max(maior, delta);
    if (delta > canal) { diferentes++; }
  }
  const total = a.largura * a.altura;
  return { largura: a.largura, altura: a.altura, diferentes, total, fracao: diferentes / total, maior };
}

function main() {
  const args = process.argv.slice(2);
  const opcao = (nome, padrao) => { const i = args.indexOf(nome); return i < 0 ? padrao : Number(args.splice(i, 2)[1]); };
  const canal = opcao("--canal", CANAL_PADRAO), limite = opcao("--fracao", FRACAO_PADRAO);
  const [antes, depois] = args;
  if (!antes || !depois) { console.error("uso: node tools/comparar-capturas.mjs <pasta-antes> <pasta-depois> [--canal 2] [--fracao 0.001]"); process.exit(2); }
  const nomes = readdirSync(antes).filter((n) => n.endsWith(".png")).sort();
  if (!nomes.length) { console.error(`nenhum PNG em ${antes}`); process.exit(2); }
  let reprovados = 0;
  console.log(`tolerância: canal > ${canal}/255 conta como diferente; passa com fração < ${(limite * 100).toFixed(3)}%`);
  for (const nome of nomes) {
    let linha;
    try {
      const r = compararPng(readFileSync(join(antes, nome)), readFileSync(join(depois, nome)), canal);
      const ok = r.fracao < limite;
      if (!ok) { reprovados++; }
      linha = `${ok ? "OK    " : "FALHA "}${nome} ${r.largura}x${r.altura}: ${r.diferentes}/${r.total} pixels diferentes (${(r.fracao * 100).toFixed(4)}%), maior diferença de canal ${r.maior}/255`;
    } catch (e) {
      reprovados++;
      linha = `FALHA ${nome}: ${e.message}`;
    }
    console.log(linha);
  }
  console.log(reprovados ? `${reprovados} par(es) reprovado(s)` : "veredito: dentro da tolerância");
  process.exit(reprovados ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) { main(); }
