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
6. [`sql/007_referente_tecnico.sql`](sql/007_referente_tecnico.sql) — secondo referente di commessa
7. [`sql/008_anagrafica_clienti.sql`](sql/008_anagrafica_clienti.sql) — anagrafica clienti
8. [`sql/009_costi_personale.sql`](sql/009_costi_personale.sql) — costo orario e costo del lavoro per commessa
9. [`sql/010_lavori_sisma.sql`](sql/010_lavori_sisma.sql) — contrassegno lavori sisma e IBAN dedicato
10. [`sql/011_fatturazione_pa.sql`](sql/011_fatturazione_pa.sql) — fatturazione alla PA, registro uffici, CIG/CUP separati
11. [`sql/012_dl_sal_varianti.sql`](sql/012_dl_sal_varianti.sql) — SAL, varianti e maturazione del compenso di DL
12. [`sql/013_ordine_pratiche.sql`](sql/013_ordine_pratiche.sql) — ordine di esecuzione delle pratiche
13. [`sql/014_chat_attivita.sql`](sql/014_chat_attivita.sql) — conversazione dentro ogni attività
14. [`sql/015_blocco_autopromozione.sql`](sql/015_blocco_autopromozione.sql) — **falla di sicurezza: da eseguire**
15. [`sql/016_progressivo_invio.sql`](sql/016_progressivo_invio.sql) — progressivo di invio persistente
16. [`sql/017_ore_fase.sql`](sql/017_ore_fase.sql) — ore stimate ed effettive della fase

(`003_permessi_pratiche.sql` è facoltativo: serve solo se vuoi che anche i
collaboratori possano eliminare le pratiche.)

> **Se salti una migrazione l'app te lo dice, e ti dice quale.** All'avvio, se
> manca una tabella, compare un avviso in cima alla pagina con l'elenco esatto dei
> file da eseguire. E se un salvataggio fallisce perché manca una colonna, il
> messaggio nomina la migrazione che la introduce — non un generico "esegui la
> 001", che costringerebbe a provarle tutte.

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

### 2-bis. La 015 chiude una falla, non aggiunge una funzione

La politica di aggiornamento di `profiles` permette a ciascuno di modificare la
propria riga — serve, perché ognuno deve poter correggere il proprio nome. Ma
l'RLS decide **quali righe** si possono toccare, non **quali colonne**: un
collaboratore poteva quindi chiamare l'API con la chiave anon — che è pubblica,
sta dentro `index.html` — e scriversi `role = 'admin'` sulla propria riga.

Verificato su PostgreSQL 16 prima della correzione: l'aggiornamento passava e il
ruolo diventava `admin`. Da lì si vedono i costi orari di tutti, si eliminano
commesse e si cambiano i ruoli altrui.

La 015 aggiunge un trigger che, quando chi scrive non è amministratore, rimette
ruolo e stato ai valori di prima. Non nega l'aggiornamento — il nome deve poter
cambiare — nega la modifica di quelle due colonne, **nel database e non
nell'interfaccia**, perché l'interfaccia si aggira.

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

La sezione *File Commesse* è stata rimossa: i documenti si tengono dove lo studio
già li tiene, e un archivio in più da mantenere allineato è un archivio in meno
di cui fidarsi.

Il bucket privato `commesse` resta previsto dalla 006 e continua a essere svuotato
quando una commessa viene eliminata, perché nelle installazioni già in uso può
contenere file caricati prima. Su un'installazione nuova non serve crearlo.

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
- **Anagrafica clienti** (voce *Clienti*): un cliente che torna non si riscrive.
  Nel modulo di creazione commessa lo scegli dall'elenco e dati fiscali, sede e
  referenti vengono compilati da soli; se è nuovo lo compili lì e viene aggiunto
  all'anagrafica al salvataggio, senza passaggi in più. Ogni scheda mostra le sue
  commesse, quante sono attive e l'importo complessivo.

  La commessa conserva una **copia** dei dati del cliente, non un semplice
  riferimento: se fra due anni il cliente cambia sede, le fatture già emesse
  restano coerenti con quanto fu dichiarato allora. Il collegamento resta per
  sapere di chi si tratta.

  Eseguendo la migrazione 008 i clienti delle commesse già create vengono
  **importati automaticamente**, unendo i dati più completi trovati e
  ricollegando le commesse.
- **Due referenti per commessa**, con ruoli distinti perché servono a cose diverse:
  l'**amministrativo** riceve la copia della fattura, l'**operativo** le
  comunicazioni tecniche e di cantiere. Di ciascuno si registrano nominativo,
  ruolo, email e telefono; nella scheda *Anagrafica* i contatti sono cliccabili e
  ci sono due scorciatoie che aprono una bozza di email già intestata — al
  referente operativo con i riferimenti della commessa, all'amministrativo con
  numero, imponibile, IVA e totale della fattura (l'allegato va aggiunto a mano:
  un `mailto:` non può allegare file).
