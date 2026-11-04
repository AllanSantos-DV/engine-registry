#!/usr/bin/env node
/**
 * Regras por escopo do engine-registry: um único comando de hook, servido pelo mcp-memory
 * (`POST /api/v1/scoped-rules/lookup`, contrato em native-java docs/contracts/regras-por-escopo.md).
 *
 *   node tools/regras-escopo.mjs --hook-origin=engine-registry      (hook; evento vem do stdin)
 *   node tools/regras-escopo.mjs publicar [--dry-run]               (docs/regras/*.md -> memória)
 *
 * Hook por categoria, um processo cada: PreToolUse entrega as regras do arquivo prestes a ser
 * gravado, uma vez por sessão; SessionStart com source compact ou clear faz a sessão esquecer o que
 * recebeu, e a próxima gravação entrega de novo. Cada decisão vai para o diário (`journal.jsonl`).
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ORIGIN = "engine-registry";
export const PROJECT_ID = "github.com/allansantos-dv/engine-registry";
export const ID_PREFIX = "rule:";
export const MAX_CHARS = 4000;
const WRITE_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const RESET_SOURCES = new Set(["compact", "clear"]);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Pasta de estado (sessões e diário); `REGRAS_ESCOPO_DIR` a troca, os testes usam uma isolada. */
export const stateDir = (env = process.env) => env.REGRAS_ESCOPO_DIR || join(ROOT, ".claude", ".regras-escopo");

/** URL do mcp-memory: `MCP_MEMORY_URL`, senão o arquivo de execução do próprio daemon. */
export function memoryUrl(env = process.env, home = homedir()) {
  if (env.MCP_MEMORY_URL) return env.MCP_MEMORY_URL.replace(/\/+$/, "");
  const file = join(home, ".mcp-memory", "run", "daemon.json");
  if (!existsSync(file)) throw new Error(`mcp-memory sem URL: defina MCP_MEMORY_URL ou suba o daemon (${file} não existe)`);
  const { url } = JSON.parse(readFileSync(file, "utf8"));
  if (!url) throw new Error(`mcp-memory sem URL em ${file}`);
  return url.replace(/\/+$/, "");
}

const sessionFile = (dir, sid) => join(dir, "sessions", `${createHash("sha256").update(String(sid)).digest("hex").slice(0, 24)}.json`);
const fingerprint = (r) => `${r.id}#${createHash("sha256").update(String(r.text || "")).digest("hex").slice(0, 12)}`;

/**
 * Impressões digitais das regras que a sessão já recebeu.
 * @param {string} dir pasta de estado
 * @param {string} sid session_id
 * @returns {string[]} vazio quando a sessão ainda não recebeu nada
 */
function readDelivered(dir, sid) {
  const file = sessionFile(dir, sid);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")).delivered;
}

/**
 * Grava o que a sessão recebeu.
 * @param {string} dir pasta de estado
 * @param {string} sid session_id
 * @param {string[]} delivered impressões digitais entregues
 */
function writeDelivered(dir, sid, delivered) {
  const file = sessionFile(dir, sid);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ delivered }));
}

/**
 * Acrescenta uma linha ao diário `journal.jsonl`, sempre com a origem.
 * @param {string} dir pasta de estado
 * @param {object} entry campos da linha (evento, sessão, arquivo, ids)
 */
function journal(dir, entry) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "journal.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), origin: ORIGIN, ...entry })}\n`);
}

/**
 * Regras que valem para os arquivos, home e do projeto, só as de id `rule:`.
 * @returns {Promise<Array<{id: string, text?: string}>>}
 */
export async function lookupRules({ baseUrl, files, fetchImpl = fetch }) {
  const res = await fetchImpl(`${baseUrl}/api/v1/scoped-rules/lookup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files, id_prefix: ID_PREFIX, include_text: true, limit: 50, project_id: PROJECT_ID }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`lookup_scoped_rules respondeu ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body).rules;
}

/** Bloco para o modelo; o que passa de `maxChars` fica de fora e espera a próxima gravação. */
export function render(rules, maxChars = MAX_CHARS) {
  const lines = [];
  const sent = [];
  let used = 0;
  for (const r of rules) {
    const line = `- (${r.id}) ${String(r.text || "").trim()}`;
    if (used + line.length > maxChars && sent.length) break;
    lines.push(line);
    sent.push(r);
    used += line.length;
  }
  return { text: `[${ORIGIN}: regras por escopo]\n${lines.join("\n")}`, sent };
}

