#!/usr/bin/env node
/* tests/test-pages-branch.mjs — a publicação do Pages pela branch gh-pages falha alto em configuração inválida, leva o
   manifest.json e o schema.json da raiz junto com o site, o workflow não usa artefato do Actions, só roda por disparo manual ou
   por mudança do site, do manifest ou do schema na main e a conferência da página no ar lê a URL de verdade (servidor local; nada é publicado).
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
const WORKFLOW = fs.readFileSync(path.join(WORKFLOWS, 'pages.yml'), 'utf8').replace(/\r/g, '')
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
const MANIFEST = '{\n  "engines": [\n    { "name": "x", "version": "1.0.0", "kind": "cli", "summary": "Motor de teste.", "platforms": ["win32-x64"], "install": { "repo": "dono/repo", "tag": "x-v{version}" } }\n  ]\n}\n';
function makeManifest(text = MANIFEST) {
  const file = path.join(tmp(), 'manifest.json');
  fs.writeFileSync(file, text);
  return file;
}
function bareRemote() {
  const remote = path.join(tmp(), 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', remote], { windowsHide: true });
  return remote;
}
const gitOut = (remote, ...args) => spawnSync('git', ['--git-dir', remote, ...args], { encoding: 'utf8', windowsHide: true }).stdout.trim();
const gitBytes = (remote, ...args) => spawnSync('git', ['--git-dir', remote, ...args], { windowsHide: true }).stdout;
const SCHEMA = '{\n  "$id": "https://exemplo.test/schema.json",\n  "type": "object"\n}\n';
function makeSchema(text = SCHEMA) {
  const file = path.join(tmp(), 'schema.json');
  fs.writeFileSync(file, text);
  return file;
}
const SCHEMA_DA_RAIZ = fs.readFileSync(path.join(ROOT, 'schema.json'), 'utf8').replace(/\r\n/g, '\n');
async function live(index, { manifest = MANIFEST, manifestStatus = 200, schema = SCHEMA_DA_RAIZ, schemaStatus = 200, status = 200, engines = {} } = {}) {
  let geradas = new Map();
  try { geradas = pages.engineFiles(Buffer.from(manifest)); } catch { /* manifest que o teste serve quebrado */ }
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    const name = pathname.split('/').pop();
    const daPasta = pathname.includes('/engines/') ? (engines[name] ?? (geradas.has('engines/' + name) ? [200, geradas.get('engines/' + name)] : [404, 'nao achei'])) : null;
    const [code, body] = daPasta ?? (name === 'manifest.json' ? [manifestStatus, manifest] : name === 'schema.json' ? [schemaStatus, schema] : [status, index]);
    res.writeHead(code);
    res.end(body);
  });
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
const GATILHOS = WORKFLOW.match(/^on:\n((?:[ \t]+.*\n|\n)*)/m)?.[1] ?? '';
await ok('gatilhos: disparo manual e push na main só quando o site, o manifest.json ou o schema.json mudam; sem cron nem pull request', () => {
  assert.match(GATILHOS, /^ {2}workflow_dispatch:/m);
  assert.match(GATILHOS, /^ {2}push:\n {4}branches: \[main\]\n {4}paths: \['site\/\*\*', 'manifest\.json', 'schema\.json'\]\n/m);
  assert.ok(!/^ {2}(schedule|pull_request|pull_request_target|release):/m.test(GATILHOS), 'só o dono e a mudança do manifest na main publicam');
});
await ok('a publicação só roda a partir da main: o manifest publicado é o da main', () => {
  const passos = WORKFLOW.split('\n');
  const guarda = passos.findIndex((l) => l.includes("github.ref != 'refs/heads/main'"));
  assert.ok(guarda > 0, 'sem guarda de branch, um disparo manual na develop publicaria o manifest da develop');
  assert.match(passos.slice(guarda, guarda + 4).join('\n'), /exit 1/);
  assert.ok(guarda < passos.findIndex((l) => l.includes('tools/pages-branch.mjs publish')), 'a guarda vem antes de publicar');
});
await ok('só publica se a main não mudou site/, manifest.json nem schema.json depois do commit da execução: busca a main e confere no passo de publicar, antes do publish', () => {
  const linhas = WORKFLOW.split('\n');
  const busca = linhas.findIndex((l) => l.includes('git fetch') && l.includes('origin') && l.includes('refs/heads/main:refs/remotes/origin/main'));
  const confere = linhas.findIndex((l) => l.includes('git diff --quiet "$GITHUB_SHA" origin/main -- site manifest.json schema.json'));
  const publica = linhas.findIndex((l) => l.includes('tools/pages-branch.mjs publish'));
  assert.ok(!WORKFLOW.includes('ls-remote'), 'exigir que o commit seja a ponta da main falha o run do commit A quando a main avança para B sem tocar o site, e B não dispara run novo');
  assert.ok(busca > 0, 'sem buscar a main, a comparação usaria uma origin/main velha');
  assert.ok(confere > busca, 'a comparação vem depois de buscar a main');
  assert.ok(confere < publica, 'a comparação vem antes de publicar');
  assert.ok(!linhas.slice(busca, publica).some((l) => /^\s*- name:/.test(l)), 'a busca, a comparação e o publish são o mesmo passo');
  assert.match(linhas.slice(confere, publica).join('\n'), /a main mudou site\/, manifest\.json ou schema\.json depois do commit desta execução; dispare de novo[\s\S]*exit 1/);
  assert.match(fs.readFileSync(path.join(ROOT, 'docs', 'PAGES.md'), 'utf8'), /Environment[^\n]*main/, 'docs/PAGES.md diz que proteger a chave exige um Environment restrito à main');
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
await ok('publica commit órfão com .nojekyll, manifest.json, schema.json, engines/ e arquivos "_"', () => {
  const remote = bareRemote(); const site = makeSite(); const manifest = makeManifest();
  const sha = pages.publish(site, remote, 'gh-pages', 'p', '', manifest);
  assert.equal(gitOut(remote, 'rev-parse', 'gh-pages'), sha);
  assert.equal(gitOut(remote, 'rev-list', '--count', 'gh-pages'), '1');
  const tree = gitOut(remote, 'ls-tree', '-r', '--name-only', 'gh-pages').split('\n').sort();
  assert.deepEqual(tree, ['.nojekyll', 'engines/index.json', 'engines/x.json', 'index.html', 'manifest.json', 'media/_x.bin', 'schema.json']);
  pages.publish(site, remote, 'gh-pages', 'p2', '', manifest);
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
  const site = makeSite(); const manifest = makeManifest();
  const good = await live(INDEX); const bad = await live('<html>outra</html>'); const down = await live('x', { status: 500 });
  try {
    await pages.verify(good.url, site, 1, 0, 'a', manifest);
    await assert.rejects(() => pages.verify(bad.url, site, 1, 0, 'a', manifest), /não é o index\.html/);
    await assert.rejects(() => pages.verify(down.url, site, 1, 0, 'a', manifest), /HTTP 500/);
  } finally { await Promise.all([good.close(), bad.close(), down.close()]); }
});

const lerManifest = (remote) => gitBytes(remote, 'show', 'gh-pages:manifest.json');
await ok('a árvore publicada leva o manifest.json idêntico ao do commit, na raiz', () => {
  const remote = bareRemote(); const manifest = makeManifest();
  pages.publish(makeSite(), remote, 'gh-pages', 'p', '', manifest);
  assert.ok(lerManifest(remote).equals(fs.readFileSync(manifest)));
});
await ok('sem --manifest publica o manifest.json da raiz do repositório', () => {
  const remote = bareRemote();
  pages.publish(makeSite(), remote, 'gh-pages', 'p', '');
  const raiz = fs.readFileSync(path.join(ROOT, 'manifest.json')).toString('latin1').replace(/\r\n/g, '\n');
  assert.equal(lerManifest(remote).toString('latin1'), raiz);
});
await ok('o manifest da raiz prevalece sobre um manifest.json dentro da pasta do site', () => {
  const remote = bareRemote(); const site = makeSite();
  fs.writeFileSync(path.join(site, 'manifest.json'), '{"engines":[{"name":"velho"}]}');
  pages.publish(site, remote, 'gh-pages', 'p', '', makeManifest());
  assert.equal(lerManifest(remote).toString('utf8'), MANIFEST);
});
await ok('o manifest não mora em site/: vem da raiz', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'site', 'manifest.json')));
});
await ok('manifest com CRLF no checkout é publicado com LF', () => {
  const remote = bareRemote();
  pages.publish(makeSite(), remote, 'gh-pages', 'p', '', makeManifest(MANIFEST.replace(/\n/g, '\r\n')));
  const blob = lerManifest(remote);
  assert.ok(!blob.includes(0x0d), 'o blob publicado não pode ter CR');
  assert.equal(blob.toString('utf8'), MANIFEST);
});
await ok('manifest ausente recusa a publicação e não publica nada', () => {
  const remote = bareRemote();
  assert.throws(() => pages.publish(makeSite(), remote, 'gh-pages', 'p', '', path.join(tmp(), 'manifest.json')), (e) => e instanceof pages.PagesError && /manifest\.json/.test(e.message));
  assert.equal(gitOut(remote, 'branch', '--list'), '');
});
await ok('manifest que não é JSON válido recusa a publicação e não publica nada', () => {
  const remote = bareRemote();
  assert.throws(() => pages.publish(makeSite(), remote, 'gh-pages', 'p', '', makeManifest('{"engines": [')), (e) => e instanceof pages.PagesError && /não é JSON válido/.test(e.message));
  assert.equal(gitOut(remote, 'branch', '--list'), '');
});
await ok('a linha de comando recusa --manifest ausente com código 1 e a causa no erro padrão', () => {
  const remote = bareRemote();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'pages-branch.mjs'), 'publish', '--site', makeSite(), '--remote', remote, '--manifest', path.join(tmp(), 'nada.json')], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nada\.json/);
  assert.equal(gitOut(remote, 'branch', '--list'), '');
});
await ok('verify passa quando o manifest é servido igual, mesmo com CRLF no checkout local', async () => {
  const site = makeSite(); const server = await live(INDEX);
  try {
    await pages.verify(server.url, site, 1, 0, 'a', makeManifest());
    await pages.verify(server.url, site, 1, 0, 'a', makeManifest(MANIFEST.replace(/\n/g, '\r\n')));
  } finally { await server.close(); }
});
await ok('verify falha com a causa quando o manifest publicado dá 404', async () => {
  const server = await live(INDEX, { manifestStatus: 404 });
  try { await assert.rejects(() => pages.verify(server.url, makeSite(), 1, 0, 'a', makeManifest()), /manifest\.json.*HTTP 404/); } finally { await server.close(); }
});
await ok('verify falha quando o manifest publicado difere do da main', async () => {
  const server = await live(INDEX, { manifest: MANIFEST.replace('1.0.0', '9.9.9') });
  try { await assert.rejects(() => pages.verify(server.url, makeSite(), 1, 0, 'a', makeManifest()), /o manifest publicado difere do da main/); } finally { await server.close(); }
});
await ok('verify falha quando o manifest publicado não é JSON válido', async () => {
  const server = await live(INDEX, { manifest: '<html>404</html>' });
  try { await assert.rejects(() => pages.verify(server.url, makeSite(), 1, 0, 'a', makeManifest()), /manifest publicado não é JSON válido/); } finally { await server.close(); }
});
await ok('verify recusa antes de ler a URL se o manifest local falta', async () => {
  const server = await live(INDEX);
  try { await assert.rejects(() => pages.verify(server.url, makeSite(), 1, 0, 'a', path.join(tmp(), 'manifest.json')), /manifest\.json/); } finally { await server.close(); }
});
const lerSchema = (remote) => gitBytes(remote, 'show', 'gh-pages:schema.json');
await ok('a árvore publicada leva o schema.json idêntico ao informado, na raiz', () => {
  const remote = bareRemote(); const schema = makeSchema();
  pages.publish(makeSite(), remote, 'gh-pages', 'p', '', makeManifest(), schema);
  assert.ok(lerSchema(remote).equals(fs.readFileSync(schema)));
});
await ok('sem --schema publica o schema.json da raiz do repositório, com o $id intacto', () => {
  const remote = bareRemote();
  pages.publish(makeSite(), remote, 'gh-pages', 'p', '');
  assert.equal(lerSchema(remote).toString('utf8'), SCHEMA_DA_RAIZ);
  assert.match(SCHEMA_DA_RAIZ, /"\$id": "https:\/\/raw\.githubusercontent\.com\/AllanSantos-DV\/engine-registry\/main\/schema\.json"/);
});
await ok('o schema da raiz prevalece sobre um schema.json dentro da pasta do site', () => {
  const remote = bareRemote(); const site = makeSite();
  fs.writeFileSync(path.join(site, 'schema.json'), '{"velho":true}');
  pages.publish(site, remote, 'gh-pages', 'p', '', makeManifest(), makeSchema());
  assert.equal(lerSchema(remote).toString('utf8'), SCHEMA);
});
await ok('schema com CRLF no checkout é publicado com LF', () => {
  const remote = bareRemote();
  pages.publish(makeSite(), remote, 'gh-pages', 'p', '', makeManifest(), makeSchema(SCHEMA.replace(/\n/g, '\r\n')));
  const blob = lerSchema(remote);
  assert.ok(!blob.includes(0x0d), 'o blob publicado não pode ter CR');
  assert.equal(blob.toString('utf8'), SCHEMA);
});
await ok('schema ausente recusa a publicação e não publica nada', () => {
  const remote = bareRemote();
  assert.throws(() => pages.publish(makeSite(), remote, 'gh-pages', 'p', '', makeManifest(), path.join(tmp(), 'schema.json')), (e) => e instanceof pages.PagesError && /schema\.json/.test(e.message));
  assert.equal(gitOut(remote, 'branch', '--list'), '');
});
await ok('schema que não é JSON válido recusa a publicação e não publica nada', () => {
  const remote = bareRemote();
  assert.throws(() => pages.publish(makeSite(), remote, 'gh-pages', 'p', '', makeManifest(), makeSchema('{"type": ')), (e) => e instanceof pages.PagesError && /schema\.json.*não é JSON válido/.test(e.message));
  assert.equal(gitOut(remote, 'branch', '--list'), '');
});
await ok('a linha de comando publica o --schema informado na raiz', () => {
  const remote = bareRemote();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'pages-branch.mjs'), 'publish', '--site', makeSite(), '--remote', remote, '--schema', makeSchema()], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(lerSchema(remote).toString('utf8'), SCHEMA);
});
await ok('a linha de comando recusa --schema ausente com código 1 e a causa no erro padrão', () => {
  const remote = bareRemote();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'pages-branch.mjs'), 'publish', '--site', makeSite(), '--remote', remote, '--schema', path.join(tmp(), 'nada-schema.json')], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nada-schema\.json/);
  assert.equal(gitOut(remote, 'branch', '--list'), '');
});
await ok('verify passa quando o schema é servido igual, mesmo com CRLF no checkout local', async () => {
  const site = makeSite(); const server = await live(INDEX, { schema: SCHEMA });
  try {
    await pages.verify(server.url, site, 1, 0, 'a', makeManifest(), makeSchema());
    await pages.verify(server.url, site, 1, 0, 'a', makeManifest(), makeSchema(SCHEMA.replace(/\n/g, '\r\n')));
  } finally { await server.close(); }
});
await ok('verify falha com a causa quando o schema publicado dá 404', async () => {
  const server = await live(INDEX, { schema: SCHEMA, schemaStatus: 404 });
  try { await assert.rejects(() => pages.verify(server.url, makeSite(), 1, 0, 'a', makeManifest(), makeSchema()), /schema\.json.*HTTP 404/); } finally { await server.close(); }
});
await ok('verify falha quando o schema publicado difere do local', async () => {
  const server = await live(INDEX, { schema: SCHEMA.replace('object', 'array') });
  try { await assert.rejects(() => pages.verify(server.url, makeSite(), 1, 0, 'a', makeManifest(), makeSchema()), /o schema publicado difere do local/); } finally { await server.close(); }
});
await ok('verify falha quando o schema publicado não é JSON válido', async () => {
  const server = await live(INDEX, { schema: '<html>404</html>' });
  try { await assert.rejects(() => pages.verify(server.url, makeSite(), 1, 0, 'a', makeManifest(), makeSchema()), /schema publicado não é JSON válido/); } finally { await server.close(); }
});
await ok('verify recusa antes de ler a URL se o schema local falta', async () => {
  const server = await live(INDEX);
  try { await assert.rejects(() => pages.verify(server.url, makeSite(), 1, 0, 'a', makeManifest(), path.join(tmp(), 'schema.json')), /schema\.json/); } finally { await server.close(); }
});
const ENGINE_X = '{\n  "name": "x",\n  "version": "1.0.0",\n  "kind": "cli",\n  "summary": "Motor de teste.",\n  "platforms": [\n    "win32-x64"\n  ],\n  "release": "https://github.com/dono/repo/releases/tag/x-v1.0.0"\n}\n';
const INDEX_X = '{\n  "entries": [\n    {\n      "name": "x",\n      "version": "1.0.0"\n    }\n  ]\n}\n';
const MANIFEST_COM_APP = JSON.stringify({
  engines: [{ name: 'x', version: '1.0.0', kind: 'cli', summary: 'Motor de teste.', platforms: ['win32-x64'], home: '~/.x', install: { repo: 'dono/repo', tag: 'x-v{version}', publicKey: 'abc' } }],
  apps: [{ name: 'app-y', version: '2.1.0', summary: 'App de teste.', homepage: 'https://exemplo.test/', release: { repo: 'dono/apps', tag: 'app-y-v{version}', assets: [] } }],
}, null, 2) + '\n';
const lerEngine = (remote, nome) => gitBytes(remote, 'show', 'gh-pages:engines/' + nome + '.json');
const arvore = (remote) => gitOut(remote, 'ls-tree', '-r', '--name-only', 'gh-pages').split('\n').sort();
const semEntradas = ['{"engines":[]}', '{}', '{"engines":[],"apps":[]}'];
const PESSOAL = /[A-Za-z]:[\\/]+Users|\/Users\/|\/home\/\w|[\w.+-]+@[\w-]+\.[a-z]{2,}|%USERPROFILE%|%LOCALAPPDATA%|~\/\./i;

