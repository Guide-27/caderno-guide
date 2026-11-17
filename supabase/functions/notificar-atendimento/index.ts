// ════════════════════════════════════════════════════════════════════════
// Edge Function: notificar-atendimento
// ------------------------------------------------------------------------
// Dispara quando uma conversa pede atendimento humano (status vira 'pendente').
// É chamada por um Database Webhook (on UPDATE de chat_conversas) e manda um
// e-mail para a equipe da Guide com o resumo e o link direto para a conversa.
//
// Deploy e configuração: ver README.md nesta mesma pasta.
// ════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_DESTINO = Deno.env.get("NOTIFICAR_EMAIL_DESTINO") ?? "lucas.2002louenco@gmail.com";
const EMAIL_REMETENTE = Deno.env.get("EMAIL_REMETENTE") ?? "Guide Atendimento <onboarding@resend.dev>";
const APP_BASE_URL = (Deno.env.get("APP_BASE_URL") ?? "https://caderno-guide.vercel.app").replace(/\/$/, "");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function esc(t: unknown): string {
  return String(t ?? "").replace(/[&<>"]/g, (s) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[s] as string));
}

async function rest(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  });
  if (!r.ok) { console.error("REST erro", path, await r.text()); return []; }
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const record = body.record ?? body.new ?? {};
    const old = body.old_record ?? body.old ?? {};

    // Só agimos na TRANSIÇÃO para 'pendente' (evita reenvio a cada update).
    if (record.status !== "pendente" || old.status === "pendente") {
      return new Response(JSON.stringify({ skip: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Identifica quem está pedindo ajuda.
    let quem = "Visitante do site";
    let contato = record.visitante_email ?? "";
    if (record.origem === "painel" && record.cliente_id) {
      const proj = await rest(`projetos?id=eq.${record.cliente_id}&select=nome_cliente,email`);
      if (proj[0]) { quem = proj[0].nome_cliente ?? "Cliente do painel"; contato = proj[0].email ?? contato; }
      else quem = "Cliente do painel";
    } else {
      quem = record.visitante_nome || record.visitante_email || "Visitante do site";
    }
    const origemTxt = record.origem === "painel" ? "Painel do cliente" : "Site institucional";

    // Últimas mensagens da conversa (ordem cronológica).
    const brutas = await rest(
      `chat_mensagens?conversa_id=eq.${record.id}&select=remetente,conteudo,criado_em&order=criado_em.desc&limit=12`,
    );
    const ultimas = brutas.reverse();
    const linhas = ultimas.map((m) => {
      const autor = m.remetente === "usuario" ? quem : m.remetente === "bot" ? "Bot" : "Atendente";
      return `<tr><td style="padding:4px 10px;color:#9a968d;white-space:nowrap;vertical-align:top">${esc(autor)}</td><td style="padding:4px 10px;color:#2a2a2a">${esc(m.conteudo)}</td></tr>`;
    }).join("");

    const link = `${APP_BASE_URL}/admin-atendimento?c=${record.id}`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#1c1b17;margin:0 0 4px">Novo pedido de atendimento</h2>
        <p style="color:#6a665e;margin:0 0 18px">Alguém pediu para falar com a Guide.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px">
          <tr><td style="padding:4px 10px;color:#9a968d">Origem</td><td style="padding:4px 10px;color:#1c1b17">${esc(origemTxt)}</td></tr>
          <tr><td style="padding:4px 10px;color:#9a968d">Quem</td><td style="padding:4px 10px;color:#1c1b17">${esc(quem)}${contato ? " · " + esc(contato) : ""}</td></tr>
        </table>
        <div style="font-size:12px;color:#9a968d;margin-bottom:6px">Últimas mensagens</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;background:#faf8f3;border-radius:8px;margin-bottom:22px">${linhas || '<tr><td style="padding:8px 10px;color:#9a968d">—</td></tr>'}</table>
        <a href="${link}" style="display:inline-block;background:#C9A227;color:#12100a;text-decoration:none;font-weight:bold;padding:11px 22px;border-radius:999px">Abrir a conversa</a>
      </div>`;

    if (!RESEND_API_KEY) {
      console.warn("RESEND_API_KEY não configurada — e-mail não enviado.");
      return new Response(JSON.stringify({ ok: false, motivo: "sem RESEND_API_KEY" }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const envio = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_REMETENTE,
        to: [EMAIL_DESTINO],
        subject: `Atendimento Guide — ${quem} (${origemTxt})`,
        html,
      }),
    });
    const resp = await envio.text();
    if (!envio.ok) { console.error("Resend erro:", resp); return new Response(JSON.stringify({ ok: false, resp }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }); }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Falha geral:", e);
    return new Response(JSON.stringify({ ok: false, erro: String(e) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
