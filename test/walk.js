/* =============================================================================
   GIRO COMPLETO DELL'INTERFACCIA
   Non verifica comportamenti (a quello servono gli altri test): apre ogni
   pagina, ogni scheda e ogni modale, con i tre ruoli e con il database sia
   pieno sia vuoto, e raccoglie qualunque errore di esecuzione.

   Serve a stanare i guasti che si vedono solo arrivando in un punto preciso:
   una pagina che va in errore quando non c'e' nulla da mostrare, una scheda che
   presuppone dati assenti, una modale che si apre su una commessa senza figli.
   ============================================================================= */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

function build() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const out = src.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/,
                          '<script src="mock.js"></script>');
  if (out === src) throw new Error('tag CDN Supabase non trovato');
  fs.writeFileSync(path.join(__dirname, 'app-test.html'), out);
}
function launchOpts() {
  for (const p of ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
                   '/opt/pw-browsers/chromium/chrome-linux/chrome'])
    if (fs.existsSync(p)) return { executablePath: p };
  return {};
}

const PAGINE = ['oggi','projects','pratiche','tasks','kanban','timeline','scadenzario',
                'firme','fatturare','clienti','time','chat','users'];
const SCHEDE = ['avanzamento','pratiche','fatture','contabilita','anagrafica','ore'];
const MODALI = ['m-proj','m-task','m-prat','m-time','m-user','m-fatt','m-cli','m-sal','m-var','m-del','m-rev'];

