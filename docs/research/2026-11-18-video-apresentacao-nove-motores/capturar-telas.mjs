#!/usr/bin/env node
/* Fotografa o site REAL do engine-registry (leitura só: site/index.html) em 1280x720 para as cenas "tela" do Motion.
   Mesmo roteiro de captura de 2026-10-29-video-apresentacao-oito-motores/capturar-telas.mjs; só os caminhos são relativos a esta pasta.
   uso: node docs/research/2026-11-18-video-apresentacao-nove-motores/capturar-telas.mjs [index.html do site]
   precisa de ../visual (puppeteer-core e kit/lib/chrome.mjs), irmão do repositório. */
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url)), VISUAL = join(HERE, '..', '..', '..', '..', 'visual'), OUT = join(HERE, 'telas'); mkdirSync(OUT, { recursive: true });
const puppeteer = createRequire(pathToFileURL(VISUAL + '/').href)('puppeteer-core');
const { findChrome } = await import(pathToFileURL(join(VISUAL, 'kit', 'lib', 'chrome.mjs')).href);
const SITE = process.argv[2] || join(HERE, '..', '..', '..', 'site', 'index.html');
if(!existsSync(SITE)) throw new Error('site real não existe: ' + SITE);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TELAS = [{ nome: 'topo', y: 0 }, { nome: 'motores', ancora: '#motores' }, { nome: 'conexoes', ancora: '#conexoes' }, { nome: 'uso', ancora: '#uso' }, { nome: 'numeros', ancora: '#numeros' }];
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'new', args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb', '--mute-audio'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const erros = []; page.on('pageerror', e => erros.push(e.message));
  await page.goto(pathToFileURL(SITE).href, { waitUntil: 'load' }); await page.evaluate(() => { const v = document.querySelector('video'); if (v) { v.removeAttribute('poster'); v.removeAttribute('src'); v.querySelectorAll('source').forEach(s => s.remove()); v.load(); } }); await sleep(1500);
  console.log('ids da página: ' + (await page.evaluate(() => [...document.querySelectorAll('[id]')].map(e => e.id).join(' '))));
  for(const t of TELAS){
    const achou = await page.evaluate(t => { if(t.ancora){ const e = document.querySelector(t.ancora); if(!e) return false; e.scrollIntoView({ block: 'start' }); } else window.scrollTo(0, t.y || 0); return true; }, t);
    if(!achou) throw new Error(t.nome + ': âncora ' + t.ancora + ' não existe no site');
    await sleep(1200); await page.screenshot({ path: join(OUT, t.nome + '.png') }); console.log('OK  ' + t.nome + '.png');
  }
  if(erros.length) throw new Error('erro de JavaScript na página: ' + erros.join(' | '));
} finally { await browser.close(); }
