#!/usr/bin/env node
// Leva a nova versão de um motor ao manifest.json e ao README da main, sem tocar a cópia de trabalho local.
//
//   node tools/publish-manifest.mjs <motor> --version <x.y.z> [argumentos do kit/update-manifest.mjs] [--remote origin]
//
// Num worktree temporário a partir de <remote>/main: roda o kit/update-manifest.mjs, alinha a linha do motor na tabela do
// README, prova a release pelo caminho do consumidor (kit/verify-release.mjs) e só então commita e envia para a main. Em
// seguida mescla a main na develop (outro worktree temporário) e envia a develop. A main recebe o commit direto porque é
// dela que os consumidores leem o manifest; a develop continua contendo a main. Falha antes do push não envia nada.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class PublishManifestError extends Error {}

/** Roda o comando escondido e devolve o stdout; código diferente de 0 vira PublishManifestError com a saída. */
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.error) throw new PublishManifestError(`${cmd} ${args.join(' ')}: ${r.error.message}`);
  if (r.status !== 0) throw new PublishManifestError(`${cmd} ${args.join(' ')} (código ${r.status}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

const git = (args, cwd) => run('git', args, cwd);

/** Diz se a ref existe no repositório de cwd. */
function hasRef(ref, cwd) {
  return spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd, windowsHide: true }).status === 0;
}

/** Troca a versão da linha `| \`motor\` | x.y.z |` do README; README sem a linha fica como está. */
export function alignReadme(readme, engine, version) {
  return readme.replace(new RegExp('^(\\| `' + engine + '` \\| )[^ |]+( \\|)', 'm'), `$1${version}$2`);
}

/**
 * Publica a versão do motor na main e mescla a main na develop do remoto.
 * @param {{engine:string, version:string, updateArgs?:string[], repoDir?:string, remote?:string,
 *          verify:(manifestPath:string, worktree:string)=>void}} opts
 * @returns {{ok:true, unchanged:boolean, main:string, develop:string|null}}
 */
export function publishManifest({ engine, version, updateArgs = [], repoDir = ROOT, remote = 'origin', verify }) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new PublishManifestError(`versão '${version}' inválida (esperado x.y.z)`);
  if (typeof verify !== 'function') throw new PublishManifestError('verify é obrigatório: a release precisa ser provada antes do push');
  git(['fetch', remote], repoDir);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-manifest-'));
  const mainWt = path.join(tmp, 'main');
  const devWt = path.join(tmp, 'develop');
  const added = [];
  try {
    git(['worktree', 'add', '--detach', mainWt, `${remote}/main`], repoDir);
    added.push(mainWt);
    const manifest = path.join(mainWt, 'manifest.json');
    run(process.execPath, [path.join(mainWt, 'kit', 'update-manifest.mjs'), engine, '--version', version, ...updateArgs, '--manifest', manifest], mainWt);
    const readmePath = path.join(mainWt, 'README.md');
    if (fs.existsSync(readmePath)) fs.writeFileSync(readmePath, alignReadme(fs.readFileSync(readmePath, 'utf8'), engine, version));
    verify(manifest, mainWt);
    git(['add', 'manifest.json', 'README.md'], mainWt);
    // Compara o índice, não o status: com autocrlf, reescrever o arquivo com LF aparece como modificado sem mudar o conteúdo.
    if (spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: mainWt, windowsHide: true }).status === 0) {
      return { ok: true, unchanged: true, main: git(['rev-parse', 'HEAD'], mainWt), develop: null };
    }
    git(['commit', '-m', `${engine} ${version} no manifest e no README`], mainWt);
    const main = git(['rev-parse', 'HEAD'], mainWt);
    git(['push', remote, 'HEAD:refs/heads/main'], mainWt);

    if (!hasRef(`${remote}/develop`, repoDir)) return { ok: true, unchanged: false, main, develop: null };
    git(['worktree', 'add', '--detach', devWt, `${remote}/develop`], repoDir);
    added.push(devWt);
    try {
      git(['merge', '--no-edit', main], devWt);
    } catch (e) {
      spawnSync('git', ['merge', '--abort'], { cwd: devWt, windowsHide: true });
      throw new PublishManifestError(`main ${main} enviada, mas a mescla na develop conflitou (mescle à mão): ${e.message}`);
    }
    git(['push', remote, 'HEAD:refs/heads/develop'], devWt);
    return { ok: true, unchanged: false, main, develop: git(['rev-parse', 'HEAD'], devWt) };
  } finally {
    for (const wt of added) spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoDir, windowsHide: true });
    spawnSync('git', ['worktree', 'prune'], { cwd: repoDir, windowsHide: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Interpreta a linha de comando e publica com o kit/verify-release.mjs do worktree como prova. */
function cli(argv) {
  const engine = argv[0];
  const opt = (flag) => { const i = argv.indexOf(flag); return i === -1 ? null : argv[i + 1]; };
  if (!engine || engine.startsWith('--') || !opt('--version')) {
    throw new PublishManifestError('uso: node tools/publish-manifest.mjs <motor> --version <x.y.z> [argumentos do update-manifest] [--remote origin]');
  }
  const remote = opt('--remote') ?? 'origin';
  const updateArgs = argv.slice(1).filter((a, i, all) => !['--version', '--remote', '--manifest'].includes(a)
    && !['--version', '--remote', '--manifest'].includes(all[i - 1]));
  const verify = (manifest, wt) => run(process.execPath, [path.join(wt, 'kit', 'verify-release.mjs'), engine, '--manifest', manifest], wt);
  return publishManifest({ engine, version: opt('--version'), updateArgs, remote, verify });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const r = cli(process.argv.slice(2));
    console.log(r.unchanged ? `main já servia a versão (${r.main}); nada enviado` : `main ${r.main}${r.develop ? `, develop ${r.develop}` : ' (sem develop no remoto)'}`);
  } catch (e) {
    console.error(`FALHOU: ${e.message}`);
    process.exit(1);
  }
}
