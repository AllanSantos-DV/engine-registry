// test-mcp-doctor-lista-export.mjs — o `engine-kit mcp` ganha parâmetros opcionais em engine_doctor (`engine`, `verify`) e engine_list (`apps`) e a tool engine_export, sem gravar nada.
//
// O que precisa ser verdade:
//   • sem argumentos, engine_doctor e engine_list devolvem o que devolviam antes, e o tools/list ganha engine_export (onze tools, nenhuma de escrita);
//   • engine_doctor com `engine` devolve só esse motor, e motor fora do manifest volta com isError:true e o motivo;
//   • engine_doctor com `verify:true` confere a integridade da pasta instalada (ADULTERADO, com `integrity`); sem `verify` o mesmo motor não é conferido;
//   • engine_list com `apps:true` acrescenta os apps do manifest; sem ele não há o campo `apps`;
//   • engine_export devolve o documento que `export` imprimiria (o mesmo que `import -` aceita), sem gravar arquivo, e não aceita argumento;
//   • argumento do tipo errado é recusado; chave herdada do Object.prototype (`__proto__`, `constructor`) cai em `argumento desconhecido`; `engine` vazio é recusado; e nenhuma dessas leituras grava nada no ENGINE_KIT_HOME nem na pasta de trabalho.
// Hermético: HOME e ENGINE_KIT_HOME isolados, registry e downloads de memória (o .tgz é real e assinado), sem rede.
//
//   node tests/test-mcp-doctor-lista-export.mjs
import "./_tmp.mjs";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-mcpdle-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME, ENGINE_KIT_NO_AUTO_UPDATE: "1" });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { handleMessage } = await import("../kit/mcp.mjs");
const { ensureCommand, listCommand } = await import("../kit/ensure.mjs");
const { diagnoseEngines, engineView } = await import("../kit/diagnose.mjs");
const { exportCommand, validarDocumento } = await import("../kit/export-import.mjs");
const { homeOf, registry } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const chama = (name, args, opts) => handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, opts);
const corpo = (r) => r.result?.content?.[0]?.text ?? "";
const json = (r) => { try { return JSON.parse(corpo(r)) ?? {}; } catch { return {}; } };
const app = { name: "dle-app", version: "1.0.0", summary: "resumo", platforms: ["any"], release: { repo: "x/y", tag: "dle-app-v{version}", assets: [{ name: "dle-app-{version}.tgz", platform: "any", checksum: "{asset}.sha256" }], publicKey: "aa".repeat(32), signatureAlgorithm: "ed25519-sha256-raw" } };
const reg = registry({ "dle-a": "1.0.0", "dle-b": "1.0.0" });
const manifest = { ...reg.manifest, apps: [app] };
const injetado = { bundled: manifest, manifest };
const foto = () => JSON.stringify([readdirSync(RUN).sort(), readdirSync(KIT_HOME).sort(), readFileSync(join(KIT_HOME, "trust.json"), "utf8")]);

await ensureCommand("dle-a", reg.opts);
await ensureCommand("dle-b", reg.opts);
const antes = foto();

