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
