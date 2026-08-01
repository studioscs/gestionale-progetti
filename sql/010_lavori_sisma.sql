-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 010
-- Contrassegno "lavori sisma" sulla commessa
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- PERCHE' SERVE UN CAMPO E NON UNA REGOLA A MENTE
-- Lo studio incassa su due conti correnti: uno dedicato alla ricostruzione
-- post-sisma e uno per tutto il resto. Le somme non devono mescolarsi, perche'
-- la rendicontazione del contributo guarda i movimenti di quel conto.
--
-- Finche' l'IBAN lo sceglie una persona al momento di emettere la fattura, prima
-- o poi finisce sul conto sbagliato e la correzione costa una nota di credito.
-- Segnandolo sulla commessa, la scelta si fa una volta sola all'apertura del
-- lavoro e ogni fattura di quella commessa esce con l'IBAN giusto.
-- =============================================================================

alter table public.projects add column if not exists sisma boolean not null default false;

comment on column public.projects.sisma is
  'Lavoro di ricostruzione post-sisma: le fatture riportano l''IBAN del conto dedicato.';

-- Le commesse sisma si cercano spesso in blocco per la rendicontazione
create index if not exists idx_projects_sisma on public.projects (sisma) where sisma;

-- -----------------------------------------------------------------------------
-- Vista di comodo: quanto e' stato fatturato sul conto dedicato
-- security_invoker = true come le altre viste: l'RLS di chi interroga resta valida.
-- -----------------------------------------------------------------------------
create or replace view public.v_fatturato_sisma
with (security_invoker = true) as
select
  p.id                                        as project_id,
  p.name                                      as commessa,
  p.client                                    as committente,
  p.amount                                    as importo_commessa,
  count(f.id) filter (where f.stato in ('emessa','incassata'))  as fatture_emesse,
  count(f.id) filter (where f.stato = 'incassata')              as fatture_incassate,
  -- Stessa espressione di v_fatturato_commessa: lo scaglione puo' essere un
  -- imponibile fisso oppure una percentuale dell'importo di commessa.
  coalesce(sum(coalesce(f.imponibile, round(p.amount * f.percentuale / 100, 2)))
           filter (where f.stato in ('emessa','incassata')), 0) as fatturato,
  coalesce(sum(f.importo_incassato) filter (where f.stato = 'incassata'), 0) as incassato,
  coalesce(sum(coalesce(f.imponibile, round(p.amount * f.percentuale / 100, 2)))
           filter (where f.stato in ('da_emettere','pronta')), 0) as da_fatturare
from public.projects p
left join public.commessa_fatture f on f.project_id = p.id and f.stato <> 'annullata'
where p.sisma
group by p.id, p.name, p.client, p.amount;

-- =============================================================================
-- FINE MIGRAZIONE 010
-- =============================================================================
