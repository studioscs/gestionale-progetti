-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 025
-- La fine prevista della commessa segue le sue fasi
-- =============================================================================
-- Da eseguire dopo le precedenti. Idempotente e solo additivo.
--
-- IL PROBLEMA
-- La fine prevista della commessa si scriveva una volta, all'apertura, e poi
-- restava li'. Ma il lavoro si ripianifica: si sposta la fine di una fase, se
-- ne aggiunge una che va oltre, il committente chiede una variante. La
-- commessa continuava a dire la data vecchia e - peggio - a segnalarsi come
-- SCADUTA in rosso, anche subito dopo aver aggiornato le fasi.
--
-- Una data rossa che rossa non e' costa piu' di quanto sembri: chi guarda
-- l'elenco impara a ignorare il rosso, e il giorno che una commessa e' davvero
-- in ritardo non se ne accorge nessuno.
--
-- LA REGOLA
-- Una commessa non puo' finire prima del lavoro che contiene. La sua fine
-- prevista viene portata avanti fino all'ultima fase, ogni volta che una fase
-- nasce, cambia data o viene aggiornata.
--
-- SOLO IN AVANTI, MAI INDIETRO
-- Se le fasi finiscono PRIMA della data di commessa, non si tocca niente: quel
-- margine e' una scelta di chi l'ha scritta - il tempo per la consegna, per il
-- collaudo, per il committente che deve firmare - e non spetta al database
-- toglierlo. Si corregge solo la contraddizione, cioe' una commessa che
-- pretende di chiudersi mentre ha ancora fasi aperte piu' avanti.
--
-- LE COMMESSE CHIUSE NON SI TOCCANO
-- Su una commessa completata o archiviata la fine prevista e' un dato storico.
-- Modificare una fase di un lavoro finito - per sistemare un'ora, una nota -
-- non deve riscriverne la data di chiusura.
-- =============================================================================

create or replace function public.allinea_fine_commessa(p uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ultima date; attuale date; st text; arch boolean;
begin
  select end_date, status, coalesce(archiviato, false)
    into attuale, st, arch
  from public.projects where id = p;
  if not found or st = 'completato' or arch then return; end if;

  select max(data_fine_prevista) into ultima
  from public.commessa_fasi
  where project_id = p and data_fine_prevista is not null;

  if ultima is not null and (attuale is null or ultima > attuale) then
    update public.projects set end_date = ultima where id = p;
  end if;
end; $$;

comment on function public.allinea_fine_commessa(uuid) is
  'Porta la fine prevista della commessa fino all''ultima fase. Solo in avanti, e non sulle commesse chiuse.';

create or replace function public.tg_allinea_fine_commessa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    return old;   -- togliere una fase non accorcia la commessa: mai indietro
  end if;
  perform public.allinea_fine_commessa(new.project_id);
  if tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
    perform public.allinea_fine_commessa(old.project_id);
  end if;
  return new;
end; $$;

drop trigger if exists trg_allinea_fine_commessa on public.commessa_fasi;
create trigger trg_allinea_fine_commessa
  after insert or update of data_fine_prevista, project_id
  on public.commessa_fasi
  for each row execute function public.tg_allinea_fine_commessa();

-- -----------------------------------------------------------------------------
-- LE COMMESSE GIA' SBAGLIATE
-- Il trigger vale da adesso in poi. Quelle che sono gia' in contraddizione -
-- fine prevista prima dell'ultima fase, e quindi segnate come scadute a torto -
-- vanno sistemate una volta sola, qui.
-- -----------------------------------------------------------------------------
do $$
declare n integer := 0; r record;
begin
  for r in
    select p.id, p.name, p.end_date as prima, max(f.data_fine_prevista) as dopo
    from public.projects p
    join public.commessa_fasi f on f.project_id = p.id
    where p.status <> 'completato' and not coalesce(p.archiviato, false)
      and f.data_fine_prevista is not null
    group by p.id, p.name, p.end_date
    having p.end_date is null or max(f.data_fine_prevista) > p.end_date
  loop
    update public.projects set end_date = r.dopo where id = r.id;
    raise notice 'Commessa "%": fine prevista % -> %', r.name, r.prima, r.dopo;
    n := n + 1;
  end loop;
  if n = 0 then
    raise notice 'Nessuna commessa da correggere: le fini previste erano gia'' coerenti con le fasi.';
  else
    raise notice 'Corrette % commesse che finivano prima delle proprie fasi.', n;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- IL REFERTO, IN CHIARO
-- L'editor SQL di Supabase non mostra gli avvisi qui sopra: fa vedere solo il
-- risultato dell'ultima istruzione. Quindi il controllo lo si rifa' come
-- tabella, ed e' l'ultima cosa che il file esegue.
--
-- Deve dire "nessuna": significa che non c'e' piu' nessuna commessa aperta che
-- si dichiara finita prima delle proprie fasi.
-- -----------------------------------------------------------------------------
select coalesce(
  (select string_agg(x.name, ', ')
   from (select p.name
         from public.projects p
         join public.commessa_fasi f on f.project_id = p.id
         where p.status <> 'completato' and not coalesce(p.archiviato, false)
           and f.data_fine_prevista is not null
         group by p.id, p.name, p.end_date
         having p.end_date is null or max(f.data_fine_prevista) > p.end_date) x),
  'nessuna') as commesse_che_finiscono_prima_delle_loro_fasi;

-- =============================================================================
-- FINE MIGRAZIONE 025
--
-- Verifica a mano:
--   select p.name, p.end_date as fine_commessa, max(f.data_fine_prevista) as ultima_fase
--   from public.projects p
--   join public.commessa_fasi f on f.project_id = p.id
--   group by p.id, p.name, p.end_date
--   order by p.name;
--
-- La colonna fine_commessa non deve mai essere minore di ultima_fase su una
-- commessa aperta.
-- =============================================================================
