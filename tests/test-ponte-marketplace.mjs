// test-ponte-marketplace.mjs — `tools/ponte-marketplace.mjs` automatiza o critério de remoção da ponte (CONTRATO-MOTOR §7): pergunta ao `gh`
// (busca de código, conta já autenticada) onde a URL antiga ainda aparece nos repositórios do dono, lista o que falta migrar e só sai com 0 quando não há nada.
// Hermético: a API do gh é injetada (função) ou um `gh` falso (script node); nenhuma chamada real, nenhuma rede, nenhum token lido.
//
//   node tests/test-ponte-marketplace.mjs
import "./_tmp.mjs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { run, collect } from "../tools/ponte-marketplace.mjs";
import { ghApi } from "../tools/actions-minutes.mjs";

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const OWNER = "dono-teste";
const NEEDLE_MKT = `${OWNER}/copilot-marketplace/releases`;
const NEEDLE_NL = `${OWNER}/neural-link-runtime`;
const hit = (repo, path, needle, fragment = `curl https://github.com/${needle}/download/x`) => ({
  repository: { full_name: `${OWNER}/${repo}` }, path, html_url: `https://github.com/${OWNER}/${repo}/blob/main/${path}`, text_matches: [{ fragment }],
});
/** API falsa: `user` e `search/code`, devolvendo `porNeedle[needle]` (lista de itens) em páginas de 100. */
const fakeApi = (porNeedle = {}, extra = {}) => {
  const chamadas = [];
  const api = async (path, opts) => {
    chamadas.push({ path, opts });
    if (path === "user") return { login: OWNER };
    const m = /^search\/code\?(.*)$/.exec(path);
    if (!m) throw new Error(`rota inesperada: ${path}`);
    const q = new URLSearchParams(m[1]);
    const needle = Object.keys(porNeedle).find((n) => q.get("q").includes(`"${n}"`));
    const todos = porNeedle[needle] ?? [];
    const page = Number(q.get("page") ?? 1), per = Number(q.get("per_page") ?? 30);
    return { total_count: todos.length, incomplete_results: false, items: todos.slice((page - 1) * per, page * per), ...extra };
  };
  api.chamadas = chamadas;
  return api;
};
const exec = async (argv, api) => {
  const out = [], err = [];
  const code = await run(argv, { api, log: (m) => out.push(m), error: (m) => err.push(m) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

console.log("== ponte do marketplace ==");
{
  const api = fakeApi({});
  const r = await exec([], api);
  check("sem ocorrência nenhuma: exit 0 e diz que nada falta migrar", r.code === 0 && /nada falta migrar/i.test(r.out), `exit ${r.code} ${r.out}${r.err}`);
  const buscas = api.chamadas.filter((c) => c.path.startsWith("search/code")).map((c) => decodeURIComponent(c.path));
  check("busca as duas URLs antigas, entre aspas, restritas ao dono (login do gh)", buscas.some((b) => b.includes(`"${NEEDLE_MKT}"`) && b.includes(`user:${OWNER}`)) && buscas.some((b) => b.includes(`"${NEEDLE_NL}"`)), buscas.join(" | "));
  check("pede os trechos de texto (text-match) para conferir a URL literal", api.chamadas.some((c) => c.path.startsWith("search/code") && JSON.stringify(c.opts?.headers ?? []).includes("text-match")));
}

{
  const api = fakeApi({
    [NEEDLE_MKT]: [hit("consumidor-a", "README.md", NEEDLE_MKT), hit("consumidor-a", "tools/baixar.ps1", NEEDLE_MKT), hit("consumidor-b", "src/provision.mjs", NEEDLE_MKT)],
    [NEEDLE_NL]: [hit("consumidor-c", "package.json", NEEDLE_NL)],
  });
  const r = await exec([], api);
  check("com ocorrências: exit 1 e lista repositório e arquivo de cada uma", r.code === 1 && /consumidor-a/.test(r.out) && /README\.md/.test(r.out) && /tools\/baixar\.ps1/.test(r.out) && /consumidor-b/.test(r.out) && /src\/provision\.mjs/.test(r.out) && /consumidor-c/.test(r.out) && /package\.json/.test(r.out), `exit ${r.code} ${r.out}`);
  check("diz quantos arquivos e repositórios faltam migrar", /4 arquivo\(s\) em 3 repositório\(s\)/.test(r.out), r.out);
  check("o exit 1 não vem de erro: nada em stderr", r.err === "", r.err);
  const j = await exec(["--json"], api);
  const o = (() => { try { return JSON.parse(j.out); } catch { return null; } })();
  check("--json: owner, pending e a lista found com repo, path, url e needle", j.code === 1 && o?.owner === OWNER && o.pending === 4 && o.found.length === 4 && o.found.every((f) => f.repo && f.path && f.url && f.needle), j.out.slice(0, 300));
  const vazio = await exec(["--json"], fakeApi({}));
  check("--json sem ocorrências: pending 0 e exit 0", vazio.code === 0 && JSON.parse(vazio.out).pending === 0 && JSON.parse(vazio.out).found.length === 0, vazio.out);
}

{
  const api = fakeApi({ [NEEDLE_MKT]: [hit("engine-registry", "CONTRATO-MOTOR.md", NEEDLE_MKT), hit("outro", "a.md", NEEDLE_MKT)] });
  const padrao = await exec(["--json"], api);
  check("o próprio engine-registry (que documenta a ponte) fica de fora por padrão", JSON.parse(padrao.out).found.map((f) => f.repo).join() === "outro" && JSON.parse(padrao.out).excluded.includes("engine-registry"), padrao.out);
  const ex = await exec(["--json", "--exclude", "outro"], api);
  check("--exclude <repo> tira também esse repositório, e o relatório diz o que excluiu", ex.code === 0 && JSON.parse(ex.out).found.length === 0 && JSON.parse(ex.out).excluded.includes("outro"), ex.out);
  const dono = await exec(["--owner", "outra-conta", "--json"], fakeApi({ "outra-conta/copilot-marketplace/releases": [hit("x", "y.md", "outra-conta/copilot-marketplace/releases")] }));
  check("--owner troca o dono da busca (sem consultar o login)", dono.code === 1 && JSON.parse(dono.out).owner === "outra-conta", dono.out);
}

{
  const api = fakeApi({
    [NEEDLE_MKT]: [
      hit("copilot-marketplace", "docs/build.mjs", NEEDLE_MKT), hit("copilot-marketplace", "README.legacy.md", NEEDLE_MKT),
      hit("copilot-marketplace", "plugins/voice-chat/voice-update.mjs", NEEDLE_MKT), hit("copilot-marketplace", "src/x.js", NEEDLE_MKT),
      hit("copilot-marketplace", "plugins/voice-chat/README.md", NEEDLE_MKT),
      hit("neural-link-runtime", "docs/cruzada.md", NEEDLE_MKT),
      hit("outro", "docs/x.md", NEEDLE_MKT), hit("outro", "README.md", NEEDLE_MKT),
    ],
    [NEEDLE_NL]: [
      hit("neural-link-runtime", "README.md", NEEDLE_NL), hit("neural-link-runtime", "docs/design/a.md", NEEDLE_NL), hit("neural-link-runtime", "src/install.js", NEEDLE_NL),
      hit("copilot-marketplace", "docs/cruzada.md", NEEDLE_NL),
      hit("outro", "docs/x.md", NEEDLE_NL),
    ],
  });
  const r = await exec(["--json"], api);
  const o = JSON.parse(r.out);
  const lista = o.found.map((f) => `${f.repo}/${f.path}|${f.needle === NEEDLE_MKT ? "mkt" : "nl"}`).sort();
  check("documentação do próprio repositório da URL buscada fica fora (docs/build.mjs, README.legacy.md, README.md e docs/ do neural-link-runtime)",
    !lista.some((x) => /^copilot-marketplace\/(docs\/build\.mjs|README\.legacy\.md)\|mkt$/.test(x)) && !lista.some((x) => /^neural-link-runtime\/(README\.md|docs\/design\/a\.md)\|nl$/.test(x)), lista.join(" "));
  check("código do próprio repositório continua listado (voice-update.mjs é consumidor real, src/x.js, src/install.js)",
    lista.includes("copilot-marketplace/plugins/voice-chat/voice-update.mjs|mkt") && lista.includes("copilot-marketplace/src/x.js|mkt") && lista.includes("neural-link-runtime/src/install.js|nl"), lista.join(" "));
  check("README fora da raiz não é documentação do repositório: continua listado", lista.includes("copilot-marketplace/plugins/voice-chat/README.md|mkt"), lista.join(" "));
  check("a auto-referência vale só para a URL do próprio repositório: um repositório do canal antigo que cita a URL do outro continua listado",
    lista.includes("neural-link-runtime/docs/cruzada.md|mkt") && lista.includes("copilot-marketplace/docs/cruzada.md|nl"), lista.join(" "));
  check("outros repositórios ficam inalterados (docs/ e README deles seguem listados)", ["outro/docs/x.md|mkt", "outro/README.md|mkt", "outro/docs/x.md|nl"].every((x) => lista.includes(x)), lista.join(" "));
  check("o total pendente é só o que ficou na lista", o.pending === 9 && o.found.length === 9, `${o.pending}/${o.found.length}`);
  check("--json diz quantos foram ignorados como auto-referência", o.ignoredSelf === 4, JSON.stringify(o.ignoredSelf));
  const t = await exec([], api);
  check("o texto diz quantos foram ignorados como auto-referência", t.code === 1 && /4 arquivo\(s\) ignorado\(s\) como auto-referência/.test(t.out) && /9 arquivo\(s\) em 3 repositório\(s\)/.test(t.out), t.out);
  check("o texto não lista o arquivo ignorado", !/docs\/build\.mjs/.test(t.out) && !/README\.legacy\.md/.test(t.out), t.out);
}

{
  const api = fakeApi({
    [NEEDLE_MKT]: [hit("copilot-marketplace", "docs/build.mjs", NEEDLE_MKT), hit("copilot-marketplace", "README.md", NEEDLE_MKT)],
    [NEEDLE_NL]: [hit("neural-link-runtime", "docs/a.md", NEEDLE_NL)],
  });
  const r = await exec([], api);
  check("só auto-referência de documentação: exit 0, nada falta migrar, e o relatório diz quantas foram ignoradas", r.code === 0 && /nada falta migrar/i.test(r.out) && /3 arquivo\(s\) ignorado\(s\) como auto-referência/.test(r.out), `exit ${r.code} ${r.out}`);
  const vazio = await exec(["--json"], fakeApi({}));
  check("sem nenhuma ocorrência: ignoredSelf 0", JSON.parse(vazio.out).ignoredSelf === 0, vazio.out);
}

{
  const ruido = { repository: { full_name: `${OWNER}/ruido` }, path: "x.md", html_url: "https://github.com/x", text_matches: [{ fragment: "fala do marketplace e de releases, mas sem a URL" }] };
  const r = await exec(["--json"], fakeApi({ [NEEDLE_MKT]: [ruido] }));
  check("resultado da busca cujo trecho não traz a URL literal é descartado (a busca é por palavras, não por texto exato)", r.code === 0 && JSON.parse(r.out).found.length === 0, r.out);
  const caixa = await exec(["--json"], fakeApi({ [NEEDLE_MKT]: [hit("c", "a.md", NEEDLE_MKT, `https://github.com/${NEEDLE_MKT.toUpperCase()}/x`)] }));
  check("a conferência literal ignora maiúsculas (GitHub não as distingue)", caixa.code === 1 && JSON.parse(caixa.out).found.length === 1, caixa.out);
}

{
  const muitos = Array.from({ length: 130 }, (_, i) => hit(`r${i}`, "a.md", NEEDLE_MKT));
  const api = fakeApi({ [NEEDLE_MKT]: muitos });
  const r = await exec(["--json"], api);
  check("pagina a busca: coleta as 130 ocorrências em duas páginas", JSON.parse(r.out).found.length === 130 && api.chamadas.filter((c) => c.path.includes("page=")).length >= 2, `${JSON.parse(r.out).found.length}`);
}

{
  const inc = await exec([], fakeApi({}, { incomplete_results: true }));
  check("resultado incompleto da busca: exit 2 e não afirma que está vazio", inc.code === 2 && /incomplet/i.test(inc.err) && !/nada falta migrar/i.test(inc.out), `exit ${inc.code} ${inc.out}${inc.err}`);
  const trunc = await exec([], fakeApi({ [NEEDLE_MKT]: [hit("a", "a.md", NEEDLE_MKT)] }, { total_count: 5000 }));
  check("mais resultados do que a busca entrega: exit 2 (não dá para provar que acabou)", trunc.code === 2 && /truncad|mais resultados/i.test(trunc.err), `exit ${trunc.code} ${trunc.err}`);
  const falha = await exec([], async () => { throw new Error("gh api search/code (código 1): HTTP 403 rate limit; token ghp_abcdefghij1234567890 recusado"); });
  check("falha do gh: exit 2 com o motivo, o token reconhecível sai oculto", falha.code === 2 && /rate limit/.test(falha.err) && !/ghp_abcdefghij/.test(falha.err), `exit ${falha.code} ${falha.err}`);
  const ruim = await exec(["--nao-existe"], fakeApi({}));
  check("opção desconhecida: exit 2 com o motivo", ruim.code === 2 && /--nao-existe/.test(ruim.err), ruim.err);
  const semValor = await exec(["--exclude"], fakeApi({}));
  check("--exclude sem valor: exit 2", semValor.code === 2 && /--exclude/.test(semValor.err), semValor.err);
}

{
  const c = await collect({ owner: OWNER, exclude: [], api: fakeApi({ [NEEDLE_MKT]: [hit("a", "a.md", NEEDLE_MKT)] }) });
  check("collect devolve as ocorrências com a URL buscada", c.found.length === 1 && c.found[0].needle === NEEDLE_MKT && c.found[0].repo === "a", JSON.stringify(c));
}

console.log("\n-- o gh de verdade (aqui, um gh falso): tokens do ambiente zerados --");
{
  const DIR = mkdtempSync(join(tmpdir(), "ee-ponte-"));
  mkdirSync(DIR, { recursive: true });
  const fake = join(DIR, "gh-falso.mjs");
  writeFileSync(fake, `const a = process.argv.slice(2);
if (a.includes("falha")) { console.error("HTTP 401 token github_pat_ABCDEFGHIJ1234567890 invalido"); process.exit(1); }
console.log(JSON.stringify({ args: a, GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN }));\n`);
  Object.assign(process.env, { GH_TOKEN: "ghp_SEGREDO_da_conta_de_trabalho_123456", GITHUB_TOKEN: "ghp_OUTRO_SEGREDO_654321abcdef" });
  const r = await ghApi("search/code?q=x", { gh: process.execPath, prefix: [fake], headers: ["Accept: application/vnd.github.text-match+json"] });
  check("o gh roda com GH_TOKEN e GITHUB_TOKEN vazios (vale a conta do keyring)", r.GH_TOKEN === "" && r.GITHUB_TOKEN === "", JSON.stringify(r));
  check("chama `gh api` com o cabeçalho e o caminho pedidos", r.args[0] === "api" && r.args.includes("-H") && r.args.includes("Accept: application/vnd.github.text-match+json") && r.args.at(-1) === "search/code?q=x", JSON.stringify(r.args));
  let msg = "";
  try { await ghApi("falha", { gh: process.execPath, prefix: [fake] }); } catch (e) { msg = e.message; }
  check("erro do gh sobe com o motivo e sem token", /HTTP 401/.test(msg) && !/github_pat_ABCDEFGHIJ/.test(msg), msg);

  const script = new URL("../tools/ponte-marketplace.mjs", import.meta.url);
  const semGh = await new Promise((resolve) => {
    const p = spawn(process.execPath, [fileURLToPath(script)], { windowsHide: true, env: { ...process.env, PATH: DIR } });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
  check("pelo processo, sem gh no PATH: exit 2 dizendo que o gh não executou, sem vazar o token do ambiente", semGh.code === 2 && /gh/.test(semGh.err) && !/SEGREDO/.test(semGh.out + semGh.err), `exit ${semGh.code} ${semGh.out}${semGh.err}`);
  rmSync(DIR, { recursive: true, force: true });
}

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
