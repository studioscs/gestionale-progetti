-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 017
-- Ore previste e ore effettive di una fase
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Il costo di una commessa lo ricavava un calcolo automatico. Quando il calcolo
-- non somiglia a com'e' andata davvero non c'era modo di correggerlo: si poteva
-- solo registrare le ore una per una, che e' esattamente cio' che nessuno fa.
--
-- LA CORREZIONE
-- Due numeri sulla fase, scritti dall'Avanzamento.
--
--   ore_stimate   quante ore ci si aspetta che la fase richieda. E' il preventivo
--                 interno: non entra nel costo, serve a vedere lo scostamento fra
--                 quanto si era previsto e quanto e' venuto fuori.
--
--   ore_effettive quante ore la fase e' costata davvero. Se c'e', vince: il
--                 calcolo automatico si fa da parte per quella fase. Le ore si
--                 dividono fra chi ha partecipato secondo il peso che ciascuno ha
--                 avuto - 70% a chi lavora, 30% a chi verifica.
--
-- Le date data_inizio e data_fine_prevista esistono gia' dalla migrazione 001:
-- e' da data_inizio che parte il conteggio automatico dei giorni feriali.
-- =============================================================================

alter table public.commessa_fasi add column if not exists ore_stimate   numeric(8,2);
alter table public.commessa_fasi add column if not exists ore_effettive numeric(8,2);

comment on column public.commessa_fasi.ore_stimate is
  'Ore previste per la fase. Preventivo interno: non entra nel costo, serve al confronto.';
comment on column public.commessa_fasi.ore_effettive is
  'Ore realmente impiegate. Se valorizzata sostituisce il calcolo automatico per questa fase.';

-- Ore negative non vogliono dire niente, e uno zero e' come non aver scritto
-- nulla: si tratta come "usa il calcolo automatico".
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_fasi_ore_non_negative') then
    alter table public.commessa_fasi
      add constraint ck_fasi_ore_non_negative
      check ((ore_stimate is null or ore_stimate >= 0)
         and (ore_effettive is null or ore_effettive >= 0));
  end if;
end $$;

-- =============================================================================
-- FINE MIGRAZIONE 017
--
-- Verifica:
--   select nome, data_inizio, data_fine_prevista, ore_stimate, ore_effettive
--   from public.commessa_fasi order by ordine limit 5;
-- =============================================================================
