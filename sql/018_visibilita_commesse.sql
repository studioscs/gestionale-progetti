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
-- 3. LE POLITICHE
--
-- PERCHE' SI CANCELLA TUTTO INVECE DI CANCELLARE PER NOME
-- Le politiche RLS dello stesso comando si SOMMANO: basta che ne resti una che
-- dice "using (true)" perche' tutte le altre non contino piu' niente. Le
-- migrazioni precedenti quelle politiche le creano, e rieseguirne una dopo
-- questa - cosa che capita, per esempio ricontrollando l'ordine - farebbe
-- tornare la lettura aperta a tutti senza che nulla lo segnali.
--
-- Per questo non si cancella un elenco di nomi noti: si cancellano TUTTE le
-- politiche del comando che questo file governa, qualunque nome abbiano, e poi
-- si creano le proprie. Cosi' rieseguire questo file rimette le cose a posto
-- comunque sia ridotto il database.
-- -----------------------------------------------------------------------------
create or replace function public.togli_politiche(tab text, comando "char")
returns void language plpgsql as $$
declare r record;
begin
  for r in
    select p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = tab and p.polcmd = comando
  loop
    execute format('drop policy if exists %I on public.%I', r.polname, tab);
  end loop;
end; $$;

-- Prima di toccare niente si guarda com'e' ridotto il database: se questo file
-- e' gia' stato eseguito e poi ne e' stato rieseguito uno precedente, qui si
-- vede - ed e' l'unico momento in cui si puo' vedere, perche' subito dopo viene
-- rimesso a posto.
do $$
declare r record; sporche integer := 0;
begin
  for r in
    select c.relname as tab, count(*) as n
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and p.polcmd = 'r'
      and c.relname in ('projects','tasks','commessa_fasi','commessa_pratiche',
                        'commessa_fatture','commessa_sal','commessa_varianti',
                        'time_entries','files','pratica_eventi','task_messaggi',
                        'clienti','commessa_contratti')
    group by 1 having count(*) > 1
  loop
    raise warning 'Trovate % politiche di lettura su %: la visibilita'' non era attiva. La rimetto a posto.', r.n, r.tab;
    sporche := sporche + 1;
  end loop;
  if sporche > 0 then
    raise warning 'Succede rieseguendo una migrazione precedente a questa: le sue politiche aperte tornano e vincono sulle nostre. Riesegui SEMPRE questo file per ultimo.';
  end if;
end $$;

-- --- LA COMMESSA ---------------------------------------------------------
-- Lettura, modifica e cancellazione le governa questo file; l'inserimento
-- resta com'era: chiunque sia staff puo' creare una commessa, e la vede perche'
-- created_by e' fra gli agganci.
select public.togli_politiche('projects', 'r');
create policy "vis_read_projects" on public.projects for select to authenticated
  using (id in (select public.commesse_visibili()));

select public.togli_politiche('projects', 'w');
create policy "vis_update_projects" on public.projects for update to authenticated
  using (public.is_staff() and id in (select public.commesse_visibili()))
  with check (public.is_staff());

select public.togli_politiche('projects', 'd');
create policy "vis_delete_projects" on public.projects for delete to authenticated
  using (public.is_admin());

