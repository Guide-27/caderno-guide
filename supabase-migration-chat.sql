-- ═══════════════════════════════════════════════════════════════════════
-- MIGRAÇÃO — Chat de atendimento da Guide (institucional + painel do cliente)
-- Rode isto no SQL Editor do seu projeto Supabase (fkbvwcppbjlodtnjrmbw).
-- Idempotente: pode rodar mais de uma vez sem quebrar nada existente.
--
-- Depende de: projetos (coluna `email`) e do schema `private` (criado na
-- migração da Comunidade — recriamos aqui com "if not exists" por segurança).
--
-- Duas frentes de conversa:
--   • origem = 'institucional'  → visitante anônimo do site institucional.
--       Usa LOGIN ANÔNIMO do Supabase: o visitante NÃO cria conta nem faz
--       login — o Supabase dá um "crachá" invisível ao navegador, guardado
--       no localStorage, com um id estável (auth.uid()). É isso que deixa a
--       regra de segurança conseguir isolar "a conversa daquele visitante".
--       (Precisa ligar "Allow anonymous sign-ins" no painel — ver no fim.)
--   • origem = 'painel'         → cliente logado no Hub (meu-projeto.html).
--       Amarrado ao projeto dele via cliente_id → projetos.id.
--
-- O perfil administrativo (Lucas) tem acesso TOTAL às duas tabelas.
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 0. Schema privado + helpers de identidade (SECURITY DEFINER)
-- ─────────────────────────────────────────────────────────────────────────
-- Rodam como dono (ignoram a RLS das tabelas que consultam) e ficam num schema
-- não exposto na API. Chamados como (select private.fn()) nas policies.
create schema if not exists private;

-- É administrador da plataforma? (mesma lista de DONOS do admin-dono.html /
-- supabase-migration-admin-dono.sql — mantenha os e-mails em sincronia.)
create or replace function private.is_chat_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select lower((select auth.email())) in (
    'lucas_montre@hotmail.com',
    'lucas.2002louenco@gmail.com'
  );
$$;

