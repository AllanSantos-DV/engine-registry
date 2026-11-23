// test-verbos-irmaos.mjs — `engine-kit path`, `check --rede`, `trust --restaurar` e a recusa do `rollback` depois da volta automática.
//
// O que precisa ser verdade:
//   • path: devolve o executável de um motor instalado e o estado do cli.json; recusa motor não instalado, self-managed e fora do manifest, sem inventar caminho;
//   • check --rede: para o motor ausente ou fora da faixa, diz se a versão publicada satisfaz a faixa; o que já satisfaz não ganha o campo;
//     sem --rede o resultado não muda e o registry nunca é consultado;
//   • trust --restaurar: com o principal ilegível e o .bak válido, devolve o arquivo por troca atômica (sem .tmp sobrando); com o principal legível,
//     ausente ou com o .bak também ilegível, recusa e não grava nada;
//   • rollback: depois de uma volta automática (via rollback), recusa em vez de reinstalar a versão que não subiu.
// Hermético: HOME e ENGINE_KIT_HOME isolados; o registry é um servidor HTTP local de memória.
//
//   node tests/test-verbos-irmaos.mjs
import "./_tmp.mjs";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-irmaos-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });
const { pathCommand, checkCommand, trustRestoreCommand } = await import("../kit/inspect.mjs");
const { rollbackCommand } = await import("../kit/ensure.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const descritor = (name, version, extra = {}) => ({
  name, version, kind: "cli", summary: "fixture", home: join(RUN, `home-${name}`), platforms: ["any"],
  install: { repo: "x/y", tag: `${name}-v{version}`, asset: `${name}.tgz`, checksum: "{asset}.sha256", extractTo: "bin", entry: `bin/${name}.mjs`, publicKey: "aa".repeat(32), signatureAlgorithm: "ed25519-sha256-raw" },
  ...extra,
});
const instalar = (e, version) => {
  mkdirSync(join(e.home, "bin"), { recursive: true });
  writeFileSync(join(e.home, "bin", "package.json"), JSON.stringify({ name: e.name, version }));
  writeFileSync(join(e.home, e.install.entry), "");
};

const alfa = descritor("alfa", "2.0.0"), beta = descritor("beta", "2.0.0"), gerido = descritor("gerido", "1.0.0", { status: "self-managed" });
const bundled = { engines: [descritor("alfa", "1.0.0"), descritor("beta", "1.0.0"), gerido] };
instalar(alfa, "1.0.0");

console.log("== engine-kit path ==\n");
{
  const r = await pathCommand("alfa", { bundled });
  check("motor instalado: devolve o caminho do executável", r.ok && r.path === join(alfa.home, "bin", "alfa.mjs"), JSON.stringify(r));
  check("o estado do cli.json acompanha (AUSENTE quando o motor não publicou)", r.ok && r.pointer.state === "AUSENTE", JSON.stringify(r.pointer));
  const nao = await pathCommand("beta", { bundled });
  check("motor não instalado: recusa dizendo como instalar, sem caminho", !nao.ok && /não está instalado/.test(nao.reason) && /engine-kit ensure beta/.test(nao.reason) && !("path" in nao), JSON.stringify(nao));
  const sm = await pathCommand("gerido", { bundled });
  check("motor self-managed: recusa", !sm.ok && /self-managed/.test(sm.reason), JSON.stringify(sm));
  const fora = await pathCommand("nao-existe", { bundled });
  check("motor fora do manifest: recusa pedindo para atualizar o kit", !fora.ok && /não está no manifest/.test(fora.reason), JSON.stringify(fora));
}

