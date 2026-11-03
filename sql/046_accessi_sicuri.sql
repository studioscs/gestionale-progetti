-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 046
-- Registrazione e accessi: chi si iscrive da solo non ottiene niente
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente.
--
-- IL PROBLEMA (trovato controllando l'iscrizione del commercialista)
-- 1. Su Supabase la conferma dell'email e' spenta e l'iscrizione e' aperta:
--    chiunque, con la chiave pubblica che sta nella pagina, puo' crearsi un
--    account. Il trigger che ne crea il profilo (handle_new_user) lo faceva
--    «collaboratore», cioe' personale dello studio con permessi di scrittura;
--    la colonna «approved = false» non la controllava nessuna regola.
-- 2. Il blocco dell'autopromozione (015) proteggeva ruolo e stato, ma non
--    «vede_tutto»: chiunque poteva scriversi vede_tutto = true sul proprio
--    profilo e leggere tutte le commesse, i clienti, le fatture. Ne' valeva
--    quando il profilo lo si crea, invece di modificarlo.
-- 3. «Disattivato» era solo un avviso nell'applicazione: nel database chi era
--    disattivato restava amministratore, collaboratore o commercialista.
-- 4. Chiunque collegato leggeva nomi ed email di tutto lo studio.
-- In produzione nessuno ne ha approfittato: tutti gli account sono dello
-- studio, piu' il commercialista.
--
-- LA CORREZIONE
-- 1. Chi si iscrive nasce «viewer» non abilitato: non vede nessuna commessa
--    finche' un amministratore non lo abilita (Gestione utenti).
-- 2. Ruolo, stato, «vede tutto» e approvazione li cambia solo un
--    amministratore, sia modificando sia creando un profilo.
-- 3. Le regole d'accesso valgono solo per gli utenti attivi; e disattivare un
--    utente lo sospende anche nell'accesso (auth.users.banned_until): non
--    entra piu', e la sessione aperta scade entro un'ora. Riattivarlo lo
--    sblocca.
-- 4. L'elenco degli utenti lo vede il personale dello studio e chi vede
--    tutte le commesse; gli altri vedono solo se stessi.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Il profilo di chi si iscrive: viewer, senza niente
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
          new.email, 'viewer')
  on conflict (id) do update set email = excluded.email;
  return new;
end; $$;

-- -----------------------------------------------------------------------------
-- 2. Niente autopromozione, ne' modificando ne' creando il profilo
-- -----------------------------------------------------------------------------
create or replace function public.blocca_autopromozione()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- L'amministratore puo' tutto: e' il suo mestiere.
  if private.is_admin() then
    return new;
  end if;
  -- Chiamate senza utente (service_role, migrazioni, il trigger di
  -- iscrizione) non passano dall'RLS e non devono essere ostacolate qui.
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- chi crea il proprio profilo lo crea senza poteri
    new.role       := 'viewer';
    new.vede_tutto := false;
    new.attivo     := true;
  else
    -- chiunque altro: ruolo, stato e «vede tutto» restano quelli di prima,
    -- in silenzio (l'applicazione invia sempre l'intera riga)
    new.role       := old.role;
    new.attivo     := old.attivo;
    new.vede_tutto := old.vede_tutto;
  end if;
  return new;
end; $$;

drop trigger if exists trg_blocca_autopromozione on public.profiles;
create trigger trg_blocca_autopromozione
  before insert or update on public.profiles
  for each row execute function public.blocca_autopromozione();

-- L'approvazione, se la colonna c'e' (gestionale di prima): la protegge un
-- trigger a parte, cosi' il codice qui sopra vale anche dove non esiste.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'approved') then
    execute $f$
      create or replace function private.blocca_approvazione()
      returns trigger language plpgsql security definer set search_path = public as $b$
      begin
        if private.is_admin() or auth.uid() is null then return new; end if;
        if tg_op = 'INSERT' then new.approved := false; else new.approved := old.approved; end if;
        return new;
      end; $b$;
    $f$;
    execute 'revoke all on function private.blocca_approvazione() from public, anon, authenticated';
    execute 'drop trigger if exists trg_blocca_approvazione on public.profiles';
    execute 'create trigger trg_blocca_approvazione before insert or update on public.profiles
             for each row execute function private.blocca_approvazione()';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Le regole d'accesso valgono per gli utenti attivi
-- -----------------------------------------------------------------------------
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin' and coalesce(p.attivo, true));
$$;

create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role in ('admin', 'collaboratore') and coalesce(p.attivo, true));
$$;

create or replace function private.vede_tutte_commesse()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and (p.role = 'admin' or p.vede_tutto) and coalesce(p.attivo, true));
$$;

create or replace function private.utente_attivo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and coalesce(p.attivo, true));
$$;

create or replace function private.commesse_visibili()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id
  from public.projects p
  where private.utente_attivo()
    and (private.vede_tutte_commesse()
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
                where e.project_id = p.id and e.operator_id = auth.uid()));
$$;

revoke all on function private.utente_attivo() from public, anon;
grant execute on function private.utente_attivo() to authenticated;
grant execute on function private.is_admin(), private.is_staff(), private.vede_tutte_commesse(),
                          private.commesse_visibili() to authenticated;

-- Disattivato = sospeso anche nell'accesso. Solo dove auth.users ha la
-- colonna della sospensione (Supabase); nel database di prova locale si salta.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until') then
    execute $f$
      create or replace function private.sospendi_disattivati()
      returns trigger language plpgsql security definer set search_path = public, auth as $b$
      begin
        if new.attivo is distinct from old.attivo then
          update auth.users
             set banned_until = case when coalesce(new.attivo, true) then null else 'infinity'::timestamptz end
           where id = new.id;
        end if;
        return new;
      end; $b$;
    $f$;
    execute 'revoke all on function private.sospendi_disattivati() from public, anon, authenticated';
    execute 'drop trigger if exists trg_sospendi_disattivati on public.profiles';
    execute 'create trigger trg_sospendi_disattivati after update of attivo on public.profiles
             for each row execute function private.sospendi_disattivati()';
    -- chi e' gia' disattivato oggi
    execute 'update auth.users u set banned_until = ''infinity''
               from public.profiles p where p.id = u.id and p.attivo = false and u.banned_until is null';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. L'elenco degli utenti: lo studio lo vede tutto, gli altri solo se stessi
-- -----------------------------------------------------------------------------
drop policy if exists "read_all_profiles" on public.profiles;
drop policy if exists "rls_read_profiles" on public.profiles;
create policy "rls_read_profiles" on public.profiles
  for select to authenticated
  using (id = auth.uid() or private.is_staff() or private.vede_tutte_commesse());

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'nuovi iscritti come viewer' as cosa,
       case when pg_get_functiondef('public.handle_new_user'::regproc) ~ '''viewer''' then 'ok' else 'NO' end as esito
union all
select 'vede_tutto protetto',
       case when pg_get_functiondef('public.blocca_autopromozione'::regproc) ~ 'vede_tutto' then 'ok' else 'NO' end
union all
select 'regole solo per utenti attivi',
       case when pg_get_functiondef('private.is_staff'::regproc) ~ 'attivo' then 'ok' else 'NO' end
union all
select 'politiche di lettura su profiles',
       (select count(*) from pg_policies where tablename = 'profiles' and cmd = 'SELECT')::text;

-- =============================================================================
-- FINE MIGRAZIONE 046 - ora riesegui la 018.
-- =============================================================================