revoke execute on function private.is_chat_admin() from public, anon;
grant  execute on function private.is_chat_admin() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. chat_conversas — uma linha por conversa (institucional OU painel)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists chat_conversas (
  id uuid primary key default gen_random_uuid(),
  origem text not null check (origem in ('institucional','painel')),
  status text not null default 'bot'
    check (status in ('bot','pendente','em_atendimento','resolvido')),
  -- Institucional (visitante anônimo):
  visitante_id    uuid,                 -- auth.uid() do login anônimo do navegador
  visitante_nome  text,                 -- opcional, se o visitante informar
  visitante_email text,                 -- opcional
  -- Painel (cliente logado):
  cliente_id uuid references projetos(id) on delete set null,
  -- Atendimento:
  atendente_id uuid,                    -- admin que assumiu (null = ninguém ainda)
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- (colunas idempotentes, caso a tabela já existisse numa versão anterior)
alter table chat_conversas add column if not exists visitante_id uuid;
alter table chat_conversas add column if not exists visitante_nome text;
alter table chat_conversas add column if not exists visitante_email text;
alter table chat_conversas add column if not exists atendente_id uuid;

create index if not exists chat_conversas_visitante_idx on chat_conversas (visitante_id);
create index if not exists chat_conversas_cliente_idx   on chat_conversas (cliente_id);
create index if not exists chat_conversas_status_idx    on chat_conversas (status, atualizado_em desc);
create index if not exists chat_conversas_lista_idx     on chat_conversas (atualizado_em desc);

alter table chat_conversas enable row level security;

-- Helper: a conversa `conv_id` pertence a quem está chamando?
-- (visitante anônimo dono do crachá, OU cliente dono do projeto). Admin é
-- tratado à parte com is_chat_admin(). SECURITY DEFINER evita recursão de RLS.
create or replace function private.minha_conversa(conv_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chat_conversas c
    where c.id = conv_id
      and (
        (c.visitante_id is not null and c.visitante_id = (select auth.uid()))
        or (c.cliente_id is not null and exists (
              select 1 from public.projetos p
              where p.id = c.cliente_id and p.email = (select auth.email())
            ))
      )
  );
$$;
revoke execute on function private.minha_conversa(uuid) from public, anon;
grant  execute on function private.minha_conversa(uuid) to authenticated;

-- SELECT: dono da conversa (visitante/cliente) OU admin.
drop policy if exists "dono ou admin le conversas" on chat_conversas;
create policy "dono ou admin le conversas" on chat_conversas for select to authenticated
  using (
    (visitante_id is not null and visitante_id = (select auth.uid()))
    or (cliente_id is not null and exists (
          select 1 from projetos p where p.id = cliente_id and p.email = (select auth.email())
        ))
    or (select private.is_chat_admin())
  );

-- INSERT: visitante abre a própria (institucional); cliente abre a do seu
-- projeto (painel); admin pode abrir qualquer uma.
drop policy if exists "abre conversa propria" on chat_conversas;
create policy "abre conversa propria" on chat_conversas for insert to authenticated
  with check (
    (select private.is_chat_admin())
    or (origem = 'institucional' and visitante_id = (select auth.uid()))
    or (origem = 'painel' and cliente_id is not null and exists (
          select 1 from projetos p where p.id = cliente_id and p.email = (select auth.email())
        ))
  );

-- UPDATE: o dono pode mexer na própria conversa (ex.: clicar em "Falar com
-- atendimento" muda status p/ 'pendente'); admin pode mexer em qualquer uma
-- (assumir, resolver). Mesma condição no using e no with check.
drop policy if exists "dono ou admin edita conversa" on chat_conversas;
create policy "dono ou admin edita conversa" on chat_conversas for update to authenticated
  using (
    (visitante_id is not null and visitante_id = (select auth.uid()))
    or (cliente_id is not null and exists (
          select 1 from projetos p where p.id = cliente_id and p.email = (select auth.email())
        ))
    or (select private.is_chat_admin())
  )
  with check (
    (visitante_id is not null and visitante_id = (select auth.uid()))
    or (cliente_id is not null and exists (
          select 1 from projetos p where p.id = cliente_id and p.email = (select auth.email())
        ))
    or (select private.is_chat_admin())
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 2. chat_mensagens — mensagens de cada conversa
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists chat_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references chat_conversas(id) on delete cascade,
  remetente text not null check (remetente in ('usuario','bot','atendente')),
  conteudo text not null,
  criado_em timestamptz not null default now()
);
create index if not exists chat_mensagens_conversa_idx on chat_mensagens (conversa_id, criado_em);

alter table chat_mensagens enable row level security;

-- SELECT: quem é dono da conversa lê as mensagens dela; admin lê tudo.
drop policy if exists "le mensagens da propria conversa" on chat_mensagens;
create policy "le mensagens da propria conversa" on chat_mensagens for select to authenticated
  using (
    (select private.minha_conversa(conversa_id))
    or (select private.is_chat_admin())
  );

-- INSERT: o dono grava mensagens 'usuario' (e 'bot', pois o stub do robô roda
-- no navegador por enquanto — Fase 2 move isso p/ o servidor). Só o admin pode
-- gravar como 'atendente'.
drop policy if exists "dono grava usuario e bot" on chat_mensagens;
create policy "dono grava usuario e bot" on chat_mensagens for insert to authenticated
  with check (
    (select private.is_chat_admin())
    or (remetente in ('usuario','bot') and (select private.minha_conversa(conversa_id)))
  );

-- UPDATE/DELETE de mensagem: só admin (moderação). Mensagem do usuário é
-- imutável para ele.
drop policy if exists "admin edita mensagens" on chat_mensagens;
create policy "admin edita mensagens" on chat_mensagens for update to authenticated
  using ((select private.is_chat_admin())) with check ((select private.is_chat_admin()));
drop policy if exists "admin remove mensagens" on chat_mensagens;
create policy "admin remove mensagens" on chat_mensagens for delete to authenticated
  using ((select private.is_chat_admin()));

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Realtime — ligar as duas tabelas na publicação do Realtime
-- ─────────────────────────────────────────────────────────────────────────
-- Assim o widget do cliente e o painel do admin recebem mensagens novas na
-- hora, sem ficar perguntando ao banco. (Idempotente.)
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_conversas'
  ) then
    alter publication supabase_realtime add table chat_conversas;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_mensagens'
  ) then
    alter publication supabase_realtime add table chat_mensagens;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- FIM. Passos manuais no painel do Supabase (fora deste script):
--
--   1. Authentication → Sign In / Providers → ligar "Allow anonymous sign-ins".
--      (Necessário para o widget do site institucional funcionar.)
--
--   2. (Opcional, mas recomendado) Authentication → Rate Limits: manter um
--      limite razoável de sign-ups anônimos para evitar abuso.
--
--   3. Para a NOTIFICAÇÃO por e-mail de handoff, ver:
--        supabase/functions/notificar-atendimento/README.md
--      (deploy da Edge Function + Database Webhook on UPDATE de chat_conversas).
--
--   4. Mantenha a lista de e-mails em private.is_chat_admin() igual à lista
--      DONOS do admin-dono.html / supabase-migration-admin-dono.sql.
-- ═══════════════════════════════════════════════════════════════════════
