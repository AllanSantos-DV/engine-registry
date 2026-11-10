#!/usr/bin/env node
/**
 * Visão de leitura dos minutos do GitHub Actions da conta autenticada no `gh`: minutos faturados por repositório (API de
 * billing do ciclo), por workflow (tempo faturável de cada run recente), os maiores consumidores e os jobs que nem
 * iniciaram por cobrança.
 *
 *   node tools/actions-minutes.mjs [--month AAAA-MM] [--days N] [--top N] [--json]
 *
 * Só chama GET na API; nenhum token é lido, impresso ou repassado: o `gh` roda com GH_TOKEN e GITHUB_TOKEN vazios, para
 * valer a conta do keyring, e qualquer texto de erro passa por `scrub` antes de sair. Exit 0 = leitura completa; 1 = a
 * leitura do billing falhou; 2 = o billing veio, mas alguma consulta por repositório falhou (listada no fim).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BILLING_RE = /recent account payments have failed|spending limit needs to be increased/i;
const TOKEN_RE = /(gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{10,})/g;
const REPO_SHARE = 0.2;
const WORKFLOW_SHARE = 0.25;
const CONCURRENCY = 6;

export class ActionsMinutesError extends Error {}

/** Troca qualquer token reconhecível por [oculto]. */
export function scrub(text) {
  return String(text).replace(TOKEN_RE, '[oculto]');
}

/** Soma os itens de Actions em minutos por repositório e SKU, com o valor bruto, o desconto e o líquido em dólar. */
export function summarizeUsage(items) {
  const rows = new Map();
  const total = { minutes: 0, gross: 0, discount: 0, net: 0 };
  for (const item of items) {
    if (item.product !== 'actions' || item.unitType !== 'Minutes') continue;
    const repo = item.repositoryName || '(sem repositório)';
    const row = rows.get(repo) ?? { repo, minutes: 0, gross: 0, bySku: {} };
    row.minutes += item.quantity;
    row.gross += item.grossAmount;
    row.bySku[item.sku] = (row.bySku[item.sku] ?? 0) + item.quantity;
    rows.set(repo, row);
    total.minutes += item.quantity;
    total.gross += item.grossAmount;
    total.discount += item.discountAmount;
    total.net += item.netAmount;
  }
  const ranked = [...rows.values()].sort((a, b) => b.gross - a.gross);
  return { ranked, total };
}

/** Repositórios que sozinhos passam de REPO_SHARE do bruto em dólar. */
export function flagRepos(ranked, total) {
  return ranked.filter((r) => total.gross > 0 && r.gross / total.gross >= REPO_SHARE).map((r) => r.repo);
}

/** SO de cobrança de um job pelos rótulos do runner; self-hosted não é faturado. */
function osOf(labels) {
  const l = (labels ?? []).map((x) => x.toLowerCase());
  if (l.includes('self-hosted')) return 'SELF-HOSTED';
  if (l.some((x) => x.startsWith('windows'))) return 'WINDOWS';
  if (l.some((x) => x.startsWith('macos'))) return 'MACOS';
  return 'UBUNTU';
}

/**
 * Minutos faturáveis de um run: cada job que rodou é arredondado para cima ao minuto, por SO. Vem da lista de jobs porque
 * o `runs/<id>/timing` devolve tempo zerado na plataforma de billing atual.
 */
export function billedMinutes(jobs) {
  const byOs = {};
  for (const job of jobs ?? []) {
    const ms = Date.parse(job.completed_at) - Date.parse(job.started_at);
    if (!(ms > 0)) continue;
    const os = osOf(job.labels);
    byOs[os] = (byOs[os] ?? 0) + (os === 'SELF-HOSTED' ? 0 : Math.ceil(ms / 60000));
  }
  return byOs;
}

/** Agrupa runs já medidos por repositório e workflow, com contagem por evento e retentativas. */
export function rankWorkflows(measured) {
  const groups = new Map();
  for (const run of measured) {
    const key = `${run.repo} | ${run.name}`;
    const g = groups.get(key) ?? { repo: run.repo, workflow: run.name, runs: 0, minutes: 0, byOs: {}, events: {}, reruns: 0 };
    g.runs += 1;
    g.events[run.event] = (g.events[run.event] ?? 0) + 1;
    if (run.attempt > 1) g.reruns += 1;
    for (const [os, min] of Object.entries(run.byOs)) {
      g.minutes += min;
      g.byOs[os] = (g.byOs[os] ?? 0) + min;
    }
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.minutes - a.minutes);
}