console.log("\n== engine-kit check --rede ==\n");
{
  const publicado = { engines: [alfa, beta, gerido] };
  let pedidos = 0;
  const server = createServer((req, res) => { pedidos++; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(publicado)); });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const registryUrl = `http://127.0.0.1:${server.address().port}/manifest.json`;
  const plugin = (engines) => { const f = join(RUN, `plugin-${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify({ name: "p", engines })); return f; };
  const linha = (r, n) => r.engines.find((e) => e.name === n);

  const sem = await checkCommand(plugin({ alfa: ">=2.0.0" }), { manifest: bundled });
  check("sem --rede: sem campo do registry e nenhum pedido ao servidor", !("registry" in linha(sem, "alfa")) && pedidos === 0, JSON.stringify(linha(sem, "alfa")));

  const r = await checkCommand(plugin({ alfa: ">=2.0.0", beta: ">=1.0.0" }), { manifest: bundled, rede: true, registryUrl });
  check("--rede, fora da faixa e o publicado satisfaz: registrySatisfies true com a versão publicada", linha(r, "alfa").state === "FORA-DA-FAIXA" && linha(r, "alfa").registry === "2.0.0" && linha(r, "alfa").registrySatisfies === true && /satisfaz: ensure --de instala/.test(linha(r, "alfa").detail), JSON.stringify(linha(r, "alfa")));
  check("--rede, ausente e o publicado satisfaz: o mesmo aviso no motor que falta", linha(r, "beta").state === "AUSENTE" && linha(r, "beta").registrySatisfies === true, JSON.stringify(linha(r, "beta")));

  const nao = await checkCommand(plugin({ alfa: "^3.0.0" }), { manifest: bundled, rede: true, registryUrl });
  check("--rede, o publicado também não satisfaz: registrySatisfies false e o texto manda ajustar a faixa", linha(nao, "alfa").registrySatisfies === false && /NÃO satisfaz/.test(linha(nao, "alfa").detail), JSON.stringify(linha(nao, "alfa")));

  const ok = await checkCommand(plugin({ alfa: "=1.0.0" }), { manifest: bundled, rede: true, registryUrl });
  check("--rede, motor que já satisfaz: OK sem campo do registry", linha(ok, "alfa").state === "OK" && !("registry" in linha(ok, "alfa")), JSON.stringify(linha(ok, "alfa")));
  server.close();
}

console.log("\n== engine-kit trust --restaurar ==\n");
{
  const file = join(KIT_HOME, "trust.json"), bak = `${file}.bak`;
  const bom = { alfa: { publicKey: "aa".repeat(32) }, beta: { publicKey: "bb".repeat(32) } };
  const ausente = trustRestoreCommand();
  check("sem trust.json: nada a restaurar e nada é criado", !ausente.ok && /nada a restaurar/.test(ausente.reason) && !existsSync(file), JSON.stringify(ausente));

  writeFileSync(file, JSON.stringify({ alfa: { publicKey: "aa".repeat(32) } })); writeFileSync(bak, JSON.stringify(bom));
  const legivel = trustRestoreCommand();
  check("principal legível: recusa e não toca nele", !legivel.ok && /nada a restaurar/.test(legivel.reason) && readFileSync(file, "utf8").includes("alfa") && !readFileSync(file, "utf8").includes("beta"), JSON.stringify(legivel));

  writeFileSync(file, "{ quebrado"); writeFileSync(bak, "também quebrado");
  const dois = trustRestoreCommand();
  check("principal e .bak ilegíveis: recusa e não grava", !dois.ok && /ilegível/.test(dois.reason) && readFileSync(file, "utf8") === "{ quebrado" && !existsSync(`${file}.tmp`), JSON.stringify(dois));

  writeFileSync(bak, "[1,2]");
  const lista = trustRestoreCommand();
  check(".bak que não é objeto: recusa", !lista.ok && /não é um objeto/.test(lista.reason), JSON.stringify(lista));

  writeFileSync(bak, JSON.stringify(bom));
  const feito = trustRestoreCommand();
  check("principal ilegível e .bak válido: restaura e lista os motores", feito.ok && feito.restored.join() === "alfa,beta", JSON.stringify(feito));
  check("o arquivo restaurado é a cópia, legível, sem .tmp sobrando", readFileSync(file, "utf8") === JSON.stringify(bom) && !existsSync(`${file}.tmp`));
}

console.log("\n== engine-kit rollback depois da volta automática ==\n");
{
  const historico = join(KIT_HOME, "history.jsonl");
  writeFileSync(historico, `${JSON.stringify({ ts: "2026-11-22T10:00:00.000Z", engine: "alfa", from: "2.0.0", to: "1.0.0", via: "rollback" })}\n`);
  const r = await rollbackCommand("alfa", { bundled });
  check("última troca foi a volta automática: recusa e diz qual versão não subiu", !r.ok && /volta automática de v2\.0\.0 para v1\.0\.0/.test(r.reason) && /pin alfa --version/.test(r.reason), JSON.stringify(r));
}

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
