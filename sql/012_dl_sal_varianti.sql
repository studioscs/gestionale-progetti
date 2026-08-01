-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 012
-- Direzione lavori: SAL, varianti e fatturazione della DL a quota di SAL
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA CHE RISOLVE
-- Il compenso per direzione lavori e coordinamento sicurezza non matura a fasi
-- come la progettazione: matura con l'avanzamento del cantiere. Se la DL emette
-- il SAL n. 2 che porta i lavori contabilizzati al 55%, allo studio spetta il
-- 55% del compenso di DL, meno quanto gia' fatturato.
--
-- Farlo a mano vuol dire ricalcolare ogni volta la differenza e ricordarsi di
-- emettere: e' il punto in cui si perdono soldi, perche' un SAL non fatturato
-- non se lo ricorda nessuno. Qui il calcolo lo fa il database quando il SAL
-- viene registrato.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. IMPORTI DI RIFERIMENTO SULLA COMMESSA
-- Due grandezze diverse che non vanno confuse:
--   importo_lavori  = l'appalto dell'impresa, la base su cui si calcola il SAL
--   compenso_dl     = la quota del NOSTRO onorario che riguarda DL e CSE
-- -----------------------------------------------------------------------------
alter table public.projects add column if not exists importo_lavori numeric(14,2);
alter table public.projects add column if not exists compenso_dl    numeric(14,2);

comment on column public.projects.importo_lavori is
  'Importo contrattuale dei lavori affidati all''impresa: base di calcolo della percentuale dei SAL.';
comment on column public.projects.compenso_dl is
  'Quota di onorario per direzione lavori e CSE: matura in proporzione ai SAL emessi.';

