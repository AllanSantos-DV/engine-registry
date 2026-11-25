// test-export-import.mjs — `engine-kit export [arquivo]` e `engine-kit import <arquivo> [--dry-run]` levam os motores instalados de uma máquina para outra.
//
// O que precisa ser verdade:
//   • o export diz, por motor instalado, o nome, a versão instalada e o pin do trust.json, mais a versão do kit; motor não instalado fica de fora;
//   • o documento nunca leva chave pública, assinatura, caminho local, usuário nem máquina: só as chaves conhecidas, com os valores no formato esperado;
//   • sem arquivo o export imprime o JSON; com arquivo grava por .part e rename e nunca deixa metade;
//   • o import instala a versão REGISTRADA (não a do registry), pelo ensure (sha256 + Ed25519 + chave do manifest embarcado), e fixa só quem estava fixado;
//   • --dry-run mostra o plano do ensure e não baixa, não instala, não fixa e não grava histórico;
//   • documento inválido (formato, chave estranha, nome, versão, duplicado, `__proto__`) é recusado inteiro, antes de instalar qualquer coisa, sem poluir nada;
//   • motor desconhecido, sem build para a plataforma, versão que o registry não tem, artefato adulterado e pin local diferente recusam só aquele motor, e o resultado é ok:false;
//   • pelo CLI: texto, --json, exit 1 se algum motor falhou, e o uso documenta os dois verbos.
// Hermético: registry e downloads de memória (o .tgz é real e assinado), HOME e ENGINE_KIT_HOME isolados, nenhuma rede, o CLI roda numa cópia do kit.
//
//   node tests/test-export-import.mjs
import "./_tmp.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ei-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { criarCliOffline } = await import("./_kit-copiado.mjs");
const mod = await import("../kit/export-import.mjs").catch((e) => ({ erro: e }));
const { ensureCommand, pinCommand, planoEm } = await import("../kit/ensure.mjs");
const { pinOf, trustPath, historyPath } = await import("../kit/trust.mjs");
const { ownVersion } = await import("../kit/update.mjs");
const { homeOf, registry, instalado, preinstalar, owner } = await criarRegistroFalso(RUN);
const { exportCommand, importCommand } = mod;

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
if (mod.erro) { check("kit/export-import.mjs existe e carrega", false, String(mod.erro.message).slice(0, 120)); }
const so = (f) => (typeof f === "function" ? f : async () => ({ ok: false, reason: "função ainda não existe" }));
const exportar = so(exportCommand), importar = so(importCommand);

let seq = 0;
const gravar = (conteudo) => { const f = join(RUN, `doc-${++seq}.json`); writeFileSync(f, typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo)); return f; };
const doc = (engines, extra = {}) => ({ formato: 1, kit: ownVersion(), engines, ...extra });
const ler = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
const limparEm = (kit, nomes) => {
  for (const n of nomes) { rmSync(homeOf(n), { recursive: true, force: true }); }
  for (const f of existsSync(kit) ? readdirSync(kit) : []) { rmSync(join(kit, f), { recursive: true, force: true }); }
};
const limpar = (...nomes) => limparEm(KIT_HOME, nomes);
const juntos = (...regs) => {
  const conta = { n: 0 };
  const fetcher = async (url, ...resto) => {
    conta.n++;
    for (const r of regs) { try { return await r.fetcher(url, ...resto); } catch (e) { if (e.status !== 404) { throw e; } } }
    const e = new Error("HTTP 404"); e.status = 404; throw e;
  };
  return { fetcher, conta };
};
const planoDe = (r) => (r ? planoEm(r) : null);
const linha = (r, nome) => r.engines?.find(([n]) => n === nome)?.[1];
const trocas = () => (existsSync(historyPath()) ? readFileSync(historyPath(), "utf8") : "");
const rede = { chamadas: 0 };
const redeAntes = globalThis.fetch;
globalThis.fetch = async () => { rede.chamadas++; throw new Error("sem rede no teste"); };

const v1 = registry({ "ei-fixo": "1.0.0", "ei-livre": "1.0.0", "ei-ausente": "1.0.0" });
const v2 = registry({ "ei-fixo": "1.1.0", "ei-livre": "1.1.0", "ei-ausente": "1.1.0" });