/** Workflows que passam de WORKFLOW_SHARE dos minutos medidos. */
export function flagWorkflows(ranked) {
  const total = ranked.reduce((s, g) => s + g.minutes, 0);
  return ranked.filter((g) => total > 0 && g.minutes / total >= WORKFLOW_SHARE).map((g) => `${g.repo} | ${g.workflow}`);
}

/** Resume as anotações "job não iniciado por cobrança": quantidade, primeiro e último instante por repositório. */
export function summarizeBilling(found) {
  const byRepo = new Map();
  for (const f of found) {
    const e = byRepo.get(f.repo) ?? { repo: f.repo, jobs: 0, first: f.at, last: f.at };
    e.jobs += 1;
    if (f.at < e.first) e.first = f.at;
    if (f.at > e.last) e.last = f.at;
    byRepo.set(f.repo, e);
  }
  return [...byRepo.values()].sort((a, b) => b.last.localeCompare(a.last));
}

/** `gh api <caminho>` com os tokens do ambiente zerados; devolve o JSON ou lança com a saída já limpa de tokens. */
export function ghApi(path) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', ['api', path], {
      windowsHide: true,
      env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => reject(new ActionsMinutesError(`gh não executou: ${scrub(e.message)}`)));
    child.on('close', (code) => {
      if (code !== 0) return reject(new ActionsMinutesError(`gh api ${path} (código ${code}): ${scrub(err || out).trim().slice(0, 300)}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(new ActionsMinutesError(`resposta de ${path} não é JSON: ${scrub(e.message)}`)); }
    });
  });
}

/** Roda fn sobre os itens com no máximo `limit` chamadas em voo; falhas vão para `errors` sem derrubar as demais. */
async function pool(items, limit, errors, fn) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try { results.push(await fn(item)); } catch (e) { errors.push(e.message); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Coleta tudo. `api` é injetável para o teste. */
export async function collect({ month, days, top, api = ghApi, now = new Date() }) {
  const errors = [];
  const account = (await api('user')).login;
  const [year, mon] = month.split('-');
  const usage = await api(`users/${account}/settings/billing/usage?year=${Number(year)}&month=${Number(mon)}`);
  const { ranked, total } = summarizeUsage(usage.usageItems ?? []);
  const since = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);

  const runLists = await pool(ranked.map((r) => r.repo).filter((r) => r !== '(sem repositório)'), CONCURRENCY, errors, async (repo) => {
    const data = await api(`repos/${account}/${repo}/actions/runs?created=%3E%3D${since}&per_page=100`);
    return { repo, runs: data.workflow_runs ?? [] };
  });

  const topRepos = new Set(ranked.slice(0, top).map((r) => r.repo));
  const toMeasure = runLists.filter((l) => topRepos.has(l.repo)).flatMap((l) => l.runs.map((r) => ({ repo: l.repo, run: r })));
  const measured = await pool(toMeasure, CONCURRENCY, errors, async ({ repo, run }) => {
    const jobs = (await api(`repos/${account}/${repo}/actions/runs/${run.id}/jobs?per_page=100`)).jobs ?? [];
    return { repo, name: run.name, event: run.event, attempt: run.run_attempt, byOs: billedMinutes(jobs) };
  });

  const failures = runLists.flatMap((l) => l.runs
    .filter((r) => r.conclusion === 'failure')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 3)
    .map((r) => ({ repo: l.repo, run: r })));
  const billing = [];
  await pool(failures, CONCURRENCY, errors, async ({ repo, run }) => {
    const jobs = (await api(`repos/${account}/${repo}/actions/runs/${run.id}/jobs`)).jobs ?? [];
    for (const job of jobs.filter((j) => (j.steps ?? []).length === 0)) {
      const notes = await api(`repos/${account}/${repo}/check-runs/${job.id}/annotations`);
      if (notes.some((n) => BILLING_RE.test(n.message ?? ''))) billing.push({ repo, at: run.created_at });
    }
  });

  const workflows = rankWorkflows(measured);
  if (measured.length > 0 && workflows.every((w) => w.minutes === 0)) {
    errors.push('os ' + measured.length + ' runs medidos deram 0 minuto faturável: a API de jobs devolveu tempos vazios ou só runners self-hosted');
  }
  return {
    account, month, days, runsListed: runLists.reduce((s, l) => s + l.runs.length, 0), runsMeasured: measured.length,
    usage: { ranked, total, flaggedRepos: flagRepos(ranked, total) },
    workflows, flaggedWorkflows: flagWorkflows(workflows),
    billingBlock: summarizeBilling(billing), errors,
  };
}

const fmt = (n) => (Math.round(n * 10) / 10).toString();

/** Texto para o terminal. */
export function render(r) {
  const lines = [];
  const t = r.usage.total;
  lines.push(`Conta ${r.account}, ciclo ${r.month}: ${fmt(t.minutes)} min brutos, bruto US$ ${t.gross.toFixed(2)}, desconto US$ ${t.discount.toFixed(2)}, líquido US$ ${t.net.toFixed(2)}`);
  if (t.net > 0) lines.push('ATENÇÃO: há valor líquido a pagar neste ciclo.');
  lines.push('', 'Por repositório (bruto em dólar, minutos por SKU):');
  for (const row of r.usage.ranked.slice(0, 15)) {
    const flag = r.usage.flaggedRepos.includes(row.repo) ? '  <== MAIOR CONSUMIDOR' : '';
    const skus = Object.entries(row.bySku).map(([s, m]) => `${s.replace('Actions ', '')} ${fmt(m)}`).join(', ');
    lines.push(`  US$ ${row.gross.toFixed(2).padStart(6)}  ${row.repo}  (${skus})${flag}`);
  }
  lines.push('', `Por workflow, últimos ${r.days} dia(s), ${r.runsMeasured} run(s) medido(s) dos maiores repositórios (min faturáveis, job arredondado ao minuto; self-hosted não conta):`);
  for (const g of r.workflows.slice(0, 12)) {
    const flag = r.flaggedWorkflows.includes(`${g.repo} | ${g.workflow}`) ? '  <== MAIOR CONSUMIDOR' : '';
    const os = Object.entries(g.byOs).map(([k, m]) => `${k} ${m}`).join(', ');
    lines.push(`  ${String(g.minutes).padStart(5)} min  ${String(g.runs).padStart(4)} runs  ${g.repo} | ${g.workflow}  [${os}] eventos ${JSON.stringify(g.events)} retentativas ${g.reruns}${flag}`);
  }
  lines.push('', 'Jobs que não iniciaram por cobrança (pagamento falhou ou limite de gasto):');
  if (r.billingBlock.length === 0) lines.push('  nenhum encontrado nas falhas recentes');
  for (const b of r.billingBlock) lines.push(`  ${b.repo}: ${b.jobs} job(s), de ${b.first} a ${b.last}`);
  if (r.errors.length) {
    lines.push('', `ERROS (${r.errors.length}), leitura incompleta:`);
    for (const e of r.errors.slice(0, 10)) lines.push(`  ${e}`);
  }
  return lines.join('\n');
}

/** Lê e valida as opções (--month, --days, --top, --json); lança ActionsMinutesError em valor inválido ou opção desconhecida. */
function parseArgs(argv) {
  const now = new Date();
  const o = { month: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`, days: 3, top: 5, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--month') o.month = argv[++i] ?? '';
    else if (a === '--days') o.days = Number(argv[++i]);
    else if (a === '--top') o.top = Number(argv[++i]);
    else throw new ActionsMinutesError(`opção desconhecida: ${a}`);
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(o.month)) throw new ActionsMinutesError(`--month inválido: "${o.month}" (esperado AAAA-MM)`);
  if (!Number.isInteger(o.days) || o.days < 1 || o.days > 30) throw new ActionsMinutesError('--days deve ser um inteiro de 1 a 30');
  if (!Number.isInteger(o.top) || o.top < 1 || o.top > 20) throw new ActionsMinutesError('--top deve ser um inteiro de 1 a 20');
  return o;
}

/** Roda a coleta e imprime o relatório. @returns {Promise<number>} o exit code (0, 1 ou 2) */
async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`FALHOU: ${e.message}`); return 1; }
  let report;
  try { report = await collect(opts); } catch (e) { console.error(`FALHOU: ${scrub(e.message)}`); return 1; }
  console.log(opts.json ? JSON.stringify(report, null, 2) : render(report));
  return report.errors.length ? 2 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();
