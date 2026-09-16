-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 027
-- Le spese anticipate per il committente
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Bolli del Genio civile, bolli del Comune, visure al catasto, diritti di
-- segreteria: soldi che lo studio tira fuori di tasca per conto del cliente e
-- che il cliente deve restituire. Non erano scritti da nessuna parte. Chi
-- fatturava doveva ricordarsele, o ritrovare le ricevute, e quando se ne
-- dimenticava una quella era persa: nessuno la reclama al posto tuo.
--
-- LA CORREZIONE
-- Una riga per ogni anticipo, sulla commessa, appena lo si sostiene. Da li' va
-- in automatico sulla prima fattura che si genera, e si segna da sola come
-- fatturata: non si puo' ne' dimenticarla ne' metterla due volte.
--
-- PERCHE' NON SONO UN COMPENSO
-- Le anticipazioni in nome e per conto del cliente stanno FUORI dalla base
-- imponibile (art. 15, comma 1, n. 3 del DPR 633/72): niente IVA e niente
-- contributo cassa. In fattura sono una riga a parte, aliquota zero e natura
-- N1 - escluse ex art. 15 - e si sommano solo al totale del documento.
-- Trattarle come un compenso significherebbe pagarci sopra IVA e cassa su soldi
-- che non sono un ricavo: un costo vero, ogni volta.
-- =============================================================================

create table if not exists public.commessa_spese (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,

  tipo         text not null default 'altro'
               check (tipo in ('bolli_genio','bolli_comune','catasto',
                               'diritti_comune','altro')),
  descrizione  text,            -- obbligatoria di fatto quando tipo = 'altro'
  importo      numeric(12,2) not null default 0,
  data_spesa   date not null default current_date,
  note         text,

  -- La fattura che se l'e' presa. Nulla = ancora da fatturare.
  fattura_id   uuid references public.commessa_fatture(id) on delete set null,

  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_spese_progetto on public.commessa_spese(project_id, data_spesa);
-- Le spese ancora da fatturare sono quelle che si cercano di continuo: l'indice
-- parziale tiene in memoria solo quelle, che sono poche.
create index if not exists idx_spese_aperte on public.commessa_spese(project_id)
  where fattura_id is null;

comment on table public.commessa_spese is
  'Anticipazioni in nome e per conto del committente (art. 15 DPR 633/72): bolli, visure, diritti. Fuori dalla base imponibile: niente IVA e niente cassa.';
comment on column public.commessa_spese.tipo is
  'bolli_genio, bolli_comune, catasto, diritti_comune, altro. Con "altro" la descrizione dice di cosa si tratta.';
comment on column public.commessa_spese.fattura_id is
  'La fattura che ha incluso la spesa. Nulla = va sulla prima che si genera.';

drop trigger if exists trg_touch_spese on public.commessa_spese;
create trigger trg_touch_spese before update on public.commessa_spese
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: la stessa regola di tutto il resto (migrazione 018).
-- Quanto lo studio ha anticipato su una commessa non lo deve leggere chi quella
-- commessa non la vede.
-- -----------------------------------------------------------------------------
alter table public.commessa_spese enable row level security;

drop policy if exists "vis_read_commessa_spese"   on public.commessa_spese;
drop policy if exists "vis_insert_commessa_spese" on public.commessa_spese;
drop policy if exists "vis_update_commessa_spese" on public.commessa_spese;
drop policy if exists "vis_delete_commessa_spese" on public.commessa_spese;

create policy "vis_read_commessa_spese" on public.commessa_spese
  for select to authenticated
  using (project_id in (select public.commesse_visibili()));
create policy "vis_insert_commessa_spese" on public.commessa_spese
  for insert to authenticated
  with check (public.is_staff() and project_id in (select public.commesse_visibili()));
create policy "vis_update_commessa_spese" on public.commessa_spese
  for update to authenticated
  using (public.is_staff() and project_id in (select public.commesse_visibili()))
  with check (public.is_staff());
create policy "vis_delete_commessa_spese" on public.commessa_spese
  for delete to authenticated
  using (public.is_staff() and project_id in (select public.commesse_visibili()));

-- =============================================================================
-- FINE MIGRAZIONE 027
--
-- Verifica: cosa c'e' ancora da farsi restituire, commessa per commessa.
--   select p.name, s.tipo, s.descrizione, s.importo, s.data_spesa
--   from public.commessa_spese s
--   join public.projects p on p.id = s.project_id
--   where s.fattura_id is null
--   order by p.name, s.data_spesa;
-- =============================================================================
