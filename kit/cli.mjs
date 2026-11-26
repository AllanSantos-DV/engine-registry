#!/usr/bin/env node
// engine-kit — comando de instalação dos motores (campo `bin` do package.json).
//
//   npx engine-kit ensure <motor>                    # instala/atualiza verificando sha256 + Ed25519
//   npx engine-kit ensure <motor> --version <x.y.z>  # pin de versão
//   npx engine-kit ensure <motor> --registry-url <url>
//   npx engine-kit pin <motor> [--version <x.y.z>]   # congela UM motor; a atualização automática pula só ele
//   npx engine-kit pin <motor> <motor>... | --instalados  # congela vários motores, ou todo motor instalado que o ensure --instalados atualiza
//   npx engine-kit unpin <motor> | --todos           # o motor volta a receber atualizações (--todos: todos os pins gravados)
//   npx engine-kit fetch <motor|app> [--dest <pasta>] # baixa e confere sha256 + Ed25519 SEM instalar
//   npx engine-kit fetch <motor>... --com-assinaturas # grava também o .sha256 e o .sig conferidos, para ensure --de-arquivo
//   npx engine-kit list [--json] [--apps]             # motores do pacote, plataformas que atendem e o que está instalado aqui
//   npx engine-kit doctor [--fix|--verify] [--engine <motor>]  # concilia os motores instalados com o registry
//   npx engine-kit doctor --report                    # texto colável para suporte, sem token nem chave
//   npx engine-kit history [motor] [--json]           # trocas de versão gravadas nesta máquina
//   npx engine-kit check <manifesto.json>... [--json] # o bloco `engines` de um ou mais plugins contra o instalado
//   npx engine-kit url <motor> [--json]               # endereço do daemon vivo, nunca o token
//   npx engine-kit ensure --de <manifesto.json>... [--json]  # instala/atualiza o que o `check` de cada manifesto reprova
//   npx engine-kit rollback <motor> [--json]         # volta à versão anterior à última troca do histórico e fixa nela
//   npx engine-kit trust [motor] [--json]            # o que o trust.json guarda por motor (só chave pública), sem gravar
//   npx engine-kit export [arquivo]                  # os motores instalados aqui (nome, versão, pin) num documento JSON, sem chave nem caminho
//   npx engine-kit import <arquivo|-> [--dry-run]    # instala a versão registrada de cada motor do documento (sha256 + Ed25519) e refixa o que estava fixado; `-` lê a entrada padrão
//   npx engine-kit completion <bash|zsh|powershell>  # imprime o script de completion do shell, sem rede e sem gravar nada
//   npx engine-kit mcp                               # servidor MCP (stdio) só de leitura sobre os verbos acima
//
// Por padrão o kit se atualiza (roda de novo como a última versão do npm) e atualiza o motor instalado.
// ENGINE_KIT_NO_AUTO_UPDATE=1 desliga os dois e deixa só o aviso de versão nova (ver update.mjs).
// Exit code: 0 = motor instalado (ou reusado). 1 = recusou/falhou, com o motivo na saída de erro.
import { existsSync } from "node:fs";
import { ensureCommand, ensureDeCommand, pinCommand, unpinCommand, stopCommand, listCommand, rollbackCommand, instaladosAtualizaveis, ensureDeArquivo, planoEm } from "./ensure.mjs";
import { registerNeuralLink, unregisterNeuralLink } from "./register.mjs";
import { fetchCommand } from "./fetch.mjs";
import { exportCommand, importCommand, lerDocumento } from "./export-import.mjs";
import { historyCommand, checkCommand, urlCommand, updateCommand, reportCommand, trustCommand, trustRestoreCommand, pathCommand, infoCommand } from "./inspect.mjs";
import { completionScript, SHELLS } from "./completion.mjs";
import { selfUpdate, autoUpdateEnabled } from "./update.mjs";
import { pinOf, readTrust } from "./trust.mjs";

