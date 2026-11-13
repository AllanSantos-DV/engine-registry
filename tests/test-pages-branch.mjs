#!/usr/bin/env node
/* tests/test-pages-branch.mjs — a publicação do Pages pela branch gh-pages falha alto em configuração inválida, o workflow
   não usa artefato do Actions, só roda por disparo manual e a conferência da página no ar lê a URL de verdade (servidor
   local; nada é publicado).
     node tests/test-pages-branch.mjs */
import "./_tmp.mjs";
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as pages from '../tools/pages-branch.mjs';
import * as video from '../tools/baixar-video.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const WORKFLOW = fs.readFileSync(path.join(WORKFLOWS, 'pages.yml'), 'utf8')
  .split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
const INDEX = '<html><link href="/engine-registry/_astro/a.css"><a href="/engine-registry/">x</a><img src="media/v.png"></html>';

const temps = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-smoke-')); temps.push(d); return d; };
function makeSite(html = INDEX) {
  const site = path.join(tmp(), 'public');
  fs.mkdirSync(path.join(site, 'media'), { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), html);
  fs.writeFileSync(path.join(site, 'media', '_x.bin'), 'x');
  return site;
}
function bareRemote() {
  const remote = path.join(tmp(), 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', remote], { windowsHide: true });
  return remote;
}
const gitOut = (remote, ...args) => spawnSync('git', ['--git-dir', remote, ...args], { encoding: 'utf8', windowsHide: true }).stdout.trim();
async function live(body, status = 200) {
  const server = http.createServer((_req, res) => { res.writeHead(status); res.end(body); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((resolve) => server.close(resolve)) };
}

let fails = 0;
const ok = async (name, fn) => {
  try { await fn(); console.log('OK   ' + name); } catch (e) { fails++; console.log('FAIL ' + name + ' — ' + e.message); }
};

await ok('workflow sem artefato do Actions', () => {
  for (const f of ['upload-pages-artifact', 'deploy-pages', 'configure-pages', 'pages: write', 'id-token']) {
    assert.ok(!WORKFLOW.includes(f), `${f}: a cota de artefatos da conta bloqueia esse caminho`);
  }
});
await ok('chave de deploy, sem GITHUB_TOKEN, com contents: read', () => {
  assert.ok(WORKFLOW.includes('secrets.PAGES_DEPLOY_KEY'));
  assert.ok(!WORKFLOW.includes('GITHUB_TOKEN'), 'push com GITHUB_TOKEN não dispara a publicação do Pages');
  assert.ok(WORKFLOW.includes('contents: read'));
});
await ok('só disparo manual: sem push nem cron publicando sozinhos', () => {
  assert.ok(WORKFLOW.includes('workflow_dispatch'));
  assert.ok(!/^\s*(push|schedule|pull_request):/m.test(WORKFLOW), 'a publicação é decisão explícita do dono');
});
await ok('runner Linux hospedado por padrão, local só com CI_RUNNER=local, sem Windows nem macOS', () => {
  const runsOn = WORKFLOW.split('\n').find((l) => l.includes('runs-on:')) ?? '';
  assert.ok(runsOn.includes('ubuntu-latest') && runsOn.includes("vars.CI_RUNNER == 'local'"));
  assert.ok(!/windows|macos|-eph/i.test(runsOn));
});
await ok('sem suíte no runner hospedado; ordem: site com mídia → publicar → verificar', () => {
  const at = (s) => WORKFLOW.indexOf(s);
  assert.ok(!/npm (run )?test\b/.test(WORKFLOW.replace(/#.*/g, '')), 'a suíte roda na checagem local, não no runner hospedado');
  assert.ok(at('baixar-video.mjs') > at('actions/checkout') && at('baixar-video.mjs') < at('test-site.mjs --require-media'), 'o vídeo é baixado antes de conferir o site e publicar');
  assert.ok(at('test-site.mjs --require-media') > 0 && at('test-site.mjs --require-media') < at('pages-branch.mjs publish')
    && at('pages-branch.mjs publish') < at('pages-branch.mjs verify'));
  assert.equal(WORKFLOW.split('secrets.PAGES_DEPLOY_KEY').length - 1, 1, 'a chave de deploy só entra no passo de publicar');
});
await ok('nenhum workflow do registry usa runner Windows/macOS nem roda a suíte no runner hospedado', () => {
  for (const file of fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
    const code = fs.readFileSync(path.join(WORKFLOWS, file), 'utf8').replace(/#.*/g, '');
    assert.ok(!/(runs-on|os)\s*:.*(windows|macos)/i.test(code), `${file}: runner Windows ou macOS`);
    assert.ok(!/npm (run )?test\s*$/m.test(code), `${file}: roda a suíte no runner hospedado`);
  }
});
await ok('publica commit órfão com .nojekyll e arquivos "_"', () => {
  const remote = bareRemote(); const site = makeSite();
  const sha = pages.publish(site, remote, 'gh-pages', 'p', '');
  assert.equal(gitOut(remote, 'rev-parse', 'gh-pages'), sha);
  assert.equal(gitOut(remote, 'rev-list', '--count', 'gh-pages'), '1');
  const tree = gitOut(remote, 'ls-tree', '-r', '--name-only', 'gh-pages').split('\n').sort();
  assert.deepEqual(tree, ['.nojekyll', 'index.html', 'media/_x.bin']);
  pages.publish(site, remote, 'gh-pages', 'p2', '');
  assert.equal(gitOut(remote, 'rev-list', '--count', 'gh-pages'), '1', 'segunda publicação refaz o commit órfão');
});
await ok('recusas explícitas: branch, site ausente, referência absoluta, ssh sem chave', () => {
  const remote = bareRemote();
  assert.throws(() => pages.publish(makeSite(), remote, 'main', 'p', ''), pages.PagesError);
  assert.throws(() => pages.publish(path.join(tmp(), 'nada'), remote, 'gh-pages', 'p', ''), /nada a publicar/);
  assert.throws(() => pages.publish(makeSite('<img src="/media/a.png">'), remote, 'gh-pages', 'p', ''), /absolutas/);
  assert.throws(() => pages.publish(makeSite('<a href="/engine-registryx/">'), remote, 'gh-pages', 'p', ''), /absolutas/);
  assert.throws(() => pages.publish(makeSite(), 'git@github.com:x/y.git', 'gh-pages', 'p', ''), /PAGES_DEPLOY_KEY/);
  assert.equal(gitOut(remote, 'branch', '--list'), '', 'nada foi publicado');
});
await ok('verify lê a URL pública', async () => {
  const site = makeSite();
  const good = await live(INDEX); const bad = await live('<html>outra</html>'); const down = await live('x', 500);
  try {
    await pages.verify(good.url, site, 1, 0, 'a');
    await assert.rejects(() => pages.verify(bad.url, site, 1, 0, 'a'), /não é o index\.html/);
    await assert.rejects(() => pages.verify(down.url, site, 1, 0, 'a'), /HTTP 500/);
  } finally { await Promise.all([good.close(), bad.close(), down.close()]); }
});
const sha = (b) => createHash('sha256').update(b).digest('hex');
const MP4 = Buffer.from('mp4-de-teste-com-alguns-bytes');
function siteComSidecar(hash = sha(MP4)) {
  const site = makeSite();
  fs.writeFileSync(path.join(site, 'media', 'apresentacao.mp4.sha256'), `${hash}  apresentacao.mp4\n`);
  return site;
}
async function asset(body, { status = 200, type = 'video/mp4' } = {}) {
  const server = http.createServer((_req, res) => { res.writeHead(status, { 'content-type': type }); res.end(body); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/asset.mp4`, base: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((resolve) => server.close(resolve)) };
}
await ok('baixar-video: sem o mp4 baixa do asset e deixa com o hash do .sha256 versionado', async () => {
  const site = siteComSidecar(); const a = await asset(MP4);
  try {
    const r = await video.fetchVideo(site, a.url);
    assert.equal(r.downloaded, true);
    assert.equal(sha(fs.readFileSync(path.join(site, 'media', 'apresentacao.mp4'))), sha(MP4));
  } finally { await a.close(); }
});
await ok('baixar-video: mp4 que já confere não é baixado de novo (asset fora do ar não atrapalha)', async () => {
  const site = siteComSidecar(); fs.writeFileSync(path.join(site, 'media', 'apresentacao.mp4'), MP4);
  const r = await video.fetchVideo(site, 'http://127.0.0.1:1/nada.mp4');
  assert.equal(r.downloaded, false);
});
await ok('baixar-video: recusa hash divergente, HTTP de erro e .sha256 ausente, sem deixar mp4 no site', async () => {
  const a = await asset(MP4); const falta = await asset('x', { status: 404 });
  try {
    const divergente = siteComSidecar(sha('outro'));
    await assert.rejects(() => video.fetchVideo(divergente, a.url), /difere do esperado/);
    assert.ok(!fs.existsSync(path.join(divergente, 'media', 'apresentacao.mp4')));
    await assert.rejects(() => video.fetchVideo(siteComSidecar(), falta.url), /HTTP 404/);
    await assert.rejects(() => video.fetchVideo(makeSite(), a.url), /sem o hash esperado/);
  } finally { await Promise.all([a.close(), falta.close()]); }
});
await ok('verify do vídeo no ar: 200 video/mp4 com os bytes do site; outro tipo ou outros bytes é recusado', async () => {
  const site = siteComSidecar(); fs.writeFileSync(path.join(site, 'media', 'apresentacao.mp4'), MP4);
  const bom = await asset(MP4); const tipo = await asset(MP4, { type: 'text/html' }); const outro = await asset(Buffer.from('outros-bytes'));
  try {
    const r = await pages.verifyVideo(bom.base, site, 's');
    assert.deepEqual([r.bytes, r.sha256, r.type], [MP4.length, sha(MP4), 'video/mp4']);
    await assert.rejects(() => pages.verifyVideo(tipo.base, site, 's'), /não video\/mp4/);
    await assert.rejects(() => pages.verifyVideo(outro.base, site, 's'), /não é o de site\/media/);
    assert.equal(await pages.verifyVideo(bom.base, makeSite(), 's'), null, 'sem mp4 no site, nada a conferir');
  } finally { await Promise.all([bom.close(), tipo.close(), outro.close()]); }
});
await ok('o script roda de verdade, também por uma junction (nunca sai mudo)', () => {
  const run = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true });
  const direct = run(path.join(ROOT, 'tools', 'pages-branch.mjs'), ['publish', '--branch', 'main', '--site', makeSite()]);
  assert.equal(direct.status, 1);
  assert.match(direct.stderr, /push forçado só na branch gh-pages/);
  const link = path.join(tmp(), 'tools-link');
  fs.symlinkSync(path.join(ROOT, 'tools'), link, 'junction');
  const viaLink = run(path.join(link, 'pages-branch.mjs'), ['publish', '--branch', 'main', '--site', makeSite()]);
  assert.equal(viaLink.status, 1, 'via junction o script saiu sem rodar: ' + viaLink.stdout + viaLink.stderr);
  assert.match(viaLink.stderr, /push forçado só na branch gh-pages/);
});
for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\nPAGES VERDE'); process.exitCode = fails ? 1 : 0;
