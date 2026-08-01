-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 014
-- Conversazione dentro ogni attivita'
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- DOVE VANNO SCRITTE LE COSE
-- Le informazioni che riguardano un lavoro nascono quasi sempre mentre lo si
-- sta facendo: un dubbio sulla quota, una misura da ricontrollare, la risposta
-- del committente. Se non hanno un posto ovvio finiscono in una mail o in un
-- messaggio sul telefono, e li' non le ritrova piu' nessuno.
--
-- Il posto ovvio e' l'attivita' stessa. Da qui la conversazione sta dentro ogni
-- attivita' da fare, accanto a cio' di cui parla, e la pagina Chat serve solo a
-- vedere tutto quello che si e' detto in giro: da li' si torna all'attivita'.
-- =============================================================================

create table if not exists public.task_messaggi (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete cascade,

  testo       text not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint testo_non_vuoto check (length(trim(testo)) > 0)
);

-- L'elenco si legge per attivita' in ordine di scrittura, e la pagina Chat
-- legge gli ultimi messaggi di tutti: servono entrambi gli indici.
create index if not exists idx_msg_task    on public.task_messaggi(task_id, created_at);
create index if not exists idx_msg_recenti on public.task_messaggi(created_at desc);

drop trigger if exists trg_touch_task_messaggi on public.task_messaggi;
create trigger trg_touch_task_messaggi before update on public.task_messaggi
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- project_id si compila da solo dall'attivita': serve alla pagina Chat per
-- mostrare la commessa senza una giunzione in piu' a ogni riga, e chiederlo a
-- chi scrive sarebbe un modo per sbagliarlo.
-- -----------------------------------------------------------------------------
create or replace function public.msg_eredita_commessa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is null then
    select project_id into new.project_id from public.tasks where id = new.task_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_msg_commessa on public.task_messaggi;
create trigger trg_msg_commessa before insert on public.task_messaggi
  for each row execute function public.msg_eredita_commessa();

-- -----------------------------------------------------------------------------
-- RLS: leggono tutti, scrive chi puo' lavorare, cancella l'autore o un admin.
-- Un messaggio altrui non si tocca: la conversazione e' una cronaca, non un
-- documento da riscrivere.
-- -----------------------------------------------------------------------------
alter table public.task_messaggi enable row level security;

drop policy if exists "read_all_msg"    on public.task_messaggi;
drop policy if exists "insert_staff_msg" on public.task_messaggi;
drop policy if exists "update_own_msg"  on public.task_messaggi;
drop policy if exists "delete_own_msg"  on public.task_messaggi;

create policy "read_all_msg"    on public.task_messaggi for select to authenticated using (true);
create policy "insert_staff_msg" on public.task_messaggi for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid());
create policy "update_own_msg"  on public.task_messaggi for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "delete_own_msg"  on public.task_messaggi for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- -----------------------------------------------------------------------------
-- NOTIFICA A CHI SEGUE L'ATTIVITA'
-- Assegnatario e verificatore, tranne chi ha scritto: avvisare se stessi e'
-- rumore e insegna a ignorare le notifiche.
-- -----------------------------------------------------------------------------
-- La notifica deve poter riportare all'attivita': la colonna non c'era.
alter table public.notifiche add column if not exists task_id uuid;

do $$
begin
  if not exists (select 1 from information_schema.table_constraints
                 where constraint_name = 'notifiche_task_id_fkey' and table_name = 'notifiche') then
    alter table public.notifiche
      add constraint notifiche_task_id_fkey
      foreign key (task_id) references public.tasks(id) on delete cascade;
  end if;
end $$;

create or replace function public.notifica_messaggio()
returns trigger language plpgsql security definer set search_path = public as $$
declare t record; d uuid;
begin
  select title, assignee_id, responsabile_id, project_id
    into t from public.tasks where id = new.task_id;
  if not found then return new; end if;

  foreach d in array array[t.assignee_id, t.responsabile_id] loop
    if d is not null and d <> new.created_by then
      insert into public.notifiche(user_id, tipo, titolo, corpo, project_id, task_id, created_by)
      values (d, 'messaggio',
              'Nuovo messaggio su: ' || coalesce(t.title, 'attivita'),
              left(new.testo, 200), t.project_id, new.task_id, new.created_by);
    end if;
  end loop;
  return new;
end; $$;

drop trigger if exists trg_notifica_messaggio on public.task_messaggi;
create trigger trg_notifica_messaggio after insert on public.task_messaggi
  for each row execute function public.notifica_messaggio();

-- -----------------------------------------------------------------------------
-- Conteggio per attivita': l'elenco mostra il numero senza leggere i testi.
-- security_invoker = true come le altre viste.
-- -----------------------------------------------------------------------------
create or replace view public.v_task_chat
with (security_invoker = true) as
select task_id,
       count(*)          as messaggi,
       max(created_at)   as ultimo_messaggio
from public.task_messaggi
group by task_id;

-- =============================================================================
-- FINE MIGRAZIONE 014
-- =============================================================================