(async () => {
  build();
  const b = await chromium.launch(launchOpts());
  const p = await b.newPage({ viewport: { width: 1440, height: 960 } });

  const errori = [];
  let contesto = 'avvio';
  p.on('pageerror', e => errori.push({ dove: contesto, msg: 'ECCEZIONE: ' + e.message }));
  p.on('console', m => { if (m.type() === 'error') errori.push({ dove: contesto, msg: m.text() }); });
  p.on('dialog', async d => { await d.accept(); });

  await p.goto('file://' + __dirname + '/app-test.html');
  await p.waitForSelector('#app.show', { timeout: 8000 });

  const passi = [];
  const passo = async (nome, fn) => { contesto = nome; passi.push(nome); await fn(); };

  /* ---------- 1. DATABASE VUOTO: ogni pagina deve reggere il nulla ---------- */
  for (const pg of PAGINE) {
    await passo('vuoto · pagina ' + pg, async () => {
      await p.evaluate(k => go(k), pg);
      await p.waitForTimeout(220);
    });
  }

  /* ---------- 2. MODALI a database vuoto ---------- */
  await passo('vuoto · modali', async () => {
    for (const m of MODALI) {
      await p.evaluate(id => { try { openM(id); } catch (e) { console.error('openM ' + id + ': ' + e.message); } }, m);
      await p.waitForTimeout(120);
      await p.evaluate(id => closeM(id), m);
    }
  });

  /* ---------- 3. Popolamento: una commessa per ogni template ---------- */
  const tpl = await p.evaluate(() => Object.keys(TEMPLATES));
  for (const k of tpl) {
    await passo('genera template ' + k, async () => {
      await p.evaluate(async key => {
        const { data } = await SB.from('projects').insert({
          name: 'Prova ' + key, status: 'attivo', start_date: '2026-03-02',
          client: 'Committente ' + key, amount: 50000,
          importo_lavori: 400000, compenso_dl: 20000,
          cliente_piva: '02345670541', cliente_indirizzo: 'Via Roma 1',
          cliente_cap: '62019', cliente_comune: 'Recanati', cliente_prov: 'MC',
          cliente_sdi: 'ABCDEF1'
        }).select().single();
        await generaStruttura(data.id, key, CONDIZIONI.map(c => c.k), '2026-03-02');
        await loadAll(true);
      }, k);
      await p.waitForTimeout(400);
    });
  }

  /* ---------- 4. Ogni pagina, ora con i dati ---------- */
  for (const pg of PAGINE) {
    await passo('pieno · pagina ' + pg, async () => {
      await p.evaluate(k => go(k), pg);
      await p.waitForTimeout(260);
    });
  }

  /* ---------- 5. Ogni scheda di ogni commessa ---------- */
  const ids = await p.evaluate(() => S.projects.map(x => x.id));
  for (const pid of ids) {
    for (const tab of SCHEDE) {
      await passo('commessa · scheda ' + tab, async () => {
        await p.evaluate(([id, t]) => { S.projId = id; S.tab = t; go('project'); }, [pid, tab]);
        await p.waitForTimeout(160);
      });
    }
  }

  /* ---------- 6. Modali con dati reali ---------- */
  await passo('modali con dati', async () => {
    await p.evaluate(async () => {
      const pid = S.projects[0].id;
      openNewProj();            closeM('m-proj');
      openEditProj(pid);        closeM('m-proj');
      const t = S.tasks.find(x => x.project_id === pid);
      if (t) { openTask(t.id);  closeM('m-task'); }
      const pr = S.pratiche.find(x => x.project_id === pid);
      if (pr) { openPratica(pr.id); closeM('m-prat'); }
      openOre(pid);             closeM('m-time');
      openUser(S.me.id);        closeM('m-user');
      openFatt(pid);            closeM('m-fatt');
      openSal(pid);             closeM('m-sal');
      openVar(pid);             closeM('m-var');
      openCliente();            closeM('m-cli');
      await openDelProj(pid);   closeM('m-del');
    });
    await p.waitForTimeout(400);
  });

  /* ---------- 7. Revisione fattura, il percorso piu' lungo ---------- */
  await passo('revisione fattura', async () => {
    await p.evaluate(async () => {
      const pid = S.projects[0].id;
      const { data } = await SB.from('commessa_fatture').insert({
        project_id: pid, descrizione: 'Acconto', imponibile: 5000, stato: 'pronta', ordine: 1
      }).select().single();
      await loadAll(true);
      openRevisione(data.id);
    });
    await p.waitForTimeout(500);
    /* tocca ogni campo della revisione: e' dove si annidano i null */
    const campi = await p.locator('#rev-body [data-rev]').count();
    for (let i = 0; i < campi; i++) {
      const el = p.locator('#rev-body [data-rev]').nth(i);
      const tag = await el.evaluate(e => e.tagName);
      if (tag === 'SELECT') continue;
      await el.evaluate(e => { e.dispatchEvent(new Event('input', { bubbles: true })); });
    }
    await p.waitForTimeout(300);
    await p.evaluate(() => closeM('m-rev'));
  });

  /* ---------- 8. I tre ruoli su ogni pagina ---------- */
  for (const ruolo of ['collaboratore', 'viewer', 'admin']) {
    for (const pg of PAGINE) {
      await passo(ruolo + ' · pagina ' + pg, async () => {
        await p.evaluate(([r, k]) => { S.prof.role = r; go(k); }, [ruolo, pg]);
        await p.waitForTimeout(140);
      });
    }
  }

  /* ---------- 9. Filtri e raggruppamenti delle pratiche ---------- */
  await passo('filtri pratiche', async () => {
    await p.evaluate(() => { S.prof.role = 'admin'; go('pratiche'); });
    for (const g of ['ente', 'commessa', 'stato', '']) {
      await p.evaluate(v => { S.pgrp = v; render(); }, g);
      await p.waitForTimeout(120);
    }
    for (const f of ['da_preparare', 'inviata', 'ritardo', 'concluse', '']) {
      await p.evaluate(v => { S.pfil = v; render(); }, f);
      await p.waitForTimeout(120);
    }
  });

  /* ---------- 10. Clic su ogni pulsante di ogni pagina ----------
     Finora le funzioni sono state chiamate direttamente. Qui si passa dalla
     porta d'ingresso vera: il clic, che attraversa la delega degli eventi e i
     data-attributi. E' il percorso dell'utente, ed e' l'unico che dimostra che
     un pulsante sia davvero collegato a qualcosa.
     Si evitano i comandi distruttivi: cancellerebbero i dati a meta' giro e il
     rumore che ne segue nasconderebbe i guasti veri. */
  const EVITA = '.btn-d, [data-delprat], [data-act="ripristina"], #mp-del, #del-go, #mp-arch';
  for (const pg of PAGINE) {
    await passo('clic su tutti i pulsanti · ' + pg, async () => {
      await p.evaluate(k => { S.prof.role = 'admin'; go(k); }, pg);
      await p.waitForTimeout(250);
      const n = await p.locator('#page button:visible, #top-act button:visible').count();
      for (let i = 0; i < Math.min(n, 25); i++) {
        const b = p.locator('#page button:visible, #top-act button:visible').nth(i);
        if (!(await b.count())) continue;
        if (await b.evaluate((e, sel) => e.matches(sel) || !!e.closest(sel), EVITA)) continue;
        await b.click({ timeout: 2500 }).catch(() => {});
        await p.waitForTimeout(90);
        /* qualunque cosa si sia aperta, la si chiude e si riparte */
        await p.evaluate(() => document.querySelectorAll('.ov.show').forEach(m => m.classList.remove('show')));
      }
      await p.evaluate(k => go(k), pg);
      await p.waitForTimeout(120);
    });
  }

  /* ---------- 11. Schede della commessa raggiunte a clic ---------- */
  await passo('clic sulle schede di commessa', async () => {
    await p.evaluate(() => { S.projId = S.projects[0].id; go('project'); });
    await p.waitForTimeout(300);
    const n = await p.locator('#page [data-tab]').count();
    for (let i = 0; i < n; i++) {
      await p.locator('#page [data-tab]').nth(i).click({ timeout: 2500 }).catch(() => {});
      await p.waitForTimeout(200);
    }
  });

  /* ---------- 12. Ricerche a vuoto ---------- */
  await passo('ricerche senza risultati', async () => {
    await p.evaluate(() => {
      S.pq = 'zzzznessuno'; S.tq = 'zzzznessuno'; S.clQ = 'zzzznessuno'; S.prq = 'zzzznessuno';
      ['projects', 'tasks', 'clienti', 'pratiche'].forEach(k => { go(k); });
    });
    await p.waitForTimeout(300);
    await p.evaluate(() => { S.pq = ''; S.tq = ''; S.clQ = ''; S.prq = ''; });
  });

  await b.close();

  console.log('\npassi eseguiti: ' + passi.length);
  const veri = errori.filter(e => !/favicon|net::ERR_FILE/.test(e.msg));
  if (!veri.length) { console.log('GIRO COMPLETO SENZA ERRORI'); process.exit(0); }
  console.log('\n✗ ERRORI (' + veri.length + ')');
  const visti = new Set();
  veri.forEach(e => {
    const k = e.dove + '|' + e.msg.slice(0, 120);
    if (visti.has(k)) return;
    visti.add(k);
    console.log('   [' + e.dove + '] ' + e.msg.split('\n')[0].slice(0, 200));
  });
  process.exit(1);
})();
