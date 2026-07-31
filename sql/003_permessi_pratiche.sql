-- =============================================================================
-- SCS Gestionale Progetti - Migrazione 003 (FACOLTATIVA)
-- Permette anche ai COLLABORATORI di eliminare le pratiche
-- =============================================================================
-- Esegui questo script SOLO se vuoi che i collaboratori possano cancellare una
-- pratica, non solo gli amministratori.
--
-- Perche' potresti volerlo: la generazione automatica crea da 9 a 23 pratiche
-- per commessa e diverse non si applicheranno. Se solo gli admin possono fare
-- pulizia, ogni collaboratore che imposta una commessa deve chiedere aiuto.
--
-- Perche' potresti NON volerlo: eliminare una pratica cancella anche protocollo,
-- date e conversazione. L'alternativa non distruttiva e' lo stato
-- "Non necessaria", gia' disponibile a tutti i collaboratori: la pratica esce
-- dai conteggi e dallo scadenzario ma resta a documentare che la valutazione
-- e' stata fatta.
--
-- DOPO aver eseguito questo script, in index.html cambia:
--     const PERMESSI = { eliminaPratica: 'admin' };
-- in:
--     const PERMESSI = { eliminaPratica: 'staff' };
-- Senza quella modifica il pulsante resta nascosto ai collaboratori.
-- =============================================================================

drop policy if exists "delete_admin_commessa_pratiche" on public.commessa_pratiche;
drop policy if exists "delete_staff_commessa_pratiche" on public.commessa_pratiche;

create policy "delete_staff_commessa_pratiche" on public.commessa_pratiche
  for delete to authenticated
  using (public.is_staff());

-- =============================================================================
-- PER TORNARE INDIETRO (solo admin possono eliminare):
--
--   drop policy if exists "delete_staff_commessa_pratiche" on public.commessa_pratiche;
--   create policy "delete_admin_commessa_pratiche" on public.commessa_pratiche
--     for delete to authenticated using (public.is_admin());
--
-- e rimetti eliminaPratica: 'admin' in index.html.
-- =============================================================================
