// test-casa-e-grafo-no-registro.mjs — a casa de embeddings e o motor de grafo estão no manifest.json como pede o CONTRATO-MOTOR.md.
//
// Cada um com chave Ed25519 própria, assinatura obrigatória, o anúncio em run/daemon.json, saúde e desligamento declarados. Enquanto a
// release assinada não sai, a entrada fica `pending-release`: o schema aceita, o `ensure` recusa dizendo o motivo, o doctor não pede ação e
// nem o README nem a vitrine anunciam um motor que ninguém consegue baixar.
//
//   node tests/test-casa-e-grafo-no-registro.mjs
import "./_tmp.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSchema, manifestErrors } from "../tools/schema-check.mjs";

const REPO = join(import.meta.dirname, "..");
const read = (f) => readFileSync(join(REPO, f), "utf8");
let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const manifest = JSON.parse(read("manifest.json"));
const entry = (name) => manifest.engines.find((e) => e.name === name);
const casa = entry("casa-de-embeddings");
const grafo = entry("motor-de-grafo");

check("o manifest passa no schema com as duas entradas", manifestErrors(manifest, loadSchema()).length === 0, manifestErrors(manifest, loadSchema()).join("; "));
check("as duas entradas existem", Boolean(casa) && Boolean(grafo));

for (const e of [casa, grafo].filter(Boolean)) {
  const outros = manifest.engines.filter((x) => x !== e).map((x) => x.install.publicKey);
  check(`${e.name}: chave própria, assinatura obrigatória e sidecars`, /^[0-9a-f]{64}$/.test(e.install.publicKey ?? "") && !outros.includes(e.install.publicKey) && e.install.signatureRequired === true && e.install.checksum === "{asset}.sha256");
  check(`${e.name}: enquanto a release não sai, pending-release com o motivo da página`, e.status === "pending-release" && /\S{10}/.test(e.pagesPendente ?? ""));
  check(`${e.name}: o motor sobe sozinho, o kit entrega e desliga (kind cli com runtime completo)`, e.kind === "cli" && e.runtime?.runtimeFile === "run/daemon.json" && e.runtime.healthPath === "/health" && Boolean(e.runtime.shutdownPath) && Boolean(e.runtime.shutdownTokenField) && Boolean(e.runtime.shutdownTokenHeader));
  check(`${e.name}: artefato .tgz com o executável em bin/ e plataforma declarada`, /\.tgz$/.test(e.install.asset) && /^bin\/.+\.exe$/.test(e.install.entry) && e.install.extractTo === "bin" && e.platforms?.length > 0, `${e.install.asset} ${e.install.entry}`);
  check(`${e.name}: tag do registry público`, e.install.repo === "AllanSantos-DV/engine-registry" && e.install.tag === `${e.name}-v{version}`, e.install.tag);
}

check("a casa desliga por POST /admin/shutdown com o X-Casa-Token do anúncio", casa?.runtime.shutdownPath === "/admin/shutdown" && casa.runtime.shutdownTokenField === "shutdownToken" && casa.runtime.shutdownTokenHeader === "x-casa-token");
check("a casa não tem updater próprio: o kit a atualiza", casa && casa.runtime.updatePath === undefined);
check("o motor de grafo declara o updater próprio (POST /update do servidor)", grafo?.runtime.updatePath === "/api/v1/server/update" && grafo.runtime.shutdownPath === "/api/v1/server/shutdown");

const readme = read("README.md");
const site = read("site/index.html");
for (const e of [casa, grafo].filter(Boolean)) {
  check(`${e.name}: README e vitrine só o anunciam depois da release`, !readme.includes("`" + e.name + "`") && !site.includes(`data-motor="${e.name}"`));
}

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
