-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 020
-- Il codice commessa e' unico
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- PERCHE'
-- Il codice - 2026_06 e simili - e' il nome con cui lo studio chiama il proprio
-- lavoro: ci si ordina l'elenco, ci si ritrova una pratica fra due anni, ci si
-- riconcilia una fattura. Due commesse con lo stesso codice non sono un
-- doppione qualsiasi: sono due lavori che d'ora in poi qualcuno confondera'.
--
-- L'applicazione lo impedisce gia' al salvataggio, ma l'interfaccia si aggira:
-- la chiave anon sta dentro index.html. Il vincolo va nel database.
--
-- COME
-- Indice unico PARZIALE, solo dove il codice c'e'. Le commesse vecchie senza
-- codice restano dove sono e non bloccano niente: l'elenco le segnala come
-- "senza codice" e si sistemano una alla volta.
--
-- Se in archivio ci sono gia' due commesse con lo stesso codice, l'indice non
-- si puo' creare. In quel caso questo file NON fallisce: elenca i doppioni e si
-- ferma, cosi' li correggi e lo rilanci.
-- =============================================================================

do $$
declare
  n integer;
  r record;
begin
  select count(*) into n from (
    select lower(btrim(codice)) as c
    from public.projects
    where codice is not null and btrim(codice) <> ''
    group by 1 having count(*) > 1
  ) d;

  if n > 0 then
    raise warning '---------------------------------------------------------------';
    raise warning 'INDICE NON CREATO: % codici risultano usati da due o piu'' commesse.', n;
    raise warning 'Correggili e rilancia questo file. Ecco quali:';
    for r in
      select lower(btrim(p.codice)) as codice, string_agg(p.name, ' | ' order by p.name) as commesse
      from public.projects p
      where p.codice is not null and btrim(p.codice) <> ''
      group by 1 having count(*) > 1
      order by 1
    loop
      raise warning '  % → %', r.codice, r.commesse;
    end loop;
    raise warning '---------------------------------------------------------------';
    return;
  end if;

  -- Confronto senza distinzione fra maiuscole e minuscole e senza spazi ai lati:
  -- "2026_06" e " 2026_06 " sono lo stesso codice, non due.
  create unique index if not exists uq_projects_codice
    on public.projects (lower(btrim(codice)))
    where codice is not null and btrim(codice) <> '';

  raise notice 'Codice commessa: vincolo di unicita'' attivo.';
end $$;

comment on column public.projects.codice is
  'Codice commessa, es. 2026_06. Obbligatorio dall''applicazione, unico nel database. E'' la chiave con cui si ordina l''elenco e si ritrova il lavoro.';

-- =============================================================================
-- FINE MIGRAZIONE 020
--
-- Le commesse a cui manca il codice, da sistemare dall'applicazione:
--   select name, client, created_at from public.projects
--   where codice is null or btrim(codice) = '' order by created_at;
-- =============================================================================
