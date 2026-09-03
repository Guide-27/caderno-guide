-- ═══════════════════════════════════════════════════════════════════════
-- MIGRAÇÃO — Hub do Cliente (painel bento em meu-projeto.html)
-- Rode isto no SQL Editor do seu projeto Supabase (fkbvwcppbjlodtnjrmbw).
-- Idempotente: pode rodar mais de uma vez sem quebrar nada existente.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Datas de conclusão de cada etapa (card "Até aqui") ───
-- Preenchidas automaticamente pelo trigger abaixo sempre que o arquiteto
-- avançar `etapa_atual` em admin-projeto.html — nenhum código existente
-- precisa mudar.
alter table projetos add column if not exists briefing_concluido_em timestamptz;
alter table projetos add column if not exists layout_concluido_em timestamptz;
alter table projetos add column if not exists imagens_concluido_em timestamptz;
alter table projetos add column if not exists executivo_concluido_em timestamptz;

-- Vídeo explicativo por fase, mostrado dentro do card "Meu Projeto" quando existir.
-- Chaves esperadas: briefing, layout, imagens, executivo, obra. Ex.:
--   update projetos set videos_explicativos = '{"layout":"https://youtube.com/embed/XXXX"}' where id = '...';
alter table projetos add column if not exists videos_explicativos jsonb default '{}'::jsonb;

-- Prazo de cada etapa, preenchido pelo ARQUITETO em admin-projeto.html e mostrado
-- no card de cada fase dentro de "Meu Projeto" (ícone de calendário).
-- Chaves: briefing, layout, imagens, executivo, obra → data no formato 'YYYY-MM-DD'. Ex.:
--   update projetos set prazos_etapas = '{"imagens":"2026-09-20"}' where id = '...';
alter table projetos add column if not exists prazos_etapas jsonb default '{}'::jsonb;

-- Progresso da obra em %, preenchido pelo ARQUITETO — alimenta o anel "Obra" na capa
-- de "Meu Projeto". Só é exibido quando etapa_atual chega em "obra" (5); até lá o
-- anel mostra um estado de convite (cadeado). Ex.:
--   update projetos set obra_progresso_pct = 35 where id = '...';
alter table projetos add column if not exists obra_progresso_pct int default 0;

-- Contagem de revisões solicitadas pelo cliente, por etapa — mostrada no card
-- "Sua Trajetória" com um limite visual de 2 por etapa. Chaves: layout, imagens,
-- executivo. Incrementar sempre que o cliente pedir uma revisão em layout.html /
-- imagens.html (esta migração só cria a coluna; o incremento é feito por quem
-- processa o pedido de revisão). Ex.:
--   update projetos set revisoes_por_etapa = jsonb_set(coalesce(revisoes_por_etapa,'{}'::jsonb), '{layout}', to_jsonb(coalesce((revisoes_por_etapa->>'layout')::int,0) + 1)) where id = '...';
alter table projetos add column if not exists revisoes_por_etapa jsonb default '{}'::jsonb;

create or replace function guide_set_etapa_timestamps()
returns trigger as $$
begin
  if new.etapa_atual > 1 and coalesce(old.etapa_atual,0) < 2 and new.briefing_concluido_em is null then
    new.briefing_concluido_em = now();
  end if;
  if new.etapa_atual > 2 and coalesce(old.etapa_atual,0) < 3 and new.layout_concluido_em is null then
    new.layout_concluido_em = now();
  end if;
  if new.etapa_atual > 3 and coalesce(old.etapa_atual,0) < 4 and new.imagens_concluido_em is null then
    new.imagens_concluido_em = now();
  end if;
  if new.etapa_atual > 4 and coalesce(old.etapa_atual,0) < 5 and new.executivo_concluido_em is null then
    new.executivo_concluido_em = now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_guide_etapa_timestamps on projetos;
