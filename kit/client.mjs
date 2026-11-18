// engine-kit/client.mjs — cliente compartilhado da casa de embeddings e do motor de grafo.
//
//   import { ensureHome, casaClient, grafoClient, CASA, GRAFO } from "engine-kit/kit/client.mjs";
//   const h = await ensureHome(CASA);                       // instala o que falta, sobe quem não está de pé, espera o anúncio
//   if (!h.ok) { /* h.reason diz o que faltou e o comando que resolve */ }
//   const v = await casaClient(h).embed(["texto"], { priority: "interactive" });
//
// O produto não guarda descoberta, instalação nem cliente REST próprios: o anúncio do motor (`runtime.runtimeFile` do descritor) diz a url,
// e o contrato é o publicado pela casa (embed, similarity, rerank) e pelo servidor do grafo (`/api/v1/graph/*`).
// Contrato do kit: nenhuma função lança. Falha vira `{ ok:false, reason }` com a causa e o comando que resolve; nunca resposta plausível.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { resolve } from "./resolve.mjs";
import { readRuntime } from "./lifecycle.mjs";
import { bundledManifest } from "./ensure.mjs";
import { ensureEngine } from "./index.mjs";
import { probeHealth } from "./diagnose.mjs";

export const CASA = "casa-de-embeddings";
export const GRAFO = "motor-de-grafo";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fix = (name) => `engine-kit ensure ${name}`;
const message = (e) => e?.cause?.code ?? e?.message ?? String(e);

/**
 * Lê o anúncio do motor (`runtime.runtimeFile` do descritor) e confere a saúde. Sem `url` no anúncio, usa `port` (`http://127.0.0.1:<port>`); porta fora de 1..65535 é erro.
 * @param {string} name motor do manifest (`CASA` ou `GRAFO`).
 * @param {{manifest?:object}} [opts] descritor a usar (default: o manifest embarcado, sem rede).
 * @returns {Promise<{ok:true, url:string, shutdownToken?:string, version?:string, pid?:number, engine:object} | {ok:false, reason:string}>}
 */
export async function discover(name, { manifest = bundledManifest() } = {}) {
  const r = await resolve(name, { manifest });
  if (!r.ok) { return { ok: false, reason: r.reason }; }
  const rt = readRuntime(r.engine);
  const file = join(r.engine.homeDir, r.engine.runtime?.runtimeFile ?? "runtime.json");
  const port = rt?.port;
  const url = rt?.url ?? (port === undefined ? null : `http://127.0.0.1:${port}`);
  if (!url) { return { ok: false, reason: `${name} sem anúncio em ${file}: não está instalado ou não subiu → ${fix(name)}` }; }
  if (!rt.url && !(port > 0 && port < 65536 && Number.isInteger(port))) { return { ok: false, reason: `${name}: porta inválida ${JSON.stringify(port)} em ${file} (1..65535) → ${fix(name)}` }; }
  if (!(await probeHealth(url, r.engine.runtime?.healthPath)).ok) { return { ok: false, reason: `${name}: o anúncio em ${file} aponta ${url}, que não responde${rt.pid ? ` (pid ${rt.pid})` : ""} → ${fix(name)}` }; }
  return { ok: true, url, shutdownToken: rt[r.engine.runtime?.shutdownTokenField], version: rt.version, pid: rt.pid, engine: r.engine };
}

