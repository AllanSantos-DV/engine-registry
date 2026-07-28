// test-signature.mjs — prova do contrato de AUTENTICIDADE do engine-kit.
//
// O cenário que importa não é "o download corrompeu" (isso o sha256 já pegava). É o ataque real:
// alguém com poder de escrita no release TROCA o artefato **e regenera o sidecar .sha256**. Para o
// kit antigo isso passava — hash bate com o artefato servido. Aqui o teste serve exatamente esse
// artefato adulterado, com o .sha256 CERTO do artefato adulterado, e exige que o provision RECUSE.
//
// Hermético: nada de rede. O `fetcher` do provision é injetado e serve tudo de memória, mas o
// artefato é um .tgz de verdade (o `tar` roda), então a extração e o swap são exercitados.
//
//   node test-signature.mjs
import { provision, lifecycle, generateKeyPairHex, signBlob, verifyBlob } from "./kit/index.mjs";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const RUN = join(tmpdir(), `engine-sig-${Date.now()}`);
mkdirSync(RUN, { recursive: true });

/**
 * Constrói um .tgz real de motor-fantasma e devolve os bytes.
 * Layout do artefato: o conteúdo vai na RAIZ do tarball (o provision renomeia o staging inteiro
 * para `<home>/<extractTo>`), igual ao mcp-gateway publicado.
 */
