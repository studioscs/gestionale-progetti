# SCS Gestionale Progetti

Gestionale di commessa per studio tecnico, pensato per un organico di 6-8 persone.
Applicazione a file singolo (`index.html`) su Supabase: nessun build, nessun server,
si apre da browser o si pubblica su qualsiasi hosting statico.

**Il principio di progetto:** il collaboratore non crea task. Alla creazione della
commessa sceglie un percorso di lavoro e spunta le condizioni che la riguardano
(vincolo paesaggistico? attività soggetta a VVF? autorizzazione sismica preventiva?).
Il gestionale genera da solo fasi, attività e pratiche verso gli enti, con le
scadenze già calcolate. Da lì in avanti il lavoro quotidiano è **un click per
spuntare**, senza modali e senza salvataggi.

---

## Installazione

### 1. Database

Apri Supabase → **SQL Editor** → esegui **in ordine**:

1. [`sql/001_gestionale_v2.sql`](sql/001_gestionale_v2.sql) — struttura principale
2. [`sql/002_chat_pratiche.sql`](sql/002_chat_pratiche.sql) — conversazione sulle pratiche

Ogni script è **idempotente** (puoi rilanciarlo) e **solo additivo**: non modifica né
cancella le tabelle esistenti (`projects`, `tasks`, `time_entries`, `files`,
`profiles`, `project_fasi`, `project_sottofasi`). Aggiunge:

| Oggetto | Cosa fa |
|---|---|
| `commessa_fasi` | Fasi di lavoro generate da template. Vincolo `unique(project_id, fase_key)` che impedisce le generazioni duplicate |
| `commessa_pratiche` | Autorizzazioni e pareri: ente, protocollo, data invio, termine di legge, scadenza, esito |
| `pratica_eventi` | Diario della pratica: invio, sollecito, integrazione, rilascio |
| `notifiche` | Avvisi in-app (sostituiscono il vecchio `mailto:` che scriveva solo a te stesso) |
| Colonne su `projects` | `codice`, `template_key`, `condizioni[]`, `comune`, `provincia`, `indirizzo`, `dati_catastali`, referenti |
| Colonne su `tasks` | `commessa_fase_id`, `sort_order`, `completed_at/by`, `is_milestone`, `opzionale`, `ente`, `rif_normativo` |
| Trigger | `updated_at` automatico; timbro di chi/quando chiude un'attività; calcolo automatico della scadenza di una pratica da `data_invio + termine_giorni` |
| Policy RLS | Lettura a tutto lo studio, scrittura a `collaboratore`/`admin`, cancellazione ad `admin`. Le notifiche le vede solo il destinatario |
| `v_avanzamento_commesse` | Vista di riepilogo con percentuale di avanzamento calcolata dal DB |

La 002 aggiunge inoltre: `notifiche.pratica_id` (per aprire la pratica giusta dalla
campanella), l'indice cronologico sulla conversazione, la vista `v_pratiche_chat`
con il conteggio messaggi, e le policy che lasciano correggere o cancellare **solo
i propri** messaggi.

### 2. Storage

Serve un bucket **privato** chiamato `commesse`. I file finiscono in
`commesse/<id-commessa>/`. Il download avviene con URL firmati a 120 secondi.

### 3. URL di reindirizzamento (necessario per il recupero password)

Supabase → **Authentication → URL Configuration**: inserisci l'indirizzo da cui
servi l'app in **Site URL** e aggiungilo anche fra i **Redirect URLs**
(es. `https://tuodominio.it/index.html`). Senza questo passaggio il link di
recupero password ricevuto per email rimanda a una pagina che Supabase rifiuta.

### 4. Utenti

Invita da Supabase → Authentication → Users, oppure fai usare "Registrati".
Chi si registra nasce **Viewer** (sola lettura): un admin lo promuove a
Collaboratore da *Amministrazione → Utenti*.

Ruoli: `viewer` (legge) · `collaboratore` (modifica) · `admin` (modifica + elimina + utenti).

---

## Percorsi di lavoro precaricati

Cinque template, 35 fasi e 282 attività complessive, con riferimenti normativi.

