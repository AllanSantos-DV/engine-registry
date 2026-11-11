/**
 * Divide a spec combinada (2026-11-11-board-decisoes-do-registry.json, gerada pelo .gen.mjs) em dois boards, um por
 * decisão, cada um com no máximo quatro opções e o bloco orq-opcoes com os mesmos rótulos da tela.
 *
 *   node docs/research/2026-11-11-board-decisoes-do-registry.gen.mjs
 *   node docs/research/2026-11-11-board-decisoes-do-registry.split.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(join(HERE, '2026-11-11-board-decisoes-do-registry.json'), 'utf8'));
const find = (type, re) => base.blocks.find(b => b.type === type && re.test(b.title ?? ''));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const OPCOES_A = [
  { rotulo: 'A1 · Esquema D como recomendado (recomendada)', descricao: 'Motores assinados sem chave no CI, kit só com a sua aprovação 2FA no npm, atraso de algumas horas; a troca manual de chave acaba.' },
  { rotulo: 'A2 · Esquema D estrito', descricao: 'Como a A1, e cada release de motor também espera a sua aprovação no npm.' },
  { rotulo: 'A3 · Esquema B, sem nenhum clique', descricao: 'Só assinatura sem chave: melhor que hoje se a máquina se perder, igual a hoje com o token roubado.' },
  { rotulo: 'A4 · Manter como está', descricao: 'Chaves dos motores no PC com backup cifrado e troca manual na rotação.' }
];
const OPCOES_B = [
  { rotulo: 'B1 · Construir os quatro recomendados (recomendada)', descricao: 'fetch, instruções do agente no ensureGateway, instalação pelo npm e cartões dos apps na vitrine; sem o stop.' },
  { rotulo: 'B2 · Construir os cinco', descricao: 'Os quatro mais o engine-kit stop, que hoje não faria nada no mcp-gateway.' },
  { rotulo: 'B3 · Só a instalação pelo npm na vitrine', descricao: 'A vitrine ensina npx engine-kit ensure no lugar de clonar o repositório.' },
  { rotulo: 'B4 · Não construir nenhum', descricao: 'O engine-kit e a vitrine seguem como estão.' }
];

const decisao = (titulo, pergunta, opcoes, nota, say) => ({
  type: 'html',
  html: `<section style="border:2px solid #ffc15e;border-radius:16px;padding:18px 20px;background:#241d0b;color:#f3e4bd">
<h2 style="margin:0 0 10px">${esc(titulo)}</h2>
<p style="margin:0 0 14px;font-size:17px;line-height:1.5">${esc(pergunta)}</p>
<ol style="margin:0;padding-left:22px;display:grid;gap:10px;font-size:15px;line-height:1.5;list-style:none">
${opcoes.map(o => `<li><b>${esc(o.rotulo)}</b>: ${esc(o.descricao)}</li>`).join('\n')}
</ol>
${nota ? `<p style="margin:14px 0 0;font-size:14.5px;line-height:1.5">${esc(nota)}</p>` : ''}
</section>
<script type="application/json" id="orq-opcoes">${JSON.stringify(opcoes).replace(/</g, '\\u003c')}</script>`,
  say
});

const fontes = base.blocks.find(b => b.type === 'table' && /De onde vem/.test(b.title));
const opcoesDe = ids => base.blocks.filter(b => ids.includes(b.title));

const common = { ...base, engine: 'vxk', mode: 'board', accent: '#ffc15e', language: 'pt-BR', narrate: true, voice: 'pt-BR-Chirp3-HD-Iapetus', voiceStrict: true };

const blocksA = [
  { type: 'hero', kicker: 'engine-registry · decisão sua · 11/11/2026',
    title: 'Esquema de confiança do registry e rotação de chave',
    subtitle: 'O que impede um token do GitHub roubado de publicar um kit malicioso, o que acontece com a rotação de chave e a recomendação.',
    say: 'Este quadro tem uma decisão para você: o esquema de confiança do registry, incluindo o que acontece com a rotação de chave. Mostra como está hoje, o padrão de mercado, a recomendação, o que muda para você e o que custa.' },
  ...opcoesDe(['Decisão A: a pergunta', 'Hoje: três caminhos que contornam a chave', 'O padrão de mercado', 'Os quatro esquemas lado a lado', 'Recomendação: esquema D', 'O que muda para você no esquema D', 'Quanto custa o esquema D', 'O que o esquema D não resolve']),
  decisao('Sua decisão', 'Qual esquema de confiança o registry deve seguir, com a rotação de chave?', OPCOES_A,
    'Custos das opções com assinatura sem chave: minutos pagos dos builds hospedados nos repositórios privados e os nomes desses repositórios no log público de transparência.',
    'Sua decisão: qual esquema o registry deve seguir. A um, a recomendada: esquema D, com o build e a assinatura das releases pesadas num runner do GitHub, um clique de aprovação por release do kit, atraso de algumas horas, e a troca manual de chave acabando. A dois: esquema D estrito, com cada release de motor também aprovada. A três: esquema B, sem nenhum clique. A quatro: manter como está. Nada é implementado antes da sua resposta.'),
  fontes
];

const blocksB = [
  { type: 'hero', kicker: 'engine-registry · decisão sua · 11/11/2026',
    title: 'Novas funções do engine-kit e da vitrine',
    subtitle: 'Cinco funcionalidades que mudam o jeito de usar o engine-kit ou a vitrine, cada uma com ganho, esforço e recomendação.',
    say: 'Este quadro tem uma decisão para você: quais de cinco funcionalidades novas do engine-kit e da vitrine devem ser construídas. Para cada uma, o quadro mostra o que muda no uso, o ganho, o tamanho do trabalho e a recomendação.' },
  ...opcoesDe(['Decisão B: a pergunta', 'As cinco funcionalidades, com ganho, esforço e recomendação']),
  { type: 'steps', title: 'Recomendação: os quatro, sem o stop',
    items: [
      { title: 'Instalação pelo npm na vitrine', body: 'Ganho alto, esforço pequeno: a vitrine passa a ensinar npx engine-kit ensure no lugar de clonar o repositório.' },
      { title: 'engine-kit fetch', body: 'Baixa e confere um motor ou app sem instalar; o cerne, o vox-engine e os apps só chegam hoje por link.' },
      { title: 'Instruções do agente no ensureGateway', body: 'Os hosts passam a exibir ou injetar as instruções; pede reajuste do teto do adaptador.' },
      { title: 'Cartões dos apps na vitrine', body: 'Agent Launcher e Smart Design ganham cartão; a vitrine passa a dizer motores e apps.' },
      { title: 'Fica de fora: engine-kit stop', body: 'Só depois que o mcp-gateway declarar como desligar; hoje não faria nada no motor mais usado.' }
    ],
    say: 'Recomendo construir quatro e deixar o engine-kit stop de fora. A instalação pelo npm na vitrine tem o maior ganho e o menor esforço. O fetch baixa e confere um motor ou app sem instalar. As instruções do agente no ensureGateway pedem reajuste do teto do adaptador. Os cartões dos apps fazem a vitrine falar em motores e apps. O stop espera o mcp-gateway declarar como se desliga, porque hoje não faria nada no motor mais usado.' },
  decisao('Sua decisão', 'Quais funcionalidades que mudam o uso do engine-kit devem ser construídas?', OPCOES_B, null,
    'Sua decisão: quais funcionalidades construir. B um, a recomendada: construir os quatro recomendados, sem o engine-kit stop. B dois: construir os cinco. B três: só a instalação pelo npm na vitrine. B quatro: não construir nenhum. Nada é implementado antes da sua resposta.'),
  fontes
];

const out = (nome, slug, title, intro, blocks) => {
  const spec = { ...common, title, slug, badge: 'VXK · board · engine-registry · 11/11/2026', intro, blocks };
  writeFileSync(join(HERE, nome), JSON.stringify(spec, null, 2) + '\n');
  console.log(`${nome}: ${blocks.length} blocos`);
};
out('2026-11-11-board-decisao-a-confianca.json', 'engine-registry-decisao-a-confianca', 'Esquema de confiança do registry e rotação de chave',
  'Uma decisão sobre o engine-registry: o esquema de confiança, com a rotação de chave.', blocksA);
out('2026-11-11-board-decisao-b-engine-kit.json', 'engine-registry-decisao-b-engine-kit', 'Novas funções do engine-kit e da vitrine',
  'Uma decisão sobre o engine-kit e a vitrine: quais funcionalidades construir.', blocksB);
