/* ══════════════════════════════════════════════════════════════════════
   CHAT WIDGET DA GUIDE — componente compartilhado (painel + institucional)
   ----------------------------------------------------------------------
   Dois formatos (layout):
     • BOLHA (institucional): bolha flutuante → painel com TELA INICIAL (home)
       das conversas e, ao escolher, a conversa.
     • EXPANDIDO (painel do cliente): overlay grande com ABA LATERAL à esquerda
       (Gui + opções "Sobre a plataforma" / "Sobre o seu projeto" + conversas)
       e o CHAT já aberto à direita. Passe `expandido: true` no init.

   Uso:
     GuideChat.init({ sb, origem, clienteId, clienteNome, expandido, onUnread });
     GuideChat.open(); GuideChat.close(); GuideChat.toggle();

   Depende de: chat-widget.css e das tabelas chat_conversas / chat_mensagens
   (supabase-migration-chat.sql — colunas `titulo` e `assunto`).
   ══════════════════════════════════════════════════════════════════════ */

window.GuideChat = (function () {
  'use strict';

  var cfg = null, sb = null;
  var uid = null;
  var conversas = [];
  var ultimaMsg = {};
  var conversa = null;
  var pendente = null;
  var canalMsg = null, canalConv = null;
  var aberto = false, enviando = false, iniciado = false;
  var preparado = false, preparando = null;
  var vistos = {};
  var el = {};
  var botNo = 'inicio';   // nó atual da árvore de botões
  var botOpcoes = null;   // opções (botões) mostradas agora

  var SVG = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    agent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 11V3H7v8"/><path d="M4 11h16a1 1 0 0 1 1 1v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a1 1 0 0 1 1-1z"/><circle cx="8.5" cy="15.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    proj: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
  };

  var FRASE_ABERTURA = 'A gente te entende, a gente te atende.';
  var MSG_MENU = 'Posso te ajudar com os atalhos abaixo 👇 Se preferir, é só tocar em "Falar com atendimento".';

  // ── Árvore do bot de botões (Fase 1 — sem IA) ─────────────────────────────
  // Cada nó: { texto, opcoes: [ {txt, vai} | {txt, url} | {txt, acao:'handoff'} ] }
  // {NOME} no texto é trocado pelo primeiro nome do cliente (quando houver).
  var _menu   = { txt: '⬅ Voltar ao menu', vai: 'inicio' };
  var _hSite  = { txt: 'Falar com uma pessoa', acao: 'handoff' };
  var _hPain  = { txt: 'Falar com a Guide', acao: 'handoff' };
  var _contr  = { txt: 'Quero contratar', url: '/contratar' };
  var _fimP   = [_menu, _hPain];

  var FLUXOS = {
    institucional: {
      inicio: { texto: 'Oi! 👋 Eu sou o Gui, da Guide. Como posso te ajudar?', opcoes: [
        { txt: 'O que é a Guide?', vai: 'oque' },
        { txt: 'Como funciona?', vai: 'como' },
        { txt: 'Planos e preços', vai: 'planos' },
        { txt: 'Prazos e revisões', vai: 'prazos' },
        { txt: 'Pagamento e cancelamento', vai: 'pagcanc' },
        _contr, _hSite
      ]},
      oque: { texto: 'A Guide cuida do seu projeto de interiores depois da entrega das chaves — 100% pela plataforma, sem visita presencial. A gente transforma o seu apê em um lar com a sua cara. 💛', opcoes: [
        { txt: 'Como funciona?', vai: 'como' }, { txt: 'Planos e preços', vai: 'planos' }, _hSite, _menu ]},
      como: { texto: 'São 5 etapas, tudo pela plataforma:\n1️⃣ Contratação (você informa a metragem e vê o valor na hora)\n2️⃣ Briefing e Conceito Visual\n3️⃣ Layout 2D\n4️⃣ Imagens 3D\n5️⃣ Guia Final de Reforma\n\n➕ Ainda tem o Controle de Obra. O projeto leva cerca de 45 dias.', opcoes: [
        { txt: 'Planos e preços', vai: 'planos' }, _contr, _hSite, _menu ]},
      planos: { texto: 'O valor é por m² do seu imóvel:\n• Essencial — R$ 20/m²\n• Visual — R$ 40/m²\n• Completo — R$ 60/m²\n\nQuer ver o que cada um inclui?', opcoes: [
        { txt: 'Ver Essencial', vai: 'pEss' }, { txt: 'Ver Visual', vai: 'pVis' }, { txt: 'Ver Completo', vai: 'pCom' }, _contr, _menu ]},
      pEss: { texto: 'Plano Essencial — R$ 20/m²:\n✓ Acesso à plataforma Guide completa\n✓ Indicação de profissionais para a obra\n✓ Plataforma de controle da obra\n✓ Assessoria guiada pós entrega das chaves', opcoes: [
        { txt: 'Ver Visual', vai: 'pVis' }, { txt: 'Ver Completo', vai: 'pCom' }, _contr, _menu ]},
      pVis: { texto: 'Plano Visual — R$ 40/m²:\n✓ Tudo do Essencial\n✓ Projeto visual personalizado de referência: Layout 2D e Imagens 3D', opcoes: [
        { txt: 'Ver Essencial', vai: 'pEss' }, { txt: 'Ver Completo', vai: 'pCom' }, _contr, _menu ]},
      pCom: { texto: 'Plano Completo — R$ 60/m²:\n✓ Tudo do Visual\n✓ Especificações completas: materiais, quantidades, dimensões gerais e links de compra', opcoes: [
        { txt: 'Ver Essencial', vai: 'pEss' }, { txt: 'Ver Visual', vai: 'pVis' }, _contr, _menu ]},
      prazos: { texto: 'O projeto leva cerca de 45 dias, com as etapas na trilha da plataforma. Você tem 2 revisões no Layout e 2 nas Imagens 3D pra chegar no resultado ideal.', opcoes: [
        { txt: 'Como funciona?', vai: 'como' }, { txt: 'Planos e preços', vai: 'planos' }, _hSite, _menu ]},
      pagcanc: { texto: 'Pagamento: Pix ou cartão.\nCancelamento: até 7 dias após a compra, se nenhuma etapa foi entregue, com reembolso integral. Depois disso, o projeto pode ser pausado por até 30 dias.', opcoes: [
        { txt: 'Planos e preços', vai: 'planos' }, _hSite, _menu ]}
    },
    plataforma: {
      inicio: { texto: 'Oi{NOME}! 👋 Posso te explicar como usar a plataforma. O que você quer ver?', opcoes: [
        { txt: 'Meus cadernos', vai: 'cadernos' },
        { txt: 'Meu Diário', vai: 'diario' },
        { txt: 'Mural de imagens', vai: 'mural' },
        { txt: 'Parceiros Guide', vai: 'parceiros' },
        { txt: 'Controle de obra', vai: 'obra' },
        { txt: 'Minha conta e plano', vai: 'conta' },
        _hPain
      ]},
      cadernos: { texto: 'Seus cadernos são as etapas do projeto: Layout, Imagens 3D, Executivo e Obra. É só tocar em cada card no painel para abrir, ver os arquivos e acompanhar o andamento.', opcoes: _fimP },
      diario: { texto: 'O Diário é o seu espaço pessoal do projeto — registros, a Cápsula do Tempo e as memórias da jornada do seu novo lar. Fica no card "Seu Diário".', opcoes: _fimP },
      mural: { texto: 'No Mural de imagens você guarda e organiza fotos e referências: dá para usar tags, comparar antes/depois e receber sugestões. Fica no card "Mural de imagens".', opcoes: _fimP },
      parceiros: { texto: 'Em Parceiros Guide você encontra profissionais indicados para executar a obra e pede orçamentos por categoria, direto pelo painel.', opcoes: _fimP },
      obra: { texto: 'O Controle de Obra organiza sua reforma — categorias, orçamentos e acompanhamento, tudo em um lugar só. Fica no card da Obra.', opcoes: _fimP },
      conta: { texto: 'Em "Sua Conta" você vê seu plano e o que ele inclui, o termo que aceitou, e pode alterar o plano ou cancelar a contratação.', opcoes: [
        { txt: 'Trocar ou cancelar plano', vai: 'contaAcao' }, _menu, _hPain ]},
      contaAcao: { texto: 'É rapidinho: abra "Sua Conta" no seu perfil e toque em "Alterar plano" ou em "Cancelar contratação" no fim do card. Quer que eu chame alguém para te ajudar?', opcoes: [ _hPain, _menu ]}
    },
    projeto: {
      inicio: { texto: 'Dúvidas do seu projeto (andamento, prazo, revisões) quem resolve melhor é a equipe. Posso adiantar algumas coisas:', opcoes: [
        { txt: 'Qual o prazo do meu projeto', vai: 'prazo' },
        { txt: 'Pedir uma revisão', vai: 'revisao' },
        { txt: 'Trocar ou cancelar plano', vai: 'plano' },
        _hPain
      ]},
      prazo: { texto: 'O prazo geral é de cerca de 45 dias, com as etapas na trilha da plataforma. Para saber exatamente em que ponto o seu está, é melhor falar com a equipe. 👇', opcoes: [ _hPain, _menu ]},
      revisao: { texto: 'Você tem 2 revisões no Layout e 2 nas Imagens 3D. Para pedir uma revisão, fale com a equipe que a gente registra para você. 👇', opcoes: [ _hPain, _menu ]},
      plano: { texto: 'Isso você faz em "Sua Conta": "Alterar plano" ou "Cancelar contratação". Se quiser, chamo alguém para te acompanhar. 👇', opcoes: [ _hPain, _menu ]}
    }
  };

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, function (s) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[s];
    });
  }
  function hora(iso) {
    try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function primeiroNome(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
  function assuntoLabel(a) { return a === 'plataforma' ? 'Sobre a plataforma' : a === 'projeto' ? 'Sobre o seu projeto' : 'Conversa'; }
  function tituloPadrao(a) { return (a === 'plataforma' || a === 'projeto') ? assuntoLabel(a) : 'Nova conversa'; }
  function tituloDe(c) { return (c && c.titulo) ? c.titulo : (c && c.assunto) ? assuntoLabel(c.assunto) : 'Conversa'; }

  // ── blocos de HTML ──────────────────────────────────────────────────────
  function chatBloco() {
    return '<div class="gc-chat">' +
        '<div class="gc-header">' +
          '<button class="gc-back" type="button" aria-label="Voltar">' + SVG.back + '</button>' +
          '<div class="gc-avatar">' + (cfg.expandido ? SVG.chat : '<img src="' + esc(cfg.avatarUrl) + '" alt="Gui">') + '</div>' +
          '<div class="gc-head-txt">' +
            '<div class="gc-head-title-row"></div>' +
            '<div class="gc-head-sub"><span class="gc-status-pip"></span><span class="gc-status-txt"></span></div>' +
          '</div>' +
          '<button class="gc-close" type="button" aria-label="Fechar">' + SVG.close + '</button>' +
        '</div>' +
        '<div class="gc-body"></div>' +
        '<div class="gc-footer">' +
          '<button class="gc-handoff" type="button">' + SVG.agent + ' Falar com atendimento</button>' +
          '<div class="gc-input-row">' +
            '<textarea class="gc-input" rows="1" placeholder="Escreva sua mensagem..."></textarea>' +
            '<button class="gc-send" type="button" aria-label="Enviar">' + SVG.send + '</button>' +
          '</div>' +
          '<div class="gc-powered">Guide Arquitetura</div>' +
        '</div>' +
      '</div>';
  }

  function construir() {
    var root = document.createElement('div');
    root.className = 'gc-root ' + (cfg.origem === 'institucional' ? 'gc-institucional' : 'gc-painel') + (cfg.expandido ? ' gc-expandido' : '');

    if (cfg.expandido) {
      root.innerHTML =
        '<div class="gc-overlay"><div class="gc-dock">' +
          '<aside class="gc-side">' +
            '<div class="gc-side-head">' +
              '<img class="gc-side-gui" src="' + esc(cfg.avatarUrl) + '" alt="Gui">' +
              '<div class="gc-side-nome">Central de ajuda</div>' +
              '<p class="gc-side-intro">Oi! Eu sou o Gui, seu assistente da Guide. Aqui você tira suas dúvidas comigo — sobre o funcionamento da plataforma, as etapas do seu projeto e os materiais que você recebeu. Se preferir, te levo até um dos nossos atendentes.</p>' +
            '</div>' +
            '<div class="gc-side-opts"></div>' +
            '<div class="gc-side-sec">Suas conversas</div>' +
            '<div class="gc-side-list"></div>' +
            '<div class="gc-side-soon">Em breve: tutoriais e novidades da Guide.</div>' +
          '</aside>' +
          chatBloco() +
        '</div></div>';
    } else {
      root.innerHTML =
        (cfg.bubble ? '<button class="gc-bubble" type="button" aria-label="Abrir conversa">' + SVG.chat + '<span class="gc-dot"></span></button>' : '') +
        '<div class="gc-panel" role="dialog" aria-label="Conversa com a Guide">' +
          '<div class="gc-home"></div>' + chatBloco() +
        '</div>';
    }
    document.body.appendChild(root);

    el.root = root;
    el.body = root.querySelector('.gc-body');
    el.back = root.querySelector('.gc-back');
    el.close = root.querySelector('.gc-chat .gc-close');
    el.handoff = root.querySelector('.gc-handoff');
    el.input = root.querySelector('.gc-input');
    el.send = root.querySelector('.gc-send');
    el.headSub = root.querySelector('.gc-head-sub');
    el.statusTxt = root.querySelector('.gc-status-txt');
    el.titleRow = root.querySelector('.gc-head-title-row');

    if (cfg.expandido) {
      el.overlay = root.querySelector('.gc-overlay');
      el.side = root.querySelector('.gc-side');
      el.sideOpts = root.querySelector('.gc-side-opts');
      el.sideList = root.querySelector('.gc-side-list');
      el.overlay.addEventListener('click', function (e) { if (e.target === el.overlay) close(); });
    } else {
      el.bubble = root.querySelector('.gc-bubble');
      el.dot = root.querySelector('.gc-dot');
      el.home = root.querySelector('.gc-home');
      if (el.bubble) el.bubble.addEventListener('click', toggle);
    }

    el.close.addEventListener('click', close);
    el.back.addEventListener('click', function () {
      if (cfg.expandido) el.root.classList.remove('gc-em-chat'); else irParaHome();
    });
    el.send.addEventListener('click', enviar);
    el.handoff.addEventListener('click', falarComAtendimento);
    el.input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });
    el.input.addEventListener('input', function () { el.input.style.height = 'auto'; el.input.style.height = Math.min(el.input.scrollHeight, 110) + 'px'; });
  }

  // ── aba lateral (modo expandido) ────────────────────────────────────────
  function renderSidebar() {
    if (!cfg.expandido) return;
    el.sideOpts.innerHTML =
      optBtn('plataforma', SVG.layers, 'Sobre a plataforma') +
      optBtn('projeto', SVG.proj, 'Sobre o seu projeto');
    el.sideOpts.querySelectorAll('.gc-opt').forEach(function (b) {
      b.addEventListener('click', function () { el.root.classList.add('gc-em-chat'); novaConversa(b.getAttribute('data-assunto')); });
    });

    if (!conversas.length) {
      el.sideList.innerHTML = '<div class="gc-side-vazio">' + (uid ? 'Nenhuma conversa ainda.' : 'Sem conexão agora.') + '</div>';
      return;
    }
    el.sideList.innerHTML = conversas.map(function (c) {
      var m = ultimaMsg[c.id];
      var prev = m ? ((m.remetente === 'usuario' ? 'Você: ' : m.remetente === 'atendente' ? 'Guide: ' : '') + m.conteudo) : 'Sem mensagens';
      var alerta = (c.status === 'em_atendimento' || c.status === 'pendente') ? '<span class="gc-conv-pip"></span>' : '';
      return '<button class="gc-side-item" type="button" data-id="' + esc(c.id) + '">' +
          '<span class="gc-side-item-nome">' + alerta + esc(tituloDe(c)) + '</span>' +
          '<span class="gc-side-item-prev">' + esc(prev) + '</span>' +
        '</button>';
    }).join('');
    el.sideList.querySelectorAll('.gc-side-item').forEach(function (b) {
      b.addEventListener('click', function () { el.root.classList.add('gc-em-chat'); abrirConversaPorId(b.getAttribute('data-id')); });
    });
    marcarAtivoSidebar();
  }
  function optBtn(assunto, icon, titulo) {
    return '<button class="gc-opt" type="button" data-assunto="' + esc(assunto) + '">' +
      '<span class="gc-opt-ic">' + icon + '</span><span class="gc-opt-tx">' + esc(titulo) + '</span>' +
      '<span class="gc-opt-ch">' + SVG.chevron + '</span></button>';
  }
  function marcarAtivoSidebar() {
    if (!cfg.expandido || !el.sideList) return;
    var id = conversa ? conversa.id : null;
    el.sideList.querySelectorAll('.gc-side-item').forEach(function (b) { b.classList.toggle('ativo', b.getAttribute('data-id') === id); });
  }

  // ── tela inicial (modo bolha) ───────────────────────────────────────────
  function renderHome() {
    var greet = 'Olá' + (cfg.clienteNome ? ', ' + esc(primeiroNome(cfg.clienteNome)) : '') + '!';
    var novos = botaoNovo('geral', SVG.chat, 'Iniciar uma conversa', 'A gente responde por aqui');
    var lista;
    if (!conversas.length) {
      lista = '<div class="gc-home-vazio">' + (uid ? 'Você ainda não tem conversas. Comece uma acima.' : 'Não foi possível conectar o chat agora.') + '</div>';
    } else {
      lista = conversas.map(function (c) {
        var m = ultimaMsg[c.id];
        var prev = m ? ((m.remetente === 'usuario' ? 'Você: ' : m.remetente === 'atendente' ? 'Guide: ' : '') + m.conteudo) : 'Sem mensagens ainda';
        var alerta = (c.status === 'em_atendimento' || c.status === 'pendente') ? '<span class="gc-conv-pip"></span>' : '';
        return '<button class="gc-conv-item" type="button" data-id="' + esc(c.id) + '">' +
            '<span class="gc-conv-ic">' + SVG.chat + '</span>' +
            '<span class="gc-conv-mid"><span class="gc-conv-nome">' + alerta + esc(tituloDe(c)) + '</span><span class="gc-conv-prev">' + esc(prev) + '</span></span>' +
            '<span class="gc-conv-meta"><span class="gc-conv-time">' + hora(c.atualizado_em) + '</span></span>' +
          '</button>';
      }).join('');
    }
    el.home.innerHTML =
      '<div class="gc-home-head">' +
        '<button class="gc-close gc-close-home" type="button" aria-label="Fechar">' + SVG.close + '</button>' +
        '<div class="gc-home-ava"><img src="' + esc(cfg.avatarUrl) + '" alt="Gui"></div>' +
        '<div class="gc-home-greet">' + greet + '<span>Como podemos ajudar?</span></div>' +
      '</div>' +
      '<div class="gc-home-body">' +
        '<div class="gc-home-sec">Começar uma conversa</div><div class="gc-new">' + novos + '</div>' +
        '<div class="gc-home-sec">Suas conversas</div><div class="gc-conv-list">' + lista + '</div>' +
        '<div class="gc-home-hint">' + esc(FRASE_ABERTURA) + '</div>' +
      '</div>';
    el.home.querySelector('.gc-close-home').addEventListener('click', close);
    el.home.querySelectorAll('.gc-newbtn').forEach(function (b) { b.addEventListener('click', function () { novaConversa(b.getAttribute('data-assunto')); }); });
    el.home.querySelectorAll('.gc-conv-item').forEach(function (b) { b.addEventListener('click', function () { abrirConversaPorId(b.getAttribute('data-id')); }); });
  }
  function botaoNovo(assunto, icon, titulo, sub) {
    return '<button class="gc-newbtn" type="button" data-assunto="' + esc(assunto) + '">' +
        '<span class="gc-newbtn-ic">' + icon + '</span>' +
        '<span class="gc-newbtn-tx"><strong>' + esc(titulo) + '</strong><small>' + esc(sub) + '</small></span>' +
        '<span class="gc-newbtn-ch">' + SVG.plus + '</span></button>';
  }

  // ── título editável ─────────────────────────────────────────────────────
  function setTitulo(txt) {
    el.titleRow.innerHTML = '<span class="gc-head-title">' + esc(txt) + '</span>' +
      '<button class="gc-rename" type="button" aria-label="Renomear conversa">' + SVG.edit + '</button>';
    el.titleRow.querySelector('.gc-rename').addEventListener('click', iniciarRename);
  }
  function iniciarRename() {
    var atual = el.titleRow.querySelector('.gc-head-title').textContent;
    el.titleRow.innerHTML = '<input class="gc-title-input" maxlength="60" value="' + esc(atual) + '">';
    var inp = el.titleRow.querySelector('.gc-title-input'); inp.focus(); inp.select();
    var feito = false;
    function salvar() { if (feito) return; feito = true; var novo = (inp.value || '').trim() || atual; setTitulo(novo); persistirTitulo(novo); }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } else if (e.key === 'Escape') { inp.value = atual; inp.blur(); } });
    inp.addEventListener('blur', salvar);
  }
  function persistirTitulo(novo) {
    if (conversa) {
      conversa.titulo = novo;
      var c = conversas.filter(function (x) { return x.id === conversa.id; })[0]; if (c) c.titulo = novo;
      sb.from('chat_conversas').update({ titulo: novo }).eq('id', conversa.id).then(function () {});
      if (cfg.expandido) renderSidebar();
    } else if (pendente) { pendente.titulo = novo; }
  }

  // ── mensagens ───────────────────────────────────────────────────────────
  function mostrarVazio() {
    el.body.innerHTML = '<div class="gc-welcome"><strong>Olá' +
      (cfg.clienteNome ? ', ' + esc(primeiroNome(cfg.clienteNome)) : '') +
      '!</strong><br>Escreva sua mensagem abaixo que a gente te responde.</div>';
  }
  function render(msgs) { el.body.innerHTML = ''; vistos = {}; if (!msgs || !msgs.length) { mostrarVazio(); return; } msgs.forEach(addMensagem); scrollFim(); }
  function addMensagem(m) {
    if (!m || vistos[m.id]) return; vistos[m.id] = true;
    var w = el.body.querySelector('.gc-welcome'); if (w) w.remove();
    var q = el.body.querySelector('.gc-quick'); if (q) q.remove(); // botões sempre no fim
    var meu = m.remetente === 'usuario';
    var div = document.createElement('div'); div.className = 'gc-msg ' + (meu ? 'me' : 'them');
    var label = m.remetente === 'atendente' ? 'Atendimento Guide' : m.remetente === 'bot' ? 'Guia Guide' : '';
    div.innerHTML = (label ? '<div class="gc-msg-label">' + esc(label) + '</div>' : '') +
      '<div class="gc-bubble-msg">' + esc(m.conteudo) + '</div><div class="gc-msg-time">' + hora(m.criado_em) + '</div>';
    el.body.appendChild(div);
  }
  function addNota(txt) { var d = document.createElement('div'); d.className = 'gc-note'; d.textContent = txt; el.body.appendChild(d); scrollFim(); }
  function scrollFim() { el.body.scrollTop = el.body.scrollHeight; }

  // ── Motor do bot de botões ────────────────────────────────────────────────
  function fluxoCtx() {
    if (cfg.origem === 'institucional') return FLUXOS.institucional;
    var a = (conversa && conversa.assunto) || (pendente && pendente.assunto) || 'plataforma';
    return FLUXOS[a] || FLUXOS.plataforma;
  }
  function noAtual() { var f = fluxoCtx(); return f[botNo] || f.inicio; }
  function textoNo(no) { return String(no && no.texto || '').replace('{NOME}', cfg.clienteNome ? ', ' + primeiroNome(cfg.clienteNome) : ''); }
  function bolhaBotLocal(texto) {
    var div = document.createElement('div'); div.className = 'gc-msg them';
    div.innerHTML = '<div class="gc-msg-label">Guia Guide</div><div class="gc-bubble-msg">' + esc(texto) + '</div>';
    el.body.appendChild(div); scrollFim();
  }
  function pintarOpcoes() {
    var old = el.body.querySelector('.gc-quick'); if (old) old.remove();
    if (!botOpcoes || !botOpcoes.length) return;
    if (conversa && (conversa.status === 'em_atendimento' || conversa.status === 'resolvido')) return;
    var wrap = document.createElement('div'); wrap.className = 'gc-quick';
    botOpcoes.forEach(function (op) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'gc-quick-btn'; b.textContent = op.txt;
      b.addEventListener('click', function () { escolherOpcao(op); });
      wrap.appendChild(b);
    });
    el.body.appendChild(wrap); scrollFim();
  }
  function mostrarBoasVindas() {
    el.body.innerHTML = ''; vistos = {}; botNo = 'inicio';
    var no = fluxoCtx().inicio;
    bolhaBotLocal(textoNo(no));
    botOpcoes = no.opcoes; pintarOpcoes();
  }
  async function garantirConversa() {
    if (!preparado) await preparar();
    if (!uid) { addNota('Não foi possível conectar. Recarregue a página e tente de novo.'); return false; }
    if (!conversa) { if (!(await criarConversa())) { addNota('Não consegui iniciar a conversa. Tente de novo.'); return false; } }
    return true;
  }
  async function inserirMsg(remetente, texto) {
    var r = await sb.from('chat_mensagens').insert({ conversa_id: conversa.id, remetente: remetente, conteudo: texto }).select().single();
    if (r.error) { console.error('[GuideChat] inserir msg:', r.error); return null; }
    addMensagem(r.data); scrollFim(); ultimaMsg[conversa.id] = r.data; return r.data;
  }
  async function escolherOpcao(op) {
    if (enviando || !op) return;
    botOpcoes = null; pintarOpcoes();
    enviando = true; el.send && el.send.setAttribute('disabled', 'disabled');
    try {
      if (!(await garantirConversa())) return;
      await inserirMsg('usuario', op.txt);
      if (op.acao === 'handoff') { tocarConversa(); enviando = false; el.send && el.send.removeAttribute('disabled'); return falarComAtendimento(); }
      if (op.url) {
        botNo = 'inicio';
        await inserirMsg('bot', 'Abri a página em outra aba para você. 👉 Qualquer dúvida, é só voltar aqui!');
        tocarConversa(); botOpcoes = fluxoCtx().inicio.opcoes; pintarOpcoes();
        try { window.open(op.url, '_blank', 'noopener'); } catch (e) {}
        if (cfg.expandido) renderSidebar();
        return;
      }
      var destino = op.vai || 'inicio'; var f = fluxoCtx(); var no = f[destino] || f.inicio;
      botNo = destino;
      await inserirMsg('bot', textoNo(no));
      tocarConversa(); botOpcoes = no.opcoes; pintarOpcoes();
      if (cfg.expandido) renderSidebar();
    } catch (e) { console.error('[GuideChat] opção:', e); addNota('Algo falhou. Tente novamente.'); }
    finally { enviando = false; el.send && el.send.removeAttribute('disabled'); }
  }
  function refletirStatus() {
    if (!conversa) { el.headSub.classList.remove('at'); el.statusTxt.textContent = FRASE_ABERTURA; return; }
    el.headSub.classList.toggle('at', conversa.status === 'em_atendimento');
    el.statusTxt.textContent = conversa.status === 'em_atendimento' ? 'Você está falando com a equipe'
      : conversa.status === 'pendente' ? 'Avisamos a equipe — já te respondem'
      : conversa.status === 'resolvido' ? 'Conversa encerrada' : FRASE_ABERTURA;
  }

  // ── navegação ───────────────────────────────────────────────────────────
  function irParaHome() {
    desassinar(); conversa = null; pendente = null;
    el.root.classList.remove('gc-em-chat');
    carregarConversas().then(renderHome);
  }
  function irParaChat(conv, assunto) {
    desassinar(); vistos = {};
    conversa = conv || null;
    pendente = conv ? null : { assunto: assunto || null, titulo: tituloPadrao(assunto) };
    if (!cfg.expandido) el.root.classList.add('gc-em-chat');
    el.handoff.removeAttribute('disabled');
    setTitulo(conv ? tituloDe(conv) : pendente.titulo);
    if (conv) {
      if (conv.status === 'resolvido') el.handoff.setAttribute('disabled', 'disabled');
      carregarMensagens(conv.id); refletirStatus(); assinar();
    } else { refletirStatus(); mostrarBoasVindas(); }
    if (cfg.expandido) marcarAtivoSidebar();
    setTimeout(function () { el.input && el.input.focus(); scrollFim(); }, 120);
  }
  function abrirConversaPorId(id) { var c = conversas.filter(function (x) { return x.id === id; })[0]; if (c) irParaChat(c); }
  function novaConversa(assunto) { irParaChat(null, assunto); }

  // ── abrir / fechar ──────────────────────────────────────────────────────
  function open() {
    aberto = true; el.root.classList.add('gc-aberto');
    if (el.dot) el.dot.style.display = 'none';
    if (cfg.onUnread) cfg.onUnread(false);
    document.addEventListener('keydown', escHandler);
    (preparado ? Promise.resolve() : preparar()).then(function () {
      if (cfg.expandido) {
        carregarConversas().then(function () {
          renderSidebar();
          el.root.classList.remove('gc-em-chat'); // mobile começa na lista
          if (conversas.length) irParaChat(conversas[0]); else irParaChat(null, null);
        });
      } else { irParaHome(); }
    });
  }
  function close() { aberto = false; el.root.classList.remove('gc-aberto'); document.removeEventListener('keydown', escHandler); }
  function toggle() { aberto ? close() : open(); }
  function escHandler(e) { if (e.key === 'Escape') close(); }

  function avisarNova() {
    if (aberto && (cfg.expandido || el.root.classList.contains('gc-em-chat'))) return;
    if (el.dot) el.dot.style.display = 'block';
    if (cfg.onUnread) cfg.onUnread(true);
  }

  // ── Supabase ────────────────────────────────────────────────────────────
  async function garantirSessao() {
    var res = await sb.auth.getSession();
    var sessao = res && res.data ? res.data.session : null;
    if (!sessao) {
      if (cfg.origem === 'institucional') {
        if (typeof sb.auth.signInAnonymously !== 'function') { console.error('[GuideChat] supabase-js sem login anônimo (use 2.43+).'); return null; }
        var a = await sb.auth.signInAnonymously();
        if (a.error) { console.error('[GuideChat] login anônimo falhou:', a.error); return null; }
        sessao = a.data.session;
      } else { return null; }
    }
    return sessao && sessao.user ? sessao.user.id : null;
  }
  function preparar() {
    if (preparado) return Promise.resolve();
    if (preparando) return preparando;
    preparando = (async function () { uid = await garantirSessao(); preparado = true; })();
    return preparando;
  }
  async function carregarConversas() {
    conversas = []; ultimaMsg = {};
    if (!uid) return;
    var q = sb.from('chat_conversas').select('*').eq('origem', cfg.origem).order('atualizado_em', { ascending: false });
    if (cfg.origem === 'institucional') q = q.eq('visitante_id', uid); else q = q.eq('cliente_id', cfg.clienteId);
    var r = await q;
    if (r.error) { console.error('[GuideChat] listar conversas:', r.error); return; }
    conversas = r.data || [];
    if (conversas.length) {
      var ids = conversas.map(function (c) { return c.id; });
      var mm = await sb.from('chat_mensagens').select('conversa_id,conteudo,remetente,criado_em').in('conversa_id', ids).order('criado_em', { ascending: false });
      (mm.data || []).forEach(function (m) { if (!ultimaMsg[m.conversa_id]) ultimaMsg[m.conversa_id] = m; });
    }
  }
  async function carregarMensagens(id) {
    var m = await sb.from('chat_mensagens').select('*').eq('conversa_id', id).order('criado_em', { ascending: true });
    if (m.error) { console.error('[GuideChat] mensagens:', m.error); render([]); return; }
    render(m.data || []);
    // reabrir conversa ainda no bot → mostra o menu de botões de novo
    if (conversa && conversa.status === 'bot') { botNo = 'inicio'; botOpcoes = fluxoCtx().inicio.opcoes; pintarOpcoes(); }
    else { botOpcoes = null; }
  }
  async function criarConversa() {
    var assunto = pendente ? pendente.assunto : (cfg.origem === 'painel' ? 'plataforma' : null);
    var titulo = (pendente && pendente.titulo) ? pendente.titulo : tituloPadrao(assunto);
    var linha = { origem: cfg.origem, status: 'bot', assunto: assunto, titulo: titulo };
    if (cfg.origem === 'institucional') { linha.visitante_id = uid; if (cfg.clienteNome) linha.visitante_nome = cfg.clienteNome; }
    else { linha.cliente_id = cfg.clienteId; }
    var r = await sb.from('chat_conversas').insert(linha).select().single();
    if (r.error) { console.error('[GuideChat] criar conversa:', r.error); return null; }
    conversa = r.data; pendente = null; conversas.unshift(conversa);
    assinar(); if (cfg.expandido) renderSidebar();
    return conversa;
  }
  function desassinar() {
    if (canalMsg) { try { sb.removeChannel(canalMsg); } catch (e) {} canalMsg = null; }
    if (canalConv) { try { sb.removeChannel(canalConv); } catch (e) {} canalConv = null; }
  }
  function assinar() {
    if (!conversa || canalMsg) return;
    canalMsg = sb.channel('gc-msg-' + conversa.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_mensagens', filter: 'conversa_id=eq.' + conversa.id },
        function (payload) {
          var m = payload.new; if (vistos[m.id]) return;
          addMensagem(m); scrollFim(); ultimaMsg[m.conversa_id] = m;
          if (m.remetente === 'atendente') botOpcoes = null;
          pintarOpcoes();
          if (cfg.expandido) renderSidebar();
          if (m.remetente !== 'usuario') avisarNova();
        }).subscribe();
    canalConv = sb.channel('gc-conv-' + conversa.id)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_conversas', filter: 'id=eq.' + conversa.id },
        function (payload) {
          var antes = conversa ? conversa.status : null; conversa = payload.new; refletirStatus();
          if (conversa.status === 'em_atendimento' && antes !== 'em_atendimento') { addNota('Um atendente da Guide entrou na conversa.'); el.handoff.setAttribute('disabled', 'disabled'); }
          if (conversa.status === 'resolvido' && antes !== 'resolvido') addNota('A equipe marcou esta conversa como resolvida.');
          if (cfg.expandido) renderSidebar();
        }).subscribe();
  }
  function tocarConversa() {
    var agora = new Date().toISOString(); if (conversa) conversa.atualizado_em = agora;
    try { sb.from('chat_conversas').update({ atualizado_em: agora }).eq('id', conversa.id).then(function () {}); } catch (e) {}
  }
  // Resposta a TEXTO LIVRE (Fase 1 = bot de botões). Quando a pessoa digita em vez
  // de clicar, o bot reexibe os atalhos do nó atual. (Fase 2 trocará isto por IA.)
  async function processarMensagemBot(conversaId) {
    if (!conversa || conversa.status !== 'bot') return;
    var no = noAtual();
    try {
      var r = await sb.from('chat_mensagens').insert({ conversa_id: conversaId, remetente: 'bot', conteudo: MSG_MENU }).select().single();
      if (r.data) { addMensagem(r.data); scrollFim(); ultimaMsg[conversaId] = r.data; }
    } catch (e) { console.error('[GuideChat] bot menu:', e); }
    botOpcoes = no.opcoes; pintarOpcoes();
  }
  async function enviar() {
    var texto = (el.input.value || '').trim();
    if (!texto || enviando) return;
    enviando = true; el.send.setAttribute('disabled', 'disabled'); el.input.value = ''; el.input.style.height = 'auto';
    try {
      if (!preparado) await preparar();
      if (!uid) { addNota('Não foi possível conectar. Recarregue a página e tente de novo.'); return; }
      if (!conversa) { if (!(await criarConversa())) throw new Error('sem conversa'); }
      var ins = await sb.from('chat_mensagens').insert({ conversa_id: conversa.id, remetente: 'usuario', conteudo: texto }).select().single();
      if (ins.error) throw ins.error;
      addMensagem(ins.data); scrollFim(); ultimaMsg[conversa.id] = ins.data;
      setTitulo(tituloDe(conversa));
      tocarConversa(); processarMensagemBot(conversa.id);
      if (cfg.expandido) renderSidebar();
    } catch (e) { console.error('[GuideChat] enviar:', e); addNota('Sua mensagem não foi enviada. Tente novamente.'); }
    finally { enviando = false; el.send.removeAttribute('disabled'); el.input.focus(); }
  }
  async function falarComAtendimento() {
    if (enviando) return; el.handoff.setAttribute('disabled', 'disabled');
    try {
      if (!preparado) await preparar();
      if (!uid) { addNota('Não foi possível conectar. Recarregue a página e tente de novo.'); el.handoff.removeAttribute('disabled'); return; }
      if (!conversa) { if (!(await criarConversa())) throw new Error('sem conversa'); }
      if (conversa.status === 'bot' || conversa.status === 'resolvido') {
        var up = await sb.from('chat_conversas').update({ status: 'pendente', atualizado_em: new Date().toISOString() }).eq('id', conversa.id).select().single();
        if (up.error) throw up.error; conversa = up.data; refletirStatus(); if (cfg.expandido) renderSidebar();
      }
      addNota('Avisamos a equipe da Guide. Assim que alguém estiver disponível, responde por aqui.');
    } catch (e) { console.error('[GuideChat] handoff:', e); addNota('Não consegui chamar o atendimento agora. Tente novamente em instantes.'); el.handoff.removeAttribute('disabled'); }
  }

  // ── init ─────────────────────────────────────────────────────────────────
  async function init(opts) {
    if (iniciado) return;
    opts = opts || {};
    if (!opts.sb) { console.error('[GuideChat] init: faltou o cliente Supabase (sb).'); return; }
    cfg = {
      sb: opts.sb,
      origem: opts.origem === 'institucional' ? 'institucional' : 'painel',
      clienteId: opts.clienteId || null,
      clienteNome: opts.clienteNome || null,
      expandido: opts.expandido === true,
      bubble: opts.bubble !== false,
      avatarUrl: opts.avatarUrl || '/assets/character-1.png',
      onUnread: typeof opts.onUnread === 'function' ? opts.onUnread : null
    };
    sb = cfg.sb;
    if (cfg.origem === 'painel' && !cfg.clienteId) { console.warn('[GuideChat] painel sem clienteId — chat não iniciado.'); return; }
    iniciado = true;
    construir();
    if (cfg.origem === 'painel') preparar();
  }

  return {
    init: init, open: open, close: close, toggle: toggle,
    _estado: function () { return { conversa: conversa, conversas: conversas, uid: uid, aberto: aberto }; }
  };
})();
