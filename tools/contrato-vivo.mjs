#!/usr/bin/env node
/**
 * Prova do daemon VIVO contra o contrato aberto: manda ao motor em execução os pedidos de exemplo de `tests/contratos/` e confere o status HTTP
 * e a forma da resposta pelos esquemas. Só rotas sem efeito colateral (a casa: /info, /embed, /similarity, /rerank; o grafo: listar tipos e
 * buscar numa raiz nunca indexada). Não sobe, não derruba e não reconfigura o motor: acha o endereço pelo anúncio (`discover`).
 *
 *   node tools/contrato-vivo.mjs <casa-de-embeddings|motor-de-grafo> [--json]
 *
 * Exit: 0 = tudo conforme. 1 = alguma resposta fora do contrato. 2 = uso errado ou motor não encontrado vivo.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './schema-check.mjs';
import { discover, CASA, GRAFO } from '../kit/client.mjs';

const CONTRATOS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'contratos');
const USO = 'uso: node tools/contrato-vivo.mjs <casa-de-embeddings|motor-de-grafo> [--json] [--url <endereço> [--token-stdin]]';
const lerJson = (dir, arquivo) => JSON.parse(readFileSync(path.join(CONTRATOS, dir, arquivo), 'utf8'));
const recusa = (http) => http >= 400 && http < 500;

/**
 * Pasta vazia e estável, uma por versão do kit, que o grafo nunca indexou: a busca de prova aponta para ela. Fica em
 * `%LOCALAPPDATA%\engine-kit\contrato-vivo\v<versão>`; criar de novo uma pasta que já existe não cria nada.
 * @returns {string} caminho absoluto da pasta.
 */
export function pastaDaProva() {
  const { version } = JSON.parse(readFileSync(path.join(CONTRATOS, '..', '..', 'package.json'), 'utf8'));
  const pasta = path.join(process.env.LOCALAPPDATA || path.join(homedir(), '.local', 'share'), 'engine-kit', 'contrato-vivo', `v${version}`);
  mkdirSync(pasta, { recursive: true });
  return pasta;
}

/** Os casos de cada motor: `http` aceito (número ou função), `schema` da resposta e `confere` extra sobre o corpo (devolve problemas). */
function casosDa(motor, raiz) {
  if (motor === CASA) {
    const dir = 'casa';
    const sim = lerJson(dir, 'similarity-valida.json');
    const reqSim = lerJson(dir, 'similarity-v1.request.schema.json'), respSim = lerJson(dir, 'similarity-v1.response.schema.json');
    const reqRerank = lerJson(dir, 'rerank-host-v1.request.schema.json'), respRerank = lerJson(dir, 'rerank-host-v1.response.schema.json');
    const documents = ['Paris é a capital da França', 'bananas são amarelas', 'capital da França'];
    const rerank = { query: 'capital da França', documents };
    return [
      { id: 'info', metodo: 'GET', rota: '/info', http: 200, confere: (c) => (c && typeof c === 'object' && !Array.isArray(c) ? [] : ['esperado um objeto']) },
      { id: 'embed', metodo: 'POST', rota: '/embed', corpo: { inputs: ['a', 'b'] }, http: 200,
        confere: (c) => (Array.isArray(c) && c.length === 2 && c.every((v) => Array.isArray(v) && v.length && v.every(Number.isFinite)) && c[0].length === c[1].length ? [] : ['esperado um vetor numérico por texto, todos do mesmo tamanho']) },
      { id: 'similarity', metodo: 'POST', rota: '/similarity', corpo: sim.pedido, pedidoSchema: [reqSim, sim.pedido], http: 200, schema: respSim,
        confere: (c) => (Array.isArray(c) && c.length === sim.pedido.inputs.sentences.length ? [] : ['um cosseno por frase, na ordem do pedido']) },
      { id: 'similarity-sem-sentences', metodo: 'POST', rota: '/similarity', corpo: lerJson(dir, 'similarity-invalida-sem-sentences.json').pedido, http: recusa },
      { id: 'similarity-sentences-texto', metodo: 'POST', rota: '/similarity', corpo: lerJson(dir, 'similarity-invalida-sentences-texto.json').pedido, http: recusa },
      { id: 'rerank', metodo: 'POST', rota: '/rerank', corpo: rerank, pedidoSchema: [reqRerank, rerank], http: 200, schema: respRerank,
        confere: (c) => { const ix = c?.results?.map((r) => r.index) ?? []; return new Set(ix).size === ix.length && ix.every((i) => i < documents.length) ? [] : ['índice repetido ou fora do intervalo']; } },
    ];
  }
  const dir = 'grafo';
  const sub = (v) => JSON.parse(JSON.stringify(v).replaceAll('${RAIZ}', raiz.replaceAll('\\', '\\\\')));
  const kindsResp = lerJson(dir, 'kinds.response.schema.json'), searchResp = lerJson(dir, 'search.response.schema.json');
  const buscaValida = sub(lerJson(dir, 'search.request.valid.json').find((c) => c.nome === 'so_query').corpo);
  const invalidas = sub(lerJson(dir, 'search.request.invalid.json')).filter((c) => c.http === 400 && !JSON.stringify(c.corpo).includes('${'));
  return [
    { id: 'kinds-listar', metodo: 'POST', rota: '/api/v1/graph/kinds', corpo: {}, http: 200, schema: kindsResp,
      confere: (c) => (c?.kinds?.some((k) => k.name === 'code' && k.builtin) ? [] : ['a lista precisa trazer o tipo embutido "code"']) },
    { id: 'search-raiz-nao-indexada', metodo: 'POST', rota: '/api/v1/graph/search', corpo: buscaValida, pedidoSchema: [lerJson(dir, 'search.request.schema.json'), buscaValida], http: 200, schema: searchResp },
    ...invalidas.map((c) => ({ id: `search-${c.nome}`, metodo: 'POST', rota: '/api/v1/graph/search', corpo: c.corpo, http: 400,
      confere: (corpo) => (typeof corpo?.code === 'string' ? [] : ['erro sem o campo "code" do contrato']) })),
  ];
}

