-- =============================================================================
-- SCHEMA DI BASE PER I TEST LOCALI (NON eseguire su Supabase)
-- =============================================================================
-- Ricrea in un PostgreSQL vuoto le tabelle che il gestionale gia' si aspetta,
-- cosi' da poter provare la migrazione senza toccare il database di produzione:
--
--   initdb -D /tmp/pg && pg_ctl -D /tmp/pg -o "-p 5433" start
--   psql -p 5433 -f sql/000_baseline_test.sql
--   psql -p 5433 -f sql/001_gestionale_v2.sql
--   psql -p 5433 -f sql/999_verifica.sql
-- =============================================================================

create extension if not exists pgcrypto;
create role authenticated;
create role anon;
create schema if not exists auth;
create table auth.users(id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select current_setting('test.uid', true)::uuid $$;

create table public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, role text default 'viewer', created_at timestamptz default now());

create table public.projects(
  id uuid primary key default gen_random_uuid(), name text not null, client text,
  status text default 'attivo', owner_id uuid references public.profiles(id),
  start_date date, end_date date, amount numeric, cig text, description text,
  created_by uuid, created_at timestamptz default now());

create table public.tasks(
  id uuid primary key default gen_random_uuid(), title text not null,
  project_id uuid references public.projects(id) on delete cascade,
  assignee_id uuid references public.profiles(id), responsabile_id uuid references public.profiles(id),
  status text default 'da_fare' check (status in ('da_fare','in_corso','revisione','completato')),
  priority text default 'media', due_date date, estimated_hours numeric, notes text,
  fase_id uuid, sottofase_id uuid, created_by uuid, created_at timestamptz default now());

create table public.time_entries(
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  operator_id uuid references public.profiles(id), description text,
  entry_date date not null, hours numeric not null, created_at timestamptz default now());

create table public.files(
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  name text, storage_path text, size_bytes bigint, mime_type text,
  uploaded_by uuid references public.profiles(id), created_at timestamptz default now());

-- tabelle legacy che la migrazione NON deve toccare
create table public.project_fasi(
  id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id) on delete cascade,
  fase text check (fase in ('preliminare','definitivo','esecutivo')), stato text default 'non_avviata',
  data_inizio date, data_fine_prevista date, data_completamento date, note text);
create table public.project_sottofasi(
  id uuid primary key default gen_random_uuid(), fase_id uuid references public.project_fasi(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade, disciplina text,
  attiva boolean default true, stato text default 'non_avviata', responsabile_id uuid references public.profiles(id),
  data_inizio date, data_fine_prevista date, data_completamento date, note text, notifica_inviata boolean default false);

-- dati di partenza
insert into auth.users(id,email) values
 ('11111111-1111-1111-1111-111111111111','admin@scs.it'),
 ('22222222-2222-2222-2222-222222222222','collab@scs.it');
insert into public.profiles(id,full_name,role) values
 ('11111111-1111-1111-1111-111111111111','Mario Rossi','admin'),
 ('22222222-2222-2222-2222-222222222222','Anna Verdi','collaboratore');
insert into public.projects(id,name,status) values ('33333333-3333-3333-3333-333333333333','Commessa legacy','attivo');
insert into public.tasks(title,project_id,status) values ('Task preesistente','33333333-3333-3333-3333-333333333333','in_corso');
