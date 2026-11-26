#!/usr/bin/env node
// Publica o site (pasta site/, estático, sem build) na branch gh-pages e confere a página no ar, sem
// artefato do Actions.
//
//   publish: confere o site (index.html, referências sob a base /engine-registry/, sem link simbólico), monta um commit
//            órfão só com o conteúdo do site, o manifest.json (--manifest) e o schema.json (--schema) da raiz do repositório, os
//            pontos de leitura engines/<nome>.json e engines/index.json derivados desse manifest, e .nojekyll, e o envia
//            a gh-pages com push forçado (a branch é só do site e é refeita a cada publicação). Remoto SSH exige a chave
//            de deploy em PAGES_DEPLOY_KEY (push com GITHUB_TOKEN não dispara a publicação do Pages).
//   verify:  lê a URL pública até ela servir o mesmo index.html do build, o mesmo manifest.json e schema.json do repositório e os
//            engines/ gerados do manifest.
//
// Configuração inválida (site ausente, manifest ou schema ausente ou que não é JSON, nome de motor fora de [a-z0-9._-], referência fora da base, link simbólico,
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
export const DEFAULT_SCHEMA = path.join(ROOT, 'schema.json');
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

/** Bytes do JSON da raiz a publicar (manifest.json ou schema.json), com LF; recusa arquivo ausente ou que não é JSON. */
function readRootJson(file, name) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new PagesError(`${file} não existe: o ${name} é publicado junto com o site`);
  }
  const bytes = lf(fs.readFileSync(file));
  try {
    JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new PagesError(`${file} não é JSON válido (${error.message}): não publico um ${name} quebrado`);
  }
  return bytes;
}

export const readManifest = (file) => readRootJson(file, 'manifest.json');
export const readSchema = (file) => readRootJson(file, 'schema.json');

const NAME = /^[a-z0-9][a-z0-9._-]*$/;
const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');

/**
 * Os pontos de leitura por motor e app do manifest: engines/<nome>.json (nome, versão, tipo, resumo, plataformas e a página da release da versão)
 * e engines/index.json (nomes e versões). Só dado de produto, derivado do manifest, com chaves em ordem fixa e LF final. Manifest sem motor nem app não gera arquivo.
 * @param {Buffer} manifest bytes do manifest.json da raiz.
 * @returns {Map<string, Buffer>} caminho relativo ao site publicado → bytes.
 * @throws {PagesError} nome fora de [a-z0-9._-], repetido ou reservado, ou entrada sem versão, resumo, tipo ou release resolvível.
 */
export function engineFiles(manifest) {
  const doc = JSON.parse(manifest.toString('utf8'));
  const entries = [...(doc.engines ?? []).map((e) => [e, e.install, e.kind]), ...(doc.apps ?? []).map((a) => [a, a.release, 'app'])];
  const files = new Map();
  const index = [];
  for (const [e, source, kind] of entries) {
    if (typeof e.name !== 'string' || !NAME.test(e.name)) {
      throw new PagesError('nome de motor ou app ' + JSON.stringify(e.name) + ' fora de [a-z0-9._-] (começando por letra ou número): ele vira o endereço engines/<nome>.json');
    }
    if (e.name === 'index' || files.has('engines/' + e.name + '.json')) { throw new PagesError('nome de motor ou app ' + e.name + ' repetido ou reservado (engines/index.json)'); }
    for (const [campo, valor] of [['version', e.version], ['summary', e.summary], ['kind', kind]]) {
      if (typeof valor !== 'string' || !valor) { throw new PagesError(e.name + ': o manifest não traz ' + campo + ', que o engines/' + e.name + '.json publica'); }
    }
    const tag = typeof source?.tag === 'string' ? source.tag.replaceAll('{version}', e.version) : '';
    if (typeof source?.repo !== 'string' || !tag || /[{}]/.test(tag)) { throw new PagesError(e.name + ': sem release resolvível (repo e tag com {version}) no manifest'); }
    files.set('engines/' + e.name + '.json', json({ name: e.name, version: e.version, kind, summary: e.summary, platforms: Array.isArray(e.platforms) ? e.platforms : [], release: 'https://github.com/' + source.repo + '/releases/tag/' + tag }));
    index.push({ name: e.name, version: e.version });
  }
  if (index.length) { files.set('engines/index.json', json({ entries: index })); }
  return files;
}

/**
 * Monta a árvore a publicar: o site, o manifest.json e o schema.json da raiz, os engines/ gerados (um `engines/` vindo de site/ é descartado) e .nojekyll.
 * @param {string} site pasta do site.
 * @param {string} destination pasta vazia onde a árvore é montada.
 * @param {Buffer} manifest bytes do manifest.json.
 * @param {Buffer} schema bytes do schema.json.
 * @param {Map<string, Buffer>=} engines saída de `engineFiles`.
 */
