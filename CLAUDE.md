# CLAUDE.md — SCS Gestionale Progetti

Istruzioni per Claude (Claude Code) che lavora su questo repository. Le regole
qui sotto sono state concordate con lo studio: seguile anche quando una
richiesta non le ripete. Il dettaglio di ogni funzione è nel `README.md`.

## Con chi parli e come

- Lo studio è **Studio Tecnico SCS SRL STP** (ingegneria/architettura). Chi
  scrive non è un programmatore: **rispondi in italiano**, in modo semplice,
  passo per passo, senza gergo tecnico. Se una cosa si fa nel pannello di
  Supabase o di GitHub, scrivi dove cliccare.
- Risposte brevi: cosa è cambiato, cosa vede l'utente, cosa resta da decidere.
- Prima di cambiare **dati veri** in blocco (stati, numeri, date su molte righe)
  o fare qualcosa di difficile da annullare, spiega cosa farai e chiedi
  conferma. Per una singola correzione richiesta esplicitamente, procedi.
- Se trovi incoerenze nei dati, segnalale con un elenco chiaro (codice
  commessa, cosa non torna) e proponi la correzione; non correggere da solo.

## Com'è fatto

- **`index.html`**: l'intera applicazione (HTML + CSS + JavaScript), nessun
  build. Usa Supabase dal CDN e pdfmake per i PDF.
- **`sql/NNN_*.sql`**: migrazioni del database Supabase, numerate.
- **`supabase/functions/ipa/`**: funzione Supabase per i dati dell'Indice PA.
- **`test/`**: test Playwright e Node con un database finto (`mock.js`).
- **Pubblicazione**: GitHub Pages con `.github/workflows/pages.yml`. Ogni push
  su `main` pubblica il sito.
- **Database**: Supabase, progetto `aaneazempmhuznvornwn`.

## Sicurezza — regole fisse

- Il repository è **pubblico** e la chiave *anon* di Supabase è in chiaro in
  `index.html`: **la protezione vera sono le regole RLS del database**. Ogni
  nuova tabella o funzione deve avere le sue regole d'accesso.
- **Mai** nel repository: la chiave *service_role*, credenziali dello SdI o di
  intermediari fiscali, password, dati personali reali di clienti (copie del
  database, elenchi, PDF con nomi): quelli restano fuori dal repository.
- Ruoli: `admin`, `collaboratore` (staff, scrivono); `viewer` (sola lettura);
  il **commercialista** è `viewer` con `vede_tutto = true`: vede e stampa
  tutto, non modifica nulla. Chi si iscrive da solo nasce `viewer` senza
  accesso; un utente disattivato non entra (migrazione 046).
- Nell'app chi non è admin/collaboratore è in **sola lettura**: le scritture
  sono bloccate prima di partire (`proteggiScritture`) e le finestre si
  aprono senza campi modificabili (CSS `body.ro`). Le finestre di sola
  stampa/consultazione hanno la classe `ro-ok`.

## Come si lavora

1. Lavora su un ramo, non direttamente su `main`.
2. Ogni modifica a `index.html` che l'utente vede: **incrementa `VERSIONE`**
   (`const VERSIONE = 'AAAA.MM.GG.N'`), così si capisce se il sito è aggiornato.
3. Aggiorna il `README.md` (sezione della funzione, ed elenco migrazioni).
4. Aggiungi o aggiorna i test, poi falli girare tutti (vedi sotto).
5. Commit con messaggio in italiano che spiega il perché; push sul ramo, poi
   porta il ramo su `main` per pubblicare e controlla che il workflow Pages
   finisca con successo (a volte GitHub Pages va in timeout: rilancia).
6. Di' all'utente il numero di versione da vedere e, se serve, di ricaricare.

## Migrazioni del database

