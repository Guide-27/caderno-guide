-- ═══════════════════════════════════════════════════════════════════════
-- MIGRAÇÃO — Solicitações do cliente (cancelamento e troca de plano)
-- Rode no SQL Editor do Supabase (fkbvwcppbjlodtnjrmbw). Idempotente.
--
-- O cliente, no card "Sua Conta", pode pedir CANCELAMENTO ou TROCA DE PLANO.
-- Cada pedido vira uma linha em `solicitacoes`, que aparece pro arquiteto na
-- CENTRAL DE NOTIFICAÇÕES do painel administrativo (admin-dono) para ele
-- avaliar o reembolso / aprovar a troca.
--
-- Fluxo do reembolso (cancelamento):
--   aberta → reembolso_proposto (arquiteto informou o valor e enviou ao cliente)
--          → reembolso_confirmado (cliente clicou "Seguir")
--          → reembolso_revisao   (cliente clicou "Revisar")
--          → concluida (reembolso resolvido) | recusada | retomada
--
-- Também liberamos o cliente a LER a própria contratação (para saber a
-- metragem, calcular a diferença de valor na troca e ver a forma de pagamento).
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists solicitacoes (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references projetos(id) on delete cascade,
  tipo text not null check (tipo in ('cancelamento','alteracao_plano')),
  status text not null default 'aberta'
    constraint solicitacoes_status_chk check (status in (
      'aberta','em_avaliacao','reembolso_proposto','reembolso_confirmado',
      'reembolso_revisao','concluida','recusada','retomada')),
  justificativa  text,      -- cancelamento: por que está cancelando
  plano_atual    text,      -- troca: plano de origem
  plano_novo     text,      -- troca: plano desejado
  valor_diferenca numeric,  -- troca: diferença (+ cobra / - devolve), por metragem
  valor_reembolso numeric,  -- cancelamento: valor do reembolso definido pelo arquiteto
  resposta       text,      -- resposta do arquiteto
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists solicitacoes_projeto_idx on solicitacoes (projeto_id, criado_em desc);
create index if not exists solicitacoes_status_idx on solicitacoes (status);

-- ── Colunas/constraints novos para tabelas já existentes (re-rodar é seguro) ──
alter table solicitacoes add column if not exists valor_reembolso numeric;

-- Troca a checagem de status antiga (que não tinha os status de reembolso)
-- pela nova. Remove tanto a nomeada quanto a antiga auto-nomeada.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'solicitacoes'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table solicitacoes drop constraint %I', c);
  end loop;
end $$;
alter table solicitacoes add constraint solicitacoes_status_chk check (status in (
  'aberta','em_avaliacao','reembolso_proposto','reembolso_confirmado',
  'reembolso_revisao','concluida','recusada','retomada'));

alter table solicitacoes enable row level security;

-- Cliente gerencia as solicitações do próprio projeto (criar, ler, confirmar, retomar).
drop policy if exists "cliente gerencia suas solicitacoes" on solicitacoes;
create policy "cliente gerencia suas solicitacoes" on solicitacoes for all to authenticated
  using (exists (select 1 from projetos p where p.id = solicitacoes.projeto_id and p.email = auth.email()))
  with check (exists (select 1 from projetos p where p.id = solicitacoes.projeto_id and p.email = auth.email()));

-- Arquiteto lê e responde todas as solicitações (definir reembolso / aprovar troca).
drop policy if exists "arquiteto gerencia solicitacoes" on solicitacoes;
create policy "arquiteto gerencia solicitacoes" on solicitacoes for all to authenticated
  using (exists (select 1 from arquitetos a where a.email = auth.email()))
  with check (exists (select 1 from arquitetos a where a.email = auth.email()));

-- ── Cliente lê a PRÓPRIA contratação (metragem/plano/valor/forma de pagamento) ──
-- Necessário para o card "Sua Conta" mostrar a metragem, calcular a diferença
-- de valor ao trocar de plano e saber a forma de pagamento do reembolso.
-- Não expõe contratações de outras pessoas.
drop policy if exists "cliente le propria contratacao" on contratacoes;
create policy "cliente le propria contratacao" on contratacoes for select to authenticated
  using (lower(email) = lower(auth.email()));

-- ═══════════════════════════════════════════════════════════════════════
-- Pronto. A central de notificações (admin-dono) mostra os pedidos abertos de
-- todos os projetos; a lista de projetos (admin-projetos) acende o sininho
-- quando há pedido pendente.
-- ═══════════════════════════════════════════════════════════════════════
