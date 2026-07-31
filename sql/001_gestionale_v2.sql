-- =============================================================================
-- SCS Gestionale Progetti - Migrazione v2
-- =============================================================================
-- Esegui questo script UNA VOLTA nel SQL Editor di Supabase.
-- E' idempotente: puoi rilanciarlo senza rischi, non cancella nulla.
-- Non modifica ne' elimina le tabelle esistenti (projects, tasks, time_entries,
-- files, profiles, project_fasi, project_sottofasi): aggiunge solo colonne
-- nuove e tabelle nuove.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. HELPER DI RUOLO (usati dalle policy RLS)
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','collaboratore'));
$$;

-- -----------------------------------------------------------------------------
-- 1. PROFILES - email visibile allo studio + flag attivo
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists email      text;
alter table public.profiles add column if not exists attivo     boolean not null default true;
alter table public.profiles add column if not exists telefono   text;

-- Backfill delle email dagli utenti auth (una tantum)
do $$
begin
  update public.profiles p set email = u.email
    from auth.users u where u.id = p.id and p.email is null;
exception when others then
  raise notice 'Backfill email non eseguito: %', sqlerrm;
end $$;

-- Trigger: mantiene profiles.email allineata a auth.users
create or replace function public.sync_profile_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end; $$;

do $$
begin
  drop trigger if exists trg_sync_profile_email on auth.users;
  create trigger trg_sync_profile_email
    after insert or update of email on auth.users
    for each row execute function public.sync_profile_email();
exception when insufficient_privilege or others then
  raise notice 'Trigger su auth.users non creato (%). Le email dei profili andranno impostate a mano da Utenti.', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- 2. PROJECTS - anagrafica tecnica della commessa
-- -----------------------------------------------------------------------------
alter table public.projects add column if not exists codice          text;
alter table public.projects add column if not exists template_key    text;
alter table public.projects add column if not exists condizioni      text[] not null default '{}';
alter table public.projects add column if not exists comune          text;
alter table public.projects add column if not exists provincia       text;
alter table public.projects add column if not exists indirizzo       text;
alter table public.projects add column if not exists dati_catastali  text;
alter table public.projects add column if not exists referente       text;
alter table public.projects add column if not exists referente_email text;
alter table public.projects add column if not exists referente_tel   text;
alter table public.projects add column if not exists archiviato      boolean not null default false;
alter table public.projects add column if not exists updated_at      timestamptz not null default now();

-- -----------------------------------------------------------------------------
-- 3. TASKS - diventano le "attivita' di checklist" della commessa
--    (stessi stati di prima: da_fare / in_corso / revisione / completato)
-- -----------------------------------------------------------------------------
alter table public.tasks add column if not exists sort_order      integer not null default 0;
alter table public.tasks add column if not exists completed_at    timestamptz;
alter table public.tasks add column if not exists completed_by    uuid references public.profiles(id) on delete set null;
alter table public.tasks add column if not exists is_milestone    boolean not null default false;
alter table public.tasks add column if not exists opzionale       boolean not null default false;
alter table public.tasks add column if not exists template_key    text;
alter table public.tasks add column if not exists rif_normativo   text;
alter table public.tasks add column if not exists ente            text;
alter table public.tasks add column if not exists updated_at      timestamptz not null default now();

-- Collegamento alle NUOVE fasi (colonna separata da fase_id legacy,
-- cosi' non tocchiamo eventuali vincoli gia' presenti su project_fasi)
alter table public.tasks add column if not exists commessa_fase_id uuid;

-- -----------------------------------------------------------------------------
-- 4. COMMESSA_FASI - fasi di lavoro generate da template
-- -----------------------------------------------------------------------------
create table if not exists public.commessa_fasi (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  fase_key            text not null,
  nome                text not null,
  descrizione         text,
  ordine              integer not null default 0,
  icona               text,
  stato               text not null default 'non_avviata'
                      check (stato in ('non_avviata','in_corso','completata','non_applicabile')),
  responsabile_id     uuid references public.profiles(id) on delete set null,
  data_inizio         date,
  data_fine_prevista  date,
  data_completamento  date,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (project_id, fase_key)          -- <- impedisce la generazione doppia
);