await ok('a árvore publicada leva engines/<nome>.json de cada motor e app do manifest e engines/index.json, fora de site/', () => {
  const remote = bareRemote();
  pages.publish(makeSite(), remote, 'gh-pages', 'p', '', makeManifest(MANIFEST_COM_APP));
  assert.deepEqual(arvore(remote), ['.nojekyll', 'engines/app-y.json', 'engines/index.json', 'engines/x.json', 'index.html', 'manifest.json', 'media/_x.bin', 'schema.json']);
  assert.equal(lerEngine(remote, 'x').toString('utf8'), ENGINE_X);
  assert.equal(lerEngine(remote, 'app-y').toString('utf8'),
    '{\n  "name": "app-y",\n  "version": "2.1.0",\n  "kind": "app",\n  "summary": "App de teste.",\n  "platforms": [],\n  "release": "https://github.com/dono/apps/releases/tag/app-y-v2.1.0"\n}\n');
  assert.equal(lerEngine(remote, 'index').toString('utf8'),
    '{\n  "entries": [\n    {\n      "name": "x",\n      "version": "1.0.0"\n    },\n    {\n      "name": "app-y",\n      "version": "2.1.0"\n    }\n  ]\n}\n');
  assert.ok(!fs.existsSync(path.join(ROOT, 'site', 'engines')), 'os pontos de leitura vêm do manifest da raiz, não de site/');
});
await ok('os pontos de leitura do manifest da raiz são só de produto: chaves fixas, valores do manifest e nada de usuário, e-mail ou máquina', () => {
  const remote = bareRemote();
  pages.publish(makeSite(), remote, 'gh-pages', 'p', '');
  const raiz = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const entradas = [...raiz.engines, ...raiz.apps];
  const nomes = arvore(remote).filter((f) => f.startsWith('engines/') && f !== 'engines/index.json');
  assert.deepEqual(nomes, entradas.map((e) => 'engines/' + e.name + '.json').sort());
  for (const e of entradas) {
    const texto = lerEngine(remote, e.name).toString('utf8');
    const j = JSON.parse(texto);
    assert.deepEqual(Object.keys(j), ['name', 'version', 'kind', 'summary', 'platforms', 'release'], e.name);
    assert.deepEqual([j.name, j.version, j.kind, j.summary, j.platforms], [e.name, e.version, e.kind ?? 'app', e.summary, e.platforms ?? []], e.name);
    const dono = e.install?.repo ?? e.release.repo;
    assert.equal(j.release, 'https://github.com/' + dono + '/releases/tag/' + (e.install?.tag ?? e.release.tag).replace('{version}', e.version), e.name);
    assert.doesNotMatch(texto, PESSOAL, e.name + ' leva dado pessoal ou de máquina');
    assert.ok(texto.endsWith('}\n') && !texto.includes('\r'), e.name + ': LF e newline final');
  }
  const indice = lerEngine(remote, 'index').toString('utf8');
  assert.deepEqual(JSON.parse(indice).entries, entradas.map((e) => ({ name: e.name, version: e.version })));
  assert.doesNotMatch(indice, PESSOAL);
});
await ok('gera igual e estável: mesma entrada, mesmos bytes (chaves em ordem fixa, LF), venha o manifest com CRLF ou com as chaves em outra ordem', () => {
  const a = pages.engineFiles(Buffer.from(MANIFEST_COM_APP)); const b = pages.engineFiles(Buffer.from(MANIFEST_COM_APP));
  assert.deepEqual([...a.keys()], [...b.keys()]);
  for (const [nome, bytes] of a) { assert.ok(bytes.equals(b.get(nome)), nome); }
  const embaralhado = JSON.parse(MANIFEST_COM_APP);
  embaralhado.engines[0] = Object.fromEntries(Object.entries(embaralhado.engines[0]).reverse());
  const c = pages.engineFiles(Buffer.from(JSON.stringify(embaralhado)));
  for (const [nome, bytes] of a) { assert.ok(bytes.equals(c.get(nome)), nome + ' mudou com a ordem das chaves do manifest'); }
  const remote1 = bareRemote(); const remote2 = bareRemote();
  pages.publish(makeSite(), remote1, 'gh-pages', 'p', '', makeManifest(MANIFEST_COM_APP));
  pages.publish(makeSite(), remote2, 'gh-pages', 'p', '', makeManifest(MANIFEST_COM_APP.replace(/\n/g, '\r\n')));
  for (const nome of ['x', 'app-y', 'index']) { assert.ok(lerEngine(remote1, nome).equals(lerEngine(remote2, nome)), nome); }
  assert.equal(lerEngine(remote1, 'x').toString('utf8'), ENGINE_X);
});
await ok('manifest sem entradas não gera arquivo nem a pasta engines/', () => {
  for (const texto of semEntradas) {
    const remote = bareRemote();
    pages.publish(makeSite(), remote, 'gh-pages', 'p', '', makeManifest(texto));
    assert.deepEqual(arvore(remote), ['.nojekyll', 'index.html', 'manifest.json', 'media/_x.bin', 'schema.json'], texto);
    assert.equal(pages.engineFiles(Buffer.from(texto)).size, 0, texto);
  }
});
await ok('nome de motor ou app fora de [a-z0-9._-] recusa a publicação e não publica nada', () => {
  const ruins = ['Maiusculo', 'com espaço', 'a/b', 'a\\b', '..', '.', '.oculto', 'acentuação', 'x?y', ''];
  for (const nome of ruins) {
    for (const lista of ['engines', 'apps']) {
      const texto = JSON.stringify({ [lista]: [{ name: nome, version: '1.0.0', install: { repo: 'a/b', tag: 't-v{version}' }, release: { repo: 'a/b', tag: 't-v{version}' } }] });
      const remote = bareRemote();
      assert.throws(() => pages.publish(makeSite(), remote, 'gh-pages', 'p', '', makeManifest(texto)), (e) => e instanceof pages.PagesError && /nome/.test(e.message) && e.message.includes(JSON.stringify(nome)), JSON.stringify(nome) + ' em ' + lista);
      assert.equal(gitOut(remote, 'branch', '--list'), '', 'nada foi publicado com ' + JSON.stringify(nome));
    }
  }
});
await ok('nome repetido entre motor e app, nome "index" e release sem tag resolvida recusam a publicação', () => {
  const entrada = (name, extra = {}) => ({ name, version: '1.0.0', kind: 'cli', summary: 's', install: { repo: 'a/b', tag: 't-v{version}' }, ...extra });
  const casos = [
    [{ engines: [entrada('x')], apps: [{ name: 'x', version: '1', summary: 's', release: { repo: 'a/b', tag: 'x-v{version}' } }] }, /repetido/],
    [{ engines: [entrada('index')] }, /index/],
    [{ engines: [entrada('x', { install: { repo: 'a/b' } })] }, /release/],
    [{ engines: [entrada('x', { install: { repo: 'a/b', tag: 'x-v{versao}' } })] }, /release/],
    [{ engines: [entrada('x', { version: undefined })] }, /version/],
  ];
  for (const [manifest, razao] of casos) {
    const remote = bareRemote();
    assert.throws(() => pages.publish(makeSite(), remote, 'gh-pages', 'p', '', makeManifest(JSON.stringify(manifest))), (e) => e instanceof pages.PagesError && razao.test(e.message), JSON.stringify(manifest));
    assert.equal(gitOut(remote, 'branch', '--list'), '');
  }
});
await ok('verify confere cada engines/<nome>.json e o engines/index.json: passa quando iguais aos gerados do manifest local, mesmo com CRLF', async () => {
  const site = makeSite(); const server = await live(INDEX, { manifest: MANIFEST_COM_APP });
  try {
    await pages.verify(server.url, site, 1, 0, 'a', makeManifest(MANIFEST_COM_APP));
    await pages.verify(server.url, site, 1, 0, 'a', makeManifest(MANIFEST_COM_APP.replace(/\n/g, '\r\n')));
  } finally { await server.close(); }
});
await ok('verify falha com a causa quando um engines/<nome>.json publicado dá 404', async () => {
  const server = await live(INDEX, { manifest: MANIFEST_COM_APP, engines: { 'app-y.json': [404, 'nao achei'] } });
  try { await assert.rejects(() => pages.verify(server.url, makeSite(), 1, 0, 'a', makeManifest(MANIFEST_COM_APP)), /engines\/app-y\.json.*HTTP 404/); } finally { await server.close(); }
});
await ok('verify falha quando um engines/<nome>.json publicado difere do gerado do manifest local', async () => {
  const server = await live(INDEX, { manifest: MANIFEST_COM_APP, engines: { 'x.json': [200, ENGINE_X.replace('1.0.0', '9.9.9')] } });
  try { await assert.rejects(() => pages.verify(server.url, makeSite(), 1, 0, 'a', makeManifest(MANIFEST_COM_APP)), /o engines\/x\.json publicado difere do gerado do manifest/); } finally { await server.close(); }
});
await ok('verify falha quando um engines/<nome>.json publicado não é JSON válido', async () => {
  const server = await live(INDEX, { manifest: MANIFEST_COM_APP, engines: { 'x.json': [200, '<html>404</html>'] } });
  try { await assert.rejects(() => pages.verify(server.url, makeSite(), 1, 0, 'a', makeManifest(MANIFEST_COM_APP)), /engines\/x\.json publicado não é JSON válido/); } finally { await server.close(); }
});
await ok('verify falha quando o engines/index.json publicado dá 404 ou difere', async () => {
  const falta = await live(INDEX, { manifest: MANIFEST_COM_APP, engines: { 'index.json': [404, 'x'] } });
  const outro = await live(INDEX, { manifest: MANIFEST_COM_APP, engines: { 'index.json': [200, INDEX_X] } });
  try {
    await assert.rejects(() => pages.verify(falta.url, makeSite(), 1, 0, 'a', makeManifest(MANIFEST_COM_APP)), /engines\/index\.json.*HTTP 404/);
    await assert.rejects(() => pages.verify(outro.url, makeSite(), 1, 0, 'a', makeManifest(MANIFEST_COM_APP)), /o engines\/index\.json publicado difere/);
  } finally { await Promise.all([falta.close(), outro.close()]); }
});
await ok('verify de manifest sem entradas não lê engines/ (nada foi publicado ali)', async () => {
  const server = await live(INDEX, { manifest: '{"engines":[]}', engines: { 'index.json': [404, 'x'] } });
  try { await pages.verify(server.url, makeSite(), 1, 0, 'a', makeManifest('{"engines":[]}')); } finally { await server.close(); }
});
await ok('docs/PAGES.md documenta os pontos de leitura por motor e o workflow segue disparando só pelo manifest da raiz', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'PAGES.md'), 'utf8');
  assert.match(doc, /engines\/<nome>\.json/);
  assert.match(doc, /engines\/index\.json/);
  assert.match(GATILHOS, /paths: \['site\/\*\*', 'manifest\.json', 'schema\.json'\]/);
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
