-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 008
-- Anagrafica clienti riutilizzabile fra commesse
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- Un cliente che torna non va riscritto da capo: si sceglie dall'anagrafica e i
-- suoi dati (fiscali, sede, referenti) finiscono nella nuova commessa.
--
-- SCELTA DI FONDO: la commessa conserva una COPIA dei dati del cliente al
-- momento della creazione, non un semplice riferimento. Se fra due anni il
-- cliente cambia sede, le fatture gia' emesse restano coerenti con quello che
-- fu dichiarato allora. Il collegamento (cliente_id) resta per sapere di chi si
-- tratta e per riallineare i dati quando serve.
-- =============================================================================

create table if not exists public.clienti (
  id                  uuid primary key default gen_random_uuid(),

  denominazione       text not null,
  tipo                text not null default 'societa' check (tipo in ('societa','persona')),
  nome                text,                 -- per le persone fisiche
  cognome             text,

  -- Dati fiscali
  piva                text,
  cf                  text,
  sdi                 text,                 -- codice destinatario, 7 caratteri
  pec                 text,
  regime              text,                 -- eventuale nota sul regime del cliente

  -- Sede
  indirizzo           text,
  cap                 text,
  comune              text,
  provincia           text,

  -- Referenti: gli stessi due ruoli usati nelle commesse
  referente           text,
  referente_ruolo     text,
  referente_email     text,
  referente_tel       text,
  referente_tec       text,
  referente_tec_ruolo text,
  referente_tec_email text,
  referente_tec_tel   text,

  note                text,
  attivo              boolean not null default true,

  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Collegamento dalla commessa al cliente
alter table public.projects add column if not exists cliente_id uuid;

do $$
begin
  if not exists (select 1 from information_schema.table_constraints
                 where constraint_name = 'projects_cliente_id_fkey' and table_name = 'projects') then
    alter table public.projects
      add constraint projects_cliente_id_fkey
      foreign key (cliente_id) references public.clienti(id) on delete set null;
  end if;
end $$;

-- Ricerca per denominazione e per partita IVA
create index if not exists idx_clienti_nome on public.clienti (lower(denominazione));
create index if not exists idx_clienti_piva on public.clienti (piva) where piva is not null;
create index if not exists idx_projects_cliente on public.projects (cliente_id) where cliente_id is not null;

-- Evita di inserire due volte lo stesso soggetto con la stessa partita IVA
create unique index if not exists uq_clienti_piva
  on public.clienti (piva) where piva is not null and piva <> '';

drop trigger if exists trg_touch_clienti on public.clienti;
create trigger trg_touch_clienti before update on public.clienti
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: stesso modello delle altre tabelle
-- -----------------------------------------------------------------------------
alter table public.clienti enable row level security;

drop policy if exists "read_all_clienti"    on public.clienti;
drop policy if exists "insert_staff_clienti" on public.clienti;
drop policy if exists "update_staff_clienti" on public.clienti;
drop policy if exists "delete_admin_clienti" on public.clienti;

create policy "read_all_clienti"    on public.clienti for select to authenticated using (true);
create policy "insert_staff_clienti" on public.clienti for insert to authenticated with check (public.is_staff());
create policy "update_staff_clienti" on public.clienti for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "delete_admin_clienti" on public.clienti for delete to authenticated using (public.is_admin());

-- -----------------------------------------------------------------------------
-- POPOLAMENTO INIZIALE dai clienti gia' presenti nelle commesse
-- Raggruppa per denominazione, prende i dati piu' completi disponibili e
-- ricollega le commesse. Si puo' rilanciare: non duplica.
-- -----------------------------------------------------------------------------
do $$
declare r record; nuovo uuid;
begin
  for r in
    select p.client as denominazione,
           max(p.cliente_piva)      as piva,
           max(p.cliente_cf)        as cf,
           max(p.cliente_sdi)       as sdi,
           max(p.cliente_pec)       as pec,
           max(p.cliente_indirizzo) as indirizzo,
           max(p.cliente_cap)       as cap,
           max(p.cliente_comune)    as comune,
           max(p.cliente_prov)      as provincia,
           max(p.referente)         as referente,
           max(p.referente_ruolo)   as referente_ruolo,
           max(p.referente_email)   as referente_email,
           max(p.referente_tel)     as referente_tel,
           max(p.referente_tec)     as referente_tec,
           max(p.referente_tec_ruolo) as referente_tec_ruolo,
           max(p.referente_tec_email) as referente_tec_email,
           max(p.referente_tec_tel)   as referente_tec_tel
      from public.projects p
     where coalesce(trim(p.client), '') <> ''
       and p.cliente_id is null
     group by p.client
  loop
    select id into nuovo from public.clienti
     where lower(denominazione) = lower(r.denominazione) limit 1;

    if nuovo is null then
      insert into public.clienti(denominazione, piva, cf, sdi, pec, indirizzo, cap, comune,
                                 provincia, referente, referente_ruolo, referente_email,
                                 referente_tel, referente_tec, referente_tec_ruolo,
                                 referente_tec_email, referente_tec_tel)
      values (r.denominazione, nullif(r.piva,''), nullif(r.cf,''), nullif(r.sdi,''), nullif(r.pec,''),
              r.indirizzo, r.cap, r.comune, r.provincia, r.referente, r.referente_ruolo,
              r.referente_email, r.referente_tel, r.referente_tec, r.referente_tec_ruolo,
              r.referente_tec_email, r.referente_tec_tel)
      returning id into nuovo;
    end if;

    update public.projects set cliente_id = nuovo
     where client = r.denominazione and cliente_id is null;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- VISTA: quante commesse e quanto fatturato per cliente
-- -----------------------------------------------------------------------------
create or replace view public.v_clienti_riepilogo as
select
  c.id                                                             as cliente_id,
  c.denominazione,
  c.comune,
  count(p.id)                                                      as commesse,
  count(p.id) filter (where p.status = 'attivo')                   as commesse_attive,
  coalesce(sum(p.amount), 0)                                       as importo_commesse,
  max(p.start_date)                                                as ultima_commessa
from public.clienti c
left join public.projects p on p.cliente_id = c.id and p.archiviato = false
group by c.id, c.denominazione, c.comune;

-- =============================================================================
-- FINE MIGRAZIONE 008
-- =============================================================================
