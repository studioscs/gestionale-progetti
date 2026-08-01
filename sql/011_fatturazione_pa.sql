-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 011
-- Fatturazione verso la Pubblica Amministrazione
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- Una fattura verso una stazione appaltante non e' una fattura normale con un
-- destinatario diverso: cambia il formato di trasmissione (FPA12 invece di
-- FPR12), il codice destinatario e' il Codice Univoco Ufficio di sei caratteri
-- dell'IndicePA invece del codice SDI di sette, l'IVA di norma non la incassa
-- chi emette (scissione dei pagamenti) e CIG e CUP devono comparire nel
-- documento, altrimenti la fattura viene scartata dallo SdI o l'ente non la
-- puo' pagare.
--
-- Tutto questo dipende da dati che si conoscono una volta sola, all'affidamento
-- dell'incarico. Vanno percio' registrati sulla commessa e sull'anagrafica, non
-- ricordati al momento di emettere.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. REGISTRO DEGLI UFFICI DESTINATARI (IndicePA)
-- Il Codice Univoco Ufficio identifica l'ufficio dell'ente che riceve la
-- fattura, non l'ente: lo stesso comune ha spesso piu' uffici con codici
-- diversi. Registrandolo una volta, alla commessa successiva per lo stesso
-- ente basta digitare il codice e i dati si ricompilano da soli.
-- -----------------------------------------------------------------------------
create table if not exists public.enti_pa (
  id                  uuid primary key default gen_random_uuid(),

  codice_univoco      text not null,        -- 6 caratteri IndicePA (es. UFY9MB)
  denominazione       text not null,        -- l'ente (es. Comune di Recanati)
  ufficio             text,                 -- l'unita' organizzativa destinataria

  cf                  text,
  piva                text,
  indirizzo           text,
  cap                 text,
  comune              text,
  provincia           text,
  pec                 text,

  -- Di norma la PA e' in scissione dei pagamenti, ma non sempre: gli enti che
  -- non rientrano nel regime vanno segnati, altrimenti la fattura espone
  -- un'IVA che l'ente non versera' per conto nostro.
  split_payment       boolean not null default true,

  note                text,
  attivo              boolean not null default true,

  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint codice_univoco_formato check (codice_univoco ~ '^[A-Z0-9]{6}$')
);

create unique index if not exists uq_enti_pa_codice on public.enti_pa (codice_univoco);
create index if not exists idx_enti_pa_nome on public.enti_pa (lower(denominazione));

drop trigger if exists trg_touch_enti_pa on public.enti_pa;
create trigger trg_touch_enti_pa before update on public.enti_pa
  for each row execute function public.touch_updated_at();

alter table public.enti_pa enable row level security;

drop policy if exists "read_all_enti_pa"     on public.enti_pa;
drop policy if exists "insert_staff_enti_pa" on public.enti_pa;
drop policy if exists "update_staff_enti_pa" on public.enti_pa;
drop policy if exists "delete_admin_enti_pa" on public.enti_pa;

create policy "read_all_enti_pa"     on public.enti_pa for select to authenticated using (true);
create policy "insert_staff_enti_pa" on public.enti_pa for insert to authenticated with check (public.is_staff());
create policy "update_staff_enti_pa" on public.enti_pa for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "delete_admin_enti_pa" on public.enti_pa for delete to authenticated using (public.is_admin());

-- -----------------------------------------------------------------------------
-- 2. LA COMMESSA SA SE E' PUBBLICA
-- -----------------------------------------------------------------------------
alter table public.projects add column if not exists ente_pubblico    boolean not null default false;
alter table public.projects add column if not exists codice_ufficio   text;
alter table public.projects add column if not exists split_payment    boolean not null default false;

-- CUP separato dal CIG. Erano un campo solo: identificano cose diverse (il CIG
-- la procedura di affidamento, il CUP il progetto di investimento pubblico) e
-- in fattura vanno in due elementi distinti.
-- Il CIG e' una colonna preesistente, non creata dalle migrazioni: la si dichiara
-- qui perche' i blocchi seguenti la usano e questo script deve reggersi da solo.
alter table public.projects add column if not exists cig              text;
alter table public.projects add column if not exists cup              text;

