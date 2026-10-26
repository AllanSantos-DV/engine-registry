#!/usr/bin/env node
/* tests/test-pages-branch.mjs — a publicação do Pages pela branch gh-pages falha alto em configuração inválida, o workflow
   não usa artefato do Actions, só roda por disparo manual e a conferência da página no ar lê a URL de verdade (servidor
   local; nada é publicado).
     node tests/test-pages-branch.mjs */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as pages from '../tools/pages-branch.mjs';

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
await ok('runner Windows (o push por ssh exige o cliente ssh)', () => {
  const runsOn = WORKFLOW.split('\n').find((l) => l.includes('runs-on:')) ?? '';
  assert.ok(runsOn.includes('"Windows"') && runsOn.includes('windows-latest'));
  assert.ok(!/ubuntu|Linux|-eph/.test(runsOn));
});
await ok('ordem: npm test → site com mídia → publicar → verificar', () => {
  const at = (s) => WORKFLOW.indexOf(s);
  assert.ok(at('npm test') > 0 && at('npm test') < at('test-site.mjs --require-media') && at('test-site.mjs --require-media') < at('pages-branch.mjs publish')
    && at('pages-branch.mjs publish') < at('pages-branch.mjs verify'));
  assert.equal(WORKFLOW.split('secrets.PAGES_DEPLOY_KEY').length - 1, 1, 'a chave de deploy só entra no passo de publicar');
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
