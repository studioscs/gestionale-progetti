# Test

```bash
npm install
node logic.js   # logica pura: date, template, pianificazione, avanzamento
node e2e.js     # end-to-end in Chromium contro mock.js (Supabase in memoria)
```

`e2e.js` costruisce `app-test.html` sostituendo il CDN Supabase con `mock.js`.
Nessun test tocca il database reale.
