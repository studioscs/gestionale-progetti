-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 018
-- Ognuno vede le commesse su cui lavora, non tutte
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Tutte le tabelle di lavoro nascevano con la stessa politica di lettura:
--
--   create policy "read_all_<tabella>" ... for select to authenticated using (true)
--
-- Chiunque avesse un accesso allo studio vedeva quindi OGNI commessa: importi,
-- dati fiscali dei committenti, fatture, stati di avanzamento, conversazioni.
-- Non e' un problema di interfaccia che si risolve nascondendo una voce di
-- menu: la chiave anon sta dentro index.html, che e' pubblico, e con quella si
-- interroga l'API direttamente. Finche' la politica dice "true", i dati escono.
--
-- LA REGOLA
-- Si vede una commessa quando ci si lavora. Basta un solo aggancio - una
-- attivita' assegnata, la verifica di una attivita', la responsabilita' di una
-- fase o di una pratica, ore registrate, esserne responsabile o averla creata -
-- e da quel momento la si vede INTERA: chi lavora a una fase deve poter capire
-- dove sta, e nascondergli il resto della commessa non protegge nessuno.
--
-- Gli amministratori vedono tutto: e' il loro mestiere.
--
-- E CHI IN STUDIO DEVE VEDERE TUTTO SENZA ESSERE AMMINISTRATORE?
-- Esiste: chi tiene l'amministrazione emette le fatture di commesse su cui non
-- ha mai lavorato. Per questo c'e' il contrassegno "vede tutte le commesse" sul
-- profilo, che un amministratore accende da Utenti. E' un'eccezione dichiarata,
-- non il comportamento di partenza.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. IL CONTRASSEGNO PER CHI DEVE VEDERE TUTTO
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists vede_tutto boolean not null default false;

comment on column public.profiles.vede_tutto is
  'Vede tutte le commesse anche senza lavorarci. Per chi tiene l''amministrazione. Lo imposta un amministratore.';

create or replace function public.vede_tutte_commesse()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role = 'admin' or p.vede_tutto)
  );
$$;

-- -----------------------------------------------------------------------------
-- 2. QUALI COMMESSE VEDE CHI STA CHIEDENDO
--
-- Restituisce un INSIEME di id, non un booleano per riga. E' una differenza che
-- si sente: una funzione senza argomenti e stable viene valutata UNA VOLTA per
-- interrogazione e non una volta per riga, quindi filtrare tremila attivita'
-- costa quanto filtrarne dieci.
--
-- E' security definer perche' deve poter leggere projects, tasks e fasi
-- ignorando le politiche che stiamo definendo qui sopra: senza, la politica su
-- projects interrogherebbe tasks, la cui politica interroga projects, e si
-- girerebbe in tondo.
-- -----------------------------------------------------------------------------
create or replace function public.commesse_visibili()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id
  from public.projects p
  where public.vede_tutte_commesse()
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

