// test-fetch-espelho.mjs — `engine-kit fetch --instalados` e `fetch --de-export <documento>`: o espelho em lote, sem instalar nada.
//
// O que precisa ser verdade:
//   • --instalados baixa e confere o artefato de cada motor instalado, o mesmo conjunto do `ensure --instalados` (sem self-managed, sem motor de outra plataforma, sem ausente), para --dest;
//   • --de-export baixa e confere a versão REGISTRADA no documento do `export` de cada motor, não a do registry, e o documento é o do `validarDocumento`;
//   • com --com-assinaturas a pasta ganha também o .sha256 e o .sig de cada artefato;
//   • nada é instalado: as versões instaladas, o home dos motores e o histórico ficam como estavam;
//   • sai o envelope de vários motores ({ ok, engines }, texto e --json): uma falha não esconde os outros e o exit é 1 se algum falhou; sem motor não é erro;
//   • --dest dentro do home de um motor segue recusado; app no documento é recusado como motor;
//   • o uso e o README dizem que o `--instalados` baixa a versão do registry (ou o pin), não a que o `ensure` instalaria;
//   • --instalados e --de-export juntos, com nomes de motor e com --version são recusados (e --instalados não com --de-export), e `fetch <motor>` com nomes explícitos segue como antes.
// Hermético: registry e downloads de memória (o .tgz é real e assinado), HOME e ENGINE_KIT_HOME isolados, o CLI roda numa cópia do kit sem rede, nenhum daemon.
//
//   node tests/test-fetch-espelho.mjs
import "./_tmp.mjs";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ft-espelho-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { criarCliOffline } = await import("./_kit-copiado.mjs");
const { registry, preinstalar, instalado, homeOf } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
let seq = 0;
const pasta = () => join(RUN, `dest-${++seq}`);
const lista = (d) => (existsSync(d) ? readdirSync(d).sort() : []);
const ler = (p) => { try { return readFileSync(p); } catch { return Buffer.alloc(0); } };
const json = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };
const historico = () => { try { return readFileSync(join(KIT_HOME, "history.jsonl"), "utf8"); } catch { return ""; } };
const documento = (engines, extra = {}) => { const f = join(RUN, `doc-${++seq}.json`); writeFileSync(f, JSON.stringify({ formato: 1, kit: "0.2.19", engines, ...extra })); return f; };
const url = (nome, v) => `https://github.com/x/y/releases/download/${nome}-v${v}/${nome}.tgz`;

const NOMES = ["esp-a", "esp-b", "esp-ausente", "esp-falha", "esp-proprio", "esp-fora"];
const reg = registry(Object.fromEntries(NOMES.map((n) => [n, "2.0.0"])), { extra: { "esp-proprio": { status: "self-managed" }, "esp-fora": { platforms: ["plan9-x64"] } } });
const antigo = registry({ "esp-a": "1.0.0" });
delete reg.artefatos["esp-falha"];
for (const n of ["esp-a", "esp-b", "esp-falha", "esp-proprio", "esp-fora"]) { preinstalar(n, "1.0.0"); }
const extras = { [url("esp-a", "1.0.0")]: antigo.artefatos["esp-a"].tgz, [`${url("esp-a", "1.0.0")}.sha256`]: antigo.artefatos["esp-a"].sha256, [`${url("esp-a", "1.0.0")}.sig`]: antigo.artefatos["esp-a"].sig };
const { cli } = await criarCliOffline(RUN, { manifest: reg.manifest, artefatos: reg.artefatos, kitHome: KIT_HOME, extras });
const antesHistorico = historico();

