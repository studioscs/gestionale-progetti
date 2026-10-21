-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 035
-- I solleciti di pagamento e la messa in mora
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Nel foglio della "black list" accanto a ogni fattura non pagata si
-- segnavano a penna fino a tre crocette: i solleciti fatti. Nel gestionale
-- non c'era un posto dove scriverlo, e chi aveva gia' sollecitato e quando
-- lo sapeva solo chi l'aveva fatto.
--
-- LA CORREZIONE
-- Su ogni scaglione di fatturazione (fattura emessa o proforma mandata):
--   sollecito_1, sollecito_2   le date del primo e del secondo sollecito;
--   messa_in_mora              la data del terzo passo: la messa in mora
--                              affidata all'avvocato;
--   avvocato                   chi la segue;
--   note_solleciti             come e' stato fatto, che cosa ha risposto.
-- Le regole di accesso sono quelle degli scaglioni: nessuna regola nuova.
-- =============================================================================

alter table public.commessa_fatture add column if not exists sollecito_1    date;
alter table public.commessa_fatture add column if not exists sollecito_2    date;
alter table public.commessa_fatture add column if not exists messa_in_mora  date;
alter table public.commessa_fatture add column if not exists avvocato       text;
alter table public.commessa_fatture add column if not exists note_solleciti text;

comment on column public.commessa_fatture.sollecito_1   is 'Data del primo sollecito di pagamento.';
comment on column public.commessa_fatture.sollecito_2   is 'Data del secondo sollecito di pagamento.';
comment on column public.commessa_fatture.messa_in_mora is 'Data della messa in mora affidata all''avvocato (terzo passo).';
comment on column public.commessa_fatture.avvocato      is 'Avvocato che segue la messa in mora.';

-- Per l'elenco delle posizioni in mora
create index if not exists idx_fatture_mora on public.commessa_fatture(messa_in_mora)
  where messa_in_mora is not null;

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'solleciti e messa in mora sugli scaglioni' as cosa,
       case when count(*) = 5 then 'ok' else 'MANCANO COLONNE' end as esito
  from information_schema.columns
 where table_schema = 'public' and table_name = 'commessa_fatture'
   and column_name in ('sollecito_1','sollecito_2','messa_in_mora','avvocato','note_solleciti');

-- =============================================================================
-- FINE MIGRAZIONE 035 - ora riesegui la 018.
-- =============================================================================
