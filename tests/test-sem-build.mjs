// test-sem-build.mjs — motor sem build para esta plataforma é recusado cedo, antes de rede e de disco: na lib (`ensureEngine`) e no doctor.
//
// Hermético: HOME isolado, registry local, nada é baixado. O motor-alvo declara só uma plataforma que esta máquina não é.
//
//   node tests/test-sem-build.mjs
import "./_tmp.mjs";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HOME = mkdtempSync(join(tmpdir(), "sem-build-"));
process.env.HOME = process.env.USERPROFILE = HOME;
process.env.ENGINE_KIT_HOME = join(HOME, ".engine-kit");
const { ensureEngine } = await import("../kit/index.mjs");
const { diagnoseEngines } = await import("../kit/diagnose.mjs");
const { target } = await import("../kit/resolve.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const base = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const comPlataformas = (platforms) => ({ ...base, engines: base.engines.map((e) => (e.name === "vxk" ? { ...e, platforms } : e)) });
const fora = comPlataformas(["plan9-mips"]);

const server = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(fora)));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const registryUrl = `http://127.0.0.1:${server.address().port}/manifest.json`;

let baixou = 0;
const r = await ensureEngine("vxk", { registryUrl, healthCheck: async () => null, fetcher: async () => { baixou++; throw new Error("não devia baixar"); } });
check("ensureEngine devolve available:false dizendo que não há build para a plataforma", r.available === false && /não tem build para .*plan9-mips/.test(r.reason), r.reason);
check("a recusa vem antes de qualquer download", baixou === 0, `downloads=${baixou}`);
check("a recusa vem antes de qualquer escrita no HOME do motor", !existsSync(join(HOME, ".vxk")));

const d = await diagnoseEngines({ manifest: fora, local: true, only: "vxk" });
const linha = d.rows?.[0];
check("o doctor mostra SEM-BUILD com a plataforma que o motor atende", linha?.state === "SEM-BUILD" && /plan9-mips/.test(linha.detail), `${linha?.state} ${linha?.detail}`);
check("SEM-BUILD não é pendência (o --fix não tenta instalar, o exit fica 0)", linha?.needsWork === false);

const certo = await diagnoseEngines({ manifest: comPlataformas([target()]), local: true, only: "vxk" });
check("motor que atende a plataforma segue o fluxo normal (não é SEM-BUILD)", certo.rows?.[0]?.state !== "SEM-BUILD", certo.rows?.[0]?.state);

server.close();
console.log(failures ? `\nFALHAS: ${failures}` : "\nTUDO VERDE");
process.exit(failures ? 1 : 0);