console.log("== fetch --instalados ==");
{
  const d = pasta();
  const t = cli("fetch", "--instalados", "--dest", d);
  check("o artefato de cada motor instalado que o ensure atualiza vai para a pasta; o falho não deixa arquivo", t.status === 1 && JSON.stringify(lista(d)) === JSON.stringify(["esp-a.tgz", "esp-b.tgz"]), t.stdout + t.stderr + lista(d).join());
  check("o texto traz OK de cada um, conferido e não instalado, e a falha com o motor", /^OK esp-a v2\.0\.0 .*não instalado/m.test(t.stdout) && /^OK esp-b v2\.0\.0 /m.test(t.stdout) && /FALHOU esp-falha/.test(t.stderr), t.stdout + t.stderr);
  check("o artefato gravado é o da release, byte a byte", ler(join(d, "esp-a.tgz")).equals(reg.artefatos["esp-a"].tgz));
  check("nada foi instalado: versões, histórico e a pasta dos motores como estavam", ["esp-a", "esp-b", "esp-falha"].every((n) => instalado(n) === "1.0.0") && historico() === antesHistorico && !existsSync(join(homeOf("esp-a"), "esp-a.tgz")));

  const j = json(cli("fetch", "--instalados", "--json", "--dest", pasta()));
  check("--json: { ok, engines } na ordem do ensure; o que falhou vira ERRO e não esconde os outros", j?.ok === false && j.engines?.map((e) => `${e.name}:${e.state}`).join() === "esp-a:BAIXADO,esp-b:BAIXADO,esp-falha:ERRO" && j.engines[0].version === "2.0.0", JSON.stringify(j));

  const nomes = (j2) => j2?.engines?.map((e) => e.name).join();
  const dry = json(cli("ensure", "--instalados", "--dry-run", "--json"));
  check("o conjunto é o do ensure --instalados: sem self-managed, outra plataforma nem ausente", nomes(dry) === "esp-a,esp-b,esp-falha" && nomes(j) === nomes(dry), `${nomes(dry)} | ${nomes(j)}`);
}

console.log("\n== --com-assinaturas, --dest no home e nenhum motor ==");
{
  const d = pasta();
  const r = cli("fetch", "--instalados", "--com-assinaturas", "--dest", d);
  check("a pasta tem artefato, .sha256 e .sig de cada motor que passou", JSON.stringify(lista(d)) === JSON.stringify(["esp-a.tgz", "esp-a.tgz.sha256", "esp-a.tgz.sig", "esp-b.tgz", "esp-b.tgz.sha256", "esp-b.tgz.sig"]), r.stdout + r.stderr + lista(d).join());
  const dentro = join(homeOf("esp-a"), "sub");
  const h = cli("fetch", "--instalados", "--dest", dentro);
  check("--dest dentro do home de um motor segue recusado para esse motor, sem gravar o artefato dele ali", h.status === 1 && /dentro do home de esp-a/.test(h.stderr) && !existsSync(join(dentro, "esp-a.tgz")), h.stdout + h.stderr);
}
{
  const vazio = registry({ "vazio-a": "2.0.0" });
  const RUN2 = join(RUN, "outro-home");
  mkdirSync(RUN2, { recursive: true });
  const { cli: semInstalado } = await criarCliOffline(RUN2, { manifest: vazio.manifest, artefatos: vazio.artefatos, kitHome: join(RUN2, "kit-home") });
  const d = pasta();
  const t = semInstalado("fetch", "--instalados", "--dest", d);
  check("nenhum motor instalado: exit 0 e uma frase que diz isso, sem pasta nem arquivo", t.status === 0 && /nenhum motor instalado/.test(t.stdout) && lista(d).length === 0, t.stdout + t.stderr);
  const j = json(semInstalado("fetch", "--instalados", "--json", "--dest", d));
  check("nenhum motor em --json: { ok:true, engines: [] }", j?.ok === true && Array.isArray(j.engines) && j.engines.length === 0, JSON.stringify(j));
}

