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
3. [`sql/004_categorie_attivita.sql`](sql/004_categorie_attivita.sql) — firme del cliente
4. [`sql/005_fatturazione.sql`](sql/005_fatturazione.sql) — scaglioni di fatturazione
5. [`sql/006_verifica_sicurezza.sql`](sql/006_verifica_sicurezza.sql) — **RLS sulle tabelle preesistenti: da eseguire**

(`003_permessi_pratiche.sql` è facoltativo: serve solo se vuoi che anche i
collaboratori possano eliminare le pratiche.)

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

### 2. Sicurezza: perché la 006 non è facoltativa

L'app è una pagina statica: la chiave `anon` di Supabase sta nel sorgente ed è
leggibile da chiunque. **È corretto** — quella chiave nasce per stare nel browser
— ma proprio per questo l'unica difesa dei dati sono le policy RLS.

Le migrazioni 001, 002 e 005 impostano RLS sulle tabelle che creano. Le tabelle
preesistenti (`projects`, `tasks`, `time_entries`, `files`, `profiles` e le
legacy) potrebbero non averla. Se anche una sola resta scoperta, chiunque
conosca l'indirizzo dell'app può leggere e modificare commesse, clienti, ore e
file **senza fare login**.

Il **passo 1** di `006_verifica_sicurezza.sql` è una query di sola diagnosi:
puoi eseguirla da sola per vedere la situazione prima di cambiare qualcosa. Ogni
riga con `rls_attiva = false` è una tabella esposta.

Verificato su PostgreSQL 16 dopo l'esecuzione: un utente **anonimo vede zero
commesse**, un *viewer* legge ma non scrive, un *collaboratore* scrive ma non
cancella, un *admin* fa tutto. La 006 chiude anche il bucket `commesse` dello
storage, altrimenti gli allegati restano scaricabili da chiunque conosca l'URL.

### 3. Storage

Serve un bucket **privato** chiamato `commesse`. I file finiscono in
`commesse/<id-commessa>/`. Il download avviene con URL firmati a 120 secondi.

### 4. URL di reindirizzamento (necessario per il recupero password)

Supabase → **Authentication → URL Configuration**: inserisci l'indirizzo da cui
servi l'app in **Site URL** e aggiungilo anche fra i **Redirect URLs**
(es. `https://tuodominio.it/index.html`). Senza questo passaggio il link di
recupero password ricevuto per email rimanda a una pagina che Supabase rifiuta.

### 5. Utenti

Invita da Supabase → Authentication → Users, oppure fai usare "Registrati".
Chi si registra nasce **Viewer** (sola lettura): un admin lo promuove a
Collaboratore da *Amministrazione → Utenti*.

Ruoli: `viewer` (legge) · `collaboratore` (modifica) · `admin` (modifica + elimina + utenti).

---

## Percorsi di lavoro precaricati

Sei template, 45 fasi e 330 attività complessive, con riferimenti normativi.

| Template | Fasi | Copre |
|---|---|---|
| **Ristrutturazione interna — CILA** | 6 | Verifiche → **firme del cliente** → progetto e asseverazione → presentazione CILA → lavori → fine lavori. Nessun parere di enti terzi |
| **Edilizia privata** | 15 | Incarico → **ricognizione enti** → **firme del cliente** → preliminare → geologia → definitivo → autorizzazioni → titolo edilizio → strutture → impianti → esecutivo → sicurezza → affidamento → DL → agibilità |
| **Opera pubblica** (D.Lgs 36/2023) | 10 | Programmazione → **documentazione per i pareri** → PFTE → conferenza di servizi → (definitivo, solo se richiesto) → esecutivo → verifica e validazione → gara → DL → collaudo/CRE |
| **Incarico strutturale / sismico** | 8 | Dati → **firme del cliente** → indagini → calcolo → elaborati → deposito o autorizzazione sismica → DL strutturale → collaudo statico |
| **Bene vincolato** | 6 | Ricognizione vincoli → **firme del cliente** → rilievo e degrado → progetto → istanze agli enti → alta sorveglianza |
| **Commessa libera** | 1 | Nessuna checklist: consulenze, perizie, incarichi non standard |

Le pratiche generate dipendono dal template, non solo dalle condizioni: una CILA
per opere interne produce **6 fasi, 45 attività e 2 pratiche**, mentre una commessa
di edilizia privata completa arriva a **15 fasi, 135 attività e 10 pratiche**.

