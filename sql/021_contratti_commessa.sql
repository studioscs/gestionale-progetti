-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 021
-- Il contratto non e' un numero: e' un elenco di atti
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- L'importo della commessa era un campo solo, scritto a mano. Ma un incarico
-- quasi mai resta quello di partenza: il committente chiede una prestazione in
-- piu', si concorda un atto aggiuntivo, l'importo cresce. Riscrivere quel campo
-- faceva sparire la storia - quanto era l'incarico originario, che cosa e' stato
-- aggiunto, quando e per quale accordo - e soprattutto non produceva le fatture
-- corrispondenti: quelle andavano ricordate a mente.
--
-- LA CORREZIONE
-- Una riga per ogni atto: l'incarico originario e poi ogni integrazione, con il
-- suo oggetto, il suo importo, la sua data e il suo riferimento. L'importo della
-- commessa diventa la SOMMA degli atti accettati, tenuta dal database: non si
-- puo' piu' disallineare, perche' non lo scrive piu' nessuno a mano.
--
-- COMPATIBILE CON QUELLO CHE C'E'
-- Finche' una commessa non ha nemmeno un atto, il suo importo resta quello
-- scritto a mano e nulla cambia. Gli atti sono una scelta, commessa per
-- commessa: dal primo che si aggiunge, l'importo lo governano loro.
-- =============================================================================

create table if not exists public.commessa_contratti (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,

  numero             integer not null default 1,
  tipo               text not null default 'integrazione'
                     check (tipo in ('incarico','integrazione','riduzione')),
  oggetto            text not null,
  importo            numeric(12,2) not null default 0,

  stato              text not null default 'accettato'
                     check (stato in ('proposto','accettato','rifiutato')),

  data_atto          date,
  riferimento        text,           -- protocollo, delibera, numero di preventivo
  note               text,

  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (project_id, numero)
);

create index if not exists idx_contratti_progetto on public.commessa_contratti(project_id, numero);

comment on table public.commessa_contratti is
  'Gli atti che compongono l''incarico: quello originario e le integrazioni successive. L''importo della commessa e'' la somma di quelli accettati.';
comment on column public.commessa_contratti.tipo is
  'incarico = l''atto di partenza (uno solo); integrazione = prestazioni aggiuntive; riduzione = storno, con importo negativo.';
comment on column public.commessa_contratti.stato is
  'Solo gli atti accettati concorrono all''importo della commessa: un''integrazione proposta e non firmata non e'' ancora denaro.';

-- Le fatture sanno da quale atto nascono: serve a rispondere alla domanda
-- «questa integrazione l'abbiamo poi fatturata?» senza andare a memoria.
alter table public.commessa_fatture add column if not exists contratto_id uuid
  references public.commessa_contratti(id) on delete set null;
create index if not exists idx_fatture_contratto on public.commessa_fatture(contratto_id)
  where contratto_id is not null;

-- -----------------------------------------------------------------------------
-- L'IMPORTO DELLA COMMESSA LO TIENE IL DATABASE
--
-- Somma degli atti accettati. Si ricalcola a ogni inserimento, modifica o
-- cancellazione, e non tocca le commesse che di atti non ne hanno: quelle
-- tengono l'importo scritto a mano, come hanno sempre fatto.
-- -----------------------------------------------------------------------------
create or replace function public.ricalcola_importo_commessa(p uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n integer; tot numeric(12,2);
begin
  select count(*), coalesce(sum(importo) filter (where stato = 'accettato'), 0)
    into n, tot
  from public.commessa_contratti where project_id = p;

  if n > 0 then
    update public.projects set amount = tot where id = p and amount is distinct from tot;
  end if;
end; $$;

create or replace function public.tg_ricalcola_importo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.ricalcola_importo_commessa(old.project_id);
    return old;
  end if;
  perform public.ricalcola_importo_commessa(new.project_id);
  if tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
    perform public.ricalcola_importo_commessa(old.project_id);
  end if;
  return new;
end; $$;

drop trigger if exists trg_ricalcola_importo on public.commessa_contratti;
create trigger trg_ricalcola_importo
  after insert or update or delete on public.commessa_contratti
  for each row execute function public.tg_ricalcola_importo();

drop trigger if exists trg_touch_contratti on public.commessa_contratti;
create trigger trg_touch_contratti before update on public.commessa_contratti
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: la stessa regola di tutto il resto (migrazione 018).
-- Un atto di incarico dice quanto vale la commessa: non lo deve leggere chi
-- quella commessa non la vede.
-- -----------------------------------------------------------------------------
alter table public.commessa_contratti enable row level security;

drop policy if exists "vis_read_commessa_contratti"   on public.commessa_contratti;
drop policy if exists "vis_insert_commessa_contratti" on public.commessa_contratti;
drop policy if exists "vis_update_commessa_contratti" on public.commessa_contratti;
drop policy if exists "vis_delete_commessa_contratti" on public.commessa_contratti;

create policy "vis_read_commessa_contratti" on public.commessa_contratti
  for select to authenticated
  using (project_id in (select public.commesse_visibili()));
create policy "vis_insert_commessa_contratti" on public.commessa_contratti
  for insert to authenticated
  with check (public.is_staff() and project_id in (select public.commesse_visibili()));
create policy "vis_update_commessa_contratti" on public.commessa_contratti
  for update to authenticated
  using (public.is_staff() and project_id in (select public.commesse_visibili()))
  with check (public.is_staff());
create policy "vis_delete_commessa_contratti" on public.commessa_contratti
  for delete to authenticated
  using (public.is_admin());

-- =============================================================================
-- FINE MIGRAZIONE 021
--
-- Verifica:
--   select p.name, c.numero, c.tipo, c.oggetto, c.importo, c.stato, p.amount
--   from public.commessa_contratti c join public.projects p on p.id = c.project_id
--   order by p.codice, c.numero;
--
-- Nota: finche' una commessa non ha nessun atto, il suo importo resta quello
-- scritto a mano. Dal primo atto in poi lo governano gli atti.
-- =============================================================================
