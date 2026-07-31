-- =============================================================================
-- VERIFICA DELLA MIGRAZIONE (facoltativa)
-- =============================================================================
-- Esegue una batteria di controlli sui trigger, sull'upsert idempotente,
-- sul cascade e sulla vista di avanzamento. Crea una commessa di prova
-- "Villa Test" con id 44444444-...: eliminala quando hai finito.
--
--   delete from public.projects where id = '44444444-4444-4444-4444-444444444444';
--
-- Su Supabase la funzione auth.uid() esiste gia': salta la riga "set test.uid"
-- e sostituiscila con l'utente loggato, oppure lancialo dal SQL Editor.
-- =============================================================================

\echo '--- 1. INSERT attività (regressione: OLD non assegnato in BEFORE INSERT) ---'
insert into public.projects(id,name,status,start_date) values ('44444444-4444-4444-4444-444444444444','Villa Test','attivo','2026-01-07');
insert into public.commessa_fasi(project_id,fase_key,nome,ordine,data_inizio,data_fine_prevista)
values ('44444444-4444-4444-4444-444444444444','avvio','1. Avvio',0,'2026-01-07','2026-01-21');
insert into public.tasks(title,project_id,commessa_fase_id,status,due_date)
select 'Att '||g, '44444444-4444-4444-4444-444444444444',
       (select id from commessa_fasi where fase_key='avvio'), 'da_fare', '2026-01-15'
from generate_series(1,5) g;
select count(*) as attivita_inserite from tasks where project_id='44444444-4444-4444-4444-444444444444';

\echo '--- 2. INSERT direttamente completato ---'
insert into public.tasks(title,project_id,status) values ('Gia chiusa','44444444-4444-4444-4444-444444444444','completato');
select title, completed_at is not null as ha_timestamp, completed_by is not null as ha_autore
from tasks where title='Gia chiusa';

\echo '--- 3. UPDATE a completato e riapertura ---'
update tasks set status='completato' where title='Att 1';
select title, completed_at is not null as chiusa, completed_by=auth.uid() as autore_corretto from tasks where title='Att 1';
update tasks set status='da_fare' where title='Att 1';
select title, completed_at is null as azzerata, completed_by is null as autore_azzerato from tasks where title='Att 1';

\echo '--- 4. updated_at si muove ---'
select updated_at > created_at as touch_ok from tasks where title='Att 1';

\echo '--- 5. scadenza pratica calcolata dal termine di legge ---'
insert into public.commessa_pratiche(project_id,ente,tipo,data_invio,termine_giorni)
values ('44444444-4444-4444-4444-444444444444','Soprintendenza','Aut. paesaggistica','2026-03-02',45);
select data_invio, termine_giorni, data_scadenza,
       data_scadenza = date '2026-04-16' as calcolo_corretto,
       pg_typeof(data_scadenza)::text as tipo
from commessa_pratiche;

\echo '--- 6. upsert idempotente sulle fasi (rigenerazione) ---'
insert into public.commessa_fasi(project_id,fase_key,nome,ordine) values
  ('44444444-4444-4444-4444-444444444444','avvio','1. Avvio DUPLICATO',0),
  ('44444444-4444-4444-4444-444444444444','preliminare','2. Preliminare',1)
on conflict (project_id,fase_key) do nothing;
select fase_key, nome from commessa_fasi where project_id='44444444-4444-4444-4444-444444444444' order by ordine;

\echo '--- 7. cascade: eliminando la fase spariscono le sue attività ---'
select count(*) as prima from tasks where commessa_fase_id=(select id from commessa_fasi where fase_key='avvio');
delete from commessa_fasi where fase_key='avvio';
select count(*) as dopo_eliminazione_fase from tasks where project_id='44444444-4444-4444-4444-444444444444';

\echo '--- 8. vista di avanzamento ---'
insert into public.tasks(title,project_id,status,opzionale) values
 ('A','44444444-4444-4444-4444-444444444444','completato',false),
 ('B','44444444-4444-4444-4444-444444444444','da_fare',false),
 ('C','44444444-4444-4444-4444-444444444444','da_fare',true);
select attivita_totali, attivita_chiuse, avanzamento_pct
from v_avanzamento_commesse where project_id='44444444-4444-4444-4444-444444444444';

\echo '--- 9. helper di ruolo ---'
select is_admin() as admin_ok, is_staff() as staff_ok;
set test.uid = '22222222-2222-2222-2222-222222222222';
select is_admin() as collab_non_admin, is_staff() as collab_e_staff;

\echo '--- 10. tabelle legacy intatte ---'
select count(*) as progetti_legacy from project_fasi;
select column_name from information_schema.columns where table_name='project_sottofasi' and column_name='disciplina';
