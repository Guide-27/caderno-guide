-- ═══════════════════════════════════════════════════════════════════════
-- MIGRAÇÃO — Solicitações do cliente (cancelamento e troca de plano)
-- Rode no SQL Editor do Supabase (fkbvwcppbjlodtnjrmbw). Idempotente.
--
-- O cliente, no card "Sua Conta", pode pedir CANCELAMENTO ou TROCA DE PLANO.
-- Cada pedido vira uma linha em `solicitacoes`, que aparece pro arquiteto no
-- painel (admin-projeto) para ele avaliar reembolso / aprovar a troca.
-- Também liberamos o cliente a LER a própria contratação (para saber a
-- metragem e calcular a diferença de valor na troca de plano).
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists solicitacoes (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references projetos(id) on delete cascade,
  tipo text not null check (tipo in ('cancelamento','alteracao_plano')),
  status text not null default 'aberta'
    check (status in ('aberta','em_avaliacao','concluida','recusada','retomada')),
  justificativa  text,      -- cancelamento: por que está cancelando
  plano_atual    text,      -- troca: plano de origem
  plano_novo     text,      -- troca: plano desejado
  valor_diferenca numeric,  -- troca: diferença (+ cobra / - devolve), por metragem
  resposta       text,      -- resposta do arquiteto
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists solicitacoes_projeto_idx on solicitacoes (projeto_id, criado_em desc);
create index if not exists solicitacoes_status_idx on solicitacoes (status);

alter table solicitacoes enable row level security;

-- Cliente gerencia as solicitações do próprio projeto (criar, ler, retomar).
drop policy if exists "cliente gerencia suas solicitacoes" on solicitacoes;
create policy "cliente gerencia suas solicitacoes" on solicitacoes for all to authenticated
  using (exists (select 1 from projetos p where p.id = solicitacoes.projeto_id and p.email = auth.email()))
  with check (exists (select 1 from projetos p where p.id = solicitacoes.projeto_id and p.email = auth.email()));

-- Arquiteto lê e responde todas as solicitações (avaliar reembolso / troca).
drop policy if exists "arquiteto gerencia solicitacoes" on solicitacoes;
create policy "arquiteto gerencia solicitacoes" on solicitacoes for all to authenticated
  using (exists (select 1 from arquitetos a where a.email = auth.email()))
  with check (exists (select 1 from arquitetos a where a.email = auth.email()));

-- ── Cliente lê a PRÓPRIA contratação (metragem/plano/valor) ──
-- Necessário para o card "Sua Conta" mostrar a metragem e calcular a diferença
-- de valor ao trocar de plano. Não expõe contratações de outras pessoas.
drop policy if exists "cliente le propria contratacao" on contratacoes;
create policy "cliente le propria contratacao" on contratacoes for select to authenticated
  using (lower(email) = lower(auth.email()));

-- ═══════════════════════════════════════════════════════════════════════
-- Pronto. O painel do arquiteto (admin-projeto) mostra as solicitações abertas
-- de cada projeto; a lista (admin-projetos) sinaliza quem tem pedido pendente.
-- ═══════════════════════════════════════════════════════════════════════