---

## Due scelte che fanno risparmiare tempo

### Le firme del cliente stanno all'inizio, non alla fine

La **procura speciale** per la presentazione telematica (art. 1392 c.c.) vale per
**una sola pratica**: va firmata a mano dal committente e corredata della copia di
un documento d'identità di ogni sottoscrittore, poi scansionata, firmata
digitalmente dal tecnico e allegata. Se servono cinque pratiche servono cinque
procure. Raccoglierle mano a mano significa far tornare il cliente cinque volte.

I portali generano il modulo mentre si compila la pratica, ma **molti consentono di
ottenerlo in anticipo simulando quella sezione**: è questo che permette di
anticipare la firma. Per questo ogni template ha una fase *Dati definitivi e firme
del cliente* collocata **subito dopo le verifiche preliminari**, che:

1. congela anagrafiche e dati catastali;
2. verifica sul portale se la procura è pre-generabile;
3. genera in anticipo **una procura per ciascuna pratica prevista** — create
   automaticamente dal gestionale, una per ogni pratica telematica;
4. porta a un **unico appuntamento** in cui si firma tutto.

⚠️ Se dopo la firma cambiano anagrafica o dati catastali, la procura va rigenerata
e fatta rifirmare: per questo il congelamento dei dati è la prima attività della
fase, non un dettaglio.

La pagina **Firme cliente** raggruppa per commessa tutto ciò che aspetta una firma,
ordinato per scadenza, e stampa una distinta con le caselle da spuntare. Le firme
che maturano più avanti (nomina del DL, contratto d'appalto) sono separate: al
primo appuntamento non ha senso chiederle.

### Sul pubblico, la documentazione per i pareri viene prima

I pareri si raccolgono in **conferenza di servizi decisoria** sul PFTE, in forma
semplificata e modalità asincrona (art. 38 D.Lgs 36/2023): **60 giorni** per i
pareri, **90** per gli enti preposti alla tutela di paesaggio, beni culturali e
ambiente. Sono i tempi che dettano il cronoprogramma, e decorrono dal protocollo.

Il template mette quindi una fase *Enti coinvolti e documentazione preliminare per
i pareri* **prima del PFTE**: mappatura degli enti, individuazione per ciascuno
degli elaborati che ne condizionano il parere, cronoprogramma a ritroso dalla data
della conferenza, e avvio delle relazioni specialistiche. Lo **stralcio archeologico**
si trasmette alla Soprintendenza anche prima che il PFTE sia completo (art. 41 c. 4
e Allegato I.8: il Soprintendente ha 30 giorni perentori per chiedere la verifica).

Il template recepisce anche i **due soli livelli di progettazione** introdotti dal
D.Lgs 36/2023 — PFTE ed esecutivo: il definitivo è una fase opzionale, da attivare
solo se la stazione appaltante lo richiede.

Le attività portano un contrassegno che dice cosa sono: ✍️ *firma del cliente*,
💻 *portale telematico*, *sblocca un parere*.

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
calcolo di avanzamento) · `cat` categoria (`firma_cliente`, `piattaforma`,
`prereq_parere`). Sulla fase, `desc` è la nota operativa mostrata nella checklist.

Aggiungere una pratica al catalogo: una riga in `PRATICHE_CAT` con `ente`, `tipo`,
`gg` (termine), `rif`, la `cond` che la attiva e `proc:1` se richiede la procura
speciale del committente (da cui il gestionale genera la relativa firma).

Un template può inoltre dichiarare `prat: [...]` — elenco chiuso delle pratiche che
genera, come fa quello della CILA per restare snello — oppure `pratBase: [...]` per
aggiungerne di fisse a quelle guidate dalle condizioni.

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
node e2e.js          # 89 test end-to-end in Chromium su un mock di Supabase
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

## Fatturazione

Il software di fatturazione sa emettere fatture ma **non sa nulla della commessa**:
non sa che il SAL è chiuso, che la fase autorizzativa è conclusa, che l'acconto
alla firma dell'incarico non è mai stato emesso. È lì che uno studio perde soldi,
non nella compilazione della fattura.

### Scaglioni agganciati alle fasi

