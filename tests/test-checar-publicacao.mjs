// test-checar-publicacao.mjs — `node tools/checar-publicacao.mjs <motor>` roda os itens automatizáveis do checklist do CONTRATO-MOTOR §6 e lista os manuais.
// A fonte da lista é o próprio §6: cada linha ou é coberta por um item automático ou aparece como manual pendente, nenhuma some.
// Item automático que não conseguiu checar nunca vira OK (NAO-CHECADO reprova), e o que depende de rede só roda com --rede.
// Hermético: manifest e chave de fixture, rede/gh/verify-release injetados, HOME isolado, sem token real.
//
//   node tests/test-checar-publicacao.mjs
import "./_tmp.mjs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairHex } from "../kit/signature.mjs";
import { problemasDeDeclaracao, problemasDaPaginaNoAr } from "../tools/product-page-order.mjs";
import { checar, linhasDoChecklist } from "../tools/checar-publicacao.mjs";

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const RUN = mkdtempSync(join(tmpdir(), "ee-checar-"));
const real = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const contrato = readFileSync(new URL("../CONTRATO-MOTOR.md", import.meta.url), "utf8");
const siteOk = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");

console.log("== gate do Pages: funções reutilizáveis ==");
check("pagesUrl https é declaração válida", problemasDeDeclaracao({ pagesUrl: "https://a.example/p/" }).length === 0);
check("pagesPendente com motivo é declaração válida", problemasDeDeclaracao({ pagesPendente: "página nasce na primeira release" }).length === 0);
check("sem pagesUrl nem pagesPendente reprova", problemasDeDeclaracao({}).length > 0);
check("pagesUrl http reprova", problemasDeDeclaracao({ pagesUrl: "http://a.example/" }).some((p) => /https/.test(p)));
check("pagesPendente curto demais reprova", problemasDeDeclaracao({ pagesPendente: "curto" }).length > 0);
const resposta = (status, corpo = "") => async () => ({ ok: status < 400, status, text: async () => corpo });
check("página no ar, com vídeo e na ordem: sem problemas", (await problemasDaPaginaNoAr("https://a.example/", { buscar: resposta(200, siteOk) })).length === 0);
check("HTTP 404 vira problema com o status", (await problemasDaPaginaNoAr("https://a.example/", { buscar: resposta(404) })).join() === "HTTP 404");
check("falha de rede vira problema com a causa, nunca lista vazia", (await problemasDaPaginaNoAr("https://a.example/", { buscar: async () => { throw new Error("ENOTFOUND"); } })).some((p) => /não foi possível baixar: ENOTFOUND/.test(p)));
check("página sem <video> reprova", (await problemasDaPaginaNoAr("https://a.example/", { buscar: resposta(200, "<html><main><h1>x</h1></main></html>") })).some((p) => /<video>/.test(p)));

console.log("\n== checklist do §6 ==");
const par = generateKeyPairHex(), outra = generateKeyPairHex();
const chave = join(RUN, "fixture.key");
writeFileSync(chave, `${par.privateKeyHex}\n`);
const motor = (mexe = () => {}) => {
  const e = structuredClone(real.engines.find((x) => x.name === "embed-house"));
  e.install.publicKey = par.publicKeyHex;
  mexe(e);
  return e;
};
const rodar = (e, extra = {}, outros = []) => checar(e.name, { manifest: { ...real, engines: [e, ...outros] }, keyPath: chave, contrato, ...extra });
const item = (r, id) => r.itens.find((i) => i.id === id);
const status = (r, id) => item(r, id)?.status;
const fake = { ponte: async () => ({ pending: 0, found: [], ignoredSelf: 0 }), verificarRelease: async () => ({ ok: true, detalhe: "release confere" }), paginaNoAr: async () => [] };

