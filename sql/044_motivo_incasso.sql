-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 044
-- Perche' e' stato incassato un importo diverso da quello fatturato
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Segnando una fattura come incassata data e importo si scrivevano a mano, e
-- spesso non si scrivevano: 56 fatture incassate su 70 senza data d'incasso,
-- e un importo incassato compilato a volte con l'atteso, a volte no. Quando
-- poi arriva davvero meno (un abbuono, una trattenuta) non restava scritto il
-- perche'.
--
-- LA CORREZIONE
-- L'applicazione compila da sola data (oggi) e importo (quello da incassare);
-- se l'importo e' diverso chiede il motivo, che si scrive qui:
--   commessa_fatture.motivo_incasso   vuoto quando si e' incassato il dovuto.
-- Le regole di accesso sono quelle degli scaglioni: nessuna regola nuova.
-- =============================================================================

alter table public.commessa_fatture add column if not exists motivo_incasso text;

comment on column public.commessa_fatture.motivo_incasso is
  'Perché l''importo incassato è diverso da quello da incassare (abbuono, trattenuta...). Vuoto = incassato il dovuto.';

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'commessa_fatture.motivo_incasso' as cosa,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'commessa_fatture'
                            and column_name = 'motivo_incasso') then 'ok' else 'MANCANTE' end as esito;

-- =============================================================================
-- FINE MIGRAZIONE 044 - ora riesegui la 018.
-- =============================================================================
