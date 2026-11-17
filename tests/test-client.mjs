// test-client.mjs — cliente compartilhado da casa de embeddings e do motor de grafo (kit/client.mjs).
//
// Garantias: o anúncio é lido do `runtime.runtimeFile` do descritor e a saúde é conferida; casa ou motor fora do ar volta `{ok:false, reason}` que
// diz o que faltou e o comando que resolve (nada de fallback calado); `ensure` instala o que falta, sobe quem não está de pé e espera o anúncio;
// os pedidos de /embed, /similarity e /rerank cumprem os esquemas publicados pela casa (cópia em tests/contratos/casa) e uma resposta fora do
// contrato é recusada; o grafo segue a máquina de estados (status → ingest → poll até ready).
// Hermético: HOME e trust.json isolados, servidores falsos em 127.0.0.1:0, nenhum daemon real é tocado.
//
//   node tests/test-client.mjs
import "./_tmp.mjs";
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "engine-client-"));
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: join(RUN, "trust-home") });
const { generateKeyPairHex, signBlob } = await import("../kit/index.mjs");
const { tarBinary } = await import("../kit/provision.mjs");
const client = await import("../kit/client.mjs");
const { validate, loadSchema } = await import("../tools/schema-check.mjs");

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const CONTRATOS = join(import.meta.dirname, "contratos", "casa");
const contrato = (f) => JSON.parse(readFileSync(join(CONTRATOS, f), "utf8"));
const errosDe = (esquema, valor) => { const s = contrato(esquema); return validate(s, s, valor); };

const listen = (handler) => new Promise((ok) => { const s = createServer(handler); s.listen(0, "127.0.0.1", () => ok(s)); });
const lerCorpo = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b ? JSON.parse(b) : null)); });
const json = (res, status, corpo, headers = {}) => res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(corpo));
const urlDe = (s) => `http://127.0.0.1:${s.address().port}`;
const portaFechada = async () => { const s = await listen(() => {}); const u = urlDe(s); await new Promise((r) => s.close(r)); return u; };

console.log("== cliente compartilhado: casa de embeddings e motor de grafo ==\n");

console.log("-- os esquemas publicados valem para o que o teste usa como referência --");
{
  const ok = contrato("similarity-valida.json");
  check("fixture válida de similaridade passa nos esquemas de pedido e de resposta", errosDe("similarity-v1.request.schema.json", ok.pedido).length === 0 && errosDe("similarity-v1.response.schema.json", ok.resposta).length === 0,
    [...errosDe("similarity-v1.request.schema.json", ok.pedido), ...errosDe("similarity-v1.response.schema.json", ok.resposta)].join("; "));
  check("as fixtures inválidas reprovam no esquema do pedido",
    errosDe("similarity-v1.request.schema.json", contrato("similarity-invalida-sem-sentences.json").pedido).length > 0
    && errosDe("similarity-v1.request.schema.json", contrato("similarity-invalida-sentences-texto.json").pedido).length > 0);
  check("cosseno fora de [-1, 1] reprova no esquema da resposta", errosDe("similarity-v1.response.schema.json", [1.5]).length > 0);
}