const base = await rodar(motor());
check("motor em ordem, sem --rede: chave, entrada, página e assinatura OK", ["chave", "entrada", "pagina", "assinatura"].every((id) => status(base, id) === "OK"), JSON.stringify(base.itens));
check("o que depende de rede fica NAO-RODADO e diz como rodar, nunca OK", ["release", "ponte"].every((id) => status(base, id) === "NAO-RODADO" && /--rede/.test(item(base, id).detalhe)), JSON.stringify(base.itens));
check("ok é verdadeiro quando nada falhou (NAO-RODADO não reprova, mas fica visível)", base.ok === true);
check("os itens manuais do §6 aparecem como pendentes", base.manuais.some((l) => /build produz artefato/.test(l)) && base.manuais.some((l) => /publish-base\.ps1/.test(l)) && base.manuais.some((l) => /defeito foi reproduzido/.test(l)), base.manuais.join(" | "));
check("item automático não aparece como manual", !base.manuais.some((l) => /chave gerada em/.test(l)) && !base.manuais.some((l) => /pagesUrl/.test(l)));

const todas = linhasDoChecklist(contrato);
const cobertas = base.itens.flatMap((i) => i.cobre);
check("cada linha do §6 é coberta por um item ou é manual: nenhuma some, nenhuma conta duas vezes",
  todas.length >= 13 && [...cobertas, ...base.manuais].sort().join("\n") === [...todas].sort().join("\n"), `${todas.length} linhas; ${cobertas.length} cobertas; ${base.manuais.length} manuais`);

console.log("\n-- entrada no manifest --");
const semKind = await rodar(motor((e) => { delete e.kind; }));
check("entrada sem `kind` reprova pelo schema, nomeando o campo", status(semKind, "entrada") === "FALHA" && /kind/.test(item(semKind, "entrada").detalhe) && semKind.ok === false, JSON.stringify(item(semKind, "entrada")));
const semEntry = await rodar(motor((e) => { delete e.install.entry; }));
check("entrada sem `install.entry` reprova", status(semEntry, "entrada") === "FALHA" && /entry/.test(item(semEntry, "entrada").detalhe), JSON.stringify(item(semEntry, "entrada")));
const outroQuebrado = structuredClone(real.engines.find((x) => x.name === "vxk"));
delete outroQuebrado.kind;
check("erro de OUTRO motor no manifest não reprova este", status(await rodar(motor(), {}, [outroQuebrado]), "entrada") === "OK");
const tipoErrado = await rodar(motor((e) => { e.platforms = "win32-x64"; }));
check("campo com tipo errado reprova pelo schema, nomeando o campo", status(tipoErrado, "entrada") === "FALHA" && /platforms/.test(item(tipoErrado, "entrada").detalhe), JSON.stringify(item(tipoErrado, "entrada")));

console.log("\n-- assinatura declarada no manifest --");
for (const [nome, mexe, trecho] of [
  ["sem publicKey", (e) => { delete e.install.publicKey; }, /publicKey/],
  ["signatureRequired não verdadeiro", (e) => { e.install.signatureRequired = false; }, /signatureRequired/],
  ["sem signatureAlgorithm", (e) => { delete e.install.signatureAlgorithm; }, /signatureAlgorithm/],
  ["repo que não é o engine-registry", (e) => { e.install.repo = "outro/repositorio"; }, /engine-registry/],
]) {
  const r = await rodar(motor(mexe));
  check(`${nome} reprova a assinatura, dizendo o campo`, status(r, "assinatura") === "FALHA" && trecho.test(item(r, "assinatura").detalhe) && r.ok === false, JSON.stringify(item(r, "assinatura")));
}

console.log("\n-- página de produto --");
for (const [nome, mexe] of [
  ["pagesUrl http", (e) => { delete e.pagesPendente; e.pagesUrl = "http://a.example/"; }],
  ["sem pagesUrl nem pagesPendente", (e) => { delete e.pagesPendente; }],
]) {
  check(`${nome} reprova a página`, status(await rodar(motor(mexe)), "pagina") === "FALHA");
}

