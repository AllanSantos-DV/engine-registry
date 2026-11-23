// test-contrato-vivo.mjs — `tools/contrato-vivo.mjs` prova um daemon contra o contrato aberto pelos pedidos e esquemas de tests/contratos.
//
// O que precisa ser verdade:
//   • um daemon que responde como os exemplos do contrato passa em todos os casos (casa e grafo);
//   • resposta fora do contrato reprova só o caso dela e nomeia o motivo: cosseno a menos, pedido inválido aceito, índice repetido no rerank,
//     tipo "code" ausente na lista de tipos, erro sem "code";
//   • daemon que não responde reprova com o motivo, sem derrubar os demais casos;
//   • motor sem contrato aberto é recusado; motor que não está vivo termina com exit 2 sem tentar subi-lo;
//   • o validador de esquemas implementa `else` (os esquemas do grafo o usam) em vez de lançar ou ignorar.
// Hermético: o daemon é um servidor HTTP local de memória; nada toca motor real.
//
//   node tests/test-contrato-vivo.mjs
import "./_tmp.mjs";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { provar, run } from "../tools/contrato-vivo.mjs";
import { validate } from "../tools/schema-check.mjs";

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const ler = (f) => JSON.parse(readFileSync(new URL(`./contratos/${f}`, import.meta.url), "utf8"));
const kindsLista = ler("grafo/kinds.response.json").find((c) => c.nome === "lista").corpo;
const naoIndexado = ler("grafo/search.response.json").find((c) => c.nome === "nao_indexado").corpo;
const buscaReq = ler("grafo/search.request.schema.json");
const erroBusca = ler("grafo/search.response.json").find((c) => c.nome === "erro_sem_query").corpo;

