-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 029
-- Una parcella non ha ore: lo zero va ammesso
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Registrando il costo di un collaboratore esterno il database rifiutava la
-- riga:
--
--   new row for relation "time_entries" violates check constraint
--   "time_entries_hours_check"
--
-- Quel vincolo nasce con la tabella, ai tempi in cui una registrazione di tempo
-- poteva essere solo ore di qualcuno dello studio, e pretende hours > 0. Dalla
-- migrazione 023 pero' una registrazione puo' essere anche la parcella di un
-- esterno: li' le ore sono ZERO per definizione - quello che pesa e' l'importo
-- della parcella - e il vincolo vecchio le blocca tutte.
--
-- PERCHE' NON SE N'ERA ACCORTO NESSUNO
-- Il vincolo sta nel database vero ma non nello schema di prova con cui girano
-- i test (sql/000_baseline_test.sql), quindi in laboratorio l'inserimento
-- passava e il guasto si vedeva solo in produzione. Il file di prova ora lo
-- dichiara: da qui in avanti un vincolo che esiste di la' esiste anche di qua.
--
-- LA CORREZIONE
-- Il vincolo diventa uno solo e dice la cosa giusta: le ore di chi lavora in
-- studio devono essere positive, la parcella di un esterno non ha ore.
-- =============================================================================

do $$
declare c text;
begin
  -- Il nome lo assegna PostgreSQL quando il vincolo e' scritto inline, e non e'
  -- detto che sia sempre lo stesso: si cerca per come e' fatto, non per nome.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.time_entries'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%hours%'
      and conname <> 'ck_ore_o_parcella'
  loop
    execute format('alter table public.time_entries drop constraint %I', c);
    raise notice 'Tolto il vincolo % sulle ore: non ammetteva le parcelle degli esterni.', c;
  end loop;

  if not exists (select 1 from pg_constraint where conname = 'ck_ore_o_parcella') then
    alter table public.time_entries
      add constraint ck_ore_o_parcella
      check (
        -- prestazione di un esterno: nessuna ora, conta la parcella
        (nullif(btrim(esterno), '') is not null and coalesce(hours, 0) = 0)
        -- ore di chi lavora in studio: devono essere ore vere
        or (nullif(btrim(esterno), '') is null and hours > 0)
      );
    raise notice 'Messo ck_ore_o_parcella: ore positive per lo studio, zero per gli esterni.';
  end if;
end $$;

comment on constraint ck_ore_o_parcella on public.time_entries is
  'Le ore di chi lavora in studio sono positive; la prestazione di un esterno non ha ore e vale per l''importo della sua parcella.';

-- -----------------------------------------------------------------------------
-- CONTROLLO FINALE, IN CHIARO
-- L'editor SQL di Supabase non mostra gli avvisi qui sopra: il controllo lo si
-- rifa' come tabella, ed e' l'ultima cosa che il file esegue.
-- Deve dire "una riga di parcella si inserisce".
-- -----------------------------------------------------------------------------
do $$
begin
  -- si prova davvero a scrivere una riga come quella che falliva, e si annulla
  insert into public.time_entries(project_id, entry_date, hours, esterno, costo_totale)
  select id, current_date, 0, 'PROVA MIGRAZIONE 029', 1
  from public.projects limit 1;
  delete from public.time_entries where esterno = 'PROVA MIGRAZIONE 029';
exception when others then
  raise exception 'La riga di prova non passa ancora: %', sqlerrm;
end $$;

select 'una riga di parcella si inserisce' as esito,
       (select count(*) from pg_constraint
        where conrelid = 'public.time_entries'::regclass and contype = 'c'
          and pg_get_constraintdef(oid) ilike '%hours%') as vincoli_sulle_ore;

-- =============================================================================
-- FINE MIGRAZIONE 029
-- =============================================================================