create trigger trg_guide_etapa_timestamps
  before update on projetos
  for each row execute function guide_set_etapa_timestamps();

-- ─── 2. "Rumo às chaves" — checklist pós-entrega ───
create table if not exists marcos_pos_chaves (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references projetos(id) on delete cascade unique,
  vistoria_em timestamptz,
  entrega_chaves_em timestamptz,
  assembleia_em timestamptz,
  inicio_reforma_em timestamptz,
  atualizado_em timestamptz default now()
);
alter table marcos_pos_chaves enable row level security;
-- o cliente agora preenche as datas diretamente no card "Rumo às chaves" (input de calendário),
-- por isso a política precisa cobrir select + insert + update, não só leitura.
drop policy if exists "cliente le seus marcos" on marcos_pos_chaves;
drop policy if exists "cliente gerencia seus marcos" on marcos_pos_chaves;
create policy "cliente gerencia seus marcos" on marcos_pos_chaves for all
  using (exists (select 1 from projetos p where p.id = marcos_pos_chaves.projeto_id and p.email = auth.email()))
  with check (exists (select 1 from projetos p where p.id = marcos_pos_chaves.projeto_id and p.email = auth.email()));
drop policy if exists "arquiteto gerencia marcos" on marcos_pos_chaves;
create policy "arquiteto gerencia marcos" on marcos_pos_chaves for all
  using (exists (select 1 from arquitetos a where a.email = auth.email()));

-- novos marcos fixos (ordem completa: Vistoria da unidade → Revistoria → Entrega das
-- chaves → Manual do proprietário → Plantas técnicas → Assembleia de instalação → Início
-- da reforma). `revistoria_necessaria` é a flag que decide se o marco condicional
-- "Revistoria" aparece — marcada pelo arquiteto quando fica pendência na Vistoria.
alter table marcos_pos_chaves add column if not exists revistoria_em timestamptz;
alter table marcos_pos_chaves add column if not exists revistoria_necessaria boolean default false;
alter table marcos_pos_chaves add column if not exists manual_proprietario_em timestamptz;
alter table marcos_pos_chaves add column if not exists plantas_tecnicas_em timestamptz;

-- marcos personalizados: o cliente pode acrescentar quantos quiser (título, descrição, data),
-- independentes dos marcos fixos acima. Mesma regra de acesso do resto de "Rumo às chaves".
create table if not exists marcos_personalizados (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references projetos(id) on delete cascade,
  titulo text,
  descricao text,
  data timestamptz,
  ordem int default 0,
  criado_em timestamptz default now()
);
alter table marcos_personalizados enable row level security;
drop policy if exists "cliente gerencia marcos personalizados" on marcos_personalizados;
create policy "cliente gerencia marcos personalizados" on marcos_personalizados for all
  using (exists (select 1 from projetos p where p.id = marcos_personalizados.projeto_id and p.email = auth.email()))
  with check (exists (select 1 from projetos p where p.id = marcos_personalizados.projeto_id and p.email = auth.email()));
drop policy if exists "arquiteto le marcos personalizados" on marcos_personalizados;
create policy "arquiteto le marcos personalizados" on marcos_personalizados for select
  using (exists (select 1 from arquitetos a where a.email = auth.email()));

-- ─── 3. Glossário — conteúdo editorial, não depende do cliente ───
create table if not exists glossario_termos (
  id uuid primary key default gen_random_uuid(),
  termo text not null,
  explicacao text not null,
  ordem int default 0
);
alter table glossario_termos enable row level security;
drop policy if exists "todos autenticados leem glossario" on glossario_termos;
create policy "todos autenticados leem glossario" on glossario_termos for select
  using (auth.role() = 'authenticated');

