-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 041
-- Correggere il cliente in anagrafica corregge commesse e preventivi
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente.
--
-- IL PROBLEMA
-- Ogni commessa tiene una copia dei dati del cliente (nome, P.IVA, PEC,
-- indirizzo...), da cui escono fatture e proforma. La copia la aggiornava il
-- browser di chi salvava la scheda in Clienti: ma le regole di accesso gli
-- lasciano modificare solo le commesse che segue, e le altre restavano con il
-- dato vecchio senza che nessuno lo sapesse (in produzione: un nome corretto
-- in anagrafica e ancora sbagliato nella commessa). E il NOME della commessa,
-- che spesso contiene quello del cliente («2026_45_ROSSI MARIO_...»), non lo
-- aggiornava nessuno.
--
-- LA CORREZIONE
-- Un trigger sulla tabella clienti: a ogni modifica, i campi CAMBIATI vanno in
-- tutte le commesse collegate e nei preventivi in bozza (in quelli gia'
-- inviati o accettati cambia solo il nome), e se il nome
-- del cliente compare nel nome della commessa ci viene sostituito. Gira con i
-- permessi del database, quindi vale per chiunque abbia salvato la scheda (chi
-- puo' modificare l'anagrafica). Solo i campi cambiati: un dato scritto nella
-- commessa e assente nella scheda non viene cancellato.
-- =============================================================================

create or replace function private.tg_cliente_propaga()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  nome_cambiato boolean := old.denominazione is distinct from new.denominazione;
  vecchio text := coalesce(old.denominazione, '');
begin
  update public.projects p set
    client              = case when nome_cambiato then new.denominazione else p.client end,
    -- il nome del cliente dentro il nome della commessa (una volta, senza
    -- badare a maiuscole); solo nomi di almeno 4 lettere, per non toccare
    -- per caso un pezzo di parola
    name                = case when nome_cambiato and length(vecchio) >= 4
                                 and position(upper(vecchio) in upper(p.name)) > 0
                               then overlay(p.name placing new.denominazione
                                            from position(upper(vecchio) in upper(p.name)) for length(vecchio))
                               else p.name end,
    cliente_piva        = case when old.piva       is distinct from new.piva       then new.piva       else p.cliente_piva end,
    cliente_cf          = case when old.cf         is distinct from new.cf         then new.cf         else p.cliente_cf end,
    cliente_sdi         = case when old.sdi        is distinct from new.sdi        then new.sdi        else p.cliente_sdi end,
    cliente_pec         = case when old.pec        is distinct from new.pec        then new.pec        else p.cliente_pec end,
    cliente_indirizzo   = case when old.indirizzo  is distinct from new.indirizzo  then new.indirizzo  else p.cliente_indirizzo end,
    cliente_cap         = case when old.cap        is distinct from new.cap        then new.cap        else p.cliente_cap end,
    cliente_comune      = case when old.comune     is distinct from new.comune     then new.comune     else p.cliente_comune end,
    cliente_prov        = case when old.provincia  is distinct from new.provincia  then new.provincia  else p.cliente_prov end,
    referente           = case when old.referente           is distinct from new.referente           then new.referente           else p.referente end,
    referente_ruolo     = case when old.referente_ruolo     is distinct from new.referente_ruolo     then new.referente_ruolo     else p.referente_ruolo end,
    referente_email     = case when old.referente_email     is distinct from new.referente_email     then new.referente_email     else p.referente_email end,
    referente_tel       = case when old.referente_tel       is distinct from new.referente_tel       then new.referente_tel       else p.referente_tel end,
    referente_tec       = case when old.referente_tec       is distinct from new.referente_tec       then new.referente_tec       else p.referente_tec end,
    referente_tec_ruolo = case when old.referente_tec_ruolo is distinct from new.referente_tec_ruolo then new.referente_tec_ruolo else p.referente_tec_ruolo end,
    referente_tec_email = case when old.referente_tec_email is distinct from new.referente_tec_email then new.referente_tec_email else p.referente_tec_email end,
    referente_tec_tel   = case when old.referente_tec_tel   is distinct from new.referente_tec_tel   then new.referente_tec_tel   else p.referente_tec_tel end
  where p.cliente_id = new.id;

  -- preventivi in bozza: tutti i dati cambiati
  update public.preventivi v set
    cliente_nome      = case when nome_cambiato then new.denominazione else v.cliente_nome end,
    cliente_piva      = case when old.piva      is distinct from new.piva      then new.piva      else v.cliente_piva end,
    cliente_cf        = case when old.cf        is distinct from new.cf        then new.cf        else v.cliente_cf end,
    cliente_pec       = case when old.pec       is distinct from new.pec       then coalesce(new.pec, v.cliente_pec) else v.cliente_pec end,
    cliente_indirizzo = case when old.indirizzo is distinct from new.indirizzo then new.indirizzo else v.cliente_indirizzo end,
    cliente_cap       = case when old.cap       is distinct from new.cap       then new.cap       else v.cliente_cap end,
    cliente_comune    = case when old.comune    is distinct from new.comune    then new.comune    else v.cliente_comune end,
    cliente_prov      = case when old.provincia is distinct from new.provincia then new.provincia else v.cliente_prov end,
    cliente_tel       = case when old.referente_tel is distinct from new.referente_tel
                             then coalesce(new.referente_tel, v.cliente_tel) else v.cliente_tel end
  where v.cliente_id = new.id and v.stato = 'bozza';

  -- preventivi gia' inviati o accettati: sono documenti mandati, cambia solo
  -- il nome (la correzione di un refuso), il resto resta quello inviato
  if nome_cambiato then
    update public.preventivi v set cliente_nome = new.denominazione
     where v.cliente_id = new.id and v.stato <> 'bozza' and v.cliente_nome is distinct from new.denominazione;
  end if;

  return new;
end; $$;

revoke all on function private.tg_cliente_propaga() from public, anon, authenticated;

drop trigger if exists trg_cliente_propaga on public.clienti;
create trigger trg_cliente_propaga
  after update on public.clienti
  for each row execute function private.tg_cliente_propaga();

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'trigger clienti → commesse e preventivi' as cosa,
       case when exists (select 1 from pg_trigger where tgname = 'trg_cliente_propaga')
            then 'ok' else 'MANCANTE' end as esito;

-- =============================================================================
-- FINE MIGRAZIONE 041 - ora riesegui la 018.
-- =============================================================================
