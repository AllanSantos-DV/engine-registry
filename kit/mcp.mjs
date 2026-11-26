// engine-kit/mcp.mjs — `engine-kit mcp`: servidor MCP (stdio, JSON-RPC por linha) com os verbos de LEITURA do kit.
// Ferramental: nunca importado por consumidor. Nenhuma tool instala, atualiza, fixa, desliga ou reverte: ensure, pin, stop, update, rollback e trust --restaurar ficam de fora.
// Só leem do disco, sem gravar, e só duas falam com o registry (engine_plan e engine_check com `rede`): a consulta atualiza o cache do descritor em ~/.engine-kit, a única escrita, e nenhum artefato é baixado.
import { createInterface } from "node:readline";
import { listCommand, ensureCommand, planoEm } from "./ensure.mjs";
import { exportCommand } from "./export-import.mjs";
import { historyCommand, checkCommand, trustCommand, pathCommand, urlCommand, reportCommand, infoCommand } from "./inspect.mjs";
import { ownVersion, autoUpdateEnabled } from "./update.mjs";
import { diagnoseEngines, engineView } from "./diagnose.mjs";

const VERSOES = ["2025-06-18", "2025-03-26", "2024-11-05"];
const str = (description) => ({ type: "string", description });
const bool = (description) => ({ type: "boolean", description });
const esquema = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });

/** As tools expostas: nome, descrição, esquema de entrada e a função que devolve o resultado do verbo. `run(args, opts)` recebe as opções de teste do `handleMessage` (`bundled`, `manifest`, `registryUrl`). */
export const TOOLS = [
  { name: "engine_list", description: "Motores do pacote, plataformas que atendem e o que está instalado aqui (sem rede); com `apps` true acrescenta os apps do manifest.", inputSchema: esquema({ apps: bool("true = acrescenta o campo apps (nome, versão, plataformas e pin de cada app)") }), run: (a, o) => listCommand({ apps: a.apps === true, bundled: o.bundled }) },
  { name: "engine_history", description: "Trocas de versão gravadas nesta máquina, opcionalmente de um motor.", inputSchema: esquema({ engine: str("motor") }), run: (a) => historyCommand(a.engine) },
  { name: "engine_check", description: "Confere o bloco `engines` de um manifesto de plugin contra o instalado; sem rede, a menos que `rede` seja true.", inputSchema: esquema({ manifest: str("caminho do manifesto do plugin"), rede: bool("true = consulta o registry (usa a rede e atualiza o cache do descritor) e diz se a versão publicada satisfaz a faixa do que falta ou está fora dela") }, ["manifest"]), run: (a, o) => checkCommand(a.manifest, { rede: a.rede === true, manifest: o.manifest, registryUrl: o.registryUrl }) },
  { name: "engine_path", description: "Caminho do executável de um motor instalado e o estado do cli.json dele.", inputSchema: esquema({ engine: str("motor") }, ["engine"]), run: (a) => pathCommand(a.engine) },
  { name: "engine_url", description: "Endereço do daemon vivo de um motor (url, versão, pid); nunca o token.", inputSchema: esquema({ engine: str("motor") }, ["engine"]), run: (a) => urlCommand(a.engine) },
  { name: "engine_trust", description: "O que o trust.json guarda por motor (só chave pública), sem gravar.", inputSchema: esquema({ engine: str("motor") }), run: (a) => trustCommand(a.engine) },
  { name: "engine_doctor", description: "Diagnóstico de cada motor do manifest, como o `doctor --json --local`: estado, detalhe, avisos, pin, vida e ponteiro (sem rede); `engine` limita a um motor e `verify` true confere a integridade dos arquivos instalados (ADULTERADO).", inputSchema: esquema({ engine: str("só este motor"), verify: bool("true = confere o sha256 dos arquivos instalados contra o registro da extração (só lê)") }), run: async (a, o) => { const d = await diagnoseEngines({ local: true, only: a.engine, verify: a.verify === true, manifest: o.manifest }); return d.ok ? { ok: true, engines: await Promise.all(d.rows.map(engineView)) } : d; } },
  { name: "engine_info", description: "Descritor, versão no manifest, versão instalada, estado, pin, plataformas e release de um motor (sem rede).", inputSchema: esquema({ engine: str("motor") }, ["engine"]), run: (a, o) => infoCommand(a.engine, { bundled: o.bundled }) },
  { name: "engine_plan", description: "O que o `ensure` faria com um motor (instalar, atualizar, reusar ou manter), como o `ensure --dry-run`. Usa a rede: consulta o registry e atualiza o cache do descritor em ~/.engine-kit; não baixa artefato, não instala e não grava histórico.", inputSchema: esquema({ engine: str("motor") }, ["engine"]), run: async (a, o) => { const r = await ensureCommand(a.engine, { bundled: o.bundled, manifest: o.manifest, registryUrl: o.registryUrl, autoUpdate: autoUpdateEnabled(), dryRun: true }); return r.ok ? { ...r, detail: planoEm(r) } : r; } },
  { name: "engine_export", description: "O documento do `engine-kit export` (formato, kit e, por motor instalado, nome, versão e pin), o mesmo que o `import -` aceita; só devolve, nunca grava arquivo (sem rede).", inputSchema: esquema(), run: (_a, o) => { const r = exportCommand(undefined, { bundled: o.bundled }); return r.ok ? r.doc : r; } },
  { name: "engine_report", description: "Texto de suporte: kit, Node, plataforma, estado de cada motor (sem rede, sem token nem chave).", inputSchema: esquema(), run: () => reportCommand({ local: true }) },
];

