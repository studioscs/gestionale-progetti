-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 033
-- Il catalogo delle pratiche, e le attivita' che avviano o concludono una pratica
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente e solo additivo: non cancella nessuna pratica esistente.
--
-- IL PROBLEMA
-- Creando una commessa il gestionale creava da solo tutte le pratiche che il
-- tipo di lavoro poteva richiedere, anche sedici, ognuna con la sua procura.
-- La pagina "Pratiche & Enti" si riempiva di voci che nessuno aveva deciso e
-- che spesso non servivano: le pratiche vere si perdevano in mezzo.
--
-- LA CORREZIONE
-- 1. Un CATALOGO delle pratiche, che lo studio puo' correggere e arricchire:
--    ente, tipo, riferimento normativo, termini, se serve la procura. Le voci
--    scritte nel gestionale restano la base; qui stanno quelle modificate o
--    aggiunte dallo studio.
-- 2. Le pratiche non nascono piu' da sole: dopo aver creato la commessa il
--    gestionale PROPONE quelle adatte e si sceglie quali aprire (cosa che fa
--    l'applicazione, non questo file).
-- 3. Un'attivita' puo' essere collegata a una pratica come quella che la
--    AVVIA (la presentazione) o quella che la CONCLUDE (il rilascio, la
--    chiusura). Chiusa l'attivita', la pratica si aggiorna da sola.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CATALOGO DELLE PRATICHE
-- -----------------------------------------------------------------------------
create table if not exists public.pratiche_catalogo (
  id          uuid primary key default gen_random_uuid(),
  chiave      text not null unique,          -- la stessa chiave del catalogo di base
  ente        text,
  tipo        text not null,
  rif         text,                          -- riferimento normativo
  giorni      integer check (giorni is null or giorni >= 0),
  ordine      integer not null default 50,   -- posizione nella sequenza di lavoro
  procura     boolean not null default false,-- pratica telematica: serve la procura speciale
  condizione  text,                          -- condizione della commessa che la rende proponibile
  note        text,
  attivo      boolean not null default true, -- false: non viene piu' proposta
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_touch_pratiche_catalogo on public.pratiche_catalogo;
create trigger trg_touch_pratiche_catalogo before update on public.pratiche_catalogo
  for each row execute function public.touch_updated_at();

-- Il catalogo lo leggono tutti quelli che lavorano (serve per aprire una
-- pratica); lo modifica chi tiene l'amministrazione.
alter table public.pratiche_catalogo enable row level security;
drop policy if exists "staff_read_pratiche_catalogo" on public.pratiche_catalogo;
drop policy if exists "amm_insert_pratiche_catalogo" on public.pratiche_catalogo;
drop policy if exists "amm_update_pratiche_catalogo" on public.pratiche_catalogo;
drop policy if exists "amm_delete_pratiche_catalogo" on public.pratiche_catalogo;
create policy "staff_read_pratiche_catalogo" on public.pratiche_catalogo
  for select to authenticated using (private.is_staff());
create policy "amm_insert_pratiche_catalogo" on public.pratiche_catalogo
  for insert to authenticated with check (private.vede_tutte_commesse());
create policy "amm_update_pratiche_catalogo" on public.pratiche_catalogo
  for update to authenticated using (private.vede_tutte_commesse())
  with check (private.vede_tutte_commesse());
create policy "amm_delete_pratiche_catalogo" on public.pratiche_catalogo
  for delete to authenticated using (private.vede_tutte_commesse());

-- -----------------------------------------------------------------------------
-- 2. L'ATTIVITA' CHE AVVIA O CONCLUDE UNA PRATICA
-- -----------------------------------------------------------------------------
alter table public.tasks add column if not exists pratica_id uuid;
alter table public.tasks add column if not exists pratica_ruolo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_tasks_pratica') then
    alter table public.tasks add constraint fk_tasks_pratica
      foreign key (pratica_id) references public.commessa_pratiche(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_tasks_pratica_ruolo') then
    alter table public.tasks add constraint ck_tasks_pratica_ruolo
      check (pratica_ruolo is null or pratica_ruolo in ('inizio','fine'));
  end if;
end $$;

create index if not exists idx_tasks_pratica on public.tasks(pratica_id) where pratica_id is not null;

comment on column public.tasks.pratica_id is
  'Pratica di cui questa attivita'' e'' il passo iniziale o conclusivo.';
comment on column public.tasks.pratica_ruolo is
  'inizio: completandola la pratica risulta inviata. fine: completandola la pratica risulta conclusa (rilasciata).';

-- Chiusa l'attivita', la pratica segue:
--   inizio -> da preparare / in preparazione diventa INVIATA, con la data di
--             invio di oggi e la scadenza calcolata dai giorni di legge;
--   fine   -> una pratica ancora aperta diventa RILASCIATA, con la data di esito.
-- Si scrive anche nel diario della pratica, perche' si sappia da dove viene il
-- cambiamento. Non si torna indietro riaprendo l'attivita': lo stato di una
-- pratica e' un fatto verso l'ente, e lo si corregge a mano se serve.
create or replace function public.pratica_da_attivita()
returns trigger language plpgsql security definer set search_path = public as $$
declare pr public.commessa_pratiche%rowtype;
begin
  if new.pratica_id is null or new.status <> 'completato'
     or (tg_op = 'UPDATE' and old.status = 'completato') then
    return new;
  end if;
  select * into pr from public.commessa_pratiche where id = new.pratica_id;
  if not found then return new; end if;

  if new.pratica_ruolo = 'inizio' and pr.stato in ('da_preparare','in_preparazione') then
    update public.commessa_pratiche
       set stato = 'inviata',
           data_invio = coalesce(data_invio, current_date),
           data_scadenza = coalesce(data_scadenza,
             case when coalesce(termine_giorni, 0) > 0
                  then coalesce(data_invio, current_date) + termine_giorni end)
     where id = pr.id;
    insert into public.pratica_eventi (pratica_id, tipo, descrizione, created_by)
    values (pr.id, 'invio', 'Avviata con l''attività «' || new.title || '»', auth.uid());
  elsif new.pratica_ruolo = 'fine' and pr.stato not in ('rilasciata','respinta','non_necessaria') then
    update public.commessa_pratiche
       set stato = 'rilasciata', data_esito = coalesce(data_esito, current_date)
     where id = pr.id;
    insert into public.pratica_eventi (pratica_id, tipo, descrizione, created_by)
    values (pr.id, 'rilascio', 'Conclusa con l''attività «' || new.title || '»', auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_pratica_da_attivita on public.tasks;
create trigger trg_pratica_da_attivita after insert or update of status on public.tasks
  for each row execute function public.pratica_da_attivita();

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'tabella pratiche_catalogo' as cosa,
       case when c.oid is null then 'MANCANTE'
            when not c.relrowsecurity then 'RLS SPENTA'
            else 'ok, ' || (select count(*) from pg_policy p where p.polrelid = c.oid) || ' regole' end as esito
  from (select 1) x
  left join pg_class c on c.relname = 'pratiche_catalogo' and c.relnamespace = 'public'::regnamespace
union all
select 'tasks.pratica_id e pratica_ruolo',
       case when count(*) = 2 then 'ok' else 'MANCANO COLONNE' end
  from information_schema.columns
 where table_schema = 'public' and table_name = 'tasks' and column_name in ('pratica_id','pratica_ruolo')
union all
select 'automatismo attività -> pratica',
       case when exists (select 1 from pg_trigger where tgname = 'trg_pratica_da_attivita') then 'ok' else 'MANCANTE' end;

-- =============================================================================
-- FINE MIGRAZIONE 033 - ora riesegui la 018.
-- =============================================================================
