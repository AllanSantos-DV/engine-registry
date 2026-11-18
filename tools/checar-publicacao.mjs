#!/usr/bin/env node
/**
 * Checklist de publicação de um motor (CONTRATO-MOTOR §6) executado: roda os itens automatizáveis e lista os manuais pendentes.
 *
 *   node tools/checar-publicacao.mjs <motor> [--rede] [--json] [--manifest <caminho>]
 *
 * A lista vem do próprio §6: cada linha ou é coberta por um item automático ou aparece como manual; uma linha coberta que sumiu do contrato é erro.
 * Sem `--rede` rodam só os itens locais (chave de assinatura, entrada no manifest, assinatura declarada, página declarada); os que dependem de rede
 * (release publicada e conferida, página no ar, ponte) ficam NAO-RODADO. Item que tentou e não conseguiu checar é NAO-CHECADO e reprova: nunca vira OK.
 * Exit 0 = nenhum item automático falhou; 1 = algum falhou ou não pôde ser checado; 2 = uso errado ou contrato/manifest ilegível (nada foi checado).
 * Nada da chave privada sai na saída: nem o conteúdo, nem o caminho.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema, manifestErrors } from './schema-check.mjs';
import { problemasDeDeclaracao, problemasDaPaginaNoAr } from './product-page-order.mjs';
import { collect as buscarPonte } from './ponte-marketplace.mjs';
import { scrub } from './actions-minutes.mjs';
import { keyPathFor, envVarFor } from '../kit/keystore.mjs';
import { publicKeyHexFromPrivateHex } from '../kit/signature.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USO = 'uso: node tools/checar-publicacao.mjs <motor> [--rede] [--json] [--manifest <caminho>]';

const ok = (detalhe) => ({ status: 'OK', detalhe });
const falha = (detalhe) => ({ status: 'FALHA', detalhe });
const curto = (hex) => `${String(hex ?? '(ausente)').slice(0, 12)}…`;

/**
 * As linhas `[ ] ...` do §6 do contrato, sem o marcador.
 * @param {string} texto conteúdo de CONTRATO-MOTOR.md.
 * @throws {Error} sem a seção ou sem nenhuma linha: um checklist vazio não pode passar por checklist cumprido.
 */