function buildFixtureTgz(version) {
  const src = join(RUN, `src-${version}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "test-engine", version }));
  writeFileSync(join(src, "test-engine.mjs"), 'console.log(JSON.stringify({ ok: true }));\n');
  const tgz = join(RUN, `test-engine-${version}.tgz`);
  execFileSync("tar", ["-czf", tgz, "-C", src, "."], { stdio: "ignore" });
  return readFileSync(tgz);
}

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

const ASSET_URL = "https://example.invalid/test-engine.tgz";
const SHA_URL = `${ASSET_URL}.sha256`;
const SIG_URL = `${ASSET_URL}.sig`;

/** Fetcher injetado: mapa URL → Buffer. URL fora do mapa vira 404 (como o GitHub faria). */
const fetcherFor = (map) => async (url) => {
  if (!(url in map)) { const e = new Error("HTTP 404"); e.status = 404; throw e; }
  return map[url];
};

let homeSeq = 0;
function engineFor(install, kind = "daemon") {
  const homeDir = join(RUN, `home-${++homeSeq}`);
  return {
    name: "test-engine", version: "0.0.1", kind, homeDir,
    assetName: "test-engine.tgz", assetUrl: ASSET_URL,
    checksumUrl: SHA_URL, signatureUrl: SIG_URL,
    install: { entry: "bin/test-engine.mjs", extractTo: "bin", ...install },
  };
}

console.log("== engine-kit: contrato de assinatura ==\n");

const { publicKeyHex, privateKeyHex } = generateKeyPairHex();
const good = buildFixtureTgz("0.0.1");
const goodSig = signBlob(good, privateKeyHex);

// O artefato do atacante: conteúdo diferente, MESMO nome, sha256 recalculado por ele.
const evil = buildFixtureTgz("0.0.1-evil");
check("fixture adulterado é mesmo diferente do legítimo", sha256(evil) !== sha256(good));

// ── A) assinatura válida → instala ────────────────────────────────────────────────────────────
console.log("A) release legítima (assinada com a chave do motor)");
{
  const engine = engineFor({ publicKey: publicKeyHex, signatureRequired: true });
  const r = await provision(engine, {
    fetcher: fetcherFor({ [ASSET_URL]: good, [SHA_URL]: Buffer.from(sha256(good)), [SIG_URL]: goodSig }),
  });
  check("provision instalou", r.ok, r.ok ? `v${r.version}` : r.reason);
  check("marcou como assinado", r.ok && r.signed === true);
  check("entrypoint no disco", r.ok && existsSync(r.entryPath), r.ok ? r.entryPath : "");
}

// ── B) O ATAQUE: artefato trocado com sha256 recalculado ──────────────────────────────────────
console.log("\nB) artefato TROCADO com .sha256 recalculado pelo atacante (o sha256 sozinho não pega)");
{
  const engine = engineFor({ publicKey: publicKeyHex, signatureRequired: true });
  const r = await provision(engine, {
    fetcher: fetcherFor({ [ASSET_URL]: evil, [SHA_URL]: Buffer.from(sha256(evil)), [SIG_URL]: goodSig }),
  });
  check("provision RECUSOU", !r.ok, r.ok ? "instalou o artefato adulterado!" : r.reason);
  check("razão aponta a assinatura", !r.ok && /assinatura Ed25519 NÃO confere/.test(r.reason));
  check("nada foi instalado", !existsSync(join(engine.homeDir, "bin", "test-engine.mjs")));
  check("o .tgz suspeito não ficou no disco", !existsSync(join(engine.homeDir, "test-engine.tgz")));
}

// ── C) .sig ausente com publicKey declarada → recusa ──────────────────────────────────────────
console.log("\nC) release SEM .sig, mas o registry declara publicKey");
{
  const engine = engineFor({ publicKey: publicKeyHex, signatureRequired: true });
  const r = await provision(engine, {
    fetcher: fetcherFor({ [ASSET_URL]: good, [SHA_URL]: Buffer.from(sha256(good)) }),
  });
  check("provision RECUSOU", !r.ok, r.reason);
  check("razão é fail-closed do sidecar", !r.ok && /sidecar \.sig inacessível/.test(r.reason));
}

// ── D) manifesto inconsistente: exige assinatura sem declarar a chave ─────────────────────────
console.log("\nD) manifesto pede signatureRequired mas não declara publicKey");
{
  const engine = engineFor({ signatureRequired: true });
  const r = await provision(engine, {
    fetcher: fetcherFor({ [ASSET_URL]: good, [SHA_URL]: Buffer.from(sha256(good)), [SIG_URL]: goodSig }),
  });
  check("provision RECUSOU", !r.ok, r.reason);
  check("razão acusa o manifesto", !r.ok && /manifesto inconsistente/.test(r.reason));
}

// ── E) motor ainda não migrado: sem chave e sem exigência → instala, mas SINALIZA ──────────────
console.log("\nE) motor legado (sem publicKey): continua instalável, com aviso explícito");
{
  const engine = engineFor({});
  const logs = [];
  const r = await provision(engine, {
    log: (m) => logs.push(m),
    fetcher: fetcherFor({ [ASSET_URL]: good, [SHA_URL]: Buffer.from(sha256(good)) }),
  });
  check("provision instalou (compatibilidade)", r.ok, r.ok ? "" : r.reason);
  check("marcou como NÃO assinado", r.ok && r.signed === false);
  check("degradação foi SINALIZADA no log", logs.some((m) => /AUTENTICIDADE não/.test(m)));
}

// ── F) algoritmo desconhecido → aborta (nunca aceite silencioso) ───────────────────────────────
console.log("\nF) registry declara um algoritmo de assinatura que o kit não conhece");
{
  const engine = engineFor({ publicKey: publicKeyHex, signatureRequired: true, signatureAlgorithm: "rsa-pss-sha512" });
  const r = await provision(engine, {
    fetcher: fetcherFor({ [ASSET_URL]: good, [SHA_URL]: Buffer.from(sha256(good)), [SIG_URL]: goodSig }),
  });
  check("provision RECUSOU", !r.ok, r.reason);
  check("razão nomeia o algoritmo", !r.ok && /algoritmo de assinatura desconhecido/.test(r.reason));
}

// ── G) sidecar .sig em base64 (erro clássico de publish) → recusa com razão útil ───────────────
console.log("\nG) .sig publicado em base64 em vez de cru (erro clássico de publish)");
{
  const engine = engineFor({ publicKey: publicKeyHex, signatureRequired: true });
  const r = await provision(engine, {
    fetcher: fetcherFor({ [ASSET_URL]: good, [SHA_URL]: Buffer.from(sha256(good)), [SIG_URL]: Buffer.from(goodSig.toString("base64")) }),
  });
  check("provision RECUSOU", !r.ok, r.reason);
  check("razão explica o formato", !r.ok && /sem base64/.test(r.reason));
}

// ── H) motor kind=cli: lifecycle entrega o binário sem subir daemon ────────────────────────────
console.log("\nH) motor kind=cli (dispatcher de hooks): sem daemon, sem health, sem runtime");
{
  const engine = engineFor({ publicKey: publicKeyHex, signatureRequired: true }, "cli");
  const p = await provision(engine, {
    fetcher: fetcherFor({ [ASSET_URL]: good, [SHA_URL]: Buffer.from(sha256(good)), [SIG_URL]: goodSig }),
  });
  check("provision instalou o motor cli", p.ok, p.ok ? "" : p.reason);
  // Sem healthCheck de propósito: um motor cli não tem protocolo de rede para responder.
  const l = await lifecycle(engine, p.entryPath, {});
  check("lifecycle disponível SEM healthCheck", l.available, l.available ? "" : l.reason);
  check("devolveu o binário", l.available && l.bin === p.entryPath, l.bin ?? "");
  check("não inventou runtime", l.available && l.runtime === null);
  check("daemon continua exigindo healthCheck", !(await lifecycle(engineFor({}), "/x", {})).available);
}

// ── I) o verificador é o mesmo do publisher (uma fonte, não duas implementações) ───────────────
console.log("\nI) simetria assinar/verificar");
check("assina e verifica o mesmo blob", verifyBlob(good, signBlob(good, privateKeyHex), publicKeyHex).ok);
check("chave de outro motor não valida", !verifyBlob(good, goodSig, generateKeyPairHex().publicKeyHex).ok);

// ── J) INTEROP com o vox-engine (assinado em Python) — só com --network ────────────────────────
// O vox-engine já assina em produção com `tools/sign_release.py` (cryptography, hash-then-sign).
// Se o verificador do kit em Node divergir do assinador em Python, a migração do vox quebra
// silenciosamente. Este caso baixa uma release REAL e prova que o contrato é o mesmo.
if (process.argv.includes("--network")) {
  console.log("\nJ) interop: release REAL do vox-engine (assinada em Python) verificada pelo kit");
  const VOX_PUB = "293263e73c4ba424a9ef3432d1ce55740fc0a68478f20235ca109c074ec83f52";
  const BASE = "https://github.com/AllanSantos-DV/copilot-marketplace/releases/download/vox-engine-v0.22.8";
  try {
    const grab = async (u) => Buffer.from(await (await fetch(u, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
    const [zip, sig] = await Promise.all([grab(`${BASE}/vox-engine-installer.zip`), grab(`${BASE}/vox-engine-installer.zip.sig`)]);
    check("sidecar .sig é cru de 64 bytes", sig.length === 64, `${sig.length} bytes`);
    check("kit (Node) valida assinatura feita em Python", verifyBlob(zip, sig, VOX_PUB).ok);
    check("kit recusa o mesmo instalador adulterado", !verifyBlob(Buffer.concat([zip, Buffer.from([0])]), sig, VOX_PUB).ok);
  } catch (e) {
    check("interop com o vox-engine", false, `rede falhou: ${e.message}`);
  }
} else {
  console.log("\nJ) interop com o vox-engine — pulado (rode com --network)");
}

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