console.log("== export ==");
let DOC;
{
  await ensureCommand("ei-fixo", v1.opts);
  await ensureCommand("ei-livre", v1.opts);
  const p = await pinCommand("ei-fixo", v1.opts);
  check("preparo: dois motores instalados, um fixado, um ausente", p.ok && instalado("ei-fixo") === "1.0.0" && instalado("ei-livre") === "1.0.0" && instalado("ei-ausente") === null && pinOf("ei-fixo") === "1.0.0", JSON.stringify(p));
  const t = ler(trustPath());
  t["ei-livre"] = { ...t["ei-livre"], usuario: "fulano-de-tal", maquina: "PC-DO-FULANO", caminho: RUN };
  writeFileSync(trustPath(), JSON.stringify(t));

  const ex = await exportar(undefined, { bundled: v1.manifest });
  DOC = ex.doc ?? doc([]);
  check("o documento diz formato, versão do kit e, por motor instalado, nome, versão e pin (o ausente fica de fora)", ex.ok && JSON.stringify(ex.doc) === JSON.stringify(doc([{ name: "ei-fixo", version: "1.0.0", pin: "1.0.0" }, { name: "ei-livre", version: "1.0.0" }])), JSON.stringify(ex));
  const texto = JSON.stringify(ex.doc ?? {});
  const proibidos = [owner.publicKeyHex, RUN, "fulano-de-tal", "PC-DO-FULANO", hostname(), "publicKey", "signature", "firstSeen", "maxVersion"];
  check("o documento não leva chave pública, assinatura, caminho local, nem o que mais houver no trust.json", proibidos.every((p) => !texto.includes(p)), proibidos.find((p) => texto.includes(p)));
  check("só as chaves conhecidas, com valores em formato de nome e de versão", ex.ok && Object.keys(ex.doc).join() === "formato,kit,engines" && ex.doc.engines.every((e) => Object.keys(e).every((k) => ["name", "version", "pin"].includes(k)) && /^[a-z0-9-]+$/.test(e.name) && /^\d+\.\d+\.\d+$/.test(e.version)), texto);

  const arq = join(RUN, "saida.json");
  const gravado = await exportar(arq, { bundled: v1.manifest });
  check("com arquivo: grava o mesmo documento, devolve o caminho e não deixa .part", gravado.ok && gravado.file === arq && JSON.stringify(ler(arq)) === JSON.stringify(ex.doc) && !existsSync(`${arq}.part`), JSON.stringify(gravado));
  const sobre = await exportar(arq, { bundled: v1.manifest });
  check("exportar de novo sobre o arquivo substitui", sobre.ok && JSON.stringify(ler(arq)) === JSON.stringify(ex.doc));
  const semPasta = await exportar(join(RUN, "nao-existe", "x.json"), { bundled: v1.manifest });
  check("pasta de destino que não existe: recusa citando o arquivo, sem .part", semPasta.ok === false && /x\.json/.test(semPasta.reason) && !existsSync(join(RUN, "nao-existe")), JSON.stringify(semPasta));

  const antes = readFileSync(trustPath(), "utf8");
  writeFileSync(trustPath(), "{ ilegível");
  const ilegivel = await exportar(arq, { bundled: v1.manifest });
  writeFileSync(trustPath(), antes);
  check("trust.json ilegível: recusa com o motivo e não toca o arquivo que já existia", ilegivel.ok === false && /ilegível/.test(ilegivel.reason) && JSON.stringify(ler(arq)) === JSON.stringify(ex.doc), JSON.stringify(ilegivel));

  const estranho = registry({ "ei-estranho": "1.0.0" });
  preinstalar("ei-estranho", "1.0.0-rc1");
  const rc = await exportar(undefined, { bundled: estranho.manifest });
  check("versão instalada fora de x.y.z: recusa nomeando o motor, em vez de gerar um documento que o import recusaria", rc.ok === false && /ei-estranho/.test(rc.reason) && /1\.0\.0-rc1/.test(rc.reason), JSON.stringify(rc));
  rmSync(homeOf("ei-estranho"), { recursive: true, force: true });

  const vazio = await exportar(undefined, { bundled: registry({ "ei-nada": "1.0.0" }).manifest });
  check("sem motor instalado: documento válido com a lista vazia", vazio.ok && JSON.stringify(vazio.doc.engines) === "[]", JSON.stringify(vazio));
}

