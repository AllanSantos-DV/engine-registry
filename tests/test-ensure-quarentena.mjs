// test-ensure-quarentena.mjs — o `ensure` do CLI (ensureCommand) aplica a quarentena como o `ensureEngine`: a versão que não subiu fica de lado.
//
// O que precisa ser verdade:
//   • motor instalado, sem --version nem pin, e a versão oferecida é a que o histórico marca como volta: o ensure real mantém a instalada, não baixa nada,
//     não grava histórico e devolve `quarantined: { version }` com o aviso de uma linha;
//   • o plano do --dry-run diz `manter`, o mesmo que o ensure real faz, e o texto do plano fala de quarentena (não da atualização automática desligada);
//   • --version, pin e --de-arquivo mandam: a versão em quarentena é instalada;
//   • o registry oferecendo outra versão tira o motor da quarentena e atualiza; sem histórico de volta, ou sem versão instalada, nada muda;
//   • a versão que voltou a subir por escolha depois da volta (linha posterior com `to` igual) deixa de ser quarentena; a subida anterior à volta não livra;
//   • `doctor --fix` pula o motor DESATUALIZADO em quarentena (PULADO, exit 0), não instala e não derruba o daemon vivo, e atualiza quando o registry oferece outra versão;
//   • `doctor --fix --verify` num motor ADULTERADO com a versão oferecida em quarentena não repara: diz que nada foi reparado, conta falha e sai com 1;
//   • pelo CLI: o texto traz uma linha `aviso:` com o motor e o --json traz `quarantined`, em um motor e em vários, também no `ensure --de` (real e --dry-run).
// Hermético: HOME e ENGINE_KIT_HOME isolados, registry e downloads de memória (o .tgz é real), o CLI roda numa cópia do kit sem rede, nenhum daemon.
//
//   node tests/test-ensure-quarentena.mjs
import "./_tmp.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-ens-quar-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });
delete process.env.ENGINE_KIT_NO_AUTO_UPDATE;
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { criarCliOffline } = await import("./_kit-copiado.mjs");
const { ensureCommand, ensureDeArquivo, planoEm } = await import("../kit/ensure.mjs");
const { recordSwap } = await import("../kit/trust.mjs");
const { pin } = await import("../kit/index.mjs");
const { preinstalar, registry, instalado, homeOf, plugin } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const historico = () => { try { return readFileSync(join(KIT_HOME, "history.jsonl"), "utf8"); } catch { return ""; } };
const aviso = (v) => `v${v} em quarentena: não subiu aqui; sai com versão nova ou --version ${v}`;
const quarentena = (ws) => (ws ?? []).filter((w) => /em quarentena/.test(w));

const reg = registry({ "q-ruim": "1.1.0", "q-limpo": "1.1.0", "q-ausente": "1.1.0", "q-pin": "1.1.0", "q-arquivo": "1.1.0", "q-explicita": "1.1.0", "q-nova": "1.1.1", "q-b": "1.1.0" });
for (const n of ["q-ruim", "q-limpo", "q-pin", "q-arquivo", "q-explicita", "q-nova", "q-b"]) { preinstalar(n, "1.0.0"); }
for (const n of ["q-ruim", "q-ausente", "q-pin", "q-arquivo", "q-explicita", "q-b"]) { recordSwap(n, "1.1.0", "1.0.0", "rollback"); }
recordSwap("q-nova", "1.1.0", "1.0.0", "rollback");

console.log("== ensure real: a versão oferecida em quarentena não sobe ==");
{
  const logs = [], antes = historico();
  const r = await ensureCommand("q-ruim", { ...reg.opts, log: (m) => logs.push(m) });
  check("mantém a instalada: ok, reusada, na versão 1.0.0, com quarantined", r.ok && r.reused === true && r.version === "1.0.0" && r.quarantined?.version === "1.1.0", JSON.stringify(r));
  check("não baixa nada, não troca o disco e não grava histórico", Object.keys(reg.baixados).length === 0 && instalado("q-ruim") === "1.0.0" && historico() === antes, JSON.stringify(reg.baixados));
  const linhas = logs.filter((m) => /quarentena/.test(m));
  check("avisa em uma linha, com o motor, a versão e como sair", linhas.length === 1 && /q-ruim/.test(linhas[0]) && linhas[0].includes(aviso("1.1.0")), logs.join(" | "));
  check("o aviso também vem em warns, para o --json", quarentena(r.warns).join() === aviso("1.1.0"), JSON.stringify(r.warns));
  check("a quarentena não é a atualização automática desligada: sem `available`", !("available" in r), JSON.stringify(r));
  const repete = await ensureCommand("q-ruim", reg.opts);
  check("o ensure seguinte repete o mesmo: nada baixado", repete.ok && repete.quarantined?.version === "1.1.0" && Object.keys(reg.baixados).length === 0, JSON.stringify(repete));
}

