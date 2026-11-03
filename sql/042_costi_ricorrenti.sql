-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 042
-- Costi che si ripetono ogni anno, con la loro scadenza
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente e solo additivo.
--
-- IL PROBLEMA
-- Il canone del software, la polizza professionale, l'abbonamento: si pagano
-- ogni anno uguali, alla stessa data. Andavano riscritti a mano ogni anno, e
-- fino a quel momento il gestionale non sapeva che c'erano da pagare: la
-- black list dei debiti non li mostrava.
--
-- LA CORREZIONE
--   ricorrente   il costo si ripete ogni anno, stesso importo e stessa data;
--   scadenza     la data entro cui va pagato;
--   origine_id   per le ripetizioni: il costo dell'anno prima da cui nasce.
-- Passata la scadenza (o la data) di un costo ricorrente, l'applicazione
-- prepara da sola quello dell'anno dopo, da pagare. L'indice unico su
-- origine_id impedisce che due utenti collegati insieme lo creino due volte.
-- Le regole di accesso sono quelle dei costi generali: nessuna regola nuova.
-- =============================================================================

alter table public.costi_generali add column if not exists ricorrente boolean not null default false;
alter table public.costi_generali add column if not exists scadenza   date;
alter table public.costi_generali add column if not exists origine_id uuid
  references public.costi_generali(id) on delete set null;

create unique index if not exists uq_costi_origine on public.costi_generali(origine_id)
  where origine_id is not null;
create index if not exists idx_costi_scadenza on public.costi_generali(scadenza)
  where not pagato;

comment on column public.costi_generali.ricorrente is 'Si ripete ogni anno: stesso importo, stessa data.';
comment on column public.costi_generali.scadenza   is 'Data entro cui il costo va pagato.';
comment on column public.costi_generali.origine_id is 'Ripetizione annuale: il costo dell''anno prima da cui nasce.';

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'costi ricorrenti e scadenze' as cosa,
       case when count(*) = 3 then 'ok' else 'MANCANO COLONNE' end as esito
  from information_schema.columns
 where table_schema = 'public' and table_name = 'costi_generali'
   and column_name in ('ricorrente','scadenza','origine_id');

-- =============================================================================
-- FINE MIGRAZIONE 042 - ora riesegui la 018.
-- =============================================================================
