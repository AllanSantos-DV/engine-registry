// test-regras-escopo.mjs — hook de regras por escopo (mcp-memory `lookup_scoped_rules`).
// Um mcp-memory de mentira (HTTP local, só o contrato do lookup) e pastas de estado isoladas:
// nada toca o daemon vivo da máquina, sem janela e sem áudio.
//
//   node tests/test-regras-escopo.mjs
import "./_tmp.mjs";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ORIGIN, PROJECT_ID, lookupRules, onPreToolUse, onSessionStart, parseRuleFile, publishRules, render,
} from "../tools/regras-escopo.mjs";

const ROOT = resolve(import.meta.dirname, "..");
let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const globToRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "(?:.*/)?").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*")}$`);
const RULES = {
  "rule:codigo:kit": { paths: ["kit/**"], text: "Regra do kit." },
  "rule:docs:manifest": { paths: ["manifest.json", "README.md"], text: "Regra do manifest." },
  "rule:teste:silencio": { paths: ["tests/**"], text: "Regra de teste." },
  "outra-coisa": { paths: [], text: "Sem prefixo rule: nunca deve chegar." },
};

async function memoria() {
  const seen = { lookups: [], posts: [] };
  const rules = structuredClone(RULES);
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === "/api/v1/scoped-rules/lookup") {
        seen.lookups.push(body);
        const out = Object.entries(rules)
          .filter(([id]) => id.startsWith(body.id_prefix || ""))
          .filter(([, r]) => !r.paths.length || body.files.some((f) => r.paths.some((g) => globToRe(g).test(f))))
          .map(([id, r]) => ({ id, type: "procedural", paths: r.paths, ...(body.include_text ? { text: r.text } : {}) }));
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ count: out.length, rules: out }));
      }
      if (req.url === "/api/v1/documents") { seen.posts.push(body); res.statusCode = 201; return res.end("{}"); }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { seen, rules, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((ok) => server.close(ok)) };
}

