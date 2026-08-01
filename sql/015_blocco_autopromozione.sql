-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 015
-- Nessuno si promuove da solo
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- La politica di aggiornamento di "profiles" consente a ciascuno di modificare
-- la propria riga:
--
--   using (id = auth.uid() or public.is_admin())
--
-- Serve, perche' ognuno deve poter correggere il proprio nome. Ma l'RLS decide
-- QUALI RIGHE si possono toccare, non QUALI COLONNE: un collaboratore poteva
-- quindi chiamare l'API con la chiave anon - che e' pubblica, sta dentro
-- index.html - e scriversi role = 'admin' sulla propria riga.
--
-- Verificato su PostgreSQL 16 prima di questa migrazione: l'aggiornamento
-- passava e il ruolo diventava 'admin'. Da li' si vedono i costi orari di
-- tutti, si eliminano commesse e si cambiano i ruoli altrui.
--
-- LA CORREZIONE
-- Un trigger che, quando chi scrive non e' amministratore, rimette ruolo e
-- stato ai valori di prima. Non si nega l'aggiornamento - il nome deve poter
-- cambiare - si nega la modifica di quelle due colonne. Il controllo sta nel
-- database e non nell'interfaccia, perche' l'interfaccia si aggira.
-- =============================================================================

create or replace function public.blocca_autopromozione()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- L'amministratore puo' tutto: e' il suo mestiere.
  if public.is_admin() then
    return new;
  end if;

  -- Chiamate senza utente (service_role, migrazioni, lavori interni) non
  -- passano dall'RLS e non devono essere ostacolate qui.
  if auth.uid() is null then
    return new;
  end if;

  -- Chiunque altro: ruolo e stato restano quelli di prima, in silenzio.
  -- Sollevare un errore renderebbe impossibile persino cambiare il proprio
  -- nome dall'applicazione, che invia sempre l'intera riga.
  new.role   := old.role;
  new.attivo := old.attivo;
  return new;
end; $$;

drop trigger if exists trg_blocca_autopromozione on public.profiles;
create trigger trg_blocca_autopromozione
  before update on public.profiles
  for each row execute function public.blocca_autopromozione();

comment on function public.blocca_autopromozione() is
  'Impedisce a chi non e'' amministratore di modificare role e attivo, anche chiamando direttamente l''API.';

-- =============================================================================
-- FINE MIGRAZIONE 015
--
-- Verifica (da eseguire come collaboratore):
--   update profiles set role = 'admin' where id = auth.uid();
--   select role from profiles where id = auth.uid();   -- deve essere invariato
-- =============================================================================