-- ─── 4. Guiders — comunidade por empreendimento ───
create table if not exists comunidade_posts (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references projetos(id) on delete cascade,
  empreendimento text,
  autor_nome text,
  texto text,
  foto_antes_url text,
  foto_depois_url text,
  criado_em timestamptz default now()
);
alter table comunidade_posts enable row level security;
drop policy if exists "cliente le posts do proprio empreendimento" on comunidade_posts;
create policy "cliente le posts do proprio empreendimento" on comunidade_posts for select
  using (
    empreendimento is not null
    and empreendimento in (
      select coalesce(br.dados->>'empreendimento', '') from briefing_respostas br
      join projetos p on p.id = br.projeto_id
      where p.email = auth.email()
    )
  );
drop policy if exists "cliente publica seus posts" on comunidade_posts;
create policy "cliente publica seus posts" on comunidade_posts for insert
  with check (exists (select 1 from projetos p where p.id = comunidade_posts.projeto_id and p.email = auth.email()));

-- ─── 5. Parceiros Guide — vitrine curada pela Guide ───
create table if not exists parceiros (
  id uuid primary key default gen_random_uuid(),
  categoria text not null,
  nome text not null,
  avaliacao numeric(2,1),
  contato text,
  link text,
  ordem int default 0
);
alter table parceiros enable row level security;
drop policy if exists "todos autenticados leem parceiros" on parceiros;
create policy "todos autenticados leem parceiros" on parceiros for select
  using (auth.role() = 'authenticated');

-- ─── 6. Seu diário — histórico de emoções ao longo da jornada ───
-- Dados privados: só o próprio cliente enxerga (nunca aparece no painel do arquiteto).
-- Sem conceito de "lacre" — todos os registros ficam sempre visíveis e navegáveis.
-- `humor` guarda uma chave semântica (triste | neutro | contente | feliz | radiante),
-- não mais um emoji — a interface é 100% ícone vetorial agora.
create table if not exists diario_humor (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references projetos(id) on delete cascade,
  humor text not null,
  registrado_em timestamptz default now()
);
alter table diario_humor enable row level security;
drop policy if exists "cliente gerencia seu humor" on diario_humor;
create policy "cliente gerencia seu humor" on diario_humor for all
  using (exists (select 1 from projetos p where p.id = diario_humor.projeto_id and p.email = auth.email()))
  with check (exists (select 1 from projetos p where p.id = diario_humor.projeto_id and p.email = auth.email()));

-- NOTA: a tabela `cartas_futuro` (criada em uma versão anterior desta migração) não é mais
-- usada pelo painel — o conceito de "carta lacrada" foi substituído pelo diário de emoções
-- acima. Deixamos a tabela como está (não fazemos DROP) caso já tenha dados; ela é apenas
-- ignorada pelo código atual de meu-projeto.html.

-- ─── 7. Mural de imagens — evolução fotográfica registrada pelo cliente ───
-- Dados privados: mesma regra do diário, nunca aparece no painel do arquiteto.
create table if not exists mural_fotos (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references projetos(id) on delete cascade,
  url text not null,
  legenda text,
  criado_em timestamptz default now()
);
alter table mural_fotos enable row level security;
drop policy if exists "cliente gerencia seu mural" on mural_fotos;
create policy "cliente gerencia seu mural" on mural_fotos for all
  using (exists (select 1 from projetos p where p.id = mural_fotos.projeto_id and p.email = auth.email()))
  with check (exists (select 1 from projetos p where p.id = mural_fotos.projeto_id and p.email = auth.email()));

-- ─── 8. Card "O que você sonhou" ───
-- Planta baixa do imóvel, mostrada no card (estado vazio até chegar). O upload real será
-- feito na etapa de contratação e o link gravado aqui depois. Ex.:
--   update projetos set planta_baixa_url = 'https://.../planta.png' where id = '...';
alter table projetos add column if not exists planta_baixa_url text;