console.log("\n-- chave de assinatura --");
const ausente = await rodar(motor(), { keyPath: join(RUN, "nao-existe.key") });
check("chave ausente reprova e diz como gerar", status(ausente, "chave") === "FALHA" && /gen-key\.mjs embed-house/.test(item(ausente, "chave").detalhe), JSON.stringify(item(ausente, "chave")));
const outraChave = join(RUN, "outra.key");
writeFileSync(outraChave, outra.privateKeyHex);
const diverge = await rodar(motor(), { keyPath: outraChave });
check("chave que não deriva a publicKey do manifest reprova", status(diverge, "chave") === "FALHA" && /publicKey/.test(item(diverge, "chave").detalhe), JSON.stringify(item(diverge, "chave")));
const lixo = join(RUN, "lixo.key");
writeFileSync(lixo, "SEGREDO-QUE-NAO-E-HEX");
const ilegivel = await rodar(motor(), { keyPath: lixo });
const saida = JSON.stringify(ilegivel);
check("chave ilegível reprova", status(ilegivel, "chave") === "FALHA");
check("nada da chave nem o caminho dela sai no resultado", ![lixo, "SEGREDO", par.privateKeyHex, outra.privateKeyHex].some((s) => saida.includes(s)) && !JSON.stringify(diverge).includes(outra.privateKeyHex) && !JSON.stringify(ausente).includes(RUN), saida);

console.log("\n-- com --rede (tudo injetado) --");
const rede = await rodar(motor(), { rede: true, ...fake });
check("com a rede conferida, nada fica NAO-RODADO e ok segue verdadeiro", rede.itens.every((i) => i.status === "OK") && rede.ok, JSON.stringify(rede.itens.map((i) => `${i.id}:${i.status}`)));
const pendente = await rodar(motor(), { rede: true, ...fake, ponte: async () => ({ pending: 2, found: [{ repo: "a" }, { repo: "b" }], ignoredSelf: 0 }) });
check("ocorrência da URL antiga reprova a ponte, dizendo quantos", status(pendente, "ponte") === "FALHA" && /2 arquivo/.test(item(pendente, "ponte").detalhe) && !pendente.ok, JSON.stringify(item(pendente, "ponte")));
const semGh = await rodar(motor(), { rede: true, ...fake, ponte: async () => { throw new Error("gh ausente ghp_abcdefghijklmnop1234"); } });
check("ponte que não conseguiu consultar é NAO-CHECADO e reprova, nunca OK", status(semGh, "ponte") === "NAO-CHECADO" && semGh.ok === false && /gh ausente/.test(item(semGh, "ponte").detalhe), JSON.stringify(item(semGh, "ponte")));
check("token no erro da consulta sai oculto", !JSON.stringify(semGh).includes("ghp_abcdefghijklmnop1234"));
const semRelease = await rodar(motor(), { rede: true, ...fake, verificarRelease: async () => ({ ok: false, detalhe: "HTTP 404 em .../x.tgz.sig" }) });
check("release que não confere reprova com o motivo", status(semRelease, "release") === "FALHA" && /404/.test(item(semRelease, "release").detalhe) && !semRelease.ok, JSON.stringify(item(semRelease, "release")));
const comUrl = (mexe = () => {}) => motor((e) => { e.pagesUrl = "https://a.example/p/"; mexe(e); });
const foraDoAr = await rodar(comUrl((e) => { delete e.pagesPendente; }), { rede: true, ...fake, paginaNoAr: async () => ["HTTP 404"] });
check("página fora do ar sem pagesPendente reprova", status(foraDoAr, "pagina") === "FALHA" && /HTTP 404/.test(item(foraDoAr, "pagina").detalhe), JSON.stringify(item(foraDoAr, "pagina")));
const tolerada = await rodar(comUrl(), { rede: true, ...fake, paginaNoAr: async () => ["HTTP 404"] });
check("página fora do ar com pagesPendente é tolerada, dizendo o motivo", status(tolerada, "pagina") === "OK" && /tolerad/.test(item(tolerada, "pagina").detalhe) && /pagesPendente/.test(item(tolerada, "pagina").detalhe), JSON.stringify(item(tolerada, "pagina")));
const noAr = await rodar(comUrl(), { rede: true, ...fake });
check("página no ar passa", status(noAr, "pagina") === "OK" && /no ar/.test(item(noAr, "pagina").detalhe), JSON.stringify(item(noAr, "pagina")));