console.log("== o que o tools/list mostra ==");
{
  const tools = (await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" })).result.tools;
  const por = Object.fromEntries(tools.map((t) => [t.name, t]));
  check("engine_doctor aceita `engine` (texto) e `verify` (booleano), nenhum obrigatório", por.engine_doctor?.inputSchema.properties.engine?.type === "string" && por.engine_doctor.inputSchema.properties.verify?.type === "boolean" && por.engine_doctor.inputSchema.required.length === 0, JSON.stringify(por.engine_doctor?.inputSchema));
  check("engine_list aceita `apps` (booleano), opcional", por.engine_list?.inputSchema.properties.apps?.type === "boolean" && por.engine_list.inputSchema.required.length === 0, JSON.stringify(por.engine_list?.inputSchema));
  check("engine_export existe, sem argumentos", por.engine_export?.inputSchema.type === "object" && Object.keys(por.engine_export.inputSchema.properties).length === 0, JSON.stringify(por.engine_export));
  check("são onze tools e nenhuma é de escrita", tools.length === 11 && !tools.some((t) => /ensure|pin|stop|update|rollback|restaur|fetch|register|import/i.test(t.name)), tools.map((t) => t.name).join());
  check("as descrições dizem o que os parâmetros novos fazem", /engine/i.test(por.engine_doctor?.description ?? "") && /verify|integridade/i.test(por.engine_doctor?.description ?? "") && /apps/i.test(por.engine_list?.description ?? "") && /import/i.test(por.engine_export?.description ?? ""), JSON.stringify([por.engine_doctor?.description, por.engine_list?.description, por.engine_export?.description]));
}

console.log("\n== sem argumentos, o retorno é o de antes ==");
{
  const d = await diagnoseEngines({ local: true, manifest });
  const esperado = { ok: true, engines: await Promise.all(d.rows.map(engineView)) };
  const r = await chama("engine_doctor", {}, injetado);
  check("engine_doctor: uma linha por motor do manifest, igual à do doctor --json --local, sem integrity", r.result?.isError === false && JSON.stringify(json(r)) === JSON.stringify(esperado) && json(r).engines.length === 2 && json(r).engines.every((e) => !("integrity" in e)), corpo(r).slice(0, 300));
  const l = await chama("engine_list", {}, injetado);
  check("engine_list: igual ao listCommand sem opções, sem o campo apps", l.result?.isError === false && JSON.stringify(json(l)) === JSON.stringify(listCommand({ bundled: manifest })) && !("apps" in json(l)), corpo(l).slice(0, 300));
}

console.log("\n== engine_doctor com `engine` ==");
{
  const r = await chama("engine_doctor", { engine: "dle-b" }, injetado);
  check("devolve só o motor pedido", r.result?.isError === false && json(r).engines?.map((e) => e.name).join() === "dle-b", corpo(r).slice(0, 300));
  const x = await chama("engine_doctor", { engine: "motor-que-nao-existe" }, injetado);
  check("motor fora do manifest: isError:true com o motivo", x.result?.isError === true && /não existe no manifest/.test(corpo(x)), corpo(x));
}

console.log("\n== engine_doctor com `verify` ==");
{
  writeFileSync(join(homeOf("dle-a"), "bin", "dle-a.mjs"), "alterado");
  const sem = json(await chama("engine_doctor", {}, injetado)).engines?.find((e) => e.name === "dle-a");
  check("sem `verify` o motor adulterado não é conferido: estado OK e nenhum integrity", sem?.state === "OK" && !("integrity" in sem), JSON.stringify(sem));
  const falso = json(await chama("engine_doctor", { verify: false }, injetado)).engines?.find((e) => e.name === "dle-a");
  check("`verify:false` é o mesmo que omitir", falso?.state === "OK" && !("integrity" in falso), JSON.stringify(falso));
  const com = json(await chama("engine_doctor", { verify: true }, injetado)).engines ?? [];
  const a = com.find((e) => e.name === "dle-a"), b = com.find((e) => e.name === "dle-b");
  check("com `verify:true` o motor com arquivo alterado é ADULTERADO e diz qual arquivo", a?.state === "ADULTERADO" && a.integrity?.state === "ADULTERADO" && /dle-a\.mjs/.test(a.integrity.detail), JSON.stringify(a));
  check("com `verify:true` o motor intacto segue OK, com integrity OK", b?.state === "OK" && b.integrity?.state === "OK", JSON.stringify(b));
  const junto = json(await chama("engine_doctor", { engine: "dle-a", verify: true }, injetado)).engines ?? [];
  check("`engine` e `verify` juntos: só aquele motor, conferido", junto.length === 1 && junto[0].state === "ADULTERADO", JSON.stringify(junto));
}

console.log("\n== engine_list com `apps` ==");
{
  const r = await chama("engine_list", { apps: true }, injetado);
  check("com `apps:true` traz o campo apps igual ao listCommand({ apps })", r.result?.isError === false && JSON.stringify(json(r)) === JSON.stringify(listCommand({ bundled: manifest, apps: true })) && json(r).apps?.[0]?.name === "dle-app", corpo(r).slice(0, 300));
  const f = await chama("engine_list", { apps: false }, injetado);
  check("`apps:false` é o mesmo que omitir", !("apps" in json(f)), corpo(f).slice(0, 200));
}

console.log("\n== engine_export ==");
{
  const r = await chama("engine_export", {}, injetado);
  const doc = json(r);
  check("devolve o documento do export: formato, kit e um item por motor instalado", r.result?.isError === false && JSON.stringify(doc) === JSON.stringify(exportCommand(undefined, { bundled: manifest }).doc) && doc.engines?.map((e) => e.name).join() === "dle-a,dle-b", corpo(r).slice(0, 300));
  check("o documento passa pelo validador do import", validarDocumento(doc).ok === true, JSON.stringify(validarDocumento(doc)));
  const arq = await chama("engine_export", { arquivo: join(RUN, "doc.json") }, injetado);
  check("não aceita argumento (nenhum caminho de gravação): isError:true", arq.result?.isError === true && /desconhecido/.test(corpo(arq)) && !readdirSync(RUN).includes("doc.json"), corpo(arq));
  const bom = readFileSync(join(KIT_HOME, "trust.json"), "utf8");
  writeFileSync(join(KIT_HOME, "trust.json"), "{ ilegível");
  const ruim = await chama("engine_export", {}, injetado);
  writeFileSync(join(KIT_HOME, "trust.json"), bom);
  check("trust.json ilegível: isError:true com o motivo, sem documento", ruim.result?.isError === true && /ilegível/.test(corpo(ruim)), corpo(ruim));
}

console.log("\n== tipos e escrita ==");
{
  for (const [tool, args, campo] of [["engine_doctor", { verify: "sim" }, "verify"], ["engine_doctor", { engine: 1 }, "engine"], ["engine_list", { apps: "sim" }, "apps"]]) {
    const r = await chama(tool, args, injetado);
    check(`${tool}: \`${campo}\` do tipo errado é recusado com isError:true`, r.result?.isError === true && new RegExp(campo).test(corpo(r)), corpo(r));
  }
  for (const chave of ["__proto__", "constructor"]) {
    const r = await chama("engine_doctor", JSON.parse(`{"${chave}":"x"}`), injetado);
    check(`chave herdada \`${chave}\` cai em "argumento desconhecido"`, r.result?.isError === true && corpo(r) === `argumento desconhecido: ${chave}`, corpo(r));
  }
  const vazio = await chama("engine_doctor", { engine: "" }, injetado);
  check("engine_doctor com `engine` vazio: isError:true dizendo que não pode ser vazio, sem listar os motores", vazio.result?.isError === true && /engine.*vazi/.test(corpo(vazio)) && !("engines" in json(vazio)), corpo(vazio).slice(0, 300));
  const todos = await chama("engine_doctor", {}, injetado);
  check("engine_doctor sem `engine` segue devolvendo todos os motores", todos.result?.isError === false && json(todos).engines?.length === 2, corpo(todos).slice(0, 200));
  check("nenhuma leitura gravou arquivo no ENGINE_KIT_HOME nem na pasta de trabalho", foto() === antes, `${antes} ≠ ${foto()}`);
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