-- Comoda per le verifiche a mano e per un singolo controllo mirato
create or replace function public.vede_commessa(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p in (select public.commesse_visibili());
$$;

revoke all on function public.commesse_visibili()   from public;
revoke all on function public.vede_commessa(uuid)   from public;
revoke all on function public.vede_tutte_commesse() from public;
grant execute on function public.commesse_visibili()   to authenticated;
grant execute on function public.vede_commessa(uuid)   to authenticated;
grant execute on function public.vede_tutte_commesse() to authenticated;

-- Indici a servizio della funzione: senza, ogni aggancio e' una scansione
create index if not exists idx_tasks_assignee    on public.tasks(assignee_id)      where assignee_id is not null;
create index if not exists idx_tasks_resp        on public.tasks(responsabile_id)  where responsabile_id is not null;
create index if not exists idx_fasi_resp         on public.commessa_fasi(responsabile_id) where responsabile_id is not null;
create index if not exists idx_prat_resp         on public.commessa_pratiche(responsabile_id) where responsabile_id is not null;
create index if not exists idx_time_operatore    on public.time_entries(operator_id);
create index if not exists idx_projects_owner    on public.projects(owner_id)      where owner_id is not null;
create index if not exists idx_projects_creatore on public.projects(created_by)    where created_by is not null;

-- -----------------------------------------------------------------------------
-- 3. LE POLITICHE DI LETTURA
--
-- La commessa stessa e tutto cio' che le sta appeso tramite project_id.
-- La scrittura segue la lettura: non si modifica cio' che non si vede. Un
-- collaboratore che indovinasse un id non combinerebbe comunque niente.
-- -----------------------------------------------------------------------------
drop policy if exists "rls_read_projects" on public.projects;
drop policy if exists "read_all_projects" on public.projects;
create policy "vis_read_projects" on public.projects for select to authenticated
  using (id in (select public.commesse_visibili()));

drop policy if exists "rls_update_projects" on public.projects;
create policy "vis_update_projects" on public.projects for update to authenticated
  using (public.is_staff() and id in (select public.commesse_visibili()))
  with check (public.is_staff());

drop policy if exists "rls_delete_projects" on public.projects;
create policy "vis_delete_projects" on public.projects for delete to authenticated
  using (public.is_admin());

-- Creare una commessa resta di chiunque sia staff: chi la crea la vede, perche'
-- created_by e' fra gli agganci.
-- (la politica di insert di 006 resta buona cosi' com'e')

do $$
declare t text;
begin
  foreach t in array array['tasks','commessa_fasi','commessa_pratiche','commessa_fatture',
                           'commessa_sal','commessa_varianti','time_entries','files'] loop
    if not exists (select 1 from pg_tables where schemaname='public' and tablename=t) then
      raise notice 'Tabella % assente, la salto.', t;
      continue;
    end if;

    -- via le vecchie politiche di lettura, comunque si chiamassero
    execute format('drop policy if exists "rls_read_%1$s"  on public.%1$I', t);
    execute format('drop policy if exists "read_all_%1$s"  on public.%1$I', t);
    execute format('drop policy if exists "vis_read_%1$s"  on public.%1$I', t);
    execute format('create policy "vis_read_%1$s" on public.%1$I for select to authenticated
                    using (project_id in (select public.commesse_visibili()))', t);

    execute format('drop policy if exists "rls_insert_%1$s"   on public.%1$I', t);
    execute format('drop policy if exists "insert_staff_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "vis_insert_%1$s"   on public.%1$I', t);
    execute format('create policy "vis_insert_%1$s" on public.%1$I for insert to authenticated
                    with check (public.is_staff()
                                and project_id in (select public.commesse_visibili()))', t);

    execute format('drop policy if exists "rls_update_%1$s"   on public.%1$I', t);
    execute format('drop policy if exists "update_staff_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "vis_update_%1$s"   on public.%1$I', t);
    execute format('create policy "vis_update_%1$s" on public.%1$I for update to authenticated
                    using (public.is_staff()
                           and project_id in (select public.commesse_visibili()))
                    with check (public.is_staff())', t);

    raise notice 'Visibilita'' per commessa attivata su %', t;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. QUELLO CHE STA APPESO PER VIE TRAVERSE
-- Gli eventi di una pratica e i messaggi di un'attivita' non portano
-- project_id: ci si arriva dal padre.
-- -----------------------------------------------------------------------------
drop policy if exists "rls_read_pratica_eventi" on public.pratica_eventi;
drop policy if exists "read_all_pratica_eventi" on public.pratica_eventi;
create policy "vis_read_pratica_eventi" on public.pratica_eventi for select to authenticated
  using (exists (select 1 from public.commessa_pratiche c
                 where c.id = pratica_eventi.pratica_id
                   and c.project_id in (select public.commesse_visibili())));

drop policy if exists "read_all_msg" on public.task_messaggi;
create policy "vis_read_msg" on public.task_messaggi for select to authenticated
  using (exists (select 1 from public.tasks t
                 where t.id = task_messaggi.task_id
                   and t.project_id in (select public.commesse_visibili())));

-- -----------------------------------------------------------------------------
-- 5. L'ANAGRAFICA DEI CLIENTI
-- Lasciarla aperta renderebbe inutile tutto il resto: dall'anagrafica si legge
-- chi sono i committenti dello studio e i loro dati fiscali. Si vede un cliente
-- se si vede almeno una delle sue commesse, oppure se e' appena stato creato da
-- chi sta chiedendo - altrimenti il modulo "nuovo cliente" non potrebbe
-- rileggere cio' che ha appena scritto.
-- -----------------------------------------------------------------------------
drop policy if exists "read_all_clienti" on public.clienti;
create policy "vis_read_clienti" on public.clienti for select to authenticated
  using (public.vede_tutte_commesse()
         or created_by = auth.uid()
         or exists (select 1 from public.projects p
                    where p.cliente_id = clienti.id
                      and p.id in (select public.commesse_visibili())));

-- =============================================================================
-- FINE MIGRAZIONE 018
--
-- VERIFICA (da eseguire come collaboratore, dopo aver impostato l'utente):
--   select count(*) from projects;            -- solo le sue
--   select public.vede_commessa('<id di una commessa altrui>');   -- false
--   select count(*) from tasks;               -- solo quelle delle sue commesse
--
-- Per l'amministrazione, che deve fatturare tutto:
--   update public.profiles set vede_tutto = true where email = 'amministrazione@...';
-- =============================================================================