/** Sobe o executável instalado, sem janela, e o solta do processo do chamador. */
const launchDetached = (entryPath) => spawn(entryPath, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();

/**
 * Garante o motor instalado (engine-kit) e de pé: instala o que falta, sobe quem está parado e espera o anúncio.
 * @param {string} name `CASA` ou `GRAFO`.
 * @param {{launch?:(entryPath:string)=>void, bootTimeoutMs?:number}&object} [opts] o restante vai ao `ensureEngine` (registryUrl, fetcher, trustedKeys…); `launch` troca a subida (testes).
 * @returns {Promise<{ok:true, url:string, shutdownToken?:string, version?:string, installed?:string, updateAvailable?:string} | {ok:false, reason:string}>}
 */
export async function ensureHome(name, { launch = launchDetached, bootTimeoutMs = 60000, ...opts } = {}) {
  const e = await ensureEngine(name, { healthCheck: async (rt) => ((await probeHealth(rt.url)).ok ? rt : null), ...opts });
  if (!e.available) { return { ok: false, reason: e.reason }; }
  const manifest = { engines: [e.engine] };
  let d = await discover(name, { manifest });
  if (!d.ok) {
    const entry = join(e.engine.homeDir, e.engine.install.entry);
    try { launch(entry); } catch (err) { return { ok: false, reason: `${name}: não consegui subir ${entry} (${message(err)})` }; }
    for (const fim = Date.now() + bootTimeoutMs; !d.ok && Date.now() < fim; d = await discover(name, { manifest })) { await sleep(250); }
    if (!d.ok) { return { ok: false, reason: `${name}: ${entry} subiu mas não anunciou em ${bootTimeoutMs}ms: ${d.reason}` }; }
  }
  const { engine, ...rest } = d;
  return { ...rest, ok: true, installed: e.engine.installedVersion, ...(e.engine.updateAvailable ? { updateAvailable: e.engine.updateAvailable } : {}) };
}

/** Uma chamada HTTP JSON: `{ok:true, json, status}` ou `{ok:false, reason, status?, body?, retryAfter?}`. */
async function call(name, url, method, path, { body, headers = {}, token, timeoutMs = 30000 } = {}) {
  let res;
  try {
    res = await fetch(url + path, {
      method, signal: AbortSignal.timeout(timeoutMs),
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) { return { ok: false, reason: `${name} sem resposta em ${url}${path} (${message(e)}) → ${fix(name)}` }; }
  const json = await res.json().catch(() => null);
  if (res.status === 200 || res.status === 202) { return { ok: true, status: res.status, json }; }
  const detail = json?.detail ?? json;
  const code = (typeof detail === "object" ? detail?.code ?? detail?.error : null) ?? json?.code;
  const text = typeof detail === "string" ? detail : detail?.message ?? JSON.stringify(detail ?? "");
  const retry = Number(res.headers.get("retry-after"));
  return { ok: false, status: res.status, reason: `${name} respondeu HTTP ${res.status}${code ? ` ${code}` : ""}: ${text}`, body: json, ...(retry ? { retryAfter: retry } : {}) };
}

const foraDoContrato = (rota, o) => ({ ok: false, reason: `${CASA}: a resposta de ${rota} está fora do contrato (${o})` });
const numeros = (v) => Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n));

/**
 * Cliente da casa de embeddings: contratos abertos de /embed (TEI), /similarity (TEI) e /rerank (Cohere/Jina), com a resposta conferida.
 * @param {{url:string}} home resultado de `ensureHome`/`discover`.
 * @param {{timeoutMs?:number}} [opts]
 */
export function casaClient({ url }, { timeoutMs = 30000 } = {}) {
  const post = (path, body, priority) => call(CASA, url, "POST", path, { body, timeoutMs, headers: priority ? { "x-priority": priority } : {} });
  return {
    /** Saúde e identidade do espaço vetorial (`space_id`). */
    async info() { const r = await call(CASA, url, "GET", "/info", { timeoutMs }); return r.ok ? { ok: true, info: r.json } : r; },
    /** Um vetor normalizado por texto, na ordem do pedido. `priority`: `interactive` (busca) ou `bulk` (indexação). */
    async embed(texts, { priority } = {}) {
      const inputs = [].concat(texts);
      const r = await post("/embed", { inputs }, priority);
      if (!r.ok) { return r; }
      return Array.isArray(r.json) && r.json.length === inputs.length && r.json.every(numeros) ? { ok: true, vectors: r.json } : foraDoContrato("/embed", `esperava ${inputs.length} vetor(es) de números`);
    },
    /** Cosseno entre `source` e cada frase, pelos vetores de /embed; nada é guardado. */
    async similarity(source, sentences, { priority } = {}) {
      if (!Array.isArray(sentences) || !sentences.length) { return { ok: false, reason: `${CASA}: similarity pede pelo menos uma frase` }; }
      const r = await post("/similarity", { inputs: { source_sentence: source, sentences } }, priority);
      if (!r.ok) { return r; }
      return numeros(r.json) && r.json.length === sentences.length && r.json.every((n) => n >= -1 && n <= 1) ? { ok: true, scores: r.json } : foraDoContrato("/similarity", `esperava ${sentences.length} cosseno(s) em [-1, 1]`);
    },
    /** Documentos do mais ao menos relevante (`index`, `relevance_score`, `document`); o score só vale dentro da chamada. */
    async rerank(query, documents, { topN } = {}) {
      const r = await post("/rerank", { query, documents, ...(topN ? { top_n: topN } : {}) });
      if (!r.ok) { return r; }
      const lista = r.json?.results;
      const valido = Array.isArray(lista) && lista.every((x) => Number.isInteger(x?.index) && x.index >= 0 && x.index < documents.length && Number.isFinite(x.relevance_score))
        && new Set(lista.map((x) => x.index)).size === lista.length;
      if (!valido) { return foraDoContrato("/rerank", "índice repetido, fora do intervalo ou sem relevance_score"); }
      const results = lista.map((x) => ({ index: x.index, relevance_score: x.relevance_score, document: documents[x.index] }))
        .sort((a, b) => b.relevance_score - a.relevance_score || a.index - b.index);
      return { ok: true, results };
    },
  };
}

/**
 * Cliente do motor de grafo: REST v1 `graph/*`, path-autoritativo (o servidor deriva o projeto do `path`).
 * @param {{url:string, token?:string}} home resultado de `ensureHome`/`discover`; `token` vai como Bearer (modo equipe).
 * @param {{timeoutMs?:number}} [opts]
 */
export function grafoClient({ url, token }, { timeoutMs = 15000 } = {}) {
  const enviar = (sub, body) => call(GRAFO, url, "POST", `/api/v1/graph/${sub}`, { body, token, timeoutMs });
  const post = (sub, path, extra = {}) => enviar(sub, { path, ...extra });
  const lido = (r) => (r.ok ? { ok: true, result: r.json } : r);
  const leitura = (sub) => async (path, extra) => lido(await post(sub, path, extra));
  const exige = (campo, verbo, extra) => (extra?.[campo] ? null : { ok: false, reason: `${GRAFO}: ${verbo} exige '${campo}'` });
  const lista = (verbo, v) => (Array.isArray(v) && v.length ? null : { ok: false, reason: `${GRAFO}: ${verbo} exige uma lista com pelo menos um item` });
  const noGrafo = (sub, verbo, campo) => async (graph, valor) => exige("graph", verbo, { graph }) ?? lista(verbo, valor) ?? lido(await enviar(sub, { graph, [campo]: valor }));
  const doGrafo = (sub) => async (graph, extra) => exige("graph", sub, { graph }) ?? lido(await enviar(sub, { graph, ...extra }));
  const g = {
    status: async (path) => { const r = await post("status", path); return r.ok ? { ok: true, status: r.json } : r; },
    ingest: async (path) => { const r = await post("ingest", path); return r.ok ? { ok: true, accepted: r.status === 202 } : r; },
    symbols: leitura("symbols"),
    search: async (path, extra) => exige("query", "search", extra) ?? leitura("search")(path, extra),
    symbolsOf: doGrafo("symbols"),
    searchOf: async (graph, extra) => exige("query", "search", extra) ?? doGrafo("search")(graph, extra),
    kinds: async (definicao = {}) => lido(await enviar("kinds", definicao)),
    nodes: noGrafo("nodes", "nodes", "nodes"),
    edges: noGrafo("edges", "edges", "edges"),
    deleteNodes: noGrafo("nodes/delete", "deleteNodes", "ids"),
    deleteEdges: noGrafo("edges/delete", "deleteEdges", "edges"),
    neighbors: async (graph, id, extra) => exige("id", "neighbors", { id }) ?? doGrafo("neighbors")(graph, { id, ...extra }),
    backup: doGrafo("backup"),
    callers: async (path, extra) => exige("id", "callers", extra) ?? leitura("callers")(path, extra),
    callees: async (path, extra) => exige("id", "callees", extra) ?? leitura("callees")(path, extra),
    references: async (path, extra) => exige("id", "references", extra) ?? leitura("references")(path, extra),
    /**
     * Garante o grafo utilizável: `ready` lê direto; `not_indexed` ou `failed` ingere; espera em `indexing` até `ready`, `failed` ou o prazo.
     * Fila saturada (429) e raiz em conflito (409) voltam como erro visível, sem poll.
     */
    async ready(path, { refresh = false, intervalMs = 2000, deadlineMs = 180000 } = {}) {
      let s = await g.status(path);
      if (!s.ok) { return s; }
      const fim = Date.now() + deadlineMs;
      let ingeriu = false;
      while (s.status.state !== "ready" || (refresh && !ingeriu)) {
        const { state } = s.status;
        if (state === "failed" && ingeriu) { return { ok: false, reason: `${GRAFO}: a indexação de ${path} falhou: ${s.status.error ?? "sem detalhe"}` }; }
        if (state === "not_indexed" || state === "failed" || (state === "ready" && refresh)) {
          const i = await g.ingest(path);
          if (!i.ok) { return { ...i, detail: i.body }; }
          ingeriu = true;
        }
        if (Date.now() > fim) { return { ok: false, reason: `${GRAFO}: o prazo de ${deadlineMs}ms acabou com o grafo de ${path} em '${state}'` }; }
        await sleep(intervalMs);
        s = await g.status(path);
        if (!s.ok) { return s; }
      }
      return s;
    },
  };
  return g;
}
