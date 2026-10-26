#!/usr/bin/env node
// Publica o site (pasta site/, estático, sem build) na branch gh-pages e confere a página no ar, sem
// artefato do Actions.
//
//   publish: confere o site (index.html, referências sob a base /engine-registry/, sem link simbólico), monta um commit
//            órfão só com o conteúdo do site mais .nojekyll e o envia a gh-pages com push forçado (a branch é só do
//            site e é refeita a cada publicação). Remoto SSH exige a chave de deploy em PAGES_DEPLOY_KEY (push com
//            GITHUB_TOKEN não dispara a publicação do Pages).
//   verify:  lê a URL pública até ela servir o mesmo index.html do build.
//
// Configuração inválida (site ausente, referência fora da base, link simbólico, branch fora de gh-pages, chave ausente)
// termina com código 1 e a causa no erro padrão. Reversão e processo: docs/PAGES.md.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BRANCH = 'gh-pages';
export const KEY_ENV = 'PAGES_DEPLOY_KEY';
export const DEFAULT_SITE = path.join(ROOT, 'site');
export const DEFAULT_REMOTE = 'git@github.com:AllanSantos-DV/engine-registry.git';
export const DEFAULT_URL = 'https://allansantos-dv.github.io/engine-registry/';

export class PagesError extends Error {}

function files(dir, root = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() && !entry.isSymbolicLink() ? files(full, root) : [path.relative(root, full).replace(/\\/g, '/')];
  });
}

export function checkSite(site) {
  const index = path.join(site, 'index.html');
  if (!fs.existsSync(index) || !fs.statSync(index).isFile()) {
    throw new PagesError(`${index} não existe: a pasta do site não existe (nada a publicar)`);
  }
  const links = files(site).filter((file) => fs.lstatSync(path.join(site, file)).isSymbolicLink());
  if (links.length) {
    throw new PagesError(`links simbólicos em ${site} (o Pages por branch não os publica): ${links.join(', ')}`);
  }
  // o site vive em /engine-registry/: referência local começando com "/" fora da base apontaria para a raiz do domínio e quebraria no ar
  const absolute = [...fs.readFileSync(index, 'utf8').matchAll(/(?:href|src|poster)="(\/(?!engine-registry[/"])[^"]*)"/g)].map((m) => m[1]);
  if (absolute.length) {
    throw new PagesError(`${index} tem referências absolutas (${absolute.join(', ')}): a página quebraria sob /engine-registry/`);
  }
}

export function stageTree(site, destination) {
  fs.cpSync(site, destination, { recursive: true });
  fs.writeFileSync(path.join(destination, '.nojekyll'), '');
}

export function writeKey(file, key) {
  // LF puro: o ssh recusa CRLF ("error in libcrypto")
  fs.writeFileSync(file, key.replace(/\r/g, '').trim() + '\n', { mode: 0o600 });
}

function git(args, cwd, env) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true });
  if (result.error) { throw new PagesError(`git ${args[0]} não executou: ${result.error.message}`); }
  if (result.status) {
    throw new PagesError(`git ${args[0]} falhou (${result.status}): ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function hasSsh() {
  return !spawnSync('ssh', ['-V'], { windowsHide: true }).error;
}

export function publish(site, remote, branch, message, key) {
  if (branch !== BRANCH) { throw new PagesError(`push forçado só na branch ${BRANCH}, não em '${branch}'`); }
  checkSite(site);
  const overSsh = remote.startsWith('git@') || remote.startsWith('ssh://');
  if (overSsh && !key.includes('PRIVATE KEY')) {
    throw new PagesError(`${KEY_ENV} ausente ou não é uma chave privada: remoto SSH exige a chave de deploy`);
  }
  if (overSsh && !hasSsh()) {
    throw new PagesError('cliente ssh ausente neste ambiente: o push com chave de deploy não é possível');
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-'));
  try {
    const env = { ...process.env };
    if (overSsh) {
      const keyFile = path.join(temp, 'deploy_key').replace(/\\/g, '/');
      const knownHosts = path.join(temp, 'known_hosts').replace(/\\/g, '/');
      writeKey(keyFile, key);
      env.GIT_SSH_COMMAND = `ssh -i "${keyFile}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new `
        + `-o UserKnownHostsFile="${knownHosts}"`;
    }
    const tree = path.join(temp, 'tree');
    stageTree(site, tree);
    git(['init', '-q', '-b', branch], tree);
    git(['add', '-A'], tree);
    git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      '-c', 'core.autocrlf=false', 'commit', '-q', '-m', message], tree);
    git(['push', '--force', remote, `HEAD:refs/heads/${branch}`], tree, env);
    return git(['rev-parse', 'HEAD'], tree).trim();
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

export function samePage(live, site) {
  const expected = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  return live.replace(/\r\n/g, '\n') === expected.replace(/\r\n/g, '\n');
}

export async function verify(url, site, attempts, interval, stamp) {
  checkSite(site);
  let last = 'sem resposta';
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${url}?v=${stamp}`, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
      const body = await response.text();
      if (!response.ok) {
        last = `HTTP ${response.status}`;
      } else if (!samePage(body, site)) {
        last = 'a página responde, mas não é o index.html deste site';
      } else {
        return;
      }
    } catch (error) {
      last = error.cause?.message || error.message;
    }
    if (attempt + 1 < attempts) { await new Promise((resolve) => setTimeout(resolve, interval * 1000)); }
  }
  throw new PagesError(`${url} não serve o index.html de ${site} depois de ${attempts} tentativas (${last})`);
}

function parse(argv) {
  const [command, ...rest] = argv;
  if (command !== 'publish' && command !== 'verify') {
    throw new PagesError(`uso: pages-branch.mjs publish|verify [--opção valor]; recebido '${command ?? ''}'`);
  }
  const allowed = command === 'publish' ? ['site', 'remote', 'branch', 'message'] : ['site', 'url', 'attempts', 'interval', 'stamp'];
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i].replace(/^--/, '');
    if (!rest[i].startsWith('--') || !allowed.includes(name) || rest[i + 1] === undefined) {
      throw new PagesError(`opção inválida para ${command}: '${rest[i]}' (aceitas: ${allowed.map((a) => `--${a}`).join(', ')})`);
    }
    options[name] = rest[i + 1];
  }
  return { command, options };
}

export async function main(argv) {
  try {
    const { command, options } = parse(argv);
    const site = options.site ?? DEFAULT_SITE;
    if (command === 'publish') {
      const branch = options.branch ?? BRANCH;
      const sha = publish(site, options.remote ?? DEFAULT_REMOTE, branch, options.message ?? 'Site engine-registry',
        process.env[KEY_ENV] ?? '');
      console.log(`${branch} publicada em ${sha}.`);
    } else {
      const url = options.url ?? DEFAULT_URL;
      await verify(url, site, Number(options.attempts ?? 20), Number(options.interval ?? 15), options.stamp ?? String(Date.now()));
      console.log(`${url} serve o index.html deste site.`);
    }
    return 0;
  } catch (error) {
    if (!(error instanceof PagesError)) { throw error; }
    console.error(`::error::${error.message}`);
    return 1;
  }
}

// realpath dos dois lados: com a pasta de trabalho numa junction (runner no Dev Drive) o import.meta.url vem com o
// caminho real e argv[1] com o da junction; comparar o texto deixaria o script sem rodar e sem erro
const real = (file) => fs.realpathSync.native(file);
if (process.argv[1] && real(fileURLToPath(import.meta.url)) === real(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
