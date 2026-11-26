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
  var MSG_BOT_STUB =
    'Recebi sua mensagem! Em breve deixo isso mais inteligente — por ora, se ' +
    'quiser falar com alguém da Guide agora, é só clicar em "Falar com atendimento".';

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
          '<div class="gc-avatar"><img src="' + esc(cfg.avatarUrl) + '" alt="Gui"></div>' +
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
            '<div class="gc-side-head"><img class="gc-side-gui" src="' + esc(cfg.avatarUrl) + '" alt="Gui">' +
              '<span class="gc-side-nome">Central de ajuda</span></div>' +
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
    var meu = m.remetente === 'usuario';
    var div = document.createElement('div'); div.className = 'gc-msg ' + (meu ? 'me' : 'them');
    var label = m.remetente === 'atendente' ? 'Atendimento Guide' : m.remetente === 'bot' ? 'Guia Guide' : '';
    div.innerHTML = (label ? '<div class="gc-msg-label">' + esc(label) + '</div>' : '') +
      '<div class="gc-bubble-msg">' + esc(m.conteudo) + '</div><div class="gc-msg-time">' + hora(m.criado_em) + '</div>';
    el.body.appendChild(div);
  }
  function addNota(txt) { var d = document.createElement('div'); d.className = 'gc-note'; d.textContent = txt; el.body.appendChild(d); scrollFim(); }
  function scrollFim() { el.body.scrollTop = el.body.scrollHeight; }
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
    } else { render([]); refletirStatus(); }
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
  }
  async function criarConversa() {
    var assunto = pendente ? pendente.assunto : (cfg.origem === 'painel' ? 'projeto' : null);
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
  // STUB da resposta automática — PLACEHOLDER DA FASE 2 (integração com LLM).
  async function processarMensagemBot(conversaId) {
    if (!conversa || conversa.status !== 'bot') return;
    try { await sb.from('chat_mensagens').insert({ conversa_id: conversaId, remetente: 'bot', conteudo: MSG_BOT_STUB }); }
    catch (e) { console.error('[GuideChat] bot stub:', e); }
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