/** Daemon de memória; `desvio` troca o comportamento de uma rota para provar que o caso certo reprova. */
async function daemon(desvio = {}) {
  const rotas = {
    "GET /info": () => [200, { space_id: "abc", dim: 3 }],
    "POST /embed": (b) => [200, b.inputs.map((_, i) => [0.1 * (i + 1), 0.2, 0.3])],
    "POST /similarity": (b) => (Array.isArray(b?.inputs?.sentences) ? [200, b.inputs.sentences.map(() => 0.5)] : [400, { error: "inputs.sentences obrigatório" }]),
    "POST /rerank": (b) => [200, { results: b.documents.map((_, i) => ({ index: i, relevance_score: 1 - i * 0.1 })) }],
    "POST /api/v1/graph/kinds": () => [200, kindsLista],
    "POST /api/v1/graph/search": (b) => (validate(buscaReq, buscaReq, b).length ? [400, erroBusca] : [200, naoIndexado]),
    ...desvio,
  };
  const autorizacoes = new Set();
  const server = createServer((req, res) => {
    autorizacoes.add(req.headers.authorization);
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const h = rotas[`${req.method} ${req.url}`];
      if (!h) { res.writeHead(404).end("{}"); return; }
      const out = h(raw ? JSON.parse(raw) : {});
      if (out === "mudo") { res.destroy(); return; }
      res.writeHead(out[0], { "content-type": "application/json" }).end(JSON.stringify(out[1]));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, autorizacoes, close: () => server.close() };
}
const item = (r, id) => r.itens.find((i) => i.id === id);

console.log("== contrato-vivo ==\n");

{
  const d = await daemon();
  const casa = await provar("casa-de-embeddings", d);
  check("casa que responde como o contrato passa em todos os casos", casa.ok && casa.itens.length === 6 && casa.itens.every((i) => i.status === "OK"), JSON.stringify(casa.itens.filter((i) => i.status !== "OK")));
  const grafo = await provar("motor-de-grafo", d);
  check("grafo que responde como o contrato passa em todos os casos, inclusive os pedidos inválidos recusados", grafo.ok && grafo.itens.length >= 5 && grafo.itens.every((i) => i.status === "OK"), JSON.stringify(grafo.itens.filter((i) => i.status !== "OK")));
  check("os pedidos inválidos do contrato viram casos próprios", grafo.itens.some((i) => i.id === "search-sem_query") && grafo.itens.some((i) => i.id === "search-campo_desconhecido"));
  d.close();
}

{
  const d = await daemon({ "POST /similarity": (b) => (Array.isArray(b?.inputs?.sentences) ? [200, [0.5]] : [200, [0.5]]) });
  const r = await provar("casa-de-embeddings", d);
  check("cosseno a menos reprova o similarity", !r.ok && item(r, "similarity").status === "FALHA" && /um cosseno por frase/.test(item(r, "similarity").detalhe), JSON.stringify(item(r, "similarity")));
  check("pedido inválido aceito (200) reprova os dois casos de recusa", item(r, "similarity-sem-sentences").status === "FALHA" && item(r, "similarity-sentences-texto").status === "FALHA" && /4xx/.test(item(r, "similarity-sem-sentences").detalhe));
  check("os outros casos seguem passando", item(r, "info").status === "OK" && item(r, "embed").status === "OK" && item(r, "rerank").status === "OK");
  d.close();
}

{
  const d = await daemon({ "POST /rerank": () => [200, { results: [{ index: 0, relevance_score: 1 }, { index: 0, relevance_score: 0.5 }] }], "POST /embed": () => [200, [[1, 2], [1]]] });
  const r = await provar("casa-de-embeddings", d);
  check("índice repetido no rerank reprova", item(r, "rerank").status === "FALHA" && /repetido/.test(item(r, "rerank").detalhe));
  check("vetores de tamanhos diferentes reprovam o embed", item(r, "embed").status === "FALHA");
  d.close();
}

{
  const d = await daemon({ "POST /api/v1/graph/kinds": () => [200, { kinds: [] }], "POST /api/v1/graph/search": (b) => (validate(buscaReq, buscaReq, b).length ? [400, { error: "x" }] : [200, naoIndexado]) });
  const r = await provar("motor-de-grafo", d);
  check("lista de tipos sem o tipo embutido code reprova", item(r, "kinds-listar").status === "FALHA" && /"code"/.test(item(r, "kinds-listar").detalhe));
  check("erro sem o campo code reprova os casos inválidos e nomeia o motivo", item(r, "search-sem_query").status === "FALHA" && /"code"/.test(item(r, "search-sem_query").detalhe));
  check("a busca válida segue passando", item(r, "search-raiz-nao-indexada").status === "OK");
  d.close();
}

{
  const d = await daemon({ "GET /info": () => "mudo" });
  const r = await provar("casa-de-embeddings", d, { timeoutMs: 2000 });
  check("daemon que derruba a conexão reprova só o caso, com o motivo", item(r, "info").status === "FALHA" && /sem resposta de \/info/.test(item(r, "info").detalhe) && item(r, "embed").status === "OK", JSON.stringify(item(r, "info")));
  d.close();
}

{
  let lancou = "";
  try { await provar("vxk", { url: "http://127.0.0.1:1" }); } catch (e) { lancou = e.message; }
  check("motor sem contrato aberto é recusado nomeando os aceitos", /não tem contrato aberto/.test(lancou) && /casa-de-embeddings/.test(lancou), lancou);
  const erros = [], saida = [];
  const io = { log: (m) => saida.push(m), error: (m) => erros.push(m) };
  check("motor que não está vivo: exit 2, diz que o comando não o sobe", (await run(["casa-de-embeddings"], { ...io, achar: async () => ({ ok: false, reason: "sem anúncio" }) })) === 2 && /não está vivo/.test(erros.at(-1)) && /não sobe/.test(erros.at(-1)));
  check("sem motor ou com flag desconhecida: uso e exit 2", (await run([], io)) === 2 && (await run(["casa-de-embeddings", "--x"], io)) === 2 && /uso:/.test(erros.at(-1)));
  const d = await daemon();
  const ok = await run(["casa-de-embeddings", "--json"], { ...io, achar: async () => ({ ok: true, url: d.url }) });
  check("daemon conforme: exit 0 e JSON com ok:true", ok === 0 && JSON.parse(saida.at(-1)).ok === true);
  const d2 = await daemon({ "POST /rerank": () => [200, { results: [] , nao: 1 }], "GET /info": () => [200, []] });
  const ruim = await run(["casa-de-embeddings"], { ...io, achar: async () => ({ ok: true, url: d2.url }) });
  check("daemon fora do contrato: exit 1 e o texto diz quantos casos", ruim === 1 && /caso\(s\) fora do contrato/.test(saida.at(-1)), saida.at(-1));
  const d3 = await daemon();
  const semAnuncio = async () => { throw new Error("o anúncio não deve ser consultado com --url"); };
  const comUrl = await run(["motor-de-grafo", "--url", d3.url, "--token-stdin", "--json"], { ...io, achar: semAnuncio, lerToken: async () => "segredo-de-equipe" });
  check("--url prova o endereço dado sem consultar o anúncio, com o token da entrada como Bearer", comUrl === 0 && JSON.parse(saida.at(-1)).ok === true && d3.autorizacoes.has("Bearer segredo-de-equipe") && !d3.autorizacoes.has("Bearer undefined"), [...d3.autorizacoes].join(","));
  check("--url sem token não manda cabeçalho de autorização", await (async () => { const d4 = await daemon(); await run(["casa-de-embeddings", "--url", d4.url], { ...io, achar: semAnuncio }); const so = [...d4.autorizacoes].every((a) => a === undefined); d4.close(); return so; })());
  check("--url com valor inválido ou --token-stdin sem --url: uso e exit 2", (await run(["motor-de-grafo", "--url", "nao-e-url"], io)) === 2 && (await run(["motor-de-grafo", "--token-stdin"], io)) === 2 && /uso:/.test(erros.at(-1)));
  check("o token nunca aparece na saída", !saida.concat(erros).some((m) => String(m).includes("segredo-de-equipe")));
  d3.close();
  d.close(); d2.close();
}

{
  const { mkdtempSync, readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dados = mkdtempSync(join(tmpdir(), "dados-"));
  const antes = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = dados;
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const arvore = (d) => readdirSync(d, { recursive: true }).sort().join("|");
  const d = await daemon();
  await provar("motor-de-grafo", { url: d.url });
  const primeira = arvore(dados);
  await provar("motor-de-grafo", { url: d.url });
  await provar("motor-de-grafo", { url: d.url });
  check("a busca de prova usa uma pasta estável por versão do kit, em LOCALAPPDATA", primeira.split("|").includes(join("engine-kit", "contrato-vivo", `v${version}`)), primeira);
  check("uma segunda rodada com a mesma entrada não cria arquivo nem pasta nova", arvore(dados) === primeira, `${primeira} → ${arvore(dados)}`);
  d.close();
  if (antes === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = antes;
}

{
  const esquema = { type: "object", if: { required: ["a"] }, then: { required: ["b"] }, else: { required: ["c"] } };
  check("o validador aplica o then quando o if casa", validate(esquema, esquema, { a: 1 }).some((e) => /falta "b"/.test(e)) && validate(esquema, esquema, { a: 1, b: 2 }).length === 0);
  check("o validador aplica o else quando o if não casa (antes lançava palavra-chave não suportada)", validate(esquema, esquema, { x: 1 }).some((e) => /falta "c"/.test(e)) && validate(esquema, esquema, { c: 1 }).length === 0);
}

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
