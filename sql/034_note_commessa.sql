-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 034
-- Le note della commessa e le note sui contratti
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Il cliente aveva un campo note, ogni atto (incarico, integrazione) anche;
-- la commessa no. Quello che non sta in un campo preciso - una telefonata,
-- un accordo a voce, una condizione strana del contratto - finiva nella
-- descrizione o in un foglio a parte.
--
-- LA CORREZIONE
-- Due campi di testo nella commessa:
--   note            le note generali della commessa (scheda Anagrafica);
--   note_contratti  le note sulla parte contrattuale, accanto all'elenco
--                   degli atti (scheda Fatturazione).
-- Le regole di accesso sono quelle della commessa: chi la vede legge le note,
-- chi la puo' modificare le scrive. Nessuna regola nuova.
-- =============================================================================

alter table public.projects add column if not exists note           text;
alter table public.projects add column if not exists note_contratti text;

comment on column public.projects.note is
  'Note generali della commessa: telefonate, accordi, promemoria. Testo libero.';
comment on column public.projects.note_contratti is
  'Note sulla parte contrattuale della commessa, accanto agli atti.';

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'projects.note e note_contratti' as cosa,
       case when count(*) = 2 then 'ok' else 'MANCANO COLONNE' end as esito
  from information_schema.columns
 where table_schema = 'public' and table_name = 'projects' and column_name in ('note','note_contratti');

-- =============================================================================
-- FINE MIGRAZIONE 034 - ora riesegui la 018.
-- =============================================================================