// ---- casa falsa: valida cada pedido contra o esquema publicado e cada resposta que ela mesma dá --------------------------------------------
const pedidos = [];
let respostaTorta = null;
const casa = await listen(async (req, res) => {
  const corpo = req.method === "POST" ? await lerCorpo(req) : null;
  pedidos.push({ rota: `${req.method} ${req.url}`, corpo, prioridade: req.headers["x-priority"] });
  if (req.url === "/health") { return json(res, 200, { status: "ok" }); }
  if (req.url === "/info") { return json(res, 200, { version: "0.2.0", space_id: "sp1-teste", models: [{ dimension: 3 }] }); }
  if (respostaTorta) { return json(res, 200, respostaTorta); }
  if (req.url === "/embed") {
    const entradas = Array.isArray(corpo?.inputs) ? corpo.inputs : [corpo?.inputs];
    return json(res, 200, entradas.map((t) => [t.length, 1, 0]));
  }
  if (req.url === "/similarity") {
    if (errosDe("similarity-v1.request.schema.json", corpo).length) { return json(res, 422, { detail: "pedido fora do esquema" }); }
    return json(res, 200, corpo.inputs.sentences.map((s) => (s === corpo.inputs.source_sentence ? 1 : 0.1)));
  }
  if (req.url === "/rerank") {
    if (errosDe("rerank-host-v1.request.schema.json", corpo).length) { return json(res, 422, { detail: { error: "pedido_invalido", message: "fora do esquema" } }); }
    const results = corpo.documents.map((_, index) => ({ index, relevance_score: index === 1 ? 0.9 : 0.1 }));
    return json(res, 200, { results: corpo.top_n ? results.slice(0, corpo.top_n) : results });
  }
  return json(res, 404, { detail: "rota desconhecida" });
});

const homeCasa = join(RUN, "home-casa");
const anunciar = (home, url) => { mkdirSync(join(home, "run"), { recursive: true }); writeFileSync(join(home, "run", "daemon.json"), JSON.stringify({ url, port: Number(new URL(url).port), pid: process.pid, version: "0.2.0", shutdownToken: "t" })); };

const owner = generateKeyPairHex();
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const entrada = (name, home, extra = {}) => ({
  name, version: "1.0.0", kind: "cli", summary: "fixture", home, platforms: ["any"], pagesPendente: "fixture sem página própria",
  runtime: { runtimeFile: "run/daemon.json", healthPath: "/health", shutdownPath: "/admin/shutdown", shutdownTokenField: "shutdownToken", shutdownTokenHeader: "x-casa-token" },
  install: { type: "github-release", repo: "x/y", tag: `${name}-v{version}`, asset: `${name}.tgz`, checksum: "{asset}.sha256", extractTo: "bin", entry: `bin/${name}.exe`,
    publicKey: owner.publicKeyHex, signatureAlgorithm: "ed25519-sha256-raw", signatureRequired: true },
  ...extra,
});

console.log("\n-- descoberta pelo anúncio --");
{
  const m = { engines: [entrada("casa-de-embeddings", homeCasa)] };
  const sem = await client.discover("casa-de-embeddings", { manifest: m });
  check("sem anúncio: diz onde procurou e o comando que instala", !sem.ok && sem.reason.includes(join("run", "daemon.json")) && /engine-kit ensure casa-de-embeddings/.test(sem.reason), sem.reason);

  anunciar(homeCasa, await portaFechada());
  const morta = await client.discover("casa-de-embeddings", { manifest: m });
  check("anúncio aponta uma porta sem resposta: erro visível com a url", !morta.ok && /127\.0\.0\.1/.test(morta.reason) && /não responde/.test(morta.reason), morta.reason);

  anunciar(homeCasa, urlDe(casa));
  const viva = await client.discover("casa-de-embeddings", { manifest: m });
  check("anúncio vivo devolve url, versão e token de desligamento, sem entregá-lo como token de API", viva.ok && viva.url === urlDe(casa) && viva.version === "0.2.0" && viva.shutdownToken === "t" && viva.token === undefined, JSON.stringify(viva));

  const desconhecido = await client.discover("nao-existe", { manifest: m });
  check("motor fora do manifest: erro visível", !desconhecido.ok && /nao-existe/.test(desconhecido.reason), desconhecido.reason);
}

