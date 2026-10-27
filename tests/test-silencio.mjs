// test-silencio.mjs — guarda: nenhum código que a suíte roda toca áudio real nem abre janela visível.
// Varre tests/, kit/, consumers/ e tools/ com as regras de tests/silencio.mjs e prova que as regras pegam cada
// vazamento num trecho mutado (se a regra quebrar, este teste falha antes de deixar passar o vazamento de verdade).
//
//   node tests/test-silencio.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { scanSource, silenceBrowser } from "./silencio.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const REPO = join(import.meta.dirname, "..");
// O guarda e as regras guardam os próprios padrões proibidos como texto.
const SELF = new Set(["tests/test-silencio.mjs", "tests/silencio.mjs"]);
const files = ["tests", "kit", "consumers", "tools"]
  .flatMap((d) => readdirSync(join(REPO, d), { recursive: true }).map((f) => join(REPO, d, f)))
  .filter((f) => /\.(mjs|js)$/.test(f))
  .map((f) => relative(REPO, f).replaceAll("\\", "/"))
  .filter((f) => !SELF.has(f));

console.log("== silêncio: sem áudio real e sem janela ==\n");

const achados = files.flatMap((f) => scanSource(readFileSync(join(REPO, f), "utf8")).map((a) => `${f}:${a.line} ${a.problem}`));
check(`nenhum vazamento de áudio ou janela em ${files.length} arquivos`, achados.length === 0, achados.join("\n        "));

const site = readFileSync(join(REPO, "tests", "test-site.mjs"), "utf8");
check("test-site sobe o verificador de página com o preload mudo", /"--import",\s*preload/.test(site) && /mudo-navegador\.mjs/.test(site));

console.log("\n-- as regras pegam cada vazamento (mutações) --");
const pega = (nome, trecho) => check(`pega: ${nome}`, scanSource(trecho).length > 0, trecho.replace(/\s+/g, " ").slice(0, 90));
pega("spawn sem windowsHide", `import { spawn } from "node:child_process";\nspawn(process.execPath, ["x.mjs"], { stdio: "ignore" });`);
pega("execFileSync sem opções", `import { execFileSync } from "node:child_process";\nexecFileSync("tar", ["-xzf", "a.tgz"]);`);
pega("alias de import", `import { spawnSync as run } from "node:child_process";\nrun("git", ["status"]);`);
pega("import default do módulo", `import cp from "node:child_process";\ncp.execSync("dir");`);
pega("windowsHide: false", `import { spawn } from "node:child_process";\nspawn("x", [], { windowsHide: false });`);
pega("Start-Process", `run("powershell", ["-Command", "Start-Process site/index.html"]);`);
pega("player de mídia", `run("ffplay", ["-nodisp", "fala.mp3"]);`);
pega("SoundPlayer", `const s = "(New-Object Media.SoundPlayer 'a.wav').PlaySync()";`);
pega("play() de mídia", `document.querySelector("audio").play();`);
pega("speechSynthesis", `speechSynthesis.speak(new SpeechSynthesisUtterance("oi"));`);
pega("speak() do Vox", `await vox.speak({ text: "oi" });`);
check("não pega: chamada com windowsHide: true",
  scanSource(`import { spawn } from "node:child_process";\nspawn(process.execPath, ["a"], { stdio: "ignore", windowsHide: true });`).length === 0);
check("não pega: menção em comentário", scanSource(`// o spawn(x) do Start-Process fica aqui só como texto`).length === 0);

console.log("\n-- navegador sobe mudo, headless e sem janela --");
const edge = silenceBrowser("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", ["--headless=new", "about:blank"], { stdio: "ignore" });
check("msedge ganha --mute-audio e windowsHide", edge.browser && edge.args.includes("--mute-audio") && edge.opts.windowsHide === true, edge.args.join(" "));
check("headless explícito é mantido, sem duplicar", edge.args.filter((a) => /^--headless/.test(a)).length === 1);
const chrome = silenceBrowser("/usr/bin/google-chrome", ["about:blank"]);
check("chrome sem --headless ganha --headless=new", chrome.args.includes("--headless=new") && chrome.args.includes("--mute-audio"));
const outro = silenceBrowser("C:\\Windows\\System32\\tar.exe", ["-xzf", "a.tgz"], { stdio: "ignore" });
check("outro executável passa intacto", !outro.browser && outro.args.join(" ") === "-xzf a.tgz" && outro.opts.windowsHide === undefined);

console.log(failures === 0 ? "\n== TUDO VERDE ==" : `\n== ${failures} FALHA(S) ==`);
process.exitCode = failures === 0 ? 0 : 1;