- **Costo del lavoro per commessa** (solo amministratori). In *Amministrazione →
  Utenti* ogni collaboratore ha un **costo orario lordo** (retribuzione più oneri:
  quello che la commessa paga davvero) e un **netto**, con una data di decorrenza.
  Nella scheda **Ore** di ogni commessa compare allora un pannello con costo del
  lavoro, costo orario medio, durata effettiva dalla prima all'ultima registrazione
  di ore, margine sull'importo di commessa e la tabella di chi ci ha lavorato con
  ore, costo e quota percentuale. Se qualcuno ha registrato ore senza avere una
  tariffa nel periodo, il pannello lo dice invece di far passare per buono un costo
  più basso del reale.

  Due scelte deliberate dietro a questa funzione:

  - **I costi non stanno in `profiles`.** Quella tabella è leggibile da ogni utente
    autenticato — serve ad assegnare le attività e mostrare i nomi. Mettendoci lo
    stipendio, chiunque potrebbe leggere quello degli altri interrogando l'API con
    la chiave anon, che è pubblica. I costi vivono in `profili_costi`, con RLS che
    ammette i soli amministratori. Non è una questione di interfaccia: un
    collaboratore che interroga il database a mano ottiene comunque zero righe.
  - **I costi sono storicizzati.** Un aumento non riscrive il costo delle commesse
    già chiuse. Ogni riga vale da una data a un'altra; salvando un nuovo costo il
    periodo precedente si chiude da solo il giorno prima, e le ore già registrate
    restano valorizzate alla tariffa di allora. Se correggi un costo lasciando la
    stessa decorrenza, è una correzione del periodo in corso e non ne apre uno nuovo.

- **Conto di accredito** — nel modulo di creazione commessa c'è la casella *Lavoro
  di ricostruzione post-sisma*: spuntandola, tutte le fatture di quella commessa
  riportano l'IBAN del conto dedicato invece di quello ordinario. La scelta si fa
  una volta all'apertura del lavoro, così nessuno deve ricordarsene al momento di
  emettere. L'IBAN in uso è scritto nella scheda *Anagrafica* e in quella
  *Fatturazione*.
- **Committente pubblico** — spuntando *Il committente è un ente pubblico* nel
  modulo commessa si compilano Codice Univoco Ufficio, CIG, CUP, atto di
  affidamento e oggetto del servizio. Digitando un codice ufficio già usato, i
  dati del committente si ricompilano da soli. La fattura esce in formato FPA12
  con CIG e CUP al posto giusto e la scissione dei pagamenti.
- **Ogni fattura si rivede prima di generarla**: il pulsante 📥 apre una finestra
  dove ogni campo dell'XML è modificabile e i totali si ricalcolano mentre scrivi.
  Finché manca un dato obbligatorio il pulsante *Genera* resta spento e la
  finestra dice cosa manca.
- **Sola direzione lavori e CSE** — c'è un percorso per gli incarichi che partono
  a progetto già approvato e gara già fatta: nessuna fase di progettazione, si
  comincia dall'atto di nomina. Nella scheda **Contabilità & SAL** si registrano
  gli stati di avanzamento e le varianti.
- **Il SAL fa maturare l'onorario da solo.** Registrato un SAL, il gestionale
  calcola la percentuale sull'importo contrattuale dei lavori e apre lo scaglione
  di fatturazione corrispondente, già pronto da emettere: compenso di DL per la
  percentuale del SAL, meno quanto già fatturato sui SAL precedenti.
- **La conversazione sta dentro l'attività.** Ogni attività ha una scheda
  *Conversazione*: lì si scrivono dubbi, misure da ricontrollare, risposte del
  committente — accanto al lavoro di cui parlano. Chi è assegnato e chi verifica
  ricevono la notifica, e il riquadro dice **prima** chi la riceverà: se
  l'attività non ha né assegnatario né verificatore lo segnala, invece di
  lasciarti scrivere nel vuoto. In elenco, le attività con una conversazione
  mostrano 💬 con il numero di messaggi.
- **La pagina Chat non è dove si scrive: è dove si vede.** Raccoglie tutti i
  messaggi in ordine di tempo, raggruppati per giorno, con ricerca e filtro per
  commessa. Cliccando un messaggio si apre la sua attività, già sulla scheda
  della conversazione: si riprende il discorso dov'era rimasto invece di doverlo
  ritrovare.
- **Il proprio costo orario si imposta come quello degli altri.** Nella pagina
  *Utenti* anche la propria riga ha il pulsante Modifica. Sulla propria scheda
  ruolo e stato sono bloccati: declassarsi o disattivarsi da soli chiuderebbe
  fuori senza più modo di rimediare dall'app.