console.log("\n== fetch --de-export ==");
{
  const d = pasta(), doc = documento([{ name: "esp-a", version: "1.0.0" }, { name: "esp-b", version: "2.0.0" }]);
  const t = cli("fetch", "--de-export", doc, "--dest", d);
  check("baixa a versão do documento de cada motor (a do registry é outra) e o artefato é o dessa versão", t.status === 0 && JSON.stringify(lista(d)) === JSON.stringify(["esp-a.tgz", "esp-b.tgz"]) && ler(join(d, "esp-a.tgz")).equals(antigo.artefatos["esp-a"].tgz), t.stdout + t.stderr + lista(d).join());
  check("o texto diz a versão do documento", /^OK esp-a v1\.0\.0 /m.test(t.stdout) && /^OK esp-b v2\.0\.0 /m.test(t.stdout), t.stdout);
  const j = json(cli("fetch", "--de-export", doc, "--json", "--dest", pasta()));
  check("--json: { ok:true, engines } com a versão e os arquivos de cada um", j?.ok === true && j.engines?.length === 2 && j.engines[0].version === "1.0.0" && j.engines.every((e) => e.state === "BAIXADO" && e.files.length === 1), JSON.stringify(j));
  const s = cli("fetch", "--de-export", doc, "--com-assinaturas", "--dest", pasta());
  check("com --com-assinaturas grava os sidecars de cada motor", s.status === 0 && /sha256 conferido contra o artefato/.test(s.stdout) && /sig conferido contra o artefato/.test(s.stdout), s.stdout + s.stderr);
  check("nada foi instalado: versões e histórico como estavam", instalado("esp-a") === "1.0.0" && instalado("esp-b") === "1.0.0" && historico() === antesHistorico);

  const mista = documento([{ name: "esp-b", version: "2.0.0" }, { name: "esp-a", version: "9.9.9" }]);
  const dm = pasta();
  const m = cli("fetch", "--de-export", mista, "--dest", dm);
  check("uma versão inexistente falha com o motor e não esconde a que passou: exit 1", m.status === 1 && /FALHOU esp-a/.test(m.stderr) && JSON.stringify(lista(dm)) === JSON.stringify(["esp-b.tgz"]), m.stdout + m.stderr + lista(dm).join());
  const mj = json(cli("fetch", "--de-export", mista, "--json", "--dest", pasta()));
  check("a mesma chamada em --json: ok false, ERRO no que falhou, BAIXADO no outro", mj?.ok === false && mj.engines?.[0]?.state === "BAIXADO" && mj.engines[1].state === "ERRO", JSON.stringify(mj));

  const vazio = cli("fetch", "--de-export", documento([]), "--dest", pasta());
  check("documento sem motor: exit 0 e uma frase que diz isso", vazio.status === 0 && /nenhum motor no documento/.test(vazio.stdout), vazio.stdout + vazio.stderr);
  const app = cli("fetch", "--de-export", documento([{ name: "esp-b", version: "2.0.0" }, { name: "agent-launcher", version: "1.0.0" }]), "--dest", pasta());
  check("nome que não é motor do kit no documento: recusado como motor, sem baixar", app.status === 1 && /FALHOU agent-launcher: .*não é motor/.test(app.stderr), app.stdout + app.stderr);
  const dh = cli("fetch", "--de-export", documento([{ name: "esp-b", version: "2.0.0" }]), "--dest", join(homeOf("esp-b"), "sub"));
  check("--dest dentro do home do motor segue recusado, sem gravar nada ali", dh.status === 1 && /dentro do home de esp-b/.test(dh.stderr) && !existsSync(join(homeOf("esp-b"), "sub")), dh.stdout + dh.stderr);

  const ruins = [
    ["chave desconhecida", documento([], { extra: 1 }), /chave desconhecida "extra"/],
    ["formato de outro kit", documento([], { formato: 2 }), /formato 2/],
    ["versão que não é x.y.z", documento([{ name: "esp-a", version: "latest" }]), /precisa ser x\.y\.z/],
    ["motor repetido", documento([{ name: "esp-a", version: "1.0.0" }, { name: "esp-a", version: "1.0.0" }]), /repetido/],
  ];
  for (const [nome, f, razao] of ruins) {
    const d2 = pasta(), r = cli("fetch", "--de-export", f, "--dest", d2);
    check(`documento inválido (${nome}): recusado inteiro, nada baixado`, r.status === 1 && razao.test(r.stderr) && /^FALHOU fetch --de-export: documento inválido: /m.test(r.stderr) && lista(d2).length === 0, r.stdout + r.stderr);
  }
  const ausente = cli("fetch", "--de-export", join(RUN, "nao-existe.json"), "--dest", pasta());
  check("documento ausente: exit 1 com o motivo", ausente.status === 1 && /não consegui ler/.test(ausente.stderr), ausente.stderr);
  const invalidoJson = json(cli("fetch", "--de-export", documento([], { extra: 1 }), "--json"));
  check("documento inválido em --json: ok false e o motivo em detail", invalidoJson?.ok === false && /documento inválido/.test(invalidoJson.detail), JSON.stringify(invalidoJson));
}