export function linhasDoChecklist(texto) {
  const md = texto.replace(/\r\n/g, '\n');
  const i = md.search(/^## 6\. Checklist por motor/m);
  if (i < 0) throw new Error('CONTRATO-MOTOR.md sem a seção "## 6. Checklist por motor": não há checklist para executar');
  const linhas = md.slice(i + 1).split(/^## /m)[0].split('\n').filter((l) => l.startsWith('[ ] ')).map((l) => l.slice(4).trim());
  if (!linhas.length) throw new Error('o checklist do §6 não tem nenhuma linha "[ ] ...": não há o que executar');
  return linhas;
}

function chave({ e, keyPath }) {
  let hex;
  try { hex = readFileSync(keyPath, 'utf8').trim(); }
  catch (err) {
    return falha(err.code === 'ENOENT'
      ? `chave privada ausente (${envVarFor(e.name)} ou ~/.engine-signing/${e.name}_ed25519_private.key); gere com: node kit/gen-key.mjs ${e.name}`
      : `não consegui ler a chave privada (${err.code ?? 'erro de leitura'})`);
  }
  let derivada;
  try { derivada = publicKeyHexFromPrivateHex(hex); }
  catch { return falha('chave privada ilegível: o arquivo não tem uma chave Ed25519 em hex (32 bytes)'); }
  const declarada = e.install?.publicKey;
  return derivada === declarada
    ? ok(`a chave privada local deriva a publicKey do manifest (${curto(declarada)})`)
    : falha(`a chave privada local não deriva a publicKey do manifest (local ${curto(derivada)}, manifest ${curto(declarada)}): a chave certa não está nesta máquina ou o manifest está com a chave errada`);
}

function entrada({ e, manifest, schema }) {
  const indice = manifest.engines.indexOf(e);
  const erros = manifestErrors(manifest, schema).filter((x) => {
    const m = /^\$\.engines\[(\d+)\]/.exec(x);
    return !m || Number(m[1]) === indice;
  });
  if (typeof e.install?.entry !== 'string' && !erros.some((x) => /entry/.test(x))) erros.push('install.entry ausente');
  return erros.length ? falha(erros.join('; ')) : ok(`válida no schema (kind ${e.kind}, home ${e.home}, entry ${e.install.entry})`);
}

function assinatura({ e }) {
  const i = e.install ?? {};
  const faltas = [];
  if (!/^[0-9a-f]{64}$/.test(i.publicKey ?? '')) faltas.push('install.publicKey (64 hex)');
  if (!i.signatureAlgorithm) faltas.push('install.signatureAlgorithm');
  if (i.signatureRequired !== true) faltas.push('install.signatureRequired:true');
  if (!/(^|\/)engine-registry$/.test(i.repo ?? '')) faltas.push(`install.repo = engine-registry (hoje: ${i.repo})`);
  return faltas.length ? falha(`falta ou diverge: ${faltas.join(', ')}`) : ok(`${i.signatureAlgorithm}, signatureRequired:true, repo ${i.repo}`);
}

async function pagina({ e, rede, paginaNoAr }) {
  const problemas = problemasDeDeclaracao(e);
  if (problemas.length) return falha(problemas.join('; '));
  if (!e.pagesUrl) return ok(`sem página ainda (pagesPendente: ${e.pagesPendente})`);
  if (!rede) return ok(`declarada (${e.pagesUrl}); se está no ar, com vídeo e na ordem, só com --rede`);
  const achados = await paginaNoAr(e.pagesUrl);
  if (!achados.length) return ok(`no ar, com vídeo e na ordem (${e.pagesUrl})${e.pagesPendente ? ' — a página já passa: remova pagesPendente do manifest' : ''}`);
  return e.pagesPendente ? ok(`tolerada: ${achados.join('; ')} — pagesPendente: ${e.pagesPendente}`) : falha(achados.join('; '));
}

async function release({ e, verificarRelease }) {
  const r = await verificarRelease(e.name);
  return r.ok ? ok(r.detalhe) : falha(r.detalhe);
}

async function ponte({ buscarPonte }) {
  const r = await buscarPonte();
  return r.pending === 0
    ? ok('nenhuma ocorrência da URL antiga no índice de busca do GitHub (só a branch padrão; a indexação pode atrasar)')
    : falha(`${r.pending} arquivo(s) em ${new Set(r.found.map((f) => f.repo)).size} repositório(s) ainda apontam para a URL antiga: node tools/ponte-marketplace.mjs lista`);
}

/** Cada item cobre uma ou mais linhas do §6 (`cobre`, por regex) e roda sozinho; `rede` = só com `--rede`. */
const ITENS = [
  { id: 'chave', cobre: [/^chave gerada em/], roda: chave },
  { id: 'entrada', cobre: [/^entrada do motor existe no manifest/], roda: entrada },
  { id: 'pagina', cobre: [/^pagesUrl/], roda: pagina },
  { id: 'assinatura', cobre: [/^manifest\.json com publicKey/], roda: assinatura },
  { id: 'release', cobre: [/^release publicada no engine-registry/, /^node kit\/verify-release\.mjs/], roda: release, rede: true },
  { id: 'ponte', cobre: [/^grep nos repos dos consumidores pela URL antiga/], roda: ponte, rede: true },
];

/** Roda o `kit/verify-release.mjs` do motor (baixa o release público e confere sha256 e assinatura). */
function verificarReleaseDoKit(manifestPath) {
  return async (motor) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'kit', 'verify-release.mjs'), motor, '--manifest', manifestPath], { encoding: 'utf8', windowsHide: true, timeout: 600000 });
    if (r.error) throw r.error;
    const ultima = (r.status === 0 ? r.stdout : r.stderr || r.stdout).trim().split('\n').filter(Boolean).pop() ?? `código ${r.status}`;
    return { ok: r.status === 0, detalhe: scrub(ultima) };
  };
}

/**
 * Executa o checklist do §6 para um motor.
 * @param {string} motor nome no manifest.
 * @param {{manifest?:object, manifestPath?:string, contrato?:string, keyPath?:string, rede?:boolean,
 *          ponte?:()=>Promise<{pending:number, found:{repo:string}[]}>, verificarRelease?:(motor:string)=>Promise<{ok:boolean, detalhe:string}>,
 *          paginaNoAr?:(url:string)=>Promise<string[]>}=} opts tudo injetável (testes); o padrão é o manifest e o contrato do repositório.
 * @returns {Promise<{motor:string, ok:boolean, itens:{id:string, status:'OK'|'FALHA'|'NAO-CHECADO'|'NAO-RODADO', detalhe:string, cobre:string[]}[], manuais:string[]}>}
 *          `ok` é falso se algum item falhou ou não pôde ser checado; NAO-RODADO não reprova, mas fica visível.
 * @throws {Error} motor fora do manifest, contrato sem checklist, ou linha coberta por um item que sumiu do contrato.
 */
