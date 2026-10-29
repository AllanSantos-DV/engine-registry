#!/usr/bin/env node
/* Fotografa o site REAL do engine-registry (leitura só: engine-registry/site/index.html) em 1280×720 para as cenas "tela" do Motion.
   uso: node specs/motion/engine-registry-apresentacao/capturar-telas.mjs [index.html do site] */
import { createRequire } from 'node:module'; const puppeteer = createRequire('file:///C:/Users/allan/Desktop/Projetos/visual/')('puppeteer-core');
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from 'file:///C:/Users/allan/Desktop/Projetos/visual/kit/lib/chrome.mjs';
const HERE = dirname(fileURLToPath(import.meta.url)), OUT = join(HERE, 'telas'); mkdirSync(OUT, { recursive: true });
const SITE = process.argv[2] || 'C:/Users/allan/Desktop/Projetos/engine-registry/site/index.html';
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