console.log("\n== o plano do --dry-run é o que o ensure real faz ==");
{
  const p = await ensureCommand("q-ruim", { ...reg.opts, dryRun: true });
  check("plano manter, na versão instalada, com quarantined e o aviso", p.ok && p.dryRun === true && p.plan === "manter" && p.version === "1.0.0" && p.installed === "1.0.0" && p.quarantined?.version === "1.1.0" && quarentena(p.warns).join() === aviso("1.1.0"), JSON.stringify(p));
  check("o texto do plano fala de quarentena e não da atualização automática desligada", /manteria v1\.0\.0/.test(planoEm(p) ?? "") && /v1\.1\.0 em quarentena/.test(planoEm(p) ?? "") && !/ENGINE_KIT_NO_AUTO_UPDATE/.test(planoEm(p) ?? ""), String(planoEm(p)));
  const real = await ensureCommand("q-ruim", reg.opts);
  check("o ensure real entrega o plano: reusa a mesma versão", real.ok && real.reused === true && real.version === p.version, JSON.stringify(real));
  const desligada = await ensureCommand("q-ruim", { ...reg.opts, dryRun: true, autoUpdate: false });
  check("com a atualização desligada o plano segue manter e avisa a quarentena", desligada.plan === "manter" && desligada.quarantined?.version === "1.1.0", JSON.stringify(desligada));
}

console.log("\n== o que continua mandando ==");
{
  const exp = await ensureCommand("q-explicita", { ...reg.opts, version: "1.1.0" });
  check("--version ignora a quarentena e instala a versão pedida", exp.ok && exp.previous === "1.0.0" && exp.version === "1.1.0" && !("quarantined" in exp) && instalado("q-explicita") === "1.1.0", JSON.stringify(exp));
  const planoExp = await ensureCommand("q-b", { ...reg.opts, version: "1.1.0", dryRun: true });
  check("--version no plano: atualizar, sem quarantined nem aviso", planoExp.plan === "atualizar" && !("quarantined" in planoExp) && !("warns" in planoExp), JSON.stringify(planoExp));

  pin("q-pin", "1.1.0");
  const fixado = await ensureCommand("q-pin", reg.opts);
  check("motor fixado na versão em quarentena: o pin manda e instala", fixado.ok && fixado.version === "1.1.0" && fixado.pinned === "1.1.0" && !("quarantined" in fixado) && instalado("q-pin") === "1.1.0", JSON.stringify(fixado));

  const dir = join(RUN, "artefato");
  mkdirSync(dir, { recursive: true });
  const a = reg.artefatos["q-arquivo"], tgz = join(dir, "q-arquivo.tgz");
  writeFileSync(tgz, a.tgz); writeFileSync(`${tgz}.sha256`, a.sha256); writeFileSync(`${tgz}.sig`, a.sig);
  const arq = await ensureDeArquivo("q-arquivo", tgz, reg.opts);
  check("--de-arquivo é pedido de uma versão: instala a que está em quarentena", arq.ok && arq.version === "1.1.0" && !("quarantined" in arq) && instalado("q-arquivo") === "1.1.0", JSON.stringify(arq));
}

console.log("\n== sai da quarentena ou nem entra ==");
{
  const nova = await ensureCommand("q-nova", reg.opts);
  check("o registry oferece outra versão (1.1.1, a que falhou foi a 1.1.0): atualiza", nova.ok && nova.previous === "1.0.0" && nova.version === "1.1.1" && !("quarantined" in nova) && instalado("q-nova") === "1.1.1", JSON.stringify(nova));
  const limpo = await ensureCommand("q-limpo", reg.opts);
  check("sem volta gravada: atualiza como sempre", limpo.ok && limpo.previous === "1.0.0" && limpo.version === "1.1.0" && !("quarantined" in limpo), JSON.stringify(limpo));
  const ausente = await ensureCommand("q-ausente", reg.opts);
  check("sem versão instalada a quarentena não impede a instalação", ausente.ok && ausente.version === "1.1.0" && !("quarantined" in ausente) && instalado("q-ausente") === "1.1.0", JSON.stringify(ausente));
}

