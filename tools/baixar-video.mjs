#!/usr/bin/env node
// Baixa o vídeo da apresentação do asset da release `site-media` para site/media/apresentacao.mp4 antes da publicação do
// Pages: o mp4 não mora no git (site/media/*.mp4 está no .gitignore), mas o site publicado serve `media/apresentacao.mp4`.
//
//   node tools/baixar-video.mjs [--site <pasta>] [--url <asset>]
//
// O hash esperado vem de site/media/apresentacao.mp4.sha256, versionado: o que não confere com ele não entra no site.
// Anexar uma versão nova: `gh release upload site-media site/media/apresentacao.mp4 --clobber` e atualizar o .sha256 no commit.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_ASSET = 'https://github.com/AllanSantos-DV/engine-registry/releases/download/site-media/apresentacao.mp4';
export const VIDEO = 'media/apresentacao.mp4';

export class VideoError extends Error {}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** Hash esperado do vídeo, do `.sha256` versionado ao lado dele. */
export function expectedHash(site) {
  const file = path.join(site, `${VIDEO}.sha256`);
  if (!fs.existsSync(file)) { throw new VideoError(`${file} não existe: sem o hash esperado não baixo o vídeo`); }
  const hash = fs.readFileSync(file, 'utf8').trim().split(/\s+/)[0].toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) { throw new VideoError(`${file} não traz um sha256 de 64 dígitos hexadecimais`); }
  return hash;
}

/**
 * Deixa site/media/apresentacao.mp4 com o hash esperado: reaproveita o arquivo se já confere, senão baixa do asset e confere.
 * @returns {Promise<{path:string, bytes:number, sha256:string, downloaded:boolean}>}
 */
export async function fetchVideo(site, url = DEFAULT_ASSET, get = fetch) {
  const want = expectedHash(site);
  const dest = path.join(site, VIDEO);
  if (fs.existsSync(dest)) {
    const have = fs.readFileSync(dest);
    if (sha256(have) === want) { return { path: dest, bytes: have.length, sha256: want, downloaded: false }; }
  }
  let res;
  try { res = await get(url, { signal: AbortSignal.timeout(180000) }); }
  catch (e) { throw new VideoError(`o asset ${url} não baixou: ${e.cause?.message || e.message}`); }
  if (!res.ok) { throw new VideoError(`o asset ${url} respondeu HTTP ${res.status}: a release site-media não tem o vídeo`); }
  const body = Buffer.from(await res.arrayBuffer());
  const got = sha256(body);
  if (got !== want) { throw new VideoError(`sha256 do vídeo baixado (${got.slice(0, 12)}…) difere do esperado em ${VIDEO}.sha256 (${want.slice(0, 12)}…)`); }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body);
  return { path: dest, bytes: body.length, sha256: got, downloaded: true };
}

/** CLI: baixa e confere o vídeo; devolve o código de saída (0 confere, 1 falha com a causa em stderr). */
export async function main(argv) {
  const opt = (flag) => { const k = argv.indexOf(flag); return k === -1 ? undefined : argv[k + 1]; };
  try {
    const r = await fetchVideo(opt('--site') ?? path.join(ROOT, 'site'), opt('--url') ?? DEFAULT_ASSET);
    console.log(`${r.downloaded ? 'baixado' : 'já presente'}: ${r.path} (${r.bytes} B, sha256 ${r.sha256})`);
    return 0;
  } catch (error) {
    if (!(error instanceof VideoError)) { throw error; }
    console.error(`::error::${error.message}`);
    return 1;
  }
}

const real = (file) => fs.realpathSync.native(file);
if (process.argv[1] && real(fileURLToPath(import.meta.url)) === real(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
