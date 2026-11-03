-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 047
-- Fase riaperta: la richiesta di fatturazione automatica si toglie
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente.
--
-- IL PROBLEMA
-- Con la 045 la chiusura di una fase trasforma gli scaglioni agganciati in
-- richieste di fatturazione («Fase «X» completata il ...»). Ma se la fase si
-- riapre (segnata completata per sbaglio, o con altro lavoro da fare), o se
-- lo scaglione viene staccato da quella fase, la richiesta restava: in
-- produzione i due saldi di Rocca Borgia (Camerino) chiedevano ancora di
-- essere fatturati per una fase tornata «in corso».
--
-- LA CORREZIONE
-- La richiesta nata dalla chiusura di una fase (la nota comincia con
-- «Fase «») si toglie:
--   - quando la fase smette di essere completata;
--   - quando lo scaglione viene staccato da quella fase, o agganciato a una
--     fase non completata.
-- Solo per gli scaglioni ancora da emettere e senza proforma. Le richieste
-- fatte da una persona («Chiedi fatturazione») non si toccano mai.
-- =============================================================================

create or replace function private.tg_fase_riaperta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.stato = 'completata' and new.stato is distinct from 'completata' then
    update public.commessa_fatture
       set richiesta_at = null, richiesta_da = null, richiesta_note = null
     where fase_id = new.id
       and stato = 'da_emettere' and proforma_numero is null
       and richiesta_note like 'Fase «%';
  end if;
  return new;
end; $$;

revoke all on function private.tg_fase_riaperta() from public, anon, authenticated;

drop trigger if exists trg_fase_riaperta on public.commessa_fasi;
create trigger trg_fase_riaperta
  after update of stato on public.commessa_fasi
  for each row execute function private.tg_fase_riaperta();

create or replace function private.tg_scaglione_cambia_fase()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.fase_id is distinct from old.fase_id
     and new.stato = 'da_emettere' and new.proforma_numero is null
     and coalesce(new.richiesta_note, '') like 'Fase «%'
     and not exists (select 1 from public.commessa_fasi f where f.id = new.fase_id and f.stato = 'completata') then
    new.richiesta_at := null; new.richiesta_da := null; new.richiesta_note := null;
  end if;
  return new;
end; $$;

revoke all on function private.tg_scaglione_cambia_fase() from public, anon, authenticated;

drop trigger if exists trg_scaglione_cambia_fase on public.commessa_fatture;
create trigger trg_scaglione_cambia_fase
  before update of fase_id on public.commessa_fatture
  for each row execute function private.tg_scaglione_cambia_fase();

-- Le richieste automatiche gia' rimaste senza la loro fase completata
update public.commessa_fatture f
   set richiesta_at = null, richiesta_da = null, richiesta_note = null
 where f.stato = 'da_emettere' and f.proforma_numero is null
   and f.richiesta_note like 'Fase «%'
   and not exists (select 1 from public.commessa_fasi fa where fa.id = f.fase_id and fa.stato = 'completata');

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'richieste automatiche senza fase completata' as cosa,
       (select count(*) from public.commessa_fatture f
         where f.stato = 'da_emettere' and f.richiesta_note like 'Fase «%'
           and not exists (select 1 from public.commessa_fasi fa where fa.id = f.fase_id and fa.stato = 'completata'))::text as esito;

-- =============================================================================
-- FINE MIGRAZIONE 047 - ora riesegui la 018.
-- =============================================================================
