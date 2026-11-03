-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 043
-- La fattura (o la proforma) intestata a chi paga, se non e' il committente
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Capita che paghi la moglie, la sorella, la societa' del committente: nella
-- finestra di revisione si correggevano nome, codice fiscale e indirizzo, ma
-- la correzione valeva solo per quel file. Rigenerando la stessa proforma o
-- la stessa fattura tornava il committente della commessa.
--
-- LA CORREZIONE
--   commessa_fatture.intestatario   SOLO i dati che differiscono da quelli del
--                                   committente (es. {"cliente":"ROSSI ANNA",
--                                   "clienteCf":"RSSNNA..."}); vuoto quando la
--                                   fattura e' intestata al committente, cioe'
--                                   quasi sempre. Poche decine di caratteri, e
--                                   solo sugli scaglioni che ne hanno bisogno.
-- La commessa e l'anagrafica del cliente non cambiano. Le regole di accesso
-- sono quelle degli scaglioni: nessuna regola nuova.
-- =============================================================================

alter table public.commessa_fatture add column if not exists intestatario jsonb;

comment on column public.commessa_fatture.intestatario is
  'Intestatario del documento diverso dal committente: solo i campi che cambiano. Vuoto = il committente.';

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'commessa_fatture.intestatario' as cosa,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'commessa_fatture'
                            and column_name = 'intestatario') then 'ok' else 'MANCANTE' end as esito;

-- =============================================================================
-- FINE MIGRAZIONE 043 - ora riesegui la 018.
-- =============================================================================