const USAGE = "uso: engine-kit ensure <motor> [--version <x.y.z>] [--registry-url <url>]\n" +
  "     engine-kit update <motor> [--check] [--json]   pede ao updater do daemon vivo (motor com runtime.updatePath) que se atualize; --check só compara as versões\n" +
  "     engine-kit ensure <motor> --dry-run [--version <x.y.z>] [--registry-url <url>] [--json] [--falhar-se-desatualizado]   diz o que o ensure faria (instalaria, atualizaria, reusaria, manteria) sem baixar nem gravar nada; vale também com vários motores e com --de; --falhar-se-desatualizado (não vale com --de) sai com 1 se algum motor teria plano diferente de reusar\n" +
  "     engine-kit ensure <motor> --de-arquivo <artefato.tgz> [--version <x.y.z>] [--registry-url <url>] [--json]   instala do artefato local (com <artefato>.sha256 e <artefato>.sig ao lado, os três assets da release), sem baixá-lo; sha256, Ed25519 e versão continuam obrigatórios; troca o motor instalado mesmo com a atualização automática desligada\n" +
  "     engine-kit ensure --instalados [--dry-run] [--registry-url <url>] [--json] [--falhar-se-desatualizado]   atualiza, numa chamada, os motores instalados aqui (pin respeitado; self-managed e motor de outra plataforma ficam de fora); sem nomes, sem --version; com --dry-run, --falhar-se-desatualizado sai com 1 se algum teria plano diferente de reusar\n" +
  "     engine-kit ensure <motor> <motor>... [--registry-url <url>] [--json]   vários motores numa chamada; uma falha não esconde os outros (exit 1 se algum falhou; --json devolve { ok, engines })\n" +
  "     engine-kit pin <motor> [--version <x.y.z>] [--registry-url <url>]   fixa a versão instalada (ou instala e fixa x.y.z)\n" +
  "     engine-kit pin <motor> --version <x.y.z> --dry-run [--registry-url <url>] [--json]   diz o que o pin faria (fixaria, instalaria e fixaria, trocaria e fixaria) sem instalar nem gravar o pin; sem --version, o plano é fixar a versão instalada\n" +
  "     engine-kit pin <motor> <motor>... [--dry-run] [--registry-url <url>] [--json]   fixa cada motor instalado, numa chamada; uma falha não esconde os outros (exit 1 se algum falhou; --json devolve { ok, engines })\n" +
  "     engine-kit pin --instalados [--dry-run] [--registry-url <url>] [--json]   fixa todo motor que o ensure --instalados atualiza; sem nomes, sem --version\n" +
  "     engine-kit unpin <motor>                     solta o motor para voltar a atualizar\n" +
  "     engine-kit unpin --todos                     solta todos os pins gravados\n" +
  "     engine-kit fetch <motor|app> [--version <x.y.z>] [--dest <pasta>] [--registry-url <url>]   baixa e confere (sha256 + Ed25519) sem instalar\n" +
  "     engine-kit fetch <motor> [<motor>...] --com-assinaturas [--dest <pasta>] [--registry-url <url>] [--json]   grava ao lado de cada .tgz conferido o <artefato>.sha256 e o <artefato>.sig da release (também conferidos), a pasta que o ensure <motor> --de-arquivo aceita; vários motores numa chamada, uma falha não esconde os outros (exit 1 se algum falhou)\n" +
  "     engine-kit fetch --instalados [--com-assinaturas] [--dest <pasta>] [--registry-url <url>] [--json]   espelho em lote: baixa e confere (sha256 + Ed25519) o artefato de cada motor instalado aqui (o conjunto do ensure --instalados: sem self-managed nem motor de outra plataforma), sem instalar nada; a versão é a do registry (ou o pin), mesmo com quarentena, updatePath ou ENGINE_KIT_NO_AUTO_UPDATE; envelope { ok, engines }, uma falha não esconde os outros (exit 1 se algum falhou); sem nomes, sem --version\n" +
  "     engine-kit fetch --de-export <documento> [--com-assinaturas] [--dest <pasta>] [--registry-url <url>] [--json]   o mesmo para cada motor do documento do export, na versão registrada nele; documento inválido é recusado inteiro; sem nomes, sem --version, não combina com --instalados\n" +
  "     (ensure, pin, fetch e stop aceitam --json: um objeto JSON no formato das linhas do doctor --json, também na falha)\n" +
  "     engine-kit stop <motor> [--registry-url <url>]   desliga o motor pelo shutdownPath que o registry declara\n" +
  "     engine-kit ensure neural-link --register     além de instalar, registra os hooks no config global do usuário\n" +
  "     engine-kit ensure neural-link --unregister   além de instalar, desfaz esse registro (precisa de um neural-link que exponha uninstall)\n" +
  "     engine-kit list [--json] [--apps]            motores do pacote, a plataforma de cada um e a versão instalada (sem rede); --apps acrescenta os apps de manifest.apps, com a plataforma e o pin de cada um; no --json cada motor traz também o pin\n" +
  "     engine-kit history [motor] [--json]          trocas de versão gravadas nesta máquina (de → para e a origem: ensure, auto-update, version, rollback)\n" +
  "     engine-kit check <manifesto-do-plugin.json>... [--rede] [--registry-url <url>] [--json]   confere o bloco engines de um ou mais manifestos (faixas >=, >, <=, <, =, ^x.y.z) contra o instalado; exit 1 se algum não satisfaz; com vários, --json devolve { ok, manifests }; --rede diz, para o que falta ou está fora da faixa, se a versão publicada satisfaz\n" +
  "     engine-kit ensure --de <manifesto-do-plugin.json>... [--registry-url <url>] [--json]   instala ou atualiza cada motor que o check reprova (ausente, fora da faixa) e reconfere; self-managed é pulado; faixa inválida aborta antes de instalar; exit 1 se algum não satisfaz no fim\n" +
  "     engine-kit rollback <motor> [--registry-url <url>] [--json]   volta à versão anterior à última troca do history (sha256 + Ed25519) e fixa nela; recusa primeira instalação e motor self-managed\n" +
  "     engine-kit rollback <motor> --dry-run [--registry-url <url>] [--json]   diz de qual versão para qual voltaria e que fixaria nela, sem trocar a versão nem gravar o pin; as mesmas recusas\n" +
  "     engine-kit trust [motor] [--json]            o que o trust.json guarda por motor (chave pública, origem, maior versão, pin) e se bate com o manifest embarcado; só lê\n" +
  "     engine-kit trust --restaurar                 devolve o trust.json a partir do .bak quando ele está ilegível (a cópia é validada; a troca é atômica)\n" +
  "     engine-kit info <motor|app> [--json]         descritor, versão no manifest, versão instalada, estado, pin, plataformas e release de um motor (de um app: o descritor e o pin, sem versão instalada); só lê, sem rede\n" +
  "     engine-kit path <motor> [--json]             caminho do executável do motor instalado e o estado do cli.json dele; sem rede, não sobe nada\n" +
  "     engine-kit url <motor> [--json]              endereço do daemon vivo (url, versão e pid) lido do anúncio dele; nunca imprime o token\n" +
  "     engine-kit export [arquivo]                  grava (ou imprime, sem arquivo) um JSON com, por motor instalado aqui, o nome, a versão instalada e o pin; nunca leva chave, assinatura, caminho, usuário nem máquina\n" +
  "     engine-kit import <arquivo|-> [--dry-run] [--permitir-rebaixar] [--registry-url <url>] [--json]   instala a versão registrada de cada motor do documento do export (sha256 + Ed25519 como no ensure) e fixa o que estava fixado; `-` lê o documento da entrada padrão (engine-kit export | engine-kit import -); --dry-run mostra só o plano; documento inválido é recusado inteiro, um motor recusado não impede os outros (exit 1 se algum falhou)\n" +
  "     engine-kit completion <bash|zsh|powershell>  imprime o script de completion do shell (verbos, flags e motores), sem rede e sem gravar nada; ex.: eval \"$(engine-kit completion bash)\"\n" +
  "     engine-kit mcp                               servidor MCP (stdio) que não instala nem fixa nada: engine_list, engine_history, engine_check, engine_path, engine_url, engine_trust, engine_doctor, engine_info, engine_export, engine_report e, com rede, engine_plan e engine_check com rede:true (atualizam só o cache do descritor); não atualiza o kit\n" +
  "     engine-kit doctor [--fix|--json|--verify] [--engine <motor>] [--local] [--registry-url <url>]   diagnostica os motores instalados (--fix instala o que falta e atualiza o que está velho)\n" +
  "     engine-kit doctor --report [--engine <motor>] [--local] [--verify]   texto colável para suporte (kit, Node, plataforma, motores, sobras, hooks); sem token nem chave\n" +
  "     (ensure, pin, fetch, check e rollback aceitam --retry <0-5>, ou ENGINE_KIT_RETRY=<0-5>: repete a conexão que caiu, o 5xx e o 429 com espera crescente; desligado por padrão, e o 404 nunca é repetido)\n" +
  "ENGINE_KIT_NO_AUTO_UPDATE=1 desliga a atualização automática do kit e dos motores (fica só o aviso).";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