console.log("\n-- a casa: /embed, /similarity e /rerank conforme os esquemas publicados --");
{
  const c = client.casaClient({ url: urlDe(casa) });
  pedidos.length = 0;
  const e = await c.embed(["um", "dois"], { priority: "interactive" });
  check("embed devolve um vetor por texto", e.ok && e.vectors.length === 2 && e.vectors[1].length === 3, JSON.stringify(e));
  check("embed manda X-Priority e o corpo no formato do TEI", pedidos[0].prioridade === "interactive" && Array.isArray(pedidos[0].corpo.inputs));
  const eu = await c.embed("só um");
  check("embed aceita um texto só", eu.ok && eu.vectors.length === 1, JSON.stringify(eu));

  const s = await c.similarity("capital da França", ["capital da França", "bananas"]);
  check("similarity cumpre o esquema do pedido e devolve um cosseno por item", s.ok && s.scores.length === 2 && s.scores[0] === 1, JSON.stringify(s));
  check("o pedido de similarity validou no esquema publicado", errosDe("similarity-v1.request.schema.json", pedidos.at(-1).corpo).length === 0);

  const r = await c.rerank("pergunta", ["a", "b", "c"]);
  check("rerank devolve os resultados do mais ao menos relevante, com o documento", r.ok && r.results[0].index === 1 && r.results[0].document === "b" && r.results.length === 3, JSON.stringify(r));
  const r1 = await c.rerank("pergunta", ["a", "b", "c"], { topN: 1 });
  check("rerank com topN pede só esse tanto", r1.ok && r1.results.length === 1 && pedidos.at(-1).corpo.top_n === 1, JSON.stringify(r1));
  check("o pedido de rerank validou no esquema publicado", errosDe("rerank-host-v1.request.schema.json", pedidos.at(-1).corpo).length === 0);

  const vazio = await c.similarity("x", []);
  check("similarity sem frases é recusada antes de ir à rede", !vazio.ok && /pelo menos uma/.test(vazio.reason), vazio.reason);

  const i = await c.info();
  check("info traz o space_id", i.ok && i.info.space_id === "sp1-teste", JSON.stringify(i));

  respostaTorta = [[1, 2, 3]];
  const torta = await c.embed(["a", "b"]);
  check("resposta com quantidade de vetores fora do contrato é recusada", !torta.ok && /contrato/.test(torta.reason), torta.reason);
  respostaTorta = { results: [{ index: 7, relevance_score: 1 }] };
  const tortaRr = await c.rerank("q", ["a"]);
  check("rerank com índice fora do intervalo é recusado", !tortaRr.ok && /índice/.test(tortaRr.reason), tortaRr.reason);
  respostaTorta = [1.5];
  const tortaSim = await c.similarity("q", ["a"]);
  check("cosseno fora de [-1, 1] é recusado", !tortaSim.ok && /contrato/.test(tortaSim.reason), tortaSim.reason);
  respostaTorta = null;

  const fora = await client.casaClient({ url: await portaFechada() }).embed(["a"]);
  check("casa fora do ar: erro visível que cita a url e o comando", !fora.ok && /127\.0\.0\.1/.test(fora.reason) && /engine-kit ensure casa-de-embeddings/.test(fora.reason), fora.reason);
}

// ---- grafo falso: máquina de estados not_indexed → indexing → ready -------------------------------------------------------------------------
const estados = ["not_indexed", "indexing", "indexing", "ready"];
const chamadasGrafo = [];
let ingestRecusado = null;
const grafo = await listen(async (req, res) => {
  const corpo = req.method === "POST" ? await lerCorpo(req) : null;
  const sub = req.url.replace("/api/v1/graph/", "");
  chamadasGrafo.push({ sub, corpo, auth: req.headers.authorization });
  if (req.url === "/health") { return json(res, 200, { status: "ok" }); }
  if (!req.url.startsWith("/api/v1/graph/") || !corpo?.path) { return json(res, 400, { code: "BAD_FIELD", message: "path obrigatório" }); }
  if (sub === "status") { return json(res, 200, { state: estados.length > 1 ? estados.shift() : estados[0], nodes: 4, edges: 7 }); }
  if (sub === "ingest") { return ingestRecusado ? json(res, ingestRecusado.status, ingestRecusado.corpo, { "retry-after": "5" }) : json(res, 202, { state: "indexing" }); }
  if (sub === "symbols") { return json(res, 200, { symbols: [{ id: "a.js::f", name: "f" }] }); }
  if (sub === "search") { return json(res, 200, { seed: [{ id: "a.js::f" }], expanded: [] }); }
  if (sub === "callers" || sub === "callees" || sub === "references") { return json(res, 200, { [sub]: [{ id: "b.js::g" }] }); }
  return json(res, 404, { code: "SUBPATH_OR_API_MISSING" });
});

