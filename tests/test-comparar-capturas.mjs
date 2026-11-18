// test-comparar-capturas.mjs — o comparador de capturas (tools/comparar-capturas.mjs) conta só o que passa da tolerância de canal,
// lê PNG com os filtros de linha e recusa o que não sabe comparar.
//
// Sem navegador nem rede: os PNG são gerados aqui com zlib.
//
//   node tests/test-comparar-capturas.mjs
import "./_tmp.mjs";
import { deflateSync } from "node:zlib";
import { compararPng, decodificarPng } from "../tools/comparar-capturas.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) { c = CRC[(c ^ x) & 255] ^ (c >>> 8); } return (c ^ 0xffffffff) >>> 0; };
const bloco = (tipo, corpo) => {
  const fora = Buffer.alloc(12 + corpo.length);
  fora.writeUInt32BE(corpo.length, 0); fora.write(tipo, 4, "latin1"); corpo.copy(fora, 8);
  fora.writeUInt32BE(crc32(fora.subarray(4, 8 + corpo.length)), 8 + corpo.length);
  return fora;
};

/** PNG RGB de 8 bits; `filtro` 0 (nenhum), 1 (sub) ou 2 (up) aplicado a todas as linhas. */
function png(largura, altura, pixel, { filtro = 0, cor = 2, profundidade = 8 } = {}) {
  const canais = cor === 6 ? 4 : 3, linha = largura * canais;
  const cru = Buffer.alloc(altura * linha);
  for (let y = 0; y < altura; y++) for (let x = 0; x < largura; x++) { pixel(x, y).forEach((v, k) => { cru[y * linha + x * canais + k] = v; }); }
  const filtrado = Buffer.alloc(altura * (linha + 1));
  for (let y = 0; y < altura; y++) {
    filtrado[y * (linha + 1)] = filtro;
    for (let x = 0; x < linha; x++) {
      const a = x >= canais ? cru[y * linha + x - canais] : 0, b = y > 0 ? cru[(y - 1) * linha + x] : 0;
      filtrado[y * (linha + 1) + 1 + x] = (cru[y * linha + x] - (filtro === 1 ? a : filtro === 2 ? b : 0)) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4); ihdr[8] = profundidade; ihdr[9] = cor;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloco("IHDR", ihdr), bloco("IDAT", deflateSync(filtrado)), bloco("IEND", Buffer.alloc(0))]);
}

const fundo = (x, y) => [(x * 7) & 255, (y * 5) & 255, (x + y) & 255];
const com = (px, py, delta) => (x, y) => (x === px && y === py ? fundo(x, y).map((v) => (v + delta) & 255) : fundo(x, y));

console.log("== comparador de capturas ==\n");

for (const filtro of [0, 1, 2]) {
  const lido = decodificarPng(png(6, 4, fundo, { filtro }));
  const igual = lido.largura === 6 && lido.altura === 4 && lido.canais === 3 && lido.pixels[(2 * 6 + 3) * 3 + 1] === fundo(3, 2)[1];
  check(`decodifica PNG com filtro de linha ${filtro}`, igual);
}
check("decodifica PNG RGBA", decodificarPng(png(3, 3, (x, y) => [...fundo(x, y), 255], { cor: 6 })).canais === 4);

const base = png(10, 10, fundo);
const r0 = compararPng(base, png(10, 10, fundo));
check("imagens iguais: nenhum pixel diferente", r0.diferentes === 0 && r0.fracao === 0 && r0.maior === 0, JSON.stringify(r0));

const r2 = compararPng(base, png(10, 10, com(4, 4, 2)));
check("diferença de 2/255 num canal fica dentro da tolerância", r2.diferentes === 0 && r2.maior === 2, JSON.stringify(r2));

const r3 = compararPng(base, png(10, 10, com(4, 4, 3)));
check("diferença de 3/255 conta como pixel diferente", r3.diferentes === 1 && r3.fracao === 0.01 && r3.maior === 3, JSON.stringify(r3));

const rTol = compararPng(base, png(10, 10, com(4, 4, 3)), 3);
check("a tolerância de canal é ajustável", rTol.diferentes === 0, JSON.stringify(rTol));

const erro = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
check("tamanhos diferentes falham alto", /tamanhos diferentes/.test(erro(() => compararPng(base, png(10, 11, fundo))) ?? ""));
check("PNG de outro formato falha alto", /não suportado/.test(erro(() => decodificarPng(png(4, 4, fundo, { cor: 0 }))) ?? ""));
check("arquivo que não é PNG falha alto", /não é um PNG/.test(erro(() => decodificarPng(Buffer.from("texto"))) ?? ""));

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
