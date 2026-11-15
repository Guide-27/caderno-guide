-- ════════════════════════════════════════════════════════════════════════
-- PAINEL DO DONO (admin-dono.html) — leitura de contratações e projetos
-- Rode este script no SQL Editor do Supabase.
--
-- Por que: a sessão de Administração precisa LER todas as contratações e
-- projetos para montar o resumo (faturamento, conversão, etc.). As regras
-- (RLS) de hoje podem não permitir isso. Estas policies liberam a leitura
-- APENAS para os emails donos da plataforma — ninguém mais vê.
--
-- Importante: ajuste a lista de emails abaixo se mudar os donos.
--             Mantenha a MESMA lista do const DONOS em admin-dono.html.
-- ════════════════════════════════════════════════════════════════════════

-- ── CONTRATAÇÕES ──
alter table contratacoes enable row level security;

drop policy if exists "donos leem contratacoes" on contratacoes;
create policy "donos leem contratacoes" on contratacoes
  for select
  to authenticated
  using (
    lower(auth.jwt() ->> 'email') in (
      'lucas_montre@hotmail.com',
      'lucas.2002louenco@gmail.com'
    )
  );

-- Mantém o cadastro público de contratações funcionando (contratar.html, anônimo).
-- Só crie esta policy se ainda NÃO existir uma de insert para o fluxo público.
drop policy if exists "contratacao publica" on contratacoes;
create policy "contratacao publica" on contratacoes
  for insert
  to anon, authenticated
  with check (true);

-- ── PROJETOS (leitura ampla p/ o dono; combina com as policies já existentes) ──
drop policy if exists "donos leem projetos" on projetos;
create policy "donos leem projetos" on projetos
  for select
  to authenticated
  using (
    lower(auth.jwt() ->> 'email') in (
      'lucas_montre@hotmail.com',
      'lucas.2002louenco@gmail.com'
    )
  );

-- ── SITUAÇÃO (ciclo de vida) e PAGAMENTO das contratações ──
-- status: ativa | concluida | pausada | cancelada  (padrão ativa)
-- pagamento_status: pendente | pago                (padrão pendente)
alter table contratacoes add column if not exists status text default 'ativa';
alter table contratacoes add column if not exists pagamento_status text default 'pendente';

-- Permite que os donos ALTEREM situação/pagamento pelo painel.
drop policy if exists "donos editam contratacoes" on contratacoes;
create policy "donos editam contratacoes" on contratacoes
  for update
  to authenticated
  using (
    lower(auth.jwt() ->> 'email') in (
      'lucas_montre@hotmail.com',
      'lucas.2002louenco@gmail.com'
    )
  )
  with check (
    lower(auth.jwt() ->> 'email') in (
      'lucas_montre@hotmail.com',
      'lucas.2002louenco@gmail.com'
    )
  );
