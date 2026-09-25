-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 031
-- I costi generali dello studio, che non appartengono a nessuna commessa
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Il gestionale conosceva solo i costi che stanno su una commessa: le ore di
-- chi ci lavora, le parcelle degli esterni, le spese anticipate. Ma lo studio
-- paga anche quello che non e' di nessuna commessa - la consulenza per il
-- sistema qualita', le bollette, gli abbonamenti, la manutenzione dei
-- programmi, l'assicurazione - e quelle spese vivevano altrove, in un foglio o
-- nella memoria di chi paga.
--
-- LA CORREZIONE
-- Un elenco suo, con la categoria, il fornitore, l'importo, l'anno di
-- competenza e se e' gia' stato pagato. Da li' si legge quanto costa tenere
-- aperto lo studio, anno per anno e voce per voce.
--
-- CHI LO VEDE
-- Chi tiene l'amministrazione: gli amministratori e chi ha il contrassegno
-- "vede tutte le commesse" (migrazione 018). Sono i conti dello studio, non il
-- lavoro di una commessa, e un collaboratore non ha motivo di leggerli.
-- =============================================================================

create table if not exists public.costi_generali (
  id              uuid primary key default gen_random_uuid(),

  categoria       text not null default 'altro'
                  check (categoria in ('qualita','consulenze','utenze','affitto',
                                       'software','hardware','assicurazioni',
                                       'formazione','ordini_professionali',
                                       'veicoli','cancelleria','banca','altro')),
  descrizione     text not null,
  fornitore       text,
  importo         numeric(12,2) not null check (importo >= 0),

  data_spesa      date not null default current_date,
  -- L'anno a cui il costo appartiene. Non e' per forza quello della data: la
  -- bolletta di dicembre pagata a gennaio e' un costo dell'anno prima.
  anno_competenza integer check (anno_competenza is null
                                 or anno_competenza between 2000 and 2100),

  pagato          boolean not null default false,
  data_pagamento  date,
  note            text,

  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- una data di pagamento senza pagamento non vuol dire niente
  constraint ck_costi_pagamento_coerente check (data_pagamento is null or pagato)
);

create index if not exists idx_costi_anno on public.costi_generali(anno_competenza);
create index if not exists idx_costi_dapagare on public.costi_generali(data_spesa)
  where not pagato;

comment on table public.costi_generali is
  'Costi dello studio che non appartengono a una commessa: qualita'', utenze, abbonamenti, software, assicurazioni. Li vede chi tiene l''amministrazione.';
comment on column public.costi_generali.anno_competenza is
  'Anno a cui il costo appartiene. Non e'' per forza quello della data: la bolletta di dicembre pagata a gennaio e'' dell''anno prima.';

drop trigger if exists trg_touch_costi_generali on public.costi_generali;
create trigger trg_touch_costi_generali before update on public.costi_generali
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: solo chi tiene l'amministrazione. vede_tutte_commesse() e' vera per gli
-- amministratori e per chi ha il contrassegno "vede tutto" (migrazione 018).
-- -----------------------------------------------------------------------------
alter table public.costi_generali enable row level security;

drop policy if exists "amm_read_costi_generali"   on public.costi_generali;
drop policy if exists "amm_insert_costi_generali" on public.costi_generali;
drop policy if exists "amm_update_costi_generali" on public.costi_generali;
drop policy if exists "amm_delete_costi_generali" on public.costi_generali;

create policy "amm_read_costi_generali" on public.costi_generali
  for select to authenticated using (public.vede_tutte_commesse());
create policy "amm_insert_costi_generali" on public.costi_generali
  for insert to authenticated with check (public.vede_tutte_commesse());
create policy "amm_update_costi_generali" on public.costi_generali
  for update to authenticated using (public.vede_tutte_commesse())
  with check (public.vede_tutte_commesse());
create policy "amm_delete_costi_generali" on public.costi_generali
  for delete to authenticated using (public.vede_tutte_commesse());

-- =============================================================================
-- FINE MIGRAZIONE 031
--
-- Verifica: quanto e' costato lo studio in un anno, voce per voce.
--   select categoria, count(*) as voci, sum(importo) as totale,
--          sum(importo) filter (where not pagato) as da_pagare
--   from public.costi_generali
--   where coalesce(anno_competenza, extract(year from data_spesa)::int) = 2026
--   group by categoria order by totale desc;
-- =============================================================================
