/**
 * Gera a spec do board narrado (VXK, modo board) com as duas decisões do dono sobre o engine-registry:
 * (A) o esquema de confiança com rotação de chave; (B) as funcionalidades que mudam o uso do engine-kit.
 *
 *   node docs/research/2026-11-11-board-decisoes-do-registry.gen.mjs
 *   vxk_build com spec docs/research/2026-11-11-board-decisoes-do-registry.json
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const OPCOES = [
  { rotulo: 'A1 · Esquema D como recomendado (recomendada)',
    descricao: 'Motores assinados sem chave no CI, com build e assinatura das releases de native-java, cerne e vox-engine em runner hospedado pelo GitHub; kit publicado só com a sua aprovação 2FA no npm; autoatualização de motor espera algumas horas; releases de motor sem estágio. A troca manual de chave acaba.' },
  { rotulo: 'A2 · Esquema D estrito',
    descricao: 'Tudo da A1, e cada release de motor também passa por estágio no npm: fecha a janela do token, ao custo de um clique de aprovação por release de motor.' },
  { rotulo: 'A3 · Esquema B, sem nenhum clique',
    descricao: 'Só assinatura sem chave no CI. Melhor que hoje quando a máquina se perde, igual a hoje com o token roubado.' },
  { rotulo: 'A4 · Manter como está',
    descricao: 'As chaves dos motores no PC, com o backup cifrado, e troca manual quando uma chave for rotacionada; o token do GitHub continua bastando para publicar um kit.' },
  { rotulo: 'B1 · Construir os quatro recomendados (recomendada)',
    descricao: 'engine-kit fetch, instruções do agente no ensureGateway, instalação pelo npm na vitrine e cartões dos apps na vitrine. Fica de fora o engine-kit stop.' },
  { rotulo: 'B2 · Construir os cinco',
    descricao: 'Os quatro recomendados mais o engine-kit stop, que hoje não faria nada no mcp-gateway.' },
  { rotulo: 'B3 · Só a instalação pelo npm na vitrine',
    descricao: 'A vitrine passa a ensinar npx engine-kit ensure no lugar de clonar o repositório; nenhuma outra mudança de uso.' },
  { rotulo: 'B4 · Não construir nenhum',
    descricao: 'O engine-kit e a vitrine seguem como estão.' }
];

const A = OPCOES.filter(o => o.rotulo.startsWith('A'));
const B = OPCOES.filter(o => o.rotulo.startsWith('B'));
const lista = os => `<ol style="margin:0;padding-left:22px;display:grid;gap:10px;font-size:15px;line-height:1.5;list-style:none">\n${os.map(o => `<li><b>${esc(o.rotulo)}</b>: ${esc(o.descricao)}</li>`).join('\n')}\n</ol>`;

const decisaoHtml = `<section style="border:2px solid #ffc15e;border-radius:16px;padding:18px 20px;background:#241d0b;color:#f3e4bd">
<h2 style="margin:0 0 10px">Suas decisões</h2>
<p style="margin:0 0 8px;font-size:17px;line-height:1.5"><b>Decisão A.</b> Qual esquema de confiança o registry deve seguir, com a rotação de chave?</p>
${lista(A)}
<p style="margin:14px 0 8px;font-size:17px;line-height:1.5"><b>Decisão B.</b> Quais funcionalidades que mudam o uso do engine-kit devem ser construídas?</p>
${lista(B)}
<p style="margin:14px 0 0;font-size:14.5px;line-height:1.5">Custos das opções com assinatura sem chave: minutos pagos dos builds hospedados nos repositórios privados e os nomes desses repositórios no log público de transparência.</p>
</section>
<script type="application/json" id="orq-opcoes">${JSON.stringify(OPCOES).replace(/</g, '\\u003c')}</script>`;

const F = {
  sigOverview: 'https://docs.sigstore.dev/cosign/signing/overview/',
  fulcio: 'https://github.com/sigstore/fulcio/blob/main/docs/oid-info.md',
  monitor: 'https://github.com/sigstore/rekor-monitor',
  tuf: 'https://theupdateframework.github.io/specification/latest/',
  staged: 'https://docs.npmjs.com/staged-publishing/',
  trusted: 'https://docs.npmjs.com/trusted-publishers/',
  pnpm: 'https://pnpm.io/settings/dependency-resolution',
  immutable: 'https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases',
  secrets: 'https://docs.github.com/en/actions/reference/security/secure-use',
  billing: 'https://docs.github.com/en/billing/concepts/product-billing/github-actions',
  rlog: 'https://docs.sigstore.dev/logging/overview/'
};

const blocks = [
  { type: 'hero', kicker: 'engine-registry · duas decisões suas · 11/11/2026',
    title: 'Confiança do registry e novas funções do engine-kit',
    subtitle: 'A: o esquema de confiança, com a rotação de chave. B: as funcionalidades que mudam o jeito de usar o engine-kit. Cada decisão traz a recomendação e o que muda para você.',
    say: 'Este quadro tem duas decisões para você. A primeira é o esquema de confiança do registry, incluindo o que acontece com a rotação de chave. A segunda são cinco funcionalidades novas do engine-kit que mudam o jeito de usar o produto. Para cada uma, o quadro mostra o ganho, o tamanho do trabalho e a recomendação.' },

  { type: 'callout', tone: 'info', title: 'Decisão A: a pergunta',
    body: 'Se alguém pega o token do GitHub, o que o impede de publicar um kit malicioso? E quando você precisar rotacionar uma chave de motor, quanto trabalho manual isso dá?',
    say: 'Decisão A. A pergunta é dupla. Se alguém pega o token do GitHub, o que impede essa pessoa de publicar um kit malicioso? E quando você precisar rotacionar a chave de um motor, quanto trabalho manual isso dá?' },

  { type: 'cards', title: 'Hoje: três caminhos que contornam a chave', columns: 3,
    items: [
      { icon: 'git-branch', title: 'Main sem proteção e tag', badge: 'caminho 1',
        body: 'Um commit na main mudando manifest e kit, depois a tag engine-kit-v*: o workflow publica no npm com proveniência verdadeira.' },
      { icon: 'refresh-cw', title: 'Autoatualização do kit', badge: 'caminho 2',
        body: 'npx engine-kit relança na última versão do npm antes de conferir qualquer assinatura de motor.' },
      { icon: 'package', title: 'Kit instalado direto do GitHub', badge: 'caminho 3',
        body: 'Quatro projetos instalam o kit pela ponta da main ou por uma tag que o token move.' }
    ],
    say: 'Hoje existem três caminhos que a chave não protege. Primeiro, a main não tem proteção: com o token, um commit e a tag do kit fazem o workflow publicar no npm. Segundo, o kit se atualiza sozinho pelo npx, antes de conferir qualquer assinatura de motor. Terceiro, quatro projetos instalam o kit direto do GitHub, sem passar pelo npm. A chave está fora do GitHub, mas o token não precisa dela.' },

  { type: 'cards', title: 'O padrão de mercado', columns: 2,
    items: [
      { icon: 'badge-check', title: 'Assinatura sem chave (Sigstore)',
        body: 'A identidade do workflow vira a chave: certificado curto, chave destruída logo depois, registro no log público Rekor. Detecta abuso, não impede. Não há chave para rotacionar.' },
      { icon: 'key-round', title: 'TUF com limiar',
        body: 'Papéis root, targets, snapshot e timestamp, com raiz offline k de n. Exige que você guarde várias chaves de hardware.' },
      { icon: 'shield-check', title: 'Aprovação fora do GitHub',
        body: 'Publicação em estágio do npm: o CI só põe em estágio, e publicar exige o 2FA do mantenedor. Token OIDC não aprova.' },
      { icon: 'clock', title: 'Atraso e monitor',
        body: 'O pnpm espera um dia antes de instalar versão nova; o rekor-monitor avisa cada assinatura de uma identidade.' }
    ],
    say: 'O padrão de mercado tem quatro peças. A assinatura sem chave do Sigstore troca a chave pela identidade do workflow e registra tudo num log público: detecta abuso, não impede, e não deixa chave para rotacionar. O TUF separa papéis e guarda a raiz offline com limiar, mas você teria de guardar várias chaves de hardware. A publicação em estágio do npm exige o seu segundo fator para ir ao ar. E o atraso com monitor dá tempo de ver um abuso antes que ele se espalhe.' },

  { type: 'compare', title: 'Os quatro esquemas lado a lado',
    columns: ['Hoje','Só sem chave', 'TUF com raiz offline', 'D · Recomendado'],
    rows: [
      { label: 'Token roubado', cells: ['Perde tudo', 'Perde as releases, com registro público', 'Raiz segura se assinar o kit', 'Kit seguro; motor visível e atrasado'] },
      { label: 'Máquina perdida', cells: ['Perde as chaves, salvo backup', 'Nada', 'Chaves de hardware fora do PC sobrevivem', 'Nada'] },
      { label: 'Rotação de chave', cells: ['Troca manual no trust.json de cada máquina', 'Não existe chave', 'Cerimônia da raiz', 'Não existe chave'] },
      { label: 'Você guarda', cells: ['As chaves dos motores e uma frase-senha', 'Nada', 'k de n chaves de hardware', 'Nada além da conta npm'] },
      { label: 'Automático', cells: ['Sim, preso ao PC', 'Total', 'Releases sim; raiz com cerimônia', 'Motores sim; kit com um clique'] }
    ],
    say: 'Os quatro esquemas lado a lado. Hoje, o token roubado perde tudo e a rotação de chave é uma troca manual em cada máquina. Só assinatura sem chave é automática e não perde nada com a máquina, mas com o token é igual a hoje. O TUF com raiz offline segura o token, mas exige que você guarde várias chaves de hardware. O esquema D combina assinatura sem chave nos motores com a sua aprovação no npm para o kit, e a rotação de chave deixa de existir.' },

  { type: 'steps', title: 'Recomendação: esquema D',
    items: [
      { title: 'Kit só com aprovação 2FA no npm',
        body: 'O CI passa a pôr o kit em estágio. Ele vai ao ar quando você aprova com 2FA no npmjs.com, de qualquer aparelho. As dependências github: passam a vir do npm.' },
      { title: 'Motores assinados sem chave no CI',
        body: 'Um workflow da main, em runner hospedado pelo GitHub nos três repositórios pesados (native-java, cerne, vox-engine), atesta cada artefato pelo Sigstore. O kit confere o certificado, o registro no Rekor e a identidade fixada. A troca manual no trust.json acaba.' },
      { title: 'Atraso, monitor e releases imutáveis',
        body: 'A autoatualização só instala release de motor que está no log há algumas horas. Um monitor avisa cada assinatura, e as releases não mudam depois de publicadas.' },
      { title: 'Alternativa sem clique: esquema B',
        body: 'Se você não aceitar nenhum clique, fica só a assinatura sem chave. Resolve a máquina perdida, mas não resiste ao token roubado.' }
    ],
    say: 'Recomendo o esquema D, em três camadas. Primeira: o kit só vai ao ar com a sua aprovação de dois fatores no npm, e os projetos que dependem do GitHub passam a usar o npm. Segunda: os motores são assinados sem chave no CI, num runner hospedado pelo GitHub nos três repositórios pesados, com a identidade do workflow fixada dentro do kit; acaba a troca manual de chave. Terceira: a autoatualização espera algumas horas, um monitor avisa cada assinatura, e as releases ficam imutáveis. Se você não quiser nenhum clique, a alternativa é o esquema B, sabendo que ele não resiste ao token.' },

  { type: 'cards', title: 'O que muda para você no esquema D', columns: 3,
    items: [
      { icon: 'smartphone', title: 'Um clique por release do kit', badge: 'passa a fazer',
        body: 'Aprovar com 2FA no npmjs.com, de qualquer aparelho. Release de motor segue sem clique.' },
      { icon: 'settings', title: 'Configurar o npm e as releases imutáveis', badge: 'passa a fazer',
        body: 'Você mesmo liga a publicação só em estágio no npm e as releases imutáveis no GitHub, uma vez.' },
      { icon: 'key-round', title: 'Deixa de guardar chaves', badge: 'deixa de fazer',
        body: 'Sem as chaves dos motores, a frase-senha, o backup cifrado e a troca de chave no trust.json de cada máquina.' }
    ],
    say: 'O que muda para você no esquema D. Passa a fazer: aprovar cada release do kit com dois fatores no npm, de qualquer aparelho, e configurar uma vez a publicação em estágio do npm e as releases imutáveis do GitHub. Deixa de fazer: guardar as chaves dos motores, a frase-senha e o backup, e trocar chave no trust.json de cada máquina. Release de motor continua sem clique.' },

  { type: 'cards', title: 'Quanto custa o esquema D', columns: 2,
    items: [
      { icon: 'credit-card', title: 'Minutos pagos nos repositórios privados', badge: 'custo',
        body: 'O build e a assinatura das releases de native-java, cerne e vox-engine passam a rodar em runner hospedado pelo GitHub. Em repositório privado, isso gasta a cota incluída: US$ 12 por mês no plano Free; o minuto Windows custa US$ 0,010 e o Linux US$ 0,006. Só as releases gastam; o CI do dia a dia segue no runner local.' },
      { icon: 'eye', title: 'Nome dos repositórios no log público', badge: 'custo',
        body: 'O certificado do Sigstore traz o endereço do repositório e o caminho do workflow, e o log público de transparência nunca apaga entradas. Os nomes dos três repositórios privados ficam públicos para sempre. As releases já são públicas no engine-registry.' }
    ],
    say: 'O esquema D tem dois custos que entram na sua decisão. Primeiro, minutos pagos: o build e a assinatura das releases dos três repositórios pesados passam a rodar num runner do GitHub, e em repositório privado isso gasta a cota incluída, de doze dólares por mês no plano gratuito. Só as releases gastam. Segundo, o nome dos três repositórios privados fica gravado para sempre no log público de transparência do Sigstore, junto com o caminho do workflow.' },

  { type: 'callout', tone: 'warn', title: 'O que o esquema D não resolve',
    body: 'A garantia dos motores depende de alguém ver o alerta dentro do atraso. Proteção total contra o token sem nenhum clique não existe. Implementar exige subir o teto de tamanho do kit (26975 de 27000 bytes) ou adotar o @sigstore/verify.',
    say: 'Dito com clareza: na camada dos motores, a garantia depende de alguém ver o alerta a tempo. Proteção total contra o token sem nenhum clique não existe. E a implementação tem um custo conhecido: o kit está a vinte e cinco bytes do teto de tamanho, então o verificador do Sigstore exige subir o teto ou adicionar uma dependência.' },

  { type: 'callout', tone: 'info', title: 'Decisão B: a pergunta',
    body: 'Cinco funcionalidades novas do engine-kit e da vitrine mudam o jeito de usar o produto. Quais valem ser construídas?',
    say: 'Decisão B. Cinco funcionalidades mudam o jeito de usar o engine-kit ou a vitrine, e por isso são suas. Para cada uma: o que faz, o ganho, o tamanho do trabalho e a recomendação.' },

  { type: 'table', title: 'As cinco funcionalidades, com ganho, esforço e recomendação',
    head: ['Funcionalidade', 'O que muda no uso', 'Ganho', 'Esforço', 'Recomendação'],
    rows: [
      ['engine-kit fetch', 'Verbo novo: baixa e confere sha256 e assinatura de um motor ou app sem instalar. Cerne, vox-engine e os apps só chegam hoje por link de release.', 'Médio', 'Médio: apps têm lista de assets fora do resolve; os sdkFlats do vox-engine ficam de fora', 'Construir'],
      ['engine-kit stop', 'Verbo novo: desliga um motor pelo shutdownPath declarado. O mcp-gateway não declara shutdownPath (só o adaptador drena), então não faria nada no motor mais usado.', 'Médio', 'Médio', 'Não construir agora; só depois que o mcp-gateway declarar o shutdownPath'],
      ['Instruções do agente no ensureGateway', 'O adaptador devolve também as instruções para o agente; os hosts passam a exibir ou injetar esse texto.', 'Médio', 'Pequeno, mas o adaptador está no teto (5492 de 5500 bytes) e pede reajuste do teto', 'Construir'],
      ['Instalação pelo npm na vitrine', 'O passo 2 da vitrine deixa de mandar clonar o repositório e rodar node kit/doctor.mjs --fix, e passa a ensinar npx engine-kit ensure. O README já documenta esse caminho.', 'Alto', 'Pequeno', 'Construir'],
      ['Cartões dos apps na vitrine', 'Agent Launcher e Smart Design, hoje só na tabela do README, ganham cartão lido do manifest. A vitrine, hoje "dos motores", passa a dizer "motores e apps".', 'Médio', 'Pequeno a médio', 'Construir, com a vitrine dizendo motores e apps']
    ],
    say: 'As cinco funcionalidades. Primeira, engine-kit fetch: baixa e confere um motor ou app sem instalar, útil para o cerne, o vox-engine e os apps, que hoje só chegam por link. Ganho médio, esforço médio. Recomendo construir. Segunda, engine-kit stop: desliga um motor, mas o mcp-gateway não declara como, então não faria nada no motor mais usado. Recomendo esperar. Terceira, as instruções do agente no adaptador do gateway: ganho médio, esforço pequeno, mas o adaptador está no teto de tamanho e pede reajuste. Recomendo construir. Quarta, a instalação pelo npm na vitrine: hoje a vitrine manda clonar o repositório, e o caminho do npm já existe no README. Ganho alto, esforço pequeno. Recomendo construir. Quinta, os cartões dos apps na vitrine: ganho médio, e a vitrine passa a dizer motores e apps. Recomendo construir.' },

  { type: 'html', html: decisaoHtml,
    say: 'Suas decisões. Decisão A, o esquema de confiança. A um, a recomendada: esquema D, com o build e a assinatura das releases pesadas num runner do GitHub, um clique de aprovação por release do kit, atraso de algumas horas, e a troca manual de chave acabando. A dois: esquema D estrito, com cada release de motor também aprovada. A três: esquema B, sem nenhum clique. A quatro: manter como está. Decisão B, as funcionalidades. B um, a recomendada: construir os quatro recomendados, sem o engine-kit stop. B dois: construir os cinco. B três: só a instalação pelo npm na vitrine. B quatro: não construir nenhum. Nada é implementado antes da sua resposta.' },

  { type: 'table', title: 'De onde vem cada afirmação', head: ['Afirmação', 'Fonte', 'Endereço', 'Acessado em'],
    rows: [
      ['Os quatro esquemas, os três caminhos até as máquinas, o caso do token roubado e a recomendação D', 'Relatório do registry', 'docs/research/2026-11-09-confianca-do-registry-sem-custodia-de-chave.md', '09/11/2026'],
      ['Quadro anterior da decisão de confiança, com as opções A a D', 'Quadro narrado do registry', 'docs/research/2026-11-09-board-confianca-do-registry.md', '09/11/2026'],
      ['Pin por motor, acoplamento entre motores e custódia das chaves', 'Relatório do registry', 'docs/research/2026-11-09-pin-por-motor-acoplamento-e-custodia-de-chaves.md', '09/11/2026'],
      ['Fetch, stop e instruções do ensureGateway: ganho, esforço e peças reaproveitadas; adaptador a 5492 de 5500 bytes', 'Lente de feature irmã do engine-kit 0.2.6', 'docs/research/2026-11-11-lente-feature-irma-engine-kit-0.2.6.md', '11/11/2026'],
      ['Instalação pelo npm na vitrine e cartões dos apps: ganho, esforço e peças reaproveitadas', 'Lente de feature irmã do engine-kit 0.2.9', 'docs/research/2026-11-11-lente-feature-irma-engine-kit-0.2.9.md', '11/11/2026'],
      ['Assinatura sem chave associa identidade, não chave; a chave é destruída logo depois', 'Sigstore', F.sigOverview, '09/11/2026'],
      ['Identidade do workflow no certificado', 'Fulcio', F.fulcio, '09/11/2026'],
      ['Monitor de identidade; o log é evidente a adulteração, não à prova dela', 'rekor-monitor', F.monitor, '09/11/2026'],
      ['Papéis, limiar e raiz offline; recuperação quase impossível sem as chaves', 'Especificação TUF', F.tuf, '09/11/2026'],
      ['Aprovação em estágio exige 2FA; token OIDC não aprova', 'npm', F.staged, '09/11/2026'],
      ['Publicador confiável configurável para só pôr em estágio', 'npm', F.trusted, '09/11/2026'],
      ['Espera padrão de 1440 minutos antes de instalar versão nova', 'pnpm', F.pnpm, '09/11/2026'],
      ['Release imutável: assets e tag não mudam depois de publicada', 'GitHub Docs', F.immutable, '09/11/2026'],
      ['Quem tem escrita lê todos os secrets', 'GitHub Docs', F.secrets, '09/11/2026'],
      ['Runner hospedado em repositório privado gasta a cota: US$ 12/mês no Free; minuto Windows US$ 0,010, Linux US$ 0,006', 'GitHub Docs', F.billing, '09/11/2026'],
      ['Entradas do log de transparência nunca são alteradas nem removidas', 'Sigstore', F.rlog, '09/11/2026']
    ],
    say: 'Por fim, as fontes. Os cinco relatórios do próprio registry, em docs research: o de confiança sem custódia de chave, o quadro anterior, o de pin por motor e custódia, e as lentes de feature irmã das versões zero ponto dois ponto seis e zero ponto dois ponto nove. E a documentação do Sigstore, do TUF, do npm, do pnpm e do GitHub, acessada em nove de novembro de dois mil e vinte e seis.' }
];

const spec = {
  engine: 'vxk', mode: 'board',
  title: 'Confiança do registry e novas funções do engine-kit', slug: 'engine-registry-decisoes',
  badge: 'VXK · board · engine-registry · 11/11/2026', accent: '#ffc15e',
  language: 'pt-BR', narrate: true, voice: 'pt-BR-Chirp3-HD-Iapetus', voiceStrict: true,
  intro: 'Duas decisões sobre o engine-registry: o esquema de confiança com a rotação de chave, e as funcionalidades que mudam o uso do engine-kit.',
  labels: { explain: '▶ Apresentar', pause: '⏸ Pausar', resume: '▶ Continuar', prev: '◀ Anterior', next: 'Próximo ▶', index: '☰ Índice', indexTitle: 'Tópicos', indexClose: 'Fechar' },
  blocks
};
writeFileSync(join(HERE, '2026-11-11-board-decisoes-do-registry.json'), JSON.stringify(spec, null, 2) + '\n');
console.log(`2026-11-11-board-decisoes-do-registry.json: ${blocks.length} blocos`);
