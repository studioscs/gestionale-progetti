-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 004
-- Categoria delle attivita': firme del cliente e operazioni su piattaforma
-- =============================================================================
-- Da eseguire DOPO le migrazioni 001 e 002. Idempotente e solo additivo.
--
-- Perche' serve: la procura speciale per la presentazione telematica vale per
-- UNA SOLA pratica (art. 1392 c.c.), va firmata a mano dal cliente e corredata
-- di copia del documento d'identita'. Se si aspetta la fine per raccoglierle,
-- il cliente deve tornare in studio tante volte quante sono le pratiche.
-- Marcare le attivita' che richiedono la sua firma permette di raggrupparle e
-- farle firmare tutte in un'unica seduta.
-- =============================================================================

alter table public.tasks add column if not exists categoria text;

comment on column public.tasks.categoria is
  'firma_cliente = documento che il cliente deve firmare di persona. piattaforma = operazione da svolgere sul portale telematico. prereq_parere = documentazione che deve essere pronta prima di poter chiedere un parere. NULL = attivita ordinaria.';

-- Le attivita' in attesa di firma si interrogano per commessa e per stato
create index if not exists idx_tasks_categoria on public.tasks(categoria, project_id)
  where categoria is not null;

create index if not exists idx_tasks_firme_aperte on public.tasks(project_id)
  where categoria = 'firma_cliente' and status <> 'completato';

-- -----------------------------------------------------------------------------
-- Vista: quante firme mancano per commessa (per il cruscotto "Firme cliente")
-- -----------------------------------------------------------------------------
create or replace view public.v_firme_cliente as
select
  t.project_id,
  p.name                                                as commessa,
  p.referente,
  count(*)                                              as firme_totali,
  count(*) filter (where t.status <> 'completato')      as firme_mancanti,
  min(t.due_date) filter (where t.status <> 'completato') as prima_scadenza
from public.tasks t
join public.projects p on p.id = t.project_id
where t.categoria = 'firma_cliente'
group by t.project_id, p.name, p.referente;

-- =============================================================================
-- FINE MIGRAZIONE 004
-- =============================================================================