const VERBS = ["ensure", "pin", "unpin", "fetch", "stop", "doctor", "list", "history", "check", "url", "rollback", "trust", "path", "update", "info", "export", "import", "completion", "mcp"];
const NOME_OPCIONAL = ["doctor", "list", "history", "trust", "export", "mcp"];
const [cmd, name] = args;
const nomeOpcional = name?.startsWith("-") ? undefined : name;
const COM_VALOR = ["--version", "--registry-url", "--dest", "--engine", "--de", "--de-arquivo", "--de-export", "--retry"];
const deManifesto = cmd === "ensure" && name === "--de";
const instalados = (cmd === "ensure" || cmd === "pin" || cmd === "fetch") && name === "--instalados";
const deExport = cmd === "fetch" && name === "--de-export";
const todos = cmd === "unpin" && name === "--todos";
const FLAGS = {
  ensure: ["--version", "--registry-url", "--register", "--unregister", "--json", "--de", "--dry-run", "--instalados", "--de-arquivo", "--retry", "--falhar-se-desatualizado"],
  pin: ["--version", "--registry-url", "--json", "--retry", "--dry-run", "--instalados"],
  unpin: ["--todos"],
  fetch: ["--version", "--registry-url", "--dest", "--json", "--retry", "--com-assinaturas", "--instalados", "--de-export"],
  stop: ["--registry-url", "--json"],
  doctor: ["--fix", "--json", "--verify", "--report", "--engine", "--local", "--registry-url"],
  list: ["--json", "--apps"],
  history: ["--json"],
  check: ["--json", "--rede", "--registry-url", "--retry"],
  url: ["--json"],
  rollback: ["--registry-url", "--json", "--retry", "--dry-run"],
  trust: ["--json", "--restaurar"],
  path: ["--json"],
  info: ["--json"],
  export: [],
  import: ["--json", "--dry-run", "--registry-url", "--retry", "--permitir-rebaixar"],
  update: ["--json", "--check"],
  completion: [],
  mcp: [],
};
/** Primeira flag que o verbo não aceita, ou argumento solto além do nome do motor. */
const sobra = () => {
  const aceitas = FLAGS[cmd] ?? [];
  for (let i = deManifesto || instalados || deExport || (NOME_OPCIONAL.includes(cmd) && !(["history", "trust", "export"].includes(cmd) && nomeOpcional)) ? 1 : 2; i < args.length; i++) {
    if (!args[i].startsWith("-")) { if (cmd === "check" || cmd === "ensure" || cmd === "pin" || deManifesto || (cmd === "fetch" && (args.includes("--com-assinaturas") || instalados || deExport))) { continue; } return `argumento inesperado: ${args[i]}`; }
    if (!aceitas.includes(args[i]) && /^--(un)?register$/.test(args[i])) { return "--register e --unregister só valem para `engine-kit ensure neural-link`"; }
    if (!aceitas.includes(args[i])) { return `${args[i]} não vale para \`${cmd}\``; }
    if (COM_VALOR.includes(args[i])) { i++; }
  }
  if (args.includes("--report") && (args.includes("--json") || args.includes("--fix"))) { return "--report não combina com --json nem com --fix: o relatório é texto e só lê"; }
  if (args.includes("--json") && args.includes("--fix")) { return "--json e --fix não combinam: o --fix imprime o progresso, não JSON"; }
  return args.includes("--json") && ["--register", "--unregister"].some((f) => args.includes(f)) ? "--json não combina com --register/--unregister: o registro dos hooks imprime texto" : null;
};
/** Argumentos soltos depois do verbo, sem as flags nem os valores delas: os manifestos extras de `check` e `ensure --de`. */
const posicionais = () => { const o = []; for (let i = 1; i < args.length; i++) { if (!args[i].startsWith("-")) { o.push(args[i]); } else if (COM_VALOR.includes(args[i])) { i++; } } return o; };
const comAssinaturas = cmd === "fetch" && args.includes("--com-assinaturas");
const motores = ((cmd === "ensure" && !deManifesto) || cmd === "pin") && !instalados || comAssinaturas ? [...new Set(posicionais())] : [];
const lista = instalados ? instaladosAtualizaveis() : null;
/** Os motores com pin gravado no trust.json, ou o motivo de não conseguir lê-lo. */
const fixados = () => { try { return { ok: true, names: Object.entries(readTrust()).filter(([, e]) => e?.pin).map(([m]) => m) }; } catch (e) { return { ok: false, reason: e.message }; } };
const USO_ESPELHO = "engine-kit fetch --instalados | --de-export <documento> [--com-assinaturas] [--dest <pasta>] [--registry-url <url>] [--json]";
/** Recusa das formas em lote do `fetch`: as duas juntas, nomes de motor ou --version. */
const recusaEspelho = () => !["--instalados", "--de-export"].some((f) => args.includes(f)) ? null
  : args.includes("--instalados") && args.includes("--de-export") ? `--instalados e --de-export não combinam: ${USO_ESPELHO}`
  : !(instalados || deExport) || posicionais().length || args.includes("--version") ? `--instalados e --de-export não combinam com nomes de motores nem com --version, e vêm logo depois de fetch: ${USO_ESPELHO}` : null;
