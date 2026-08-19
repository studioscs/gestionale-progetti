-- =============================================================================
-- SCS Gestionale Progetti - Verifica della visibilita' delle commesse
-- =============================================================================
-- NON ESEGUIRE SUL DATABASE DI PRODUZIONE: crea utenti e commesse di prova.
--
-- Serve a dimostrare, e non ad affermare, che la migrazione 018 fa quello che
-- dice. Va eseguito su un database di prova costruito con 000_baseline_test.sql
-- e tutte le migrazioni in ordine:
--
--   createdb scstest
--   for f in sql/0*.sql sql/01*.sql; do psql -d scstest -f "$f"; done
--   psql -d scstest -f sql/998_verifica_visibilita.sql
--
-- Su Supabase la stessa verifica si fa senza questo file: si entra con due
-- utenti diversi e si guarda l'elenco delle commesse.
--
-- CHE COSA DEVE RISULTARE
--   admin          → vede tutte le commesse, tutte le attivita', tutte le fatture
--   collaboratore  → vede SOLO la commessa a cui e' agganciato, ma per INTERO:
--                    anche le attivita' di quella commessa che non sono sue
--   collaboratore  → sulla commessa altrui: zero righe in lettura, zero righe
--                    modificate in scrittura
--   vede_tutto     → torna a vedere tutto senza essere amministratore
-- =============================================================================

-- In Supabase i permessi di tabella ci sono gia'; su un database nudo no.
grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public, auth to authenticated;

-- -----------------------------------------------------------------------------
-- Dati di prova
-- -----------------------------------------------------------------------------
insert into auth.users(id,email) values
 ('11111111-1111-1111-1111-111111111111','admin@prova.it'),
 ('22222222-2222-2222-2222-222222222222','collab@prova.it'),
 ('33333333-3333-3333-3333-333333333333','ammin@prova.it')
on conflict do nothing;

insert into public.profiles(id,full_name,role,email,attivo) values
 ('11111111-1111-1111-1111-111111111111','Admin di prova','admin','admin@prova.it',true),
 ('22222222-2222-2222-2222-222222222222','Collaboratore di prova','collaboratore','collab@prova.it',true),
 ('33333333-3333-3333-3333-333333333333','Amministrazione di prova','collaboratore','ammin@prova.it',true)
on conflict (id) do update set role = excluded.role, attivo = true;

insert into public.clienti(id,denominazione,piva) values
 ('aaaaaaaa-0000-0000-0000-000000000001','Cliente della commessa sua','01111111111'),
 ('aaaaaaaa-0000-0000-0000-000000000002','Cliente della commessa altrui','02222222222')
on conflict do nothing;

insert into public.projects(id,name,status,amount,cliente_id,created_by) values
 ('cccccccc-0000-0000-0000-000000000001','PROVA commessa sua','attivo',50000,
  'aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111'),
 ('cccccccc-0000-0000-0000-000000000002','PROVA commessa altrui','attivo',90000,
  'aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111')
on conflict do nothing;

insert into public.commessa_fasi(id,project_id,fase_key,nome,ordine) values
 ('ffffffff-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','pv1','Fase della sua',0),
 ('ffffffff-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000002','pv1','Fase dell''altrui',0)
on conflict do nothing;

-- Una sola attivita' assegnata al collaboratore, sulla prima commessa.
insert into public.tasks(id,project_id,commessa_fase_id,title,status,assignee_id) values
 ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',
  'ffffffff-0000-0000-0000-000000000001','PROVA sua attivita','da_fare','22222222-2222-2222-2222-222222222222'),
 ('dddddddd-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000001',
  'ffffffff-0000-0000-0000-000000000001','PROVA attivita di altri sulla stessa commessa','da_fare',null),
 ('dddddddd-0000-0000-0000-000000000003','cccccccc-0000-0000-0000-000000000002',
  'ffffffff-0000-0000-0000-000000000002','PROVA attivita della commessa altrui','da_fare',null)
on conflict do nothing;

insert into public.commessa_fatture(id,project_id,descrizione,imponibile,stato,ordine) values
 ('eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','PROVA acconto sua',10000,'da_emettere',1),
 ('eeeeeeee-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000002','PROVA acconto altrui',20000,'da_emettere',1)
on conflict do nothing;

update public.profiles set vede_tutto = false
 where id in ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333');

-- -----------------------------------------------------------------------------
\echo ''
\echo '=== 1. AMMINISTRATORE: deve vedere tutto ==='
set role authenticated;
set "test.uid" = '11111111-1111-1111-1111-111111111111';
select 'commesse di prova' as cosa, count(*) as viste from public.projects where name like 'PROVA%'
union all select 'attivita di prova', count(*) from public.tasks where title like 'PROVA%'
union all select 'fatture di prova',  count(*) from public.commessa_fatture where descrizione like 'PROVA%';
reset role;

\echo ''
\echo '=== 2. COLLABORATORE agganciato a UNA SOLA attivita ==='
set role authenticated;
set "test.uid" = '22222222-2222-2222-2222-222222222222';
\echo '-- vede una sola commessa, ma per intero: due attivita, non una'
select 'commesse di prova' as cosa, count(*) as viste from public.projects where name like 'PROVA%'
union all select 'attivita di prova', count(*) from public.tasks where title like 'PROVA%'
union all select 'fatture di prova',  count(*) from public.commessa_fatture where descrizione like 'PROVA%';
select name from public.projects where name like 'PROVA%' order by name;
select title from public.tasks where title like 'PROVA%' order by title;

\echo '-- la commessa altrui non esiste, per lui: deve dare 0'
select count(*) as righe_commessa_altrui from public.projects
 where id = 'cccccccc-0000-0000-0000-000000000002';
select public.vede_commessa('cccccccc-0000-0000-0000-000000000002') as vede_commessa_altrui;

\echo '-- e non la puo modificare: UPDATE 0'
update public.projects set amount = 1 where id = 'cccccccc-0000-0000-0000-000000000002';
reset role;

\echo '-- controprova: l importo e ancora quello di prima'
select name, amount from public.projects where id = 'cccccccc-0000-0000-0000-000000000002';

\echo ''
\echo '=== 3. AMMINISTRAZIONE con "vede tutte le commesse" ==='
update public.profiles set vede_tutto = true where id = '33333333-3333-3333-3333-333333333333';
set role authenticated;
set "test.uid" = '33333333-3333-3333-3333-333333333333';
select 'commesse di prova' as cosa, count(*) as viste from public.projects where name like 'PROVA%'
union all select 'fatture di prova', count(*) from public.commessa_fatture where descrizione like 'PROVA%';
reset role;

\echo ''
\echo '=== 4. PULIZIA dei dati di prova ==='
delete from public.commessa_fatture where descrizione like 'PROVA%';
delete from public.tasks where title like 'PROVA%';
delete from public.commessa_fasi where fase_key = 'pv1';
delete from public.projects where name like 'PROVA%';
delete from public.clienti where denominazione like 'Cliente della commessa%';
delete from public.profiles where email like '%@prova.it';
delete from auth.users where email like '%@prova.it';
\echo 'fatto.'

-- =============================================================================
-- FINE VERIFICA
-- =============================================================================
