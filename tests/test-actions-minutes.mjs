// test-actions-minutes.mjs — a visão de minutos do Actions (tools/actions-minutes.mjs) agrega o billing por repositório,
// mede workflows pelo tempo faturável por job, aponta os maiores consumidores e os jobs bloqueados por cobrança, e não
// vaza token. Só com a API injetada: o gh real nunca é chamado.
import {
  scrub, summarizeUsage, flagRepos, billedMinutes, rankWorkflows, flagWorkflows, summarizeBilling, collect, render,
} from '../tools/actions-minutes.mjs';

let falhas = 0;
const check = (nome, ok, detalhe = '') => { console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${nome}${ok ? '' : ` ${detalhe}`}`); if (!ok) falhas++; };

const item = (repo, sku, quantity, gross, extra = {}) => ({
  product: 'actions', unitType: 'Minutes', repositoryName: repo, sku, quantity, grossAmount: gross, discountAmount: gross, netAmount: 0, ...extra,
});

console.log('== actions-minutes ==');

{
  const { ranked, total } = summarizeUsage([
    item('grande', 'Actions Linux', 600, 3.6), item('grande', 'Actions Windows', 100, 1.0), item('pequeno', 'Actions Linux', 50, 0.3),
    { product: 'copilot', unitType: 'Minutes', repositoryName: 'ignorado', sku: 'x', quantity: 999, grossAmount: 99, discountAmount: 0, netAmount: 0 },
    { ...item('bytes', 'Actions Storage', 5, 0.1), unitType: 'GigabyteHours' },
  ]);
  check('soma só minutos de Actions, por repositório e SKU', ranked.length === 2 && ranked[0].repo === 'grande'
    && ranked[0].minutes === 700 && ranked[0].bySku['Actions Windows'] === 100 && total.minutes === 750, JSON.stringify(ranked));
  check('ordena pelo bruto em dólar', ranked[0].gross > ranked[1].gross);
  check('aponta como maior consumidor o repositório com 20% ou mais do bruto', JSON.stringify(flagRepos(ranked, total)) === '["grande"]');
}

{
  const at = (s) => `2026-11-10T10:00:${String(s).padStart(2, '0')}Z`;
  const job = (labels, start, endMs) => ({ labels, started_at: at(start), completed_at: new Date(Date.parse(at(start)) + endMs).toISOString() });
  const m = billedMinutes([job(['ubuntu-latest'], 0, 20000), job(['ubuntu-latest'], 0, 61000), job(['windows-latest'], 0, 600000), job(['macos-latest'], 0, 5000)]);
  check('arredonda cada job para cima ao minuto, por SO', m.UBUNTU === 3 && m.WINDOWS === 10 && m.MACOS === 1, JSON.stringify(m));
  check('job de runner self-hosted não é faturado', billedMinutes([job(['self-hosted', 'Linux'], 0, 300000)])['SELF-HOSTED'] === 0);
  check('job que não rodou (sem início ou sem fim) não conta', Object.keys(billedMinutes([{ labels: ['ubuntu-latest'], started_at: null, completed_at: null }])).length === 0);
  check('run sem jobs devolve vazio', Object.keys(billedMinutes([])).length === 0);
}

{
  const ranked = rankWorkflows([
    { repo: 'a', name: 'CI', event: 'push', attempt: 1, byOs: { UBUNTU: 9 } },
    { repo: 'a', name: 'CI', event: 'pull_request', attempt: 2, byOs: { UBUNTU: 9, WINDOWS: 3 } },
    { repo: 'a', name: 'Docs', event: 'push', attempt: 1, byOs: { UBUNTU: 1 } },
  ]);
  check('agrupa por repositório e workflow, soma minutos e conta eventos e retentativas',
    ranked[0].workflow === 'CI' && ranked[0].minutes === 21 && ranked[0].runs === 2 && ranked[0].reruns === 1
    && ranked[0].events.push === 1 && ranked[0].events.pull_request === 1, JSON.stringify(ranked[0]));
  check('aponta o workflow com 25% ou mais dos minutos medidos', JSON.stringify(flagWorkflows(ranked)) === '["a | CI"]');
}

{
  const s = summarizeBilling([{ repo: 'r', at: '2026-11-10T14:48:00Z' }, { repo: 'r', at: '2026-11-10T18:00:00Z' }, { repo: 'q', at: '2026-11-10T10:00:00Z' }]);
  check('resume o bloqueio por cobrança: jobs, primeiro e último instante', s[0].repo === 'r' && s[0].jobs === 2
    && s[0].first === '2026-11-10T14:48:00Z' && s[0].last === '2026-11-10T18:00:00Z' && s[1].repo === 'q');
}

check('scrub oculta tokens do GitHub no texto', !/ghp_|github_pat_/.test(scrub('erro ghp_abcdefghij1234567890 e github_pat_ABCDEFGHIJ1234567890')));

function fakeApi(calls) {
  return async (path) => {
    calls.push(path);
    if (path === 'user') return { login: 'conta-teste' };
    if (path.includes('/settings/billing/usage')) {
      return { usageItems: [item('pesado', 'Actions Linux', 900, 5.4), item('leve', 'Actions Linux', 10, 0.06)] };
    }
    if (path.endsWith('/annotations')) return [{ message: 'The job was not started because recent account payments have failed or your spending limit needs to be increased.' }];
    if (/\/jobs(\?|$)/.test(path)) {
      const t = { labels: ['ubuntu-latest'], started_at: '2026-11-10T10:00:00Z', completed_at: '2026-11-10T10:00:30Z' };
      return { jobs: [{ id: 7, steps: [], ...t }, { id: 8, steps: [{ name: 'x' }], ...t }] };
    }
    if (path.includes('/actions/runs?')) {
      const repo = path.split('/')[2];
      return { workflow_runs: [
        { id: 1, name: 'CI', event: 'push', run_attempt: 1, conclusion: 'success', created_at: '2026-11-10T10:00:00Z' },
        { id: 2, name: 'CI', event: 'pull_request', run_attempt: 1, conclusion: repo === 'pesado' ? 'failure' : 'success', created_at: '2026-11-10T11:00:00Z' },
      ] };
    }
    throw new Error(`rota inesperada: ${path}`);
  };
}

{
  const calls = [];
  const r = await collect({ month: '2026-11', days: 3, top: 1, api: fakeApi(calls), now: new Date('2026-11-10T20:00:00Z') });
  check('consulta o billing do mês pedido, da conta do gh', calls.includes('users/conta-teste/settings/billing/usage?year=2026&month=11'));
  check('lista runs desde a data da janela', calls.some((c) => c.includes('created=%3E%3D2026-11-07')));
  check('mede só os runs dos maiores repositórios', r.runsMeasured === 2 && calls.filter((c) => c.endsWith('/jobs?per_page=100')).every((c) => c.includes('/pesado/')));
  check('minutos do workflow vêm do tempo faturável por job', r.workflows[0].minutes === 4 && r.workflows[0].runs === 2, JSON.stringify(r.workflows));
  check('acha o job bloqueado por cobrança só no job sem passos', r.billingBlock.length === 1 && r.billingBlock[0].repo === 'pesado' && r.billingBlock[0].jobs === 1, JSON.stringify(r.billingBlock));
  check('só consulta anotação de job que nem iniciou', calls.filter((c) => c.endsWith('/annotations')).length === 1);
  check('sem falha de consulta, errors fica vazio', r.errors.length === 0);
  const zerado = await collect({ month: '2026-11', days: 3, top: 1, now: new Date('2026-11-10T20:00:00Z'), api: async (path) => (/\/jobs\?per_page/.test(path) ? { jobs: [] } : fakeApi([])(path)) });
  check('runs medidos que dão 0 minuto viram erro em vez de relatório de zeros', zerado.errors.some((e) => /0 minuto faturável/.test(e)), JSON.stringify(zerado.errors));
  const texto = render(r);
  check('o texto marca o maior consumidor e o bloqueio por cobrança', /MAIOR CONSUMIDOR/.test(texto) && /pesado: 1 job/.test(texto), texto);
}

{
  const falhaEmUm = async (path) => {
    if (path.includes('/pesado/actions/runs?')) throw new Error('boom ghp_abcdefghij1234567890');
    return fakeApi([])(path);
  };
  const r = await collect({ month: '2026-11', days: 3, top: 1, api: falhaEmUm, now: new Date('2026-11-10T20:00:00Z') });
  check('falha de um repositório aparece em errors e não derruba os outros', r.errors.length === 1 && r.usage.ranked.length === 2);
}

{
  let lancou = false;
  try { await collect({ month: '2026-11', days: 3, top: 1, api: async () => { throw new Error('sem auth'); } }); } catch { lancou = true; }
  check('falha no billing aborta em vez de devolver relatório vazio', lancou);
}

console.log(falhas === 0 ? '\n== TUDO VERDE ==' : `\n== ${falhas} FALHA(S) ==`);
process.exit(falhas === 0 ? 0 : 1);
