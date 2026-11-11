#!/usr/bin/env node
/* tests/test-publish-manifest.mjs — o publish leva a versão nova ao manifest e ao README da main sem passo manual, mescla
   a main na develop e não toca a cópia de trabalho local; falha antes do push não envia nada (remoto bare local).
     node tests/test-publish-manifest.mjs */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publishManifest } from '../tools/publish-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = 'client-harness';
const temps = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pubman-')); temps.push(d); return d; };

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
const identity = (cwd) => { git(cwd, 'config', 'user.name', 'teste'); git(cwd, 'config', 'user.email', 'teste@example.invalid'); };

function setup(developEdit = () => {}, mainEdit = () => {}) {
  const base = tmp();
  const remote = path.join(base, 'remote.git');
  git(base, 'init', '-q', '--bare', remote);
  const seed = path.join(base, 'seed');
  git(base, 'init', '-q', seed);
  identity(seed);
  fs.cpSync(path.join(ROOT, 'kit'), path.join(seed, 'kit'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'manifest.json'), path.join(seed, 'manifest.json'));
  fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(seed, 'README.md'));
  fs.copyFileSync(path.join(ROOT, 'schema.json'), path.join(seed, 'schema.json'));
  mainEdit(seed);
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'base');
  git(seed, 'push', '-q', remote, 'HEAD:refs/heads/main');
  fs.writeFileSync(path.join(seed, 'em-andamento.txt'), 'trabalho da develop');
  developEdit(seed);
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'develop à frente');
  git(seed, 'push', '-q', remote, 'HEAD:refs/heads/develop');
  const local = path.join(base, 'local');
  git(base, 'clone', '-q', remote, local);
  identity(local);
  fs.writeFileSync(path.join(local, 'manifest.json'), '{"sujo":true}');
  return { remote, local };
}
const remoteFile = (remote, ref, file) => git(remote, 'show', `${ref}:${file}`);
const versionAt = (remote, ref) => JSON.parse(remoteFile(remote, ref, 'manifest.json')).engines.find((e) => e.name === ENGINE).version;
const worktrees = (local) => git(local, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length;

let fails = 0;
const ok = (name, fn) => {
  try { fn(); console.log('OK   ' + name); } catch (e) { fails++; console.log('FAIL ' + name + ' — ' + e.message); }
};

ok('a main recebe manifest e README, a develop contém a main e a cópia local fica intacta', () => {
  const { remote, local } = setup();
  const verified = [];
  const r = publishManifest({ engine: ENGINE, version: '9.9.9', repoDir: local, verify: (m) => verified.push(m) });
  assert.equal(r.unchanged, false);
  assert.equal(verified.length, 1, 'a release é provada antes do push');
  assert.equal(versionAt(remote, 'main'), '9.9.9');
  assert.match(remoteFile(remote, 'main', 'README.md'), new RegExp('^\\| `' + ENGINE + '` \\| 9\\.9\\.9 \\|', 'm'));
  assert.equal(git(remote, 'rev-parse', 'main'), r.main);
  assert.equal(git(remote, 'rev-parse', 'develop'), r.develop);
  git(remote, 'merge-base', '--is-ancestor', 'main', 'develop');
  assert.equal(remoteFile(remote, 'develop', 'em-andamento.txt'), 'trabalho da develop');
  assert.equal(fs.readFileSync(path.join(local, 'manifest.json'), 'utf8'), '{"sujo":true}');
  assert.equal(worktrees(local), 1, 'worktrees temporários removidos');
  const again = publishManifest({ engine: ENGINE, version: '9.9.9', repoDir: local, verify: () => {} });
  assert.equal(again.unchanged, true, 'repetir a mesma versão não cria commit');
  assert.equal(git(remote, 'rev-parse', 'main'), r.main);
});

/** Troca `de` por `para` no arquivo do seed; falha se o trecho não existe (o teste deixaria de provar o conflito). */
const edit = (seed, file, de, para) => {
  const p = path.join(seed, file);
  const txt = fs.readFileSync(p, 'utf8');
  assert.ok(txt.includes(de), `${file} sem o trecho ${de}`);
  fs.writeFileSync(p, txt.replace(de, para));
};
const readmeLine = (txt, engine) => txt.split(/\r?\n/).find((l) => l.startsWith('| `' + engine + '` |'));

ok('develop com a linha vizinha do README mudada: a mescla não conflita e mantém as duas mudanças', () => {
  let neighbor;
  const { remote, local } = setup((seed) => {
    const lines = fs.readFileSync(path.join(seed, 'README.md'), 'utf8').split(/\r?\n/);
    const i = lines.findIndex((l) => l.startsWith('| `' + ENGINE + '` |'));
    neighbor = lines[i - 1].match(/^\| `([^`]+)`/)[1];
    edit(seed, 'README.md', lines[i - 1], lines[i - 1].replace(/^(\| `[^`]+` \| )[^ |]+/, '$17.7.7'));
  });
  const r = publishManifest({ engine: ENGINE, version: '9.9.9', repoDir: local, verify: () => {} });
  assert.equal(git(remote, 'rev-parse', 'develop'), r.develop);
  git(remote, 'merge-base', '--is-ancestor', 'main', 'develop');
  const readme = remoteFile(remote, 'develop', 'README.md');
  assert.match(readmeLine(readme, ENGINE), /\| 9\.9\.9 \|/, 'a mudança da main chega à develop');
  assert.match(readmeLine(readme, neighbor), /\| 7\.7\.7 \|/, 'a mudança da develop fica');
  assert.doesNotMatch(readme, /^(<{7}|>{7}|={7})/m);
  assert.equal(versionAt(remote, 'develop'), '9.9.9');
  assert.equal(worktrees(local), 1);
});

