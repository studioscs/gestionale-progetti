-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 005
-- Scaglioni di fatturazione e dati fiscali del committente
-- =============================================================================
-- Da eseguire DOPO 001, 002 e 004. Idempotente e solo additivo.
--
-- Il software di fatturazione sa emettere fatture ma non sa nulla della
-- commessa: non sa che il SAL e' chiuso, che la fase autorizzativa e' conclusa,
-- che l'acconto alla firma dell'incarico non e' mai stato emesso. Qui si tiene
-- traccia di COSA e QUANDO fatturare, agganciando ogni scaglione alla fase che
-- lo fa maturare.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PROJECTS - dati fiscali del committente, necessari per la fattura
-- -----------------------------------------------------------------------------
alter table public.projects add column if not exists cliente_piva      text;
alter table public.projects add column if not exists cliente_cf        text;
alter table public.projects add column if not exists cliente_sdi       text;  -- codice destinatario SDI
alter table public.projects add column if not exists cliente_pec       text;
alter table public.projects add column if not exists cliente_indirizzo text;
alter table public.projects add column if not exists cliente_cap       text;
alter table public.projects add column if not exists cliente_comune    text;
alter table public.projects add column if not exists cliente_prov      text;

-- -----------------------------------------------------------------------------
-- 2. COMMESSA_FATTURE - gli scaglioni di fatturazione
-- -----------------------------------------------------------------------------
create table if not exists public.commessa_fatture (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  descrizione        text not null,
  ordine             integer not null default 0,

  -- Importo: o una percentuale dell'importo di commessa, o un valore fisso
  percentuale        numeric(5,2),
  imponibile         numeric(12,2),

  -- Aggancio alla fase che fa maturare lo scaglione: quando la fase si chiude
  -- lo scaglione passa da "da_emettere" a "pronta"
  fase_id            uuid references public.commessa_fasi(id) on delete set null,
  data_prevista      date,

  stato              text not null default 'da_emettere'
                     check (stato in ('da_emettere','pronta','emessa','incassata','annullata')),

  numero_fattura     text,
  data_fattura       date,
  data_incasso       date,
  importo_incassato  numeric(12,2),
  xml_generato_at    timestamptz,
  note               text,

  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_fatture_project on public.commessa_fatture(project_id, ordine);
create index if not exists idx_fatture_fase    on public.commessa_fatture(fase_id) where fase_id is not null;
create index if not exists idx_fatture_aperte  on public.commessa_fatture(stato)
  where stato in ('da_emettere','pronta','emessa');

drop trigger if exists trg_touch_commessa_fatture on public.commessa_fatture;
create trigger trg_touch_commessa_fatture before update on public.commessa_fatture
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 3. RLS - stesso modello delle altre tabelle di commessa
-- -----------------------------------------------------------------------------
alter table public.commessa_fatture enable row level security;

drop policy if exists "read_all_commessa_fatture"   on public.commessa_fatture;
drop policy if exists "insert_staff_commessa_fatture" on public.commessa_fatture;
drop policy if exists "update_staff_commessa_fatture" on public.commessa_fatture;
drop policy if exists "delete_admin_commessa_fatture" on public.commessa_fatture;

create policy "read_all_commessa_fatture"    on public.commessa_fatture
  for select to authenticated using (true);
create policy "insert_staff_commessa_fatture" on public.commessa_fatture
  for insert to authenticated with check (public.is_staff());
create policy "update_staff_commessa_fatture" on public.commessa_fatture
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "delete_admin_commessa_fatture" on public.commessa_fatture
  for delete to authenticated using (public.is_admin());

-- -----------------------------------------------------------------------------
-- 4. MATURAZIONE AUTOMATICA
--    Quando una fase viene completata, gli scaglioni agganciati diventano
--    "pronta": e' il collegamento che fa guadagnare il gestionale, perche'
--    nessuno deve ricordarsi di controllare.
-- -----------------------------------------------------------------------------
create or replace function public.matura_scaglioni()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stato = 'completata' and coalesce(old.stato,'') <> 'completata' then
    update public.commessa_fatture
       set stato = 'pronta'
     where fase_id = new.id and stato = 'da_emettere';
  end if;
  return new;
end; $$;

drop trigger if exists trg_matura_scaglioni on public.commessa_fasi;
create trigger trg_matura_scaglioni
  after update of stato on public.commessa_fasi
  for each row execute function public.matura_scaglioni();

-- -----------------------------------------------------------------------------
-- 5. VISTE DI RIEPILOGO
-- -----------------------------------------------------------------------------
create or replace view public.v_da_fatturare as
select
  f.id,
  f.project_id,
  p.name                       as commessa,
  p.client                     as committente,
  f.descrizione,
  f.stato,
  coalesce(f.imponibile,
           round(p.amount * f.percentuale / 100, 2)) as imponibile_calcolato,
  f.data_prevista,
  fa.nome                      as fase,
  fa.stato                     as fase_stato
from public.commessa_fatture f
join public.projects p       on p.id = f.project_id
left join public.commessa_fasi fa on fa.id = f.fase_id
where f.stato in ('da_emettere','pronta')
  and p.archiviato = false;

create or replace view public.v_fatturato_commessa as
select
  p.id                                                              as project_id,
  p.name,
  p.amount                                                          as importo_commessa,
  coalesce(sum(coalesce(f.imponibile, round(p.amount * f.percentuale / 100, 2)))
           filter (where f.stato in ('emessa','incassata')), 0)     as fatturato,
  coalesce(sum(f.importo_incassato) filter (where f.stato = 'incassata'), 0) as incassato,
  coalesce(sum(coalesce(f.imponibile, round(p.amount * f.percentuale / 100, 2)))
           filter (where f.stato in ('da_emettere','pronta')), 0)   as da_fatturare
from public.projects p
left join public.commessa_fatture f on f.project_id = p.id and f.stato <> 'annullata'
group by p.id, p.name, p.amount;

-- =============================================================================
-- FINE MIGRAZIONE 005
-- =============================================================================