-- Estremi dell'atto di affidamento: in fattura il blocco che porta CIG e CUP
-- richiede obbligatoriamente il riferimento al documento (determina, contratto,
-- ordine). Senza, il blocco non e' valido e i codici non si possono trasmettere.
alter table public.projects add column if not exists rif_incarico     text;
alter table public.projects add column if not exists rif_incarico_data date;
alter table public.projects add column if not exists rif_incarico_tipo text
  check (rif_incarico_tipo is null or rif_incarico_tipo in ('ordine','contratto','convenzione'));

-- Dicitura completa del servizio, da copiare dal disciplinare d'incarico: e'
-- quella che l'ente si aspetta di rileggere identica nell'oggetto della fattura
-- per poterla liquidare senza chiedere chiarimenti.
alter table public.projects add column if not exists oggetto_servizio text;

comment on column public.projects.cig is
  'Codice Identificativo Gara (10 caratteri). Fino alla migrazione 011 questo campo ospitava CIG e CUP insieme.';
comment on column public.projects.cup is
  'Codice Unico di Progetto (15 caratteri).';
comment on column public.projects.oggetto_servizio is
  'Dicitura del servizio come riportata nell''atto di affidamento: finisce nell''oggetto della fattura.';

create index if not exists idx_projects_pa on public.projects (codice_ufficio)
  where codice_ufficio is not null;

-- -----------------------------------------------------------------------------
-- 3. GLI STESSI DATI NELL'ANAGRAFICA CLIENTI
-- -----------------------------------------------------------------------------
alter table public.clienti add column if not exists ente_pubblico  boolean not null default false;
alter table public.clienti add column if not exists codice_ufficio text;
alter table public.clienti add column if not exists split_payment  boolean not null default true;
alter table public.clienti add column if not exists ente_pa_id     uuid;

do $$
begin
  if not exists (select 1 from information_schema.table_constraints
                 where constraint_name = 'clienti_ente_pa_id_fkey' and table_name = 'clienti') then
    alter table public.clienti
      add constraint clienti_ente_pa_id_fkey
      foreign key (ente_pa_id) references public.enti_pa(id) on delete set null;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. SEPARAZIONE AUTOMATICA DI CIG E CUP GIA' INSERITI INSIEME
--
-- Prudente per costruzione: interviene solo quando la stringa contiene ESATTAMENTE
-- due gruppi alfanumerici, uno di 10 caratteri (lunghezza del CIG) e uno di 15
-- (lunghezza del CUP). In ogni altro caso non tocca nulla e il campo resta com'e',
-- da sistemare a mano: meglio un dato da correggere che un dato spostato male.
-- -----------------------------------------------------------------------------
do $$
declare r record; tok text[]; a text; b text; separati integer := 0;
begin
  for r in select id, cig from public.projects
            where cig is not null and cup is null and length(trim(cig)) > 10
  loop
    tok := regexp_split_to_array(upper(regexp_replace(trim(r.cig), '[^A-Z0-9]+', ' ', 'gi')), '\s+');
    tok := array_remove(tok, '');
    if array_length(tok, 1) = 2 then
      a := tok[1]; b := tok[2];
      if length(a) = 10 and length(b) = 15 then
        update public.projects set cig = a, cup = b where id = r.id;
        separati := separati + 1;
      elsif length(a) = 15 and length(b) = 10 then
        update public.projects set cig = b, cup = a where id = r.id;
        separati := separati + 1;
      end if;
    end if;
  end loop;
  if separati > 0 then
    raise notice 'CIG e CUP separati automaticamente in % commesse.', separati;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. CONTROLLO: COMMESSE PUBBLICHE A CUI MANCA QUALCOSA PER FATTURARE
-- security_invoker = true come le altre viste.
-- -----------------------------------------------------------------------------
create or replace view public.v_pa_incompleta
with (security_invoker = true) as
select
  p.id as project_id,
  p.name,
  p.client,
  array_remove(array[
    case when coalesce(p.codice_ufficio,'') !~ '^[A-Z0-9]{6}$' then 'codice univoco ufficio' end,
    case when coalesce(p.cig,'') = ''              then 'CIG' end,
    case when coalesce(p.rif_incarico,'') = ''     then 'estremi dell''atto di affidamento' end,
    case when coalesce(p.oggetto_servizio,'') = '' then 'oggetto del servizio' end
  ], null) as mancanti
from public.projects p
where p.ente_pubblico
  and p.archiviato = false;

-- =============================================================================
-- FINE MIGRAZIONE 011
-- =============================================================================