const asJson = args.includes("--json");
const dryRun = args.includes("--dry-run");
const falharSeDesatualizado = args.includes("--falhar-se-desatualizado");
const log = (m) => { if (!asJson) { console.log(m); } };

/** Retorno de um verbo no formato das linhas do `doctor --json` (name, state, detail, warns, pin); o resto é do verbo. */
const jsonOf = (verb, name, r) => {
  if (!r.ok) { return { name, ok: false, state: "ERRO", detail: r.reason, warns: [], pin: null, ...(r.restarted ? { version: r.version, restarted: r.restarted } : {}) }; }
  const warns = [
    ...(r.staleCache ? ["registry inacessível: descritor do cache vencido"] : []),
    ...(r.warns ?? []),
    ...(r.available ? [`v${r.available} disponível; ENGINE_KIT_NO_AUTO_UPDATE ligado`] : []),
    ...(r.pointer && !["OK", "AUSENTE"].includes(r.pointer.state) ? [`ponteiro cli.json ${r.pointer.state}: ${r.pointer.detail}`] : []),
  ];
  const base = { name, ok: true, warns, pin: r.pinned ?? null };
  if (r.dryRun) { return { ...base, state: "PLANO", plan: r.plan, detail: planoEm(r), version: r.version, ...(r.installed ? { installed: r.installed } : {}), ...(r.available ? { available: r.available } : {}), ...(r.quarantined ? { quarantined: r.quarantined } : {}) }; }
  if (verb === "stop") { return { ...base, state: r.stopped ? "PARADO" : "SEM PROCESSO", detail: r.stopped ? "desligado" : "nada vivo para desligar", stopped: r.stopped }; }
  if (verb === "fetch") { return { ...base, state: "BAIXADO", detail: `v${r.version} conferido, não instalado`, version: r.version, files: r.files }; }
  if (verb === "update") { return { ...base, state: r.state, detail: r.detail, ...(r.current ? { current: r.current } : {}), ...(r.available ? { available: r.available } : {}) }; }
  if (verb === "pin") { return { ...base, state: "FIXADO", detail: `v${r.pinned} fixado`, version: r.version }; }
  const state = r.reused ? "OK" : r.previous ? "ATUALIZADO" : "INSTALADO";
  return { ...base, state, detail: r.previous ? `v${r.previous} → v${r.version}` : `v${r.version}${r.reused ? " reusado" : ""}`, version: r.version, signed: r.signed ?? null, entryPath: r.entryPath, kind: r.kind, ...(r.previous ? { previous: r.previous } : {}), ...(r.pointer ? { pointer: r.pointer } : {}), ...(r.restarted ? { restarted: r.restarted } : {}), ...(r.quarantined ? { quarantined: r.quarantined } : {}) };
};
const done = (verb, r, text) => {
  if (asJson) { console.log(JSON.stringify(jsonOf(verb, name, r), null, 2)); if (!r.ok) { process.exitCode = 1; } return; }
  if (!r.ok) { console.error(`FALHOU ${name}: ${r.reason}`); process.exitCode = 1; return; }
  text();
};
const avisoCache = (r, nome = name) => { if (r.staleCache) { console.log(`aviso: registry inacessível; ${nome} usou o descritor em cache vencido`); } };
const avisosDoPlano = (r) => { for (const w of r.warns ?? []) { console.log(`aviso: ${w}`); } };
const semValor = ["--dest", "--registry-url", "--engine", "--de", "--de-arquivo", "--de-export"].find((f) => args.includes(f) && (flag(f) ?? "-").startsWith("-"));