console.log("\n== import: a versão registrada, pelo ensure ==");
{
  const arq = gravar(DOC);
  limpar("ei-fixo", "ei-livre");
  const { fetcher, conta } = juntos(v1, v2);
  const opts = { bundled: v2.manifest, manifest: v2.manifest, fetcher };
  const r = await importar(arq, opts);
  check("instala a versão do documento (1.0.0), não a que o registry oferece agora (1.1.0)", r.ok && instalado("ei-fixo") === "1.0.0" && instalado("ei-livre") === "1.0.0", JSON.stringify(r));
  check("a assinatura foi conferida em cada motor", r.ok && r.engines.length === 2 && r.engines.every(([, e]) => e.ok && e.signed === true), JSON.stringify(r.engines));
  check("fixa só quem estava fixado", pinOf("ei-fixo") === "1.0.0" && pinOf("ei-livre") === undefined && linha(r, "ei-fixo")?.pinned === "1.0.0" && linha(r, "ei-livre")?.pinned === undefined);
  check("o motor que o documento não cita não foi instalado", instalado("ei-ausente") === null);

  const baixados = conta.n, hist = trocas();
  const de_novo = await importar(arq, opts);
  check("importar de novo reusa: nada baixado, nada trocado, motores seguem fixados como estavam", de_novo.ok && conta.n === baixados && trocas() === hist && linha(de_novo, "ei-fixo").reused === true && pinOf("ei-fixo") === "1.0.0", JSON.stringify(de_novo));
}

console.log("\n== import --dry-run: só o plano ==");
{
  const arq = gravar(DOC);
  limpar("ei-fixo", "ei-livre");
  const { fetcher, conta } = juntos(v1, v2);
  const opts = { bundled: v2.manifest, manifest: v2.manifest, fetcher, dryRun: true };
  const p = await importar(arq, opts);
  check("planos do ensure: instalaria, e fixaria o que estava fixado", p.ok && p.dryRun === true && planoDe(linha(p, "ei-fixo")) === "instalaria v1.0.0 e fixaria" && planoDe(linha(p, "ei-livre")) === "instalaria v1.0.0", JSON.stringify(p));
  check("nada foi instalado, fixado, baixado nem gravado no histórico", instalado("ei-fixo") === null && instalado("ei-livre") === null && !existsSync(homeOf("ei-fixo")) && pinOf("ei-fixo") === undefined && trocas() === "" && conta.n === 0, `${conta.n} ${trocas()}`);

  await importar(arq, { ...opts, dryRun: false });
  const hist = trocas(), baixados = conta.n;
  const pronto = await importar(arq, opts);
  check("já instalado e fixado: o plano diz fixaria (já instalada) e reusaria, e continua sem tocar em nada", planoDe(linha(pronto, "ei-fixo")) === "fixaria v1.0.0 (já instalada)" && planoDe(linha(pronto, "ei-livre")) === "reusaria v1.0.0, já em dia" && trocas() === hist && conta.n === baixados, JSON.stringify(pronto));

  const velho = await importar(gravar(doc([{ name: "ei-livre", version: "1.1.0" }])), opts);
  check("outra versão instalada: o plano diz atualizaria (de 1.0.0 para 1.1.0) e a instalada fica", planoDe(linha(velho, "ei-livre")) === "atualizaria v1.0.0 → v1.1.0" && instalado("ei-livre") === "1.0.0", JSON.stringify(velho));
}

