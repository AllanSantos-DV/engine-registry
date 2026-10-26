// test-readme-versions.mjs — a tabela "Motores registrados" do README mostra a versão que o manifest.json publica.
// Evita a deriva em que o manifest sobe a cada release e a vitrine do README fica para trás.
//
//   node tests/test-readme-versions.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "manifest.json"), "utf8"));
const readme = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");
for (const { name, version } of manifest.engines) {
  const linha = readme.match(new RegExp("^\\| `" + name + "` \\| ([^ |]+) \\|", "m"));
  check(`README lista ${name} na versão do manifest`, linha?.[1] === version, `README ${linha?.[1] ?? "(sem linha)"}, manifest ${version}`);
}

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
