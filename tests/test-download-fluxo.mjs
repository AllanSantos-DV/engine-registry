// test-download-fluxo.mjs — o download do artefato vai para o disco em FLUXO, com prazo por INATIVIDADE.
//
// O que precisa ser verdade:
//   • o artefato nunca existe inteiro em memória: o fetcher recebe `{ stream:true }` para ele, o sha256 é calculado
//     durante o fluxo e a assinatura é conferida sobre esse digest (RSS medido num artefato de 96 MiB);
//   • um download lento que continua recebendo bytes NÃO expira, por maior que seja o total;
//   • sem nenhum byte por `idleTimeoutMs` (antes ou no meio do fluxo) aborta com erro de inatividade e apaga o `.part`;
//   • sha256 ou assinatura errados apagam o `.part` e não deixam nada;
//   • `downloadTimeoutMs` (o nome antigo) continua valendo como o prazo de inatividade;
//   • o caminho real (`fetch` do Node contra um servidor em 127.0.0.1) tem o mesmo comportamento;
//   • o `provision.lock` acompanha um download mais longo que `lockStaleMs` (outro consumidor não o toma) e o lock
//     sem renovação (dono morto) ainda é reclamado;
//   • a extração do tar é assíncrona: uma extração mais longa que `lockStaleMs` não deixa outro consumidor tomar o lock, e
//     a extração que falha dá o erro com o stderr do tar, sem instalar nada;
//   • `versaoDivergente` (`fetch`/`verify-release`) confere um .tgz grande com hash em fluxo, sem `readFileSync` no artefato.
// Hermético: fetchers falsos e um servidor em loopback; raiz de confiança em pasta temporária.
//
//   node tests/test-download-fluxo.mjs
import "./_tmp.mjs";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash, randomBytes, sign as edSign } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as pausa } from "node:timers/promises";
import fs, { utimesSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { generateKeyPairHex, signBlob, privateKeyFromHex } from "../kit/index.mjs";
import { fetchArtifact, provision, extractTgz, tarBinary } from "../kit/provision.mjs";
import { versaoDivergente } from "../kit/fetch.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const RUN = join(tmpdir(), `engine-fluxo-${Date.now()}`);
mkdirSync(RUN, { recursive: true });
process.env.ENGINE_KIT_HOME = join(RUN, "trust-home");
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, LOCALAPPDATA: join(RUN, "local-app-data") });

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const owner = generateKeyPairHex();
const other = generateKeyPairHex();
const signDigest = (digestHex, privateKeyHex) => edSign(null, Buffer.from(digestHex, "hex"), privateKeyFromHex(privateKeyHex));
const listed = (d) => (existsSync(d) ? readdirSync(d) : []);

const ASSET = "https://example.invalid/fluxo.tgz";
let seq = 0;
const engineOf = (over = {}) => ({
  name: "fluxo-engine", version: "1.0.0", kind: "cli", homeDir: join(RUN, `home-${++seq}`),
  assetName: "fluxo.tgz", assetUrl: ASSET, checksumUrl: `${ASSET}.sha256`, signatureUrl: `${ASSET}.sig`,
  install: { entry: "bin/fluxo.mjs", extractTo: "bin", publicKey: owner.publicKeyHex, signatureRequired: true },
  ...over,
});
const dest = () => join(RUN, `dest-${++seq}`);
const keys = { "fluxo-engine": owner.publicKeyHex };

/** Pedaços de `body` de `size` bytes, com `ms` de pausa antes de cada um. */
async function* pedacos(body, size, ms = 0) {
  for (let i = 0; i < body.length; i += size) { if (ms) { await pausa(ms); } yield body.subarray(i, i + size); }
}

/** Fetcher falso: sidecars como Buffer, o artefato pelo `stream(opts)` dado; guarda cada chamada em `calls`. */
const fetcherOf = ({ sha, sig, stream, calls = [] }) => async (url, ms, opts = {}) => {
  calls.push({ url, ms, opts });
  if (url === `${ASSET}.sha256`) { return Buffer.from(`${sha}  fluxo.tgz\n`); }
  if (url === `${ASSET}.sig`) { return sig; }
  if (url === ASSET) { return stream(opts); }
  const e = new Error("HTTP 404"); e.status = 404; throw e;
};

console.log("== download em fluxo ==\n");