console.log("\n== a versão que voltou a subir por escolha sai da quarentena ==");
{
  const s = registry({ "s-subiu": "1.1.0", "s-depois": "1.1.0" });
  preinstalar("s-subiu", "1.0.0"); preinstalar("s-depois", "1.0.0");
  recordSwap("s-subiu", "1.0.0", "1.1.0", "auto-update"); recordSwap("s-subiu", "1.1.0", "1.0.0", "rollback");
  recordSwap("s-subiu", "1.0.0", "1.1.0", "version"); recordSwap("s-subiu", "1.1.0", "1.0.0", "version");
  recordSwap("s-depois", "1.0.0", "1.1.0", "version"); recordSwap("s-depois", "1.1.0", "1.0.0", "rollback");
  const subiu = await ensureCommand("s-subiu", s.opts);
  check("v2 falhou, subiu por --version e voltou à mão: o ensure atualiza para ela", subiu.ok && subiu.version === "1.1.0" && !("quarantined" in subiu) && instalado("s-subiu") === "1.1.0", JSON.stringify(subiu));
  const depois = await ensureCommand("s-depois", s.opts);
  check("a subida ANTERIOR à volta que falhou não livra a versão da quarentena", depois.ok && depois.quarantined?.version === "1.1.0" && instalado("s-depois") === "1.0.0", JSON.stringify(depois));
}

console.log("\n== pelo CLI ==");
{
  const c = registry({ "c-ruim": "1.1.0", "c-limpo": "1.1.0" });
  preinstalar("c-ruim", "1.0.0"); preinstalar("c-limpo", "1.0.0");
  recordSwap("c-ruim", "1.1.0", "1.0.0", "rollback");
  const { cli } = await criarCliOffline(RUN, { manifest: c.manifest, artefatos: c.artefatos, kitHome: KIT_HOME, env: { ENGINE_KIT_NO_AUTO_UPDATE: "0" } });
  const json = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };
  const antes = historico();

  const t = cli("ensure", "c-ruim");
  check("texto: exit 0, OK reusado e uma linha `aviso:` com o motor", t.status === 0 && /^OK c-ruim v1\.0\.0 \(já instalado, reusado\)/m.test(t.stdout) && t.stdout.split("\n").filter((l) => /^aviso: c-ruim: .*em quarentena/.test(l)).length === 1, t.stdout + t.stderr);
  const j = json(cli("ensure", "c-ruim", "--json"));
  check("--json: quarantined:{version} e o aviso em warns", j?.ok === true && j.state === "OK" && j.version === "1.0.0" && j.quarantined?.version === "1.1.0" && quarentena(j.warns).join() === aviso("1.1.0"), JSON.stringify(j));
  const dj = json(cli("ensure", "c-ruim", "--dry-run", "--json"));
  check("--dry-run --json: plano manter com quarantined", dj?.state === "PLANO" && dj.plan === "manter" && dj.quarantined?.version === "1.1.0" && /em quarentena/.test(dj.detail), JSON.stringify(dj));
  const dt = cli("ensure", "c-ruim", "--dry-run");
  check("--dry-run em texto: PLANO manteria e a linha de aviso", dt.status === 0 && /^PLANO c-ruim: manteria v1\.0\.0/m.test(dt.stdout) && dt.stdout.includes(`aviso: ${aviso("1.1.0")}`), dt.stdout + dt.stderr);
  const lote = json(cli("ensure", "c-ruim", "c-limpo", "--json"));
  check("vários motores: o que está em quarentena fica e o outro atualiza", lote?.ok === true && lote.engines?.[0]?.quarantined?.version === "1.1.0" && lote.engines[1].state === "ATUALIZADO" && lote.engines[1].version === "1.1.0" && !("quarantined" in lote.engines[1]), JSON.stringify(lote));
  check("o ensure em quarentena não gravou histórico (só o do motor atualizado)", historico().replace(antes, "").trim().split("\n").filter(Boolean).every((l) => JSON.parse(l).engine === "c-limpo"), historico());
  const manifesto = plugin({ "c-ruim": ">=1.1.0" });
  const dej = json(cli("ensure", "--de", manifesto, "--json"));
  check("ensure --de --json: mantido, com quarantined e o aviso do motor", dej?.engines?.[0]?.acao === "mantido" && dej.engines[0].quarantined?.version === "1.1.0" && quarentena(dej.engines[0].warns).join() === aviso("1.1.0"), JSON.stringify(dej));
  const det = cli("ensure", "--de", manifesto);
  check("ensure --de em texto: a linha `aviso:` com o motor e a razão", /^aviso: c-ruim: .*em quarentena/m.test(det.stdout), det.stdout + det.stderr);
  const ded = cli("ensure", "--de", manifesto, "--dry-run");
  check("ensure --de --dry-run em texto: a linha `aviso:` com o motor e a razão", /^aviso: c-ruim: .*em quarentena/m.test(ded.stdout), ded.stdout + ded.stderr);
  const v = json(cli("ensure", "c-ruim", "--version", "1.1.0", "--json"));
  check("--version pelo CLI instala a versão em quarentena", v?.ok === true && v.version === "1.1.0" && v.state === "ATUALIZADO" && !("quarantined" in v), JSON.stringify(v));
}