- Una migrazione = un file `sql/NNN_nome.sql`, **idempotente** (rieseguibile
  senza danni), con in testa il commento IL PROBLEMA / LA CORREZIONE e in
  fondo una `select` di resoconto leggibile (l'editor SQL di Supabase mostra
  solo l'ultimo risultato).
- Le funzioni di servizio stanno nello schema `private`, `security definer`,
  con `set search_path = public` e `revoke` da `public, anon, authenticated`.
- La **`018_visibilita_commesse.sql` va rieseguita per ultima** dopo una
  migrazione che crea tabelle o tocca le regole d'accesso. Se cambi
  `vede_tutte_commesse()` o `commesse_visibili()`, aggiorna anche la 018,
  altrimenti rieseguirla annulla la modifica.
- Se la migrazione aggiunge colonne usate dall'app, aggiungile alla mappa
  `migrazioneDi` in `index.html` (serve ad avvisare se manca la migrazione).
- Prova la migrazione su un Postgres locale prima del database vero; sul
  database vero verifica dentro `begin; … rollback;` quando possibile.
- Le conferme di approvazione di Supabase a volte **non arrivano**: se una
  migrazione non si riesce ad applicare, dai all'utente il file da incollare
  in Supabase → SQL Editor → New query → Run, e poi verifica tu il risultato.
- Il database finto dei test (`test/mock.js`) deve **imitare i trigger**
  delle migrazioni che cambiano dati da soli: aggiornalo insieme alla
  migrazione.

## Test

Da `test/` (servono `npm install` e Playwright con Chromium):

```
node logic.js      # regole di calcolo
node fattura.js    # FatturaPA: XML valido sullo schema (XSD_FATTURAPA=percorso/fatturapa.xsd)
node e2e.js        # l'app intera su database finto (circa 10 minuti, ~400 test)
node password.js   # accesso, iscrizione, recupero password
node walk.js       # giro di tutte le pagine
node mobile.js     # telefono e tablet
```

Lancia gli script con il percorso completo o da dentro `test/`. Lo schema
XSD della FatturaPA non è nel repository (è quello ufficiale, con
`xmldsig-core-schema.xsd` accanto).

## Regole di dominio da non rompere

- **Scaglioni di fatturazione**: stati `da_emettere`, `emessa`, `incassata`,
  `annullata`. Lo stato «pronta» non c'è più (045): quello che si può
  fatturare subito è una **richiesta di fatturazione** (`richiesta_at`), fatta
  da una persona o nata dalla chiusura della fase agganciata; sparisce se la
  fase si riapre (047).
- **Fasi e commessa** (048): tutte le fasi completate → commessa
  «completato»; commessa completata → fasi completate; fase riaperta →
  commessa di nuovo «attivo».
- **Anno**: l'**anno di competenza** (ISA, Anno fiscale, report) è diverso
  dall'anno della **data prevista** (sezioni «Matureranno») e dall'anno della
  **data fattura** (fatturato per anno). Decide la data prevista; senza data
  prevista non si indovina l'anno: «data prevista da inserire».
- Voci di anni di competenza diversi con date diverse → lo scaglione si
  divide, una fattura per anno (una fattura ha una data sola).
- **ISA**: per competenza, compresi gli scaglioni non ancora fatturati
  (serve alla dichiarazione); report degli scaglioni senza tipologia.
- **Numeri di fattura**: serie `FE` (privati) e `PA` (enti pubblici); lo
  stesso numero in anni diversi è normale, un doppione è solo nello stesso
  anno. Dal 2027 il formato è `001/FE/27`, `001/PA/27`. Un numero vale solo
  per una fattura emessa.
- **Spese anticipate** (diritti di segreteria, bolli, catasto): esenti IVA
  art. 15 DPR 633/72, natura N1, fuori da imponibile, cassa e IVA.
- **Enti pubblici**: formato FPA12, codice univoco ufficio (6 caratteri, con i
  dati dall'Indice PA), CIG, scissione dei pagamenti.
- Tutti gli importi di riepilogo sono **imponibili**, salvo dove è scritto
  «totale» (con cassa e IVA) o «incassato».