{
  console.log("-- artefato de vários chunks: gravado em disco e conferido --");
  const body = randomBytes(5 * 1024 * 1024 + 123), d = dest(), calls = [];
  const r = await fetchArtifact(engineOf(), {
    destDir: d, trustedKeys: keys,
    fetcher: fetcherOf({ sha: sha256(body), sig: signBlob(body, owner.privateKeyHex), stream: () => pedacos(body, 64 * 1024), calls }),
  });
  check("conferiu", r.ok, r.ok ? "" : r.reason);
  check("assinado", r.ok && r.signed === true);
  check("o arquivo em disco é byte a byte o artefato", r.ok && readFileSync(r.path).equals(body));
  check("a pasta só tem o artefato (sem .part)", JSON.stringify(listed(d)) === JSON.stringify(["fluxo.tgz"]), listed(d).join(", "));
  const art = calls.find((c) => c.url === ASSET), pequenas = calls.filter((c) => c.url !== ASSET);
  check("o artefato é pedido em fluxo, com sinal de aborto", art?.opts.stream === true && art.opts.signal instanceof AbortSignal);
  check("os sidecars continuam pequenos e com prazo total", pequenas.length === 2 && pequenas.every((c) => !c.opts.stream && c.ms === 15000));
}

{
  console.log("\n-- memória: 96 MiB passam pelo fluxo sem o buffer inteiro --");
  const MiB = 1024 * 1024, TOTAL = 96, chunk = randomBytes(MiB);
  const h = createHash("sha256");
  for (let i = 0; i < TOTAL; i++) { h.update(chunk); }
  const digest = h.digest("hex");
  let pico = 0, entregues = 0;
  const base = process.memoryUsage().rss;
  async function* gerador() {
    for (let i = 0; i < TOTAL; i++) { entregues++; pico = Math.max(pico, process.memoryUsage().rss); yield chunk; }
  }
  const d = dest();
  const r = await fetchArtifact(engineOf(), {
    destDir: d, trustedKeys: keys,
    fetcher: fetcherOf({ sha: digest, sig: signDigest(digest, owner.privateKeyHex), stream: () => gerador() }),
  });
  const cresceu = (pico - base) / MiB;
  check("conferiu o digest calculado no fluxo", r.ok, r.ok ? "" : r.reason);
  check("o arquivo tem o tamanho total", r.ok && statSync(r.path).size === TOTAL * MiB);
  check(`o pico de RSS ficou muito abaixo do total (+${cresceu.toFixed(1)} MiB de ${TOTAL})`, cresceu < TOTAL / 2);
  check("todos os chunks passaram pelo fluxo", entregues === TOTAL);
}

{
  console.log("\n-- download lento mas contínuo não expira --");
  const body = randomBytes(8 * 1024), d = dest(), t0 = Date.now();
  const r = await fetchArtifact(engineOf(), {
    destDir: d, trustedKeys: keys, idleTimeoutMs: 400,
    fetcher: fetcherOf({ sha: sha256(body), sig: signBlob(body, owner.privateKeyHex), stream: () => pedacos(body, 1024, 120) }),
  });
  const total = Date.now() - t0;
  check(`passou com o total (${total} ms) maior que o prazo de inatividade (400 ms)`, r.ok && total > 400, r.ok ? "" : r.reason);
  check("o arquivo confere", r.ok && readFileSync(r.path).equals(body));
}

for (const [rotulo, stream] of [
  ["no meio do fluxo", (body) => (async function* () { yield body.subarray(0, 1024); await new Promise(() => {}); })()],
  ["antes do primeiro byte", () => new Promise(() => {})],
]) {
  console.log(`\n-- fluxo que para de enviar bytes ${rotulo} --`);
  const body = randomBytes(4096), d = dest(), sinais = [];
  const t0 = Date.now();
  const r = await fetchArtifact(engineOf(), {
    destDir: d, trustedKeys: keys, idleTimeoutMs: 150,
    fetcher: fetcherOf({ sha: sha256(body), sig: signBlob(body, owner.privateKeyHex), stream: (opts) => { sinais.push(opts.signal); return stream(body); } }),
  });
  check("abortou", !r.ok, r.ok ? "terminou?!" : r.reason);
  check("razão diz inatividade e o prazo", !r.ok && /inatividade/.test(r.reason) && /150 ms/.test(r.reason), r.reason);
  check("abortou perto do prazo, não pendurado", Date.now() - t0 < 5000);
  check("o sinal de aborto foi acionado", sinais[0]?.aborted === true);
  check("o .part foi apagado e nada ficou", listed(d).length === 0, listed(d).join(", "));
}

