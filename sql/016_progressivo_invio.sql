-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 016
-- Progressivo di invio persistente e irripetibile
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Il nome del file trasmesso allo SdI - IT<partitaIVA>_<progressivo>.xml - e il
-- campo ProgressivoInvio devono essere UNICI per chi trasmette: e' cosi' che il
-- Sistema di Interscambio riconosce un invio gia' fatto.
--
-- Il progressivo era una variabile tenuta in memoria dal browser, azzerata a
-- ogni ricaricamento della pagina. Due fatture generate in due momenti diversi
-- uscivano quindi con lo STESSO nome file e lo stesso ProgressivoInvio: il
-- software di fatturazione le leggeva come un documento gia' importato e non
-- proponeva piu' l'invio.
--
-- LA CORREZIONE
-- Il progressivo lo assegna il database, una volta sola per fattura, e resta
-- scritto sulla riga. Rigenerando l'XML della stessa fattura si riusa il suo
-- numero - e' lo stesso documento - mentre una fattura nuova ne prende uno mai
-- usato prima. Sopravvive ai ricaricamenti e vale per tutti i computer dello
-- studio, cosa che una variabile nel browser non puo' fare.
-- =============================================================================

alter table public.commessa_fatture add column if not exists progressivo_invio integer;

comment on column public.commessa_fatture.progressivo_invio is
  'Progressivo del file trasmesso allo SdI. Assegnato alla prima generazione dell''XML e mai riusato.';

-- Due fatture non possono condividerlo: sarebbe di nuovo il guasto di partenza.
create unique index if not exists uq_progressivo_invio
  on public.commessa_fatture(progressivo_invio) where progressivo_invio is not null;

-- -----------------------------------------------------------------------------
-- La sequenza parte da 1000 e non da 1.
-- I file gia' prodotti col vecchio metodo hanno usato numeri bassi (1, 2, 3...)
-- e alcuni possono essere gia' stati importati o trasmessi. Partire da un valore
-- lontano evita che il primo file nuovo collida con uno vecchio e venga
-- rifiutato come duplicato. Il ProgressivoInvio non ha significato fiscale:
-- deve solo essere irripetibile, quindi il numero da cui parte e' indifferente.
-- -----------------------------------------------------------------------------
create sequence if not exists public.seq_progressivo_invio start with 1000;

-- -----------------------------------------------------------------------------
-- Assegnazione: idempotente per fattura.
-- Se la fattura ha gia' il suo numero lo restituisce, altrimenti ne prende uno
-- nuovo. Chiamarla due volte sulla stessa fattura non consuma due numeri: e' il
-- caso normale, perche' l'XML si rigenera dopo una correzione.
-- -----------------------------------------------------------------------------
create or replace function public.assegna_progressivo(fattura uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select progressivo_invio into n from public.commessa_fatture where id = fattura;
  if n is not null then
    return n;
  end if;

  n := nextval('public.seq_progressivo_invio');
  update public.commessa_fatture set progressivo_invio = n where id = fattura;
  return n;
end; $$;

revoke all on function public.assegna_progressivo(uuid) from public;
grant execute on function public.assegna_progressivo(uuid) to authenticated;

comment on function public.assegna_progressivo(uuid) is
  'Restituisce il progressivo di invio della fattura, assegnandone uno nuovo solo la prima volta.';

-- =============================================================================
-- FINE MIGRAZIONE 016
--
-- Se il software di fatturazione dovesse ancora segnalare un duplicato, vuol
-- dire che quel progressivo era gia' stato usato: basta spostare avanti la
-- sequenza, per esempio
--   select setval('public.seq_progressivo_invio', 5000);
-- =============================================================================
