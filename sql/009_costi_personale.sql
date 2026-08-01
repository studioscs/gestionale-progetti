-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 009
-- Costo orario dei collaboratori e costo del lavoro per commessa
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- DUE SCELTE IMPORTANTI, ENTRAMBE DELIBERATE
--
-- 1. I COSTI NON STANNO IN "profiles".
--    profiles e' leggibile da tutti gli utenti autenticati: serve per assegnare
--    le attivita' e mostrare i nomi. Mettendoci dentro il costo orario, ogni
--    collaboratore potrebbe leggere la retribuzione degli altri interrogando
--    l'API con la chiave anon, che e' pubblica. I costi vivono percio' in una
--    tabella separata, accessibile ai soli amministratori.
--
-- 2. I COSTI SONO STORICIZZATI.
--    Un aumento non deve riscrivere il costo delle commesse gia' chiuse. Ogni
--    riga vale da una data a un'altra; le ore registrate vengono valorizzate
--    con il costo in vigore in quel giorno, non con quello di oggi.
-- =============================================================================

create table if not exists public.profili_costi (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references public.profiles(id) on delete cascade,

  costo_orario_lordo  numeric(10,2),   -- costo pieno per lo studio (retribuzione + oneri)
  costo_orario_netto  numeric(10,2),   -- netto riconosciuto alla persona
  tariffa_oraria      numeric(10,2),   -- eventuale tariffa esposta al cliente

  valido_dal          date not null default current_date,
  valido_al           date,            -- NULL = ancora in vigore
  note                text,

  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint periodo_coerente check (valido_al is null or valido_al >= valido_dal)
);

create index if not exists idx_costi_profilo on public.profili_costi(profile_id, valido_dal desc);

-- Un solo periodo aperto per persona: evita due costi contemporaneamente validi
create unique index if not exists uq_costi_aperto
  on public.profili_costi(profile_id) where valido_al is null;

drop trigger if exists trg_touch_profili_costi on public.profili_costi;
create trigger trg_touch_profili_costi before update on public.profili_costi
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: SOLO GLI AMMINISTRATORI. Nessuna lettura per collaboratori e viewer.
-- -----------------------------------------------------------------------------
alter table public.profili_costi enable row level security;

drop policy if exists "costi_read_admin"   on public.profili_costi;
drop policy if exists "costi_insert_admin" on public.profili_costi;
drop policy if exists "costi_update_admin" on public.profili_costi;
drop policy if exists "costi_delete_admin" on public.profili_costi;

create policy "costi_read_admin"   on public.profili_costi for select to authenticated using (public.is_admin());
create policy "costi_insert_admin" on public.profili_costi for insert to authenticated with check (public.is_admin());
create policy "costi_update_admin" on public.profili_costi for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "costi_delete_admin" on public.profili_costi for delete to authenticated using (public.is_admin());

-- -----------------------------------------------------------------------------
-- CHIUSURA AUTOMATICA DEL PERIODO PRECEDENTE
-- Inserendo un nuovo costo per una persona, quello prima si chiude il giorno
-- precedente: cosi' non serve ricordarsi di farlo a mano.
--
-- Deve essere BEFORE INSERT, non AFTER: l'indice che ammette un solo periodo
-- aperto per persona viene verificato all'inserimento della riga, quindi la
-- chiusura del periodo precedente deve essere gia' avvenuta. Con AFTER, ogni
-- aumento di stipendio verrebbe rifiutato.
-- -----------------------------------------------------------------------------
create or replace function public.chiudi_costo_precedente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profili_costi
     set valido_al = new.valido_dal - 1
   where profile_id = new.profile_id
     and valido_al is null
     and valido_dal < new.valido_dal;
  return new;
end; $$;

drop trigger if exists trg_chiudi_costo on public.profili_costi;
create trigger trg_chiudi_costo
  before insert on public.profili_costi
  for each row execute function public.chiudi_costo_precedente();

-- -----------------------------------------------------------------------------
-- VALORIZZAZIONE DELLE ORE
-- security_invoker = true e' ESSENZIALE: senza, la vista girerebbe con i
-- permessi del proprietario e aggirerebbe l'RLS, esponendo i costi a chiunque.
-- Con RLS attiva, un non-amministratore vede semplicemente costi nulli.
-- -----------------------------------------------------------------------------
create or replace view public.v_ore_valorizzate
with (security_invoker = true) as
select
  te.id, te.project_id, te.operator_id, te.entry_date, te.hours, te.description,
  c.costo_orario_lordo,
  c.costo_orario_netto,
  round(te.hours * coalesce(c.costo_orario_lordo, 0), 2) as costo_lordo,
  round(te.hours * coalesce(c.costo_orario_netto, 0), 2) as costo_netto,
  round(te.hours * coalesce(c.tariffa_oraria,     0), 2) as ricavo_teorico
from public.time_entries te
left join public.profili_costi c
       on c.profile_id = te.operator_id
      and te.entry_date >= c.valido_dal
      and (c.valido_al is null or te.entry_date <= c.valido_al);

-- -----------------------------------------------------------------------------
-- COSTO DEL LAVORO PER COMMESSA
-- Durata effettiva calcolata dalla prima all'ultima registrazione di ore.
-- -----------------------------------------------------------------------------
create or replace view public.v_costo_commessa
with (security_invoker = true) as
select
  p.id                                             as project_id,
  p.name,
  p.amount                                         as importo_commessa,
  count(distinct v.operator_id)                    as persone_coinvolte,
  coalesce(sum(v.hours), 0)                        as ore_totali,
  coalesce(sum(v.costo_lordo), 0)                  as costo_lordo,
  coalesce(sum(v.costo_netto), 0)                  as costo_netto,
  case when coalesce(sum(v.hours), 0) > 0
       then round(sum(v.costo_lordo) / sum(v.hours), 2) end as costo_orario_medio,
  min(v.entry_date)                                as prima_ora,
  max(v.entry_date)                                as ultima_ora,
  case when min(v.entry_date) is not null
       then (max(v.entry_date) - min(v.entry_date)) + 1 end  as giorni_lavorati,
  case when p.amount is not null
       then round(p.amount - coalesce(sum(v.costo_lordo), 0), 2) end as margine_lordo
from public.projects p
left join public.v_ore_valorizzate v on v.project_id = p.id
group by p.id, p.name, p.amount;

-- =============================================================================
-- FINE MIGRAZIONE 009
--
-- Verifica rapida della riservatezza (da eseguire come collaboratore, non admin):
--   select count(*) from profili_costi;        -- deve dare 0
--   select sum(costo_lordo) from v_costo_commessa;  -- deve dare 0
-- =============================================================================