const tmp = (p) => mkdtempSync(join(tmpdir(), `regras-${p}-`));
const pre = (sid, file, tool = "Edit") => ({ hook_event_name: "PreToolUse", session_id: sid, cwd: ROOT, tool_name: tool, tool_input: { file_path: join(ROOT, file) } });
const start = (sid, source) => ({ hook_event_name: "SessionStart", session_id: sid, source });
const journal = (dir) => readFileSync(join(dir, "journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

function runHook(event, env) {
  return new Promise((ok, fail) => {
    const p = spawn(process.execPath, [join(ROOT, "tools", "regras-escopo.mjs"), `--hook-origin=${ORIGIN}`], { env: { ...process.env, ...env }, windowsHide: true });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", fail);
    p.on("close", (code) => ok({ code, out, err }));
    p.stdin.end(JSON.stringify(event));
  });
}

console.log("== regras por escopo ==\n");
const mem = await memoria();
const o = (dir) => ({ dir, baseUrl: mem.url });

{
  const dir = tmp("a");
  const t = await onPreToolUse(pre("s1", "kit/resolve.mjs"), o(dir));
  const req = mem.seen.lookups.at(-1);
  check("o lookup pede só rule:, com texto, do projeto e com o arquivo relativo", req.id_prefix === "rule:" && req.include_text === true && req.project_id === PROJECT_ID && req.files.length === 1 && req.files[0] === "kit/resolve.mjs", JSON.stringify(req));
  check("a regra do escopo do arquivo é injetada com a origem no cabeçalho", t.startsWith(`[${ORIGIN}: regras por escopo]`) && t.includes("(rule:codigo:kit) Regra do kit."));
  check("regra de outro escopo e regra sem prefixo não vêm", !t.includes("manifest") && !t.includes("outra-coisa"));
  check("segunda gravação no mesmo escopo não injeta de novo", await onPreToolUse(pre("s1", "kit/budget.mjs"), o(dir)) === "");
  const t2 = await onPreToolUse(pre("s1", "README.md"), o(dir));
  check("escopo novo na mesma sessão injeta só a regra nova", t2.includes("rule:docs:manifest") && !t2.includes("rule:codigo:kit"));
  check("outra sessão recebe o escopo de novo", (await onPreToolUse(pre("s2", "kit/resolve.mjs"), o(dir))).includes("rule:codigo:kit"));
  check("ferramenta que não grava não consulta", await onPreToolUse({ ...pre("s1", "kit/x.mjs"), tool_name: "Read" }, o(dir)) === "");
}

{
  const dir = tmp("b");
  await onPreToolUse(pre("s1", "tests/x.mjs"), o(dir));
  check("startup não esquece o que a sessão recebeu", (onSessionStart(start("s1", "startup"), { dir }), await onPreToolUse(pre("s1", "tests/y.mjs"), o(dir))) === "");
  check("resume não esquece", (onSessionStart(start("s1", "resume"), { dir }), await onPreToolUse(pre("s1", "tests/y.mjs"), o(dir))) === "");
  check("compact esquece e a próxima gravação entrega de novo", (onSessionStart(start("s1", "compact"), { dir }), (await onPreToolUse(pre("s1", "tests/y.mjs"), o(dir))).includes("rule:teste:silencio")));
  check("clear esquece e entrega de novo", (onSessionStart(start("s1", "clear"), { dir }), (await onPreToolUse(pre("s1", "tests/y.mjs"), o(dir))).includes("rule:teste:silencio")));
  check("o reset de uma sessão não mexe em outra", (await onPreToolUse(pre("s9", "tests/z.mjs"), o(dir)), onSessionStart(start("s1", "compact"), { dir }), await onPreToolUse(pre("s9", "tests/z.mjs"), o(dir))) === "");
}

{
  const dir = tmp("c");
  await onPreToolUse(pre("s1", "kit/a.mjs"), o(dir));
  mem.rules["rule:codigo:kit"].text = "Regra do kit, revisada.";
  const t = await onPreToolUse(pre("s1", "kit/a.mjs"), o(dir));
  mem.rules["rule:codigo:kit"].text = RULES["rule:codigo:kit"].text;
  check("regra com texto alterado é entregue de novo", t.includes("revisada"));
}

{
  const dir = tmp("d");
  await onPreToolUse(pre("s1", "kit/a.mjs"), o(dir));
  await onPreToolUse(pre("s1", "kit/b.mjs"), o(dir));
  onSessionStart(start("s1", "compact"), { dir });
  const j = journal(dir);
  const inj = j.find((e) => e.event === "injetou");
  check("o diário registra o que foi injetado: arquivo, ids e tamanho", inj?.file === "kit/a.mjs" && inj.ids.join() === "rule:codigo:kit" && inj.chars > 0, JSON.stringify(inj));
  check("o diário registra a repetição evitada", j.some((e) => e.event === "ja-entregue" && e.file === "kit/b.mjs"));
  check("o diário registra o reset do compact", j.some((e) => e.event === "session-start" && e.source === "compact" && e.reset === true));
  check("toda linha do diário leva a origem", j.every((e) => e.origin === ORIGIN && e.session === "s1"));
}

{
  const dir = tmp("e");
  const antes = mem.seen.lookups.length;
  const t = await onPreToolUse({ ...pre("s1", "x"), tool_input: { file_path: resolve(ROOT, "..", "outro", "a.js") } }, o(dir));
  check("arquivo fora do projeto não consulta nem injeta", t === "" && mem.seen.lookups.length === antes);
  let erro = "";
  try { await onPreToolUse({ ...pre("s1", "kit/a.mjs"), session_id: undefined }, o(dir)); } catch (e) { erro = e.message; }
  check("sem session_id falha alto", erro.includes("session_id"), erro);
}

{
  const muitas = Array.from({ length: 5 }, (_, i) => ({ id: `rule:codigo:r${i}`, text: "x".repeat(1500) }));
  const { text, sent } = render(muitas, 4000);
  check("o teto por entrega adia o que não cabe e nunca corta uma regra", sent.length === 2 && !text.includes("r2"), `${sent.length} enviadas`);
  const dir = tmp("f");
  mem.rules["rule:codigo:extra"] = { paths: ["kit/**"], text: "y".repeat(3990) };
  const t = await onPreToolUse(pre("s1", "kit/a.mjs"), o(dir));
  const t2 = await onPreToolUse(pre("s1", "kit/a.mjs"), o(dir));
  delete mem.rules["rule:codigo:extra"];
  check("a regra adiada chega na gravação seguinte", t.includes("rule:codigo:kit") && !t.includes("extra") && t2.includes("rule:codigo:extra"));
}

{
  const cfg = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8")).hooks;
  const eventos = Object.keys(cfg).sort();
  check("os hooks cobrem exatamente SessionStart e PreToolUse", eventos.join() === "PreToolUse,SessionStart", eventos.join());
  const comandos = Object.values(cfg).flat().flatMap((g) => g.hooks);
  check("um único comando por categoria de hook", Object.values(cfg).every((grupos) => grupos.flatMap((g) => g.hooks).length === 1));
  check("todo comando declara --hook-origin=engine-registry", comandos.every((h) => h.type === "command" && / --hook-origin=engine-registry$/.test(h.command)), comandos.map((h) => h.command).join(" | "));
  const script = /\$CLAUDE_PROJECT_DIR\/(tools\/[\w.-]+)/.exec(comandos[0].command)?.[1];
  check("o comando aponta para um script que existe", Boolean(script) && existsSync(join(ROOT, script)), script);
}

{
  const dir = tmp("g");
  const env = { REGRAS_ESCOPO_DIR: dir, MCP_MEMORY_URL: mem.url };
  const r = await runHook(pre("cli1", "kit/resolve.mjs"), env);
  const saida = r.out ? JSON.parse(r.out) : null;
  check("processo real: a gravação devolve additionalContext no formato do PreToolUse", r.code === 0 && saida?.hookSpecificOutput?.hookEventName === "PreToolUse" && saida.hookSpecificOutput.additionalContext.includes("rule:codigo:kit"), `${r.code} ${r.err}`);
  const r2 = await runHook(pre("cli1", "kit/resolve.mjs"), env);
  check("processo real: a repetição sai sem saída e com código 0", r2.code === 0 && r2.out === "");
  const r3 = await runHook(start("cli1", "compact"), env);
  const r4 = await runHook(pre("cli1", "kit/resolve.mjs"), env);
  check("processo real: SessionStart compact zera e a gravação entrega de novo", r3.code === 0 && r4.out.includes("rule:codigo:kit"));
  const r5 = await runHook(pre("cli1", "kit/resolve.mjs"), { ...env, MCP_MEMORY_URL: "http://127.0.0.1:1" });
  check("daemon fora: falha alto com a origem no stderr e código 1", r5.code === 1 && r5.err.startsWith(`[hook-origin=${ORIGIN}]`), r5.err.trim());
  const r6 = await runHook({ hook_event_name: "Stop", session_id: "cli1" }, env);
  check("evento não tratado falha alto", r6.code === 1 && r6.err.includes("Stop"));
}

{
  const regras = readdirSync(join(ROOT, "docs", "regras")).filter((f) => f.endsWith(".md")).map((f) => parseRuleFile(readFileSync(join(ROOT, "docs", "regras", f), "utf8"), f));
  check("as regras do repositório têm id rule:, work_kind e paths", regras.length >= 3 && regras.every((r) => r.id.startsWith("rule:") && r.work_kind && r.paths.length && r.text));
  check("ids das regras são únicos", new Set(regras.map((r) => r.id)).size === regras.length);
  let erro = "";
  try { parseRuleFile("---\nid: rule:codigo:x\nwork_kind: code\n---\ntexto", "sem-paths.md"); } catch (e) { erro = e.message; }
  check("regra sem paths é recusada (valeria para qualquer arquivo)", erro.includes("paths vazio"), erro);
  const antes = mem.seen.posts.length;
  const ids = await publishRules({ baseUrl: mem.url });
  const posts = mem.seen.posts.slice(antes);
  check("publicar envia cada regra como procedural do projeto, com documentId e escopo", posts.length === ids.length && posts.every((p) => p.metadata.type === "procedural" && p.metadata.project_id === PROJECT_ID && p.metadata.paths.length && p.documentId.startsWith("rule:")), JSON.stringify(posts[0]).slice(0, 160));
  const sem = await lookupRules({ baseUrl: mem.url, files: ["kit/a.mjs"] });
  check("lookup devolve o que o servidor casa", sem.some((r) => r.id === "rule:codigo:kit"));
}

await mem.close();
console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
