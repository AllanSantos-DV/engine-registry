// Validador mínimo de JSON Schema para o manifest.json, sem dependência no pacote.
//
// Implementa só as palavras-chave que o schema.json usa. Palavra-chave fora dessa lista lança em vez de ser ignorada:
// um validador que pula o que não entende aprova manifest inválido em silêncio.
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const VALIDATING = new Set(['$ref', 'type', 'const', 'enum', 'pattern', 'format', 'minLength', 'minimum', 'minItems', 'items',
  'required', 'properties', 'additionalProperties', 'allOf', 'anyOf', 'if', 'then', 'not']);
const FORMATS = { uri: (v) => URL.canParse(v) };
const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'definitions', 'default', 'examples']);

/** Lê o schema.json do repositório (ou de `file`). */
export const loadSchema = (file = path.join(ROOT, 'schema.json')) => JSON.parse(readFileSync(file, 'utf8'));

/**
 * Erros de `value` contra `node` (lista vazia = válido).
 * @param {object} schema raiz, para resolver `$ref`
 * @throws {Error} quando o schema usa uma palavra-chave que este validador não implementa
 */
export function validate(schema, node, value, at = '$') {
  const unknown = Object.keys(node).filter((k) => !VALIDATING.has(k) && !ANNOTATIONS.has(k));
  if (unknown.length) throw new Error(`schema usa palavra-chave não suportada pelo validador em ${at}: ${unknown.join(', ')}`);
  if (node.$ref) return validate(schema, node.$ref.split('/').slice(1).reduce((o, k) => o[k], schema), value, at);
  const errs = [];
  const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v);
  if (node.type) {
    const t = typeOf(value);
    if (!(node.type === t || (node.type === 'number' && t === 'integer'))) return [`${at}: esperado ${node.type}, veio ${t}`];
  }
  if ('const' in node && value !== node.const) errs.push(`${at}: esperado ${JSON.stringify(node.const)}`);
  if (node.enum && !node.enum.includes(value)) errs.push(`${at}: fora do enum`);
  if (node.pattern && typeof value === 'string' && !new RegExp(node.pattern).test(value)) errs.push(`${at}: não casa ${node.pattern}`);
  if (node.format && typeof value === 'string') {
    if (!FORMATS[node.format]) throw new Error(`schema usa format não suportado pelo validador em ${at}: ${node.format}`);
    if (!FORMATS[node.format](value)) errs.push(`${at}: não é ${node.format}`);
  }
  if (node.minLength !== undefined && typeof value === 'string' && value.length < node.minLength) errs.push(`${at}: menos de ${node.minLength} caracteres`);
  if (node.minimum !== undefined && typeof value === 'number' && value < node.minimum) errs.push(`${at}: < ${node.minimum}`);
  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) errs.push(`${at}: menos de ${node.minItems} itens`);
    if (node.items) value.forEach((v, i) => errs.push(...validate(schema, node.items, v, `${at}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    for (const k of node.required ?? []) if (!(k in value)) errs.push(`${at}: falta "${k}"`);
    for (const [k, v] of Object.entries(value)) {
      if (node.properties?.[k]) errs.push(...validate(schema, node.properties[k], v, `${at}.${k}`));
      else if (node.additionalProperties === false) errs.push(`${at}: campo desconhecido "${k}"`);
    }
  }
  for (const sub of node.allOf ?? []) errs.push(...validate(schema, sub, value, at));
  if (node.anyOf && !node.anyOf.some((sub) => validate(schema, sub, value, at).length === 0)) errs.push(`${at}: não casa nenhum 'anyOf'`);
  if (node.if && validate(schema, node.if, value, at).length === 0 && node.then) errs.push(...validate(schema, node.then, value, at));
  if (node.not && validate(schema, node.not, value, at).length === 0) errs.push(`${at}: casou o 'not'`);
  return errs;
}

/** Erros do manifest inteiro contra o schema (lista vazia = válido). */
export const manifestErrors = (manifest, schema = loadSchema()) => validate(schema, schema, manifest);
