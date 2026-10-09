-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 032
-- Proforma PDF prima della fattura, e i preventivi dello studio
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente e solo additivo.
--
-- 1. LA PROFORMA
-- Al committente privato non si manda subito la fattura elettronica: prima va
-- una proforma in PDF, e la fattura vera (l'XML allo SdI) parte solo quando il
-- pagamento e' arrivato. Lo scaglione ricorda numero e data della proforma
-- inviata: e' quello che si rilegge quando il cliente telefona per dire che ha
-- pagato "la proforma del 12 marzo".
--
-- 2. I PREVENTIVI
-- Prima vivevano in FatturaElettronica APP, cinque bozze copiate e ricopiate a
-- seconda del tipo di lavoro. Qui hanno un elenco loro, un numero progressivo
-- per anno (36/26), il committente preso dall'anagrafica, le voci, gli articoli
-- del contratto e lo stato: bozza, inviato, accettato, rifiutato.
--
-- I modelli (strutture, architettonico, perizie, antincendio, sanatoria) sono
-- scritti nel gestionale; questa tabella tiene le versioni modificate dallo
-- studio. Un modello corretto qui vale per tutti i preventivi che verranno; i
-- preventivi gia' fatti tengono il testo con cui sono stati scritti.
--
-- CHI LI VEDE
-- Chi tiene l'amministrazione (vede_tutte_commesse, migrazione 018): prezzi e
-- dati dei committenti non sono lavoro di commessa.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PROFORMA SULLO SCAGLIONE
-- -----------------------------------------------------------------------------
alter table public.commessa_fatture add column if not exists proforma_numero text;
alter table public.commessa_fatture add column if not exists proforma_data   date;
alter table public.commessa_fatture add column if not exists proforma_at     timestamptz;

comment on column public.commessa_fatture.proforma_numero is
  'Numero della proforma PDF inviata al committente prima della fattura elettronica.';
comment on column public.commessa_fatture.proforma_data is
  'Data della proforma. La fattura XML si genera quando il committente ha pagato.';

-- -----------------------------------------------------------------------------
-- 2. MODELLI DI PREVENTIVO MODIFICATI DALLO STUDIO
-- -----------------------------------------------------------------------------
create table if not exists public.preventivo_modelli (
  id          uuid primary key default gen_random_uuid(),
  chiave      text not null unique,          -- strutture, architettonico, ...
  nome        text not null,
  titolo      text,                          -- "PREVENTIVO TIPO STRUTTURE"
  oggetto     text,                          -- intestazione dell'art. 1
  voci        jsonb not null default '[]'::jsonb,   -- [{descrizione, importo, quantita}]
  articoli    jsonb not null default '[]'::jsonb,   -- [{titolo, testo}]
  note        text,
  ordine      integer not null default 0,
  attivo      boolean not null default true,
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_touch_preventivo_modelli on public.preventivo_modelli;
create trigger trg_touch_preventivo_modelli before update on public.preventivo_modelli
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 3. PREVENTIVI
-- -----------------------------------------------------------------------------
create table if not exists public.preventivi (
  id                uuid primary key default gen_random_uuid(),
  anno              integer not null check (anno between 2000 and 2100),
  progressivo       integer not null check (progressivo > 0),
  data              date not null default current_date,
  modello           text,                    -- chiave del modello di partenza
  titolo            text,
  stato             text not null default 'bozza'
                    check (stato in ('bozza','inviato','accettato','rifiutato')),

  -- Il committente: collegato all'anagrafica quando c'e', e comunque copiato
  -- qui, perche' un preventivo inviato non deve cambiare se cambia l'anagrafica.
  cliente_id        uuid references public.clienti(id) on delete set null,
  cliente_nome      text,
  cliente_indirizzo text,
  cliente_cap       text,
  cliente_comune    text,
  cliente_prov      text,
  cliente_cf        text,
  cliente_piva      text,
  cliente_pec       text,
  cliente_tel       text,

  immobile          text,                    -- "via ... a ..." dell'art. 1
  oggetto           text,
  voci              jsonb not null default '[]'::jsonb,
  articoli          jsonb not null default '[]'::jsonb,
  note              text,
  scadenza          date,                    -- data di pagamento indicata
  project_id        uuid references public.projects(id) on delete set null,

  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Due preventivi con lo stesso numero nello stesso anno non devono esistere.
  constraint uq_preventivo_numero unique (anno, progressivo)
);

create index if not exists idx_preventivi_cliente on public.preventivi(cliente_id);
create index if not exists idx_preventivi_anno    on public.preventivi(anno, progressivo desc);

drop trigger if exists trg_touch_preventivi on public.preventivi;
create trigger trg_touch_preventivi before update on public.preventivi
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 4. RLS: solo chi tiene l'amministrazione
-- -----------------------------------------------------------------------------
alter table public.preventivo_modelli enable row level security;
alter table public.preventivi         enable row level security;

do $$
declare t text;
begin
  foreach t in array array['preventivo_modelli','preventivi'] loop
    execute format('drop policy if exists "amm_read_%1$s"   on public.%1$I', t);
    execute format('drop policy if exists "amm_insert_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "amm_update_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "amm_delete_%1$s" on public.%1$I', t);
    execute format('create policy "amm_read_%1$s" on public.%1$I for select to authenticated
                    using (public.vede_tutte_commesse())', t);
    execute format('create policy "amm_insert_%1$s" on public.%1$I for insert to authenticated
                    with check (public.vede_tutte_commesse())', t);
    execute format('create policy "amm_update_%1$s" on public.%1$I for update to authenticated
                    using (public.vede_tutte_commesse()) with check (public.vede_tutte_commesse())', t);
    execute format('create policy "amm_delete_%1$s" on public.%1$I for delete to authenticated
                    using (public.vede_tutte_commesse())', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'commessa_fatture.proforma_*' as cosa,
       case when count(*) = 3 then 'ok' else 'MANCANO COLONNE' end as esito
  from information_schema.columns
 where table_schema = 'public' and table_name = 'commessa_fatture'
   and column_name in ('proforma_numero','proforma_data','proforma_at')
union all
select 'tabella ' || t.n,
       case when c.oid is null then 'MANCANTE'
            when not c.relrowsecurity then 'RLS SPENTA'
            else 'ok, ' || (select count(*) from pg_policy p where p.polrelid = c.oid) || ' regole' end
  from (values ('preventivo_modelli'),('preventivi')) as t(n)
  left join pg_class c on c.relname = t.n
       and c.relnamespace = 'public'::regnamespace;

-- =============================================================================
-- FINE MIGRAZIONE 032 - ora riesegui la 018.
-- =============================================================================