-- FK differita di tasks -> commessa_fasi (creata solo se non esiste gia')
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'tasks_commessa_fase_id_fkey' and table_name = 'tasks'
  ) then
    alter table public.tasks
      add constraint tasks_commessa_fase_id_fkey
      foreign key (commessa_fase_id) references public.commessa_fasi(id) on delete cascade;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. COMMESSA_PRATICHE - autorizzazioni, pareri, depositi verso gli enti
-- -----------------------------------------------------------------------------
create table if not exists public.commessa_pratiche (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  fase_id            uuid references public.commessa_fasi(id) on delete set null,
  pratica_key        text,
  ente               text not null,
  tipo               text not null,
  oggetto            text,
  rif_normativo      text,
  responsabile_id    uuid references public.profiles(id) on delete set null,
  stato              text not null default 'da_preparare'
                     check (stato in ('da_preparare','in_preparazione','inviata',
                                      'integrazioni','sospesa','rilasciata','respinta','non_necessaria')),
  protocollo         text,
  data_invio         date,
  termine_giorni     integer,
  data_scadenza      date,          -- scadenza del termine di legge
  data_esito         date,
  esito              text,
  referente_ente     text,
  note               text,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 6. PRATICA_EVENTI - diario della pratica (invio, sollecito, integrazione...)
-- -----------------------------------------------------------------------------
create table if not exists public.pratica_eventi (
  id           uuid primary key default gen_random_uuid(),
  pratica_id   uuid not null references public.commessa_pratiche(id) on delete cascade,
  data         date not null default current_date,
  tipo         text not null default 'nota',
  descrizione  text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 7. NOTIFICHE - avvisi in-app (sostituiscono il mailto "a se stessi")
-- -----------------------------------------------------------------------------
create table if not exists public.notifiche (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete cascade,
  tipo         text not null default 'info',
  titolo       text not null,
  corpo        text,
  letta        boolean not null default false,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 8. INDICI (interrogazioni per commessa / per persona / per scadenza)
-- -----------------------------------------------------------------------------
create index if not exists idx_tasks_project        on public.tasks(project_id);
create index if not exists idx_tasks_cfase          on public.tasks(commessa_fase_id);
create index if not exists idx_tasks_assignee_open  on public.tasks(assignee_id) where status <> 'completato';
create index if not exists idx_tasks_due            on public.tasks(due_date) where status <> 'completato';
create index if not exists idx_cfasi_project        on public.commessa_fasi(project_id, ordine);
create index if not exists idx_prat_project         on public.commessa_pratiche(project_id);
create index if not exists idx_prat_scad            on public.commessa_pratiche(data_scadenza)
                                                    where stato not in ('rilasciata','respinta','non_necessaria');
create index if not exists idx_eventi_pratica       on public.pratica_eventi(pratica_id, data desc);
create index if not exists idx_notif_user           on public.notifiche(user_id, letta, created_at desc);
create index if not exists idx_te_project           on public.time_entries(project_id);
create index if not exists idx_files_project        on public.files(project_id);

-- -----------------------------------------------------------------------------
-- 9. TRIGGER updated_at + audit di completamento task
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['projects','tasks','commessa_fasi','commessa_pratiche'] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$s
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- Registra chi/quando ha chiuso un'attivita' (serve per lo storico e i report)
-- Attenzione: in un trigger BEFORE INSERT il record OLD non e' assegnato,
-- quindi va isolato il ramo INSERT prima di leggere old.status.
create or replace function public.stamp_task_completion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'completato' then
      new.completed_at = now();
      new.completed_by = auth.uid();
    end if;
    return new;
  end if;

  if new.status = 'completato' and old.status is distinct from 'completato' then
    new.completed_at = now();
    new.completed_by = auth.uid();
  elsif new.status <> 'completato' then
    new.completed_at = null;
    new.completed_by = null;
  end if;
  return new;
end; $$;

drop trigger if exists trg_stamp_task_completion on public.tasks;
create trigger trg_stamp_task_completion
  before insert or update of status on public.tasks
  for each row execute function public.stamp_task_completion();

-- Calcolo automatico della scadenza di legge di una pratica
create or replace function public.calc_scadenza_pratica()
returns trigger language plpgsql as $$
begin
  if new.data_invio is not null and new.termine_giorni is not null then
    new.data_scadenza = (new.data_invio + (new.termine_giorni || ' days')::interval)::date;
  end if;
  return new;
end; $$;

drop trigger if exists trg_calc_scadenza_pratica on public.commessa_pratiche;
create trigger trg_calc_scadenza_pratica
  before insert or update of data_invio, termine_giorni on public.commessa_pratiche
  for each row execute function public.calc_scadenza_pratica();

-- -----------------------------------------------------------------------------
-- 10. RLS - lettura a tutto lo studio, scrittura a staff, cancellazione ad admin
-- -----------------------------------------------------------------------------
alter table public.commessa_fasi     enable row level security;
alter table public.commessa_pratiche enable row level security;
alter table public.pratica_eventi    enable row level security;
alter table public.notifiche         enable row level security;

do $$
declare t text;
begin
  foreach t in array array['commessa_fasi','commessa_pratiche','pratica_eventi'] loop
    execute format('drop policy if exists "read_all_%1$s"   on public.%1$s', t);
    execute format('drop policy if exists "insert_staff_%1$s" on public.%1$s', t);
    execute format('drop policy if exists "update_staff_%1$s" on public.%1$s', t);
    execute format('drop policy if exists "delete_admin_%1$s" on public.%1$s', t);

    execute format('create policy "read_all_%1$s"    on public.%1$s for select to authenticated using (true)', t);
    execute format('create policy "insert_staff_%1$s" on public.%1$s for insert to authenticated with check (public.is_staff())', t);
    execute format('create policy "update_staff_%1$s" on public.%1$s for update to authenticated using (public.is_staff()) with check (public.is_staff())', t);
    execute format('create policy "delete_admin_%1$s" on public.%1$s for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- Le notifiche le vede solo il destinatario; chiunque sia staff puo' crearne
drop policy if exists "notif_read_own"   on public.notifiche;
drop policy if exists "notif_insert"     on public.notifiche;
drop policy if exists "notif_update_own" on public.notifiche;
drop policy if exists "notif_delete_own" on public.notifiche;

create policy "notif_read_own"   on public.notifiche for select to authenticated using (user_id = auth.uid());
create policy "notif_insert"     on public.notifiche for insert to authenticated with check (public.is_staff());
create policy "notif_update_own" on public.notifiche for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notif_delete_own" on public.notifiche for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- -----------------------------------------------------------------------------
-- 11. VISTA DI RIEPILOGO (avanzamento per commessa, calcolato dal DB)
-- -----------------------------------------------------------------------------
create or replace view public.v_avanzamento_commesse as
select
  p.id                                                        as project_id,
  p.name,
  p.status,
  count(t.id)                                                 as attivita_totali,
  count(t.id) filter (where t.status = 'completato')           as attivita_chiuse,
  count(t.id) filter (where t.status <> 'completato'
                        and t.due_date < current_date)         as attivita_scadute,
  case when count(t.id) = 0 then 0
       else round(100.0 * count(t.id) filter (where t.status = 'completato') / count(t.id))
  end                                                          as avanzamento_pct
from public.projects p
left join public.tasks t on t.project_id = p.id and t.opzionale = false
group by p.id, p.name, p.status;

-- =============================================================================
-- FINE MIGRAZIONE
-- Verifica: le tabelle commessa_fasi, commessa_pratiche, pratica_eventi e
-- notifiche devono comparire in Table Editor con il lucchetto RLS attivo.
-- =============================================================================
