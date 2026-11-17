/* ══════════════════════════════════════════════════════════════════════
   CHAT WIDGET DA GUIDE — componente compartilhado (painel + institucional)
   ----------------------------------------------------------------------
   Uso:
     GuideChat.init({
       sb,                       // cliente Supabase (obrigatório)
       origem: 'painel',         // 'painel' | 'institucional'
       clienteId: projeto.id,    // só no painel: id do projeto do cliente
       clienteNome: 'Maria',     // opcional, para saudação
       bubble: false,            // true  = cria bolha flutuante própria (institucional)
                                 // false = você abre via GuideChat.open() (header do painel)
       onUnread: function(tem){} // opcional: avisa p/ acender um pontinho no header
     });
     GuideChat.open();  GuideChat.close();  GuideChat.toggle();

   Depende de: chat-widget.css e das tabelas chat_conversas / chat_mensagens
   (supabase-migration-chat.sql). O Realtime precisa estar ligado nessas tabelas.
   ══════════════════════════════════════════════════════════════════════ */

window.GuideChat = (function () {
  'use strict';

  var cfg = null;
  var sb = null;
  var conversa = null;     // linha de chat_conversas (null até a 1ª mensagem)
  var uid = null;          // auth.uid() (cliente logado ou visitante anônimo)
  var canalMsg = null;     // subscription de mensagens
  var canalConv = null;    // subscription de updates da conversa
  var aberto = false;
  var enviando = false;
  var iniciado = false;
  var preparado = false;   // já resolvemos sessão + histórico?
  var preparando = null;   // promise de preparo em andamento (evita corrida)
  var vistos = {};         // ids de mensagens já renderizadas (dedupe do realtime)
  var el = {};             // refs de DOM

  // ── ícones (SVG inline — não dependemos do Lucide no site institucional) ──
  var SVG = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    agent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 11V3H7v8"/><path d="M4 11h16a1 1 0 0 1 1 1v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a1 1 0 0 1 1-1z"/><circle cx="8.5" cy="15.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/></svg>'
  };

  // STUB da resposta automática — PLACEHOLDER DA FASE 2 (integração com LLM).
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

  // ── DOM ───────────────────────────────────────────────────────────────
  function construir() {
    var root = document.createElement('div');
    root.className = 'gc-root ' + (cfg.origem === 'institucional' ? 'gc-institucional' : 'gc-painel');

    var titulo = cfg.origem === 'institucional' ? 'Fale com a Guide' : 'Atendimento Guide';

    var partes = [];
    if (cfg.bubble) {
      partes.push(
        '<button class="gc-bubble" type="button" aria-label="Abrir conversa">' +
          SVG.chat + '<span class="gc-dot"></span>' +
        '</button>'
      );
    }
    partes.push(
      '<div class="gc-panel" role="dialog" aria-label="Conversa com a Guide">' +
        '<div class="gc-header">' +
          '<div class="gc-avatar">' + SVG.agent + '</div>' +
          '<div class="gc-head-txt">' +
            '<div class="gc-head-title">' + esc(titulo) + '</div>' +
            '<div class="gc-head-sub"><span class="gc-status-pip"></span><span class="gc-status-txt">A Guide acolhe você</span></div>' +
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
      '</div>'
    );
    root.innerHTML = partes.join('');
    document.body.appendChild(root);

    el.root = root;
    el.bubble = root.querySelector('.gc-bubble');
    el.dot = root.querySelector('.gc-dot');
    el.panel = root.querySelector('.gc-panel');
    el.body = root.querySelector('.gc-body');
    el.close = root.querySelector('.gc-close');
    el.handoff = root.querySelector('.gc-handoff');
    el.input = root.querySelector('.gc-input');
    el.send = root.querySelector('.gc-send');
    el.headSub = root.querySelector('.gc-head-sub');
    el.statusTxt = root.querySelector('.gc-status-txt');

    if (el.bubble) el.bubble.addEventListener('click', toggle);
    el.close.addEventListener('click', close);
    el.send.addEventListener('click', enviar);
    el.handoff.addEventListener('click', falarComAtendimento);
    el.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
    });
    el.input.addEventListener('input', function () {
      el.input.style.height = 'auto';
      el.input.style.height = Math.min(el.input.scrollHeight, 110) + 'px';
    });
  }

  function mostrarVazio() {
    el.body.innerHTML =
      '<div class="gc-welcome"><strong>Olá' +
      (cfg.clienteNome ? ', ' + esc(primeiroNome(cfg.clienteNome)) : '') +
      '!</strong><br>Como podemos ajudar você hoje? Escreva abaixo que a gente te responde.</div>';
  }
  function primeiroNome(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }

  function render(msgs) {
    el.body.innerHTML = '';
    vistos = {};
    if (!msgs || !msgs.length) { mostrarVazio(); return; }
    msgs.forEach(addMensagem);
    scrollFim();
  }

  function addMensagem(m) {
    if (!m || vistos[m.id]) return;
    vistos[m.id] = true;
    var welcome = el.body.querySelector('.gc-welcome');
    if (welcome) welcome.remove();

    var meu = m.remetente === 'usuario';
    var div = document.createElement('div');
    div.className = 'gc-msg ' + (meu ? 'me' : 'them');
    var label = m.remetente === 'atendente' ? 'Atendimento Guide'
              : m.remetente === 'bot' ? 'Guia Guide' : '';
    div.innerHTML =
      (label ? '<div class="gc-msg-label">' + esc(label) + '</div>' : '') +
      '<div class="gc-bubble-msg">' + esc(m.conteudo) + '</div>' +
      '<div class="gc-msg-time">' + hora(m.criado_em) + '</div>';
    el.body.appendChild(div);
  }

  function addNota(txt) {
    var div = document.createElement('div');
    div.className = 'gc-note';
    div.textContent = txt;
    el.body.appendChild(div);
    scrollFim();
  }

  function scrollFim() { el.body.scrollTop = el.body.scrollHeight; }

  function refletirStatus() {
    if (!conversa) return;
    var atendido = conversa.status === 'em_atendimento';
    el.headSub.classList.toggle('at', atendido);
    el.statusTxt.textContent =
      conversa.status === 'em_atendimento' ? 'Você está falando com a equipe'
      : conversa.status === 'pendente' ? 'Avisamos a equipe — já te respondem'
      : conversa.status === 'resolvido' ? 'Conversa encerrada'
      : 'A Guide acolhe você';
  }

  // ── abrir / fechar ──────────────────────────────────────────────────────
  function open() {
    aberto = true;
    el.root.classList.add('gc-aberto');
    if (el.dot) el.dot.style.display = 'none';
    if (cfg.onUnread) cfg.onUnread(false);
    if (!preparado) preparar(); // institucional: só aqui nasce o login anônimo
    setTimeout(function () { el.input && el.input.focus(); scrollFim(); }, 120);
  }
  function close() { aberto = false; el.root.classList.remove('gc-aberto'); }
  function toggle() { aberto ? close() : open(); }

  function avisarNova() {
    if (aberto) return;
    if (el.dot) el.dot.style.display = 'block';
    if (cfg.onUnread) cfg.onUnread(true);
  }

  // ── Supabase ────────────────────────────────────────────────────────────
  async function garantirSessao() {
    var res = await sb.auth.getSession();
    var sessao = res && res.data ? res.data.session : null;
    if (!sessao) {
      if (cfg.origem === 'institucional') {
        if (typeof sb.auth.signInAnonymously !== 'function') {
          console.error('[GuideChat] Este supabase-js não tem login anônimo. Use a versão 2.43+ (veja o embed institucional).');
          return null;
        }
        // Login anônimo: o visitante não cria conta nem faz login; o Supabase
        // guarda um "crachá" no localStorage deste navegador (id estável).
        var a = await sb.auth.signInAnonymously();
        if (a.error) { console.error('[GuideChat] login anônimo falhou:', a.error); return null; }
        sessao = a.data.session;
      } else {
        return null; // no painel o cliente já está logado; sem sessão não há chat
      }
    }
    return sessao && sessao.user ? sessao.user.id : null;
  }

  // Resolve a sessão (login anônimo no institucional) e carrega o histórico.
  // Roda no máximo uma vez; chamadas simultâneas compartilham a mesma promise.
  function preparar() {
    if (preparado) return Promise.resolve();
    if (preparando) return preparando;
    preparando = (async function () {
      uid = await garantirSessao();
      if (!uid) { addNota('Não foi possível conectar o chat agora.'); preparando = null; return; }
      await retomarConversa();
      preparado = true;
    })();
    return preparando;
  }

  async function retomarConversa() {
    var q = sb.from('chat_conversas').select('*')
      .eq('origem', cfg.origem).neq('status', 'resolvido')
      .order('atualizado_em', { ascending: false }).limit(1);
    if (cfg.origem === 'institucional') q = q.eq('visitante_id', uid);
    else q = q.eq('cliente_id', cfg.clienteId);
    var r = await q;
    if (r.error) { console.error('[GuideChat] retomar conversa:', r.error); return; }
    conversa = (r.data && r.data[0]) ? r.data[0] : null;
    if (conversa) {
      var m = await sb.from('chat_mensagens').select('*')
        .eq('conversa_id', conversa.id).order('criado_em', { ascending: true });
      render(m.data || []);
      refletirStatus();
      assinar();
    } else {
      mostrarVazio();
    }
  }

  async function criarConversa() {
    var linha = { origem: cfg.origem, status: 'bot' };
    if (cfg.origem === 'institucional') {
      linha.visitante_id = uid;
      if (cfg.clienteNome) linha.visitante_nome = cfg.clienteNome;
    } else {
      linha.cliente_id = cfg.clienteId;
    }
    var r = await sb.from('chat_conversas').insert(linha).select().single();
    if (r.error) { console.error('[GuideChat] criar conversa:', r.error); return null; }
    conversa = r.data;
    assinar();
    return conversa;
  }

  function assinar() {
    if (!conversa || canalMsg) return;
    canalMsg = sb.channel('gc-msg-' + conversa.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_mensagens', filter: 'conversa_id=eq.' + conversa.id },
        function (payload) {
          var m = payload.new;
          if (vistos[m.id]) return;
          addMensagem(m);
          scrollFim();
          if (m.remetente !== 'usuario') avisarNova();
        })
      .subscribe();

    canalConv = sb.channel('gc-conv-' + conversa.id)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_conversas', filter: 'id=eq.' + conversa.id },
        function (payload) {
          var antes = conversa ? conversa.status : null;
          conversa = payload.new;
          refletirStatus();
          if (conversa.status === 'em_atendimento' && antes !== 'em_atendimento') {
            addNota('Um atendente da Guide entrou na conversa.');
            el.handoff.setAttribute('disabled', 'disabled');
          }
          if (conversa.status === 'resolvido' && antes !== 'resolvido') {
            addNota('A equipe marcou esta conversa como resolvida.');
          }
        })
      .subscribe();
  }

  async function tocarConversa() {
    try { await sb.from('chat_conversas').update({ atualizado_em: new Date().toISOString() }).eq('id', conversa.id); }
    catch (e) { /* silencioso */ }
  }

  // STUB da resposta automática — PLACEHOLDER DA FASE 2 (integração com LLM).
  // Hoje: só devolve uma mensagem fixa de 'bot'. Depois, esta função será
  // substituída por uma chamada ao modelo (provavelmente numa Edge Function,
  // para a chave da IA não ficar exposta no navegador).
  async function processarMensagemBot(conversaId /*, mensagemUsuario */) {
    if (!conversa || conversa.status !== 'bot') return; // já com humano: bot cala
    try {
      await sb.from('chat_mensagens').insert({
        conversa_id: conversaId, remetente: 'bot', conteudo: MSG_BOT_STUB
      });
    } catch (e) { console.error('[GuideChat] bot stub:', e); }
  }

  async function enviar() {
    var texto = (el.input.value || '').trim();
    if (!texto || enviando) return;
    enviando = true; el.send.setAttribute('disabled', 'disabled');
    el.input.value = ''; el.input.style.height = 'auto';

    try {
      if (!preparado) await preparar();
      if (!uid) { addNota('Não foi possível conectar. Recarregue a página e tente de novo.'); return; }
      if (!conversa) { if (!(await criarConversa())) throw new Error('sem conversa'); }
      var ins = await sb.from('chat_mensagens').insert({
        conversa_id: conversa.id, remetente: 'usuario', conteudo: texto
      }).select().single();
      if (ins.error) throw ins.error;
      addMensagem(ins.data);
      scrollFim();
      tocarConversa();
      processarMensagemBot(conversa.id, texto);
    } catch (e) {
      console.error('[GuideChat] enviar:', e);
      addNota('Sua mensagem não foi enviada. Tente novamente.');
    } finally {
      enviando = false; el.send.removeAttribute('disabled'); el.input.focus();
    }
  }

  async function falarComAtendimento() {
    if (enviando) return;
    el.handoff.setAttribute('disabled', 'disabled');
    try {
      if (!preparado) await preparar();
      if (!uid) { addNota('Não foi possível conectar. Recarregue a página e tente de novo.'); el.handoff.removeAttribute('disabled'); return; }
      if (!conversa) { if (!(await criarConversa())) throw new Error('sem conversa'); }
      if (conversa.status === 'bot' || conversa.status === 'resolvido') {
        var up = await sb.from('chat_conversas')
          .update({ status: 'pendente', atualizado_em: new Date().toISOString() })
          .eq('id', conversa.id).select().single();
        if (up.error) throw up.error;
        conversa = up.data;
        refletirStatus();
      }
      addNota('Avisamos a equipe da Guide. Assim que alguém estiver disponível, responde por aqui.');
    } catch (e) {
      console.error('[GuideChat] handoff:', e);
      addNota('Não consegui chamar o atendimento agora. Tente novamente em instantes.');
      el.handoff.removeAttribute('disabled');
    }
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
      bubble: opts.bubble !== false, // padrão: tem bolha (institucional). Painel passa false.
      onUnread: typeof opts.onUnread === 'function' ? opts.onUnread : null
    };
    sb = cfg.sb;
    if (cfg.origem === 'painel' && !cfg.clienteId) {
      console.warn('[GuideChat] painel sem clienteId — o chat não será iniciado.');
      return;
    }
    iniciado = true;
    construir();
    mostrarVazio();

    // Painel: cliente já logado — preparamos logo (histórico + pontinho de não-lida).
    // Institucional: só preparamos quando o visitante abrir o chat, para não criar
    // um login anônimo em todo mundo que apenas passa pela página.
    if (cfg.origem === 'painel') preparar();
  }

  return { init: init, open: open, close: close, toggle: toggle,
           // exposto p/ testes/depuração:
           _estado: function () { return { conversa: conversa, uid: uid, aberto: aberto }; } };
})();
