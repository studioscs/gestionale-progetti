-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 050
-- Ripristino da una copia di sicurezza, senza effetti collaterali
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente. Non crea tabelle e non tocca
-- le regole d'accesso: la 018 non serve rieseguirla.
--
-- IL PROBLEMA
-- L'app scarica la copia di sicurezza (tutte le tabelle in un file) e la deve
-- poter rimettere. Reinserire le righe dal browser pero' fa scattare gli
-- automatismi del database, pensati per il lavoro di tutti i giorni e non per
-- un ripristino:
--   - un'attivita' completata prende come data di completamento OGGI
--     (stamp_task_completion), e la sua pratica riceve un evento in piu';
--   - un SAL reinserito crea DI NUOVO la sua quota di direzione lavori
--     (matura_quota_dl), che poi si troverebbe doppia con quella ripristinata;
--   - una variante approvata si somma DI NUOVO all'importo della commessa;
--   - un messaggio reinserito rimanda la notifica; le date «aggiornato il»
--     diventano oggi; le regole fasi/commessa (045, 047, 048) cambiano righe
--     che il ripristino stesso sta rimettendo com'erano.
-- Supabase non lascia spegnere tutti i trigger in blocco
-- (session_replication_role e' riservato).
--
-- LA CORREZIONE
-- public.ripristina_righe(tabella, righe, sovrascrivi): solo per un admin e
-- solo per le tabelle dell'elenco. Dentro la stessa transazione spegne i
-- trigger della tabella, inserisce le righe (sovrascrivi = false: quelle che
-- gia' ci sono restano come sono; true: tornano come nella copia), e riaccende
-- i trigger. Se qualcosa va storto la transazione si annulla e i trigger
-- restano accesi. Restano accesi comunque:
--   - i controlli dei collegamenti (chiavi esterne): non sono trigger utente;
--   - trg_ricalcola_importo e trg_ricalcola_imponibile, che ricalcolano una
--     somma da tutte le righe e quindi danno sempre il risultato giusto.
-- Non si cancella mai niente. Gli utenti (profiles) non si ripristinano.
-- =============================================================================

create or replace function public.ripristina_righe(tabella text, righe jsonb, sovrascrivi boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  consentite constant text[] := array['enti_pa', 'clienti', 'projects', 'preventivi', 'commessa_contratti',
    'commessa_fasi', 'commessa_sal', 'commessa_varianti', 'project_fasi', 'project_sottofasi',
    'commessa_pratiche', 'tasks', 'task_messaggi', 'task_comments', 'pratica_eventi',
    'commessa_fatture', 'commessa_fattura_righe', 'commessa_spese', 'time_entries', 'files',
    'costi_generali', 'profili_costi', 'preventivo_modelli', 'pratiche_catalogo'];
  restano_accesi constant text[] := array['trg_ricalcola_importo', 'trg_ricalcola_imponibile'];
  colonne text; aggiorna text; n integer; t record; spenti text[] := '{}';
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'Il ripristino lo fa solo un amministratore' using errcode = '42501';
  end if;
  if not (tabella = any(consentite)) then
    raise exception 'Questa tabella non si ripristina: %', tabella using errcode = '22023';
  end if;
  if righe is null or jsonb_typeof(righe) <> 'array' then
    return 0;
  end if;
  -- solo le righe vere (un elemento vuoto o null non e' una riga)
  select jsonb_agg(e) into righe from jsonb_array_elements(righe) e where jsonb_typeof(e) = 'object';
  if righe is null then
    return 0;
  end if;
  if not ((righe -> 0) ? 'id') then
    raise exception 'Le righe della copia non hanno la colonna id' using errcode = '22023';
  end if;

  -- Le colonne della tabella che il file contiene (le calcolate no): una
  -- colonna aggiunta dopo la copia prende il suo valore predefinito.
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg(format('%1$I = excluded.%1$I', c.column_name), ', ' order by c.ordinal_position)
           filter (where c.column_name <> 'id')
    into colonne, aggiorna
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = tabella
     and c.is_generated = 'NEVER'
     and (righe -> 0) ? c.column_name;

  for t in select tgname from pg_trigger
            where tgrelid = format('public.%I', tabella)::regclass
              and not tgisinternal and tgenabled <> 'D'
              and not (tgname = any(restano_accesi)) loop
    execute format('alter table public.%I disable trigger %I', tabella, t.tgname);
    spenti := spenti || t.tgname::text;
  end loop;

  execute format(
    'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) '
    || 'on conflict (id) do %3$s',
    tabella, colonne,
    case when sovrascrivi and aggiorna is not null then 'update set ' || aggiorna else 'nothing' end) using righe;
  get diagnostics n = row_count;

  -- si riaccendono solo quelli spenti qui
  for t in select unnest(spenti) as tgname loop
    execute format('alter table public.%I enable trigger %I', tabella, t.tgname);
  end loop;
  return n;
end; $$;

revoke all on function public.ripristina_righe(text, jsonb, boolean) from public, anon;
grant execute on function public.ripristina_righe(text, jsonb, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'ripristino da copia' as cosa,
       case when exists (select 1 from pg_proc where proname = 'ripristina_righe') then 'ok' else 'MANCANTE' end as esito;

-- =============================================================================
-- FINE MIGRAZIONE 050
-- =============================================================================
