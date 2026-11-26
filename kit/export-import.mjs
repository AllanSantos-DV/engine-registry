// engine-kit/export-import.mjs — `engine-kit export [arquivo]` e `engine-kit import <arquivo>`: leva os motores instalados de uma máquina para outra.
//
// O documento diz QUAIS motores e QUE versão (mais o pin e a versão do kit), e só isso: nenhuma chave, assinatura, caminho, usuário ou máquina.
// Quem confere o que chega é o `ensureCommand` da máquina de destino (sha256, Ed25519 e a chave do manifest embarcado), como em qualquer instalação.
// NUNCA lança: devolve { ok, reason }.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { ensureCommand, embarcado, listCommand, pinCommand, pinDaInstalacao, semDuplicados } from "./ensure.mjs";
import { cmpVer, dropFile, readTrust } from "./trust.mjs";
import { ownVersion } from "./update.mjs";

const FORMATO = 1;
const VERSAO = /^\d+\.\d+\.\d+$/;
const NOME = /^[a-z0-9][a-z0-9._-]*$/;
const PLANO_COM_PIN = { reusar: "fixar", atualizar: "trocar-e-fixar", instalar: "instalar-e-fixar" };
const objeto = (o) => o !== null && typeof o === "object" && !Array.isArray(o);

/**
 * Confere o formato do documento: só as chaves conhecidas, cada valor no formato esperado. Chave estranha (inclusive `__proto__`) é recusada,
 * então nada do documento chega a um objeto que o kit use. Nunca lança.
 * @param {unknown} doc o JSON lido.
 * @returns {{ok:true} | {ok:false, reason:string}}
 */
export function validarDocumento(doc) {
  const falha = (reason) => ({ ok: false, reason: `documento inválido: ${reason}` });
  const estranha = (o, chaves) => Object.keys(o).find((k) => !chaves.includes(k));
  if (!objeto(doc)) { return falha("a raiz precisa ser um objeto"); }
  const x = estranha(doc, ["formato", "kit", "engines"]);
  if (x !== undefined) { return falha(`chave desconhecida "${x}"`); }
  if (doc.formato !== FORMATO) { return falha(`formato ${JSON.stringify(doc.formato)}: este kit lê o formato ${FORMATO}`); }
  if (typeof doc.kit !== "string" || !/^\d+\.\d+\.\d+([-+][\w.+-]*)?$/.test(doc.kit)) { return falha("kit precisa ser a versão do engine-kit que exportou"); }
  if (!Array.isArray(doc.engines)) { return falha("engines precisa ser uma lista"); }
  const nomes = new Set();
  for (const [i, e] of doc.engines.entries()) {
    const onde = `engines[${i}]`;
    if (!objeto(e)) { return falha(`${onde} precisa ser um objeto`); }
    const y = estranha(e, ["name", "version", "pin"]);
    if (y !== undefined) { return falha(`${onde}: chave desconhecida "${y}"`); }
    if (typeof e.name !== "string" || !NOME.test(e.name)) { return falha(`${onde}.name precisa ser um nome de motor (minúsculas, números, ponto, hífen)`); }
    if (nomes.has(e.name)) { return falha(`${onde}.name repetido: ${e.name}`); }
    nomes.add(e.name);
    for (const campo of ["version", ...("pin" in e ? ["pin"] : [])]) {
      if (typeof e[campo] !== "string" || !VERSAO.test(e[campo])) { return falha(`${onde}.${campo} precisa ser x.y.z, recebi ${JSON.stringify(e[campo])?.slice(0, 40)} (${e.name})`); }
    }
    if (e.pin !== undefined && e.pin !== e.version) { return falha(`${onde}.pin (${e.pin}) precisa ser a versão do motor (${e.version}) (${e.name})`); }
  }
  return { ok: true };
}

/**
 * Lê o documento do `export` (`-` = entrada padrão) e o confere com `validarDocumento`. Nunca lança.
 * @param {string} file caminho do documento.
 * @returns {{ok:true, doc:object} | {ok:false, reason:string}}
 */
export function lerDocumento(file) {
  let doc;
  try { doc = JSON.parse(readFileSync(file === "-" ? 0 : file, "utf8")); } catch (e) { return { ok: false, reason: `não consegui ler ${file === "-" ? "a entrada padrão" : file}: ${e.message}` }; }
  const v = validarDocumento(doc);
  return v.ok ? { ok: true, doc } : v;
}

/**
 * `engine-kit export [arquivo]`: o documento com, por motor instalado aqui, nome, versão instalada e pin do `trust.json`, mais a versão do kit.
 * Com `file`, grava por .part e rename; sem ele, só devolve o documento. Não usa rede. O documento sai pelo mesmo validador do `import`.
 * O pin diferente da versão instalada não entra no documento (ele só descreve o que instala) e o motor aparece em `pinOmitido`.
 * @param {string=} file onde gravar.
 * @param {{bundled?:object}=} opts `bundled` = manifest embarcado (testes).
 * @returns {{ok:true, doc:{formato:number, kit:string, engines:{name:string, version:string, pin?:string}[]}, file?:string, pinOmitido?:string[]} | {ok:false, reason:string}}
 */
