-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 013
-- Ordine di esecuzione delle pratiche
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- PERCHE' UN NUMERO E NON L'ORDINE ALFABETICO
-- Le pratiche di un intervento privato non si fanno in ordine sparso: il
-- certificato di destinazione urbanistica e l'accesso agli atti vengono prima di
-- tutto, perche' senza stato legittimo non si progetta; i pareri vincolanti
-- (paesaggistica, Soprintendenza, vincolo idrogeologico) vanno chiusi PRIMA di
-- presentare il titolo edilizio, altrimenti il titolo nasce sospeso; il deposito
-- sismico segue il titolo ma precede l'inizio dei lavori; catasto, APE e
-- agibilita' stanno in coda.
--
-- Sbagliare l'ordine non e' un dettaglio formale: e' la causa piu' comune di
-- cantieri fermi. Il numero d'ordine viaggia con la pratica cosi' l'elenco la
-- mette al posto giusto, invece di ordinarla per nome dell'ente.
-- =============================================================================

alter table public.commessa_pratiche add column if not exists ordine integer not null default 50;

comment on column public.commessa_pratiche.ordine is
  'Posizione nella sequenza di esecuzione: numeri bassi si fanno prima. Deriva dal catalogo delle pratiche.';

create index if not exists idx_pratiche_ordine
  on public.commessa_pratiche(project_id, ordine);

-- -----------------------------------------------------------------------------
-- Riallineamento delle pratiche gia' create
-- Le commesse aperte prima di questa migrazione hanno tutte ordine 50: senza un
-- riallineamento resterebbero in ordine casuale per sempre. La mappa ricalca
-- quella del catalogo nell'applicazione.
-- -----------------------------------------------------------------------------
do $$
declare
  mappa jsonb := '{
    "accesso_atti":10, "cdu":11, "sanatoria":15,
    "sopr_art12":20, "idrogeo":25, "idraulico":26, "via":27, "archeo":30,
    "paes_sempl":35, "paes_ord":36, "commis_pae":37, "sopr_art21":40,
    "vvf_prog":45, "vvf_deroga":46, "asl":50, "scarico":52, "fognatura":53,
    "acustica":54, "alberi":56, "accesso":58, "cds":60,
    "titolo_edilizio":65, "cila":65, "scia":65, "pdc":66,
    "sismica_dep":70, "sismica_aut":70, "denuncia_ca":71,
    "l10":72, "terre_rocce":74, "amianto":76, "notifica81":78,
    "suolo_pubblico":80, "enel":82, "gas_acqua":83,
    "collaudo_statico":85, "vvf_scia":88, "docfa":90, "pregeo":91,
    "ape":92, "fine_lavori_gc":94, "agibilita":96, "altro":99
  }'::jsonb;
  k text;
begin
  for k in select jsonb_object_keys(mappa) loop
    update public.commessa_pratiche
       set ordine = (mappa ->> k)::int
     where pratica_key = k;
  end loop;
end $$;

-- =============================================================================
-- FINE MIGRAZIONE 013
-- =============================================================================
