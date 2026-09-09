-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 026
-- Le note che il committente legge in fattura le scrive una persona
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Il campo <Causale> del documento - quello che i programmi di fatturazione
-- mostrano come "Note" - se lo componeva il gestionale da solo: ci finivano
-- l'oggetto dell'incarico e il riferimento alla commessa, messi li' da una
-- regola e non da qualcuno. Il risultato e' che in fattura compariva sempre
-- una nota che nessuno aveva scritto e nessuno poteva togliere.
--
-- E' lo stesso difetto, in forma piu' educata, di quello gia' corretto con la
-- nota per l'amministrazione finita in fattura: un campo che il committente
-- legge non puo' riempirsi da solo.
--
-- LA CORREZIONE
-- Una casella sua sullo scaglione, "Note in fattura", che parte vuota. In
-- <Causale> va quello che c'e' scritto li' dentro, e nient'altro. Se e' vuota,
-- il documento esce senza note - che e' il caso normale.
--
-- PERCHE' UNA COLONNA NUOVA E NON QUELLA CHE C'ERA
-- Lo scaglione ha gia' un campo "note". Ma e' nato come promemoria interno,
-- e' etichettato cosi' da sempre, e la' dentro puo' esserci di tutto: girarlo
-- verso il committente farebbe uscire in fattura appunti scritti in un'altra
-- epoca e per un altro scopo. Nasce vuota, quindi non puo' far uscire niente
-- che qualcuno non abbia scritto sapendo dove andava a finire.
-- =============================================================================

alter table public.commessa_fatture add column if not exists note_fattura text;

comment on column public.commessa_fatture.note_fattura is
  'Le note che il committente legge in fattura (<Causale> del tracciato FatturaPA). La scrive una persona: se e'' vuota, il documento esce senza note. Da non confondere con "note", che e'' il promemoria interno, e con "richiesta_note", che e'' il messaggio a chi fattura.';

-- =============================================================================
-- FINE MIGRAZIONE 026
--
-- Verifica: le tre colonne devono esistere e avere scopi distinti.
--   select column_name, col_description(
--            ('public.commessa_fatture')::regclass::oid, ordinal_position) as a_cosa_serve
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'commessa_fatture'
--     and column_name in ('note','richiesta_note','note_fattura')
--   order by column_name;
-- =============================================================================