console.log("\n== documento inválido: recusado inteiro, antes de instalar qualquer coisa ==");
{
  limpar("ei-fixo", "ei-livre");
  const bom = { name: "ei-livre", version: "1.0.0" };
  const casos = [
    ["arquivo inexistente", join(RUN, "nao-existe.json"), /não consegui ler/],
    ["JSON ilegível", gravar("{ isto nao e json"), /não consegui ler/],
    ["raiz que é lista", gravar("[]"), /objeto/],
    ["raiz nula", gravar("null"), /objeto/],
    ["raiz que é texto", gravar('"x"'), /objeto/],
    ["sem formato", gravar({ kit: "0.2.19", engines: [bom] }), /formato/],
    ["formato de outro número", gravar(doc([bom], { formato: 2 })), /formato/],
    ["sem a versão do kit", gravar({ formato: 1, engines: [bom] }), /kit/],
    ["chave estranha na raiz", gravar(doc([bom], { chave: "x" })), /chave desconhecida "chave"/],
    ["chave pública dentro de um motor", gravar(doc([{ ...bom, publicKey: "aa".repeat(32) }])), /chave desconhecida "publicKey"/],
    ["engines que não é lista", gravar(doc({ bom })), /engines/],
    ["motor que não é objeto", gravar(doc([bom, "ei-fixo"])), /engines\[1\]/],
    ["nome com caminho", gravar(doc([{ name: "../x", version: "1.0.0" }])), /name/],
    ["nome em maiúsculas", gravar(doc([{ name: "EI", version: "1.0.0" }])), /name/],
    ["nome vazio", gravar(doc([{ name: "", version: "1.0.0" }])), /name/],
    ["nome que não é texto", gravar(doc([{ name: 42, version: "1.0.0" }])), /name/],
    ["nome __proto__", gravar(doc([{ name: "__proto__", version: "1.0.0" }])), /name/],
    ["versão x.y", gravar(doc([{ name: "ei-livre", version: "1.0" }])), /version/],
    ["versão latest", gravar(doc([{ name: "ei-livre", version: "latest" }])), /version/],
    ["versão que é número", gravar(doc([{ name: "ei-livre", version: 1 }])), /version/],
    ["versão que é lista", gravar(doc([{ name: "ei-livre", version: ["1.0.0"] }])), /version/],
    ["versão de pré-lançamento", gravar(doc([{ name: "ei-livre", version: "1.0.0-rc1" }])), /version/],
    ["pin fora de x.y.z", gravar(doc([{ ...bom, pin: "x" }])), /pin/],
    ["pin que é número", gravar(doc([{ ...bom, pin: 1 }])), /pin/],
    ["pin nulo", gravar(doc([{ ...bom, pin: null }])), /pin/],
    ["motor repetido", gravar(doc([bom, bom])), /repetido/],
    ["um motor bom e outro inválido: nenhum é instalado", gravar(doc([bom, { name: "ei-fixo", version: "x" }])), /engines\[1\]/],
  ];
  const { fetcher, conta } = juntos(v1);
  for (const [nome, arq, razao] of casos) {
    const r = await importar(arq, { bundled: v1.manifest, manifest: v1.manifest, fetcher });
    check(`${nome}: recusado com a razão, nada instalado`, r.ok === false && razao.test(r.reason) && r.engines === undefined && instalado("ei-livre") === null && instalado("ei-fixo") === null, JSON.stringify(r));
  }
  check("nenhuma recusa baixou artefato nem gravou trust.json ou histórico", conta.n === 0 && !existsSync(trustPath()) && trocas() === "", `${conta.n}`);

  const polui = [
    '{"__proto__":{"polluted":"sim"},"formato":1,"kit":"0.2.19","engines":[]}',
    '{"formato":1,"kit":"0.2.19","engines":[{"name":"ei-livre","version":"1.0.0","__proto__":{"polluted":"sim"}}]}',
    '{"formato":1,"kit":"0.2.19","engines":[{"name":"ei-livre","version":"1.0.0","constructor":{"prototype":{"polluted":"sim"}}}]}',
  ];
  for (const [i, texto] of polui.entries()) {
    const r = await importar(gravar(texto), { bundled: v1.manifest, manifest: v1.manifest, fetcher });
    check(`documento com __proto__/constructor (${i + 1}): recusado e nada é poluído`, r.ok === false && ({}).polluted === undefined && Object.prototype.polluted === undefined && instalado("ei-livre") === null && !existsSync(trustPath()), JSON.stringify(r));
  }
  const vazio = await importar(gravar(doc([])), { bundled: v1.manifest, manifest: v1.manifest, fetcher });
  check("documento válido com a lista vazia: ok, nada a fazer", vazio.ok === true && vazio.engines.length === 0, JSON.stringify(vazio));
}

