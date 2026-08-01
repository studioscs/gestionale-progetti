-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 006
-- VERIFICA E MESSA IN SICUREZZA (RLS sulle tabelle preesistenti)
-- =============================================================================
-- PERCHE' SERVE
-- L'app e' una pagina statica pubblicata su GitHub Pages da un repository
-- pubblico: la chiave anon di Supabase e' leggibile da chiunque. E' cosi' per
-- progetto - quella chiave nasce per stare nel browser - ma proprio per questo
-- l'unica difesa dei dati sono le policy RLS.
--
-- Le migrazioni 001, 002 e 005 hanno impostato RLS sulle tabelle nuove. Le
-- tabelle preesistenti (projects, tasks, time_entries, files, profiles e le
-- legacy) non erano sotto il mio controllo: questo script le verifica e le
-- mette in sicurezza.
--
-- ATTENZIONE: attivare RLS senza policy blocca tutto. Qui le due cose vengono
-- fatte insieme, quindi l'app continua a funzionare esattamente come prima per
-- gli utenti autenticati, mentre l'accesso anonimo viene chiuso.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- PASSO 1 - DIAGNOSI (eseguibile da sola, non modifica nulla)
-- Lancia solo questa query se prima vuoi vedere la situazione.
-- Ogni riga con rls_attiva = false e' una tabella esposta.
-- -----------------------------------------------------------------------------
select
  c.relname                                   as tabella,
  c.relrowsecurity                            as rls_attiva,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as numero_policy
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relrowsecurity, c.relname;


-- -----------------------------------------------------------------------------
-- PASSO 2 - MESSA IN SICUREZZA
-- Idempotente: puoi rilanciarlo. Tocca solo le tabelle che esistono davvero.
-- -----------------------------------------------------------------------------

-- --- Tabelle di lavoro: lettura a tutto lo studio, scrittura a staff,
--     cancellazione ad admin. Stesso modello gia' usato dalle tabelle nuove.
do $$
declare t text;
begin
  foreach t in array array['projects','tasks','time_entries','files',
                           'project_fasi','project_sottofasi'] loop
    if not exists (select 1 from pg_tables where schemaname='public' and tablename=t) then
      raise notice 'Tabella % assente, la salto.', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "rls_read_%1$s"   on public.%1$I', t);
    execute format('drop policy if exists "rls_insert_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "rls_update_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "rls_delete_%1$s" on public.%1$I', t);

    execute format('create policy "rls_read_%1$s"   on public.%1$I for select to authenticated using (true)', t);
    execute format('create policy "rls_insert_%1$s" on public.%1$I for insert to authenticated with check (public.is_staff())', t);
    execute format('create policy "rls_update_%1$s" on public.%1$I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t);
    execute format('create policy "rls_delete_%1$s" on public.%1$I for delete to authenticated using (public.is_admin())', t);

    raise notice 'RLS attivata su %', t;
  end loop;
end $$;

-- --- PROFILES: caso a parte.
--     Tutti leggono l'elenco dello studio (serve per assegnare le attivita').
--     Ognuno modifica il proprio profilo; gli admin modificano chiunque.
--     L'inserimento del proprio profilo serve al primo accesso.
alter table public.profiles enable row level security;

drop policy if exists "rls_read_profiles"   on public.profiles;
drop policy if exists "rls_insert_profiles" on public.profiles;
drop policy if exists "rls_update_profiles" on public.profiles;
drop policy if exists "rls_delete_profiles" on public.profiles;

create policy "rls_read_profiles"   on public.profiles
  for select to authenticated using (true);
create policy "rls_insert_profiles" on public.profiles
  for insert to authenticated with check (id = auth.uid() or public.is_admin());
create policy "rls_update_profiles" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
create policy "rls_delete_profiles" on public.profiles
  for delete to authenticated using (public.is_admin());


-- -----------------------------------------------------------------------------
-- PASSO 3 - STORAGE
-- I file delle commesse stanno nel bucket "commesse". Se il bucket e' pubblico
-- ogni allegato e' scaricabile da chiunque conosca l'URL, RLS o no.
-- -----------------------------------------------------------------------------

-- Rende privato il bucket e limita l'accesso ai file. Tutto dentro un blocco
-- protetto: su un database senza lo schema storage lo script deve proseguire
-- fino alla controverifica finale invece di fermarsi qui.
do $$
begin
  if not exists (select 1 from pg_tables where schemaname='storage' and tablename='buckets') then
    raise notice 'Schema storage assente: salto la parte sui file.';
    return;
  end if;

  update storage.buckets set public = false where id = 'commesse';

  if exists (select 1 from pg_tables where schemaname='storage' and tablename='objects') then
    drop policy if exists "commesse_read"   on storage.objects;
    drop policy if exists "commesse_write"  on storage.objects;
    drop policy if exists "commesse_delete" on storage.objects;

    create policy "commesse_read" on storage.objects
      for select to authenticated using (bucket_id = 'commesse');
    create policy "commesse_write" on storage.objects
      for insert to authenticated with check (bucket_id = 'commesse' and public.is_staff());
    create policy "commesse_delete" on storage.objects
      for delete to authenticated using (bucket_id = 'commesse' and public.is_admin());

    raise notice 'Policy dello storage aggiornate.';
  end if;
exception when insufficient_privilege then
  raise notice 'Storage non modificabile da qui: imposta le policy da Supabase - Storage - Policies.';
end $$;


-- -----------------------------------------------------------------------------
-- PASSO 4 - CONTROFERIFICA
-- Dopo l'esecuzione, qui non deve comparire nessuna riga.
-- -----------------------------------------------------------------------------
select c.relname as tabella_ancora_esposta
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false;

-- =============================================================================
-- FINE MIGRAZIONE 006
--
-- Dopo averlo eseguito, prova ad accedere all'app come al solito: se qualcosa
-- smette di funzionare significa che una policy e' troppo stretta per il tuo
-- schema. In quel caso il messaggio sara' "Permessi insufficienti per questa
-- operazione" e si aggiusta la singola policy, senza disattivare RLS.
-- =============================================================================