/**
 * Roda os casos do `motor` contra o daemon em `home.url`.
 * @param {string} motor `casa-de-embeddings` ou `motor-de-grafo`.
 * @param {{url:string, token?:string}} home endereço do daemon vivo.
 * @param {{fetchImpl?:typeof fetch, timeoutMs?:number, raiz?:string}=} opts `raiz` = pasta que o grafo nunca indexou (default: `pastaDaProva()`).
 * @returns {Promise<{motor:string, ok:boolean, itens:{id:string, status:'OK'|'FALHA', detalhe:string}[]}>}
 * @throws {Error} motor sem contrato aberto.
 */
export async function provar(motor, home, { fetchImpl = fetch, timeoutMs = 15000, raiz = pastaDaProva() } = {}) {
  if (![CASA, GRAFO].includes(motor)) throw new Error(`"${motor}" não tem contrato aberto para provar (aceito: ${CASA}, ${GRAFO})`);
  const itens = [];
  for (const c of casosDa(motor, raiz)) {
    const falha = (detalhe) => itens.push({ id: c.id, status: 'FALHA', detalhe });
    if (c.pedidoSchema) {
      const [esquema, pedido] = c.pedidoSchema;
      const ruins = validate(esquema, esquema, pedido);
      if (ruins.length) { falha(`o pedido de exemplo não cumpre o próprio esquema (bug do contrato local): ${ruins[0]}`); continue; }
    }
    let r;
    try {
      r = await fetchImpl(`${home.url.replace(/\/$/, '')}${c.rota}`, {
        method: c.metodo, signal: AbortSignal.timeout(timeoutMs),
        headers: { ...(c.corpo ? { 'content-type': 'application/json' } : {}), ...(home.token ? { authorization: `Bearer ${home.token}` } : {}) },
        ...(c.corpo ? { body: JSON.stringify(c.corpo) } : {}),
      });
    } catch (e) { falha(`sem resposta de ${c.rota}: ${e.message}`); continue; }
    const aceito = typeof c.http === 'function' ? c.http(r.status) : r.status === c.http;
    if (!aceito) { falha(`HTTP ${r.status} em ${c.rota}, esperado ${typeof c.http === 'function' ? 'um erro 4xx (pedido inválido recusado)' : c.http}`); continue; }
    let corpo = null;
    try { corpo = await r.json(); } catch { if (c.schema || c.confere) { falha(`${c.rota} respondeu ${r.status} sem JSON`); continue; } }
    const problemas = [...(c.schema ? validate(c.schema, c.schema, corpo) : []), ...(c.confere ? c.confere(corpo) : [])];
    itens.push(problemas.length ? { id: c.id, status: 'FALHA', detalhe: problemas.slice(0, 3).join('; ') } : { id: c.id, status: 'OK', detalhe: `HTTP ${r.status}` });
  }
  return { motor, ok: itens.every((i) => i.status === 'OK'), itens };
}

/** Texto para o terminal. */
export function render(r) {
  const w = Math.max(...r.itens.map((i) => i.id.length));
  return [`== contrato-vivo: ${r.motor} ==`, ...r.itens.map((i) => `  ${i.status.padEnd(5)} ${i.id.padEnd(w)}  ${i.detalhe}`), '',
    r.ok ? '== o daemon vivo cumpre o contrato ==' : `== ${r.itens.filter((i) => i.status !== 'OK').length} caso(s) fora do contrato ==`].join('\n');
}

/** Lê o token da entrada padrão, sem nunca aceitá-lo como argumento. */
async function tokenDaEntrada() {
  let t = '';
  for await (const parte of process.stdin) t += parte;
  return t.trim();
}

/**
 * Prova o daemon do motor contra o contrato aberto. Sem `--url` acha o daemon pelo anúncio; com `--url` prova o endereço
 * dado (grafo em modo equipe, HOME isolado), e `--token-stdin` lê o token Bearer da entrada padrão.
 * @returns {Promise<number>} o exit code (0, 1 ou 2)
 */
export async function run(argv, { log = console.log, error = console.error, achar = discover, lerToken = tokenDaEntrada, ...opts } = {}) {
  const i = argv.indexOf('--url');
  const url = i < 0 ? null : argv[i + 1];
  const resto = argv.filter((a, j) => j !== i && j !== i + 1 || i < 0);
  const motor = resto.find((a) => !a.startsWith('-'));
  const livres = resto.filter((a) => a.startsWith('-') && a !== '--json' && !(url && a === '--token-stdin'));
  if (!motor || livres.length || (i >= 0 && !/^https?:\/\//.test(url ?? ''))) { error(USO); return 2; }
  try {
    const home = url ? { ok: true, url, ...(resto.includes('--token-stdin') ? { token: await lerToken() } : {}) } : await achar(motor);
    if (!home.ok) { error(`FALHOU: ${motor} não está vivo: ${home.reason} (este comando não sobe o motor)`); return 2; }
    const r = await provar(motor, home, opts);
    log(resto.includes('--json') ? JSON.stringify(r, null, 2) : render(r));
    return r.ok ? 0 : 1;
  } catch (e) { error(`FALHOU: ${e.message}`); return 2; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await run(process.argv.slice(2));