ok('develop com a mesma entrada do manifest mudada: a develop fica com a versão publicada e o resto dela', () => {
  const { remote, local } = setup((seed) => {
    const m = JSON.parse(fs.readFileSync(path.join(seed, 'manifest.json'), 'utf8'));
    const e = m.engines.find((x) => x.name === ENGINE);
    edit(seed, 'manifest.json', JSON.stringify(e.version), JSON.stringify('9.9.8'));
    edit(seed, 'manifest.json', JSON.stringify(e.summary), JSON.stringify('resumo da develop'));
  });
  const r = publishManifest({ engine: ENGINE, version: '9.9.9', repoDir: local, verify: () => {} });
  assert.equal(git(remote, 'rev-parse', 'develop'), r.develop);
  git(remote, 'merge-base', '--is-ancestor', 'main', 'develop');
  const dev = JSON.parse(remoteFile(remote, 'develop', 'manifest.json')).engines.find((e) => e.name === ENGINE);
  assert.equal(dev.version, '9.9.9');
  assert.equal(dev.summary, 'resumo da develop');
  assert.equal(worktrees(local), 1);
});

ok('release que não passa na prova não envia nada', () => {
  const { remote, local } = setup();
  const before = [git(remote, 'rev-parse', 'main'), git(remote, 'rev-parse', 'develop')];
  assert.throws(() => publishManifest({ engine: ENGINE, version: '9.9.9', repoDir: local, verify: () => { throw new Error('assinatura não confere'); } }),
    /assinatura não confere/);
  assert.deepEqual([git(remote, 'rev-parse', 'main'), git(remote, 'rev-parse', 'develop')], before);
  assert.equal(worktrees(local), 1);
});

ok('manifest da main fora do schema: nada é enviado e o erro diz o campo', () => {
  const { remote, local } = setup(() => {}, (seed) => {
    const m = JSON.parse(fs.readFileSync(path.join(seed, 'manifest.json'), 'utf8'));
    m.apps[0].checksun = 'campo com erro de digitação';
    fs.writeFileSync(path.join(seed, 'manifest.json'), JSON.stringify(m, null, 2));
  });
  const before = [git(remote, 'rev-parse', 'main'), git(remote, 'rev-parse', 'develop')];
  let verified = 0;
  assert.throws(() => publishManifest({ engine: ENGINE, version: '9.9.9', repoDir: local, verify: () => { verified++; } }), /fora do schema.*checksun/);
  assert.equal(verified, 0, 'o manifest inválido para antes da prova');
  assert.deepEqual([git(remote, 'rev-parse', 'main'), git(remote, 'rev-parse', 'develop')], before);
  assert.equal(worktrees(local), 1);
});

ok('motor desconhecido falha alto sem enviar nada', () => {
  const { remote, local } = setup();
  const before = git(remote, 'rev-parse', 'main');
  assert.throws(() => publishManifest({ engine: 'motor-inexistente', version: '1.0.0', repoDir: local, verify: () => {} }), /update-manifest/);
  assert.equal(git(remote, 'rev-parse', 'main'), before);
  assert.equal(worktrees(local), 1);
});

for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
if (fails) { console.log(`\n${fails} falha(s)`); process.exit(1); }
console.log('\ntest-publish-manifest: tudo verde');
