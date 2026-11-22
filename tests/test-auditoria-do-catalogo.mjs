// test-auditoria-do-catalogo.mjs — `verify-release --all` e `checar-publicacao --todos` auditam o catálogo inteiro numa passada.
//
// O que precisa ser verdade:
//   • verify-release --all confere cada motor e cada app, um por vez, e a falha de um não impede a conferência dos outros;
//   • entrada com status pending-release é pulada e dita; qualquer falha reprova o conjunto e nomeia quem falhou;
//   • checar-publicacao --todos roda o checklist de cada motor, o exit é o pior de todos e motor que lança entra como falha com o motivo;
//   • --todos não combina com um motor; sem alvo o uso é mostrado; o uso por motor único segue igual.
// Hermético: a conferência de cada entrada é injetada (nada baixa da rede).
//
//   node tests/test-auditoria-do-catalogo.mjs
import "./_tmp.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verificarTodos } from "../kit/verify-all.mjs";
import { checarTodos, run } from "../tools/checar-publicacao.mjs";

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const manifest = {
  engines: [{ name: "alfa", version: "1.0.0" }, { name: "beta", version: "2.0.0" }, { name: "gama", version: "0.1.0", status: "pending-release" }],
  apps: [{ name: "app-um", version: "3.0.0" }],
};

console.log("== verify-release --all ==\n");
{
  const pedidos = [], linhas = [];
  const r = await verificarTodos(manifest, { rodar: async (a) => { pedidos.push(a.join(" ")); return { ok: true, saida: "" }; }, log: (m) => linhas.push(m) });
  check("confere motores e apps na ordem do manifest, com --app para app", JSON.stringify(pedidos) === JSON.stringify(["alfa", "beta", "--app app-um"]), pedidos.join("|"));
  check("pending-release é pulado, dito e não chama a conferência", r.puladas.join() === "gama" && !pedidos.includes("gama") && linhas.some((l) => /PULADO motor gama/.test(l)));
  check("tudo conferindo: ok, sem falhas", r.ok && r.falhas.length === 0 && r.total === 4);
}
{
  const linhas = [];
  const r = await verificarTodos(manifest, { rodar: (a) => (a[0] === "alfa" ? { ok: false, saida: "linha 1\nSHA256 divergente\n" } : { ok: true, saida: "" }), log: (m) => linhas.push(m) });
  check("uma falha reprova o conjunto e nomeia quem falhou", !r.ok && r.falhas.join() === "alfa" && linhas.some((l) => /FALHA {2}motor alfa v1\.0\.0: SHA256 divergente/.test(l)), linhas.join("\n"));
  check("a falha de um não impede conferir os outros", linhas.filter((l) => /^ {2}OK /.test(l)).length === 2);
  const lancou = await verificarTodos(manifest, { rodar: () => { throw new Error("rede caiu"); } });
  check("conferência que lança vira falha com o motivo, sem derrubar o laço", !lancou.ok && lancou.falhas.length === 3);
}
{
  const p = spawnSync(process.execPath, ["kit/verify-release.mjs", "--all", "--manifest", join(mkdtempSync(join(tmpdir(), "ee-aud-")), "nao-existe.json")], { cwd: new URL("..", import.meta.url), encoding: "utf8", windowsHide: true });
  check("--all com manifest ilegível falha alto com o caminho", p.status === 1 && /manifest ilegível/.test(p.stderr), p.stderr);
  const sem = spawnSync(process.execPath, ["kit/verify-release.mjs"], { cwd: new URL("..", import.meta.url), encoding: "utf8", windowsHide: true });
  check("sem alvo o uso lista o --all", sem.status === 1 && /--all/.test(sem.stderr), sem.stderr);
}

console.log("\n== checar-publicacao --todos ==\n");
{
  const rel = (motor, ok) => ({ motor, ok, itens: [{ id: "x", status: ok ? "OK" : "FALHA", detalhe: "d", cobre: [] }], manuais: [] });
  const t = await checarTodos(["alfa", "beta"], async (m) => rel(m, m === "alfa"));
  check("o pior vence: um motor com falha reprova o conjunto, os dois relatórios saem", !t.ok && t.relatorios.length === 2 && t.relatorios[0].ok && !t.relatorios[1].ok);
  const l = await checarTodos(["alfa", "beta"], async (m) => { if (m === "alfa") { throw new Error("contrato sem checklist"); } return rel(m, true); });
  check("motor que lança vira falha com o motivo e o seguinte é checado", !l.ok && l.relatorios[0].itens[0].detalhe === "contrato sem checklist" && l.relatorios[1].ok);
  const bom = await checarTodos(["alfa"], async (m) => rel(m, true));
  check("todos passando: ok", bom.ok);
}
{
  const dir = mkdtempSync(join(tmpdir(), "ee-aud-"));
  const vazio = join(dir, "vazio.json");
  writeFileSync(vazio, JSON.stringify({ engines: [] }));
  const saida = [], erros = [];
  const io = { log: (m) => saida.push(m), error: (m) => erros.push(m) };
  check("--todos num manifest sem motores: exit 0 e relatório vazio", (await run(["--todos", "--json", "--manifest", vazio], io)) === 0 && JSON.parse(saida[0]).relatorios.length === 0);
  check("--todos com um motor é recusado (exit 2)", (await run(["--todos", "alfa"], io)) === 2 && /ou um, ou todos/.test(erros.at(-1)));
  check("sem motor nem --todos mostra o uso com as duas formas (exit 2)", (await run([], io)) === 2 && /--todos/.test(erros.at(-1)));
  check("motor desconhecido no uso por motor único segue falhando com exit 2", (await run(["nao-existe", "--manifest", vazio], io)) === 2);
}

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