console.log("\n-- nunca vazio=ok --");
const rejeita = async (p) => { try { await p; return null; } catch (e) { return e.message; } };
check("contrato sem a seção do checklist: erro, não relatório vazio", /checklist/.test(await rejeita(rodar(motor(), { contrato: "# nada\n" })) ?? ""));
check("linha do §6 que um item automático cobre sumiu do contrato: erro nomeando o item", /chave/.test(await rejeita(rodar(motor(), { contrato: contrato.replace(/^\[ \] chave gerada.*$/m, "") })) ?? ""));
check("motor fora do manifest: erro", /não existe/.test(await rejeita(checar("nao-existe", { manifest: real, keyPath: chave, contrato })) ?? ""));

console.log("\n== linha de comando ==");
const arquivoManifest = (e) => { const f = join(RUN, `manifest-${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify({ ...real, engines: [e] })); return f; };
const cli = (args, env = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["tools/checar-publicacao.mjs", ...args], {
    cwd: new URL("..", import.meta.url), windowsHide: true,
    env: { ...process.env, HOME: RUN, USERPROFILE: RUN, ...env },
  });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ code, out, err }));
});
const comChave = { ENGINE_SIGNING_KEY_EMBED_HOUSE: chave };
const bom = await cli(["embed-house", "--manifest", arquivoManifest(motor())], comChave);
check("motor em ordem: exit 0, itens OK, NAO-RODADO e manuais visíveis", bom.code === 0 && /OK +chave/.test(bom.out) && /NAO-RODADO +ponte/.test(bom.out) && /manuais/.test(bom.out) && /publish-base\.ps1/.test(bom.out), `exit ${bom.code} ${bom.out}${bom.err}`);
const ruim = await cli(["embed-house", "--manifest", arquivoManifest(motor((e) => { e.install.signatureRequired = false; }))], comChave);
check("item automático que falha: exit 1 e a linha FALHA", ruim.code === 1 && /FALHA +assinatura/.test(ruim.out), `exit ${ruim.code} ${ruim.out}${ruim.err}`);
const semChave = await cli(["embed-house", "--manifest", arquivoManifest(motor())], { ENGINE_SIGNING_KEY_EMBED_HOUSE: join(RUN, "nada.key") });
check("sem a chave de assinatura nesta máquina: exit 1", semChave.code === 1 && /FALHA +chave/.test(semChave.out), `exit ${semChave.code} ${semChave.out}`);
check("o relatório não imprime o caminho nem o conteúdo da chave", ![chave, par.privateKeyHex, join(RUN, "nada.key")].some((s) => (bom.out + bom.err + semChave.out + semChave.err).includes(s)));
const js = await cli(["embed-house", "--json", "--manifest", arquivoManifest(motor())], comChave);
const dados = (() => { try { return JSON.parse(js.out); } catch { return null; } })();
check("--json imprime só o objeto: motor, ok, itens e manuais", js.code === 0 && dados?.motor === "embed-house" && dados.ok === true && Array.isArray(dados.itens) && dados.manuais.length > 0, js.out.slice(0, 200) + js.err);
const jsFalha = await cli(["embed-house", "--json", "--manifest", arquivoManifest(motor((e) => { delete e.kind; }))], comChave);
check("--json com item falhando: exit 1 e o JSON traz ok:false", jsFalha.code === 1 && JSON.parse(jsFalha.out).ok === false, jsFalha.out.slice(0, 200));
const sem = await cli([]);
check("sem motor: uso e exit 2", sem.code === 2 && /uso:/.test(sem.err), `exit ${sem.code} ${sem.err}`);
const desconhecido = await cli(["nao-existe", "--manifest", arquivoManifest(motor())], comChave);
check("motor fora do manifest: exit 2 com o motivo, nunca relatório", desconhecido.code === 2 && /não existe/.test(desconhecido.err) && desconhecido.out === "", `exit ${desconhecido.code} ${desconhecido.err}`);
const flag = await cli(["embed-house", "--inventada"]);
check("flag desconhecida: exit 2", flag.code === 2 && /--inventada/.test(flag.err), flag.err);

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