| Template | Fasi | Copre |
|---|---|---|
| **Edilizia privata** | 13 | Incarico → preliminare → geologia → definitivo → **autorizzazioni** → titolo edilizio → strutture → impianti → esecutivo → sicurezza → affidamento → DL → agibilità |
| **Opera pubblica** (D.Lgs 36/2023) | 9 | Programmazione → PFTE → conferenza di servizi → definitivo → esecutivo → verifica e validazione → gara → DL → collaudo/CRE |
| **Incarico strutturale / sismico** | 7 | Dati → indagini → calcolo → elaborati → deposito o autorizzazione sismica → DL strutturale → collaudo statico |
| **Bene vincolato** | 5 | Ricognizione vincoli → rilievo e degrado → progetto → istanze agli enti → alta sorveglianza |
| **Commessa libera** | 1 | Nessuna checklist: consulenze, perizie, incarichi non standard |

Su una commessa di edilizia privata con tutte le condizioni attive la generazione
produce **13 fasi, 129 attività e 23 pratiche** già datate e collegate fra loro.

### Enti coperti

Soprintendenza (paesaggistica ordinaria e semplificata, art. 21, art. 12),
Soprintendenza Archeologia, Comando VVF (valutazione progetto, SCIA, deroga, CPI),
Genio Civile (autorizzazione art. 94, deposito art. 93, denuncia c.a. art. 65,
collaudo statico), Comune/SUE (PdC, SCIA, CILA, agibilità), Commissione Locale per
il Paesaggio, ASL, Autorità di Bacino, Regione (VIA e screening), ARPA, Consorzi e
gestori reti, Agenzia delle Entrate (DOCFA/Pregeo), Provincia/ANAS.

> I termini precaricati (45 gg paesaggistica, 60 gg VVF, 90 gg PdC…) sono
> **indicativi**. Vanno verificati con i regolamenti regionali e comunali vigenti,
> tenendo conto delle sospensioni per integrazioni. L'app li mostra come valori
> modificabili, mai come dato certo.

### Personalizzare i template

Sono dati, non codice. Nel blocco `TEMPLATES` di `index.html`:

```js
{ k:'esecutivo', nome:'9. Progetto esecutivo', ic:'📏', dur:35, att:[
  { t:'Dettagli costruttivi 1:20 e 1:5', h:32 },
  { t:'SCIA antincendio', h:10, ente:'Vigili del Fuoco',
    rif:'art. 4 DPR 151/2011', cond:'vvf', ms:1 }
]}
```

`dur` durata in giorni · `h` ore stimate · `rif` riferimento normativo · `ente` ·
`cond` condizione che deve essere attiva perché la voce venga creata ·
`ms` milestone (scade a fine fase, priorità alta) · `opt` opzionale (esclusa dal
calcolo di avanzamento).

Aggiungere una pratica al catalogo: una riga in `PRATICHE_CAT` con `ente`, `tipo`,
`gg` (termine), `rif` e la `cond` che la attiva.

---

## Come si usa quotidianamente

- **Oggi** è la home: in ritardo, in scadenza oggi, questa settimana, cose da
  verificare. Ogni riga si spunta dove sta.
- **Un click sulla casella** chiude l'attività. Se ha un verificatore diverso da te
  passa in *Revisione* e chi deve approvare riceve la notifica.
- **Le fasi si aggiornano da sole**: nessuno deve mantenere a mano lo stato. Quando
  l'ultima attività obbligatoria si chiude, la fase diventa *Completata* e i
  responsabili della fase successiva vengono avvisati. Una fase marcata
  *Non applicabile* non viene più toccata dall'automatismo.
- **Assegnatario e scadenza** si cambiano dal popover inline (`+ assegna`, `📅`),
  con preset *oggi / domani / +1 settimana / +2 settimane / +1 mese*.
- **Scorciatoie:** `n` nuova attività · `p` nuova commessa · `o` registra ore ·
  `/` cerca · `Esc` chiude.
- **Password dimenticata**: dal link ricevuto per email si arriva a una schermata
  che chiede la nuova password. Se il link è scaduto lo dice e invita a
  richiederne uno nuovo.