export async function checar(motor, {
  manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')), manifestPath = path.join(ROOT, 'manifest.json'),
  contrato = readFileSync(path.join(ROOT, 'CONTRATO-MOTOR.md'), 'utf8'), keyPath = keyPathFor(motor), rede = false,
  ponte: consultarPonte = () => buscarPonte({}), verificarRelease = verificarReleaseDoKit(manifestPath), paginaNoAr = problemasDaPaginaNoAr,
} = {}) {
  const e = manifest.engines?.find((x) => x.name === motor);
  if (!e) throw new Error(`motor "${motor}" não existe no manifest`);
  const linhas = linhasDoChecklist(contrato);
  const ctx = { e, manifest, schema: loadSchema(), keyPath, rede, buscarPonte: consultarPonte, verificarRelease, paginaNoAr };

  const itens = [];
  for (const item of ITENS) {
    const cobre = item.cobre.map((rx) => {
      const linha = linhas.find((l) => rx.test(l));
      if (!linha) throw new Error(`o §6 do contrato não tem mais a linha que o item "${item.id}" cobre (${rx}): ajuste tools/checar-publicacao.mjs ou o checklist`);
      return linha;
    });
    if (item.rede && !rede) { itens.push({ id: item.id, status: 'NAO-RODADO', detalhe: 'depende de rede: rode com --rede', cobre }); continue; }
    try { itens.push({ id: item.id, ...(await item.roda(ctx)), cobre }); }
    catch (err) { itens.push({ id: item.id, status: 'NAO-CHECADO', detalhe: `não consegui checar: ${scrub(err.message)}`, cobre }); }
  }
  const cobertas = new Set(itens.flatMap((i) => i.cobre));
  return { motor, ok: itens.every((i) => i.status === 'OK' || i.status === 'NAO-RODADO'), itens, manuais: linhas.filter((l) => !cobertas.has(l)) };
}

/** Texto para o terminal. */
export function render(r, rede) {
  const w = Math.max(...r.itens.map((i) => i.id.length));
  const conta = (s) => r.itens.filter((i) => i.status === s).length;
  const lines = [`== checar-publicacao: ${r.motor} (${rede ? 'com rede' : 'sem rede'}) ==`, ...r.itens.map((i) => `  ${i.status.padEnd(11)} ${i.id.padEnd(w)}  ${i.detalhe}`), '',
    `automáticos: ${conta('OK')} OK, ${conta('FALHA')} FALHA, ${conta('NAO-CHECADO')} NAO-CHECADO, ${conta('NAO-RODADO')} NAO-RODADO`,
    `manuais pendentes (${r.manuais.length}), o script não consegue conferir:`, ...r.manuais.map((l) => `  [ ] ${l}`), ''];
  lines.push(r.ok ? '== nenhum item automático falhou ==' : '== há item automático que falhou ou não pôde ser checado ==');
  return lines.join('\n');
}

/** Lê `<motor>`, `--rede`, `--json` e `--manifest <caminho>`; lança em opção desconhecida ou sem valor. */
function parseArgs(argv) {
  const o = { motor: null, rede: false, json: false, manifest: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rede') o.rede = true;
    else if (a === '--json') o.json = true;
    else if (a === '--manifest') {
      o.manifest = argv[++i];
      if (!o.manifest || o.manifest.startsWith('-')) throw new Error('--manifest precisa de um caminho');
    } else if (a.startsWith('-')) throw new Error(`opção desconhecida: ${a}`);
    else if (o.motor) throw new Error(`argumento inesperado: ${a}`);
    else o.motor = a;
  }
  if (!o.motor) throw new Error(USO);
  return o;
}

/** Roda o checklist e imprime o relatório. @returns {Promise<number>} o exit code (0, 1 ou 2) */
export async function run(argv, { log = console.log, error = console.error } = {}) {
  try {
    const o = parseArgs(argv);
    const opts = { rede: o.rede, ...(o.manifest ? { manifest: JSON.parse(readFileSync(o.manifest, 'utf8')), manifestPath: o.manifest } : {}) };
    const r = await checar(o.motor, opts);
    log(o.json ? JSON.stringify(r, null, 2) : render(r, o.rede));
    return r.ok ? 0 : 1;
  } catch (e) {
    error(`FALHOU: ${scrub(e.message)}`);
    return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await run(process.argv.slice(2));
