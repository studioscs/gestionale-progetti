-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 028
-- Le parcelle dei collaboratori esterni: pagate e da pagare
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Il geologo, il collaudatore, l'acustico mandano una parcella. Dalla 023 quella
-- parcella si registra - nome e importo - e pesa correttamente sulla
-- redditivita' della commessa. Ma non c'era modo di dire se fosse stata PAGATA:
-- l'unico posto dove quell'informazione viveva era la memoria di chi tiene la
-- banca, e "al geologo della Villa abbiamo poi pagato?" era una domanda a cui
-- si rispondeva cercando i bonifici.
--
-- LA CORREZIONE
-- Due colonne sulla registrazione: se e' stata pagata, e quando. Da li' si
-- risponde alla domanda commessa per commessa, e in un colpo solo su tutto lo
-- studio - quanto e' uscito e quanto deve ancora uscire.
--
-- PERCHE' QUI E NON IN UNA TABELLA NUOVA
-- La prestazione di un esterno e' gia' una riga di time_entries: e' cosi' che
-- entra nel costo di commessa e nella redditivita'. Farne una tabella a parte
-- vorrebbe dire tenere due elenchi che parlano della stessa cosa, e prima o poi
-- uno dei due direbbe il falso.
-- =============================================================================

alter table public.time_entries add column if not exists pagato boolean not null default false;
alter table public.time_entries add column if not exists data_pagamento date;

comment on column public.time_entries.pagato is
  'Solo per le prestazioni esterne: la parcella e'' stata pagata. Sulle ore di chi lavora in studio non vuol dire niente e resta falsa.';
comment on column public.time_entries.data_pagamento is
  'Quando e'' stata pagata la parcella dell''esterno.';

-- Le parcelle ancora da pagare sono quelle che si cercano di continuo: l'indice
-- parziale tiene solo quelle, che sono poche.
create index if not exists idx_time_esterni_daPagare
  on public.time_entries(project_id)
  where esterno is not null and not pagato;

-- -----------------------------------------------------------------------------
-- COERENZA: una data di pagamento senza pagamento non vuol dire niente
-- Segnare "non pagata" lasciando la data di quando e' stata pagata e' il modo
-- piu' facile di ritrovarsi un elenco che non torna. Il database lo impedisce.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_pagamento_coerente') then
    -- Le righe gia' scritte non hanno date di pagamento: il vincolo nasce
    -- soddisfatto e non blocca niente di esistente.
    alter table public.time_entries
      add constraint ck_pagamento_coerente
      check (data_pagamento is null or pagato);
  end if;
end $$;

-- =============================================================================
-- FINE MIGRAZIONE 028
--
-- Verifica: cosa deve ancora uscire dalla cassa, commessa per commessa.
--   select p.name, e.esterno, e.costo_totale, e.entry_date
--   from public.time_entries e
--   join public.projects p on p.id = e.project_id
--   where e.esterno is not null and not e.pagato
--   order by p.name, e.entry_date;
--
-- E il totale dello studio:
--   select coalesce(sum(costo_totale) filter (where pagato), 0)     as gia_pagato,
--          coalesce(sum(costo_totale) filter (where not pagato), 0) as da_pagare
--   from public.time_entries where esterno is not null;
-- =============================================================================
