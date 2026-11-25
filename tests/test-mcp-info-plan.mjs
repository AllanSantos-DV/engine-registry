// test-mcp-info-plan.mjs — `engine-kit mcp` ganha engine_info, engine_plan e a opção `rede` do engine_check, sem instalar nada.
//
// O que precisa ser verdade:
//   • engine_info, engine_plan e o campo `rede` de engine_check aparecem no tools/list, junto com as outras tools de leitura;
//   • engine_info devolve o que o `info` devolve (estado, versão instalada, pin) e recusa motor fora do manifest com o motivo;
//   • engine_plan diz instalar, atualizar, reusar ou manter pelo mesmo cálculo do `ensure --dry-run`, sem baixar artefato, sem gravar histórico e sem trocar versão;
//   • engine_plan e engine_check com `rede` falam com o registry e gravam só o cache do descritor; as demais tools não criam nem o cache;
//   • engine_check com `rede` diz se a versão publicada satisfaz a faixa, e sem `rede` não há campo de registry;
//   • argumento com tipo errado é recusado com isError:true.
// Hermético: HOME e ENGINE_KIT_HOME isolados; o registry é um servidor em 127.0.0.1, o .tgz é real e nada sai da máquina.
//
//   node tests/test-mcp-info-plan.mjs
import "./_tmp.mjs";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-mcpip-"));
const KIT_HOME = join(RUN, "kit-home");
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });
delete process.env.ENGINE_KIT_NO_AUTO_UPDATE;
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { handleMessage } = await import("../kit/mcp.mjs");
const { homeOf, registry, instalado, preinstalar, plugin } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const chama = async (name, args, opts) => {
  const r = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, opts);
  return r.error ? { result: { isError: true, content: [{ type: "text", text: r.error.message }] } } : r;
};
const corpo = (r) => r.result.content[0].text;
const json = (r) => { try { return JSON.parse(corpo(r)) ?? {}; } catch { return {}; } };
const cacheDoDescritor = join(RUN, ".engine-kit");
const historico = join(KIT_HOME, "history.jsonl");

preinstalar("mcp-velho", "1.0.0");
preinstalar("mcp-em-dia", "2.0.0");
preinstalar("mcp-fixado", "1.0.0");
const reg = registry({ "mcp-novo": "2.0.0", "mcp-velho": "2.0.0", "mcp-em-dia": "2.0.0", "mcp-fixado": "2.0.0", "mcp-proprio": "2.0.0" });
reg.manifest.engines.find((e) => e.name === "mcp-proprio").status = "self-managed";
const { pin } = await import("../kit/index.mjs");
pin("mcp-fixado", "1.0.0");
const injetado = { bundled: reg.manifest, manifest: reg.manifest };

const baixou = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, ...resto) => {
  if (!String(url).startsWith("http://127.0.0.1")) { baixou.push(String(url)); throw new Error("sem rede fora do registry de teste"); }
  return fetchReal(url, ...resto);
};

