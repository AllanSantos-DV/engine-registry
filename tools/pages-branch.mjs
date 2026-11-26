#!/usr/bin/env node
// Publica o site (pasta site/, estático, sem build) na branch gh-pages e confere a página no ar, sem
// artefato do Actions.
//
//   publish: confere o site (index.html, referências sob a base /engine-registry/, sem link simbólico), monta um commit
//            órfão só com o conteúdo do site, o manifest.json da raiz do repositório (--manifest) e .nojekyll, e o envia
//            a gh-pages com push forçado (a branch é só do site e é refeita a cada publicação). Remoto SSH exige a chave
//            de deploy em PAGES_DEPLOY_KEY (push com GITHUB_TOKEN não dispara a publicação do Pages).
//   verify:  lê a URL pública até ela servir o mesmo index.html do build e o mesmo manifest.json do repositório.
//
// Configuração inválida (site ausente, manifest ausente ou que não é JSON, referência fora da base, link simbólico,
// branch fora de gh-pages, chave ausente) termina com código 1 e a causa no erro padrão. Reversão e processo: docs/PAGES.md.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BRANCH = 'gh-pages';
export const KEY_ENV = 'PAGES_DEPLOY_KEY';
export const DEFAULT_SITE = path.join(ROOT, 'site');
export const DEFAULT_MANIFEST = path.join(ROOT, 'manifest.json');
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

/** CRLF vira LF: o blob do git é LF e o checkout local pode ter CRLF, então os dois lados da comparação passam por aqui. */
const lf = (buffer) => Buffer.from(buffer.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');

/** Bytes do manifest.json a publicar, com LF; recusa arquivo ausente ou que não é JSON. */
export function readManifest(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new PagesError(`${file} não existe: o manifest.json é publicado junto com o site`);
  }
  const bytes = lf(fs.readFileSync(file));
  try {
    JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new PagesError(`${file} não é JSON válido (${error.message}): não publico um manifest quebrado`);
  }
  return bytes;
}

export function stageTree(site, destination, manifest) {
  fs.cpSync(site, destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'manifest.json'), manifest);
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

export function publish(site, remote, branch, message, key, manifestFile = DEFAULT_MANIFEST) {
  if (branch !== BRANCH) { throw new PagesError(`push forçado só na branch ${BRANCH}, não em '${branch}'`); }
  checkSite(site);
  const manifest = readManifest(manifestFile);
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
    stageTree(site, tree, manifest);
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

/**
 * O vídeo publicado responde 200 como video/mp4, com o tamanho e o sha256 do arquivo de site/media/ (que o fetch do asset da
 * release já conferiu contra o .sha256 versionado). Sem mp4 no site, não há o que conferir.
 */
export async function verifyVideo(url, site, stamp) {
  const file = path.join(site, 'media', 'apresentacao.mp4');
  if (!fs.existsSync(file)) { return null; }
  const want = fs.readFileSync(file);
  const res = await fetch(new URL(`media/apresentacao.mp4?v=${stamp}`, url), { signal: AbortSignal.timeout(120000), cache: 'no-store' });
  if (!res.ok) { throw new PagesError(`o vídeo publicado respondeu HTTP ${res.status}`); }
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('video/mp4')) { throw new PagesError(`o vídeo publicado veio como '${type}', não video/mp4`); }
  const got = Buffer.from(await res.arrayBuffer());
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  if (got.length !== want.length || sha(got) !== sha(want)) {
    throw new PagesError(`o vídeo publicado (${got.length} B, ${sha(got).slice(0, 12)}…) não é o de site/media (${want.length} B, ${sha(want).slice(0, 12)}…)`);
  }
  return { bytes: got.length, sha256: sha(got), type };
}

/** O manifest.json publicado responde 200, é JSON e tem os mesmos bytes (com LF) do manifest local. */
export async function verifyManifest(url, manifest, stamp) {
  const res = await fetch(new URL(`manifest.json?v=${stamp}`, url), { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!res.ok) { throw new PagesError(`o manifest.json publicado respondeu HTTP ${res.status}`); }
  const got = lf(Buffer.from(await res.arrayBuffer()));
  try {
    JSON.parse(got.toString('utf8'));
  } catch {
    throw new PagesError('o manifest publicado não é JSON válido');
  }
  if (!got.equals(manifest)) { throw new PagesError('o manifest publicado difere do da main'); }
}

export async function verify(url, site, attempts, interval, stamp, manifestFile = DEFAULT_MANIFEST) {
  checkSite(site);
  const manifest = readManifest(manifestFile);
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
        await verifyManifest(url, manifest, stamp);
        const video = await verifyVideo(url, site, stamp);
        if (video) { console.log(`vídeo no ar: ${video.type}, ${video.bytes} B, sha256 ${video.sha256}`); }
        return;
      }
    } catch (error) {
      last = error.cause?.message || error.message;
    }
    if (attempt + 1 < attempts) { await new Promise((resolve) => setTimeout(resolve, interval * 1000)); }
  }
  throw new PagesError(`${url} não serve o index.html de ${site} e o manifest.json do repositório depois de ${attempts} tentativas (${last})`);
}

function parse(argv) {
  const [command, ...rest] = argv;
  if (command !== 'publish' && command !== 'verify') {
    throw new PagesError(`uso: pages-branch.mjs publish|verify [--opção valor]; recebido '${command ?? ''}'`);
  }
  const allowed = command === 'publish' ? ['site', 'remote', 'branch', 'message', 'manifest'] : ['site', 'url', 'attempts', 'interval', 'stamp', 'manifest'];
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
        process.env[KEY_ENV] ?? '', options.manifest ?? DEFAULT_MANIFEST);
      console.log(`${branch} publicada em ${sha}.`);
    } else {
      const url = options.url ?? DEFAULT_URL;
      await verify(url, site, Number(options.attempts ?? 20), Number(options.interval ?? 15), options.stamp ?? String(Date.now()), options.manifest ?? DEFAULT_MANIFEST);
      console.log(`${url} serve o index.html deste site e o manifest.json do repositório.`);
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