Nella scheda **Fatturazione** di ogni commessa definisci gli scaglioni (acconto
alla firma, alla presentazione della pratica, saldo a fine lavori), con importo
fisso o percentuale dell'importo di commessa. Ogni scaglione può essere
**agganciato a una fase**: quando quella fase si chiude, lo scaglione passa
automaticamente a *pronto da emettere*. Il passaggio lo fa un trigger sul
database, quindi vale anche se nessuno ha l'app aperta.

`Genera scaglioni standard` crea in un click il classico 30/40/30 già collegato
alle fasi giuste del template in uso.

La pagina **Da fatturare** raccoglie tutto lo studio: pronte da emettere, in
attesa di maturare, emesse non ancora incassate.

### Esportazione XML per FatturaElettronica APP

Il gestionale genera il file **FatturaPA 1.2 (FPR12)** da trascinare nella
funzione *"Importa e salva fatture"* di
[FatturaElettronica APP](https://www.fatturaelettronica-app.it/), che accetta file
`.xml` e `.p7m`. Non serve alcuna API: così nessuna credenziale finisce nel file
HTML, che è pubblico per costruzione.

L'XML prodotto è validato contro lo **schema ufficiale dell'Agenzia delle
Entrate** dalla suite `test/fattura.js` in tre varianti: con contributo cassa,
con ritenuta d'acconto, e con PEC al posto del codice destinatario.

> **Prima del primo invio compila il blocco `STUDIO`** in cima a `index.html`:
> denominazione, partita IVA, sede, regime fiscale, cassa di previdenza,
> eventuale ritenuta e coordinate di pagamento. Finché la partita IVA è vuota la
> generazione resta bloccata, con l'elenco esatto di cosa manca.
>
> I valori predefiniti sono impostati per una **S.r.l. tra Professionisti**:
> regime ordinario `RF01`, contributo integrativo Inarcassa `TC04` al 4% soggetto
> a IVA, **nessuna ritenuta d'acconto** (le società di capitali non vi sono
> soggette). Se lo studio è di geometri usa `TC03`; se la forma giuridica è
> diversa la ritenuta va riattivata. **Fai verificare la configurazione al tuo
> commercialista**: il gestionale calcola quello che gli dici, non stabilisce il
> trattamento fiscale.

I dati fiscali del committente (partita IVA o codice fiscale, sede, codice
destinatario SDI o PEC) si compilano nella scheda della commessa.

---

## Fonti

I contenuti normativi e procedurali dei template sono stati verificati su:

