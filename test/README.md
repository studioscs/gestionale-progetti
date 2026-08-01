# Test

```bash
npm install
node logic.js   # logica pura: date, template, pianificazione, avanzamento
node e2e.js      # end-to-end in Chromium contro mock.js (Supabase in memoria)
node password.js # recupero password: link valido, scaduto, validazioni
node fattura.js  # calcolo del documento e conformità dell'XML allo schema FatturaPA

`fattura.js` valida l'XML contro lo schema ufficiale dell'Agenzia delle Entrate se
`xmllint` è installato e la variabile `XSD_FATTURAPA` punta al file `.xsd`
(altrimenti la validazione viene saltata e il resto dei controlli prosegue).
```

`e2e.js` costruisce `app-test.html` sostituendo il CDN Supabase con `mock.js`.
Nessun test tocca il database reale.
