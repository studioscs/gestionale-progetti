-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 051
-- Dati dello studio modificabili dall'app
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente.
--
-- IL PROBLEMA
-- Polizza, recapiti, PEC, IBAN, indirizzo dello studio erano scritti dentro
-- index.html: per cambiarli (polizza rinnovata, nuovo telefono) serviva
-- modificare il programma.
--
-- LA CORREZIONE
-- Una tabella con una riga sola, public.studio_impostazioni (id = 1), che
-- tiene i dati in un campo JSON. L'app la legge all'avvio e la usa al posto
-- dei valori scritti nel programma (che restano come ripiego). La pagina
-- «Dati dello studio» la modifica.
--   - legge: ogni utente attivo (servono per preventivi, proforma, fatture);
--   - scrive: solo un amministratore.
-- Entra nella copia di sicurezza e nel ripristino: la funzione
-- public.ripristina_righe (050) e' ridefinita qui con la tabella in elenco.
-- La 018 non tocca questa tabella: rieseguirla dopo non cambia niente.
-- =============================================================================

create table if not exists public.studio_impostazioni (
  id          integer primary key default 1 check (id = 1),
  dati        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

alter table public.studio_impostazioni enable row level security;

drop policy if exists "studio_read"   on public.studio_impostazioni;
drop policy if exists "studio_insert" on public.studio_impostazioni;
drop policy if exists "studio_update" on public.studio_impostazioni;
drop policy if exists "studio_delete" on public.studio_impostazioni;
create policy "studio_read" on public.studio_impostazioni for select to authenticated
  using (private.utente_attivo());
create policy "studio_insert" on public.studio_impostazioni for insert to authenticated
  with check (private.is_admin());
create policy "studio_update" on public.studio_impostazioni for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
-- nessuna politica di cancellazione: la riga non si elimina

grant select, insert, update on public.studio_impostazioni to authenticated;
revoke all on public.studio_impostazioni from anon;

-- la riga c'e' sempre (vuota: valgono i dati scritti nel programma)
insert into public.studio_impostazioni (id) values (1) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Ripristino da copia: la funzione della 050 con la tabella nuova in elenco
-- -----------------------------------------------------------------------------
create or replace function public.ripristina_righe(tabella text, righe jsonb, sovrascrivi boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  consentite constant text[] := array['enti_pa', 'clienti', 'projects', 'preventivi', 'commessa_contratti',
    'commessa_fasi', 'commessa_sal', 'commessa_varianti', 'project_fasi', 'project_sottofasi',
    'commessa_pratiche', 'tasks', 'task_messaggi', 'task_comments', 'pratica_eventi',
    'commessa_fatture', 'commessa_fattura_righe', 'commessa_spese', 'time_entries', 'files',
    'costi_generali', 'profili_costi', 'preventivo_modelli', 'pratiche_catalogo', 'studio_impostazioni'];
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
  select jsonb_agg(e) into righe from jsonb_array_elements(righe) e where jsonb_typeof(e) = 'object';
  if righe is null then
    return 0;
  end if;
  if not ((righe -> 0) ? 'id') then
    raise exception 'Le righe della copia non hanno la colonna id' using errcode = '22023';
  end if;

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

  for t in select unnest(spenti) as tgname loop
    execute format('alter table public.%I enable trigger %I', tabella, t.tgname);
  end loop;
  return n;
end; $$;

revoke all on function public.ripristina_righe(text, jsonb, boolean) from public, anon;
grant execute on function public.ripristina_righe(text, jsonb, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Resoconto leggibile
-- -----------------------------------------------------------------------------
select 'dati dello studio' as cosa,
       case when exists (select 1 from public.studio_impostazioni where id = 1) then 'ok' else 'MANCANTE' end as tabella,
       (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
         where c.relname = 'studio_impostazioni') as regole_accesso,
       case when pg_get_functiondef('public.ripristina_righe'::regproc) ~ 'studio_impostazioni'
            then 'ok' else 'NO' end as ripristino;

-- =============================================================================
-- FINE MIGRAZIONE 051
-- =============================================================================
