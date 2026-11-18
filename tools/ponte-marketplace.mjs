#!/usr/bin/env node
/**
 * Critério de remoção da ponte (CONTRATO-MOTOR §7): a URL antiga dos motores não pode mais aparecer nos repositórios do dono. Pergunta ao `gh`
 * (busca de código da conta autenticada) onde `<dono>/copilot-marketplace/releases` e `<dono>/neural-link-runtime` ainda aparecem e lista o que falta migrar.
 *
 *   node tools/ponte-marketplace.mjs [--owner <login>] [--exclude <repo>]... [--json]
 *
 * A documentação do próprio repositório apontado pela URL (README* na raiz, docs/) não conta como consumidor; o relatório diz quantos arquivos ignorou assim.
 * Exit 0 = nenhuma ocorrência (a ponte pode sair); 1 = ainda falta migrar; 2 = não deu para consultar ou concluir (gh ausente, limite de uso, busca incompleta ou
 * truncada): nunca é lido como "vazio". O `gh` roda com GH_TOKEN e GITHUB_TOKEN vazios, para valer a conta do keyring; nenhum token é lido nem impresso.
 * Limite da fonte: a busca do GitHub cobre só a branch padrão, ignora arquivos grandes e indexa com atraso; o exit 0 prova a ausência no índice, não nos clones.
 */
import { fileURLToPath } from 'node:url';
import { ghApi, scrub } from './actions-minutes.mjs';

/** Trechos das URLs antigas, depois de `<dono>/`: a release do marketplace (o catálogo de plugins do mesmo repositório não é a ponte) e o repositório do neural-link. */
export const OLD_URLS = ['copilot-marketplace/releases', 'neural-link-runtime'];
const DOCUMENTA_A_PONTE = ['engine-registry'];
const DOCUMENTACAO = /^(README[^/]*|docs\/.+)$/i;
const PER_PAGE = 100;
const MAX_PAGES = 10;
const TEXT_MATCH = 'Accept: application/vnd.github.text-match+json';

/** Todos os resultados de uma busca de código, página a página; lança se a busca não puder provar que acabou. */
async function searchAll(api, owner, needle) {
  const q = encodeURIComponent(`"${needle}" user:${owner}`);
  const items = [];
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await api(`search/code?q=${q}&per_page=${PER_PAGE}&page=${page}`, { headers: [TEXT_MATCH] });
    if (r.incomplete_results) throw new Error(`busca incompleta (incomplete_results) para ${needle}: o GitHub não varreu tudo; repita mais tarde`);
    total = r.total_count ?? 0;
    items.push(...(r.items ?? []));
    if (items.length >= total || (r.items ?? []).length < PER_PAGE) break;
  }
  if (items.length < total) throw new Error(`resultado truncado para ${needle}: a busca entrega ${items.length} de ${total} resultados (mais resultados do que o limite); não dá para provar que acabou`);
  return items;
}

/**
 * Procura as URLs antigas nos repositórios do dono. A busca é por palavras, então cada resultado só vale se o trecho devolvido traz a URL literal.
 * Auto-referência (README* na raiz ou arquivo sob docs/ do próprio repositório que a URL aponta) não é consumidor: fica fora da lista e entra em `ignoredSelf`.
 * @param {{owner?: string, exclude?: string[], api?: Function}} opts `owner` ausente = login do `gh`; `api(path, {headers})` é injetável (testes).
 * @returns {Promise<{owner: string, excluded: string[], needles: string[], found: {repo: string, path: string, url: string, needle: string}[], pending: number, ignoredSelf: number}>}
 */
export async function collect({ owner, exclude = [], api = ghApi }) {
  owner ??= (await api('user')).login;
  if (typeof owner !== 'string' || !owner) throw new Error('não descobri o login do gh (gh api user): rode `gh auth login` ou passe --owner');
  const excluded = [...DOCUMENTA_A_PONTE, ...exclude];
  const needles = OLD_URLS.map((u) => `${owner}/${u}`);
  const found = new Map();
  const ignored = new Set();
  for (const needle of needles) {
    const self = needle.split('/')[1].toLowerCase();
    for (const item of await searchAll(api, owner, needle)) {
      const repo = item.repository.full_name.split('/').pop();
      const confirmed = !item.text_matches?.length || item.text_matches.some((m) => String(m.fragment).toLowerCase().includes(needle.toLowerCase()));
      if (!confirmed || excluded.includes(repo) || excluded.includes(item.repository.full_name)) continue;
      const key = `${repo}|${item.path}|${needle}`;
      if (repo.toLowerCase() === self && DOCUMENTACAO.test(item.path)) ignored.add(key);
      else found.set(key, { repo, path: item.path, url: item.html_url, needle });
    }
  }
  return { owner, excluded, needles, found: [...found.values()], pending: found.size, ignoredSelf: ignored.size };
}

/** Lê `--json`, `--owner <login>` e `--exclude <repo>` (repetível); lança em opção desconhecida ou sem valor. */
function parseArgs(argv) {
  const o = { json: false, owner: undefined, exclude: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--owner' || a === '--exclude') {
      const v = argv[++i];
      if (!v || v.startsWith('-')) throw new Error(`${a} precisa de um valor`);
      if (a === '--owner') o.owner = v; else o.exclude.push(v);
    } else throw new Error(`opção desconhecida: ${a}`);
  }
  return o;
}

/** Texto para o terminal. */
export function render(r) {
  const lines = [`Ponte do marketplace — dono ${r.owner}; URLs antigas: ${r.needles.join(', ')}; fora da busca: ${r.excluded.join(', ')}`,
    `${r.ignoredSelf} arquivo(s) ignorado(s) como auto-referência (README* na raiz ou docs/ do próprio repositório da URL antiga).`];
  if (!r.pending) {
    lines.push('nada falta migrar: nenhuma ocorrência da URL antiga no índice de busca do GitHub (só a branch padrão; a indexação pode atrasar).');
    return lines.join('\n');
  }
  for (const f of r.found) lines.push(`  ${f.repo}  ${f.path}  (${f.needle})  ${f.url}`);
  lines.push(`falta migrar: ${r.pending} arquivo(s) em ${new Set(r.found.map((f) => f.repo)).size} repositório(s).`);
  return lines.join('\n');
}

/** Roda a busca e imprime o relatório. @returns {Promise<number>} o exit code (0, 1 ou 2) */
export async function run(argv, { api = ghApi, log = console.log, error = console.error } = {}) {
  try {
    const opts = parseArgs(argv);
    const r = await collect({ ...opts, api });
    log(opts.json ? JSON.stringify(r, null, 2) : render(r));
    return r.pending ? 1 : 0;
  } catch (e) {
    error(`FALHOU: ${scrub(e.message)}`);
    return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await run(process.argv.slice(2));
