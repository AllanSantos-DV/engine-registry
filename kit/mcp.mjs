// engine-kit/mcp.mjs — `engine-kit mcp`: servidor MCP (stdio, JSON-RPC por linha) com os verbos de LEITURA do kit.
// Ferramental: nunca importado por consumidor. Nenhuma tool instala, atualiza, fixa, desliga, reverte ou grava: ensure, pin, stop, update, rollback e trust --restaurar ficam de fora.
import { createInterface } from "node:readline";
import { listCommand } from "./ensure.mjs";
import { historyCommand, checkCommand, trustCommand, pathCommand, urlCommand, reportCommand } from "./inspect.mjs";
import { ownVersion } from "./update.mjs";

const VERSOES = ["2025-06-18", "2025-03-26", "2024-11-05"];
const str = (description) => ({ type: "string", description });
const esquema = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });

/** As tools expostas: nome, descrição, esquema de entrada e a função que devolve o resultado do verbo. */
export const TOOLS = [
  { name: "engine_list", description: "Motores do pacote, plataformas que atendem e o que está instalado aqui (sem rede).", inputSchema: esquema(), run: () => listCommand() },
  { name: "engine_history", description: "Trocas de versão gravadas nesta máquina, opcionalmente de um motor.", inputSchema: esquema({ engine: str("motor") }), run: (a) => historyCommand(a.engine) },
  { name: "engine_check", description: "Confere o bloco `engines` de um manifesto de plugin contra o instalado, sem rede.", inputSchema: esquema({ manifest: str("caminho do manifesto do plugin") }, ["manifest"]), run: (a) => checkCommand(a.manifest) },
  { name: "engine_path", description: "Caminho do executável de um motor instalado e o estado do cli.json dele.", inputSchema: esquema({ engine: str("motor") }, ["engine"]), run: (a) => pathCommand(a.engine) },
  { name: "engine_url", description: "Endereço do daemon vivo de um motor (url, versão, pid); nunca o token.", inputSchema: esquema({ engine: str("motor") }, ["engine"]), run: (a) => urlCommand(a.engine) },
  { name: "engine_trust", description: "O que o trust.json guarda por motor (só chave pública), sem gravar.", inputSchema: esquema({ engine: str("motor") }), run: (a) => trustCommand(a.engine) },
  { name: "engine_report", description: "Texto de suporte: kit, Node, plataforma, estado de cada motor (sem rede, sem token nem chave).", inputSchema: esquema(), run: () => reportCommand({ local: true }) },
];

const reply = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

/**
 * Responde a uma mensagem JSON-RPC. Notificação (sem `id`) não tem resposta (`null`). Tool com argumento inválido ou verbo que devolve `ok:false` volta como `isError:true` com o motivo.
 * @param {object} msg mensagem já parseada.
 * @returns {Promise<object|null>}
 */
export async function handleMessage(msg) {
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
    if (faltando || invalido) { return reply(id, { isError: true, content: [{ type: "text", text: faltando ? `argumento obrigatório ausente: ${faltando}` : `argumento desconhecido: ${invalido}` }] }); }
    let r;
    try { r = await tool.run(args); } catch (e) { r = { ok: false, reason: String(e?.message ?? e) }; }
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