{
  console.log("\n-- o nome antigo downloadTimeoutMs vale como prazo de inatividade --");
  const d = dest();
  const r = await fetchArtifact(engineOf(), {
    destDir: d, trustedKeys: keys, downloadTimeoutMs: 120,
    fetcher: fetcherOf({ sha: sha256("x"), sig: Buffer.alloc(64), stream: () => new Promise(() => {}) }),
  });
  check("abortou por inatividade", !r.ok && /inatividade/.test(r.reason), r.ok ? "" : r.reason);
}

{
  console.log("\n-- sha256 errado: apaga o .part e não instala --");
  const body = randomBytes(300 * 1024), d = dest();
  const r = await fetchArtifact(engineOf(), {
    destDir: d, trustedKeys: keys,
    fetcher: fetcherOf({ sha: sha256("outro"), sig: signBlob(body, owner.privateKeyHex), stream: () => pedacos(body, 32 * 1024) }),
  });
  check("recusou", !r.ok, r.ok ? "aceitou!" : r.reason);
  check("razão é o mismatch de sha256", !r.ok && /SHA256 mismatch/.test(r.reason));
  check("nada ficou na pasta", listed(d).length === 0, listed(d).join(", "));
}

{
  console.log("\n-- assinatura errada (sha256 certo): apaga o .part e não instala --");
  const body = randomBytes(300 * 1024), d = dest();
  const r = await fetchArtifact(engineOf(), {
    destDir: d, trustedKeys: keys,
    fetcher: fetcherOf({ sha: sha256(body), sig: signBlob(body, other.privateKeyHex), stream: () => pedacos(body, 32 * 1024) }),
  });
  check("recusou", !r.ok, r.ok ? "aceitou!" : r.reason);
  check("razão é a assinatura", !r.ok && /assinatura Ed25519 NÃO confere/.test(r.reason));
  check("nada ficou na pasta", listed(d).length === 0, listed(d).join(", "));
}

{
  console.log("\n-- HTTP 404 no artefato: erro explícito, nada fica --");
  const d = dest();
  const r = await fetchArtifact(engineOf(), {
    destDir: d, trustedKeys: keys,
    fetcher: fetcherOf({ sha: sha256("x"), sig: Buffer.alloc(64), stream: () => { const e = new Error("HTTP 404"); e.status = 404; throw e; } }),
  });
  check("recusou com o status", !r.ok && /download falhou \(404\)/.test(r.reason), r.ok ? "" : r.reason);
  check("nada ficou na pasta", listed(d).length === 0);
}

{
  console.log("\n-- fetcher antigo (devolve o Buffer inteiro) segue aceito --");
  const body = randomBytes(2048), d = dest();
  const r = await fetchArtifact(engineOf(), {
    destDir: d, trustedKeys: keys,
    fetcher: fetcherOf({ sha: sha256(body), sig: signBlob(body, owner.privateKeyHex), stream: () => body }),
  });
  check("conferiu e gravou", r.ok && readFileSync(r.path).equals(body), r.ok ? "" : r.reason);
}

