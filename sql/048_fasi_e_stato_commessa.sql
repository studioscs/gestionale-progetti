-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 048
-- Lo stato della commessa e quello delle sue fasi vanno insieme
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente.
--
-- IL PROBLEMA
-- Stato della commessa e stato delle fasi erano indipendenti: si chiudevano
-- tutte le fasi e la commessa restava «attiva»; si segnava la commessa
-- «completata» e le fasi restavano aperte (in produzione 8 + 6 commesse).
--
-- LA CORREZIONE, IN TUTTE E DUE LE DIREZIONI
--   - tutte le fasi completate (quelle «non applicabili» non contano) →
--     la commessa diventa «completato»;
--   - la commessa diventa «completato» → le fasi ancora aperte diventano
--     completate, con la data di oggi (e, come sempre alla chiusura di una
--     fase, gli scaglioni agganciati diventano richieste di fatturazione);
--   - una fase si riapre mentre la commessa e' «completato» → la commessa
--     torna «attivo».
-- Riaprire la commessa non riapre le fasi: quali riaprire lo decide chi
-- lavora. Le attivita' delle fasi le chiude l'applicazione, chiedendolo.
-- Le commesse gia' incoerenti non si toccano qui.
-- =============================================================================

create or replace function private.tg_fasi_stato_commessa()
returns trigger language plpgsql security definer set search_path = public as $$
declare aperte integer; fatte integer;
begin
  if new.stato is not distinct from old.stato then
    return new;
  end if;
  select count(*) filter (where stato not in ('completata', 'non_applicabile')),
         count(*) filter (where stato = 'completata')
    into aperte, fatte
    from public.commessa_fasi where project_id = new.project_id;

  if new.stato in ('completata', 'non_applicabile') and aperte = 0 and fatte > 0 then
    update public.projects set status = 'completato'
     where id = new.project_id and status is distinct from 'completato';
  elsif old.stato = 'completata' and new.stato not in ('completata', 'non_applicabile') then
    update public.projects set status = 'attivo'
     where id = new.project_id and status = 'completato';
  end if;
  return new;
end; $$;

revoke all on function private.tg_fasi_stato_commessa() from public, anon, authenticated;

drop trigger if exists trg_fasi_stato_commessa on public.commessa_fasi;
create trigger trg_fasi_stato_commessa
  after update of stato on public.commessa_fasi
  for each row execute function private.tg_fasi_stato_commessa();

create or replace function private.tg_commessa_completa_fasi()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completato' and old.status is distinct from 'completato' then
    update public.commessa_fasi
       set stato = 'completata', data_completamento = coalesce(data_completamento, current_date)
     where project_id = new.id and stato not in ('completata', 'non_applicabile');
  end if;
  return new;
end; $$;

revoke all on function private.tg_commessa_completa_fasi() from public, anon, authenticated;

drop trigger if exists trg_commessa_completa_fasi on public.projects;
create trigger trg_commessa_completa_fasi
  after update of status on public.projects
  for each row execute function private.tg_commessa_completa_fasi();

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'fasi → commessa' as cosa,
       case when exists (select 1 from pg_trigger where tgname = 'trg_fasi_stato_commessa') then 'ok' else 'MANCANTE' end as esito
union all
select 'commessa → fasi',
       case when exists (select 1 from pg_trigger where tgname = 'trg_commessa_completa_fasi') then 'ok' else 'MANCANTE' end;

-- =============================================================================
-- FINE MIGRAZIONE 048 - ora riesegui la 018.
-- =============================================================================
