-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 039
-- Il commercialista: vede tutto come l'amministrazione, non modifica niente
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente. Non tocca nessun dato.
--
-- CHI E'
-- Un utente con ruolo "viewer" (sola lettura) e la visibilita' su "tutte le
-- commesse dello studio": nell'applicazione si sceglie il ruolo
-- "Commercialista". Legge commesse, fatture, contratti, preventivi, costi
-- generali e redditivita' come chi tiene l'amministrazione; non scrive niente.
--
-- IL BUCO CHE QUESTA MIGRAZIONE CHIUDE
-- Quasi tutte le scritture richiedevano gia' di essere staff (admin o
-- collaboratore), quindi un viewer non poteva modificare. Quattro tabelle
-- invece chiedevano solo "vede tutte le commesse": costi_generali,
-- preventivi, preventivo_modelli, pratiche_catalogo. Un utente in sola
-- lettura con quella visibilita' avrebbe potuto scriverci. Ora per scrivere
-- servono entrambe le cose. (Le migrazioni 031, 032 e 033 sono state
-- corrette allo stesso modo, cosi' rieseguirle non riapre niente.)
--
-- IN PIU' IL COMMERCIALISTA LEGGE
--   - il costo orario delle persone (profili_costi), che serve alla
--     redditivita' delle commesse: prima solo gli amministratori;
--   - il catalogo delle pratiche, che finora leggeva solo lo staff.
-- =============================================================================

create or replace function private.is_commercialista()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'viewer'
                    and coalesce(p.vede_tutto, false) and coalesce(p.attivo, true));
$$;
revoke all on function private.is_commercialista() from public;
grant execute on function private.is_commercialista() to authenticated;

-- Scrivere su queste quattro tabelle: amministrazione E staff
do $$
declare t text;
begin
  foreach t in array array['costi_generali','preventivi','preventivo_modelli','pratiche_catalogo'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists "amm_insert_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "amm_update_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "amm_delete_%1$s" on public.%1$I', t);
    execute format('create policy "amm_insert_%1$s" on public.%1$I for insert to authenticated
                    with check (private.vede_tutte_commesse() and private.is_staff())', t);
    execute format('create policy "amm_update_%1$s" on public.%1$I for update to authenticated
                    using (private.vede_tutte_commesse() and private.is_staff())
                    with check (private.vede_tutte_commesse() and private.is_staff())', t);
    execute format('create policy "amm_delete_%1$s" on public.%1$I for delete to authenticated
                    using (private.vede_tutte_commesse() and private.is_staff())', t);
  end loop;
end $$;

-- Il commercialista legge il costo orario (redditivita') e il catalogo pratiche
drop policy if exists "costi_read_admin" on public.profili_costi;
create policy "costi_read_admin" on public.profili_costi for select to authenticated
  using (private.is_admin() or private.is_commercialista());

do $$ begin
  if to_regclass('public.pratiche_catalogo') is not null then
    drop policy if exists "staff_read_pratiche_catalogo" on public.pratiche_catalogo;
    create policy "staff_read_pratiche_catalogo" on public.pratiche_catalogo for select to authenticated
      using (private.is_staff() or private.is_commercialista());
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'scritture amministrative riservate allo staff' as cosa,
       case when count(*) = 0 then 'ok' else count(*) || ' regole ancora aperte ai soli "vede tutto"' end as esito
  from pg_policy pol join pg_class c on c.oid = pol.polrelid
 where c.relnamespace = 'public'::regnamespace and pol.polcmd in ('a','w','d')
   and c.relname in ('costi_generali','preventivi','preventivo_modelli','pratiche_catalogo')
   and coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') not like '%is_staff%'
union all
select 'funzione commercialista',
       case when to_regprocedure('private.is_commercialista()') is not null then 'ok' else 'MANCANTE' end;

-- =============================================================================
-- FINE MIGRAZIONE 039 - ora riesegui la 018.
-- =============================================================================
