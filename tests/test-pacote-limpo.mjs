// test-pacote-limpo.mjs — o pacote npm leva só o que o kit publica: nada de estado efêmero de ferramenta local nem de pasta de trabalho.
//
// Um hook local grava `kit/.token-guard/sessions/*.json` dentro de `kit/`; o `.gitignore` o esconde do git, mas o campo `files` do
// package.json inclui a pasta `kit` inteira. Sem a exclusão explícita, o arquivo vai para o tarball. A lista vem de `npm pack --dry-run`,
// que não escreve tarball nem toca a rede.
//
//   node tests/test-pacote-limpo.mjs
import "./_tmp.mjs";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const raiz = join(import.meta.dirname, "..");
let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const pasta = join(raiz, "kit", ".token-guard", "sessions");
const sentinela = join(pasta, "teste-pacote-limpo.json");
const existia = existsSync(join(raiz, "kit", ".token-guard"));
mkdirSync(pasta, { recursive: true });
writeFileSync(sentinela, "{}");
let arquivos = [];
try {
  const saida = execSync("npm pack --dry-run --json", { cwd: raiz, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  arquivos = JSON.parse(saida)[0].files.map((f) => f.path.replaceAll("\\", "/"));
} finally {
  rmSync(sentinela, { force: true });
  if (!existia) rmSync(join(raiz, "kit", ".token-guard"), { recursive: true, force: true });
}

check("o pacote lista arquivos", arquivos.length > 20, String(arquivos.length));
check("estado de ferramenta local em kit/.token-guard fica fora do pacote", !arquivos.some((p) => p.includes(".token-guard")), arquivos.filter((p) => p.includes(".token-guard")).join(", "));
check("o pacote só leva as raízes declaradas em `files`", arquivos.every((p) => /^(kit\/|consumers\/|manifest\.json$|README\.md$|CONTRATO-MOTOR\.md$|LICENSE$|package\.json$)/.test(p)), arquivos.filter((p) => !/^(kit\/|consumers\/|manifest\.json$|README\.md$|CONTRATO-MOTOR\.md$|LICENSE$|package\.json$)/.test(p)).join(", "));
check("o kit continua no pacote", arquivos.includes("kit/index.mjs") && arquivos.includes("kit/cli.mjs"));

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
