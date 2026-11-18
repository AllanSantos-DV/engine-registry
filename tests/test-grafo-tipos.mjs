// test-grafo-tipos.mjs — o grafoClient do kit fala as rotas de tipos do motor-de-grafo (kinds, nodes, edges, nodes/delete, edges/delete,
// neighbors, backup e o filtro `kinds`/`where` de symbols e search), com os pedidos conferidos contra os esquemas e fixtures publicados pelo motor
// (cópia em tests/contratos/grafo).
// Hermético: servidor falso em 127.0.0.1:0, nenhum daemon real é tocado.
//
//   node tests/test-grafo-tipos.mjs
import "./_tmp.mjs";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const { grafoClient } = await import("../kit/client.mjs");
const { validate } = await import("../tools/schema-check.mjs");

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const DIR = join(import.meta.dirname, "contratos", "grafo");
const ler = (f) => JSON.parse(readFileSync(join(DIR, f), "utf8"));
const comProjeto = (v) => JSON.parse(JSON.stringify(v).replaceAll("${PROJECT_ID}", "projeto-1").replaceAll("${RAIZ}", "C:/projeto"));
const erros = (rota, lado, valor) => { const s = ler(`${rota}.${lado}.schema.json`); return validate(s, s, valor); };
const validos = (rota) => comProjeto(ler(`${rota}.request.valid.json`));
const invalidos = (rota) => comProjeto(ler(`${rota}.request.invalid.json`));

console.log("== grafoClient: rotas de tipos do motor-de-grafo ==\n");

const recebidos = [];
let resposta = (sub) => ({ status: 200, corpo: { ok: sub } });
const servidor = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    let b = ""; for await (const c of req) { b += c; }
    const sub = req.url.replace("/api/v1/graph/", "");
    recebidos.push({ sub, corpo: b ? JSON.parse(b) : null, auth: req.headers.authorization });
    const r = resposta(sub);
    res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.corpo));
  });
  s.listen(0, "127.0.0.1", () => ok(s));
});
const url = `http://127.0.0.1:${servidor.address().port}`;
const g = grafoClient({ url, token: "segredo" });
const ultimo = () => recebidos.at(-1);

console.log("-- os esquemas copiados reprovam o que o motor reprova --");
for (const rota of ["kinds", "nodes", "edges", "nodes-delete", "edges-delete", "neighbors", "backup", "symbols", "search"]) {
  const bons = validos(rota), maus = invalidos(rota);
  check(`${rota}: toda fixture válida passa e toda inválida reprova no esquema`,
    bons.every((f) => erros(rota, "request", f.corpo).length === 0) && maus.every((f) => erros(rota, "request", f.corpo).length > 0),
    [...bons.filter((f) => erros(rota, "request", f.corpo).length), ...maus.filter((f) => !erros(rota, "request", f.corpo).length)].map((f) => f.nome).join(", "));
}

console.log("\n-- cada verbo manda à rota certa o corpo que o esquema aceita --");
const verbos = {
  kinds: { rota: "kinds", chama: (c) => g.kinds(c.corpo) },
  nodes: { rota: "nodes", chama: (c) => g.nodes(c.corpo.graph, c.corpo.nodes) },
  edges: { rota: "edges", chama: (c) => g.edges(c.corpo.graph, c.corpo.edges) },
  "nodes-delete": { rota: "nodes/delete", chama: (c) => g.deleteNodes(c.corpo.graph, c.corpo.ids) },
  "edges-delete": { rota: "edges/delete", chama: (c) => g.deleteEdges(c.corpo.graph, c.corpo.edges) },
  neighbors: { rota: "neighbors", chama: ({ corpo: { graph, id, ...extra } }) => g.neighbors(graph, id, extra) },
  backup: { rota: "backup", chama: (c) => g.backup(c.corpo.graph) },
};
for (const [fixture, { rota, chama }] of Object.entries(verbos)) {
  for (const caso of validos(fixture)) {
    recebidos.length = 0;
    const r = await chama(caso);
    const c = ultimo();
    check(`${rota} (${caso.nome}): corpo igual ao da fixture, na rota e com o Bearer`, r.ok && c?.sub === rota && JSON.stringify(c.corpo) === JSON.stringify(caso.corpo) && c.auth === "Bearer segredo", JSON.stringify(c) + JSON.stringify(r));
    check(`${rota} (${caso.nome}): o que saiu cumpre o esquema do pedido`, erros(fixture, "request", c.corpo).length === 0, erros(fixture, "request", c.corpo).join("; "));
  }
}

