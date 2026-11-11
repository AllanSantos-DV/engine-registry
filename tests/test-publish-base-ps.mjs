#!/usr/bin/env node
/* tests/test-publish-base-ps.mjs — o kit/publish-base.ps1 roda igual no Windows PowerShell 5.1 e no pwsh 7: consultar uma
   release que ainda não existe (gh com stderr e saída 1) segue para a criação, e uma release que já existe aborta sem criar.
   Usa um gh falso no PATH; nada vai à rede e nenhuma chave real é lida.
     node tests/test-publish-base-ps.mjs */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateKeyPairHex } from '../kit/signature.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'kit', 'publish-base.ps1');

if (process.platform !== 'win32') {
  console.log('test-publish-base-ps: o script é do Windows; nada a provar nesta plataforma');
  process.exit(0);
}

const temps = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pubbase-')); temps.push(d); return d; };

const fakeDir = tmp();
fs.writeFileSync(path.join(fakeDir, 'gh.cmd'), [
  '@echo off',
  'if "%1"=="api" (echo test-owner& exit /b 0)',
  'if "%1"=="release" if "%2"=="view" (',
  '  if "%FAKE_GH_RELEASE%"=="exists" (echo found& exit /b 0)',
  '  echo release not found 1>&2',
  '  exit /b 1',
  ')',
  'if "%1"=="release" if "%2"=="create" (echo %* >> "%FAKE_GH_LOG%"& exit /b 0)',
  'exit /b 2',
  '',
].join('\r\n'));

const keyFile = path.join(tmp(), 'fake_ed25519_private.key');
fs.writeFileSync(keyFile, generateKeyPairHex().privateKeyHex);
const assetDir = tmp();
const asset = path.join(assetDir, 'fake-engine.tgz');
fs.writeFileSync(asset, 'conteudo');
const emptyRegistry = tmp();

function publish(shell, releaseState) {
  const log = path.join(tmp(), 'gh-create.log');
  const r = spawnSync(shell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
    '-Engine', 'fake-engine', '-Version', '1.2.3', '-Asset', asset,
    '-Registry', 'test-owner/registry', '-RegistryPath', emptyRegistry, '-SkipManifest',
  ], {
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      PATH: `${fakeDir}${path.delimiter}${process.env.PATH}`,
      ENGINE_SIGNING_KEY_FAKE_ENGINE: keyFile,
      FAKE_GH_RELEASE: releaseState,
      FAKE_GH_LOG: log,
    },
  });
  return { out: `${r.stdout}${r.stderr}`, created: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
}

const shells = ['powershell.exe', 'pwsh.exe'].filter((s) => spawnSync(s, ['-NoProfile', '-Command', 'exit 0'], { windowsHide: true }).status === 0);
assert.ok(shells.includes('powershell.exe'), 'powershell.exe (5.1) ausente: o caso que motivou o teste não pode ser provado');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  OK    ${name}`); } catch (e) { failures++; console.log(`  FALHA ${name}\n        ${e.message.split('\n')[0]}`); }
}

for (const shell of shells) {
  check(`${shell}: release inexistente segue para a criação sem NativeCommandError`, () => {
    const { out, created } = publish(shell, 'absent');
    assert.doesNotMatch(out, /NativeCommandError/);
    assert.match(created, /release create fake-engine-v1\.2\.3 --repo test-owner\/registry/);
  });
  check(`${shell}: release já existente aborta antes de criar`, () => {
    const { out, created } = publish(shell, 'exists');
    assert.match(out, /a release 'fake-engine-v1\.2\.3' ja existe/);
    assert.equal(created, '');
  });
}

for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
if (failures) { console.log(`\n${failures} FALHA(S)`); process.exit(1); }
console.log('\n== TUDO VERDE ==');