-- Jogo dos palpites ("Quem divide esse sonho com você"): dado próprio do card, NÃO vem do briefing.
-- Uma linha por (projeto, personagem). `personagem_key` = 'mb-N' (mesmo índice do morador no briefing).
-- `palpite` é registrado antes; `confirmacao` depois que a fase Imagens é liberada. Ambos texto livre.
-- Privado do cliente — nunca aparece no painel do arquiteto.
create table if not exists palpites_ambiente (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references projetos(id) on delete cascade,
  personagem_key text not null,
  personagem_nome text,
  personagem_tipo text,           -- 'humano' | 'pet'
  palpite text,                   -- registrado ANTES das imagens
  confirmacao text,               -- registrado DEPOIS das imagens
  atualizado_em timestamptz default now(),
  unique (projeto_id, personagem_key)
);
alter table palpites_ambiente enable row level security;
drop policy if exists "cliente gerencia seus palpites" on palpites_ambiente;
create policy "cliente gerencia seus palpites" on palpites_ambiente for all
  using (exists (select 1 from projetos p where p.id = palpites_ambiente.projeto_id and p.email = auth.email()))
  with check (exists (select 1 from projetos p where p.id = palpites_ambiente.projeto_id and p.email = auth.email()));

-- ─── Seed do glossário (conteúdo editorial — pode editar/expandir pelo Table Editor) ───
-- Remove duplicatas de `termo` antes de criar a constraint única (idempotente: não faz nada
-- se não houver duplicatas). Mantém a linha mais antiga (menor id) de cada termo repetido.
delete from glossario_termos a
using glossario_termos b
where a.termo = b.termo
  and a.id > b.id;

-- Constraint única em `termo` para o ON CONFLICT funcionar em reexecuções desta migração.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'glossario_termos_termo_key') then
    alter table glossario_termos add constraint glossario_termos_termo_key unique (termo);
  end if;
end $$;

insert into glossario_termos (termo, explicacao, ordem) values
  ('Briefing', 'A conversa inicial onde você conta seus sonhos, necessidades e estilo. É o alicerce de todo o projeto.', 1),
  ('Layout', 'A distribuição dos ambientes e móveis no espaço. Define por onde você anda, onde descansa, onde recebe.', 2),
  ('Projeto executivo', 'O conjunto de desenhos técnicos com todas as medidas e especificações que orientam a obra. É o mapa que o pedreiro e o marceneiro seguem.', 3),
  ('Planta baixa', 'O desenho do apartamento visto de cima, como se o teto fosse removido. Mostra a posição de paredes, portas e móveis.', 4),
  ('Render (imagem 3D)', 'Uma imagem realista de como o ambiente vai ficar pronto, feita no computador antes da obra.', 5),
  ('Marcenaria', 'Móveis planejados feitos sob medida para o seu espaço: armários, painéis, estantes.', 6),
  ('Drywall', 'Placas de gesso para construir paredes e forros de forma rápida e limpa, sem quebra-quebra.', 7),
  ('Ponto elétrico / hidráulico', 'Locais onde ficam tomadas, interruptores e saídas de água. Definir bem evita dor de cabeça depois.', 8),
  ('Revestimento', 'O material que cobre pisos e paredes: porcelanato, cerâmica, papel de parede, tinta.', 9),
  ('Iluminação indireta', 'Luz que não vem direto de uma lâmpada visível, criando aconchego e destacando ambientes.', 10),
  ('Cronograma de obra', 'O calendário que organiza cada etapa da reforma, do início à entrega.', 11),
  ('Memorial descritivo', 'Documento que lista todos os materiais e acabamentos escolhidos para a obra.', 12),
  ('Vistoria', 'A conferência do imóvel antes de receber as chaves, para garantir que está tudo certo.', 13),
  ('Habite-se', 'Documento da prefeitura que atesta que o prédio está pronto e apto para ser habitado.', 14),
  ('Marcenaria sob medida vs. modulada', 'Sob medida é feita exatamente para o seu espaço; modulada usa peças de tamanhos padrão, mais econômica.', 15)
on conflict (termo) do nothing;
