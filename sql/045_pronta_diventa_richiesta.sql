-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 045
-- Niente piu' stato «pronta»: quello che si puo' fatturare e' una richiesta
-- =============================================================================
-- Da eseguire dopo le precedenti, e poi la 018 per ultima come sempre.
-- Idempotente.
--
-- IL PROBLEMA
-- «Pronta da emettere» diceva che uno scaglione era maturato: lo metteva da
-- solo la chiusura della fase collegata (005) o un SAL di direzione lavori
-- (012), oppure lo si sceglieva a mano. Poi sono arrivate la richiesta del
-- responsabile di commessa (019) - chi, quando, con quali note - e la data
-- prevista, che decide sezione e anno. «Pronta» era diventato un doppione:
-- in produzione 13 scaglioni, 2 soli dalla chiusura di una fase.
--
-- LA CORREZIONE
-- Gli scaglioni aperti sono tutti «da emettere». Quando uno scaglione
-- diventerebbe «pronta» - fase completata, SAL, o un browser rimasto alla
-- versione precedente - questa regola lo lascia «da emettere» e lo segna
-- come RICHIESTA DI FATTURAZIONE: compare fra «Chieste dai responsabili» con
-- la nota del perche' (la fase e la data, il SAL). Se la data prevista manca
-- o e' piu' avanti, diventa oggi: e' da fatturare adesso.
-- I 13 scaglioni gia' «pronti» diventano «da emettere» e tengono la loro data;
-- quelli maturati per la chiusura di una fase diventano richieste.
-- Il valore 'pronta' resta ammesso dal vincolo (non si rompe niente), ma
-- nessuno scaglione ci resta.
-- =============================================================================

create or replace function private.tg_pronta_diventa_richiesta()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f_nome text; f_resp uuid; f_data date;
  nota text;
begin
  if new.stato is distinct from 'pronta' then
    return new;
  end if;

  if new.fase_id is not null then
    select nome, responsabile_id, data_completamento into f_nome, f_resp, f_data
      from public.commessa_fasi where id = new.fase_id;
  end if;

  nota := case
    when f_nome is not null then
      'Fase «' || f_nome || '» completata il ' || to_char(coalesce(f_data, current_date), 'DD/MM/YYYY')
    when new.sal_id is not null then
      'Quota di direzione lavori maturata con il SAL'
    else 'Segnato come pronto da emettere'
  end;

  new.stato := 'da_emettere';
  if new.richiesta_at is null then
    new.richiesta_at   := now();
    new.richiesta_da   := coalesce(new.richiesta_da, auth.uid(), f_resp);
    new.richiesta_note := coalesce(nullif(new.richiesta_note, ''), nota);
  end if;
  if new.data_prevista is null or new.data_prevista > current_date then
    new.data_prevista := current_date;
  end if;
  return new;
end; $$;

revoke all on function private.tg_pronta_diventa_richiesta() from public, anon, authenticated;

drop trigger if exists trg_pronta_diventa_richiesta on public.commessa_fatture;
create trigger trg_pronta_diventa_richiesta
  before insert or update of stato on public.commessa_fatture
  for each row execute function private.tg_pronta_diventa_richiesta();

-- -----------------------------------------------------------------------------
-- Gli scaglioni gia' «pronti». Quelli maturati per la chiusura di una fase
-- diventano richieste (con la nota della fase); tutti tengono la loro data.
-- L'aggiornamento scrive stato = 'da_emettere', quindi la regola qui sopra non
-- interviene e la data prevista resta quella che era.
-- -----------------------------------------------------------------------------
update public.commessa_fatture f
   set stato          = 'da_emettere',
       richiesta_at   = coalesce(f.richiesta_at, coalesce(fa.data_completamento::timestamptz, now())),
       richiesta_da   = coalesce(f.richiesta_da, fa.responsabile_id),
       richiesta_note = coalesce(f.richiesta_note, 'Fase «' || fa.nome || '» completata il '
                                 || to_char(coalesce(fa.data_completamento, current_date), 'DD/MM/YYYY'))
  from public.commessa_fasi fa
 where f.stato = 'pronta' and f.fase_id = fa.id and fa.stato = 'completata';

update public.commessa_fatture set stato = 'da_emettere' where stato = 'pronta';

-- -----------------------------------------------------------------------------
-- Resoconto leggibile: l'editor SQL di Supabase mostra solo l'ultimo risultato.
-- -----------------------------------------------------------------------------
select 'scaglioni ancora «pronta»' as cosa,
       (select count(*) from public.commessa_fatture where stato = 'pronta')::text as esito
union all
select 'regola «pronta» → richiesta',
       case when exists (select 1 from pg_trigger where tgname = 'trg_pronta_diventa_richiesta') then 'ok' else 'MANCANTE' end;

-- =============================================================================
-- FINE MIGRAZIONE 045 - ora riesegui la 018.
-- =============================================================================