- **Kanban** con drag & drop tra le colonne.
- **Scadenzario** unifica attività e pratiche di tutto lo studio, filtrabile per persona.
- **Pratiche & Enti** ha una barra di filtri rapidi: i chip in alto (*Da preparare,
  Presso l'ente, In ritardo, Concluse*) mostrano il conteggio e filtrano con un click;
  sotto ci sono commessa, ente e responsabile, più una ricerca su ente, tipo pratica,
  oggetto, protocollo, riferimento normativo e nome commessa. Il raggruppamento si
  cambia al volo: **per ente, per commessa, per stato** o elenco piatto ordinato per
  scadenza.
- **Ogni pratica ha una conversazione interna** (scheda *Conversazione*): messaggi
  rapidi fra chi la segue, con Invio per inviare e Shift+Invio per andare a capo.
  Nella stessa cronologia compaiono anche gli eventi formali (invio, protocollo,
  integrazione, sollecito, sopralluogo, parere, rilascio) e i cambi di stato, perché
  quando segui una pratica conta l'ordine dei fatti, non la loro categoria.
  Sotto il campo di scrittura è indicato **chi riceverà la notifica**; se la pratica
  non ha un responsabile te lo dice invece di inviare nel vuoto. In elenco ogni
  pratica mostra 💬 con il numero di messaggi, evidenziato se ce ne sono di non letti.
- **Togliere una pratica** — due strade, entrambe raggiungibili sia dall'elenco
  (colonna a destra) sia dalla finestra della pratica:
  - **⊘ Non necessaria** (tutti i collaboratori, reversibile): la pratica esce dai
    conteggi e dallo scadenzario ma resta consultabile, a documentare che la
    valutazione è stata fatta. La scelta finisce nel diario con nome e data.
    È la strada giusta quando la generazione automatica ha creato una pratica che
    per quella commessa non serve.
  - **🗑 Elimina** (di default solo admin, irreversibile): cancella anche protocollo,
    date, diario e conversazione. La conferma dice quanti messaggi si perdono e
    ricorda l'alternativa.

  Per lasciare eliminare anche ai collaboratori: esegui
  [`sql/003_permessi_pratiche.sql`](sql/003_permessi_pratiche.sql) e porta
  `PERMESSI.eliminaPratica` da `'admin'` a `'staff'` in cima a `index.html`.
  Servono entrambe le modifiche: il solo cambio nel file non basta, perché la
  cancellazione è bloccata anche dalle policy del database.
- **Chiudere una commessa**: dal dettaglio → *Modifica* trovi due operazioni distinte.
  - **Archivia** (collaboratori e admin, reversibile): la commessa esce dagli elenchi
    e dai menu a tendina ma resta consultabile dal filtro *Archiviate*, con tutto lo
    storico di ore e file. È quello che serve quasi sempre a fine lavori.
  - **Elimina** (solo admin, irreversibile): mostra prima quante fasi, attività,
    pratiche, ore e file verranno distrutti e chiede di **riscrivere il nome della
    commessa** per procedere. Cancella anche i file dallo Storage e i figli in ordine
    esplicito, senza dipendere dagli `ON DELETE CASCADE` delle tabelle preesistenti.
- I dati si ricaricano da soli ogni 60 secondi (in pausa quando la scheda è in
  secondo piano o mentre stai compilando una modale).

---

## Sto usando la versione giusta?

In fondo alla barra laterale (e sotto il logo nella schermata di accesso) compare
`versione 2026.07.31.4`. Se dopo aver caricato un `index.html` nuovo il numero non
cambia, il browser ti sta servendo la copia in cache: forza il ricaricamento con
**Ctrl+Shift+R** (Windows/Linux) o **Cmd+Shift+R** (Mac).

È la causa più comune di "ho aggiornato ma non vedo le modifiche": un file singolo
non può invalidare la propria cache da solo. Se pubblichi su un hosting statico e
il problema si ripete, richiama il file con un parametro, ad esempio
`index.html?v=4`.

---

## Bug corretti rispetto alla versione precedente

| Punto | Problema |
|---|---|
| `drawTaskTable` | Header a 9 colonne, righe a 8: mancava il `<td>` Responsabile, tabella disallineata |
| `rKanban` / `rTimeline` | Leggevano `PROJS`/`TSKS` senza caricarli: dopo "Task" o "Ore" la Timeline mostrava sempre "Nessun progetto con date" |
| `bdg()` | Non conosceva `non_avviata`/`completata`: stampava la stringa grezza nelle sottofasi |
| `isOD()` | Applicato anche ai task completati, che apparivano in rosso con ⚠ |
| `saveTask` | Scriveva `created_by` anche in update, sovrascrivendo l'autore originale |
| `openEditSF` | `addEventListener` dentro la `.then()`: ogni apertura accumulava un listener |
| `initFasiProgetto` | Nessun vincolo di unicità: aprendo la pagina in due si generavano fasi duplicate |
| `rFasi` | Filtro `status='attivo'`: i progetti in pianificazione erano invisibili ai collaboratori |
| `inviaNotificaSF` | Il `mailto:` era indirizzato solo a se stessi (`profiles` non aveva la colonna email) |
| `fillProjSel` | Senza progetti inviava `project_id:''` → errore UUID |
| `boot()` | Profilo mancante → app in sola lettura senza alcun avviso |
| Gantt `bar()` | `tot=365` fisso sull'anno corrente: le commesse pluriennali erano rese male |
| `fTasks` | Eccezione su `title` null |
| `setLoading` | Doppia chiamata: il pulsante perdeva l'etichetta |
| Popover *(introdotto e corretto in questa versione)* | Si chiudeva sul `mousedown`, quindi il `click` sulla voce non arrivava mai |
| Avanzamento fase *(idem)* | Stato salvato correttamente ma badge a schermo non aggiornato |
| Barra superiore *(idem)* | I pulsanti azione erano fuori dall'area con delega eventi e non rispondevano |
| Recupero password *(idem)* | Il link ricevuto per email autentica già l'utente: la sessione veniva trattata come un login normale e si entrava nell'app **senza mai poter cambiare la password**. Ora il link porta a una schermata dedicata; il link scaduto viene riconosciuto e spiegato |

Correzioni trasversali: parsing date senza slittamento UTC (una scadenza *oggi* non
risulta più scaduta), `esc()` che gestisce apostrofi e lo zero, messaggi d'errore
Supabase tradotti (colonna o tabella mancante → "esegui la migrazione"),
un solo handler delegato al posto di centinaia di listener per riga.

---

## Test

```bash
cd test
npm install          # solo playwright
node logic.js        # 40 asserzioni su date, template, pianificazione, avanzamento
node e2e.js          # 68 test end-to-end in Chromium su un mock di Supabase
```

`e2e.js` copre: login, wizard a 3 passi, generazione della struttura, spunta e
riapertura di un'attività, avanzamento automatico delle fasi, popover di
assegnazione e scadenza, drag & drop Kanban, calcolo dei termini di legge,
Gantt pluriennale, archiviazione con ripristino, eliminazione con conferma e
verifica che non restino record orfani, filtri e raggruppamenti delle pratiche,
invio ed eliminazione di messaggi in chat, tutte le pagine e l'assenza di errori
in console.
`mock.js` è un Supabase in memoria: i test non toccano il database reale.

---

## Limiti noti

- Le notifiche sono **in-app**. Per l'invio email servirebbe una Edge Function
  Supabase con un provider SMTP: non è inclusa.
- Non c'è gestione documentale versionata: i file sono un elenco piatto per commessa.
- I template sono nel file. Modificarli non tocca le commesse già generate: usa
  *"＋ Aggiungi fasi da template"* per integrare le fasi mancanti su una commessa
  esistente (non duplica ciò che c'è già).
- La chiave anon Supabase è nel sorgente: è corretto e previsto, ma **richiede che
  RLS sia attiva su tutte le tabelle**. La migrazione la configura sulle tabelle
  nuove; verifica che lo sia anche su quelle preesistenti.