console.log("\n== um motor recusado não impede os outros ==");
{
  const reg = registry({ "pe-a": "1.0.0", "pe-b": "1.0.0", "pe-sem-build": "1.0.0", "pe-adulterado": "1.0.0", "pe-pin": "1.0.0" });
  reg.manifest.engines.find((e) => e.name === "pe-sem-build").platforms = ["plan9-x64"];
  const novo = registry({ "pe-pin": "1.1.0" });
  const adulterado = async (url, ...resto) => {
    const b = await reg.fetcher(url, ...resto);
    return url.endsWith("pe-adulterado.tgz") ? Buffer.concat([b, Buffer.from("x")]) : b;
  };
  const { fetcher } = juntos({ fetcher: adulterado }, novo);
  const opts = { bundled: reg.manifest, manifest: reg.manifest, fetcher };
  await pinCommand("pe-pin", { ...reg.opts, version: "1.0.0" });
  const r = await importar(gravar(doc([
    { name: "pe-a", version: "1.0.0" },
    { name: "pe-desconhecido", version: "1.0.0" },
    { name: "pe-sem-build", version: "1.0.0" },
    { name: "pe-b", version: "9.9.9" },
    { name: "pe-adulterado", version: "1.0.0" },
    { name: "pe-pin", version: "1.1.0" },
    { name: "pe-a2", version: "1.0.0" },
  ])), opts);
  check("o resultado é ok:false e traz uma linha por motor, na ordem do documento", r.ok === false && r.engines?.map(([n]) => n).join() === "pe-a,pe-desconhecido,pe-sem-build,pe-b,pe-adulterado,pe-pin,pe-a2", JSON.stringify(r.engines?.map(([n, e]) => [n, e.ok])));
  check("o motor bom foi instalado", linha(r, "pe-a")?.ok === true && instalado("pe-a") === "1.0.0");
  check("motor que o registry não conhece: recusado mandando atualizar o kit", linha(r, "pe-desconhecido")?.ok === false && /não está no manifest/.test(linha(r, "pe-desconhecido").reason) && /engine-kit@latest ensure pe-desconhecido/.test(linha(r, "pe-desconhecido").reason), JSON.stringify(linha(r, "pe-desconhecido")));
  check("plataforma sem build: recusado dizendo a plataforma", linha(r, "pe-sem-build")?.ok === false && /não tem build para/.test(linha(r, "pe-sem-build").reason) && instalado("pe-sem-build") === null, JSON.stringify(linha(r, "pe-sem-build")));
  check("versão que o registry não tem: falhou sem instalar nada", linha(r, "pe-b")?.ok === false && instalado("pe-b") === null && !existsSync(join(homeOf("pe-b"), "bin")), JSON.stringify(linha(r, "pe-b")));
  check("artefato adulterado: recusado pelo sha256, não instalado", linha(r, "pe-adulterado")?.ok === false && /SHA256 mismatch/.test(linha(r, "pe-adulterado").reason) && instalado("pe-adulterado") === null, JSON.stringify(linha(r, "pe-adulterado")));
  check("pin local diferente da versão do documento: recusado e a instalada fica", linha(r, "pe-pin")?.ok === false && /fixado em v1\.0\.0/.test(linha(r, "pe-pin").reason) && instalado("pe-pin") === "1.0.0" && pinOf("pe-pin") === "1.0.0", JSON.stringify(linha(r, "pe-pin")));
  check("um motor depois dos recusados ainda é tentado (aqui também recusado, por não existir)", linha(r, "pe-a2")?.ok === false, JSON.stringify(linha(r, "pe-a2")));
  const so_bons = await importar(gravar(doc([{ name: "pe-a", version: "1.0.0" }])), opts);
  check("(controle) só o motor bom: ok:true", so_bons.ok === true);
}
globalThis.fetch = redeAntes;
check("nenhum caso tocou a rede", rede.chamadas === 0, String(rede.chamadas));