console.log("\n-- o grafo: leituras e a máquina de estados --");
{
  const g = client.grafoClient({ url: urlDe(grafo), token: "segredo" });
  const pronto = await g.ready("C:/projeto", { intervalMs: 5, deadlineMs: 5000 });
  check("ready dispara o ingest e espera até ready", pronto.ok && pronto.status.state === "ready" && chamadasGrafo.some((c) => c.sub === "ingest"), JSON.stringify(pronto));
  check("todo pedido leva o path e o token como Bearer", chamadasGrafo.filter((c) => c.sub !== undefined && c.corpo).every((c) => c.corpo.path === "C:/projeto" && c.auth === "Bearer segredo"));

  chamadasGrafo.length = 0;
  const jaPronto = await g.ready("C:/projeto", { intervalMs: 5 });
  check("grafo já pronto: lê direto, sem novo ingest", jaPronto.ok && !chamadasGrafo.some((c) => c.sub === "ingest"), chamadasGrafo.map((c) => c.sub).join(","));

  const sy = await g.symbols("C:/projeto", { query: "f", limit: 5 });
  check("symbols devolve a lista", sy.ok && sy.result.symbols[0].name === "f", JSON.stringify(sy));
  const se = await g.search("C:/projeto", { query: "f" });
  check("search devolve semente e vizinhança", se.ok && se.result.seed.length === 1, JSON.stringify(se));
  for (const verbo of ["callers", "callees", "references"]) {
    const r = await g[verbo]("C:/projeto", { id: "a.js::f" });
    check(`${verbo} do nó devolve as arestas`, r.ok && r.result[verbo].length === 1, JSON.stringify(r));
  }
  const semId = await g.callers("C:/projeto", {});
  check("callers sem id é recusado antes de ir à rede", !semId.ok && /id/.test(semId.reason), semId.reason);
  const semQuery = await g.search("C:/projeto", {});
  check("search sem query é recusado antes de ir à rede", !semQuery.ok && /query/.test(semQuery.reason), semQuery.reason);

  estados.splice(0, estados.length, "not_indexed");
  ingestRecusado = { status: 429, corpo: { code: "QUEUE_SATURATED", message: "fila cheia" } };
  const cheia = await g.ready("C:/projeto", { intervalMs: 5 });
  check("fila saturada (429) volta como erro visível com o Retry-After, sem poll", !cheia.ok && /QUEUE_SATURATED/.test(cheia.reason) && cheia.retryAfter === 5, JSON.stringify(cheia));
  ingestRecusado = { status: 409, corpo: { code: "ROOT_CONFLICT", message: "outra raiz", mappedRoot: "D:/x" } };
  const conflito = await g.ready("C:/projeto", { intervalMs: 5 });
  check("409 de raiz em conflito traz o código e a raiz mapeada", !conflito.ok && /ROOT_CONFLICT/.test(conflito.reason) && conflito.detail?.mappedRoot === "D:/x", JSON.stringify(conflito));
  ingestRecusado = null;

  estados.splice(0, estados.length, "not_indexed", "indexing");
  const lento = await g.ready("C:/projeto", { intervalMs: 5, deadlineMs: 30 });
  check("prazo estourado: erro visível, nunca poll infinito", !lento.ok && /prazo/.test(lento.reason), JSON.stringify(lento));

  const fora = await client.grafoClient({ url: await portaFechada() }).symbols("C:/projeto", {});
  check("motor fora do ar: erro visível que cita o comando", !fora.ok && /engine-kit ensure motor-de-grafo/.test(fora.reason), fora.reason);
}