const reply = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

/**
 * Responde a uma mensagem JSON-RPC. Notificação (sem `id`) não tem resposta (`null`). Tool com argumento inválido ou verbo que devolve `ok:false` volta como `isError:true` com o motivo.
 * @param {object} msg mensagem já parseada.
 * @param {{bundled?:object, manifest?:object, registryUrl?:string}=} opts injeção de teste, repassada às tools: manifest embarcado, manifest dos motores e registry.
 * @returns {Promise<object|null>}
 */
export async function handleMessage(msg, opts = {}) {
  const { id, method, params } = msg ?? {};
  if (id === undefined || id === null) { return null; }
  if (method === "initialize") {
    const pedida = params?.protocolVersion;
    return reply(id, { protocolVersion: VERSOES.includes(pedida) ? pedida : VERSOES[0], capabilities: { tools: {} }, serverInfo: { name: "engine-kit", version: ownVersion() } });
  }
  if (method === "ping") { return reply(id, {}); }
  if (method === "tools/list") { return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }); }
  if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) { return fail(id, -32602, `tool desconhecida: ${params?.name}`); }
    const args = params?.arguments ?? {};
    const faltando = tool.inputSchema.required.find((k) => typeof args[k] !== "string" || !args[k]);
    const invalido = Object.keys(args).find((k) => !(k in tool.inputSchema.properties));
    const tipoErrado = Object.keys(args).find((k) => typeof args[k] !== tool.inputSchema.properties[k]?.type);
    if (faltando || invalido || tipoErrado) { return reply(id, { isError: true, content: [{ type: "text", text: faltando ? `argumento obrigatório ausente: ${faltando}` : invalido ? `argumento desconhecido: ${invalido}` : `argumento ${tipoErrado} deve ser ${tool.inputSchema.properties[tipoErrado].type}` }] }); }
    let r;
    try { r = await tool.run(args, opts); } catch (e) { r = { ok: false, reason: String(e?.message ?? e) }; }
    return reply(id, { isError: r.ok === false, content: [{ type: "text", text: typeof r.text === "string" ? r.text : JSON.stringify(r) }] });
  }
  return fail(id, -32601, `método não suportado: ${method}`);
}

/**
 * Serve o MCP: uma mensagem JSON por linha na entrada, uma resposta por linha na saída. Linha que não é JSON recebe o erro -32700.
 * @param {NodeJS.ReadableStream} input
 * @param {{write:(s:string)=>void}} output
 * @returns {Promise<void>} termina quando a entrada fecha.
 */
export async function serve(input = process.stdin, output = process.stdout) {
  const fila = [];
  const rl = createInterface({ input });
  for await (const linha of rl) {
    if (!linha.trim()) { continue; }
    let msg;
    try { msg = JSON.parse(linha); } catch { output.write(`${JSON.stringify(fail(null, -32700, "JSON inválido"))}\n`); continue; }
    fila.push(handleMessage(msg).then((r) => { if (r) { output.write(`${JSON.stringify(r)}\n`); } }));
  }
  await Promise.all(fila);
}
