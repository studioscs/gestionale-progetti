-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 040
-- Le spese anticipate scritte fra i servizi della fattura: esenti art. 15
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente.
--
-- IL PROBLEMA
-- Diritti di segreteria del Comune, marche da bollo, tributi catastali: lo
-- studio li anticipa per il cliente e se li fa restituire. Non sono un
-- compenso e vanno in fattura esenti IVA (art. 15 DPR 633/72, natura N1),
-- fuori dalla base di cassa e IVA. Il gestionale lo faceva per le spese
-- registrate come «spese anticipate» della commessa, ma nella pratica le si
-- scriveva come servizi dello scaglione («SPESE DIRITTI DI SEGRETERIA ...
-- ANTICIPATI PER VS. CONTO»): finivano nell'imponibile, con cassa e IVA.
--
-- LA CORREZIONE
--   commessa_fattura_righe.art15   la riga e' un'anticipazione art. 15: non
--                                   entra nell'imponibile dello scaglione,
--                                   in fattura va esente con natura N1.
-- L'imponibile dello scaglione (trigger della 024) somma solo le righe che
-- non lo sono. Le righe gia' scritte che si riconoscono dalla descrizione
-- (diritti di segreteria, marca da bollo, tributi o diritti catastali,
-- «anticipat...») vengono segnate, solo sugli scaglioni ancora da emettere:
-- le fatture gia' emesse restano come sono state mandate.
-- =============================================================================

alter table public.commessa_fattura_righe add column if not exists art15 boolean not null default false;

comment on column public.commessa_fattura_righe.art15 is
  'Spesa anticipata per il cliente (art. 15 DPR 633/72): fuori da imponibile, cassa e IVA; natura N1.';

create or replace function public.ricalcola_imponibile_fattura(f uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n integer; tot numeric(12,2);
begin
  select count(*), coalesce(sum(importo) filter (where not art15), 0) into n, tot
  from public.commessa_fattura_righe where fattura_id = f;

  if n > 0 then
    update public.commessa_fatture
       set imponibile = tot
     where id = f and imponibile is distinct from tot;
  end if;
end; $$;

-- Le righe gia' scritte che sono chiaramente anticipazioni, sugli scaglioni
-- non ancora emessi. Il trigger ricalcola l'imponibile di ciascuno.
update public.commessa_fattura_righe r
   set art15 = true
  from public.commessa_fatture f
 where f.id = r.fattura_id
   and f.stato in ('da_emettere', 'pronta')
   and not r.art15
   and r.descrizione ~* '(anticipat|diritti\s+di\s+segreteria|marc[ah]\s+(da\s+)?bollo|imposta\s+di\s+bollo|\mbolli\M|(tributi|diritti|spese)\s+(speciali\s+)?catastal)';

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'righe segnate come anticipazioni art. 15' as cosa,
       (select count(*) from public.commessa_fattura_righe where art15)::text as esito;

-- =============================================================================
-- FINE MIGRAZIONE 040 - ora riesegui la 018.
-- =============================================================================