/** PreToolUse: o texto a injetar para esta gravação, ou '' quando não há regra nova. */
export async function onPreToolUse(event, { dir = stateDir(), baseUrl, fetchImpl } = {}) {
  if (!WRITE_TOOLS.test(event.tool_name || "")) return "";
  const sid = event.session_id;
  if (!sid) throw new Error("PreToolUse sem session_id: não há como entregar uma vez por sessão");
  const ti = event.tool_input || {};
  const abs = ti.file_path || ti.notebook_path;
  if (!abs) throw new Error(`${event.tool_name} sem file_path no tool_input`);
  const rel = relative(resolve(event.cwd || ROOT), resolve(event.cwd || ROOT, abs)).split(sep).join("/");
  if (rel.startsWith("..")) { journal(dir, { session: sid, event: "fora-do-projeto", file: abs }); return ""; }

  const rules = await lookupRules({ baseUrl: baseUrl || memoryUrl(), files: [rel], fetchImpl });
  const delivered = readDelivered(dir, sid);
  const fresh = rules.filter((r) => !delivered.includes(fingerprint(r)));
  if (!fresh.length) { journal(dir, { session: sid, event: "ja-entregue", file: rel, matched: rules.length }); return ""; }

  const { text, sent } = render(fresh);
  writeDelivered(dir, sid, [...delivered, ...sent.map(fingerprint)]);
  journal(dir, { session: sid, event: "injetou", file: rel, ids: sent.map((r) => r.id), adiadas: fresh.length - sent.length, chars: text.length });
  return text;
}

/** SessionStart: compact e clear apagam o contexto da sessão, então esquecem o que ela recebeu. */
export function onSessionStart(event, { dir = stateDir() } = {}) {
  const sid = event.session_id;
  if (!sid) throw new Error("SessionStart sem session_id");
  const reset = RESET_SOURCES.has(event.source);
  if (reset) rmSync(sessionFile(dir, sid), { force: true });
  journal(dir, { session: sid, event: "session-start", source: event.source || null, reset });
  return reset;
}

/** Corpo de um `docs/regras/*.md`: frontmatter `id`, `work_kind`, `paths` (lista em bloco) e o texto. */
export function parseRuleFile(raw, file = "") {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`${file}: frontmatter ausente`);
  const meta = { paths: [] };
  let inPaths = false;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (inPaths && item) { meta.paths.push(item[1]); continue; }
    inPaths = false;
    const kv = /^([a-z_]+):\s*(.*?)\s*$/.exec(line);
    if (!kv) throw new Error(`${file}: linha de frontmatter inválida: ${line}`);
    if (kv[1] === "paths") inPaths = true; else meta[kv[1]] = kv[2];
  }
  if (!meta.id || !meta.id.startsWith(ID_PREFIX)) throw new Error(`${file}: id deve começar com ${ID_PREFIX}`);
  if (!meta.work_kind) throw new Error(`${file}: work_kind ausente`);
  if (!meta.paths.length) throw new Error(`${file}: paths vazio (a regra valeria para qualquer arquivo)`);
  return { id: meta.id, work_kind: meta.work_kind, paths: meta.paths, text: m[2].trim() };
}

/** Publica (upsert por documentId) as regras do repositório no mcp-memory, como procedural do projeto. */
export async function publishRules({ dir = join(ROOT, "docs", "regras"), baseUrl, fetchImpl = fetch, dryRun = false } = {}) {
  const rules = readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => parseRuleFile(readFileSync(join(dir, f), "utf8"), f));
  if (dryRun) return rules.map((r) => r.id);
  const url = baseUrl || memoryUrl();
  for (const r of rules) {
    const res = await fetchImpl(`${url}/api/v1/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentId: r.id, content: r.text, metadata: { type: "procedural", work_kind: r.work_kind, paths: r.paths, project_id: PROJECT_ID } }),
    });
    if (!res.ok) throw new Error(`publicar ${r.id}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return rules.map((r) => r.id);
}

/**
 * Lê o stdin inteiro.
 * @returns {Promise<string>} o evento do hook, em JSON
 */
async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Despacha o subcomando `publicar` ou o evento do hook que chega pelo stdin.
 * @param {string[]} argv argumentos da linha de comando, sem node e sem o script
 */
async function main(argv) {
  if (argv[0] === "publicar") {
    const ids = await publishRules({ dryRun: argv.includes("--dry-run") });
    console.log(`${argv.includes("--dry-run") ? "conferidas" : "publicadas"} ${ids.length}: ${ids.join(", ")}`);
    return;
  }
  const event = JSON.parse(await readStdin());
  if (event.hook_event_name === "SessionStart") { onSessionStart(event); return; }
  if (event.hook_event_name === "PreToolUse") {
    const text = await onPreToolUse(event);
    if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text } }));
    return;
  }
  throw new Error(`evento ${event.hook_event_name} não é tratado por este hook`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[hook-origin=${ORIGIN}] ${err.message}`);
    process.exit(1);
  });
}
