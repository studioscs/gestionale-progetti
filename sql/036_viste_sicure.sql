-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 036
-- Le viste rispettano le regole di accesso di chi le interroga
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente. Non tocca nessun dato.
--
-- IL PROBLEMA (trovato il 21/10/2026 sul database in uso)
-- Sette viste create dalle prime migrazioni (001, 002, 004, 005, 007, 008)
-- giravano con i permessi di chi le aveva create, non di chi le legge: per
-- loro le regole di accesso (RLS) non valevano. E il ruolo "anon" - chiunque,
-- senza login, con la chiave pubblica che sta in index.html - poteva leggerle:
--   v_clienti_riepilogo, v_contatti_commessa, v_da_fatturare,
--   v_fatturato_commessa, v_avanzamento_commesse, v_firme_cliente,
--   v_pratiche_chat.
-- Le tabelle erano protette (lette da anonimo davano zero righe); le viste
-- sopra di esse no. Le viste nate dalla 009 in poi avevano gia'
-- security_invoker = true.
--
-- LA CORREZIONE
-- 1. Ogni vista dello schema public diventa security_invoker: legge con i
--    permessi di chi interroga, quindi con le regole della 018 (l'admin vede
--    tutto, il collaboratore solo le sue commesse, l'anonimo niente).
-- 2. Al ruolo anon si toglie la lettura delle viste e l'esecuzione delle
--    funzioni (che arrivava a tutti tramite PUBLIC): chi non ha fatto login
--    non ha niente da leggere ne' da eseguire. Chi ha fatto login le esegue
--    come prima. Una funzione aggiunta da una migrazione futura torna
--    eseguibile da PUBLIC: rieseguire questa 036 la richiude. Le tabelle restano protette dalla RLS come prima.
-- Le migrazioni 001-008 sono state corrette nello stesso modo, cosi'
-- rieseguirle non riapre il buco.
-- =============================================================================

do $$
declare v record;
begin
  for v in select c.relname from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
              and not coalesce('security_invoker=true' = any(c.reloptions), false)
  loop
    execute format('alter view public.%I set (security_invoker = true)', v.relname);
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    for v in select c.relname from pg_class c
              where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
    loop
      execute format('revoke all on public.%I from anon', v.relname);
    end loop;
    /* il permesso di esecuzione arriva a tutti attraverso PUBLIC: lo si toglie
       a PUBLIC e lo si ridà a chi ha fatto login e al servizio interno */
    execute 'revoke execute on all functions in schema public from public, anon';
    execute 'grant execute on all functions in schema public to authenticated';
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute 'grant execute on all functions in schema public to service_role';
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'viste che scavalcano le regole di accesso' as cosa,
       coalesce(string_agg(c.relname, ', '), 'nessuna: ok') as esito
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
   and not coalesce('security_invoker=true' = any(c.reloptions), false)
union all
select 'viste leggibili senza login',
       coalesce(string_agg(c.relname, ', '), 'nessuna: ok')
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
   and exists (select 1 from pg_roles where rolname = 'anon')
   and has_table_privilege('anon', c.oid, 'select')
union all
select 'funzioni eseguibili senza login',
       coalesce(string_agg(p.proname, ', '), 'nessuna: ok')
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and exists (select 1 from pg_roles where rolname = 'anon')
   and has_function_privilege('anon', p.oid, 'execute');

-- =============================================================================
-- FINE MIGRAZIONE 036 - ora riesegui la 018.
-- =============================================================================