- **Redditività** (solo admin): per ogni commessa, quanto ha reso e come si
  divide. Vedi sotto.
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
node audit.js        # audit statico: funzioni, id, stato, migrazioni, cataloghi
node logic.js        # 194 asserzioni su date, template, pianificazione, avanzamento, costi
node e2e.js          # 201 test end-to-end in Chromium su un mock di Supabase
node walk.js         # giro completo dell'interfaccia a caccia di errori a runtime
node password.js     # 11 test sul recupero password
node fattura.js      # 87 controlli su FatturaPA privati e PA, validati contro l'XSD ufficiale
```

`e2e.js` copre: login, wizard a 3 passi, generazione della struttura, spunta e
riapertura di un'attività, avanzamento automatico delle fasi, popover di
assegnazione e scadenza, drag & drop Kanban, calcolo dei termini di legge,
Gantt pluriennale, archiviazione con ripristino, eliminazione con conferma e
verifica che non restino record orfani, filtri e raggruppamenti delle pratiche,
invio ed eliminazione di messaggi in chat, anagrafica clienti, costo orario dei
collaboratori con chiusura del periodo precedente, tutte le pagine e l'assenza di
errori in console.
`mock.js` è un Supabase in memoria: i test non toccano il database reale.

### `audit.js` — quello che i test non vedono

I test coprono i comportamenti che qualcuno ha pensato di verificare. `audit.js`
cerca i guasti nel codice che nessun test attraversa: funzioni chiamate e mai
definite, `el('...')` su id inesistenti, gestori agganciati a pulsanti che non
ci sono, chiavi di stato lette e mai scritte, tabelle interrogate dall'app ma
assenti dalle migrazioni, condizioni usate nei template ma non dichiarate,
chiavi duplicate nei cataloghi, codice morto.

Per farlo, dal sorgente vengono prima tolti commenti, stringhe e letterali
regex. Senza quel passaggio ogni parola italiana seguita da una parentesi in un
commento verrebbe scambiata per una chiamata di funzione — e un audit che grida
al lupo cento volte non lo legge più nessuno.

### `walk.js` — il giro dell'interfaccia

Apre ogni pagina, ogni scheda e ogni modale, con i tre ruoli, sia a database
vuoto sia con una commessa per ciascun template, e poi **clicca ogni pulsante di
ogni pagina** passando dalla delega degli eventi come farebbe una persona.
Raccoglie qualunque errore di esecuzione. Non verifica comportamenti: serve a
stanare quello che si rompe solo arrivando in un punto preciso — una pagina che
va in errore quando non c'è niente da mostrare, una scheda che dà per scontati
dati assenti, un pulsante collegato a nulla.

140 passi. I comandi distruttivi sono esclusi apposta: cancellerebbero i dati a
metà giro e il rumore che ne segue nasconderebbe i guasti veri.

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
Entrate** dalla suite `test/fattura.js` in sei varianti: con contributo cassa,
con ritenuta d'acconto, con PEC al posto del codice destinatario, con l'IBAN nei
dati di pagamento, verso la Pubblica Amministrazione con CIG/CUP e split payment,
e con le modifiche fatte a mano in revisione.

### Il gestionale non trasmette allo SdI

Il pulsante 📥 **scarica un file**, e finisce lì. Non c'è nessuna chiamata di
rete verso l'esterno: la trasmissione al Sistema di Interscambio la fa
FatturaElettronica APP dopo l'importazione, ed è lei a gestire firma, ricevute e
conservazione sostitutiva.

È una scelta, non un pezzo mancante: trasmettere allo SdI richiede credenziali, e
questo gestionale è un unico file HTML pubblico con la chiave Supabase in chiaro
dentro. Metterci credenziali fiscali significherebbe regalarle a chiunque apra il
sorgente.

> Alla generazione dell'XML lo scaglione passa a **emessa**. In quel momento hai
> però soltanto scaricato un file: se lo SdI dovesse scartare la fattura, il
> gestionale non lo verrebbe a sapere. Qui "emessa" significa *XML prodotto e
> passato al software di fatturazione*, non *accettata dallo SdI*.

### Il nome del file non si ripete mai

Nome file e `ProgressivoInvio` devono essere **unici per chi trasmette**: è così
che lo SdI riconosce un invio già fatto, e i software di fatturazione fanno lo
stesso in importazione.

Il progressivo lo assegna il database (migrazione 016), una volta sola per
fattura, e resta scritto sulla riga. Rigenerando l'XML dello stesso documento si
riusa il suo numero — è la stessa fattura — mentre una fattura nuova ne prende
uno mai usato. La finestra di revisione mostra il nome del file prima di
generarlo.

> Prima della 016 il progressivo era una variabile tenuta in memoria dal browser,
> **azzerata a ogni ricaricamento della pagina**. Due fatture generate in due
> momenti diversi uscivano quindi con lo stesso nome file: il software di
> fatturazione le leggeva come un documento già importato e non proponeva più
> l'invio. Se hai file già prodotti con quel difetto, rigenerali dopo la 016.

### Prima di generare: la finestra di revisione

Il pulsante 📥 non produce più il file di slancio: apre una **finestra di
revisione** con tutto quello che finirà nell'XML in campi modificabili — numero,
data, imponibile, oggetto, dati del committente, CIG, CUP, atto di affidamento,
aliquote, regime IVA, IBAN, giorni di pagamento. Il riepilogo degli importi si
ricalcola mentre si scrive, e in fondo c'è l'anteprima dell'XML.

Serve perché un dato sbagliato scoperto dopo l'invio allo SdI non si corregge
più: si emette una nota di credito. Meglio trenta secondi di controllo prima.

Le modifiche valgono **per quel file** e non riscrivono la commessa: il caso
tipico è l'oggetto adattato a questo stato di avanzamento, che non deve cambiare
l'incarico. Fanno eccezione numero e data della fattura, che tornano sullo
scaglione perché è quello che si rilegge poi negli elenchi. Un pulsante
*Ripristina i dati della commessa* annulla tutte le correzioni.

Finché manca qualcosa di obbligatorio il pulsante *Genera XML* resta disattivato
e la finestra elenca esattamente cosa manca.

### Fatturare a una stazione appaltante

Nel modulo di creazione commessa la casella **"Il committente è un ente
pubblico"** apre il blocco dei dati che servono solo alla PA. Cambia parecchio
rispetto a una fattura fra privati:

| | Privato | Ente pubblico |
|---|---|---|
| Formato di trasmissione | FPR12 | **FPA12** |
| Destinatario | codice SDI, 7 caratteri | **Codice Univoco Ufficio, 6 caratteri** |
| CIG e CUP | non previsti | **CIG obbligatorio**, CUP se il progetto ne ha uno |
| IVA | incassata da noi | **scissione dei pagamenti**: la versa l'ente |

**Il Codice Univoco Ufficio è la chiave.** Digitandolo, se quell'ufficio è già
nel registro, denominazione, codice fiscale, indirizzo, CAP, comune, provincia e
PEC del committente si ricompilano da soli. Il registro **si popola da sé**: ogni
commessa pubblica salvata ci lascia dentro il suo ufficio, quindi dalla seconda
commessa con lo stesso ente non si digita più nulla. Se il codice non è in
archivio lo si compila una volta e resta.

Il codice identifica l'*ufficio*, non l'ente: lo stesso comune ha spesso più
uffici con codici diversi, ed è per questo che va chiesto insieme all'incarico.
Se non lo si conosce si cerca su [indicepa.gov.it](https://indicepa.gov.it).

**CIG e CUP sono ora due campi separati** — prima erano un campo solo. Sono cose
diverse: il CIG identifica la procedura di affidamento (10 caratteri), il CUP il
progetto di investimento pubblico (15 caratteri), e in fattura vanno in due
elementi distinti. La migrazione 011 separa da sola i valori già inseriti
insieme, ma **solo quando è certa**: interviene se la stringa contiene esattamente
due gruppi, uno di 10 e uno di 15 caratteri. In ogni altro caso lascia tutto
com'è, da sistemare a mano — meglio un dato da correggere che un dato spostato
male.

Serve anche il **riferimento all'atto di affidamento** (determina, contratto o
ordine, max 20 caratteri): non è un capriccio, è lo schema — CIG e CUP viaggiano
dentro il blocco del documento correlato, che senza il riferimento al documento
non è valido. Senza, i codici non si possono proprio trasmettere.

**L'oggetto del servizio** si incolla dal disciplinare d'incarico: è la dicitura
che l'ente si aspetta di rileggere identica in fattura per liquidarla senza
chiedere chiarimenti. Finisce nella causale del documento e nella descrizione
della riga. Se supera i 200 caratteri ammessi da ciascuna causale viene spezzato
su più elementi invece di essere troncato.

> **Il copia-incolla da Word è gestito.** I campi di testo della FatturaPA
> accettano solo Latin-1: lettere accentate sì, ma virgolette curve (`’` `“` `”`),
> trattini lunghi (`—`) e puntini di sospensione (`…`) no — esattamente i
> caratteri che Word mette al posto di quelli battuti. Vengono convertiti da soli
> nell'equivalente battibile, e gli a capo appiattiti. Senza questo passaggio una
> dicitura incollata dall'incarico farebbe scartare la fattura per un motivo
> incomprensibile a chi la emette.

### Due conti correnti: ordinario e sisma

Lo studio incassa su due conti: uno **dedicato alla ricostruzione post-sisma** e
uno per tutto il resto. Le somme non devono mescolarsi, perché la rendicontazione
del contributo guarda i movimenti di quel conto.

Se l'IBAN lo sceglie una persona al momento di emettere la fattura, prima o poi
finisce sul conto sbagliato e correggerlo costa una nota di credito. Per questo la
scelta si fa **una volta sola, all'apertura della commessa**: nel modulo di
creazione c'è la casella *Lavoro di ricostruzione post-sisma*, e sotto compare
subito l'IBAN che verrà usato. Da lì in poi ogni fattura di quella commessa esce
con il conto giusto, senza che nessuno debba ricordarselo.

L'IBAN scelto è ripetuto in chiaro in due punti dove serve vederlo: nella scheda
**Anagrafica** della commessa e nel riquadro *Dati per la fattura elettronica*
della scheda **Fatturazione**, accanto a un'etichetta che dice se si tratta del
conto sisma o di quello ordinario.

Prima di generare l'XML l'IBAN viene **verificato formalmente** (lunghezza, paese,
resto 1 sul modulo 97). Non dice che il conto esiste, ma intercetta una cifra
sbagliata prima che finisca su una fattura già trasmessa allo SdI, quando l'unico
rimedio è la nota di credito.

> Il blocco `STUDIO` in cima a `index.html` è **già compilato** con i dati dello
> studio: STUDIO TECNICO SCS SRL STP, P.IVA 02077580435, sede in Recanati (MC),
> iscrizione REA MC-279947, e i due IBAN (ordinario e sisma). Resta da aggiungere,
> se lo si vuole esporre in fattura, il capitale sociale.
>
> Il codice univoco `N92GLON` e la PEC dello studio sono conservati nella
> configurazione ma **non entrano nelle fatture emesse**: servono da comunicare ai
> fornitori, perché in una fattura in uscita il codice destinatario è quello del
> cliente.
>
> I valori sono impostati per una **S.r.l. tra Professionisti**:
> regime ordinario `RF01`, contributo integrativo Inarcassa `TC04` al 4% soggetto
> a IVA, **nessuna ritenuta d'acconto** (le società di capitali non vi sono
> soggette). **Fai verificare la configurazione al tuo commercialista**: il
> gestionale calcola quello che gli dici, non stabilisce il trattamento fiscale.

I dati fiscali del committente (partita IVA o codice fiscale, sede, codice
destinatario SDI o PEC) si compilano nella scheda della commessa.

---

## Edilizia privata: il percorso completo

Il percorso privato copre l'intervento di rilievo dallo stato legittimo
all'agibilità: **16 fasi e circa 130 attività**, con tutte le discipline che il
committente si aspetta di trovare — architettonico, strutture, impianti,
energetica, acustica, barriere architettoniche, sicurezza.

L'ordine delle fasi è esso stesso un'informazione, e i test lo verificano:

1. **Incarico e fattibilità** — CDU, vincoli, fattibilità, disciplinare
2. **Stato legittimo e rilievo** — accesso agli atti, art. 9-bis, tolleranze art. 34-bis, eventuale sanatoria art. 36-bis
3. **Indagini e diagnosi** — geologia, materiali, impianti esistenti
4. **Preliminare e verifiche urbanistiche** — parametri, RAI, oneri, gialli e rossi
5. **Dati definitivi e firme** — qui si firmano *tutte* le procure, in una sola seduta
6. **Pareri e autorizzazioni** — paesaggistica, Soprintendenza, VVF, idrogeologico, acustica…
7. **Progetto architettonico** — l'elenco degli elaborati a corredo del titolo
8. **Strutture e pratica sismica** — artt. 93/94, denuncia c.a.
9. **Impianti** — elettrico, termomeccanico, idrico, gas, FV, VMC
10. **Energetica e rinnovabili** — relazione ex L.10, requisiti minimi, obbligo FER 60%
11. **Requisiti acustici passivi**
12. **Sicurezza in progettazione** — PSC e fascicolo
13. **Presentazione del titolo**
14. **Avvio del cantiere** — notifica preliminare, denuncia c.a., amianto, terre e rocce
15. **Direzione lavori**
16. **Fine lavori, collaudi e agibilità** — collaudo statico, APE, DOCFA, poi agibilità

**Le firme stanno al punto 5, non alla fine.** Le procure per le piattaforme si
generano prima delle istanze agli enti, che sono a loro volta pratiche
telematiche: ogni procura vale per un solo procedimento (art. 1392 c.c.), quindi
si firmano tutte insieme in una convocazione sola.

### Il Salva Casa è dentro il percorso

La L. 105/2024 ha riscritto proprio i passaggi iniziali, e il percorso li segue:
lo **stato legittimo** nella nuova formulazione dell'art. 9-bis c. 1-bis, le
**tolleranze costruttive** dell'art. 34-bis scaglionate per soglie di superficie,
la **sanatoria dell'art. 36-bis** con doppia conformità attenuata per le
difformità parziali, e le deroghe ad altezze e superfici per l'**agibilità**
dell'esistente.

### Le pratiche escono già in ordine di esecuzione

Il catalogo conta ora **43 pratiche**, ciascuna con un numero d'ordine, e
l'elenco le mostra in sequenza invece che per nome dell'ente. Non è estetica:
sbagliare l'ordine è la causa più comune di cantieri fermi.

- accesso agli atti e CDU **prima** di progettare
- eventuale sanatoria **prima** del nuovo titolo
- pareri vincolanti (paesaggistica, Soprintendenza, VVF, idrogeologico) **prima**
  del titolo edilizio — un titolo depositato senza nasce inefficace
- deposito sismico **dopo** il titolo ma **prima** dell'inizio lavori
- collaudo statico, DOCFA e APE **prima** dell'agibilità, che li richiama

La migrazione 013 riallinea anche le pratiche già create nelle commesse aperte
prima, altrimenti resterebbero in ordine casuale per sempre.

### Ogni elaborato dice cosa deve contenere

Come per il PFTE pubblico, le attività che corrispondono a un elaborato portano
il riferimento normativo e un campo **"cosa deve contenere"**, consultabile dalla
riga di checklist. Vale per la relazione di calcolo (compreso il giudizio
motivato di accettabilità dei risultati, quello che manca più spesso), per la
relazione ex L.10, per il PSC, per la tavola dei gialli e rossi, per la SCIA di
agibilità e per un'altra ventina di voci.

Anche qui: **sintesi operative, non testo di legge**, con il richiamo esatto alla
norma perché il riscontro sia immediato.

## Da dove vengono le ore

Tre fonti, in ordine di precedenza. Sopra c'è sempre il dato che qualcuno ha
scritto a mano, sotto quello che si ricava da solo.

**1. Le ore registrate** sulla commessa. Se qualcuno le registra valgono quelle:
è il dato vero e batte tutto.

**2. Le ore effettive scritte sulla fase**, in *Avanzamento*. Chi le compila sta
dicendo «questa fase è costata tanto», e il calcolo automatico si fa da parte per
quella fase. È la via d'uscita quando il calcolo non somiglia a com'è andata
davvero, e non costringe a registrare le ore una per una — che è esattamente ciò
che nessuno fa.

**3. Il calcolo automatico**, per tutto il resto. Nessuno registra le ore tutti i
giorni, e se il conto dipendesse solo da quelle una commessa lavorata per mesi
risulterebbe costata zero.

### Come lavora il calcolo automatico

L'unità di misura è la **fase**, non la singola spunta. Una fase ha un periodo:

- dalla **data di inizio** — quella che si scrive in *Avanzamento* quando la fase
  viene assegnata — al giorno in cui viene **chiusa**;
- se è ancora aperta, il periodo arriva **a oggi**: il lavoro in corso sta
  costando adesso;
- si contano i **giorni feriali** di quel periodo, da 8 ore l'uno (configurabile
  in `STUDIO.oreGiorno`). **Sabato e domenica non contano.**

Contano solo le fasi **avviate o concluse**. Le date che il template scrive alla
generazione sono un piano, non un consuntivo: se bastassero quelle, una commessa
appena creata risulterebbe subito costata mesi di lavoro. Lo stato della fase si
aggiorna da solo quando si spuntano le attività, quindi è un fatto e non una
previsione.

### A chi va quel tempo

A chi ha in carico le attività della fase — **tutte**, non solo quelle già
spuntate: chi ha in mano un elaborato ci sta lavorando anche prima di poterlo
dichiarare finito. L'ordine è:

1. l'**assegnatario** dell'attività;
2. se l'attività non è assegnata, il **responsabile della fase**;
3. solo in ultima istanza, chi l'ha **spuntata**.

Il terzo gradino è l'ultimo apposta. Chi spunta è spesso soltanto chi passa la
checklist — tipicamente sempre la stessa persona — ed è il motivo per cui prima
il costo di tutte le commesse finiva addosso a lei sola.

### Chi lavora e chi verifica: 70/30

Un'attività ha due caselle: **Assegnata a** — chi la fa — e **Verifica /
approva**. Quando sono due persone diverse il lavoro non è di una sola:

- **70% a chi la svolge** (l'assegnatario);
- **30% a chi la verifica**.

Chi verifica ci mette del tempo, ma non la giornata intera di chi ha prodotto
l'elaborato: attribuire tutto all'uno o all'altro falserebbe entrambi i costi.
Le due quote sommate fanno **una giornata sola**: il costo della commessa non
cresce, cambia solo a chi viene imputato. Se la casella della verifica è vuota,
o è la stessa persona, l'attività vale per intero a chi l'ha portata avanti.

Le percentuali sono in `STUDIO.quotaLavoro` e `STUDIO.quotaVerifica`. La modale
dell'attività dice, sotto le due caselle, come si dividerà il costo — così chi
assegna vede subito l'effetto sulla Redditività.

### Nessuno lavora più di una giornata al giorno

È la regola che tiene in piedi tutti i numeri. In un giorno una persona può avere
aperte più fasi, anche di commesse diverse: **la sua giornata si divide fra
quelle**. Se i pesi sommano meno di uno ognuno prende il suo; se sommano più di
uno si riducono in proporzione.

Senza questa divisione la stessa giornata verrebbe contata per intero su ogni
commessa, e sommando le commesse verrebbero fuori settimane da quaranta giorni:
numeri che non reggono il confronto con la realtà e che renderebbero inutile
l'intera pagina.

### Le quattro caselle in Avanzamento

Dentro ogni fase, sopra l'elenco delle attività:

| Casella | A cosa serve |
|---|---|
| **Data inizio** | da qui parte il conteggio dei giorni feriali |
| **Fine prevista** | la scadenza pianificata della fase |
| **Ore stimate** | il preventivo interno. **Non entra nel costo**: serve a vedere lo scostamento fra quanto si era previsto e quanto è venuto fuori |
| **Ore effettive** | quante ore la fase è costata davvero. Se c'è, **vince sul calcolo automatico** e si divide fra chi ha partecipato secondo gli stessi pesi 70/30 |

Sotto le caselle il riquadro dice sempre da dove escono le ore — periodo, giorni
feriali, totale — e **a chi vanno**, persona per persona. Se non va a nessuno lo
dice in rosso: vuol dire che le attività non sono assegnate e la fase non ha un
responsabile.

La stima resta una stima, e l'interfaccia lo dice sempre: ogni riga indica se le
ore sono **registrate**, **stimate** o **forzate sulla fase**, e la pagina spiega
in cima da dove vengono i numeri.

Nella scheda di ogni commessa c'è **Dove è andato il tempo**: giorni, ore e costo
fase per fase, con chi ci ha lavorato e per quanti giorni. È lì che si vede se
una fase è costata più di quanto valeva.

## Redditività: chi fattura allo studio e cosa resta

In uno studio associato la stessa persona può essere due cose insieme: chi
lavora e chi emette parcella allo studio. **Le ore di un socio non sono un costo
del personale come le altre: sono una fattura che arriverà.**

La sezione *Redditività* — riservata agli amministratori — fa questo conto per
ogni commessa:

| | |
|---|---|
| **Guadagno totale** | l'importo della commessa |
| − **Quota dei soci** | quanto ciascun socio dovrà fatturare per le ore fatte |
| − **Costo interno** | le ore di chi socio non è: stipendi e oneri |
| = **Residuo** | quello che gli altri soci possono ancora fatturare |

**Socio = amministratore.** Tutti gli utenti con ruolo *admin* sono soci, senza
eccezioni e senza un elenco a parte da tenere aggiornato: nominare un socio è una
cosa sola — gli si dà il ruolo *amministratore* da **Utenti** — e da quel momento
le sue ore finiscono automaticamente fra quelle da fatturare allo studio invece
che nel costo del personale.

Il residuo è **una cosa sola vista da due lati**, non due voci diverse: è
capienza finché qualcuno la usa, ed è **guadagno extra dello studio** se a
commessa chiusa nessuno se l'è presa. La scheda lo dice a parole, così non serve
interpretarlo.

Se le ore valgono più di quanto la commessa incassa, il residuo va in negativo e
compare l'avviso di **capienza superata**: da lì in poi non c'è più niente da
fatturare e ogni ora aggiunta è perdita.

Quando qualcuno ha registrato ore in un periodo per cui non è impostato un costo
orario, quelle ore contano zero e i totali risultano più favorevoli del vero: la
pagina lo segnala in cima invece di lasciar leggere numeri sbagliati.

## Direzione lavori: SAL, varianti e compenso che matura col cantiere

Il compenso per direzione lavori e CSE non matura a fasi come la progettazione:
matura con l'avanzamento del cantiere. Se la DL emette il SAL n. 2 che porta i
lavori contabilizzati al 55%, allo studio spetta il 55% del compenso, meno quanto
già fatturato.

Farlo a mano vuol dire ricalcolare ogni volta la differenza e ricordarsi di
emettere. È il punto in cui più spesso si perdono soldi, perché **un SAL non
fatturato non se lo ricorda nessuno**. Qui il calcolo lo fa il database quando il
SAL viene registrato.

Servono due importi sulla commessa, da non confondere:

| | Che cos'è |
|---|---|
| **Importo contrattuale dei lavori** | l'appalto dell'impresa: la base su cui si calcola la percentuale del SAL |
| **Compenso per DL e CSE** | la quota del *nostro* onorario che matura col cantiere |

L'importo del SAL va inserito **progressivo** — i lavori contabilizzati
dall'inizio, non quelli del solo periodo. È l'errore più comune e porterebbe a
fatturare due volte lo stesso avanzamento; il modulo lo dice in cima, e mentre si
scrive mostra quanto quel SAL renderà fatturabile.

Le **varianti** si registrano nella stessa scheda. Una variante approvata aumenta
l'importo contrattuale dei lavori, e i SAL successivi calcolano la percentuale
sulla nuova base. Vale anche per una variante inserita già approvata — il caso
normale, quando si registra a posteriori qualcosa deciso il mese prima.

Quando c'è compenso maturato e non ancora fatturato, la scheda lo dice a chiare
lettere con l'importo.

## Il PFTE segue l'Allegato I.7

Il D.Lgs 36/2023 ha ridotto i livelli di progettazione a due: **PFTE ed
esecutivo**. Il PFTE ha assorbito il vecchio progetto definitivo, quindi la fase
*Progetto definitivo* è stata tolta dal percorso delle opere pubbliche (resta in
quello privato, dove il definitivo è una fase di prassi e non un livello del
Codice).

Le attività del PFTE ricalcano ora gli elaborati dell'**Allegato I.7, art. 6
c. 7**, lettera per lettera: dalla relazione generale al piano di sicurezza e
coordinamento, più il piano particellare di esproprio quando la condizione
*Espropri e asservimenti* è attiva.

Lo stesso vale per il **progetto esecutivo**, che segue l'**art. 22 c. 1** dalla
lettera a) alla m): relazione generale, relazioni specialistiche, elaborati
grafici (architettonici, strutturali e impiantistici), calcoli esecutivi di
strutture e impianti, piano di manutenzione, aggiornamento del PSC, quadro di
incidenza della manodopera, cronoprogramma, elenco prezzi, computo e quadro
economico, schema di contratto e capitolato speciale.

Ogni attività porta con sé il riferimento normativo e un campo **"cosa deve
contenere"**, consultabile dalla riga di checklist senza aprire l'attività.
Qualche esempio di ciò che i testi ricordano:

- il **piano di manutenzione** è tre documenti, non uno: manuale d'uso, manuale
  di manutenzione e programma di manutenzione articolato nei sottoprogrammi
  delle prestazioni, dei controlli e degli interventi;
- i **calcoli esecutivi** devono contenere il giudizio motivato di accettabilità
  dei risultati del calcolo automatico;
- il **quadro di incidenza della manodopera** serve alla verifica dell'anomalia,
  quindi un dato sbagliato lì si trascina in tutta la gara;
- il **computo** va allineato ai grafici: una discordanza diventa una riserva.

Il *fascicolo dell'opera* compare accanto agli elaborati dell'art. 22 ma **non è
una delle sue lettere**: nasce dall'Allegato XVI del D.Lgs 81/2008 ed è
richiamato per quello, senza attribuirgli una lettera che non ha.

> **Quei testi sono sintesi operative, non il testo di legge.** Il contenuto
> degli articoli non è stato trascritto alla lettera: l'ambiente in cui il
> gestionale è stato sviluppato blocca l'accesso alle banche dati normative, e
> riportare a memoria il testo di una norma è il modo peggiore di trattarla.
> Ogni voce richiama l'articolo esatto perché sia verificabile in un attimo, e
> l'app stessa lo ripete accanto al testo. Prima di una consegna, il riscontro
> va fatto sull'Allegato.

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

Il repository è pubblico e l'app è servita da **GitHub Pages** dal ramo `main`
tramite il flusso [`.github/workflows/pages.yml`](.github/workflows/pages.yml):
ogni push pubblica, non c'è nulla da caricare a mano.

> **Impostazione necessaria, una volta sola:** *Settings → Pages → Build and
> deployment → Source:* **GitHub Actions**. Con la pubblicazione "da ramo" i push
> fatti da un'applicazione non facevano ripartire il rilascio in modo affidabile,
> e il sito restava fermo a una versione precedente finché qualcuno non caricava
> un file dall'interfaccia web. Dalla scheda *Actions* puoi anche ripubblicare a
> mano con *Run workflow*. Dopo un
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