console.log("\n== recusas das flags ==");
{
  const doc = documento([{ name: "esp-b", version: "2.0.0" }]);
  const recusa = (nome, args, razao) => { const r = cli(...args, "--dest", pasta()); check(nome, r.status === 1 && razao.test(r.stderr) && !/^OK /m.test(r.stdout), r.stdout + r.stderr); };
  recusa("--instalados e --de-export juntos", ["fetch", "--instalados", "--de-export", doc], /--instalados e --de-export não combinam/);
  recusa("--de-export e --instalados juntos, na outra ordem", ["fetch", "--de-export", doc, "--instalados"], /--instalados e --de-export não combinam/);
  recusa("--instalados com nome de motor", ["fetch", "--instalados", "esp-b"], /--instalados e --de-export não combinam com nomes de motores/);
  recusa("--de-export com nome de motor", ["fetch", "--de-export", doc, "esp-b"], /não combinam com nomes de motores/);
  recusa("nome de motor antes de --instalados", ["fetch", "esp-b", "--instalados"], /não combinam com nomes de motores/);
  recusa("--instalados com --version", ["fetch", "--instalados", "--version", "2.0.0"], /não combinam com nomes de motores nem com --version/);
  recusa("--de-export com --version", ["fetch", "--de-export", doc, "--version", "2.0.0"], /--version/);
  recusa("--de-export sem valor", ["fetch", "--de-export"], /--de-export precisa de um valor/);
  recusa("as flags novas não valem para o ensure", ["ensure", "esp-b", "--de-export", doc], /--de-export não vale para `ensure`/);
  const uso = cli("--help").stdout;
  check("o uso documenta as duas formas", /fetch --instalados/.test(uso) && /fetch --de-export <documento>/.test(uso), uso.slice(0, 200));
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  check("o uso e o README dizem que a versão é a do registry (ou o pin), não a que o ensure instalaria", uso.includes("a versão é a do registry (ou o pin)") && readme.includes("na versão do registry (ou o pin)") && !uso.includes("a que o ensure instalaria") && !readme.includes("na versão que o `ensure` instalaria"));
  const igual = cli("fetch", "esp-a", "esp-b", "--dest", pasta());
  check("fetch com nomes explícitos e sem a flag segue como antes: dois motores são argumento inesperado", igual.status === 1 && /argumento inesperado: esp-b/.test(igual.stderr), igual.stderr);
  const d = pasta(), um = cli("fetch", "esp-b", "--dest", d);
  check("fetch <motor> segue idêntico: um arquivo, exit 0", um.status === 0 && JSON.stringify(lista(d)) === JSON.stringify(["esp-b.tgz"]) && /^OK esp-b v2\.0\.0 /m.test(um.stdout), um.stdout + um.stderr);
}

rmSync(RUN, { recursive: true, force: true });
console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