-- -----------------------------------------------------------------------------
-- 2. STATI DI AVANZAMENTO LAVORI
-- L'importo e' PROGRESSIVO, come lo e' il SAL: e' il totale contabilizzato dal
-- principio, non quello del singolo periodo. Registrarlo cosi' evita l'errore
-- piu' comune, cioe' sommare due volte lo stesso lavoro.
-- -----------------------------------------------------------------------------
create table if not exists public.commessa_sal (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,

  numero              integer not null,
  data_emissione      date,
  importo_progressivo numeric(14,2) not null default 0,   -- lavori contabilizzati dall'inizio
  percentuale         numeric(5,2),                       -- calcolata, o forzata a mano
  ritenuta_garanzia   numeric(14,2),                      -- 0,50% ex art. 125 c.5

  -- Certificato di pagamento emesso dal RUP a valle del SAL
  data_certificato    date,
  importo_certificato numeric(14,2),

  stato               text not null default 'redatto'
                      check (stato in ('redatto','trasmesso','certificato','pagato','annullato')),
  note                text,

  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists uq_sal_numero on public.commessa_sal(project_id, numero);
create index if not exists idx_sal_project on public.commessa_sal(project_id, numero);

drop trigger if exists trg_touch_sal on public.commessa_sal;
create trigger trg_touch_sal before update on public.commessa_sal
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 3. VARIANTI IN CORSO D'OPERA
-- -----------------------------------------------------------------------------
create table if not exists public.commessa_varianti (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,

  numero              integer not null,
  descrizione         text not null,
  motivo              text,          -- riferimento all'art. 120 D.Lgs 36/2023
  importo             numeric(14,2), -- maggiore (o minore) spesa sui lavori
  incidenza           numeric(5,2),  -- % sull'importo contrattuale

  data_redazione      date,
  data_trasmissione   date,
  data_approvazione   date,

  stato               text not null default 'in_redazione'
                      check (stato in ('in_redazione','trasmessa','approvata','respinta','ritirata')),

  -- Approvata la variante, l'importo dei lavori cambia e con esso la base dei
  -- SAL successivi: il ricalcolo va fatto, non dimenticato.
  aggiorna_importo    boolean not null default true,
  note                text,

  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists uq_variante_numero on public.commessa_varianti(project_id, numero);
create index if not exists idx_varianti_project on public.commessa_varianti(project_id, numero);

drop trigger if exists trg_touch_varianti on public.commessa_varianti;
create trigger trg_touch_varianti before update on public.commessa_varianti
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 4. RLS: stesso modello delle altre tabelle di commessa
-- -----------------------------------------------------------------------------
alter table public.commessa_sal      enable row level security;
alter table public.commessa_varianti enable row level security;

do $$
declare t text;
begin
  foreach t in array array['commessa_sal','commessa_varianti'] loop
    execute format('drop policy if exists "read_all_%1$s"    on public.%1$I', t);
    execute format('drop policy if exists "insert_staff_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "update_staff_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "delete_admin_%1$s" on public.%1$I', t);

    execute format('create policy "read_all_%1$s" on public.%1$I for select to authenticated using (true)', t);
    execute format('create policy "insert_staff_%1$s" on public.%1$I for insert to authenticated with check (public.is_staff())', t);
    execute format('create policy "update_staff_%1$s" on public.%1$I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t);
    execute format('create policy "delete_admin_%1$s" on public.%1$I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 5. LA PERCENTUALE DEL SAL SI CALCOLA DA SOLA
-- Se non viene forzata a mano, deriva dall'importo contrattuale dei lavori.
-- -----------------------------------------------------------------------------
create or replace function public.calcola_perc_sal()
returns trigger language plpgsql security definer set search_path = public as $$
declare base numeric;
begin
  if new.percentuale is null then
    select importo_lavori into base from public.projects where id = new.project_id;
    if base is not null and base > 0 then
      new.percentuale := least(100, round(new.importo_progressivo / base * 100, 2));
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_perc_sal on public.commessa_sal;
create trigger trg_perc_sal before insert or update of importo_progressivo, percentuale
  on public.commessa_sal
  for each row execute function public.calcola_perc_sal();

-- -----------------------------------------------------------------------------
-- 6. IL SAL FA MATURARE LA QUOTA DI DL DA FATTURARE
--
-- Alla registrazione di un SAL nasce (o si aggiorna) uno scaglione di
-- fatturazione pari alla quota di compenso maturata a quella percentuale, meno
-- quanto gia' agganciato ai SAL precedenti. Lo scaglione nasce gia' "pronto":
-- il SAL e' il fatto che rende esigibile il compenso.
--
-- Se la differenza non e' positiva - percentuale corretta al ribasso, SAL
-- rettificato - non si crea nulla: una fattura in negativo non si emette, si
-- fa una nota di credito, che e' una decisione di chi amministra e non di un
-- trigger.
-- -----------------------------------------------------------------------------
alter table public.commessa_fatture add column if not exists sal_id uuid;

do $$
begin
  if not exists (select 1 from information_schema.table_constraints
                 where constraint_name = 'commessa_fatture_sal_id_fkey' and table_name = 'commessa_fatture') then
    alter table public.commessa_fatture
      add constraint commessa_fatture_sal_id_fkey
      foreign key (sal_id) references public.commessa_sal(id) on delete set null;
  end if;
end $$;

create index if not exists idx_fatture_sal on public.commessa_fatture(sal_id) where sal_id is not null;

create or replace function public.matura_quota_dl()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  compenso    numeric;
  maturato    numeric;
  gia_agganciato numeric;
  quota       numeric;
  esistente   uuid;
  prossimo    integer;
begin
  select coalesce(p.compenso_dl, 0) into compenso
    from public.projects p where p.id = new.project_id;

  if compenso <= 0 or coalesce(new.percentuale, 0) <= 0 then
    return new;
  end if;

  maturato := round(compenso * new.percentuale / 100, 2);

  -- Quanto e' gia' stato agganciato ai SAL precedenti di questa commessa
  select coalesce(sum(f.imponibile), 0) into gia_agganciato
    from public.commessa_fatture f
    join public.commessa_sal s on s.id = f.sal_id
   where f.project_id = new.project_id
     and f.sal_id is not null
     and f.stato <> 'annullata'
     and s.numero < new.numero;

  quota := round(maturato - gia_agganciato, 2);

  select id into esistente from public.commessa_fatture
   where sal_id = new.id and stato <> 'annullata' limit 1;

  if quota <= 0 then
    -- Nulla da fatturare per questo SAL: se c'era gia' uno scaglione non ancora
    -- emesso lo si azzera, ma non si tocca quello gia' emesso.
    if esistente is not null then
      update public.commessa_fatture
         set imponibile = 0,
             note = 'Quota azzerata: a questa percentuale non matura ulteriore compenso.'
       where id = esistente and stato in ('da_emettere','pronta');
    end if;
    return new;
  end if;

  if esistente is not null then
    update public.commessa_fatture
       set imponibile  = quota,
           descrizione = 'Direzione lavori — quota su SAL n. ' || new.numero
                         || ' (' || trim(to_char(new.percentuale, 'FM990.00')) || '%)',
           data_prevista = coalesce(new.data_emissione, current_date)
     where id = esistente and stato in ('da_emettere','pronta');
    return new;
  end if;

  select coalesce(max(ordine), 0) + 1 into prossimo
    from public.commessa_fatture where project_id = new.project_id;

  insert into public.commessa_fatture(project_id, descrizione, ordine, imponibile,
                                      data_prevista, stato, sal_id)
  values (new.project_id,
          'Direzione lavori — quota su SAL n. ' || new.numero
            || ' (' || trim(to_char(new.percentuale, 'FM990.00')) || '%)',
          prossimo, quota, coalesce(new.data_emissione, current_date), 'pronta', new.id);

  return new;
end; $$;

drop trigger if exists trg_matura_quota_dl on public.commessa_sal;
create trigger trg_matura_quota_dl
  after insert or update of importo_progressivo, percentuale, data_emissione
  on public.commessa_sal
  for each row execute function public.matura_quota_dl();

-- -----------------------------------------------------------------------------
-- 7. LA VARIANTE APPROVATA AGGIORNA L'IMPORTO DEI LAVORI
-- Cambiando la base, i SAL successivi calcolano la percentuale su quella nuova.
--
-- Vale anche in INSERT, non solo in UPDATE: una variante approvata il mese
-- scorso si registra gia' nello stato finale, e con un trigger di solo UPDATE
-- l'importo dei lavori non si sarebbe mosso. Il riferimento a OLD va percio'
-- protetto, perche' in INSERT non esiste.
-- -----------------------------------------------------------------------------
create or replace function public.applica_variante()
returns trigger language plpgsql security definer set search_path = public as $$
declare precedente text;
begin
  precedente := case when tg_op = 'INSERT' then '' else coalesce(old.stato, '') end;

  if new.stato = 'approvata' and precedente <> 'approvata'
     and new.aggiorna_importo and new.importo is not null then
    update public.projects
       set importo_lavori = coalesce(importo_lavori, 0) + new.importo
     where id = new.project_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_applica_variante on public.commessa_varianti;
create trigger trg_applica_variante
  after insert or update of stato on public.commessa_varianti
  for each row execute function public.applica_variante();

-- -----------------------------------------------------------------------------
-- 8. CONTENUTO PRESCRITTO DI CIASCUN ELABORATO
-- Le attivita' generate dai template portano con se' la descrizione di che cosa
-- l'elaborato deve contenere. Sta in una colonna sua e non nelle note, che
-- restano di chi lavora.
-- -----------------------------------------------------------------------------
alter table public.tasks add column if not exists contenuto text;

comment on column public.tasks.contenuto is
  'Che cosa deve contenere l''elaborato, secondo la norma richiamata in rif_normativo. Testo generato dal template, non note dell''utente.';

-- -----------------------------------------------------------------------------
-- 9. VISTE DI RIEPILOGO
-- -----------------------------------------------------------------------------
create or replace view public.v_sal_commessa
with (security_invoker = true) as
select
  s.id                as sal_id,
  s.project_id,
  p.name              as commessa,
  s.numero,
  s.data_emissione,
  s.importo_progressivo,
  s.percentuale,
  s.stato,
  p.importo_lavori,
  p.compenso_dl,
  round(coalesce(p.compenso_dl, 0) * coalesce(s.percentuale, 0) / 100, 2) as compenso_maturato,
  f.id                as fattura_id,
  f.imponibile        as quota_da_fatturare,
  f.stato             as stato_fattura
from public.commessa_sal s
join public.projects p on p.id = s.project_id
left join public.commessa_fatture f on f.sal_id = s.id and f.stato <> 'annullata';

create or replace view public.v_varianti_commessa
with (security_invoker = true) as
select
  v.project_id,
  p.name                       as commessa,
  count(*)                     as varianti,
  count(*) filter (where v.stato = 'approvata')   as approvate,
  count(*) filter (where v.stato = 'in_redazione') as in_redazione,
  coalesce(sum(v.importo) filter (where v.stato = 'approvata'), 0) as maggiore_spesa_approvata
from public.commessa_varianti v
join public.projects p on p.id = v.project_id
group by v.project_id, p.name;

-- =============================================================================
-- FINE MIGRAZIONE 012
-- =============================================================================
