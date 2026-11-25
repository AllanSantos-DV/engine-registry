// test-mcp-leitura.mjs — `engine-kit mcp` é um servidor MCP (stdio) só de leitura sobre os verbos do kit.
//
// O que precisa ser verdade:
//   • initialize devolve a versão do protocolo pedida (ou a mais nova suportada), capabilities.tools e serverInfo; notificação não recebe resposta;
//   • tools/list expõe exatamente as tools de leitura, cada uma com esquema de entrada, e nenhuma tool de escrita (ensure, pin, stop, update, rollback, restaurar);
//   • tools/call devolve o resultado do verbo como texto JSON; verbo que falha (ok:false) e argumento inválido voltam com isError:true e o motivo;
//   • tool ou método desconhecido é erro JSON-RPC; linha que não é JSON recebe -32700 e o servidor segue vivo;
//   • rodando pelo CLI de verdade (`kit/cli.mjs mcp`) responde na saída padrão sem escrever nada em ENGINE_KIT_HOME, e argumento solto é recusado.
// Hermético: ENGINE_KIT_HOME isolado, sem rede.
//
//   node tests/test-mcp-leitura.mjs
import "./_tmp.mjs";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-mcp-"));
const KIT_HOME = join(RUN, "kit-home");
const env = { ...process.env, HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME, ENGINE_KIT_NO_AUTO_UPDATE: "1" };
Object.assign(process.env, env);
const { handleMessage, TOOLS } = await import("../kit/mcp.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const texto = (r) => r.result.content[0].text;

console.log("== engine-kit mcp ==\n");

{
  const a = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  check("initialize ecoa a versão do protocolo suportada e declara tools", a.result.protocolVersion === "2024-11-05" && a.result.capabilities.tools && a.result.serverInfo.name === "engine-kit" && /^\d+\.\d+\.\d+/.test(a.result.serverInfo.version), JSON.stringify(a));
  const b = await handleMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  check("versão desconhecida recebe a mais nova suportada", b.result.protocolVersion === "2025-06-18");
  check("notificação (sem id) não recebe resposta", (await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" })) === null);
  check("ping responde vazio", JSON.stringify((await handleMessage({ jsonrpc: "2.0", id: 3, method: "ping" })).result) === "{}");
}

{
  const l = (await handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/list" })).result.tools;
  const nomes = l.map((t) => t.name).sort().join();
  check("tools/list traz as dez tools de leitura, cada uma com inputSchema", nomes === "engine_check,engine_doctor,engine_history,engine_info,engine_list,engine_path,engine_plan,engine_report,engine_trust,engine_url" && l.every((t) => t.inputSchema?.type === "object" && t.description && !("run" in t)), nomes);
  check("nenhuma tool de escrita é exposta", !l.some((t) => /ensure|pin|stop|update|rollback|restaur|fetch|register/i.test(t.name)));
  check("TOOLS exporta o mesmo conjunto que o tools/list", TOOLS.length === l.length);
}

{
  const chama = (name, args) => handleMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name, arguments: args } });
  const lista = await chama("engine_list", {});
  const j = JSON.parse(texto(lista));
  check("engine_list devolve o resultado do verbo como JSON no texto", lista.result.isError === false && j.ok === true && j.engines.length > 0 && j.engines.every((e) => e.name), texto(lista).slice(0, 200));
  const hist = await chama("engine_history", {});
  check("engine_history sem arquivo: lista vazia, não é erro", hist.result.isError === false && JSON.parse(texto(hist)).entries.length === 0);
  const trust = await chama("engine_trust", {});
  check("engine_trust devolve só chave pública (nenhum campo privado)", trust.result.isError === false && !/private|secret|token/i.test(texto(trust)), texto(trust).slice(0, 200));
  const rel = await chama("engine_report", {});
  check("engine_report devolve o texto de suporte cru, não JSON", rel.result.isError === false && /^engine-kit v\d/.test(texto(rel)), texto(rel).slice(0, 120));
  const caminho = await chama("engine_path", { engine: "motor-que-nao-existe" });
  check("verbo com ok:false volta com isError:true e o motivo", caminho.result.isError === true && /não está no manifest/.test(texto(caminho)), texto(caminho));
  const url = await chama("engine_url", { engine: "motor-que-nao-existe" });
  check("engine_url sem anúncio: isError:true, sem token", url.result.isError === true && !/token/i.test(texto(url)), texto(url));
  const semArg = await chama("engine_path", {});
  check("argumento obrigatório ausente: isError:true citando o campo", semArg.result.isError === true && /engine/.test(texto(semArg)), texto(semArg));
  const extra = await chama("engine_list", { qualquer: "x" });
  check("argumento desconhecido: isError:true", extra.result.isError === true && /desconhecido/.test(texto(extra)), texto(extra));
  const ruim = await chama("engine_check", { manifest: join(RUN, "nao-existe.json") });
  check("engine_check de arquivo ausente: isError:true com o motivo", ruim.result.isError === true && /não consegui ler/.test(texto(ruim)), texto(ruim));
  check("tool desconhecida é erro JSON-RPC -32602", (await chama("engine_ensure", { engine: "x" })).error?.code === -32602);
  check("método desconhecido é erro JSON-RPC -32601", (await handleMessage({ jsonrpc: "2.0", id: 6, method: "resources/list" })).error?.code === -32601);
}

console.log("\n== pelo CLI, em processo real ==\n");
{
  const filho = spawn(process.execPath, ["kit/cli.mjs", "mcp"], { cwd: new URL("..", import.meta.url), env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let saida = "", erro = "";
  filho.stdout.on("data", (d) => { saida += d; });
  filho.stderr.on("data", (d) => { erro += d; });
  filho.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`);
  filho.stdin.write("isto não é json\n");
  filho.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "engine_list", arguments: {} } })}\n`);
  filho.stdin.end();
  const codigo = await new Promise((ok) => filho.on("close", ok));
  const linhas = saida.trim().split(/\r?\n/).map((l) => JSON.parse(l));
  check("o processo responde uma linha JSON por mensagem e sai 0 quando a entrada fecha", codigo === 0 && linhas.length === 3, `${codigo} ${saida} ${erro}`);
  check("a linha que não é JSON recebe -32700 e o servidor segue respondendo", linhas.some((l) => l.error?.code === -32700) && linhas.some((l) => l.id === 2 && l.result.isError === false));
  check("a saída padrão só tem protocolo e a saída de erro está vazia", erro === "", erro);
  check("ler não grava nada no ENGINE_KIT_HOME", !existsSync(KIT_HOME) || readdirSync(KIT_HOME).length === 0, existsSync(KIT_HOME) ? readdirSync(KIT_HOME).join() : "");
  const solto = spawnSync(process.execPath, ["kit/cli.mjs", "mcp", "extra"], { cwd: new URL("..", import.meta.url), env, encoding: "utf8", windowsHide: true });
  check("argumento solto em `mcp` é recusado (exit 1)", solto.status === 1 && /inesperado/.test(solto.stderr), solto.stderr);
}

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
