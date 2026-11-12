/**
 * Gera a spec do quadro narrado (VXK, modo board) com as três decisões do dono sobre o engine-kit que mudam o uso:
 * (1) o ensure do neural-link rodar o install do motor; (2) um verbo para subir um motor; (3) stop e remover motor.
 *
 *   node docs/research/2026-11-12-board-tres-decisoes-do-engine-kit.gen.mjs
 *   vxk_build com a spec docs/research/2026-11-12-board-tres-decisoes-do-engine-kit.json
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const OPCOES = [
  { rotulo: 'N1 · Manter como está',
    descricao: 'O ensure neural-link instala só o dispatcher; quem registra os hooks é o adaptador da extensão ou o comando do próprio neural-link.' },
  { rotulo: 'N2 · Só avisar o próximo passo',
    descricao: 'O ensure neural-link continua sem escrever nada e passa a imprimir o comando que registra os hooks.' },
  { rotulo: 'N3 · Registro opcional com --register (recomendada)',
    descricao: 'Com a flag, o ensure instala e roda o install do motor; sem a flag, nada muda além do aviso da N2.' },
  { rotulo: 'N4 · Sempre registrar',
    descricao: 'Todo ensure neural-link roda o install e escreve a configuração global de hooks.' },
  { rotulo: 'S1 · Não construir o verbo de subir (recomendada)',
    descricao: 'Quem sobe o motor segue sendo o consumidor, que conhece o protocolo de saúde; o ensure continua dizendo isso.' },
  { rotulo: 'S2 · Só mostrar como subir',
    descricao: 'O ensure de um daemon imprime o comando de entrada e a pasta de dados; nada é executado.' },
  { rotulo: 'S3 · engine-kit start pelo healthPath declarado',
    descricao: 'Sobe e confirma que o endereço de saúde responde. Só embed-house e mcp-gateway declaram esse endereço; não confere o protocolo do motor.' },
  { rotulo: 'S4 · ensure --start',
    descricao: 'O mesmo da S3, dentro do ensure, para quem instala e quer o motor de pé num comando só.' },
  { rotulo: 'R1 · Não construir nenhum',
    descricao: 'Sem stop e sem remover: parar e apagar um motor segue sendo manual.' },
  { rotulo: 'R2 · Só o stop (recomendada)',
    descricao: 'engine-kit stop desliga pelo caminho que o registry declara; remover fica para quando o manifest declarar o que é estado do usuário.' },
  { rotulo: 'R3 · stop e remover só a instalação',
    descricao: 'Remover apaga a pasta do binário e preserva os dados; recusa com o motor vivo e nos motores self-managed.' },
  { rotulo: 'R4 · stop e remover tudo',
    descricao: 'Remover apaga também a pasta de dados do motor, com o estado do usuário.' }
];

const grupo = p => OPCOES.filter(o => o.rotulo.startsWith(p));
const lista = os => `<ol style="margin:0;padding-left:22px;display:grid;gap:10px;font-size:15px;line-height:1.5;list-style:none">\n${os.map(o => `<li><b>${esc(o.rotulo)}</b>: ${esc(o.descricao)}</li>`).join('\n')}\n</ol>`;

const decisaoHtml = `<section style="border:2px solid #ffc15e;border-radius:16px;padding:18px 20px;background:#241d0b;color:#f3e4bd">
<h2 style="margin:0 0 10px">Suas decisões</h2>
<p style="margin:0 0 8px;font-size:17px;line-height:1.5"><b>Decisão 1.</b> O comando ensure do neural-link deve registrar os hooks?</p>
${lista(grupo('N'))}
<p style="margin:14px 0 8px;font-size:17px;line-height:1.5"><b>Decisão 2.</b> O engine-kit deve ganhar um verbo para subir um motor?</p>
${lista(grupo('S'))}
<p style="margin:14px 0 8px;font-size:17px;line-height:1.5"><b>Decisão 3.</b> O engine-kit deve ganhar o stop e o remover?</p>
${lista(grupo('R'))}
<p style="margin:14px 0 0;font-size:14.5px;line-height:1.5">Nada disso foi construído e nenhum hook foi criado ou alterado. Escolhida a opção, ela é construída, testada e publicada pela mesma esteira de sempre.</p>
</section>
<script type="application/json" id="orq-opcoes">${JSON.stringify(OPCOES).replace(/</g, '\\u003c')}</script>`;

const blocks = [
  { type: 'hero', kicker: 'engine-registry · três decisões suas · 12/11/2026',
    title: 'Três decisões do engine-kit que mudam o uso',
    subtitle: 'Registrar os hooks do neural-link pelo ensure, um verbo para subir um motor, e o stop com o remover. Para cada uma: o que muda para você, o ganho, o risco e a recomendação.',
    say: 'Este quadro tem três decisões para você sobre o engine-kit. A primeira: o comando ensure do neural-link deve registrar os hooks. A segunda: o kit deve ganhar um verbo para subir um motor. A terceira: o kit deve ganhar o stop e o remover. Para cada uma você vê o que muda, o ganho, o risco e a minha recomendação. Nada disso foi construído, e nenhum hook foi criado ou alterado.' },

  { type: 'table', title: 'O que está aberto no backlog do engine-registry',
    head: ['Item', 'Situação', 'Onde é decidido'],
    rows: [
      ['Ensure do neural-link rodar o install do motor', 'Aberto, espera você', 'Decisão 1 deste quadro'],
      ['Verbo para subir um motor depois do ensure', 'Aberto, espera você', 'Decisão 2 deste quadro'],
      ['Verbo para remover um motor', 'Aberto, espera você', 'Decisão 3 deste quadro'],
      ['engine-kit stop', 'Aberto, espera você', 'Decisão 3 deste quadro'],
      ['Esquema de confiança do registry', 'Aberto, espera você', 'Quadro de 11/11/2026, decisão A'],
      ['Rotação de chave de motor', 'Aberto, preso ao esquema de confiança', 'Quadro de 11/11/2026, decisão A']
    ],
    say: 'O que está aberto no backlog do registry: seis itens, todos seus. Quatro entram neste quadro: o ensure do neural-link, o verbo de subir, o remover e o stop. Os outros dois, o esquema de confiança e a rotação de chave, estão no quadro de onze de novembro. Não há nenhum item técnico aberto: o que era técnico já foi construído.' },

  { type: 'callout', tone: 'info', title: 'Decisão 1: a pergunta',
    body: 'Quem instala o neural-link pelo terminal fica com o dispatcher no disco e nenhum hook registrado. O ensure deveria também registrar?',
    say: 'Decisão um. Quem instala o neural-link pelo terminal fica com o dispatcher no disco, mas nenhum hook registrado. O comando ensure deveria também registrar os hooks?' },

  { type: 'cards', title: 'O que o install do neural-link faz na sua máquina', columns: 3,
    items: [
      { icon: 'file-cog', title: 'Escreve declarações globais', badge: 'efeito 1',
        body: 'Uma declaração por evento na pasta global de hooks, valendo para todas as sessões de agente da máquina. Remove as de eventos que ficaram sem handler.' },
      { icon: 'list-plus', title: 'Registra scripts novos', badge: 'efeito 2',
        body: 'Lê os scripts da pasta de hooks e os companions entregues pelas extensões e os grava no config do neural-link.' },
      { icon: 'triangle-alert', title: 'Um erro derruba todos os hooks', badge: 'risco',
        body: 'O próprio código do neural-link avisa: uma declaração apontando para um caminho que sumiu derruba todos os hooks da máquina, sem pista da causa.' }
    ],
    say: 'O que o install do neural-link faz na sua máquina. Primeiro, escreve uma declaração por evento na pasta global de hooks, e isso vale para todas as sessões de agente, removendo as de eventos que ficaram sem handler. Segundo, registra os scripts novos e os companions das extensões no config do neural-link. O risco: o próprio código do neural-link avisa que uma declaração apontando para um caminho que sumiu derruba todos os hooks da máquina, sem pista da causa.' },

  { type: 'cards', title: 'O que o mercado e os seus projetos fazem', columns: 3,
    items: [
      { icon: 'git-commit-horizontal', title: 'Husky: registrar é um passo explícito',
        body: 'O hook só é instalado quando o comando husky roda, normalmente num script prepare; a variável HUSKY igual a zero desliga a instalação.' },
      { icon: 'toggle-left', title: 'Neural-link: registro manual por padrão',
        body: 'O config tem um campo registration, manual ou auto, e o padrão é manual. A barra lateral da extensão mostra os hooks ainda não registrados e registra com um clique.' },
      { icon: 'plug', title: 'Adaptador: já registra',
        body: 'Quem usa o adaptador do kit já recebe o install rodado depois de copiar os hooks. O buraco é só de quem instala pelo terminal.' }
    ],
    say: 'O que o mercado e os seus projetos fazem. No Husky, registrar o hook é um passo explícito, e uma variável de ambiente desliga a instalação. No próprio neural-link, o registro é manual por padrão, com um campo que alterna para automático, e a barra lateral da extensão mostra os hooks ainda não registrados e registra com um clique. E o adaptador do kit já roda o install. O buraco é só de quem instala pelo terminal.' },

  { type: 'compare', title: 'Decisão 1: as opções lado a lado',
    columns: ['N1 · Manter', 'N2 · Só avisar', 'N3 · --register', 'N4 · Sempre'],
    rows: [
      { label: 'Muda para você', cells: ['Nada', 'Vê o comando no fim do ensure', 'Um comando só instala e registra', 'Todo ensure registra'] },
      { label: 'Escreve config global', cells: ['Nunca', 'Nunca', 'Só quando você pede', 'Sempre'] },
      { label: 'Risco', cells: ['Hooks instalados e não chamados', 'Idêntico, com aviso', 'Baixo: ato explícito', 'Médio: efeito global sem pedido'] },
      { label: 'Esforço', cells: ['Nenhum', 'Pequeno', 'Pequeno a médio: o install roda de um caminho só, usado também pelo adaptador', 'Pequeno a médio'] }
    ],
    say: 'Decisão um, as opções. Manter como está não muda nada e deixa hooks instalados e não chamados. Só avisar imprime o comando no fim do ensure, sem escrever nada. A opção três, a recomendada, cria a flag register: com ela, um comando instala e registra; sem ela, nada muda além do aviso. Sempre registrar escreve a configuração global em todo ensure, o que é um efeito global sem pedido.' },

  { type: 'steps', title: 'Recomendação da decisão 1: N3, registro opcional',
    items: [
      { title: 'O padrão continua seguro', body: 'Sem a flag, o ensure não escreve nada no config global e imprime o comando que registra.' },
      { title: 'Um comando para quem quer tudo', body: 'ensure neural-link com register instala o dispatcher e roda o install do motor, o mesmo caminho do adaptador.' },
      { title: 'Falha visível', body: 'Se o install falhar, o comando termina com erro e diz que os hooks não foram registrados.' }
    ],
    say: 'Recomendo a opção três. O padrão continua seguro: sem a flag, o ensure não escreve nada no config global e imprime o comando que registra. Com a flag, um comando instala o dispatcher e roda o install, pelo mesmo caminho do adaptador. E se o install falhar, o comando termina com erro e diz que os hooks não foram registrados. Registrar é o mesmo padrão do Husky e do modo manual do próprio neural-link: um ato seu, não um efeito colateral.' },

  { type: 'callout', tone: 'info', title: 'Decisão 2: a pergunta',
    body: 'Depois do ensure de um daemon, nada sobe: quem sobe é o consumidor. O kit deveria ter um verbo para subir um motor?',
    say: 'Decisão dois. Depois do ensure de um daemon, nada sobe: quem sobe é o consumidor. O kit deveria ter um verbo para subir um motor?' },

  { type: 'cards', title: 'Por que o kit hoje não sobe o motor', columns: 3,
    items: [
      { icon: 'shield-question', title: 'O kit não adivinha a saúde', badge: 'regra do kit',
        body: 'Cada motor tem seu protocolo; quem o conhece é o consumidor, que passa o healthCheck. Uma saúde genérica aprovaria o processo errado.' },
      { icon: 'server', title: 'Poucos motores declaram o endereço', badge: 'manifest',
        body: 'Dos quatro daemons, só embed-house e mcp-gateway declaram o endereço de saúde. vox-engine e cerne se instalam e sobem pelo próprio instalador.' },
      { icon: 'rotate-cw', title: 'Quem usa o adaptador já tem isso', badge: 'hoje',
        body: 'O adaptador do gateway sobe o motor, espera o anúncio e confere o handshake do protocolo.' }
    ],
    say: 'Por que o kit hoje não sobe o motor. Primeiro, é uma regra do kit: ele não adivinha a saúde, porque cada motor tem seu protocolo e quem o conhece é o consumidor. Segundo, só dois dos quatro daemons, o embed-house e o mcp-gateway, declaram o endereço de saúde; o vox-engine e o cerne se instalam e sobem pelo próprio instalador. Terceiro, quem usa o adaptador do gateway já recebe o motor de pé, com o handshake conferido.' },

  { type: 'cards', title: 'O que o mercado faz', columns: 2,
    items: [
      { icon: 'terminal', title: 'Homebrew: subir é um verbo à parte',
        body: 'brew services start sobe o serviço e o registra para subir no login; brew services run sobe sem registrar. Cada verbo diz o que deixa configurado.' },
      { icon: 'triangle-alert', title: 'O custo para o kit',
        body: 'Um verbo start precisa decidir o que é saúde. Sem o handshake do motor, ele só poderia dizer que o endereço responde, e isso é menos do que o consumidor confere.' }
    ],
    say: 'O que o mercado faz. No Homebrew, subir um serviço é um verbo à parte, e cada variação diz o que deixa configurado: um sobe e registra para o login, outro só sobe. O custo para o kit é que um verbo start precisaria decidir o que é saúde. Sem o handshake do motor, ele só poderia dizer que o endereço responde, e isso é menos do que o consumidor confere.' },

  { type: 'compare', title: 'Decisão 2: as opções lado a lado',
    columns: ['S1 · Não construir', 'S2 · Só mostrar', 'S3 · start', 'S4 · ensure --start'],
    rows: [
      { label: 'Muda para você', cells: ['Nada', 'Vê como subir à mão', 'Um verbo novo', 'Instala e sobe num comando'] },
      { label: 'Cobertura', cells: ['Todos pelo consumidor', 'Todos os daemons', '2 de 4 daemons', '2 de 4 daemons'] },
      { label: 'Confere o protocolo', cells: ['Sim, pelo consumidor', 'Não executa', 'Não: só o endereço de saúde', 'Não: só o endereço de saúde'] },
      { label: 'Risco', cells: ['Nenhum', 'Baixo', 'Médio: dá a ideia de motor pronto sem estar', 'Médio: o mesmo, escondido no ensure'] }
    ],
    say: 'Decisão dois, as opções. Não construir mantém tudo como está, e o protocolo continua conferido pelo consumidor. Só mostrar imprime o comando de entrada e a pasta de dados, sem executar nada. O verbo start e o ensure com start cobrem dois dos quatro daemons e não conferem o protocolo, só o endereço de saúde, o que pode dar a ideia de motor pronto sem estar.' },

  { type: 'steps', title: 'Recomendação da decisão 2: S1, não construir',
    items: [
      { title: 'A garantia do kit fica inteira', body: 'O motor só é dado como pronto depois do handshake do consumidor.' },
      { title: 'Quem usa o adaptador já tem o motor de pé', body: 'O gargalo real é o consumidor instalar pelo terminal e esperar que algo suba; o aviso do ensure já diz que quem sobe é o consumidor.' },
      { title: 'Se você quiser algo', body: 'A S2, só mostrar como subir, é a alternativa de menor risco: não executa nada e não promete saúde.' }
    ],
    say: 'Recomendo não construir. A garantia do kit fica inteira: o motor só é dado como pronto depois do handshake do consumidor. Quem usa o adaptador já tem o motor de pé, e o aviso do ensure já diz que quem sobe é o consumidor. Se você quiser algo, a alternativa de menor risco é só mostrar como subir, que não executa nada e não promete saúde.' },

  { type: 'callout', tone: 'info', title: 'Decisão 3: a pergunta',
    body: 'O kit instala e atualiza motores, mas não para nem remove. Vale ganhar o stop, o remover, os dois ou nenhum?',
    say: 'Decisão três. O kit instala e atualiza motores, mas não para nem remove nenhum. Vale ganhar o stop, o remover, os dois, ou nenhum?' },

  { type: 'cards', title: 'O que o manifest permite hoje', columns: 3,
    items: [
      { icon: 'power', title: 'Stop: três motores declaram', badge: 'stop',
        body: 'embed-house, vxk e client-harness declaram o caminho de desligar. O mcp-gateway não declara; o projeto dele recebeu o pedido para publicar esse contrato.' },
      { icon: 'folder-x', title: 'Remover: o manifest não diz o que é estado', badge: 'remover',
        body: 'Não há campo que separe a pasta do binário dos dados do usuário. neural-link e skill-engine instalam dentro de uma pasta compartilhada com a configuração.' },
      { icon: 'triangle-alert', title: 'Remover o neural-link deixa hooks órfãos', badge: 'risco',
        body: 'As declarações globais continuam apontando para o dispatcher apagado, e isso derruba todos os hooks da máquina.' }
    ],
    say: 'O que o manifest permite hoje. Para o stop, três motores declaram o caminho de desligar: embed-house, vxk e client-harness. O mcp-gateway não declara, e o projeto dele recebeu o pedido para publicar esse contrato. Para o remover, o manifest não diz o que é estado do usuário: neural-link e skill-engine instalam dentro de uma pasta compartilhada com a configuração. E remover o neural-link deixaria as declarações globais apontando para o dispatcher apagado, o que derruba todos os hooks da máquina.' },

  { type: 'cards', title: 'O que o mercado faz', columns: 2,
    items: [
      { icon: 'terminal', title: 'Homebrew: stop desregistra',
        body: 'brew services stop para o serviço e tira o registro de subir no login, a menos que se peça para manter. O efeito colateral é dito no verbo.' },
      { icon: 'package-minus', title: 'npm uninstall: remove o que instalou',
        body: 'Remove tudo o que o npm instalou em nome do pacote e atualiza package.json e o lock. A página não fala de dados do usuário nem de configuração global.' }
    ],
    say: 'O que o mercado faz. No Homebrew, o stop para o serviço e tira o registro de subir no login, a menos que se peça para manter: o efeito colateral é dito no verbo. O npm uninstall remove tudo o que o npm instalou em nome do pacote e atualiza o package json e o lock; a página não fala de dados do usuário nem de configuração global, e é nessa lacuna que o remover do kit tocaria.' },

  { type: 'compare', title: 'Decisão 3: as opções lado a lado',
    columns: ['R1 · Nenhum', 'R2 · Só o stop', 'R3 · stop e remover instalação', 'R4 · stop e remover tudo'],
    rows: [
      { label: 'Muda para você', cells: ['Nada', 'Um verbo para parar', 'Parar e apagar o binário', 'Parar e apagar binário e dados'] },
      { label: 'Cobertura', cells: ['Nenhuma', '3 de 8 motores hoje; o gateway quando publicar o contrato', 'Os motores comuns; self-managed recusados', 'O mesmo'] },
      { label: 'Risco', cells: ['Nenhum', 'Baixo: só usa o que o registry declara', 'Médio: neural-link deixa hooks órfãos sem um passo de desregistro', 'Alto: apaga estado do usuário'] },
      { label: 'Pré-requisito', cells: ['Nenhum', 'Nenhum', 'Manifest declarar o que é estado; desregistro do neural-link', 'O mesmo, mais confirmação explícita'] }
    ],
    say: 'Decisão três, as opções. Nenhum não muda nada. Só o stop dá um verbo para parar, cobre três dos oito motores hoje e o gateway quando publicar o contrato, e o risco é baixo porque só usa o que o registry declara. Parar e remover só a instalação exige que o manifest declare o que é estado e que o neural-link tenha um passo de desregistro, senão deixa hooks órfãos. Remover tudo apaga estado do usuário e o risco é alto.' },

  { type: 'steps', title: 'Recomendação da decisão 3: R2, só o stop',
    items: [
      { title: 'Construir o stop agora', body: 'Desliga pelo caminho que o registry declara e responde com clareza quando o motor não declara nenhum.' },
      { title: 'Deixar o remover para depois', body: 'Só faz sentido com um campo no manifest que separe binário de estado e com o desregistro dos hooks do neural-link.' },
      { title: 'O gateway entra sozinho', body: 'Quando o projeto do gateway publicar o contrato, o manifest passa a declará-lo e o stop passa a valer também para ele.' }
    ],
    say: 'Recomendo só o stop. Construir agora: ele desliga pelo caminho que o registry declara e responde com clareza quando o motor não declara nenhum. Deixar o remover para depois: ele só faz sentido com um campo no manifest que separe o binário do estado e com o desregistro dos hooks do neural-link. E o gateway entra sozinho: quando o projeto dele publicar o contrato, o manifest passa a declará-lo e o stop passa a valer para ele também.' },

  { type: 'html', html: decisaoHtml,
    say: 'Suas decisões. Decisão um, o ensure do neural-link: a recomendada é a opção três, registro opcional com a flag. Decisão dois, o verbo de subir: a recomendada é não construir. Decisão três, o stop e o remover: a recomendada é só o stop. Cada opção está escrita na tela, com o que muda.' },

  { type: 'table', title: 'De onde vem cada afirmação', head: ['Afirmação', 'Fonte', 'Endereço', 'Acessado em'],
    rows: [
      ['O install escreve uma declaração por evento na pasta global de hooks, remove as de eventos sem handler e avisa do risco de caminho que some', 'Código do neural-link', 'neural-link/src/install.js', '12/11/2026'],
      ['Registro manual por padrão, campo registration manual ou auto', 'Pesquisa do neural-link (06/04/2026)', 'neural-link/docs/research/auto-register-toggle-watcher.md', '12/11/2026'],
      ['A barra lateral mostra hooks não registrados e registra com um clique; o registro é um ato visível', 'Pesquisa do skill-repo (06/04/2026)', 'skill-repo/docs/research/neural-link-registration-toggle-available-hooks.md', '12/11/2026'],
      ['A barra lateral lê o config e o expõe; o registro fica no config global', 'Pesquisa do skill-repo (06/04/2026)', 'skill-repo/docs/research/sidebar-neural-link-handlers-visibility.md', '12/11/2026'],
      ['Higiene do Temp: nada fica na raiz do Temp; a geração do quadro usa a pasta de trabalho do projeto', 'Relatório da investigação (08/11/2026)', 'investigação/docs/research/2026-11-08-temp-investigacao-relatorio-final.md', '12/11/2026'],
      ['O kit não adivinha a saúde do motor; adaptadores dos motores; self-managed', 'README do engine-registry', 'README.md', '12/11/2026'],
      ['Quais motores declaram healthPath e shutdownPath', 'Manifest do registry', 'manifest.json', '12/11/2026'],
      ['Backlog aberto e decididos', 'Backlog do registry', 'docs/BACKLOG.md', '12/11/2026'],
      ['Husky: registrar é um passo explícito; HUSKY igual a zero desliga', 'Documentação do Husky', 'https://typicode.github.io/husky/how-to.html', '12/11/2026'],
      ['brew services start, stop e run; stop desregistra do login a menos que se use keep', 'Manual do Homebrew', 'https://docs.brew.sh/Manpage', '12/11/2026'],
      ['npm uninstall remove o que o npm instalou; a página não trata de dados do usuário', 'Documentação do npm', 'https://docs.npmjs.com/cli/v10/commands/npm-uninstall', '12/11/2026']
    ],
    say: 'Por fim, as fontes. O código do install do neural-link, as três pesquisas dos projetos neural-link e skill-repo sobre o registro de hooks, o relatório de higiene do Temp, o README e o manifest do registry, e três documentações públicas: Husky, Homebrew e npm, todas acessadas em doze de novembro de dois mil e vinte e seis.' }
];

const spec = {
  engine: 'vxk', mode: 'board',
  title: 'Três decisões do engine-kit que mudam o uso', slug: 'engine-registry-tres-decisoes-engine-kit',
  badge: 'VXK · board · engine-registry · 12/11/2026', accent: '#ffc15e',
  language: 'pt-BR', narrate: true, voice: 'pt-BR-Chirp3-HD-Iapetus', voiceStrict: true,
  intro: 'Três decisões sobre o engine-kit: registrar os hooks do neural-link pelo ensure, um verbo para subir um motor, e o stop com o remover.',
  labels: { explain: '▶ Apresentar', pause: '⏸ Pausar', resume: '▶ Continuar', prev: '◀ Anterior', next: 'Próximo ▶', index: '☰ Índice', indexTitle: 'Tópicos', indexClose: 'Fechar' },
  blocks
};
writeFileSync(join(HERE, '2026-11-12-board-tres-decisoes-do-engine-kit.json'), JSON.stringify(spec, null, 2) + '\n');
console.log(`2026-11-12-board-tres-decisoes-do-engine-kit.json: ${blocks.length} blocos`);
