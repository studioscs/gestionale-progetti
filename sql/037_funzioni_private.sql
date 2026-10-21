-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 037
-- Le funzioni del database non si chiamano piu' da fuori
-- =============================================================================
-- Da eseguire dopo la 036, e poi la 018 per ultima come sempre.
-- Idempotente. Non tocca nessun dato.
--
-- IL PROBLEMA (avvisi del controllo di sicurezza di Supabase, 21/10/2026)
-- Tutte le funzioni dello schema public sono raggiungibili come
-- /rest/v1/rpc/<nome> da chiunque abbia fatto login, e molte girano con i
-- permessi del proprietario (security definer). Non ne usciva niente di
-- grave - le funzioni delle regole dicono a chi le chiama solo i suoi stessi
-- permessi - ma nessuna di queste e' fatta per essere chiamata da fuori:
--   - le funzioni delle REGOLE DI VISIBILITA' (is_admin, is_staff,
--     vede_tutte_commesse, commesse_visibili, vede_commessa, current_role_scs);
--   - le funzioni dei TRIGGER, che scattano da sole a ogni salvataggio, e
--     quelle che i trigger richiamano (ricalcoli di importi e date);
--   - assegna_progressivo, che l'app chiama davvero per numerare le fatture,
--     ma con i permessi del proprietario: chiunque poteva numerare qualunque
--     fattura di cui conoscesse l'identificativo.
-- Cinque funzioni, infine, non fissavano lo schema in cui cercano le tabelle
-- (search_path), cosa che il controllo segnala.
--
-- LA CORREZIONE
-- 1. Le funzioni delle regole passano nello schema "private", che l'API non
--    pubblica. Le regole che le usano continuano a funzionare (PostgreSQL le
--    collega per identita', non per nome); chi ha fatto login le esegue
--    ancora, perche' le regole girano con i suoi permessi.
-- 2. Funzioni dei trigger e ricalcoli: nessuno le esegue direttamente. I
--    trigger scattano comunque: il permesso di esecuzione si controlla quando
--    il trigger si crea, non quando scatta.
-- 3. assegna_progressivo gira con i permessi di chi la chiama: numera solo le
--    fatture che quella persona puo' gia' modificare.
-- 4. search_path fissato su tutte le funzioni dello schema public.
-- Tutte le migrazioni precedenti sono state allineate (private.is_admin() e
-- cosi' via), quindi rieseguirle - la 018 per prima - non riapre niente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. LO SCHEMA private E LE FUNZIONI DELLE REGOLE
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema private to service_role';
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['is_admin()','is_staff()','vede_tutte_commesse()','commesse_visibili()',
                           'vede_commessa(uuid)','current_role_scs()'] loop
    if to_regprocedure('public.' || f) is not null then
      if to_regprocedure('private.' || f) is not null then
        execute 'drop function private.' || f;   -- una copia creata da una 001/018 gia' aggiornata
      end if;
      execute 'alter function public.' || f || ' set schema private';
    end if;
  end loop;
end $$;

-- Le funzioni che ne richiamano altre per nome vanno riscritte con il nome nuovo
create or replace function private.commesse_visibili()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id
  from public.projects p
  where private.vede_tutte_commesse()
     or p.owner_id   = auth.uid()
     or p.created_by = auth.uid()
     or exists (select 1 from public.tasks t
                where t.project_id = p.id
                  and (t.assignee_id = auth.uid() or t.responsabile_id = auth.uid()))
     or exists (select 1 from public.commessa_fasi f
                where f.project_id = p.id and f.responsabile_id = auth.uid())
     or exists (select 1 from public.commessa_pratiche c
                where c.project_id = p.id and c.responsabile_id = auth.uid())
     or exists (select 1 from public.time_entries e
                where e.project_id = p.id and e.operator_id = auth.uid());
$$;

create or replace function private.vede_commessa(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p in (select private.commesse_visibili());
$$;

create or replace function public.blocca_autopromozione()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- L'amministratore puo' tutto: e' il suo mestiere.
  if private.is_admin() then
    return new;
  end if;

  -- Chiamate senza utente (service_role, migrazioni, lavori interni) non
  -- passano dall'RLS e non devono essere ostacolate qui.
  if auth.uid() is null then
    return new;
  end if;

  -- Chiunque altro: ruolo e stato restano quelli di prima, in silenzio.
  -- Sollevare un errore renderebbe impossibile persino cambiare il proprio
  -- nome dall'applicazione, che invia sempre l'intera riga.
  new.role   := old.role;
  new.attivo := old.attivo;
  return new;
end; $$;

do $$ begin
  if to_regprocedure('private.current_role_scs()') is not null then
    execute 'alter function private.current_role_scs() set search_path = public';
  end if;
end $$;

-- Eseguibili da chi ha fatto login (servono alle regole), da nessun altro
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'private'::regnamespace loop
    execute format('revoke all on function %s from public', r.f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', r.f);
    end if;
    execute format('grant execute on function %s to authenticated', r.f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', r.f);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. TRIGGER E RICALCOLI: nessuno li chiama direttamente
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as f from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and (p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
            or p.proname in ('allinea_fine_commessa','ricalcola_imponibile_fattura',
                             'ricalcola_importo_commessa','togli_politiche'))
  loop
    execute format('revoke all on function %s from public', r.f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', r.f);
    end if;
    execute format('revoke all on function %s from authenticated', r.f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', r.f);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 3. LA NUMERAZIONE DELLE FATTURE, con i permessi di chi la chiede
-- -----------------------------------------------------------------------------
create or replace function public.assegna_progressivo(fattura uuid)
returns integer language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  -- Gira con i permessi di chi la chiama (migrazione 037): numera solo una
  -- fattura che quella persona puo' gia' leggere e modificare. Prima girava con
  -- i permessi del proprietario e chiunque avesse fatto login poteva numerare
  -- qualunque fattura di cui conoscesse l'identificativo.
  select progressivo_invio into n from public.commessa_fatture where id = fattura;
  if not found then
    raise exception 'Fattura non trovata o non accessibile' using errcode = '42501';
  end if;
  if n is not null then
    return n;
  end if;

  n := nextval('public.seq_progressivo_invio');
  update public.commessa_fatture set progressivo_invio = n where id = fattura;
  if not found then
    raise exception 'Non hai i permessi per numerare questa fattura' using errcode = '42501';
  end if;
  return n;
end; $$;

revoke all on function public.assegna_progressivo(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.assegna_progressivo(uuid) from anon';
  end if;
end $$;
grant execute on function public.assegna_progressivo(uuid) to authenticated;
grant usage on sequence public.seq_progressivo_invio to authenticated;

-- -----------------------------------------------------------------------------
-- 4. search_path fissato su tutte le funzioni dello schema public
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as f from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public', r.f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'funzioni delle regole nello schema private' as cosa,
       (select count(*) from pg_proc where pronamespace = 'private'::regnamespace)::text || ' funzioni' as esito
union all
select 'funzioni security definer chiamabili da fuori',
       coalesce((select string_agg(p.proname, ', ') from pg_proc p
                  where p.pronamespace = 'public'::regnamespace and p.prosecdef
                    and has_function_privilege('authenticated', p.oid, 'execute')), 'nessuna: ok')
union all
select 'funzioni senza search_path',
       coalesce((select string_agg(p.proname, ', ') from pg_proc p
                  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
                    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')), 'nessuna: ok');

-- =============================================================================
-- FINE MIGRAZIONE 037 - ora riesegui la 018.
-- =============================================================================
