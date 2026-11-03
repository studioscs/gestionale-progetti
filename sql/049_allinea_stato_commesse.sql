-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 049
-- Allineamento una tantum: commesse e fasi gia' incoerenti prima della 048
-- =============================================================================
-- Da eseguire DOPO la 048 (che mette le regole), una volta sola; rieseguirla
-- non fa danni (non trova piu' niente da allineare).
--
-- In produzione, il 03/11/2026:
--   - 8 commesse con tutte le fasi completate ma non «completato»
--     (2024_21, 2025_27, 2026_10, 2026_12, 2026_13, 2026_21, 2026_24, 2026_32)
--     → diventano «completato»;
--   - 6 commesse «completato» con fasi ancora aperte
--     (2026_01, 2026_02, 2026_03, 2026_04, 2026_15, 2026_XX)
--     → le fasi aperte diventano completate con la data di oggi; come per ogni
--     fase chiusa, gli scaglioni agganciati diventano richieste (045).
-- Le attivita' non si toccano.
-- =============================================================================

-- 1. tutte le fasi completate → commessa completata
update public.projects p set status = 'completato'
 where p.status is distinct from 'completato'
   and exists (select 1 from public.commessa_fasi f where f.project_id = p.id and f.stato = 'completata')
   and not exists (select 1 from public.commessa_fasi f
                    where f.project_id = p.id and f.stato not in ('completata', 'non_applicabile'));

-- 2. commessa completata → fasi aperte completate
update public.commessa_fasi f
   set stato = 'completata', data_completamento = coalesce(f.data_completamento, current_date)
  from public.projects p
 where p.id = f.project_id and p.status = 'completato'
   and f.stato not in ('completata', 'non_applicabile');

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: deve dire 0 e 0.
-- -----------------------------------------------------------------------------
select 'fasi tutte completate, commessa non completata' as cosa,
       (select count(*) from public.projects p
         where p.status is distinct from 'completato'
           and exists (select 1 from public.commessa_fasi f where f.project_id = p.id and f.stato = 'completata')
           and not exists (select 1 from public.commessa_fasi f
                            where f.project_id = p.id and f.stato not in ('completata', 'non_applicabile')))::text as esito
union all
select 'commessa completata, fasi aperte',
       (select count(*) from public.projects p
         where p.status = 'completato'
           and exists (select 1 from public.commessa_fasi f
                        where f.project_id = p.id and f.stato not in ('completata', 'non_applicabile')))::text;

-- =============================================================================
-- FINE MIGRAZIONE 049
-- =============================================================================
