-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 019
-- «Questa si puo' fatturare»: dal tecnico all'amministrazione
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Gli scaglioni di fatturazione si predispongono a inizio commessa, secondo
-- contratto: acconto, secondo acconto, saldo. Poi qualcuno deve accorgersi che
-- uno di quelli e' maturato e dirlo a chi fattura. Quel passaggio non stava da
-- nessuna parte: avveniva a voce, o per messaggio, e quando non avveniva la
-- fattura restava li' per settimane.
--
-- Chi lo sa e' il responsabile della commessa, che pero' non fattura; chi
-- fattura non segue i lavori e non puo' indovinare. Serviva un atto esplicito
-- con un mittente, una data e un motivo.
--
-- LA CORREZIONE
-- Tre colonne sullo scaglione: chi ha chiesto di fatturare, quando, e cosa ha
-- scritto. Non e' uno stato in piu' - lo stato dello scaglione resta quello di
-- prima, "pronta da emettere" - e' la traccia di CHI l'ha dichiarato tale.
--
-- La richiesta si considera evasa da sola quando lo scaglione diventa emesso,
-- incassato o annullato: non serve un secondo pulsante che qualcuno si
-- dimenticherebbe di premere.
-- =============================================================================

alter table public.commessa_fatture add column if not exists richiesta_at   timestamptz;
alter table public.commessa_fatture add column if not exists richiesta_da   uuid references public.profiles(id) on delete set null;
alter table public.commessa_fatture add column if not exists richiesta_note text;

comment on column public.commessa_fatture.richiesta_at is
  'Quando il responsabile ha dichiarato lo scaglione fatturabile. Nullo = nessuna richiesta.';
comment on column public.commessa_fatture.richiesta_da is
  'Chi ha chiesto di fatturare: serve a sapere a chi chiedere conto se qualcosa non torna.';
comment on column public.commessa_fatture.richiesta_note is
  'Cosa ha scritto all''amministrazione: riferimenti, SAL, prescrizioni sul documento.';

-- Le richieste aperte si cercano spesso e sono poche: un indice parziale basta.
create index if not exists idx_fatture_richieste
  on public.commessa_fatture(richiesta_at desc)
  where richiesta_at is not null and stato in ('da_emettere','pronta');

-- =============================================================================
-- FINE MIGRAZIONE 019
--
-- Verifica:
--   select descrizione, stato, richiesta_at, richiesta_da, richiesta_note
--   from public.commessa_fatture where richiesta_at is not null order by richiesta_at desc;
-- =============================================================================
