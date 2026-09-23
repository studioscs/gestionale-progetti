-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 030
-- ISA: tipologia di attivita' e anno di competenza su ogni riga di fattura
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Ogni anno il quadro C del modello ISA (EK23U, studi tecnici) chiede, per ogni
-- tipologia di attivita' da C01 a C29, quanti incarichi e che percentuale del
-- lavoro rappresenta. Quelle percentuali si ricostruivano a mano a fine anno,
-- rileggendo le fatture una per una e decidendo a posteriori a quale casella
-- apparteneva ciascuna: un lavoro lungo, fatto quando i dettagli si sono
-- dimenticati, e con un margine di errore che nessuno puo' controllare.
--
-- LA CORREZIONE
-- La tipologia la si sceglie quando si sa: alla firma del contratto, mentre si
-- predispongono gli scaglioni. Insieme all'anno di competenza fiscale, che non
-- coincide per forza con la data della fattura - un acconto incassato a gennaio
-- puo' essere competenza dell'anno prima.
--
-- Da li' il totale e le percentuali li fa il gestionale, su richiesta, per
-- l'anno che si indica.
--
-- DOVE STANNO I DUE CAMPI
-- Su entrambi i livelli, perche' una fattura puo' essere fatta in due modi:
--   - con i servizi elencati (migrazione 024): ogni riga ha la sua tipologia e
--     il suo anno, ed e' il caso normale - lo stesso acconto puo' coprire
--     progettazione e direzione lavori, che sono caselle diverse;
--   - a voce unica: allora valgono quelli scritti sullo scaglione.
-- Quando ci sono le righe, quello che c'e' scritto sulla riga vince.
-- =============================================================================

-- I codici del quadro C. Scritti qui perche' il database rifiuti un codice
-- inventato: una casella sbagliata in un modello fiscale non si vede finche'
-- non e' tardi.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'isa_tipo_attivita') then
    create type public.isa_tipo_attivita as enum (
      'C01','C02','C03','C04','C05','C06','C07','C08','C09','C10',
      'C11','C12','C13','C14','C15','C16','C17','C18','C19','C20',
      'C21','C22','C23','C24','C25','C26','C27','C28','C29');
  end if;
end $$;

alter table public.commessa_fattura_righe
  add column if not exists isa_tipo        public.isa_tipo_attivita;
alter table public.commessa_fattura_righe
  add column if not exists anno_competenza integer;

alter table public.commessa_fatture
  add column if not exists isa_tipo        public.isa_tipo_attivita;
alter table public.commessa_fatture
  add column if not exists anno_competenza integer;

comment on column public.commessa_fattura_righe.isa_tipo is
  'Tipologia di attivita'' del quadro C del modello ISA (C01..C29). Serve a ricostruire a fine anno numero di incarichi e percentuali.';
comment on column public.commessa_fattura_righe.anno_competenza is
  'Anno di competenza fiscale della riga. Non e'' per forza l''anno della fattura: un acconto incassato a gennaio puo'' essere competenza dell''anno prima.';
comment on column public.commessa_fatture.isa_tipo is
  'Tipologia ISA dello scaglione. Vale quando la fattura e'' a voce unica; con i servizi elencati vince quella della riga.';
comment on column public.commessa_fatture.anno_competenza is
  'Anno di competenza dello scaglione. Vale quando la fattura e'' a voce unica; con i servizi elencati vince quello della riga.';

-- Un anno fuori scala e' quasi sempre una battitura (202 invece di 2026), e
-- falserebbe in silenzio il riepilogo di quell'anno.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_anno_competenza_righe') then
    alter table public.commessa_fattura_righe
      add constraint ck_anno_competenza_righe
      check (anno_competenza is null or anno_competenza between 2000 and 2100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_anno_competenza_fatture') then
    alter table public.commessa_fatture
      add constraint ck_anno_competenza_fatture
      check (anno_competenza is null or anno_competenza between 2000 and 2100);
  end if;
end $$;

-- Il riepilogo ISA parte dall'anno: e' l'unica cosa che si chiede.
create index if not exists idx_righe_anno on public.commessa_fattura_righe(anno_competenza)
  where anno_competenza is not null;
create index if not exists idx_fatture_anno on public.commessa_fatture(anno_competenza)
  where anno_competenza is not null;

-- =============================================================================
-- FINE MIGRAZIONE 030
--
-- Verifica: cosa risulta per un anno, tipologia per tipologia.
--   select coalesce(r.isa_tipo, f.isa_tipo) as tipo,
--          count(distinct f.project_id)     as incarichi,
--          sum(coalesce(r.importo, f.imponibile)) as importo
--   from public.commessa_fatture f
--   left join public.commessa_fattura_righe r on r.fattura_id = f.id
--   where coalesce(r.anno_competenza, f.anno_competenza) = 2026
--   group by 1 order by 1;
--
-- Cosa non e' ancora stato classificato (e quindi resta fuori dal conto):
--   select f.numero_fattura, f.descrizione, f.imponibile
--   from public.commessa_fatture f
--   where f.isa_tipo is null
--     and not exists (select 1 from public.commessa_fattura_righe r
--                     where r.fattura_id = f.id and r.isa_tipo is not null);
-- =============================================================================
