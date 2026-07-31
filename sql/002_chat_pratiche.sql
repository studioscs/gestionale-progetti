-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 002
-- Chat interna alle pratiche + notifiche che puntano alla pratica
-- =============================================================================
-- Da eseguire DOPO 001_gestionale_v2.sql. Idempotente e solo additivo.
--
-- I messaggi di chat vivono nella stessa tabella del diario (pratica_eventi)
-- con tipo = 'messaggio': cosi' conversazione ed eventi formali (protocolli,
-- integrazioni, cambi di stato) scorrono in un'unica cronologia, che e' come
-- si ragiona davvero quando si segue una pratica.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PRATICA_EVENTI - supporto alla conversazione
-- -----------------------------------------------------------------------------
alter table public.pratica_eventi add column if not exists modificato_at timestamptz;

-- Ordinamento cronologico della chat
create index if not exists idx_eventi_chat on public.pratica_eventi(pratica_id, created_at);

-- Ogni autore puo' cancellare i propri messaggi (gli admin qualsiasi cosa).
-- La policy delete_admin_pratica_eventi creata dalla 001 resta valida: qui la
-- sostituiamo con una versione piu' permissiva verso l'autore.
drop policy if exists "delete_admin_pratica_eventi" on public.pratica_eventi;
drop policy if exists "delete_own_pratica_eventi"   on public.pratica_eventi;
create policy "delete_own_pratica_eventi" on public.pratica_eventi
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- Un messaggio si puo' correggere solo se e' tuo
drop policy if exists "update_staff_pratica_eventi" on public.pratica_eventi;
drop policy if exists "update_own_pratica_eventi"   on public.pratica_eventi;
create policy "update_own_pratica_eventi" on public.pratica_eventi
  for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

-- -----------------------------------------------------------------------------
-- 2. NOTIFICHE - riferimento diretto alla pratica
-- -----------------------------------------------------------------------------
-- Serve per aprire la pratica giusta cliccando la notifica, invece di fermarsi
-- alla commessa.
alter table public.notifiche
  add column if not exists pratica_id uuid references public.commessa_pratiche(id) on delete cascade;

create index if not exists idx_notif_pratica on public.notifiche(pratica_id)
  where pratica_id is not null;

-- -----------------------------------------------------------------------------
-- 3. VISTA DI COMODO - ultimo messaggio e conteggio per pratica
-- -----------------------------------------------------------------------------
create or replace view public.v_pratiche_chat as
select
  p.id                                          as pratica_id,
  p.project_id,
  count(e.id) filter (where e.tipo = 'messaggio')  as messaggi,
  count(e.id)                                      as eventi_totali,
  max(e.created_at)                                as ultimo_movimento
from public.commessa_pratiche p
left join public.pratica_eventi e on e.pratica_id = p.id
group by p.id, p.project_id;

-- =============================================================================
-- FINE MIGRAZIONE 002
-- =============================================================================
