-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 022
-- Il lavoro non assegnato e' dello studio, non di chi passa la checklist
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Quando un'attivita' non e' assegnata a nessuno e la fase non ha un
-- responsabile, il costo finiva su chi aveva messo la spunta: sempre la stessa
-- persona, quella che passa la checklist. La Redditivita' mostrava un socio che
-- lavorava a tutto e gli altri fermi, che non e' quello che succede.
--
-- LA CORREZIONE
-- Il lavoro senza un nome sopra si divide fra i soci tecnici, in parti uguali.
-- Non e' una stima migliore - non sappiamo chi l'ha fatto - ma e' onesta: dice
-- "lo ha fatto lo studio" invece di dire il nome sbagliato. E il totale non
-- cambia: quattro persone al 25% fanno la stessa giornata di una al 100%.
--
-- CHI SONO I SOCI TECNICI
-- Non basta il ruolo. Chi tiene l'amministrazione puo' benissimo essere
-- amministratore del gestionale senza per questo redigere elaborati, e
-- assegnargli un quarto di ogni fase falserebbe sia il suo costo sia quello
-- degli altri. Serve un contrassegno esplicito, che un amministratore accende
-- e spegne da Utenti.
-- =============================================================================

alter table public.profiles add column if not exists ripartisce boolean not null default false;

comment on column public.profiles.ripartisce is
  'Riceve una quota del lavoro non assegnato a nessuno. Va ai soci tecnici, non a chi tiene l''amministrazione.';

-- -----------------------------------------------------------------------------
-- Valore di partenza: gli amministratori che non sono l'amministrazione.
-- Si applica una volta sola, alla prima esecuzione: se in seguito qualcuno
-- viene tolto o aggiunto a mano, rilanciare il file non lo rimette a posto
-- d'ufficio - la scelta di chi la fa e' piu' informata di questa riga.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.profiles where ripartisce) then
    update public.profiles
       set ripartisce = true
     where role = 'admin'
       and coalesce(vede_tutto, false) = false
       and coalesce(attivo, true);
    raise notice 'Ripartizione del lavoro non assegnato: attivata su % soci tecnici.',
      (select count(*) from public.profiles where ripartisce);
  else
    raise notice 'Ripartizione gia'' impostata: non tocco niente.';
  end if;
end $$;

-- =============================================================================
-- FINE MIGRAZIONE 022
--
-- Verifica - devono comparire i soci tecnici e NON l'amministrazione:
--   select full_name, email, role, vede_tutto, ripartisce
--   from public.profiles where attivo order by ripartisce desc, full_name;
--
-- Per correggere a mano:
--   update public.profiles set ripartisce = true  where email = 'nome@studiotecnicoscs.com';
--   update public.profiles set ripartisce = false where email = 'amministrazione@studiotecnicoscs.com';
-- =============================================================================