console.log("\n== doctor --fix respeita a quarentena ==");
{
  const { RUNTIME, SOBE } = await import("./_daemon-falso.mjs");
  const d = registry({ "d-ruim": "1.1.0", "d-nova": "1.1.1" }, { extra: { "d-ruim": { runtime: RUNTIME } } });
  preinstalar("d-ruim", "1.0.0"); preinstalar("d-nova", "1.0.0");
  writeFileSync(join(homeOf("d-ruim"), "bin", "d-ruim.mjs"), SOBE);
  recordSwap("d-ruim", "1.1.0", "1.0.0", "rollback"); recordSwap("d-nova", "1.1.0", "1.0.0", "rollback");
  const { cli } = await criarCliOffline(RUN, { manifest: d.manifest, artefatos: d.artefatos, kitHome: KIT_HOME, env: { ENGINE_KIT_NO_AUTO_UPDATE: "0", LOOPBACK_REAL: "1" } });
  const anuncio = join(homeOf("d-ruim"), "run", "daemon.json");
  const daemon = spawn(process.execPath, [join(homeOf("d-ruim"), "bin", "d-ruim.mjs")], { stdio: "ignore", windowsHide: true });
  process.on("exit", () => { try { process.kill(daemon.pid); } catch { /* já saiu */ } });
  for (let i = 0; i < 100 && !existsSync(anuncio); i++) { await new Promise((r) => setTimeout(r, 50)); }
  const vivo = async () => { try { return (await fetch(`http://127.0.0.1:${JSON.parse(readFileSync(anuncio, "utf8")).port}/health`)).status === 200; } catch { return false; } };
  const antes = historico();

  const f = cli("doctor", "--fix", "--engine", "d-ruim");
  check("--fix pula a versão em quarentena com a linha PULADO e sai com 0", f.status === 0 && f.stdout.includes("PULADO d-ruim: v1.1.0 em quarentena (--version 1.1.0 força)") && !/ FALHA /.test(f.stdout), f.stdout + f.stderr);
  check("--fix não instala a versão em quarentena nem grava histórico", instalado("d-ruim") === "1.0.0" && historico() === antes, instalado("d-ruim"));
  check("--fix não derruba o daemon vivo", await vivo(), f.stdout + f.stderr);
  const n = cli("doctor", "--fix", "--engine", "d-nova");
  check("com a versão nova no registry o --fix atualiza", n.status === 0 && instalado("d-nova") === "1.1.1" && !/PULADO/.test(n.stdout), n.stdout + n.stderr);
}

console.log("\n== doctor --fix com motor ADULTERADO em quarentena ==");
{
  const { hashTree, FILES_MANIFEST } = await import("../kit/provision.mjs");
  const a = registry({ "a-adulterado": "1.1.0" });
  preinstalar("a-adulterado", "1.0.0");
  const bin = join(homeOf("a-adulterado"), "bin"), exe = join(bin, "a-adulterado.mjs");
  writeFileSync(join(bin, FILES_MANIFEST), JSON.stringify(hashTree(bin)));
  writeFileSync(exe, "adulterado");
  recordSwap("a-adulterado", "1.1.0", "1.0.0", "rollback");
  const { cli } = await criarCliOffline(RUN, { manifest: a.manifest, artefatos: a.artefatos, kitHome: KIT_HOME, env: { ENGINE_KIT_NO_AUTO_UPDATE: "0" } });
  const antes = historico();

  const f = cli("doctor", "--fix", "--verify", "--engine", "a-adulterado");
  check("--fix diz que nada foi reparado e como reinstalar, e sai com 1", f.status === 1 && f.stdout.includes("ADULTERADO e v1.1.0 em quarentena: nada foi reparado (--version 1.1.0 reinstala)"), f.stdout + f.stderr);
  check("--fix conta a adulteração como falha: o rodapé não diz conciliado", /== 1 falha\(s\) ==/.test(f.stdout) && !/conciliado/.test(f.stdout), f.stdout);
  check("--fix deixa o binário e o histórico intactos", readFileSync(exe, "utf8") === "adulterado" && instalado("a-adulterado") === "1.0.0" && historico() === antes);
}

rmSync(RUN, { recursive: true, force: true });
console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
