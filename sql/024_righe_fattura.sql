-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 024
-- Una fattura puo' elencare piu' servizi, uno per riga
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Uno scaglione aveva una descrizione sola e un importo solo. Ma una fattura
-- quasi mai copre una prestazione sola: rilievo, pratica edilizia e deposito
-- sismico finiscono nello stesso documento, e il committente vuole leggere
-- quanto costa ciascuno - a maggior ragione un ente pubblico, che liquida per
-- voci. Con un campo solo bisognava scrivere tutto in una riga sola e
-- l'importo dei singoli servizi spariva.
--
-- LA CORREZIONE
-- Una riga per servizio: descrizione e importo. L'imponibile dello scaglione
-- diventa la SOMMA delle righe, tenuta dal database, e nella fattura
-- elettronica ogni riga diventa un <DettaglioLinee> con il suo importo. Chi
-- riceve la fattura vede l'elenco, non un totale da interpretare.
--
-- COMPATIBILE CON QUELLO CHE C'E'
-- Finche' uno scaglione non ha nemmeno una riga, tiene il suo imponibile (o la
-- sua percentuale) come ha sempre fatto, e la fattura esce con una riga sola.
-- Le righe sono una scelta, scaglione per scaglione: dalla prima che si
-- aggiunge, l'imponibile lo governano loro.
-- =============================================================================

create table if not exists public.commessa_fattura_righe (
  id            uuid primary key default gen_random_uuid(),
  fattura_id    uuid not null references public.commessa_fatture(id) on delete cascade,

  ordine        integer not null default 0,
  descrizione   text not null,
  importo       numeric(12,2) not null default 0,

  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_fattrighe_fattura
  on public.commessa_fattura_righe(fattura_id, ordine);

comment on table public.commessa_fattura_righe is
  'I servizi elencati in una fattura, uno per riga. L''imponibile dello scaglione e'' la loro somma.';
comment on column public.commessa_fattura_righe.descrizione is
  'Va nel <DettaglioLinee><Descrizione> della fattura elettronica: e'' quello che il committente legge.';
comment on column public.commessa_fattura_righe.importo is
  'Imponibile della singola voce, IVA e cassa escluse: quelle si calcolano sul totale.';

-- -----------------------------------------------------------------------------
-- L'IMPONIBILE DELLO SCAGLIONE LO TIENE IL DATABASE
--
-- Somma delle righe. Si ricalcola a ogni inserimento, modifica o cancellazione,
-- e non tocca gli scaglioni che di righe non ne hanno: quelli tengono il loro
-- imponibile o la loro percentuale, come hanno sempre fatto.
--
-- Perche' non lasciarlo calcolare solo all'applicazione: perche' l'imponibile
-- e' gia' letto da mezzo gestionale (situazione economica, "Da fatturare",
-- redditivita', XML). Se la somma la facesse solo una parte del codice, tutte
-- le altre leggerebbero un numero vecchio. Scritto qui, e' vero per tutti.
-- -----------------------------------------------------------------------------
create or replace function public.ricalcola_imponibile_fattura(f uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n integer; tot numeric(12,2);
begin
  select count(*), coalesce(sum(importo), 0) into n, tot
  from public.commessa_fattura_righe where fattura_id = f;

  if n > 0 then
    update public.commessa_fatture
       set imponibile = tot
     where id = f and imponibile is distinct from tot;
  end if;
end; $$;

create or replace function public.tg_ricalcola_imponibile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.ricalcola_imponibile_fattura(old.fattura_id);
    return old;
  end if;
  perform public.ricalcola_imponibile_fattura(new.fattura_id);
  if tg_op = 'UPDATE' and old.fattura_id is distinct from new.fattura_id then
    perform public.ricalcola_imponibile_fattura(old.fattura_id);
  end if;
  return new;
end; $$;

drop trigger if exists trg_ricalcola_imponibile on public.commessa_fattura_righe;
create trigger trg_ricalcola_imponibile
  after insert or update or delete on public.commessa_fattura_righe
  for each row execute function public.tg_ricalcola_imponibile();

drop trigger if exists trg_touch_fattrighe on public.commessa_fattura_righe;
create trigger trg_touch_fattrighe before update on public.commessa_fattura_righe
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: la stessa regola di tutto il resto (migrazione 018), presa dal padre.
-- La riga non porta project_id: la commessa la si chiede allo scaglione. Una
-- riga di fattura dice che cosa e' stato fatto e quanto e' costato: non la deve
-- leggere chi quella commessa non la vede.
-- -----------------------------------------------------------------------------
alter table public.commessa_fattura_righe enable row level security;

drop policy if exists "vis_read_fattura_righe"   on public.commessa_fattura_righe;
drop policy if exists "vis_insert_fattura_righe" on public.commessa_fattura_righe;
drop policy if exists "vis_update_fattura_righe" on public.commessa_fattura_righe;
drop policy if exists "vis_delete_fattura_righe" on public.commessa_fattura_righe;

create policy "vis_read_fattura_righe" on public.commessa_fattura_righe
  for select to authenticated
  using (exists (select 1 from public.commessa_fatture f
                 where f.id = commessa_fattura_righe.fattura_id
                   and f.project_id in (select public.commesse_visibili())));

create policy "vis_insert_fattura_righe" on public.commessa_fattura_righe
  for insert to authenticated
  with check (public.is_staff()
              and exists (select 1 from public.commessa_fatture f
                          where f.id = commessa_fattura_righe.fattura_id
                            and f.project_id in (select public.commesse_visibili())));

create policy "vis_update_fattura_righe" on public.commessa_fattura_righe
  for update to authenticated
  using (public.is_staff()
         and exists (select 1 from public.commessa_fatture f
                     where f.id = commessa_fattura_righe.fattura_id
                       and f.project_id in (select public.commesse_visibili())))
  with check (public.is_staff());

create policy "vis_delete_fattura_righe" on public.commessa_fattura_righe
  for delete to authenticated
  using (public.is_staff()
         and exists (select 1 from public.commessa_fatture f
                     where f.id = commessa_fattura_righe.fattura_id
                       and f.project_id in (select public.commesse_visibili())));

-- =============================================================================
-- FINE MIGRAZIONE 024
--
-- Verifica:
--   select f.descrizione, f.imponibile, r.ordine, r.descrizione, r.importo
--   from public.commessa_fatture f
--   join public.commessa_fattura_righe r on r.fattura_id = f.id
--   order by f.ordine, r.ordine;
--
-- L'imponibile dello scaglione deve risultare uguale alla somma delle sue righe:
--   select f.id, f.imponibile, sum(r.importo) as somma_righe
--   from public.commessa_fatture f
--   join public.commessa_fattura_righe r on r.fattura_id = f.id
--   group by f.id, f.imponibile
--   having f.imponibile is distinct from sum(r.importo);   -- deve dare 0 righe
-- =============================================================================