// ---- ensure: instala o que falta, sobe quem não está de pé e espera o anúncio -------------------------------------------------------------
console.log("\n-- ensure: instala, sobe e espera o anúncio --");
{
  const nome = "casa-de-embeddings";
  const home = join(RUN, "home-ensure");
  const tgz = (() => {
    const src = join(RUN, "src-casa");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "package.json"), JSON.stringify({ name: nome, version: "1.0.0" }));
    writeFileSync(join(src, `${nome}.exe`), "binario falso");
    execFileSync(tarBinary(), ["-czf", `${src}.tgz`, "-C", src, "."], { stdio: "ignore", windowsHide: true });
    return readFileSync(`${src}.tgz`);
  })();
  const base = `https://github.com/x/y/releases/download/${nome}-v1.0.0`;
  const arquivos = { [`${base}/${nome}.tgz`]: tgz, [`${base}/${nome}.tgz.sha256`]: Buffer.from(`${sha256(tgz)}  ${nome}.tgz\n`), [`${base}/${nome}.tgz.sig`]: signBlob(tgz, owner.privateKeyHex) };
  const baixados = [];
  const fetcher = async (url) => { baixados.push(url); if (!(url in arquivos)) { const e = new Error("HTTP 404"); e.status = 404; throw e; } return arquivos[url]; };

  const registry = (status) => JSON.stringify({ engines: [entrada(nome, home, status ? { status } : {})] });
  let corpo = registry();
  const servidor = await listen((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(corpo));
  const registryUrl = `${urlDe(servidor)}/manifest.json`;

  const lancamentos = [];
  const launch = (entryPath) => { lancamentos.push(entryPath); anunciar(home, urlDe(casa)); };

  const r = await client.ensureHome(nome, { registryUrl, fetcher, launch, refresh: true, bootTimeoutMs: 5000 });
  check("instala, sobe pelo executável instalado e devolve o anúncio", r.ok && r.url === urlDe(casa) && lancamentos.length === 1 && lancamentos[0].endsWith(`${nome}.exe`) && baixados.length === 3, JSON.stringify(r));

  baixados.length = 0; lancamentos.length = 0;
  const de = await client.ensureHome(nome, { registryUrl, fetcher, launch, refresh: true });
  check("já instalada e de pé: nada baixa nem sobe de novo", de.ok && lancamentos.length === 0 && baixados.length === 0, JSON.stringify(de));

  rmSync(join(home, "run"), { recursive: true, force: true });
  const sobe = await client.ensureHome(nome, { registryUrl, fetcher, launch, refresh: true });
  check("instalada e fora do ar: só sobe, sem baixar", sobe.ok && lancamentos.length === 1 && baixados.length === 0, JSON.stringify(sobe));

  rmSync(join(home, "run"), { recursive: true, force: true });
  const mudo = await client.ensureHome(nome, { registryUrl, fetcher, launch: () => {}, refresh: true, bootTimeoutMs: 200 });
  check("o executável sobe e não anuncia: erro visível com o prazo e o caminho", !mudo.ok && /não anunciou/.test(mudo.reason) && mudo.reason.includes(`${nome}.exe`), mudo.reason);

  corpo = registry("pending-release");
  rmSync(home, { recursive: true, force: true });
  const sem = await client.ensureHome(nome, { registryUrl, fetcher, launch, refresh: true });
  check("release que ainda não saiu: erro visível do kit, sem subir nada", !sem.ok && /pending-release/.test(sem.reason), sem.reason);
  servidor.close();
}

casa.close(); grafo.close();
rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
