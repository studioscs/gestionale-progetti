-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 007
-- Secondo referente della commessa (operativo / tecnico)
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- Le commesse hanno quasi sempre due interlocutori diversi:
--   - il referente AMMINISTRATIVO, a cui va la copia della fattura;
--   - il referente OPERATIVO, con cui si parla di sopralluoghi, misure,
--     scelte tecniche e cantiere.
-- Tenerli separati evita di mandare la fattura al capocantiere e i dettagli
-- di cantiere all'ufficio contabilita'.
--
-- I campi referente / referente_email / referente_tel gia' esistenti diventano
-- quelli del referente amministrativo: nessun dato va perso o spostato.
-- =============================================================================

alter table public.projects add column if not exists referente_ruolo      text;
alter table public.projects add column if not exists referente_tec        text;
alter table public.projects add column if not exists referente_tec_email  text;
alter table public.projects add column if not exists referente_tec_tel    text;
alter table public.projects add column if not exists referente_tec_ruolo  text;

comment on column public.projects.referente       is 'Referente amministrativo: destinatario della copia della fattura.';
comment on column public.projects.referente_tec   is 'Referente operativo: destinatario delle comunicazioni tecniche e di cantiere.';

-- Ricerca per nominativo del referente (utile quando si cerca "chi mi ha
-- chiamato" senza ricordare la commessa)
create index if not exists idx_projects_referenti
  on public.projects (lower(coalesce(referente,'')), lower(coalesce(referente_tec,'')));

-- -----------------------------------------------------------------------------
-- Vista di comodo: rubrica dei contatti di commessa
-- -----------------------------------------------------------------------------
create or replace view public.v_contatti_commessa as
select p.id as project_id, p.name as commessa, p.client as committente,
       'amministrativo'::text as tipo,
       p.referente as nominativo, p.referente_ruolo as ruolo,
       p.referente_email as email, p.referente_tel as telefono
  from public.projects p
 where coalesce(p.referente, p.referente_email, p.referente_tel) is not null
union all
select p.id, p.name, p.client,
       'operativo'::text,
       p.referente_tec, p.referente_tec_ruolo,
       p.referente_tec_email, p.referente_tec_tel
  from public.projects p
 where coalesce(p.referente_tec, p.referente_tec_email, p.referente_tec_tel) is not null;

-- =============================================================================
-- FINE MIGRAZIONE 007
-- =============================================================================
