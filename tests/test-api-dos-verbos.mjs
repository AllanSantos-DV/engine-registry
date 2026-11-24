// test-api-dos-verbos.mjs — os verbos de leitura de `kit/inspect.mjs` são uma API importável (`engine-kit/kit/inspect.mjs`) com formato de retorno estável.
//
// O que precisa ser verdade:
//   • o subcaminho `engine-kit/kit/inspect.mjs` resolve pelo `exports` do pacote;
//   • historyCommand: sem arquivo é lista vazia; filtra por motor; linha ilegível vira ok:false com o número da linha;
//   • satisfiesRange decide a faixa e é a única que lança (faixa desconhecida), como a documentação diz;
//   • checkCommand, pathCommand e urlCommand nunca lançam: devolvem ok:false com `reason` (arquivo sem bloco engines, motor fora do manifest, sem anúncio);
//   • urlCommand não devolve campo de token.
// Hermético: ENGINE_KIT_HOME isolado, sem rede.
//
//   node tests/test-api-dos-verbos.mjs
import "./_tmp.mjs";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-api-"));
const KIT_HOME = join(RUN, "kit-home");
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });
const api = await import("engine-kit/kit/inspect.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const lanca = async (fn) => { try { await fn(); return false; } catch { return true; } };

console.log("== API dos verbos de leitura ==\n");

check("o subcaminho resolve e exporta os verbos documentados", ["historyCommand", "satisfiesRange", "checkCommand", "trustCommand", "pathCommand", "urlCommand", "reportCommand"].every((n) => typeof api[n] === "function"));

{
  const vazio = api.historyCommand();
  check("history sem arquivo: ok:true com lista vazia", vazio.ok === true && Array.isArray(vazio.entries) && vazio.entries.length === 0, JSON.stringify(vazio));
  mkdirSync(KIT_HOME, { recursive: true });
  const linha = (engine, to) => JSON.stringify({ ts: "2026-01-01T00:00:00Z", engine, from: null, to, via: "ensure" });
  writeFileSync(join(KIT_HOME, "history.jsonl"), `${linha("alfa", "1.0.0")}\n${linha("beta", "2.0.0")}\n`);
  check("history filtra por motor e devolve ts, engine, from, to e via", api.historyCommand("beta").entries.length === 1 && Object.keys(api.historyCommand("beta").entries[0]).sort().join() === "engine,from,to,ts,via");
  writeFileSync(join(KIT_HOME, "history.jsonl"), `${linha("alfa", "1.0.0")}\n{quebrado\n`);
  const ruim = api.historyCommand();
  check("history com linha ilegível: ok:false citando a linha 2, sem lançar", ruim.ok === false && /linha 2 ilegível/.test(ruim.reason), JSON.stringify(ruim));
}

{
  check("satisfiesRange: ^1.2.0 aceita 1.9.0 e recusa 2.0.0", api.satisfiesRange("1.9.0", "^1.2.0") === true && api.satisfiesRange("2.0.0", "^1.2.0") === false);
  check("satisfiesRange lança em faixa desconhecida, nunca ignora", await lanca(() => api.satisfiesRange("1.0.0", "~1.0")));
}

{
  const dir = mkdtempSync(join(tmpdir(), "ee-api-plug-"));
  const semBloco = join(dir, "sem.json"), desconhecido = join(dir, "desc.json");
  writeFileSync(semBloco, JSON.stringify({ name: "p" }));
  writeFileSync(desconhecido, JSON.stringify({ engines: { "motor-que-nao-existe": ">=1.0.0" } }));
  const a = await api.checkCommand(semBloco), b = await api.checkCommand(desconhecido), c = await api.checkCommand(join(dir, "nao-existe.json"));
  check("check sem bloco engines: ok:false com reason", a.ok === false && /sem bloco "engines"/.test(a.reason), JSON.stringify(a));
  check("check de motor fora do manifest: DESCONHECIDO, satisfied:false e ok:false", b.ok === false && b.engines[0].state === "DESCONHECIDO" && b.engines[0].satisfied === false && b.manifest === desconhecido, JSON.stringify(b));
  check("check de arquivo ausente: ok:false com reason, sem lançar", c.ok === false && typeof c.reason === "string");
}

{
  const p = await api.pathCommand("motor-que-nao-existe");
  check("path de motor fora do manifest: ok:false com reason, sem lançar", p.ok === false && /não está no manifest/.test(p.reason), JSON.stringify(p));
  const u = await api.urlCommand("motor-que-nao-existe");
  check("url sem anúncio: ok:false só com ok e reason (nenhum campo de token)", u.ok === false && Object.keys(u).sort().join() === "ok,reason" && !/token/i.test(JSON.stringify(u).replace(/shutdownToken\w*/g, "")), JSON.stringify(u));
}

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
