-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 038
-- L'atto del contratto ricorda da quale preventivo nasce
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Un preventivo accettato diventava una commessa, ma nella sezione Contratto
-- della commessa non entrava niente: l'incarico si riscriveva a mano. E un
-- preventivo per prestazioni aggiuntive su una commessa gia' avviata andava
-- ricopiato come integrazione.
--
-- LA CORREZIONE
-- Ogni atto (incarico o integrazione) puo' indicare il preventivo da cui
-- nasce. L'applicazione lo usa per creare l'atto con un clic e per non
-- crearlo due volte dallo stesso preventivo. Le regole di accesso sono quelle
-- degli atti: nessuna regola nuova.
-- =============================================================================

alter table public.commessa_contratti add column if not exists preventivo_id uuid
  references public.preventivi(id) on delete set null;

-- Un preventivo diventa al massimo un atto
create unique index if not exists uq_contratti_preventivo on public.commessa_contratti(preventivo_id)
  where preventivo_id is not null;

comment on column public.commessa_contratti.preventivo_id is
  'Il preventivo accettato da cui nasce questo atto (incarico o integrazione).';

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'commessa_contratti.preventivo_id' as cosa,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'commessa_contratti'
                            and column_name = 'preventivo_id') then 'ok' else 'MANCANTE' end as esito;

-- =============================================================================
-- FINE MIGRAZIONE 038 - ora riesegui la 018.
-- =============================================================================
