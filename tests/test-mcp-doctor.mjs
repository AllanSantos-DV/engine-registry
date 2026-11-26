// test-mcp-doctor.mjs — `engine-kit mcp` expõe o diagnóstico estruturado do doctor como tool de leitura (engine_doctor).
//
// O que precisa ser verdade:
//   • engine_doctor aparece no tools/list, com `engine` e `verify` opcionais, e as tools de leitura anteriores continuam todas lá;
//   • devolve uma linha por motor do manifest (nome, estado, detalhe, avisos, pin) como JSON no texto, a mesma forma do `doctor --json`;
//   • lê sem rede e sem gravar: nada em ENGINE_KIT_HOME e nenhum token ou chave privada na resposta;
//   • argumento fora do esquema é recusado.
// Hermético: HOME e ENGINE_KIT_HOME isolados, sem rede.
//
//   node tests/test-mcp-doctor.mjs
import "./_tmp.mjs";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-mcpdoc-"));
const KIT_HOME = join(RUN, "kit-home");
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME, ENGINE_KIT_NO_AUTO_UPDATE: "1" });
const { handleMessage } = await import("../kit/mcp.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const chama = (name, args) => handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

const tools = (await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" })).result.tools;
const doctor = tools.find((t) => t.name === "engine_doctor");
check("engine_doctor está no tools/list, com `engine` e `verify` opcionais, ao lado das tools de leitura de antes",
  doctor?.inputSchema?.type === "object" && Object.keys(doctor.inputSchema.properties).join() === "engine,verify" && doctor.inputSchema.required.length === 0 && ["engine_list", "engine_history", "engine_check", "engine_path", "engine_url", "engine_trust", "engine_report"].every((n) => tools.some((t) => t.name === n)),
  tools.map((t) => t.name).join());

const r = await chama("engine_doctor", {});
const j = JSON.parse(r.result?.content?.[0]?.text ?? "null");
const lista = JSON.parse((await chama("engine_list", {})).result.content[0].text);
check("devolve uma linha por motor do manifest, na forma do doctor --json (name, state, detail, warns, pin)",
  r.result?.isError === false && j?.ok === true && j.engines.length === lista.engines.length && j.engines.every((e) => e.name && e.state && "detail" in e && Array.isArray(e.warns) && "pin" in e),
  JSON.stringify(r).slice(0, 300));
check("sem nada instalado no HOME isolado, nenhum motor aparece como OK", j?.engines?.every((e) => e.state !== "OK"), j?.engines?.map((e) => `${e.name}:${e.state}`).join());
check("ler não grava nada no ENGINE_KIT_HOME", !existsSync(KIT_HOME) || readdirSync(KIT_HOME).length === 0, existsSync(KIT_HOME) ? readdirSync(KIT_HOME).join() : "");
check("a resposta não carrega token nem chave privada", !/private|secret|"token"/i.test(JSON.stringify(j)), JSON.stringify(j).slice(0, 200));
const extra = await chama("engine_doctor", { motor: "vxk" });
check("argumento fora do esquema é recusado com isError:true", extra.result.isError === true && /desconhecido/.test(extra.result.content[0].text), JSON.stringify(extra));

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