export function exportCommand(file, { bundled } = {}) {
  const l = listCommand({ bundled });
  if (!l.ok) { return l; }
  let engines;
  const pinOmitido = [];
  try {
    const { local } = embarcado(bundled), unicos = semDuplicados(local, l.engines.filter((e) => e.installed).map((e) => e.name), l.platform);
    engines = l.engines.filter((e) => unicos.includes(e.name)).map((e) => {
      const { pin } = pinDaInstalacao(local, e.name, l.platform);
      if (pin && pin !== e.installed) { pinOmitido.push(e.name); }
      return { name: e.name, version: e.installed, ...(pin && pin === e.installed ? { pin } : {}) };
    });
  } catch (e) { return { ok: false, reason: e.message }; }
  const doc = { formato: FORMATO, kit: ownVersion(), engines };
  const v = validarDocumento(doc);
  if (!v.ok) { return { ok: false, reason: `${v.reason} (a exportação recusa o que o import recusaria)` }; }
  if (file) {
    try { writeFileSync(`${file}.part`, `${JSON.stringify(doc, null, 2)}\n`); renameSync(`${file}.part`, file); }
    catch (e) { dropFile(`${file}.part`); return { ok: false, reason: `não consegui gravar ${file}: ${e.message}` }; }
  }
  return { ok: true, doc, ...(file ? { file } : {}), ...(pinOmitido.length ? { pinOmitido } : {}) };
}

/**
 * `engine-kit import <arquivo|-> [--dry-run]`: instala, pelo `ensureCommand` com `version`, a versão registrada de cada motor do documento (sha256, Ed25519 e chave do
 * manifest embarcado como em qualquer instalação) e, se havia pin, fixa depois pelo `pinCommand`. Documento inválido é recusado inteiro, antes de instalar qualquer coisa;
 * a partir daí um motor recusado (desconhecido, sem build para a plataforma, versão ausente, artefato adulterado, pin local diferente) não impede os outros.
 * Versão abaixo da maior entre a instalada e a maior já vista no `trust.json` é recusada sem `permitirRebaixar`. Se o ensure instalou mas o daemon não subiu, o pin do documento é gravado
 * mesmo assim e a razão (ok:false) diz se foi aplicado.
 * Com `dryRun` devolve o plano do `ensure --dry-run` (com `fixar` quando havia pin), sem baixar, instalar nem fixar.
 * @param {string} file documento do `export`; `-` lê a entrada padrão.
 * @param {object=} opts as do `ensureCommand`, menos `version`.
 * @returns {Promise<{ok:boolean, dryRun?:true, engines:[string, object][]} | {ok:false, reason:string}>} `engines` traz, na ordem do documento, o retorno do ensure de cada motor (com `pinned` se fixou).
 */
export async function importCommand(file, opts = {}) {
  const lido = lerDocumento(file);
  if (!lido.ok) { return lido; }
  const { doc } = lido;
  const engines = [];
  const l = listCommand({ bundled: opts.bundled });
  const aqui = new Map(l.ok ? l.engines.map((e) => [e.name, e.installed]) : []);
  for (const { name, version, pin } of doc.engines) {
    const inst = aqui.get(name);
    let max;
    try { max = readTrust()[name]?.maxVersion; } catch (e) { engines.push([name, { ok: false, reason: e.message }]); continue; }
    const ref = max && (!inst || cmpVer(max, inst) > 0) ? max : inst;
    if (ref && version !== inst && cmpVer(version, ref) < 0 && !opts.permitirRebaixar) {
      engines.push([name, { ok: false, reason: `${name}: o documento pede v${version}, abaixo da v${ref} já instalada → rebaixar exige --permitir-rebaixar` }]);
      continue;
    }
    let r = await ensureCommand(name, { ...opts, version });
    if (r.ok && pin && opts.dryRun) { r = { ...r, plan: PLANO_COM_PIN[r.plan], pinned: pin }; }
    else if (pin && (r.ok || r.entryPath)) {
      const p = await pinCommand(name, opts);
      if (!r.ok) { r = { ...r, reason: `${r.reason}; ${p.ok ? `pin v${p.pinned} aplicado` : `pin NÃO aplicado: ${p.reason}`}` }; }
      else { r = p.ok ? { ...r, pinned: p.pinned } : { ok: false, reason: `${name} v${version} instalado, mas não fixou: ${p.reason}` }; }
    }
    engines.push([name, r]);
  }
  return { ok: engines.every(([, r]) => r.ok), ...(opts.dryRun ? { dryRun: true } : {}), engines };
}
