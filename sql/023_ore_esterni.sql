-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 023
-- Non tutto quello che costa si misura in ore
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Una registrazione poteva essere solo "tot ore di una persona dello studio",
-- valorizzate col suo costo orario. Ma su una commessa pesa anche il geologo,
-- il collaudatore, l'acustico: gente che non ha un accesso al gestionale e che
-- non manda ore, manda una parcella. Quel costo non aveva dove stare, e la
-- Redditivita' mostrava commesse piu' redditizie di quanto fossero.
--
-- LA CORREZIONE
-- Due colonne. Una registrazione ora e' una delle due cose:
--
--   ORE DI CHI STA IN STUDIO   operator_id + hours, valorizzate col costo
--                              orario in vigore quel giorno. Come prima.
--
--   COSTO DI UN ESTERNO        esterno (il nome) + costo_totale. Le ore non
--                              c'entrano: quello che pesa e' la parcella.
--
-- hours resta obbligatoria perche' lo era gia' e non si tolgono vincoli a
-- cuor leggero: le registrazioni degli esterni ci scrivono zero, e per non
-- doverlo ricordare a ogni inserimento ora ha un valore di partenza.
-- =============================================================================

alter table public.time_entries add column if not exists esterno       text;
alter table public.time_entries add column if not exists costo_totale  numeric(12,2);
alter table public.time_entries alter column hours set default 0;

comment on column public.time_entries.esterno is
  'Nome del collaboratore esterno: geologo, collaudatore, acustico. Se c''e'', la registrazione e'' una parcella e non delle ore.';
comment on column public.time_entries.costo_totale is
  'Costo della prestazione esterna, in euro. Prende il posto del calcolo ore x costo orario.';

-- Una registrazione o e' di qualcuno dello studio o e' di un esterno: non
-- entrambe le cose, e non nessuna delle due.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_time_entries_chi') then
    alter table public.time_entries
      add constraint ck_time_entries_chi
      check (operator_id is not null or nullif(btrim(esterno), '') is not null);
  end if;
end $$;

-- Le prestazioni esterne si cercano per commessa quando si tirano le somme.
create index if not exists idx_time_esterno on public.time_entries(project_id)
  where esterno is not null;

-- =============================================================================
-- FINE MIGRAZIONE 023
--
-- Verifica:
--   select entry_date, coalesce(esterno, 'interno') as chi, hours, costo_totale, description
--   from public.time_entries order by entry_date desc limit 20;
-- =============================================================================