- [Modulo di procura speciale per la presentazione telematica (art. 1392 c.c.)](https://storagecportalpublicdocs.blob.core.windows.net/l470/SUE/Pratiche%20edilizie/Modulo%20di%20procura%20speciale.pdf)
- [Procura speciale per l'invio telematico delle pratiche SUAP/SUE — Comune di San Lazzaro di Savena](https://www.comune.sanlazzaro.bo.it/amministrazione/documenti-e-dati/modulistica/sue/edilizia-privata/procura-speciale/procura-speciale/@@download/file_principale)
- [Procura speciale — Regione Toscana](https://www.regione.toscana.it/documents/10180/23119/procura_speciale.pdf)
- [Procura speciale per la sottoscrizione digitale e presentazione telematica — Comune di Milano](https://www.comune.milano.it/documents/20126/1471479/PROCURA+SPECIALE+per+la+sottoscrizione+digitale+e+presentazione+telematica_01062020.pdf)
- [Guida all'utilizzo del portale regionale SUAP — Regione Friuli Venezia Giulia](https://suap.regione.fvg.it/portale/export/sites/SUAP/allegati/archivio_file/GUIDA-PER-UTENTI.pdf)
- [Portale Accesso Unitario SUAP/SUE — Comune di Reggio Emilia](https://www.comune.reggioemilia.it/argomenti/suap/portale-accesso-unitario)
- [Soggetti titolati a presentare la pratica edilizia — Studio Tecnico Pagliai](https://www.studiotecnicopagliai.it/soggetti-titolati-a-presentare-la-pratica-edilizia/)
- [CILA: obblighi di fine lavori, durata e Direttore Lavori — Studio Tecnico Pagliai](https://www.studiotecnicopagliai.it/cila-fine-lavori-durata-direttore-lavori/)
- [Modulo unificato nazionale CILA](https://www.glossarioedilizia.it/wp-content/uploads/2018/08/CILA-nazionale-editabile-2018.pdf)
- [D.Lgs 36/2023 — testo coordinato, Bosetti & Gatti](https://www.bosettiegatti.eu/info/norme/statali/2023_0036.htm)
- [Allegato I.7 — Contenuti minimi di PFTE e progetto esecutivo](https://www.codiceappalti.it/DLGS_36_2023/Allegato_I_7_Contenuti_minimi_del_quadro_esigenziale,_del_documento_di_fattibilit%C3%A0_delle_alternative_progettuali,_del_documento_di_indirizzo_della_progettazione,_del_progetto_di_fattibilit%C3%A0_tecnica_ed_economica_e_del_progetto_esecutivo_/12883)
- [Allegato I.8 — Verifica preventiva dell'interesse archeologico](https://www.codiceappalti.it/DLGS_36_2023/Allegato_I_8_Verifica_preventiva_dell'interesse_archeologico_/12884)
- [I livelli di progettazione nel nuovo Codice Appalti — BibLus ACCA](https://biblus.acca.it/nuovo-codice-appalti-addio-al-progetto-definitivo/)
- [Conferenza di servizi art. 38: termini per le amministrazioni — LavoriPubblici](https://www.lavoripubblici.it/news/conferenza-servizi-art-38-termini-amministrazioni-parere-mit-4068-37693)
- [La conferenza di servizi: indirizzi e istruzioni operative — Regione Lazio](https://www.regione.lazio.it/sites/default/files/cds-indirizzi-istruzioni-operative/DGR-649-31-07-2025-Allegato-A.pdf)
- [Circolare n. 26/2024 sulla verifica preventiva dell'interesse archeologico — DG ABAP, Ministero della Cultura](https://dgabap.cultura.gov.it/wp-content/uploads/2024/06/Circolare-VPIA_aggiornamenti-normativi-signed-4.pdf)
- [Come importare fatture da altri software — FatturaElettronica APP](https://intercom.help/fatturaelettronica-app/it/articles/7858536-come-importare-fatture-da-altri-software)
- [Come scaricare fatture e notifiche in PDF e XML — FatturaElettronica APP](https://intercom.help/fatturaelettronica-app/it/articles/2662530-come-scaricare-fatture-e-notifiche-in-pdf-e-xml)
- [Specifiche tecniche e schema XSD FatturaPA — Developers Italia](https://developers.italia.it/it/fatturapa/)

Le procedure telematiche variano da Comune a Comune e da Regione a Regione:
verifica sempre il portale che usi. I termini restano indicativi.

---

## Pubblicazione

Il repository è pubblico e l'app è servita da **GitHub Pages** dal ramo `main`:
ogni push è già il rilascio, non c'è nulla da caricare a mano. Dopo un
aggiornamento i collaboratori devono fare **Ctrl+Shift+R** (o Cmd+Shift+R): un
file singolo non può invalidare la propria cache, e Pages la tiene per qualche
minuto. Il numero di versione in fondo alla barra laterale dice a colpo d'occhio
quale copia si sta usando.

Essendo il repository pubblico, non mettere mai in `index.html` dati che non
possono essere letti da chiunque: niente chiavi API di servizi terzi, niente
`service_role` di Supabase. La chiave `anon` è l'unica che può stare lì, e solo
perché protetta da RLS.

---

## Limiti noti

- L'integrazione con la fatturazione è **per file, non via API**: non ho trovato
  documentazione pubblica di API per gli utenti finali di FatturaElettronica APP.
  Se il tuo piano ne prevede, un'integrazione diretta dal browser resterebbe
  comunque sconsigliata (la chiave sarebbe leggibile da chiunque apra la pagina):
  servirebbe una Edge Function Supabase a custodire il segreto.
- La numerazione delle fatture non è gestita dal gestionale: il numero lo scrivi
  tu, coerente con il registro tenuto nel software di fatturazione.
- Le notifiche sono **in-app**. Per l'invio email servirebbe una Edge Function
  Supabase con un provider SMTP: non è inclusa.
- Non c'è gestione documentale versionata: i file sono un elenco piatto per commessa.
- I template sono nel file. Modificarli non tocca le commesse già generate: usa
  *"＋ Aggiungi fasi da template"* per integrare le fasi mancanti su una commessa
  esistente (non duplica ciò che c'è già).
- La chiave anon Supabase è nel sorgente: è corretto e previsto, ma **richiede che
  RLS sia attiva su tutte le tabelle**. La migrazione la configura sulle tabelle
  nuove; verifica che lo sia anche su quelle preesistenti.