console.log("== o que o tools/list mostra ==");
{
  const tools = (await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" })).result.tools;
  const por = Object.fromEntries(tools.map((t) => [t.name, t]));
  check("engine_info e engine_plan pedem só o motor", ["engine_info", "engine_plan"].every((n) => por[n]?.inputSchema.required.join() === "engine" && Object.keys(por[n].inputSchema.properties).join() === "engine"), JSON.stringify([por.engine_info, por.engine_plan]));
  check("engine_check ganhou `rede` booleano e continua exigindo o manifesto", por.engine_check.inputSchema.properties.rede?.type === "boolean" && por.engine_check.inputSchema.required.join() === "manifest", JSON.stringify(por.engine_check.inputSchema));
  check("as oito tools de antes continuam", ["engine_list", "engine_history", "engine_path", "engine_url", "engine_trust", "engine_doctor", "engine_report", "engine_check"].every((n) => por[n]));
  check("a descrição de engine_plan e a de `rede` dizem que usam a rede e gravam o cache do descritor", [por.engine_plan?.description, por.engine_check.inputSchema.properties.rede?.description].every((d) => /rede/i.test(d ?? "") && /cache/i.test(d ?? "")), JSON.stringify([por.engine_plan?.description, por.engine_check.inputSchema.properties.rede]));
  check("a descrição de engine_info diz que não usa rede", /sem rede/i.test(por.engine_info?.description ?? ""), por.engine_info?.description);
}

console.log("\n== engine_info ==");
{
  const v = await chama("engine_info", { engine: "mcp-velho" }, injetado);
  check("instalado e velho: DESATUALIZADO, com a versão instalada e a do manifest", v.result.isError === false && json(v).state === "DESATUALIZADO" && json(v).installed === "1.0.0" && json(v).version === "2.0.0", corpo(v));
  const f = await chama("engine_info", { engine: "mcp-fixado" }, injetado);
  check("fixado: o pin aparece", json(f).state === "FIXADO" && json(f).pin === "1.0.0", corpo(f));
  const x = await chama("engine_info", { engine: "motor-que-nao-existe" }, injetado);
  check("motor fora do manifest: isError:true com o motivo", x.result.isError === true && /não está no manifest/.test(corpo(x)), corpo(x));
  const sem = await chama("engine_info", {}, injetado);
  check("sem o motor: isError:true citando o campo", sem.result.isError === true && /engine/.test(corpo(sem)), corpo(sem));
}

console.log("\n== engine_plan ==");
{
  const plano = async (engine) => json(await chama("engine_plan", { engine }, injetado));
  const novo = await plano("mcp-novo");
  check("ausente: plano instalar na versão do registry, com o texto do plano", novo.ok && novo.dryRun === true && novo.plan === "instalar" && novo.version === "2.0.0" && /instalaria v2\.0\.0/.test(novo.detail), JSON.stringify(novo));
  const velho = await plano("mcp-velho");
  check("instalado e velho: plano atualizar de 1.0.0 para 2.0.0", velho.plan === "atualizar" && velho.installed === "1.0.0" && velho.version === "2.0.0" && /atualizaria v1\.0\.0 → v2\.0\.0/.test(velho.detail), JSON.stringify(velho));
  const emDia = await plano("mcp-em-dia");
  check("instalado e em dia: plano reusar", emDia.plan === "reusar" && emDia.version === "2.0.0", JSON.stringify(emDia));
  const fixado = await plano("mcp-fixado");
  check("fixado: o plano reusa a versão fixada e mostra o pin", fixado.plan === "reusar" && fixado.version === "1.0.0" && fixado.pinned === "1.0.0", JSON.stringify(fixado));
  const proprio = await chama("engine_plan", { engine: "mcp-proprio" }, injetado);
  check("self-managed ainda não instalado: isError:true com o caminho do fetch", proprio.result.isError === true && /self-managed/.test(corpo(proprio)) && /engine-kit fetch mcp-proprio/.test(corpo(proprio)), corpo(proprio));
  const fora = await chama("engine_plan", { engine: "motor-que-nao-existe" }, injetado);
  check("motor fora do manifest: isError:true com o motivo", fora.result.isError === true && /não está no manifest/.test(corpo(fora)), corpo(fora));

  process.env.ENGINE_KIT_NO_AUTO_UPDATE = "1";
  const manter = await plano("mcp-velho");
  delete process.env.ENGINE_KIT_NO_AUTO_UPDATE;
  check("com ENGINE_KIT_NO_AUTO_UPDATE o plano é manter, com a versão nova em available", manter.plan === "manter" && manter.version === "1.0.0" && manter.available === "2.0.0", JSON.stringify(manter));

  check("nada foi baixado, o velho segue na 1.0.0, o novo não existe e não há histórico", baixou.length === 0 && instalado("mcp-velho") === "1.0.0" && !existsSync(homeOf("mcp-novo")) && !existsSync(historico), baixou.join());
}

console.log("\n== engine_check sem `rede` ==");
{
  const f = plugin({ "mcp-novo": ">=1.0.0" });
  const r = await chama("engine_check", { manifest: f }, injetado);
  const e = json(r).engines?.[0] ?? {};
  check("sem `rede`: AUSENTE e nenhum campo de registry", r.result.isError === true && e.state === "AUSENTE" && !("registry" in e) && !("registrySatisfies" in e), corpo(r));
  const ruim = await chama("engine_check", { manifest: f, rede: "sim" }, injetado);
  check("`rede` que não é booleano é recusado com isError:true", ruim.result.isError === true && /rede/.test(corpo(ruim)) && /boolean/.test(corpo(ruim)), corpo(ruim));
  check("as tools sem rede não criaram nem o cache do descritor", !existsSync(cacheDoDescritor), existsSync(cacheDoDescritor) ? readdirSync(cacheDoDescritor).join() : "");
}

console.log("\n== com rede: o registry de teste em 127.0.0.1 ==");
{
  const pedidos = [];
  const servidor = createServer((q, res) => { pedidos.push(q.url); res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reg.manifest)); });
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const registryUrl = `http://127.0.0.1:${servidor.address().port}/manifest.json`;
  const viaRede = { bundled: reg.manifest, registryUrl };

  const velho = json(await chama("engine_plan", { engine: "mcp-velho" }, viaRede));
  check("engine_plan consulta o registry e planeja atualizar", velho.ok && velho.plan === "atualizar" && velho.version === "2.0.0" && pedidos.length === 1, JSON.stringify([velho, pedidos]));
  check("só o manifest do registry foi pedido: nenhum artefato", baixou.length === 0 && pedidos.every((u) => u === "/manifest.json"), baixou.concat(pedidos).join());
  check("grava só o cache do descritor, nada no ENGINE_KIT_HOME e o motor segue na 1.0.0", existsSync(cacheDoDescritor) && readdirSync(cacheDoDescritor).length === 1 && !existsSync(historico) && instalado("mcp-velho") === "1.0.0", existsSync(cacheDoDescritor) ? readdirSync(cacheDoDescritor).join() : "sem cache");

  const f = plugin({ "mcp-novo": ">=1.0.0", "mcp-velho": ">=3.0.0" });
  const r = await chama("engine_check", { manifest: f, rede: true }, { manifest: reg.manifest, registryUrl });
  const por = Object.fromEntries((json(r).engines ?? []).map((e) => [e.name, e]));
  check("com `rede`: AUSENTE satisfeito pela versão publicada, dita no detalhe", por["mcp-novo"]?.registry === "2.0.0" && por["mcp-novo"]?.registrySatisfies === true && /satisfaz: ensure --de instala/.test(por["mcp-novo"]?.detail), JSON.stringify(por["mcp-novo"]));
  check("com `rede`: FORA-DA-FAIXA que a versão publicada também não satisfaz", por["mcp-velho"]?.registry === "2.0.0" && por["mcp-velho"]?.registrySatisfies === false, JSON.stringify(por["mcp-velho"]));
  servidor.close();
}
globalThis.fetch = fetchReal;

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