console.log("\n== pelo CLI, offline ==");
{
  const reg = registry({ "cli-a": "2.0.0", "cli-b": "2.0.0" });
  const { cli } = await criarCliOffline(RUN, { manifest: reg.manifest, artefatos: reg.artefatos });
  const kitHome = join(RUN, "kit-home-cli");
  const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const uso = cli("--help").stdout;
  check("o uso documenta export e import", /engine-kit export \[arquivo\]/.test(uso) && /engine-kit import <arquivo> .*--dry-run/.test(uso), uso.slice(0, 200));

  const vazio = cli("export");
  check("export sem arquivo com nada instalado: JSON válido só no stdout, lista vazia", vazio.status === 0 && json(vazio.stdout)?.formato === 1 && json(vazio.stdout).engines.length === 0, vazio.stdout + vazio.stderr);

  const inst = cli("ensure", "cli-a", "cli-b");
  const pin = cli("pin", "cli-a");
  check("preparo: dois motores instalados e um fixado", inst.status === 0 && pin.status === 0 && instalado("cli-a") === "2.0.0" && instalado("cli-b") === "2.0.0", inst.stdout + inst.stderr + pin.stderr);
  const imp = cli("export");
  const d = json(imp.stdout);
  check("export sem arquivo: o documento com os dois motores e o pin de um", imp.status === 0 && JSON.stringify(d?.engines) === JSON.stringify([{ name: "cli-a", version: "2.0.0", pin: "2.0.0" }, { name: "cli-b", version: "2.0.0" }]), imp.stdout + imp.stderr);
  const arq = join(RUN, "cli-doc.json");
  const gr = cli("export", arq);
  check("export com arquivo: grava, diz quantos motores e o stdout não traz o JSON", gr.status === 0 && /2 motor\(es\)/.test(gr.stdout) && JSON.stringify(ler(arq)) === JSON.stringify(d) && !gr.stdout.includes('"formato"'), gr.stdout + gr.stderr);

  limparEm(kitHome, ["cli-a", "cli-b"]);
  const plano = cli("import", arq, "--dry-run");
  check("import --dry-run em texto: PLANO por motor, exit 0, nada instalado", plano.status === 0 && /^PLANO cli-a: instalaria v2\.0\.0 e fixaria$/m.test(plano.stdout) && /^PLANO cli-b: instalaria v2\.0\.0$/m.test(plano.stdout) && instalado("cli-a") === null && !existsSync(join(kitHome, "trust.json")), plano.stdout + plano.stderr);
  const planoJson = json(cli("import", arq, "--dry-run", "--json").stdout);
  check("import --dry-run --json: { ok, dryRun, engines } com state PLANO e o pin", planoJson?.ok === true && planoJson.dryRun === true && planoJson.engines.length === 2 && planoJson.engines.every((e) => e.state === "PLANO") && planoJson.engines[0].pin === "2.0.0" && planoJson.engines[1].pin === null, JSON.stringify(planoJson));

  const real = cli("import", arq);
  check("import: exit 0, instala os dois e fixa o que estava fixado", real.status === 0 && /^OK cli-a v2\.0\.0 \(instalado\); fixado em v2\.0\.0$/m.test(real.stdout) && /^OK cli-b v2\.0\.0 \(instalado\)$/m.test(real.stdout) && instalado("cli-a") === "2.0.0" && instalado("cli-b") === "2.0.0" && ler(join(kitHome, "trust.json"))["cli-a"].pin === "2.0.0" && ler(join(kitHome, "trust.json"))["cli-b"].pin === undefined, real.stdout + real.stderr);
  const jsonReal = json(cli("import", arq, "--json").stdout);
  check("import --json: cada motor na linha do ensure, já reusado", jsonReal?.ok === true && jsonReal.engines.every((e) => e.state === "OK") && jsonReal.engines[0].pin === "2.0.0", JSON.stringify(jsonReal));

  const ruim = cli("import", gravar({ formato: 1, kit: "0.2.19", engines: [], extra: 1 }));
  check("documento inválido: exit 1 e a razão em stderr", ruim.status === 1 && /FALHOU import/.test(ruim.stderr) && /documento inválido/.test(ruim.stderr), ruim.stderr);
  const ruimJson = cli("import", gravar("[]"), "--json");
  const rj = json(ruimJson.stdout);
  check("documento inválido em --json: a linha de erro de sempre, exit 1", ruimJson.status === 1 && rj?.ok === false && rj.state === "ERRO" && /documento inválido/.test(rj.detail), ruimJson.stdout + ruimJson.stderr);

  limparEm(kitHome, ["cli-a", "cli-b"]);
  const mista = cli("import", gravar(doc([{ name: "fantasma", version: "1.0.0" }, { name: "cli-b", version: "2.0.0" }])));
  check("um motor desconhecido e um bom: exit 1, FALHOU com o motor, o bom instalado", mista.status === 1 && /FALHOU fantasma/.test(mista.stderr) && /^OK cli-b/m.test(mista.stdout) && instalado("cli-b") === "2.0.0", mista.stdout + mista.stderr);

  const semArquivo = cli("import");
  check("import sem arquivo: uso, exit 1", semArquivo.status === 1 && /uso: engine-kit/.test(semArquivo.stderr), semArquivo.stderr);
  const flagEstranha = cli("export", "--json");
  check("export com flag que não é dele: recusado, exit 1", flagEstranha.status === 1 && /--json não vale para `export`/.test(flagEstranha.stderr), flagEstranha.stderr);
  const comVersao = cli("import", arq, "--version", "1.0.0");
  check("import com --version: recusado, exit 1", comVersao.status === 1 && /--version não vale para `import`/.test(comVersao.stderr), comVersao.stderr);
  const doisArquivos = cli("import", arq, arq);
  check("import com dois arquivos: recusado, exit 1", doisArquivos.status === 1 && /argumento inesperado/.test(doisArquivos.stderr), doisArquivos.stderr);
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
