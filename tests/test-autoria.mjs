// test-autoria.mjs — a autoria do dono consta nos manifestos, na licença e nos créditos do produto, sem e-mail nem caminho pessoal.
//
//   node tests/test-autoria.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const AUTOR = "Allan Santos";
const read = (f) => readFileSync(join(REPO, f), "utf8");

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));

check("manifest.json: owner.name é o autor", manifest.owner?.name === AUTOR, manifest.owner?.name);
check("package.json: author.name é o autor", pkg.author?.name === AUTOR, pkg.author?.name);
check("LICENSE: copyright em nome do autor", new RegExp(`^Copyright \\(c\\) \\d{4} ${AUTOR}$`, "m").test(read("LICENSE")));
check("README: crédito do autor na seção Licença", new RegExp(`## Licença\\s+MIT\\. Copyright \\(c\\) \\d{4} ${AUTOR}\\.`).test(read("README.md")));
check("site: rodapé credita o autor", read("site/index.html").includes(`licença MIT · ${AUTOR}`));

for (const f of ["manifest.json", "package.json", "LICENSE", "README.md", "site/index.html"]) {
  const text = read(f);
  check(`${f}: sem e-mail nem caminho local do usuário`, !/[\w.+-]+@[\w-]+\.[\w.]+/.test(text.replace(/@[\w-]+\/[\w.-]+/g, "")) && !/[A-Za-z]:\\Users\\/i.test(text));
}

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