console.log("\n-- leitura dos outros tipos por symbols e search --");
for (const caso of validos("symbols").filter((f) => f.corpo.graph)) {
  recebidos.length = 0;
  const { graph, ...extra } = caso.corpo;
  await g.symbolsOf(graph, extra);
  check(`symbolsOf (${caso.nome}): vai com graph e sem path`, ultimo().sub === "symbols" && ultimo().corpo.graph === graph && !("path" in ultimo().corpo) && JSON.stringify(ultimo().corpo) === JSON.stringify(caso.corpo));
}
for (const caso of validos("search").filter((f) => f.corpo.graph)) {
  recebidos.length = 0;
  const { graph, ...extra } = caso.corpo;
  await g.searchOf(graph, extra);
  check(`searchOf (${caso.nome}): vai com graph e sem path`, ultimo().sub === "search" && !("path" in ultimo().corpo) && JSON.stringify(ultimo().corpo) === JSON.stringify(caso.corpo));
}
for (const caso of validos("symbols").filter((f) => f.corpo.kinds && f.corpo.path)) {
  recebidos.length = 0;
  const { path, ...extra } = caso.corpo;
  await g.symbols(path, extra);
  check(`symbols (${caso.nome}): o filtro kinds passa junto com o path`, JSON.stringify(ultimo().corpo) === JSON.stringify(caso.corpo));
}
{
  const r = await g.searchOf("projeto-1", { kinds: ["nota"] });
  check("searchOf sem query: recusa antes de chamar, dizendo o campo", !r.ok && /search exige 'query'/.test(r.reason), r.reason);
}

console.log("\n-- entrada ruim é recusada antes de sair --");
recebidos.length = 0;
const recusas = [
  ["nodes sem grafo", await g.nodes("", [{ id: "nota:a", kind: "nota", name: "A" }]), /nodes exige 'graph'/],
  ["nodes com lista vazia", await g.nodes("projeto-1", []), /nodes exige uma lista/],
  ["nodes fora de lista", await g.nodes("projeto-1", { id: "nota:a" }), /nodes exige uma lista/],
  ["edges com lista vazia", await g.edges("projeto-1", []), /edges exige uma lista/],
  ["deleteNodes com lista vazia", await g.deleteNodes("projeto-1", []), /deleteNodes exige uma lista/],
  ["neighbors sem id", await g.neighbors("projeto-1", ""), /neighbors exige 'id'/],
  ["backup sem grafo", await g.backup(undefined), /backup exige 'graph'/],
];
for (const [nome, r, padrao] of recusas) { check(`${nome}: erro visível`, !r.ok && padrao.test(r.reason), r.reason); }
check("nenhuma recusa local chegou ao servidor", recebidos.length === 0, String(recebidos.length));

console.log("\n-- erro do motor aparece com status e código, sem virar sucesso --");
const caso = (rota, nome) => ler(`${rota}.response.json`).find((c) => c.nome === nome);
for (const [rota, verbo, nome] of [["nodes", () => g.nodes("projeto-1", [{ id: "livro:1", kind: "livro", name: "L" }]), "erro_tipo_desconhecido"]]) {
  const falso = caso(rota, nome);
  resposta = () => ({ status: falso.http, corpo: falso.corpo });
  const r = await verbo();
  check(`${rota}: HTTP ${falso.http} do motor volta como erro com o código`, !r.ok && r.status === falso.http && r.reason.includes(`HTTP ${falso.http}`) && r.reason.includes(falso.corpo.code), r.reason);
}
resposta = () => ({ status: 409, corpo: { code: "KIND_OWNED", error: "kind pertence a outro produto" } });
{
  const r = await g.kinds({ name: "nota", owner: "outro" });
  check("kinds: 409 KIND_OWNED volta como erro visível", !r.ok && r.status === 409 && /KIND_OWNED/.test(r.reason), r.reason);
}
resposta = () => ({ status: 200, corpo: { kinds: [{ name: "code" }] } });
{
  const r = await g.kinds();
  check("kinds sem argumento lista o catálogo (corpo {})", r.ok && r.result.kinds[0].name === "code" && JSON.stringify(ultimo().corpo) === "{}", JSON.stringify(ultimo().corpo));
}

servidor.close();
console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