-- --- TUTTO QUELLO CHE STA APPESO ALLA COMMESSA ---------------------------
do $$
declare t text;
begin
  -- commessa_contratti nasce con la migrazione 021: se questo file gira prima,
  -- la tabella non c'e' ancora e viene saltata; rieseguendolo dopo, rientra.
  foreach t in array array['tasks','commessa_fasi','commessa_pratiche','commessa_fatture',
                           'commessa_sal','commessa_varianti','time_entries','files',
                           'commessa_contratti'] loop
    if not exists (select 1 from pg_tables where schemaname='public' and tablename=t) then
      raise notice 'Tabella % assente, la salto.', t;
      continue;
    end if;

    perform public.togli_politiche(t, 'r');
    execute format('create policy "vis_read_%1$s" on public.%1$I for select to authenticated
                    using (project_id in (select public.commesse_visibili()))', t);

    perform public.togli_politiche(t, 'a');
    execute format('create policy "vis_insert_%1$s" on public.%1$I for insert to authenticated
                    with check (public.is_staff()
                                and project_id in (select public.commesse_visibili()))', t);

    perform public.togli_politiche(t, 'w');
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
-- project_id: ci si arriva dal padre. Qui si governa la sola lettura, quindi si
-- tolgono le politiche di lettura e si lascia intatto il resto - chi puo'
-- scrivere un messaggio e chi puo' cancellarlo lo decidono altri file.
-- -----------------------------------------------------------------------------
select public.togli_politiche('pratica_eventi', 'r');
create policy "vis_read_pratica_eventi" on public.pratica_eventi for select to authenticated
  using (exists (select 1 from public.commessa_pratiche c
                 where c.id = pratica_eventi.pratica_id
                   and c.project_id in (select public.commesse_visibili())));

select public.togli_politiche('task_messaggi', 'r');
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
select public.togli_politiche('clienti', 'r');
create policy "vis_read_clienti" on public.clienti for select to authenticated
  using (public.vede_tutte_commesse()
         or created_by = auth.uid()
         or exists (select 1 from public.projects p
                    where p.cliente_id = clienti.id
                      and p.id in (select public.commesse_visibili())));

-- -----------------------------------------------------------------------------
-- 6. LE TABELLE DEL VECCHIO GESTIONALE
-- project_fasi e project_sottofasi sono rimaste dalla versione precedente:
-- l'applicazione non le legge piu', ma stanno li' con la lettura aperta a
-- chiunque, e dentro ci sono note e responsabili delle vecchie commesse.
-- Non si prova a legarle alla visibilita' per commessa - non vale la pena su
-- dati morti - ma almeno si chiudono a chi non lavora in studio.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['project_fasi','project_sottofasi'] loop
    if not exists (select 1 from pg_tables where schemaname='public' and tablename=t) then
      continue;
    end if;
    perform public.togli_politiche(t, 'r');
    execute format('create policy "vis_read_%1$s" on public.%1$I for select to authenticated
                    using (public.is_staff())', t);
    raise notice 'Lettura di % riservata allo staff (tabella del vecchio gestionale).', t;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 7. CONTROLLO FINALE
-- Se su una tabella protetta restasse piu' di una politica di lettura, la piu'
-- permissiva vincerebbe e tutto questo file non servirebbe a niente. Meglio
-- accorgersene qui che scoprirlo fra sei mesi.
-- -----------------------------------------------------------------------------
do $$
declare r record; guasti integer := 0;
begin
  for r in
    select c.relname as tab, count(*) as n
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and p.polcmd = 'r'
      and c.relname in ('projects','tasks','commessa_fasi','commessa_pratiche',
                        'commessa_fatture','commessa_sal','commessa_varianti',
                        'time_entries','files','pratica_eventi','task_messaggi',
                        'clienti','commessa_contratti')
    group by 1 having count(*) > 1
  loop
    raise warning 'ATTENZIONE: % ha % politiche di lettura. La piu'' permissiva vince: la visibilita'' NON e'' attiva su questa tabella.', r.tab, r.n;
    guasti := guasti + 1;
  end loop;

  if guasti = 0 then
    raise notice 'Visibilita'' per commessa: una sola politica di lettura per tabella, come deve essere.';
  else
    raise warning 'Riesegui questo file DOPO qualunque altra migrazione, e ricontrolla.';
  end if;
end $$;

-- =============================================================================
-- FINE MIGRAZIONE 018
--
-- Questo file si puo' rieseguire quante volte si vuole: rimette a posto le
-- politiche qualunque sia lo stato di partenza. Se hai rieseguito una
-- migrazione precedente, riesegui anche questa.
--
-- VERIFICA (da eseguire come collaboratore, dopo aver impostato l'utente):
--   select count(*) from projects;            -- solo le sue
--   select public.vede_commessa('<id di una commessa altrui>');   -- false
--   select count(*) from tasks;               -- solo quelle delle sue commesse
--
-- Per l'amministrazione, che deve fatturare tutto:
--   update public.profiles set vede_tutto = true where email = 'amministrazione@...';
-- =============================================================================
