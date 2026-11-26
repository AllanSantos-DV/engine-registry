// test-readme-receitas.mjs — a seção "Receitas" do README só cita comandos e flags que o CLI aceita de verdade.
//
// O que precisa ser verdade:
//   • a seção existe e traz as quatro receitas (hook de início de sessão, porta de CI, provisionar, levar o ambiente), cada uma com ao menos um comando;
//   • todo `engine-kit <verbo> ...` da seção usa um verbo de VERBS e só flags de FLAGS desse verbo, em `kit/cli.mjs`;
//   • toda `--flag` citada em código na seção existe em algum verbo do cli;
//   • a receita do hook cita os comandos certos e só estados do doctor que o `diagnose.mjs` produz;
//   • as receitas de CI, de provisionamento e de mover o ambiente citam os comandos pedidos (check --json, --falhar-se-desatualizado, ensure <motor>, export | import -, fetch --com-assinaturas, ensure --de-arquivo);
//   • o verificador recusa verbo e flag que não existem (controle), então um README errado não passaria.
//
//   node tests/test-readme-receitas.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(import.meta.dirname, "..");
const readme = readFileSync(join(RAIZ, "README.md"), "utf8");
const cli = readFileSync(join(RAIZ, "kit", "cli.mjs"), "utf8");
const diagnose = readFileSync(join(RAIZ, "kit", "diagnose.mjs"), "utf8");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const VERBS = [...cli.match(/const VERBS = \[(.*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const FLAGS = Object.fromEntries([...cli.match(/const FLAGS = \{([\s\S]*?)\n\};/)[1].matchAll(/^\s+(\w+): \[(.*)\],?$/gm)].map((m) => [m[1], [...m[2].matchAll(/"([^"]+)"/g)].map((f) => f[1])]));
const TODAS = new Set(Object.values(FLAGS).flat());

/** Texto dos trechos de código (blocos e `spans`) de um markdown. */
const codigo = (md) => [...md.matchAll(/```[^\n]*\n([\s\S]*?)```|`([^`\n]+)`/g)].map((m) => m[1] ?? m[2]).join("\n");

/** Cada `engine-kit <verbo> ...` do código: o verbo e as flags até o fim do comando (pipe, comentário ou fim de linha). */
const comandos = (trecho) => [...trecho.matchAll(/engine-kit\s+([a-z][\w-]*)([^\n|&;#"]*)/g)].map((m) => ({ verbo: m[1], flags: m[2].match(/--[a-z][a-z-]*/g) ?? [], texto: m[0].trim() }));

/** Problemas dos comandos: verbo fora de VERBS ou flag que o verbo não aceita. */
const problemas = (cmds) => cmds.flatMap((c) => !VERBS.includes(c.verbo) ? [`verbo desconhecido: ${c.texto}`] : c.flags.filter((f) => !(FLAGS[c.verbo] ?? []).includes(f)).map((f) => `${f} não vale para ${c.verbo}: ${c.texto}`));

const inicio = readme.search(/^## Receitas\s*$/m);
const secao = inicio === -1 ? "" : readme.slice(inicio).split(/\n## /)[0];
const receitas = secao.split(/\n### /).slice(1);
const doCodigo = codigo(secao);
const cmds = comandos(doCodigo);

console.log("== a seção ==");
check("o README tem a seção Receitas", inicio !== -1);
check("são quatro receitas, cada uma com ao menos um comando do kit", receitas.length === 4 && receitas.every((r) => comandos(codigo(r)).length > 0), receitas.map((r) => r.split("\n")[0]).join(" | "));
check("os títulos são o hook de início de sessão, a porta de CI, o provisionamento e o ambiente em outra máquina", /sess[aã]o/i.test(receitas[0] ?? "") && /CI/.test(receitas[1] ?? "") && /(postinstall|primeira execu)/i.test((receitas[2] ?? "").split("\n")[0]) && /m[aá]quina/i.test((receitas[3] ?? "").split("\n")[0]), receitas.map((r) => r.split("\n")[0]).join(" | "));

console.log("\n== comandos e flags existem no cli ==");
{
  check("a seção cita comandos (o extrator achou algum)", cmds.length >= 8, String(cmds.length));
  check("todo verbo citado está em VERBS e toda flag é aceita por esse verbo", problemas(cmds).length === 0, problemas(cmds).join("; "));
  const soltas = [...new Set(doCodigo.match(/--[a-z][a-z-]*/g) ?? [])].filter((f) => !TODAS.has(f));
  check("toda --flag citada em código existe em algum verbo", soltas.length === 0, soltas.join());
  check("controle: o verificador acusa verbo e flag que não existem", problemas(comandos("engine-kit inventado --x\nengine-kit doctor --nao-existe\nengine-kit list --json")).length === 2);
}

console.log("\n== o que cada receita cita ==");
{
  const [hook = "", ci = "", provisionar = "", ambiente = ""] = receitas;
  const ha = (r, verbo, ...flags) => comandos(codigo(r)).some((c) => c.verbo === verbo && flags.every((f) => c.flags.includes(f)));
  check("hook: doctor --local --json", ha(hook, "doctor", "--local", "--json"));
  const estados = [...new Set([...hook.matchAll(/`([A-ZÀ-Ú][A-ZÀ-Ú -]+)`/g)].map((m) => m[1]))];
  check("hook: diz como ler o `state` e cita só estados que o diagnose.mjs produz", /state/.test(hook) && estados.length >= 3 && estados.every((e) => diagnose.includes(`"${e}"`)), estados.filter((e) => !diagnose.includes(`"${e}"`)).join() || "sem estados citados");
  check("CI: check <manifesto> --json com exit 1", ha(ci, "check", "--json") && /exit 1/.test(ci));
  check("CI: --falhar-se-desatualizado no ensure --dry-run e no ensure --instalados --dry-run", ha(ci, "ensure", "--dry-run", "--falhar-se-desatualizado") && ha(ci, "ensure", "--instalados", "--dry-run", "--falhar-se-desatualizado"));
  check("provisionar: ensure <motor>", ha(provisionar, "ensure") && /postinstall/.test(provisionar));
  check("ambiente: export | import -", /engine-kit export[^\n]*\|[^\n]*engine-kit import -/.test(ambiente));
  check("ambiente: fetch --com-assinaturas e ensure --de-arquivo", ha(ambiente, "fetch", "--com-assinaturas") && ha(ambiente, "ensure", "--de-arquivo"));
}

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