{
  console.log("\n-- provision instala pelo fluxo e não deixa artefato nem .part --");
  const src = join(RUN, "src-1.0.0");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "fluxo-engine", version: "1.0.0" }));
  writeFileSync(join(src, "fluxo.mjs"), "export {};\n");
  execFileSync(tarBinary(), ["-czf", `${src}.tgz`, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  const body = readFileSync(`${src}.tgz`), engine = engineOf();
  const r = await provision(engine, {
    trustedKeys: keys,
    fetcher: fetcherOf({ sha: sha256(body), sig: signBlob(body, owner.privateKeyHex), stream: () => pedacos(body, 256) }),
  });
  check("instalou", r.ok && r.installed === true, r.ok ? "" : r.reason);
  check("o entrypoint está instalado", r.ok && existsSync(r.entryPath));
  check("o home não guarda artefato nem .part", !listed(engine.homeDir).some((n) => /\.(tgz|part)$/.test(n)), listed(engine.homeDir).join(", "));
}

{
  console.log("\n-- caminho real: fetch do Node contra um servidor em 127.0.0.1 --");
  const body = randomBytes(600 * 1024);
  let modo = "ok";
  const server = createServer(async (req, res) => {
    const u = req.url;
    if (u === "/fluxo.tgz.sha256") { res.end(`${sha256(body)}\n`); return; }
    if (u === "/fluxo.tgz.sig") { res.end(signBlob(body, owner.privateKeyHex)); return; }
    if (u !== "/fluxo.tgz") { res.statusCode = 404; res.end(); return; }
    res.writeHead(200, { "content-length": body.length });
    res.write(body.subarray(0, 100 * 1024));
    if (modo === "trava") { return; }
    for (let i = 100 * 1024; i < body.length; i += 100 * 1024) { await pausa(60); res.write(body.subarray(i, i + 100 * 1024)); }
    res.end();
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}/fluxo.tgz`;
  const engine = () => engineOf({ assetUrl: base, checksumUrl: `${base}.sha256`, signatureUrl: `${base}.sig` });

  const d1 = dest(), t0 = Date.now();
  const ok = await fetchArtifact(engine(), { destDir: d1, trustedKeys: keys, idleTimeoutMs: 1500 });
  check("download real, lento e contínuo, confere", ok.ok && readFileSync(ok.path).equals(body) && Date.now() - t0 > 250, ok.ok ? "" : ok.reason);

  modo = "trava";
  const d2 = dest(), t1 = Date.now();
  const trava = await fetchArtifact(engine(), { destDir: d2, trustedKeys: keys, idleTimeoutMs: 1500 });
  check("servidor que trava no meio: aborta por inatividade", !trava.ok && /inatividade/.test(trava.reason), trava.ok ? "" : trava.reason);
  check("abortou perto do prazo", Date.now() - t1 < 5000);
  check("o .part foi apagado", listed(d2).length === 0, listed(d2).join(", "));

  server.closeAllConnections();
  await new Promise((ok2) => server.close(ok2));
}

/** Empacota um motor fixture em `RUN` e devolve o caminho do .tgz; `extra` acrescenta bytes incompressíveis para o artefato ser grande. */
const tgzDe = (nome, extra = 0) => {
  const src = join(RUN, `src-${nome}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "fluxo-engine", version: "1.0.0" }));
  writeFileSync(join(src, "fluxo.mjs"), "export {};\n");
  if (extra) { writeFileSync(join(src, "grande.bin"), randomBytes(extra)); }
  execFileSync(tarBinary(), ["-czf", `${src}.tgz`, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  return `${src}.tgz`;
};

{
  console.log("\n-- lock: a vida do lock acompanha o download mais longo que lockStaleMs --");
  const body = readFileSync(tgzDe("lock")), engine = engineOf(), STALE = 6000;
  const lockFile = join(engine.homeDir, "provision.lock"), baixados = { primeiro: 0, segundo: 0 };
  const lento = (quem) => fetcherOf({ sha: sha256(body), sig: signBlob(body, owner.privateKeyHex), stream: () => { baixados[quem]++; return pedacos(body, Math.ceil(body.length / 20), 800); } });
  const primeiro = provision(engine, { trustedKeys: keys, lockStaleMs: STALE, fetcher: lento("primeiro") });
  await pausa(7000);
  const idade = Date.now() - statSync(lockFile).mtimeMs;
  check(`o lock segue fresco (${Math.round(idade)} ms) com o download em curso há mais de ${STALE} ms`, idade < STALE);
  const segundo = await provision(engine, { trustedKeys: keys, lockStaleMs: STALE, lockWaitMs: 300, fetcher: lento("segundo") });
  check("o segundo consumidor não toma o lock nem baixa", !segundo.ok && /provision-locked-timeout/.test(segundo.reason) && baixados.segundo === 0, segundo.ok ? "instalou?!" : segundo.reason);
  const r1 = await primeiro;
  check("o primeiro termina e instala", r1.ok && r1.installed === true, r1.ok ? "" : r1.reason);
  check("o lock é liberado", !existsSync(lockFile));
}

{
  console.log("\n-- lock sem renovação (dono morto) ainda é reclamado --");
  const body = readFileSync(tgzDe("lock-morto")), engine = engineOf();
  mkdirSync(engine.homeDir, { recursive: true });
  const lockFile = join(engine.homeDir, "provision.lock"), velho = new Date(Date.now() - 5000);
  writeFileSync(lockFile, "999999");
  utimesSync(lockFile, velho, velho);
  const r = await provision(engine, {
    trustedKeys: keys, lockStaleMs: 600,
    fetcher: fetcherOf({ sha: sha256(body), sig: signBlob(body, owner.privateKeyHex), stream: () => pedacos(body, 256) }),
  });
  check("reclamou o lock morto e instalou", r.ok && r.installed === true, r.ok ? "" : r.reason);
  check("o lock é liberado", !existsSync(lockFile));
}

/** Tar falso: `[node, stub, modo, ms, tarReal]`. `lento` espera `ms` e extrai de verdade; `falha` escreve no stderr e sai com 3. */
const STUB = join(RUN, "tar-falso.mjs");
writeFileSync(STUB, `import { spawnSync } from "node:child_process";
const [modo, ms, real, ...args] = process.argv.slice(2);
if (args[0] === "--version") { process.exit(0); }
if (modo === "falha") { console.error("disco cheio simulado"); process.exit(3); }
await new Promise((ok) => setTimeout(ok, Number(ms)));
process.exit(spawnSync(real, args, { stdio: "ignore", windowsHide: true }).status ?? 1);
`);
const tarFalso = (modo, ms = 0) => [process.execPath, STUB, modo, String(ms), tarBinary()];

{
  console.log("\n-- extração lenta e longa (assíncrona): o lock não é tomado --");
  const body = readFileSync(tgzDe("extracao-lenta")), engine = engineOf(), STALE = 6000;
  const lockFile = join(engine.homeDir, "provision.lock");
  const rapido = fetcherOf({ sha: sha256(body), sig: signBlob(body, owner.privateKeyHex), stream: () => pedacos(body, 4096) });
  const primeiro = provision(engine, { trustedKeys: keys, lockStaleMs: STALE, fetcher: rapido, tar: tarFalso("lento", 12000) });
  await pausa(7000);
  const idade = existsSync(lockFile) ? Date.now() - statSync(lockFile).mtimeMs : Infinity;
  check(`o lock segue fresco (${Math.round(idade)} ms) com a extração em curso há mais de ${STALE} ms`, idade < STALE);
  const segundo = await provision(engine, { trustedKeys: keys, lockStaleMs: STALE, lockWaitMs: 300, fetcher: rapido, tar: tarFalso("falha") });
  check("o segundo consumidor não toma o lock nem extrai", !segundo.ok && /provision-locked-timeout/.test(segundo.reason), segundo.ok ? "instalou?!" : segundo.reason);
  const r1 = await primeiro;
  check("o primeiro termina a extração e instala", r1.ok && r1.installed === true && existsSync(r1.entryPath), r1.ok ? "" : r1.reason);
  check("o lock é liberado", !existsSync(lockFile));
}

{
  console.log("\n-- extração que falha: o mesmo erro, com o stderr do tar, e nada instalado --");
  const body = readFileSync(tgzDe("extracao-falha")), engine = engineOf();
  const r = await provision(engine, {
    trustedKeys: keys, tar: tarFalso("falha"),
    fetcher: fetcherOf({ sha: sha256(body), sig: signBlob(body, owner.privateKeyHex), stream: () => pedacos(body, 4096) }),
  });
  check("recusou com a razão da extração", !r.ok && /extração \(tar\) falhou/.test(r.reason), r.ok ? "instalou?!" : r.reason);
  check("a razão traz o stderr do tar", !r.ok && /disco cheio simulado/.test(r.reason), r.ok ? "" : r.reason);
  check("nada foi instalado e o lock foi liberado", !existsSync(join(engine.homeDir, "bin")) && !existsSync(join(engine.homeDir, "provision.lock")));
  const direto = await extractTgz(tgzDe("extracao-falha"), join(RUN, "dest-direto"), tarFalso("falha"));
  check("extractTgz devolve uma promessa com { ok:false, reason }", direto.ok === false && /disco cheio simulado/.test(direto.reason));
}

{
  console.log("\n-- versaoDivergente: .tgz grande conferido sem readFileSync no artefato --");
  const arq = tgzDe("grande", 32 * 1024 * 1024), motor = { name: "fluxo-engine", version: "1.0.0" };
  const lidos = [], original = fs.readFileSync;
  fs.readFileSync = function (p, ...resto) { if (String(p) === arq) { lidos.push(p); } return original.call(this, p, ...resto); };
  syncBuiltinESMExports();
  let certo, de_novo, errado;
  try {
    certo = await versaoDivergente(arq, motor);
    de_novo = await versaoDivergente(arq, motor);
    errado = await versaoDivergente(arq, { ...motor, version: "9.9.9" });
  } finally { fs.readFileSync = original; syncBuiltinESMExports(); }
  check("o artefato de 32 MiB confere (versão do package.json)", certo === null, String(certo));
  check("de novo, com o marcador, também confere", de_novo === null, String(de_novo));
  check("versão divergente é recusada com a razão", /o artefato diz v1\.0\.0 e o registry pede v9\.9\.9/.test(errado ?? ""), String(errado));
  check("readFileSync nunca foi chamado no artefato", lidos.length === 0, `${lidos.length} chamada(s)`);
}

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