if (cmd === "--help" || cmd === "-h") {
  console.log(USAGE);
} else if (VERBS.includes(cmd) && args.includes("--todos") && !(todos && args.length === 2)) {
  console.error(cmd === "unpin" ? "--todos não combina com nomes de motores nem com outras opções: engine-kit unpin --todos" : "--todos só vale para `engine-kit unpin --todos`");
  process.exitCode = 1;
} else if (!VERBS.includes(cmd) || (!NOME_OPCIONAL.includes(cmd) && !deManifesto && !instalados && !deExport && !todos && (!name || (name.startsWith("-") && !(cmd === "import" && name === "-"))))) {
  console.error(cmd && !VERBS.includes(cmd) ? `comando desconhecido: ${cmd}\n${USAGE}` : USAGE);
  process.exitCode = 1;
} else if (semValor) {
  console.error(`${semValor} precisa de um valor`);
  process.exitCode = 1;
} else if (sobra()) {
  console.error(sobra());
  process.exitCode = 1;
} else if (cmd === "fetch" && recusaEspelho()) {
  console.error(recusaEspelho());
  process.exitCode = 1;
} else if (cmd === "pin" && args.includes("--instalados") && !instalados) {
  console.error("--instalados não combina com nomes de motores: engine-kit pin --instalados [--dry-run] [--registry-url <url>] [--json]");
  process.exitCode = 1;
} else if (instalados && (posicionais().length || ["--version", "--register", "--unregister", "--de"].some((f) => args.includes(f)))) {
  console.error(`--instalados não combina com nomes de motores, --version, --register, --unregister nem --de: engine-kit ${cmd} --instalados [--dry-run] [--registry-url <url>] [--json]`);
  process.exitCode = 1;
} else if (falharSeDesatualizado && (!dryRun || deManifesto)) {
  console.error("--falhar-se-desatualizado só vale com --dry-run e não combina com --de: engine-kit ensure <motor>... --dry-run --falhar-se-desatualizado   ou   engine-kit ensure --instalados --dry-run --falhar-se-desatualizado");
  process.exitCode = 1;
} else if (args.includes("--de-arquivo") && (motores.length !== 1 || deManifesto || instalados || dryRun || ["--register", "--unregister"].some((f) => args.includes(f)))) {
  console.error("--de-arquivo vale para um motor só e não combina com --dry-run, --instalados, --de, --register nem --unregister: engine-kit ensure <motor> --de-arquivo <artefato.tgz> [--version <x.y.z>] [--registry-url <url>] [--json]");
  process.exitCode = 1;
} else if (args.includes("--de-arquivo") && !existsSync(flag("--de-arquivo"))) {
  console.error(`--de-arquivo: ${flag("--de-arquivo")} não existe`);
  process.exitCode = 1;
} else if (lista && !lista.ok) {
  console.error(`FALHOU ${cmd} --instalados: ${lista.reason}`);
  process.exitCode = 1;
} else if (comAssinaturas && motores.length > 1 && args.includes("--version")) {
  console.error("--version vale para um motor só, não para vários motores: engine-kit fetch <motor> [<motor>...] --com-assinaturas [--dest <pasta>] [--registry-url <url>] [--json]");
  process.exitCode = 1;
} else if (motores.length > 1 && ["--version", "--register", "--unregister"].some((f) => args.includes(f))) {
  console.error(`--version, --register e --unregister valem para um motor só, não para vários motores: engine-kit ${cmd} <motor> <motor>... [--registry-url <url>] [--json]`);
  process.exitCode = 1;
} else if (["--register", "--unregister"].some((f) => args.includes(f)) && !(cmd === "ensure" && name === "neural-link")) {
  console.error("--register e --unregister só valem para `engine-kit ensure neural-link`");
  process.exitCode = 1;
} else if (dryRun && ["--register", "--unregister"].some((f) => args.includes(f))) {
  console.error("--dry-run não combina com --register nem --unregister: o plano não grava nada");
  process.exitCode = 1;
} else if (args.includes("--register") && args.includes("--unregister")) {
  console.error("--register e --unregister não combinam");
  process.exitCode = 1;
} else if (args.includes("--de") && (!deManifesto || ["--version", "--register", "--unregister"].some((f) => args.includes(f)))) {
  console.error("--de substitui o nome do motor e não combina com --version, --register nem --unregister: engine-kit ensure --de <manifesto-do-plugin.json> [--registry-url <url>] [--json]");
  process.exitCode = 1;
} else if (args.includes("--retry") && !/^[0-5]$/.test(flag("--retry") ?? "")) {
  console.error(`--retry precisa de um número de 0 a 5 (recebi: ${flag("--retry") ?? "nada"})`);
  process.exitCode = 1;
} else if (args.includes("--version") && !/^\d+\.\d+\.\d+$/.test(flag("--version") ?? "")) {
  console.error(`--version precisa de x.y.z (recebi: ${flag("--version") ?? "nada"})`);
  process.exitCode = 1;
} else if (cmd === "completion" && !SHELLS.includes(name)) {
  console.error(`shell desconhecido: ${name} (${SHELLS.join(", ")})\n${USAGE}`);
  process.exitCode = 1;
} else if (cmd === "completion") {
  const l = listCommand();
  try { if (!l.ok) { throw new Error(l.reason); } console.log(completionScript(name, { verbs: VERBS, flags: FLAGS, engines: l.engines.map((e) => e.name) })); }
  catch (e) { console.error(`FALHOU completion: ${e.message}`); process.exitCode = 1; }
} else if (cmd === "mcp") {
  await (await import("./mcp.mjs")).serve();
} else {
  if (args.includes("--retry")) { process.env.ENGINE_KIT_RETRY = flag("--retry"); }
  // Sem process.exit() depois de rede: no Windows o Node aborta com sockets ainda fechando (ver doctor.mjs).
  const u = await selfUpdate(args);
  if (u.action === "relaunched") {
    process.exitCode = u.status;
  } else if (cmd === "doctor" && args.includes("--report")) {
    const r = await reportCommand({ only: flag("--engine"), local: args.includes("--local"), verify: args.includes("--verify"), registryUrl: flag("--registry-url") });
    if (r.ok) { console.log(r.text); } else { console.error(`FALHOU doctor --report: ${r.reason}`); process.exitCode = 1; }
  } else if (cmd === "doctor") {
    await import("./doctor.mjs");
  } else if (cmd === "list") {
    const r = listCommand({ apps: args.includes("--apps") });
    if (!r.ok) { console.error(`FALHOU list: ${r.reason}`); process.exitCode = 1; }
    else if (asJson) {
      try { console.log(JSON.stringify({ ...r, engines: r.engines.map((e) => ({ ...e, pin: pinOf(e.name) ?? null })) }, null, 2)); }
      catch (e) { console.error(`FALHOU list: ${e.message}`); process.exitCode = 1; }
    } else {
      const w = Math.max(...r.engines.map((e) => e.name.length));
      for (const e of r.engines) { console.log(`${e.supported ? "  ok  " : " fora "} ${e.name.padEnd(w)}  v${e.version.padEnd(8)} ${e.platforms.join(",")}${e.supported ? "" : ` (esta máquina: ${r.platform})`}  ${e.selfManaged ? "instala pelo próprio updater" : e.installed ? `instalado v${e.installed}` : "não instalado"}`); }
      if (r.apps) {
        const wa = Math.max(0, ...r.apps.map((a) => a.name.length));
        console.log("apps:");
        for (const a of r.apps) { console.log(`${a.supported ? "  ok  " : " fora "} ${a.name.padEnd(wa)}  v${a.version.padEnd(8)} ${a.platforms.join(",")}${a.supported ? "" : ` (esta máquina: ${r.platform})`}  app: engine-kit fetch ${a.name}${a.pin ? `; fixado v${a.pin}` : ""}`); }
      }
    }
  } else if (cmd === "update") {
    const r = await updateCommand(name, { check: args.includes("--check") });
    done("update", r, () => console.log(r.state === "applying" ? `OK ${name}: ${r.detail}` : `OK ${name} ${r.detail}`));
  } else if (cmd === "url") {
    const r = await urlCommand(name);
    if (asJson) { console.log(JSON.stringify(r, null, 2)); }
    else if (!r.ok) { console.error(`FALHOU url ${name}: ${r.reason}`); }
    else { console.log(`url: ${r.url}\nversão: ${r.version ?? "?"}\npid: ${r.pid ?? "?"}`); }
    if (!r.ok) { process.exitCode = 1; }
  } else if (cmd === "check" || deManifesto) {
    const files = deManifesto ? [flag("--de"), ...posicionais()] : posicionais();
    const rs = [];
    for (const f of files) { rs.push(deManifesto ? await ensureDeCommand(f, { registryUrl: flag("--registry-url"), autoUpdate: autoUpdateEnabled(), dryRun, log }) : await checkCommand(f, { rede: args.includes("--rede"), registryUrl: flag("--registry-url") })); }
    if (asJson) { console.log(JSON.stringify(files.length > 1 ? { ok: rs.every((r) => r.ok), manifests: rs } : rs[0], null, 2)); }
    else {
      for (const [i, r] of rs.entries()) {
        if (files.length > 1) { console.log(`${i ? "\n" : ""}-- ${files[i]} --`); }
        if (!r.engines) { console.error(`FALHOU ${cmd}: ${r.reason}`); continue; }
        const w = Math.max(0, ...r.engines.map((e) => e.name.length));
        for (const e of r.engines) { console.log(`${e.satisfied ? "  OK  " : "  !!  "} ${e.name.padEnd(w)}  ${String(e.range).padEnd(10)} ${e.acao ? `[${e.acao}] ` : ""}${e.state === "OK" ? e.detail : `${e.state}: ${e.detail}`}${e.available ? ` (v${e.available} disponível; ENGINE_KIT_NO_AUTO_UPDATE ligado)` : ""}`); for (const w of r.dryRun ? e.warns ?? [] : []) { console.log(`aviso: ${e.name}: ${w}`); } }
        if (r.reason) { console.error(r.reason); }
        console.log(r.dryRun ? "\n== plano: nada foi instalado ==" : r.engines.length ? (r.ok ? `\n== os ${r.engines.length} motor(es) satisfazem o manifesto ==` : `\n== ${r.engines.filter((e) => !e.satisfied).length} motor(es) não satisfazem o manifesto ==`) : "nenhum motor declarado no bloco engines");
      }
    }
    if (rs.some((r) => !r.ok)) { process.exitCode = 1; }
  } else if (cmd === "info") {
    const r = await infoCommand(name);
    if (asJson) { console.log(JSON.stringify(r, null, 2)); }
    else if (!r.ok) { console.error(`FALHOU info ${name}: ${r.reason}`); }
    else {
      console.log(`${r.name}  (${r.kind})  ${r.summary}`);
      console.log(`versão no manifest: v${r.version}   instalado: ${r.app ? "fora do alcance do kit" : r.installed ? `v${r.installed}` : "não instalado"}   estado: ${r.state} (${r.detail})`);
      console.log(`pin: ${r.pin ?? "-"}   plataformas: ${r.platforms.join(",") || "todas"}${r.supported ? "" : " (esta máquina não é atendida)"}`);
      console.log(`release: ${r.release ?? "-"}`);
      if (r.quarantined) { console.log(`quarentena: v${r.quarantined.version}`); }
      for (const w of r.warns) { console.log(`aviso: ${w}`); }
    }
    if (!r.ok) { process.exitCode = 1; }
  } else if (cmd === "path") {
    const r = await pathCommand(name);
    if (asJson) { console.log(JSON.stringify(r, null, 2)); }
    else if (!r.ok) { console.error(`FALHOU path ${name}: ${r.reason}`); }
    else { console.log(r.path); if (!["OK", "AUSENTE"].includes(r.pointer.state)) { console.error(`aviso: ponteiro cli.json ${r.pointer.state}: ${r.pointer.detail}`); } }
    if (!r.ok) { process.exitCode = 1; }
  } else if (cmd === "trust" && args.includes("--restaurar")) {
    const r = nomeOpcional || asJson ? { ok: false, reason: "--restaurar não combina com um motor nem com --json" } : trustRestoreCommand();
    if (r.ok) { console.log(`trust.json restaurado de ${r.file}.bak (motores: ${r.restored.join(", ") || "nenhum"}); confira com engine-kit trust`); }
    else { console.error(`FALHOU trust --restaurar: ${r.reason}`); process.exitCode = 1; }
  } else if (cmd === "trust") {
    const r = trustCommand(nomeOpcional);
    if (asJson) { console.log(JSON.stringify(r, null, 2)); }
    else {
      console.log(`${r.file}  (cópia .bak: ${r.backup.exists ? (r.backup.readable ? "legível" : "ILEGÍVEL") : "ausente"})`);
      if (!r.ok) { console.error(`FALHOU trust: ${r.reason}`); }
      for (const e of r.engines) { console.log(`  ${e.state.padEnd(15)} ${e.name}  chave ${e.publicKey ?? "(nenhuma)"}${e.source ? ` (${e.source}, ${e.firstSeen})` : ""}  maior versão ${e.maxVersion ?? "-"}  pin ${e.pin ?? "-"}${e.state === "CHAVE-DIFERENTE" ? `  embarcada ${e.embeddedKey}` : ""}`); }
    }
    if (!r.ok) { process.exitCode = 1; }
  } else if (cmd === "rollback") {
    const r = await rollbackCommand(name, { registryUrl: flag("--registry-url"), dryRun, log });
    done("rollback", r, () => { if (r.dryRun) { console.log(`PLANO ${name}: ${planoEm(r)}`); return avisoCache(r); } console.log(`motor revertido: ${name} v${r.previous} → v${r.version}; fixado em v${r.pinned} (engine-kit unpin ${name} volta a atualizar)`); avisoCache(r); });
  } else if (cmd === "export") {
    const r = exportCommand(nomeOpcional);
    if (!r.ok) { console.error(`FALHOU export: ${r.reason}`); process.exitCode = 1; }
    else {
      console.log(r.file ? `OK ${r.doc.engines.length} motor(es) exportado(s) para ${r.file}` : JSON.stringify(r.doc, null, 2));
      if (r.pinOmitido) { console.error(`aviso: pin omitido de ${r.pinOmitido.join(", ")}: o pin gravado é diferente da versão instalada`); }
    }
  } else if (cmd === "import" && name === "-" && process.stdin.isTTY) {
    console.error("import - lê o documento do stdin: use um pipe, ex.: engine-kit export | engine-kit import -");
    process.exitCode = 1;
  } else if (cmd === "import") {
    const r = await importCommand(name, { registryUrl: flag("--registry-url"), dryRun, permitirRebaixar: args.includes("--permitir-rebaixar"), log });
    if (!r.engines) { if (asJson) { console.log(JSON.stringify(jsonOf("import", name, r), null, 2)); } else { console.error(`FALHOU import: ${r.reason}`); } }
    else if (asJson) { console.log(JSON.stringify({ ok: r.ok, ...(r.dryRun ? { dryRun: true } : {}), engines: r.engines.map(([m, e]) => jsonOf("ensure", m, e)) }, null, 2)); }
    else {
      if (!r.engines.length) { console.log("nenhum motor no documento"); }
      for (const [m, e] of r.engines) {
        if (!e.ok) { console.error(`FALHOU ${m}: ${e.reason}`); }
        else { console.log(e.dryRun ? `PLANO ${m}: ${planoEm(e)}` : `OK ${m} v${e.version} (${e.reused ? "já instalado, reusado" : e.previous ? `atualizado de v${e.previous}` : "instalado"})${e.pinned ? `; fixado em v${e.pinned}` : ""}`); }
      }
    }
    if (!r.ok) { process.exitCode = 1; }
  } else if (cmd === "history") {
    const r = historyCommand(nomeOpcional);
    if (!r.ok) { console.error(`FALHOU history: ${r.reason}`); process.exitCode = 1; }
    else if (asJson) { console.log(JSON.stringify(r.entries, null, 2)); }
    else if (!r.entries.length) { console.log(`nenhuma troca registrada${nomeOpcional ? ` para ${nomeOpcional}` : ""}`); }
    else { for (const e of r.entries) { console.log(`${e.ts}  ${e.engine}  ${e.from ?? "(nenhuma)"} → ${e.to}  (${e.via})`); } }
  } else if (cmd === "unpin") {
    const l = todos ? fixados() : { ok: true, names: [name] };
    if (!l.ok) { console.error(`FALHOU unpin --todos: ${l.reason}`); process.exitCode = 1; }
    if (l.ok && todos && !l.names.length) { console.log("nenhum motor fixado"); }
    for (const m of l.ok ? l.names : []) {
      const r = unpinCommand(m);
      if (!r.ok) { console.error(`FALHOU ${m}: ${r.reason}`); process.exitCode = 1; }
      else { console.log(r.was ? `OK ${m} solto (estava fixado em v${r.was}); o próximo ensure traz a versão do registry` : `OK ${m} não estava fixado`); }
    }
  } else if (cmd === "stop") {
    const r = await stopCommand(name, { registryUrl: flag("--registry-url"), log });
    done("stop", r, () => { console.log(r.stopped ? `OK ${name} desligado` : `OK ${name}: nada vivo para desligar`); avisoCache(r); });
  } else if (cmd === "fetch") {
    const doc = deExport ? lerDocumento(flag("--de-export")) : null;
    if (doc && !doc.ok) {
      if (asJson) { console.log(JSON.stringify(jsonOf("fetch", flag("--de-export"), doc), null, 2)); } else { console.error(`FALHOU fetch --de-export: ${doc.reason}`); }
      process.exitCode = 1;
    } else {
      const pedido = { version: flag("--version"), registryUrl: flag("--registry-url"), destDir: flag("--dest"), comAssinaturas, soMotor: deExport, log };
      const alvos = doc ? doc.doc.engines.map((e) => [e.name, e.version]) : lista ? lista.names.map((m) => [m]) : (comAssinaturas ? motores : [name]).map((m) => [m]);
      if (!alvos.length) { log(doc ? "nenhum motor no documento" : "nenhum motor instalado por este kit para baixar"); }
      const rs = [];
      for (const [m, v] of alvos) { rs.push([m, await fetchCommand(m, v ? { ...pedido, version: v } : pedido)]); }
      const linhas = (m, r) => { for (const f of r.files) { console.log(`OK ${m} v${r.version} (${f.sidecar ? `${f.sidecar} conferido contra o artefato` : f.signed ? "assinatura Ed25519 conferida" : "SEM assinatura no registry"}), não instalado: ${f.path}`); } avisoCache(r, m); };
      if (!lista && !doc && motores.length < 2) { done("fetch", rs[0][1], () => linhas(name, rs[0][1])); }
      else {
        if (asJson) { console.log(JSON.stringify({ ok: rs.every(([, r]) => r.ok), engines: rs.map(([m, r]) => jsonOf("fetch", m, r)) }, null, 2)); }
        else { for (const [m, r] of rs) { if (r.ok) { linhas(m, r); } else { console.error(`FALHOU ${m}: ${r.reason}`); } } }
        if (rs.some(([, r]) => !r.ok)) { process.exitCode = 1; }
      }
    }
  } else if (cmd === "pin" && motores.length < 2 && !lista) {
    const r = await pinCommand(name, { version: flag("--version"), registryUrl: flag("--registry-url"), dryRun, log });
    done("pin", r, () => { if (r.dryRun) { console.log(`PLANO ${name}: ${planoEm(r)}`); return avisoCache(r); } console.log(`OK ${name} fixado em v${r.pinned}; a atualização automática pula este motor (engine-kit unpin ${name} solta)`); avisoCache(r); });
  } else if (motores.length > 1 || lista) {
    const rs = [];
    if (lista && !lista.names.length) { log(`nenhum motor instalado por este kit para ${cmd === "pin" ? "fixar" : "atualizar"}`); }
    for (const m of lista ? lista.names : motores) { rs.push([m, cmd === "pin" ? await pinCommand(m, { registryUrl: flag("--registry-url"), dryRun, log }) : await ensureCommand(m, { registryUrl: flag("--registry-url"), autoUpdate: autoUpdateEnabled(), dryRun, log })]); }
    if (asJson) { console.log(JSON.stringify({ ok: rs.every(([, r]) => r.ok), engines: rs.map(([m, r]) => jsonOf(cmd, m, r)) }, null, 2)); }
    else { for (const [m, r] of rs) { if (r.ok && r.dryRun) { console.log(`PLANO ${m}: ${planoEm(r)}`); avisosDoPlano(r); } else if (r.ok && cmd === "pin") { console.log(`OK ${m} fixado em v${r.pinned}`); } else if (r.ok) { console.log(`OK ${m} v${r.version} (${r.reused ? "já instalado, reusado" : r.previous ? `atualizado de v${r.previous}` : "instalado"}) em ${r.entryPath}`); } else { console.error(`FALHOU ${m}: ${r.reason}`); } } }
    if (rs.some(([, r]) => !r.ok || (falharSeDesatualizado && r.plan !== "reusar"))) { process.exitCode = 1; }
  } else {
    const autoUpdate = autoUpdateEnabled();
    const arquivo = flag("--de-arquivo"), pedido = { version: flag("--version"), registryUrl: flag("--registry-url"), autoUpdate, dryRun, log };
    const r = arquivo ? await ensureDeArquivo(name, arquivo, pedido) : await ensureCommand(name, pedido);
    if (falharSeDesatualizado && r.plan !== "reusar") { process.exitCode = 1; }
    if (asJson) { done("ensure", r); }
    else if (r.ok && r.dryRun) { console.log(`PLANO ${name}: ${planoEm(r)}`); avisoCache(r); avisosDoPlano(r); }
    else if (r.ok) {
      const how = r.reused ? "já instalado, reusado" : r.signed ? "assinatura Ed25519 conferida" : "SEM assinatura no registry";
      if (r.previous) { console.log(`motor atualizado: ${name} v${r.previous} → v${r.version}`); }
      console.log(`OK ${name} v${r.version} (${how}) em ${r.entryPath}`);
      avisoCache(r);
      if (r.pointer && !["OK", "AUSENTE"].includes(r.pointer.state)) { console.log(`aviso: ponteiro cli.json ${r.pointer.state}: ${r.pointer.detail}`); }
      if (r.pinned) { console.log(`fixado: ${name} fica em v${r.pinned} (engine-kit unpin ${name} volta a atualizar)`); }
      if (r.available) { console.log(`aviso: ${name} v${r.available} disponível; ENGINE_KIT_NO_AUTO_UPDATE ligado — rode sem ele para atualizar`); }
      if (args.includes("--register")) {
        try {
          const reg = await registerNeuralLink(r.entryPath);
          console.log(`OK neural-link: hooks registrados em ~/.copilot/hooks (${reg.written?.length ?? 0} gravado(s), ${reg.unchanged?.length ?? 0} já estava(m) em dia, ${reg.companions?.selados?.length ?? 0} companion(s) selado(s))`);
          if (reg.written?.length) { console.log(`  eventos gravados: ${reg.written.join(", ")}`); }
          if (reg.removed?.length) { console.log(`  eventos removidos: ${reg.removed.join(", ")}`); }
        } catch (e) { console.error(`FALHOU neural-link --register: ${e?.message || e}`); process.exitCode = 1; }
      } else if (args.includes("--unregister")) {
        try {
          const reg = await unregisterNeuralLink(r.entryPath);
          console.log(`OK neural-link: hooks desregistrados de ~/.copilot/hooks${reg?.removed?.length ? ` (eventos removidos: ${reg.removed.join(", ")})` : ""}`);
        } catch (e) { console.error(`FALHOU neural-link --unregister: ${e?.message || e}`); process.exitCode = 1; }
      } else if (name === "neural-link") { console.log("hooks não registrados: para registrá-los no config global rode `npx engine-kit ensure neural-link --register`"); }
      if (r.kind === "daemon" && !r.restarted) { console.log("daemon: quem sobe o motor é o consumidor (ensureEngine com healthCheck)."); }
    } else {
      console.error(`FALHOU ${name}: ${r.reason}`);
      process.exitCode = 1;
    }
  }
}