export function stageTree(site, destination, manifest, schema, engines = new Map()) {
  fs.cpSync(site, destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'manifest.json'), manifest);
  fs.writeFileSync(path.join(destination, 'schema.json'), schema);
  fs.rmSync(path.join(destination, 'engines'), { recursive: true, force: true });
  for (const [file, bytes] of engines) {
    fs.mkdirSync(path.dirname(path.join(destination, file)), { recursive: true });
    fs.writeFileSync(path.join(destination, file), bytes);
  }
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

export function publish(site, remote, branch, message, key, manifestFile = DEFAULT_MANIFEST, schemaFile = DEFAULT_SCHEMA) {
  if (branch !== BRANCH) { throw new PagesError(`push forçado só na branch ${BRANCH}, não em '${branch}'`); }
  checkSite(site);
  const manifest = readManifest(manifestFile);
  const schema = readSchema(schemaFile);
  const engines = engineFiles(manifest);
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
    stageTree(site, tree, manifest, schema, engines);
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

/** O JSON da raiz publicado responde 200, é JSON e tem os mesmos bytes (com LF) do local. */
async function verifyRootJson(url, expected, stamp, file, label, differs) {
  const res = await fetch(new URL(`${file}?v=${stamp}`, url), { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!res.ok) { throw new PagesError(`o ${file} publicado respondeu HTTP ${res.status}`); }
  const got = lf(Buffer.from(await res.arrayBuffer()));
  try {
    JSON.parse(got.toString('utf8'));
  } catch {
    throw new PagesError(`o ${label} publicado não é JSON válido`);
  }
  if (!got.equals(expected)) { throw new PagesError(`o ${label} publicado difere ${differs}`); }
}

export const verifyManifest = (url, manifest, stamp) => verifyRootJson(url, manifest, stamp, 'manifest.json', 'manifest', 'do da main');
export const verifySchema = (url, schema, stamp) => verifyRootJson(url, schema, stamp, 'schema.json', 'schema', 'do local');

/** Cada engines/<nome>.json e o engines/index.json gerados do manifest local respondem 200, são JSON e têm os mesmos bytes. */
export async function verifyEngines(url, engines, stamp) {
  for (const [file, expected] of engines) { await verifyRootJson(url, expected, stamp, file, file, 'do gerado do manifest'); }
}

export async function verify(url, site, attempts, interval, stamp, manifestFile = DEFAULT_MANIFEST, schemaFile = DEFAULT_SCHEMA) {
  checkSite(site);
  const manifest = readManifest(manifestFile);
  const schema = readSchema(schemaFile);
  const engines = engineFiles(manifest);
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
        await verifySchema(url, schema, stamp);
        await verifyEngines(url, engines, stamp);
        const video = await verifyVideo(url, site, stamp);
        if (video) { console.log(`vídeo no ar: ${video.type}, ${video.bytes} B, sha256 ${video.sha256}`); }
        return;
      }
    } catch (error) {
      last = error.cause?.message || error.message;
    }
    if (attempt + 1 < attempts) { await new Promise((resolve) => setTimeout(resolve, interval * 1000)); }
  }
  throw new PagesError(`${url} não serve o index.html de ${site} e o manifest.json e o schema.json do repositório depois de ${attempts} tentativas (${last})`);
}

function parse(argv) {
  const [command, ...rest] = argv;
  if (command !== 'publish' && command !== 'verify') {
    throw new PagesError(`uso: pages-branch.mjs publish|verify [--opção valor]; recebido '${command ?? ''}'`);
  }
  const allowed = command === 'publish' ? ['site', 'remote', 'branch', 'message', 'manifest', 'schema'] : ['site', 'url', 'attempts', 'interval', 'stamp', 'manifest', 'schema'];
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
        process.env[KEY_ENV] ?? '', options.manifest ?? DEFAULT_MANIFEST, options.schema ?? DEFAULT_SCHEMA);
      console.log(`${branch} publicada em ${sha}.`);
    } else {
      const url = options.url ?? DEFAULT_URL;
      await verify(url, site, Number(options.attempts ?? 20), Number(options.interval ?? 15), options.stamp ?? String(Date.now()),
        options.manifest ?? DEFAULT_MANIFEST, options.schema ?? DEFAULT_SCHEMA);
      console.log(`${url} serve o index.html deste site e o manifest.json e o schema.json do repositório.`);
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
