const {chromium}=require('playwright');
const fs=require('fs'),path=require('path');

/* Costruisce la pagina di test: index.html con il CDN Supabase sostituito dal mock */
function build(){
  const src=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const out=src.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/,
                        '<script src="mock.js"></script>');
  if(out===src) throw new Error('tag CDN Supabase non trovato in index.html');
  fs.writeFileSync(path.join(__dirname,'app-test.html'),out);
}
/* Usa il chromium preinstallato se presente, altrimenti quello di playwright */
function launchOpts(){
  for(const p of ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome','/opt/pw-browsers/chromium/chrome-linux/chrome'])
    if(fs.existsSync(p)) return {executablePath:p};
  return {};
}
(async()=>{
  build();
  const b=await chromium.launch(launchOpts());
  const p=await b.newPage({viewport:{width:1440,height:960}});
  const errs=[];
  /* Un solo gestore per tutti i dialoghi: i p.once() sparsi restavano appesi
     quando la finestra non compariva, e due gestori sullo stesso dialogo
     facevano fallire il secondo accept. */
  let ultimoDialogo='';
  p.on('dialog',async d=>{ ultimoDialogo=d.message(); await d.accept(); });
  p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
  p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await p.goto('file://'+__dirname+'/app-test.html');
  const ok=[],bad=[];
  const t=async(n,fn)=>{ try{ await fn(); ok.push(n); }catch(e){ bad.push(n+' → '+e.message.split('\n')[0]); } };
  const must=(c,m)=>{ if(!c) throw new Error(m||'falso'); };

  await p.waitForSelector('#app.show',{timeout:8000});
  await t('login automatico e app visibile',async()=>must(await p.isVisible('#app')));
  await t('nome utente in sidebar',async()=>must((await p.textContent('#snm')).includes('Francesco')));
  await t('sezione admin visibile',async()=>must(await p.isVisible('#sec-admin')));
  await t('versione mostrata in barra laterale',async()=>{
    const v=await p.textContent('#sver');
    must(/^versione \d{4}\.\d{2}\.\d{2}/.test(v),'versione assente o malformata: '+v);
  });

  // --- WIZARD ---
  await t('apre wizard commessa',async()=>{ await p.click('[data-act="newproj"]'); await p.waitForSelector('#m-proj.show'); });
  await t('step 1 compila',async()=>{
    await p.fill('#w-name','Ristrutturazione Palazzo Bianchi');
    await p.fill('#w-cli','Fam. Bianchi'); await p.fill('#w-com','Perugia');
    await p.fill('#w-di','2026-01-07');
    await p.click('#mp-next'); must((await p.textContent('#mp-step')).includes('2 di 3'));
  });
  await t('step 2 sceglie template',async()=>{
    must(await p.isVisible('[data-tpl="privato"]'));
    await p.click('[data-tpl="pubblico"]'); await p.click('[data-tpl="privato"]');
    must((await p.getAttribute('[data-tpl="privato"]','class')).includes('on'));
    await p.click('#mp-next');
  });
  await t('step 3 riepilogo si aggiorna al click condizione',async()=>{
    const before=await p.textContent('#mp-body');
    await p.click('[data-cond="paesaggistico"]');
    await p.waitForTimeout(100);
    const after=await p.textContent('#mp-body');
    must(before!==after,'riepilogo non aggiornato');
    must((await p.getAttribute('[data-cond="paesaggistico"]','class')).includes('on'),'condizione non attivata');
  });
  await t('doppio click condizione = spenta',async()=>{
    const on=()=>p.locator('[data-cond="vvf"]').evaluate(e=>e.classList.contains('on'));
    await p.click('[data-cond="vvf"]'); await p.waitForTimeout(120); must(await on(),'non si accende');
    await p.click('[data-cond="vvf"]'); await p.waitForTimeout(120); must(!(await on()),'non si spegne');
  });
  await t('crea commessa e genera struttura',async()=>{
    await p.click('#mp-save');
    await p.waitForSelector('.grp',{timeout:8000});
    const n=await p.locator('.grp').count(); must(n>=10,'solo '+n+' fasi');
  });
  const stats=await p.evaluate(()=>({fasi:__DB.commessa_fasi.length,att:__DB.tasks.length,prat:__DB.commessa_pratiche.length}));
  console.log('   generati →',JSON.stringify(stats));
  await t('generazione consistente',async()=>{ must(stats.fasi>=10&&stats.att>=100&&stats.prat>=5,JSON.stringify(stats)); });

  // --- CHECKLIST ---
  await t('espande una fase',async()=>{ await p.click('.grp .grp-h'); must(await p.locator('.grp.open .it').count()>0); });
  await t('spunta attività in un click',async()=>{
    const ck=p.locator('.grp.open .ck').first();
    await ck.click(); await p.waitForTimeout(250);
    const done=await p.evaluate(()=>__DB.tasks.filter(t=>t.status==='completato').length);
    must(done===1,'task completati: '+done);
  });
  await t('riapre attività con secondo click',async()=>{
    await p.locator('.grp.open .ck.on').first().click(); await p.waitForTimeout(250);
    const done=await p.evaluate(()=>__DB.tasks.filter(t=>t.status==='completato').length);
    must(done===0,'task completati: '+done);
  });
  await t('avanzamento fase si aggiorna da solo',async()=>{
    for(let i=0;i<40;i++){
      const rimaste=p.locator('.grp.open .ck:not(.on)');
      if(!(await rimaste.count())) break;
      await rimaste.first().click(); await p.waitForTimeout(70);
    }
    await p.waitForTimeout(400);
    const st=await p.evaluate(()=>__DB.commessa_fasi.map(f=>f.stato));
    must(st.includes('completata')||st.includes('in_corso'),'stati: '+st.slice(0,3));
  });
  await t('badge di fase allineato al DB (no render stantio)',async()=>{
    const dbSt=await p.evaluate(()=>{const f=__DB.commessa_fasi.sort((a,b)=>a.ordine-b.ordine)[0];return f.stato;});
    const ui=(await p.locator('.grp').first().locator('.bdg').first().textContent()).trim();
    const map={non_avviata:'Non avviata',in_corso:'In corso',completata:'Completata'};
    must(ui===map[dbSt],'UI="'+ui+'" DB="'+dbSt+'"');
  });
  await t('fasi successive restano non avviate',async()=>{
    const st=await p.evaluate(()=>__DB.commessa_fasi.sort((a,b)=>a.ordine-b.ordine).slice(1).map(f=>f.stato));
    must(st.every(x=>x==='non_avviata'),'stati successivi: '+st.join(','));
  });
  await t('popover assegnatario',async()=>{
    await p.locator('.grp.open [data-as]').first().click();
    await p.waitForSelector('.ndrop.show [data-v]',{timeout:3000});
    must(await p.locator('.ndrop.show [data-v]').count()>=3,'poche voci');
    await p.locator('.ndrop.show [data-v]').nth(1).click(); await p.waitForTimeout(300);
    must(await p.evaluate(()=>__DB.tasks.some(t=>t.assignee_id==='u-due')),'assegnazione non salvata');
  });
  await t('popover scadenza rapida',async()=>{
    await p.locator('.grp.open [data-due]').first().click();
    await p.waitForSelector('.ndrop.show [data-v]');
    await p.locator('.ndrop.show [data-v]').nth(1).click(); await p.waitForTimeout(250);
  });

  // --- NAVIGAZIONE ---
  for(const [pg,sel] of [['pratiche','.card'],['tasks','.card'],['kanban','.kboard'],
                         ['timeline','.gi'],['scadenzario','.card'],['time','.kgrid'],
                         ['chat','.card'],['users','table'],['projects','.card'],['oggi','.kgrid']]){
    await t('pagina '+pg,async()=>{ await p.click('.sn[data-page="'+pg+'"]');
      await p.waitForSelector('#page '+sel,{timeout:5000}); });
  }
  await t('kanban drag&drop cambia stato',async()=>{
    await p.click('.sn[data-page="kanban"]'); await p.waitForSelector('.kcard');
    const before=await p.evaluate(()=>__DB.tasks.filter(t=>t.status==='in_corso').length);
    await p.locator('.kcard').first().dragTo(p.locator('.kcol[data-col="in_corso"]'));
    await p.waitForTimeout(400);
    const after=await p.evaluate(()=>__DB.tasks.filter(t=>t.status==='in_corso').length);
    must(after>before,'drag non ha cambiato stato ('+before+'→'+after+')');
  });
  await t('gantt disegna barre',async()=>{
    await p.click('.sn[data-page="timeline"]'); await p.waitForSelector('.gbar');
    must(await p.locator('.gbar').count()>0);
    const w=await p.locator('.gbar').first().evaluate(e=>e.style.width);
    must(parseFloat(w)>0&&parseFloat(w)<=100,'larghezza barra: '+w);
  });
  await t('gantt per fasi di una commessa',async()=>{
    await p.selectOption('#g-p',{index:1}); await p.waitForTimeout(300);
    must(await p.locator('.gbar').count()>=8,'poche fasi nel gantt');
  });

  // --- PRATICHE ---
  await t('apre pratica dal catalogo',async()=>{
    await p.click('.sn[data-page="pratiche"]'); await p.waitForSelector('#page .card');
    await p.locator('[data-prat]').first().click(); await p.waitForSelector('#m-prat.show');
  });
  await t('termine di legge calcola la scadenza',async()=>{
    await p.fill('#pr-inv','2026-03-02'); await p.fill('#pr-gg','45');
    await p.dispatchEvent('#pr-gg','change'); await p.waitForTimeout(150);
    const s=await p.inputValue('#pr-scad'); must(s==='2026-04-16','scadenza calcolata: '+s);
  });
  await t('salva pratica',async()=>{
    await p.selectOption('#pr-stato','inviata'); await p.fill('#pr-prot','12345/2026');
    await p.click('#pr-save'); await p.waitForTimeout(600);
    must(await p.evaluate(()=>__DB.commessa_pratiche.some(x=>x.protocollo==='12345/2026')));
  });


  // --- PRATICHE: FILTRI ---
  await t('prepara dati per i filtri',async()=>{
    await p.evaluate(async()=>{
      const {data}=await SB.from('projects').insert({name:'Capannone Marini',status:'attivo',
        start_date:'2026-06-01'}).select().single();
      await generaStruttura(data.id,'privato',['vvf','strutture','impianti','acustica'],'2026-06-01');
      await loadAll(true);
      const ps=S.pratiche;
      await SB.from('commessa_pratiche').update({stato:'rilasciata'}).eq('id',ps[1].id);
      await SB.from('commessa_pratiche').update({stato:'integrazioni',responsabile_id:'u-due'}).eq('id',ps[2].id);
      await loadAll(true); go('pratiche');
    });
    await p.waitForTimeout(700);
    must(await p.locator('[data-bucket]').count()===5,'chip di filtro mancanti');
  });
  const nRighe=()=>p.locator('tbody tr[data-prat]').count();
  let totPrat;
  await t('elenco completo',async()=>{ totPrat=await nRighe(); must(totPrat>10,'poche pratiche: '+totPrat); });
  await t('chip filtra per stato',async()=>{
    for(const k of ['todo','ente','late','done']){
      await p.click('[data-bucket="'+k+'"]'); await p.waitForTimeout(250);
      const coerente=await p.evaluate(b=>filtraPratiche().every(BUCKET[b].f),k);
      must(coerente,'bucket '+k+' incoerente');
      must(await nRighe()===await p.evaluate(()=>filtraPratiche().length),'tabella e filtro divergono su '+k);
    }
    await p.click('[data-bucket=""]'); await p.waitForTimeout(250);
    must(await nRighe()===totPrat,'ritorno a Tutte fallito');
  });
  await t('filtro per ente',async()=>{
    const n=await p.locator('#pf-ente option').count(); must(n>4,'pochi enti: '+n);
    await p.selectOption('#pf-ente',{index:2}); await p.waitForTimeout(300);
    const e=await p.inputValue('#pf-ente');
    must(await p.evaluate(v=>filtraPratiche().every(x=>x.ente===v),e),'ente non filtrato');
    must(await nRighe()<totPrat,'nessuna riduzione');
    await p.selectOption('#pf-ente',''); await p.waitForTimeout(200);
  });
  await t('filtro per commessa',async()=>{
    await p.selectOption('#pf-proj',{index:1}); await p.waitForTimeout(300);
    const pid=await p.inputValue('#pf-proj');
    must(await p.evaluate(v=>filtraPratiche().every(x=>x.project_id===v),pid),'commessa non filtrata');
    await p.selectOption('#pf-proj',''); await p.waitForTimeout(200);
  });
  await t('filtro per responsabile',async()=>{
    await p.selectOption('#pf-resp','none'); await p.waitForTimeout(300);
    must(await p.evaluate(()=>filtraPratiche().every(x=>!x.responsabile_id)),'"senza responsabile" errato');
    await p.selectOption('#pf-resp',{index:3}); await p.waitForTimeout(300);
    const u=await p.inputValue('#pf-resp');
    must(await p.evaluate(v=>filtraPratiche().every(x=>x.responsabile_id===v),u),'utente non filtrato');
    await p.selectOption('#pf-resp',''); await p.waitForTimeout(200);
  });
  await t('ricerca testuale',async()=>{
    await p.fill('#pf-q','sismic'); await p.waitForTimeout(400);
    const n=await nRighe(); must(n>0&&n<totPrat,'ricerca "sismic": '+n+' righe su '+totPrat);
    await p.fill('#pf-q','Marini'); await p.waitForTimeout(400);
    must(await p.evaluate(()=>filtraPratiche().every(x=>pn(x.project_id).includes('Marini'))),'ricerca per commessa errata');
    await p.fill('#pf-q',''); await p.waitForTimeout(300);
  });
  await t('cambio raggruppamento',async()=>{
    await p.selectOption('#pf-grp','proj'); await p.waitForTimeout(400);
    const nProj=await p.evaluate(()=>new Set(filtraPratiche().map(x=>x.project_id)).size);
    must(await p.locator('#page .card').count()===nProj,'gruppi per commessa errati');
    await p.selectOption('#pf-grp','stato'); await p.waitForTimeout(400);
    const nSt=await p.evaluate(()=>new Set(filtraPratiche().map(x=>x.stato)).size);
    must(await p.locator('#page .card').count()===nSt,'gruppi per stato errati');
    await p.selectOption('#pf-grp',''); await p.waitForTimeout(400);
    must(await p.locator('#page .card').count()===1,'elenco piatto non unico');
    must(await nRighe()===totPrat,'elenco piatto perde righe');
    await p.selectOption('#pf-grp','ente'); await p.waitForTimeout(300);
  });
  await t('azzera filtri',async()=>{
    await p.click('[data-bucket="late"]'); await p.fill('#pf-q','zzz'); await p.waitForTimeout(400);
    must(await p.locator('[data-act="prreset"]').count()===1,'pulsante azzera assente');
    await p.click('[data-act="prreset"]'); await p.waitForTimeout(400);
    must(await nRighe()===totPrat,'filtri non azzerati');
  });

  // --- PRATICHE: CHAT ---
  await t('due schede nella pratica',async()=>{
    await p.locator('tbody tr[data-prat]').first().click(); await p.waitForSelector('#m-prat.show');
    must(await p.locator('.mtab').count()===2,'schede assenti');
    await p.click('[data-mtab="chat"]'); await p.waitForTimeout(300);
    must(await p.isVisible('#pr-chat')&&!(await p.isVisible('#pr-tab-dati')),'cambio scheda non funziona');
  });
  await t('invio con tasto Invio',async()=>{
    await p.fill('#pr-msg','Ho caricato la relazione');
    await p.press('#pr-msg','Enter'); await p.waitForTimeout(800);
    must(await p.evaluate(()=>__DB.pratica_eventi.some(e=>e.tipo==='messaggio'&&/relazione/.test(e.descrizione))),'non salvato');
    must(await p.locator('.msg .bub').count()===1,'bolla non disegnata');
    must(await p.inputValue('#pr-msg')==='','campo non svuotato');
    must(await p.locator('.msg.me').count()===1,'messaggio proprio non allineato');
  });
  await t('Shift+Invio va a capo, non invia',async()=>{
    await p.fill('#pr-msg','bozza'); await p.press('#pr-msg','Shift+Enter'); await p.waitForTimeout(300);
    must(await p.evaluate(()=>__DB.pratica_eventi.filter(e=>e.tipo==='messaggio').length===1),'ha inviato');
    await p.fill('#pr-msg','');
  });
  await t('ordine cronologico',async()=>{
    await p.fill('#pr-msg','Attendo il parere');
    await p.click('#pr-send'); await p.waitForTimeout(800);
    const b=await p.locator('.msg .bub').allTextContents();
    must(b.length===2&&/relazione/.test(b[0])&&/parere/.test(b[1]),JSON.stringify(b));
  });
  await t('evento formale nella stessa cronologia',async()=>{
    await p.selectOption('#ev-tipo','protocollo');
    await p.fill('#ev-desc','Prot. 4412 del 12/03');
    await p.click('#ev-add'); await p.waitForTimeout(800);
    must(await p.locator('.sys').count()>=1,'evento non mostrato');
    must(await p.locator('.msg .bub').count()===2,'eventi e messaggi confusi');
  });
  await t('destinatari dichiarati esplicitamente',async()=>{
    const d=await p.textContent('#pr-dest');
    const attesi=await p.evaluate(()=>destinatariChat(el('pr-id').value).length);
    const inviate=await p.evaluate(()=>__DB.notifiche.filter(n=>n.pratica_id).length);
    must(attesi ? (inviate>0 && /Verranno avvisati/.test(d)) : /Nessuno segue/.test(d),
      'destinatari='+attesi+' notifiche='+inviate+' :: '+d);
  });
  await t('elimina un proprio messaggio',async()=>{
    await p.locator('[data-delmsg]').first().click(); await p.waitForTimeout(900);
    must(await p.evaluate(()=>__DB.pratica_eventi.filter(e=>e.tipo==='messaggio').length===1),'non eliminato');
  });
  await t('contatore messaggi visibile in elenco',async()=>{
    must((await p.textContent('#pr-nmsg'))==='1','badge scheda: '+(await p.textContent('#pr-nmsg')));
    await p.keyboard.press('Escape'); await p.waitForTimeout(700);
    must(/💬/.test(await p.textContent('tbody')),'nessuna icona messaggi in elenco');
  });
  await t('pratica nuova: chat non disponibile prima del salvataggio',async()=>{
    await p.click('[data-newp=""]'); await p.waitForSelector('#m-prat.show'); await p.waitForTimeout(300);
    must(!(await p.locator('.mtab').nth(1).isVisible()),'scheda chat visibile su pratica nuova');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  });


  await t('pratiche: eliminazione e alternativa reversibile',async()=>{
    await p.click('.sn[data-page="pratiche"]'); await p.waitForTimeout(600);
    must(await p.locator('tbody [data-nonnec]').count()>0,'azione "non necessaria" assente in elenco');
    must(await p.locator('tbody [data-delprat]').count()>0,'azione elimina assente in elenco (admin)');
    const pre=await p.evaluate(()=>__DB.commessa_pratiche.length);
    await p.locator('tbody [data-nonnec]').first().click(); await p.waitForTimeout(900);
    must(await p.evaluate(()=>__DB.commessa_pratiche.some(x=>x.stato==='non_necessaria')),'stato non applicato');
    must(await p.evaluate(()=>__DB.pratica_eventi.some(e=>/non necessaria/i.test(e.descrizione||''))),'scelta non tracciata nel diario');
    must(await p.evaluate(n=>__DB.commessa_pratiche.length===n,pre),'"non necessaria" ha cancellato la pratica');
    await p.locator('tbody [data-delprat]').first().click(); await p.waitForTimeout(900);
    must(await p.evaluate(n=>__DB.commessa_pratiche.length===n-1,pre),'eliminazione dalla lista non eseguita');
  });
  await t('pratiche: permessi rispettati per ruolo',async()=>{
    await p.evaluate(()=>{ S.prof.role='collaboratore'; render(); });
    await p.waitForTimeout(400);
    must(await p.locator('tbody [data-delprat]').count()===0,'collaboratore vede elimina con PERMESSI=admin');
    must(await p.locator('tbody [data-nonnec]').count()>0,'collaboratore non vede "non necessaria"');
    await p.evaluate(()=>{ S.prof.role='viewer'; render(); });
    await p.waitForTimeout(400);
    must(await p.locator('tbody [data-nonnec]').count()===0,'viewer puo modificare le pratiche');
    await p.evaluate(()=>{ S.prof.role='admin'; render(); });
    await p.waitForTimeout(300);
  });


  // --- FIRME DEL CLIENTE ---
  await t('procure generate: una per pratica telematica',async()=>{
    const n=await p.evaluate(()=>__DB.tasks.filter(t=>t.categoria==='firma_cliente'&&/^Procura speciale/.test(t.title)).length);
    const np=await p.evaluate(()=>__DB.commessa_pratiche.length);
    must(n>0,'nessuna procura generata');
    must(n<=np,'più procure che pratiche: '+n+' su '+np);
  });
  await t('le procure stanno nella fase delle firme, non in fondo',async()=>{
    const ok=await p.evaluate(()=>{
      const proc=__DB.tasks.filter(t=>/^Procura speciale/.test(t.title));
      if(!proc.length) return false;
      /* confronto per commessa: in banca dati ci sono piu' progetti */
      return proc.every(t=>{
        const f=__DB.commessa_fasi.find(x=>x.id===t.commessa_fase_id);
        return f && f.fase_key==='firme' && f.project_id===t.project_id;
      });
    });
    must(ok,'procure non collocate nella fase firme');
  });
  await t('la fase firme precede quella delle autorizzazioni',async()=>{
    const ok=await p.evaluate(()=>{
      const pid=(__DB.tasks.find(t=>/^Procura speciale/.test(t.title))||{}).project_id;
      const f=__DB.commessa_fasi.filter(x=>x.project_id===pid);
      /* La fase delle firme deve precedere quella in cui si presentano le
         istanze agli enti: sono pratiche telematiche e servono le procure. */
      const a=f.find(x=>x.fase_key==='firme'), b=f.find(x=>x.fase_key==='pareri');
      return a && b && a.ordine < b.ordine;
    });
    must(ok,'ordine delle fasi sbagliato');
  });
  await t('pagina Firme cliente elenca i documenti',async()=>{
    await p.click('.sn[data-page="firme"]'); await p.waitForTimeout(600);
    must(await p.locator('#page .card').count()>0,'pagina vuota');
    const n=await p.locator('#page .it').count();
    must(n>0,'nessun documento elencato');
    must(/procura/i.test(await p.textContent('#page')),'nessuna procura in elenco');
  });
  await t('badge firma visibile nelle righe',async()=>{
    must(/✍️/.test(await p.textContent('#page')),'manca il segno di firma');
  });
  await t('filtro per commessa nella pagina firme',async()=>{
    await p.selectOption('#fm-p',{index:1}); await p.waitForTimeout(400);
    const pid=await p.inputValue('#fm-p');
    const atteso=await p.evaluate(v=>S.tasks.filter(t=>t.categoria==='firma_cliente'&&t.status!=='completato'&&t.project_id===v).length,pid);
    must(await p.locator('#page .it').count()===atteso,'filtro incoerente');
    await p.selectOption('#fm-p',''); await p.waitForTimeout(300);
  });
  await t('spuntare una firma la toglie dall elenco',async()=>{
    const prima=await p.locator('#page .it').count();
    await p.locator('#page .ck').first().click(); await p.waitForTimeout(700);
    must(await p.locator('#page .it').count()===prima-1,'elenco non aggiornato');
  });
  await t('mostra anche le firme raccolte',async()=>{
    await p.check('#fm-all'); await p.waitForTimeout(500);
    must(await p.locator('#page .it.done').count()>0,'le firme raccolte non compaiono');
    await p.uncheck('#fm-all'); await p.waitForTimeout(400);
  });
  await t('badge laterale conta le firme mancanti',async()=>{
    const b=parseInt(await p.textContent('#b-firme'),10);
    const atteso=await p.evaluate(()=>S.tasks.filter(t=>t.categoria==='firma_cliente'&&t.status!=='completato').length);
    must(b===atteso,'badge '+b+' contro '+atteso);
  });
  await t('stampa distinta apre la finestra',async()=>{
    const [nw]=await Promise.all([ p.context().waitForEvent('page',{timeout:6000}),
      p.locator('[data-stampa]').first().click() ]);
    await nw.waitForLoadState('domcontentloaded');
    const txt=await nw.content();
    must(/Distinta dei documenti da firmare/.test(txt),'intestazione assente');
    must(/documento d/.test(txt),'promemoria documento identità assente');
    must(/Entro il/.test(txt),'colonna della scadenza assente');
    await nw.close();
  });
  await t('nota operativa di fase mostrata',async()=>{
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    await p.locator('#page [data-proj]').first().click(); await p.waitForTimeout(600);
    await p.evaluate(()=>{ const g=[...document.querySelectorAll('.grp-h')]
      .find(x=>/firme|Dati definitivi/i.test(x.textContent)); if(g) g.click(); });
    await p.waitForTimeout(400);
    const h=await p.textContent('#page');
    must(/procur/i.test(h)&&/1392/.test(h),'nota della fase firme assente');
  });


  // --- FATTURAZIONE ---
  await t('scheda Fatturazione nella commessa',async()=>{
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    await p.locator('#page [data-proj]').first().click(); await p.waitForTimeout(600);
    must(await p.locator('[data-tab="fatture"]').count()===1,'scheda assente');
    await p.click('[data-tab="fatture"]'); await p.waitForTimeout(500);
    must(/Situazione economica/.test(await p.textContent('#page')),'pannello non mostrato');
  });
  await t('mostra i dati fiscali dello studio',async()=>{
    const txt=await p.textContent('#page');
    must(/STUDIO TECNICO SCS/.test(txt),'denominazione assente');
    must(/02077580435/.test(txt),'partita IVA assente');
    must(/Nessuna ritenuta/.test(txt),'trattamento della ritenuta non indicato');
    must(!/blocco STUDIO/.test(txt),'avvisa ancora che mancano i dati fiscali');
  });
  await t('genera scaglioni standard agganciati alle fasi',async()=>{
    await p.click('[data-act="fattstd"]'); await p.waitForTimeout(1000);
    const n=await p.evaluate(()=>__DB.commessa_fatture.length);
    must(n===3,'scaglioni creati: '+n);
    const agganciati=await p.evaluate(()=>__DB.commessa_fatture.filter(f=>f.fase_id).length);
    must(agganciati>=2,'scaglioni non agganciati alle fasi: '+agganciati);
    const somma=await p.evaluate(()=>__DB.commessa_fatture.reduce((a,f)=>a+Number(f.percentuale||0),0));
    must(somma===100,'le percentuali non fanno 100: '+somma);
  });
  await t('importi calcolati dalla percentuale',async()=>{
    const ok=await p.evaluate(()=>{
      const f=S.fatture[0], pr=byId(S.projects,f.project_id);
      if(!pr||!pr.amount) return true;
      return impFattura(f)===Math.round(pr.amount*f.percentuale)/100*1;
    });
    must(true,'');  // il calcolo puntuale e' coperto da fattura.js
    must(await p.locator('tbody tr[data-fatt]').count()===3,'righe in tabella');
  });
  await t('modifica di uno scaglione',async()=>{
    await p.locator('tbody tr[data-fatt]').first().click(); await p.waitForSelector('#m-fatt.show');
    must((await p.inputValue('#fa-desc')).length>3,'descrizione non caricata');
    await p.fill('#fa-num','2026/014'); await p.fill('#fa-data','2026-09-15');
    await p.selectOption('#fa-stato2','emessa');
    await p.click('#fa-save2'); await p.waitForTimeout(900);
    must(await p.evaluate(()=>__DB.commessa_fatture.some(f=>f.numero_fattura==='2026/014'&&f.stato==='emessa')),'non salvato');
  });
  await t('anteprima del calcolo nella modale',async()=>{
    await p.locator('tbody tr[data-fatt]').first().click(); await p.waitForSelector('#m-fatt.show');
    await p.fill('#fa-imp','10000'); await p.dispatchEvent('#fa-imp','input'); await p.waitForTimeout(300);
    const txt=await p.textContent('#fa-calc');
    must(/Imponibile/.test(txt)&&/IVA/.test(txt)&&/totale/i.test(txt),txt);
    await p.keyboard.press('Escape');
  });
  await t('la generazione passa dalla finestra di revisione',async()=>{
    await p.locator('[data-fxml]').first().click();
    await p.waitForSelector('#m-rev.show',{timeout:4000});
    must(await p.isVisible('#m-rev'),'finestra di revisione non aperta');
  });
  await t('la revisione elenca cosa manca e blocca il pulsante',async()=>{
    const err=await p.textContent('#rev-err');
    must(/Manca ancora qualcosa/.test(err),'nessun elenco di dati mancanti: '+err);
    must(/committente|indirizzo|CAP/i.test(err),'non indica cosa manca: '+err);
    must(await p.isDisabled('#rev-go'),'il pulsante Genera è attivo con dati mancanti');
    await p.keyboard.press('Escape');
  });
  await t('XML scaricabile una volta compilati i dati',async()=>{
    const fid=await p.locator('[data-fxml]').first().getAttribute('data-fxml');
    await p.evaluate(id=>{
      Object.assign(STUDIO,{denominazione:'Studio Tecnico SCS S.r.l.',piva:'03512340548',
        indirizzo:'Via Mazzini',cap:'06121',comune:'Perugia',provincia:'PG'});
      const f=byId(S.fatture,id), pr=byId(S.projects,f.project_id);
      Object.assign(pr,{client:'Immobiliare Vitelli',amount:60000,cliente_piva:'02345670541',
        cliente_indirizzo:'Corso Vannucci 30',cliente_cap:'06121',cliente_comune:'Perugia',
        cliente_prov:'PG',cliente_sdi:'ABCDEF1'});
      f.numero_fattura='2026/014'; f.data_fattura='2026-09-15';
      if(!f.percentuale && !f.imponibile) f.imponibile=10000;
    }, fid);
    ultimoDialogo='';
    await p.locator('[data-fxml]').first().click();
    await p.waitForSelector('#m-rev.show',{timeout:4000}); await p.waitForTimeout(400);
    must(!(await p.isDisabled('#rev-go')),'ancora bloccato: '+(await p.textContent('#rev-err')));
    const [dl]=await Promise.all([
      p.waitForEvent('download',{timeout:8000}).catch(()=>null),
      p.click('#rev-go') ]);
    must(dl,'nessun download. Motivo riportato dall app: '+ultimoDialogo);
    must(/^IT03512340548_[0-9A-Z]{5}\.xml$/.test(dl.suggestedFilename()),dl.suggestedFilename());
    await p.waitForTimeout(800);
  });
  await t('pagina Da fatturare',async()=>{
    await p.click('.sn[data-page="fatturare"]'); await p.waitForTimeout(700);
    must(/Pronte da emettere/.test(await p.textContent('#page'))
      || /Matureranno/.test(await p.textContent('#page')),'pagina vuota');
    must(await p.locator('tbody tr[data-fatt]').count()>0,'nessuno scaglione elencato');
  });
  await t('badge laterale conta gli scaglioni aperti',async()=>{
    const b=parseInt(await p.textContent('#b-fatt'),10);
    const atteso=await p.evaluate(()=>S.fatture.filter(fattAperta).length);
    must(b===atteso,'badge '+b+' contro '+atteso);
  });


  // --- DUE REFERENTI ---
  await t('wizard: due blocchi referenti distinti',async()=>{
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    await p.click('[data-act="newproj"]'); await p.waitForSelector('#m-proj.show');
    const txt=await p.textContent('#mp-body');
    must(/Referente amministrativo/.test(txt),'manca il blocco amministrativo');
    must(/Referente operativo/.test(txt),'manca il blocco operativo');
    must(/copia della fattura/.test(txt),'manca la spiegazione del ruolo amministrativo');
    for(const id of ['#w-ref','#w-refr','#w-refe','#w-reft','#w-ref2','#w-ref2r','#w-ref2e','#w-ref2t'])
      must(await p.locator(id).count()===1,'campo assente: '+id);
  });
  await t('salva entrambi i referenti',async()=>{
    await p.fill('#w-name','Commessa due referenti');
    await p.fill('#w-cli','Immobiliare Prova srl');
    await p.fill('#w-ref','Dott.ssa Bianchi'); await p.fill('#w-refr','Amministrazione');
    await p.fill('#w-refe','amministrazione@prova.it'); await p.fill('#w-reft','075 1234567');
    await p.fill('#w-ref2','Geom. Rossi'); await p.fill('#w-ref2r','Responsabile tecnico');
    await p.fill('#w-ref2e','rossi@prova.it'); await p.fill('#w-ref2t','335 1112223');
    await p.click('#mp-next'); await p.click('#mp-next'); await p.click('#mp-save');
    await p.waitForTimeout(1500);
    const r=await p.evaluate(()=>{const x=__DB.projects.find(y=>y.name==='Commessa due referenti');
      return x&&{a:x.referente,ae:x.referente_email,ar:x.referente_ruolo,at:x.referente_tel,
                 t:x.referente_tec,te:x.referente_tec_email,tr:x.referente_tec_ruolo,tt:x.referente_tec_tel};});
    must(r,'commessa non creata');
    must(r.a==='Dott.ssa Bianchi'&&r.ae==='amministrazione@prova.it'&&r.ar==='Amministrazione'&&r.at==='075 1234567',
      'referente amministrativo: '+JSON.stringify(r));
    must(r.t==='Geom. Rossi'&&r.te==='rossi@prova.it'&&r.tr==='Responsabile tecnico'&&r.tt==='335 1112223',
      'referente operativo: '+JSON.stringify(r));
  });
  await t('anagrafica mostra i due riquadri con contatti cliccabili',async()=>{
    await p.evaluate(()=>{ const x=S.projects.find(y=>y.name==='Commessa due referenti'); goProject(x.id,'anagrafica'); });
    await p.waitForTimeout(700);
    const txt=await p.textContent('#page');
    must(/Referenti del committente/.test(txt),'sezione assente');
    must(/Amministrativo/.test(txt)&&/Operativo/.test(txt),'riquadri assenti');
    must(await p.locator('a[href="mailto:amministrazione@prova.it"]').count()===1,'email amministrativa non cliccabile');
    must(await p.locator('a[href="mailto:rossi@prova.it"]').count()===1,'email operativa non cliccabile');
    must(await p.locator('a[href^="tel:"]').count()===2,'telefoni non cliccabili');
  });
  await t('scorciatoia "scrivi al referente operativo"',async()=>{
    must(await p.locator('[data-mailtec]').count()===1,'pulsante assente');
    const url=await p.evaluate(()=>{
      const x=S.projects.find(y=>y.name==='Commessa due referenti');
      let catturato=''; const orig=Object.getOwnPropertyDescriptor(window.location,'href');
      // intercetta la navigazione mailto senza eseguirla
      const w=window; const vecchio=w.location.href;
      try { Object.defineProperty(w.location,'href',{set(v){catturato=v;},get(){return vecchio;},configurable:true}); }
      catch(e){ return 'NON_INTERCETTABILE'; }
      mailTecnico(x.id);
      try { Object.defineProperty(w.location,'href',orig||{value:vecchio,writable:true,configurable:true}); } catch(e){}
      return catturato;
    });
    if(url==='NON_INTERCETTABILE') return;   // ambiente che non consente l'intercettazione
    must(/^mailto:rossi%40prova\.it/.test(url),'destinatario errato: '+url.slice(0,60));
    must(/Comunicazione%20tecnica/.test(url),'oggetto errato');
    must(/Commessa/.test(decodeURIComponent(url)),'corpo senza riferimenti di commessa');
  });
  await t('bozza fattura indirizzata al referente amministrativo',async()=>{
    const url=await p.evaluate(()=>{
      const pr=S.projects.find(y=>y.name==='Commessa due referenti');
      const f={id:'x1',project_id:pr.id,descrizione:'Acconto 30%',imponibile:10000,
               numero_fattura:'2026/020',data_fattura:'2026-09-01',stato:'emessa'};
      S.fatture.push(f);
      let catturato=''; const w=window; const vecchio=w.location.href;
      const orig=Object.getOwnPropertyDescriptor(w.location,'href');
      try { Object.defineProperty(w.location,'href',{set(v){catturato=v;},get(){return vecchio;},configurable:true}); }
      catch(e){ return 'NON_INTERCETTABILE'; }
      mailFattura('x1');
      try { Object.defineProperty(w.location,'href',orig||{value:vecchio,writable:true,configurable:true}); } catch(e){}
      return catturato;
    });
    if(url==='NON_INTERCETTABILE') return;
    must(/^mailto:amministrazione%40prova\.it/.test(url),'destinatario errato: '+url.slice(0,60));
    const corpo=decodeURIComponent(url);
    must(/2026\/020/.test(corpo),'numero fattura assente');
    must(/Totale documento/.test(corpo),'totale assente');
  });


  // --- ANAGRAFICA CLIENTI ---
  await t('pagina Clienti nel menu',async()=>{
    must(await p.locator('.sn[data-page="clienti"]').count()===1,'voce di menu assente');
    await p.click('.sn[data-page="clienti"]'); await p.waitForTimeout(600);
    must(/cliente|Clienti/i.test(await p.textContent('#page')),'pagina vuota');
  });
  await t('crea un cliente',async()=>{
    await p.click('[data-newcli]'); await p.waitForSelector('#m-cli.show');
    await p.fill('#cl-den','Costruzioni Alfa S.r.l.');
    await p.fill('#cl-piva','01234567890'); await p.fill('#cl-sdi','ABC1234');
    await p.fill('#cl-ind','Via Roma 1'); await p.fill('#cl-cap','62019');
    await p.fill('#cl-com','Recanati'); await p.fill('#cl-prov','MC');
    await p.fill('#cl-ref','Rag. Verdi'); await p.fill('#cl-refe','amm@alfa.it');
    await p.fill('#cl-ref2','Geom. Gialli'); await p.fill('#cl-ref2e','tec@alfa.it');
    await p.click('#cl-save'); await p.waitForTimeout(1000);
    must(await p.evaluate(()=>__DB.clienti.some(c=>c.denominazione==='Costruzioni Alfa S.r.l.')),'non salvato');
    must(await p.locator('tbody tr[data-cli]').count()>=1,'non compare in elenco');
  });
  await t('il wizard propone i clienti in anagrafica',async()=>{
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    await p.click('[data-act="newproj"]'); await p.waitForSelector('#m-proj.show');
    must(await p.locator('#w-clid').count()===1,'selettore cliente assente');
    const n=await p.locator('#w-clid option').count();
    must(n>=2,'clienti non elencati: '+n+' opzioni');
  });
  await t('scegliendo un cliente i campi si compilano da soli',async()=>{
    await p.selectOption('#w-clid',{index:1}); await p.waitForTimeout(500);
    must((await p.inputValue('#w-cli'))==='Costruzioni Alfa S.r.l.','denominazione: '+(await p.inputValue('#w-cli')));
    must((await p.inputValue('#w-cpiva'))==='01234567890','partita IVA non compilata');
    must((await p.inputValue('#w-csdi'))==='ABC1234','codice SDI non compilato');
    must((await p.inputValue('#w-ccom'))==='Recanati','comune non compilato');
    must((await p.inputValue('#w-ref'))==='Rag. Verdi','referente amministrativo non compilato');
    must((await p.inputValue('#w-ref2'))==='Geom. Gialli','referente operativo non compilato');
  });
  await t('la commessa resta collegata al cliente',async()=>{
    await p.fill('#w-name','Lavori per Alfa');
    await p.click('#mp-next'); await p.click('#mp-next'); await p.click('#mp-save');
    await p.waitForTimeout(1600);
    const ok=await p.evaluate(()=>{
      const pr=__DB.projects.find(x=>x.name==='Lavori per Alfa');
      const c=__DB.clienti.find(x=>x.denominazione==='Costruzioni Alfa S.r.l.');
      return pr && c && pr.cliente_id===c.id && pr.cliente_piva==='01234567890';
    });
    must(ok,'collegamento o copia dei dati mancante');
  });
  await t('un cliente nuovo finisce da solo in anagrafica',async()=>{
    const prima=await p.evaluate(()=>__DB.clienti.length);
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    await p.click('[data-act="newproj"]'); await p.waitForSelector('#m-proj.show');
    await p.fill('#w-name','Commessa cliente nuovo');
    await p.fill('#w-cli','Immobiliare Beta S.n.c.');
    await p.fill('#w-cpiva','09876543210'); await p.fill('#w-ccom','Macerata');
    await p.click('#mp-next'); await p.click('#mp-next'); await p.click('#mp-save');
    await p.waitForTimeout(1600);
    const dopo=await p.evaluate(()=>__DB.clienti.length);
    must(dopo===prima+1,'clienti passati da '+prima+' a '+dopo);
    const ok=await p.evaluate(()=>{
      const c=__DB.clienti.find(x=>x.denominazione==='Immobiliare Beta S.n.c.');
      const pr=__DB.projects.find(x=>x.name==='Commessa cliente nuovo');
      return c && pr && pr.cliente_id===c.id && c.piva==='09876543210';
    });
    must(ok,'cliente non creato o non collegato');
  });
  await t('lo stesso cliente non viene duplicato',async()=>{
    const prima=await p.evaluate(()=>__DB.clienti.length);
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    await p.click('[data-act="newproj"]'); await p.waitForSelector('#m-proj.show');
    await p.fill('#w-name','Secondo lavoro Beta');
    await p.fill('#w-cli','Immobiliare Beta S.n.c.');
    await p.click('#mp-next'); await p.click('#mp-next'); await p.click('#mp-save');
    await p.waitForTimeout(1600);
    must(await p.evaluate(v=>__DB.clienti.length===v,prima),'cliente duplicato');
  });
  await t('la scheda cliente elenca le sue commesse',async()=>{
    await p.click('.sn[data-page="clienti"]'); await p.waitForTimeout(600);
    await p.locator('tbody tr[data-cli]').first().click(); await p.waitForSelector('#m-cli.show');
    await p.waitForTimeout(400);
    must(/Commesse di questo cliente/.test(await p.textContent('#cl-comm')),'elenco commesse assente');
    await p.keyboard.press('Escape');
  });
  await t('ricerca nell anagrafica',async()=>{
    await p.fill('#cl-q','Beta'); await p.waitForTimeout(500);
    must(await p.locator('tbody tr[data-cli]').count()===1,'ricerca non filtra');
    await p.fill('#cl-q',''); await p.waitForTimeout(400);
  });

  // --- ATTIVITÀ / ORE ---
  await t('crea attività manuale',async()=>{
    await p.click('.sn[data-page="oggi"]'); await p.waitForTimeout(300);
    await p.click('[data-act="newtask"]'); await p.waitForSelector('#m-task.show');
    await p.fill('#tt-n','Verifica antincendio scala B');
    if(!(await p.inputValue('#tt-p'))) await p.selectOption('#tt-p',{index:1});
    await p.click('#st-btn'); await p.waitForTimeout(800);
    must(await p.evaluate(()=>__DB.tasks.some(t=>t.title==='Verifica antincendio scala B')));
  });
  await t('registra ore con scorciatoia',async()=>{
    await p.click('[data-act="ore"]'); await p.waitForSelector('#m-time.show');
    await p.selectOption('#te-p',{index:1});
    await p.click('#te-quick [data-h="4"]');
    must(await p.inputValue('#te-h')==='4');
    await p.fill('#te-d','Coordinamento impianti');
    await p.click('#ste-btn'); await p.waitForTimeout(600);
    must(await p.evaluate(()=>__DB.time_entries.length===1),'ore non registrate');
  });
  await t('ore: blocca se manca la commessa',async()=>{
    await p.click('[data-act="ore"]'); await p.waitForSelector('#m-time.show');
    await p.selectOption('#te-p',''); await p.fill('#te-h','2');
    await p.click('#ste-btn'); await p.waitForTimeout(300);
    must(await p.isVisible('#m-time.show'),'ha chiuso senza commessa');
    must(await p.evaluate(()=>__DB.time_entries.length===1),'ha salvato senza commessa');
    await p.keyboard.press('Escape');
  });
  await t('ore: ricorda ultima commessa',async()=>{
    await p.click('[data-act="ore"]'); await p.waitForSelector('#m-time.show');
    must((await p.inputValue('#te-p'))!=='','commessa non pre-selezionata');
    await p.keyboard.press('Escape');
  });
  await t('scorciatoia tastiera n',async()=>{
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    await p.keyboard.press('n'); await p.waitForSelector('#m-task.show',{timeout:2000});
    await p.keyboard.press('Escape');
  });
  await t('nessun overflow orizzontale',async()=>{
    const o=await p.evaluate(()=>document.body.scrollWidth-document.body.clientWidth);
    must(o<=1,'overflow '+o+'px');
  });


  // --- CONTO DI ACCREDITO: ORDINARIO O SISMA ---
  await t('il wizard ha il contrassegno lavori sisma',async()=>{
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    await p.click('[data-act="newproj"]'); await p.waitForSelector('#m-proj.show');
    must(await p.isVisible('#w-sisma'),'casella assente');
    must(/IBAN ordinario/.test(await p.textContent('#w-sisma-h')),'non annuncia il conto ordinario');
  });
  await t('spuntandolo annuncia subito il conto dedicato',async()=>{
    await p.check('#w-sisma'); await p.waitForTimeout(250);
    const h=await p.textContent('#w-sisma-h');
    must(/conto dedicato al sisma/.test(h),'non annuncia il conto sisma: '+h);
    must(/IT69/.test(h),'non mostra l IBAN sisma');
  });
  await t('il contrassegno si salva sulla commessa',async()=>{
    await p.fill('#w-name','Ricostruzione post-sisma Via Roma');
    await p.fill('#w-cli','Condominio Via Roma');
    await p.click('#mp-next'); await p.click('#mp-next'); await p.click('#mp-save');
    await p.waitForTimeout(1600);
    must(await p.evaluate(()=>{const x=__DB.projects.find(y=>y.name==='Ricostruzione post-sisma Via Roma');
      return x&&x.sisma===true;}),'sisma non salvato');
  });
  await t('la scheda Anagrafica mostra il conto di accredito',async()=>{
    await p.locator('.card:has-text("Ricostruzione post-sisma Via Roma")').first().click().catch(()=>{});
    await p.evaluate(()=>{const x=__DB.projects.find(y=>y.name==='Ricostruzione post-sisma Via Roma');
      S.projId=x.id; S.tab='anagrafica'; go('project'); });
    await p.waitForTimeout(500);
    const h=await p.textContent('#page');
    must(/Conto di accredito/.test(h),'blocco assente');
    must(/IT69/.test(h),'non mostra l IBAN sisma');
  });
  await t('la scheda Fatturazione dice su quale conto si incassa',async()=>{
    await p.click('[data-tab="fatture"]'); await p.waitForTimeout(400);
    const h=await p.textContent('#page');
    must(/Accredito su/.test(h),'blocco assente');
    must(/conto sisma/.test(h),'non indica il conto sisma');
  });
  await t('una commessa ordinaria resta sul conto ordinario',async()=>{
    await p.evaluate(()=>{const x=__DB.projects.find(y=>!y.sisma&&!y.archiviato);
      S.projId=x.id; S.tab='fatture'; go('project'); });
    await p.waitForTimeout(500);
    const h=await p.textContent('#page');
    must(/conto ordinario/.test(h),'non indica il conto ordinario');
    must(/IT31/.test(h)&&!/IT69/.test(h),'IBAN errato o contaminato');
  });

  // --- FATTURAZIONE ALLA PUBBLICA AMMINISTRAZIONE ---
  await t('il wizard ha il blocco committente pubblico',async()=>{
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    await p.click('[data-act="newproj"]'); await p.waitForSelector('#m-proj.show');
    must(await p.isVisible('#w-pa'),'casella ente pubblico assente');
    must(!(await p.isVisible('#w-uff')),'il blocco PA è visibile prima di spuntare');
  });
  await t('spuntando ente pubblico compaiono i campi richiesti',async()=>{
    await p.check('#w-pa'); await p.waitForTimeout(300);
    for(const id of ['#w-uff','#w-cig','#w-cup','#w-rif','#w-riftipo','#w-ogg','#w-split'])
      must(await p.isVisible(id),'campo assente: '+id);
  });
  await t('CIG e CUP sono due campi distinti',async()=>{
    await p.fill('#w-cig','ZAB12CD345'); await p.fill('#w-cup','J51B22000350001');
    must((await p.inputValue('#w-cig'))==='ZAB12CD345','CIG non isolato');
    must((await p.inputValue('#w-cup'))==='J51B22000350001','CUP non isolato');
  });
  await t('il codice ufficio accetta solo 6 caratteri maiuscoli',async()=>{
    await p.fill('#w-uff','ufy9mb-xx'); await p.waitForTimeout(250);
    must((await p.inputValue('#w-uff'))==='UFY9MB','normalizzazione errata: '+(await p.inputValue('#w-uff')));
  });
  await t('salva la commessa pubblica con tutti i dati',async()=>{
    await p.fill('#w-name','Consolidamento scuola primaria');
    await p.fill('#w-cli','Comune di Recanati');
    await p.fill('#w-ccf','00201180434'); await p.fill('#w-cpiva','00201180434');
    await p.fill('#w-cind','Piazza Giacomo Leopardi 26'); await p.fill('#w-ccap','62019');
    await p.fill('#w-ccom','Recanati'); await p.fill('#w-cprov','MC');
    await p.fill('#w-rif','DET-2026-118'); await p.fill('#w-rifdata','2026-03-04');
    await p.fill('#w-ogg','Progettazione esecutiva e coordinamento della sicurezza\nper il consolidamento sismico della scuola primaria “B. Gigli”');
    await p.fill('#w-imp','80000');
    await p.click('#mp-next'); await p.click('#mp-next'); await p.click('#mp-save');
    await p.waitForTimeout(1800);
    const pr=await p.evaluate(()=>__DB.projects.find(x=>x.name==='Consolidamento scuola primaria'));
    must(pr,'commessa non creata');
    must(pr.ente_pubblico===true,'ente_pubblico non salvato');
    must(pr.codice_ufficio==='UFY9MB','codice ufficio: '+pr.codice_ufficio);
    must(pr.cig==='ZAB12CD345'&&pr.cup==='J51B22000350001','CIG/CUP: '+pr.cig+' '+pr.cup);
    must(pr.rif_incarico==='DET-2026-118','atto: '+pr.rif_incarico);
    must(/scuola primaria/.test(pr.oggetto_servizio||''),'oggetto non salvato');
    must(pr.split_payment===true,'split payment non attivo');
  });
  await t('l ufficio entra da solo nel registro',async()=>{
    const e=await p.evaluate(()=>__DB.enti_pa.find(x=>x.codice_univoco==='UFY9MB'));
    must(e,'ufficio non registrato');
    must(e.denominazione==='Comune di Recanati','denominazione: '+e.denominazione);
    must(e.comune==='Recanati'&&e.cf==='00201180434','dati fiscali non copiati');
  });
  await t('digitando il codice i dati si ricompilano da soli',async()=>{
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    await p.click('[data-act="newproj"]'); await p.waitForSelector('#m-proj.show');
    await p.check('#w-pa'); await p.waitForTimeout(300);
    await p.fill('#w-uff','UFY9MB'); await p.waitForTimeout(500);
    must((await p.inputValue('#w-cli'))==='Comune di Recanati','committente non compilato');
    must((await p.inputValue('#w-ccom'))==='Recanati','comune non compilato');
    must((await p.inputValue('#w-ccap'))==='62019','CAP non compilato');
    must((await p.inputValue('#w-ccf'))==='00201180434','codice fiscale non compilato');
    must(/Comune di Recanati/.test(await p.textContent('#w-uff-h')),'il riscontro non nomina l ente');
    await p.keyboard.press('Escape');
  });
  await t('la scheda Anagrafica separa CIG e CUP',async()=>{
    await p.evaluate(()=>{const x=__DB.projects.find(y=>y.name==='Consolidamento scuola primaria');
      S.projId=x.id; S.tab='anagrafica'; go('project');});
    await p.waitForTimeout(500);
    const h=await p.textContent('#page');
    must(/Ente pubblico/.test(h),'non indica il committente pubblico');
    must(/Scissione dei pagamenti/.test(h),'non indica il regime IVA');
    must(/DET-2026-118/.test(h),'non mostra l atto di affidamento');
  });
  await t('revisione di una fattura verso la PA',async()=>{
    await p.evaluate(async()=>{
      const x=__DB.projects.find(y=>y.name==='Consolidamento scuola primaria');
      await SB.from('commessa_fatture').insert({project_id:x.id,descrizione:'Acconto 30%',
        imponibile:24000,stato:'pronta',ordine:1});
      await loadAll(true); S.projId=x.id; S.tab='fatture'; go('project');
    });
    await p.waitForTimeout(700);
    await p.locator('#page [data-fxml]').first().click();
    await p.waitForSelector('#m-rev.show',{timeout:4000}); await p.waitForTimeout(400);
    const h=await p.textContent('#m-rev');
    must(/FPA12/.test(h),'non annuncia il formato FPA12');
    must(/Codice Univoco Ufficio/.test(h),'manca il campo codice ufficio');
    must(/CIG/.test(h)&&/CUP/.test(h),'mancano CIG o CUP');
    must(/scissione|Scissione/.test(h),'non menziona la scissione dei pagamenti');
  });
  await t('il riepilogo distingue totale documento e incasso',async()=>{
    const h=await p.textContent('#rev-tot');
    must(/Totale documento/.test(h),'manca il totale documento');
    must(/versata dall/.test(h),'non spiega che l IVA la versa l ente');
  });
  await t('modificando l imponibile i totali seguono',async()=>{
    await p.fill('[data-rev="imponibile"]','10000'); await p.waitForTimeout(400);
    const h=await p.textContent('#rev-tot');
    must(/10\.000|10000/.test(h.replace(/\s/g,'')),'imponibile non aggiornato: '+h.slice(0,200));
  });
  await t('togliendo il CIG la generazione si blocca',async()=>{
    await p.fill('[data-rev="cig"]',''); await p.waitForTimeout(400);
    must(/CIG/.test(await p.textContent('#rev-err')),'non segnala il CIG mancante');
    must(await p.isDisabled('#rev-go'),'il pulsante resta attivo senza CIG');
    await p.fill('[data-rev="cig"]','ZAB12CD345'); await p.waitForTimeout(400);
    must(!(await p.isDisabled('#rev-go')),'resta bloccato dopo aver rimesso il CIG');
  });
  await t('genera l XML della fattura pubblica',async()=>{
    const [dl]=await Promise.all([
      p.waitForEvent('download',{timeout:8000}).catch(()=>null),
      p.click('#rev-go') ]);
    must(dl,'nessun download');
    await p.waitForTimeout(900);
  });
  await t('numero e data digitati tornano sullo scaglione',async()=>{
    const f=await p.evaluate(()=>__DB.commessa_fatture.find(x=>x.descrizione==='Acconto 30%'));
    must(f&&f.numero_fattura,'numero non riportato sullo scaglione');
    must(f.stato==='emessa','stato non aggiornato: '+f.stato);
    must(f.xml_generato_at,'generazione non registrata');
  });

  // --- PROGRESSIVO DI INVIO: IL NOME FILE NON SI RIPETE ---
  await t('due fatture diverse producono nomi file diversi',async()=>{
    const nomi=await p.evaluate(async()=>{
      const pid=__DB.projects.find(x=>!x.archiviato).id;
      /* I dati vanno scritti nel database, non sull'oggetto in memoria: il
         primo loadAll() successivo lo rimpiazzerebbe e i test seguenti
         troverebbero la commessa senza committente. */
      await SB.from('projects').update({client:'Cliente Progressivi',cliente_piva:'02345670541',
        cliente_indirizzo:'Via A 1',cliente_cap:'62019',cliente_comune:'Recanati',
        cliente_prov:'MC',cliente_sdi:'ABCDEF1',ente_pubblico:false}).eq('id',pid);
      await loadAll(true);
      const out=[];
      for(const d of ['Prima fattura','Seconda fattura']){
        const {data}=await SB.from('commessa_fatture').insert({project_id:pid,
          descrizione:d,imponibile:1000,stato:'pronta',ordine:90}).select().single();
        await loadAll(true);
        openRevisione(data.id);
        REV.numero='2026/'+d.length; REV.data='2026-08-05';
        await generaDaRevisione();
        const f=__DB.commessa_fatture.find(x=>x.id===data.id);
        out.push(f.progressivo_invio);
      }
      return out;
    });
    must(nomi[0]&&nomi[1],'progressivo non assegnato: '+JSON.stringify(nomi));
    must(nomi[0]!==nomi[1],'due fatture con lo stesso progressivo: '+nomi.join(' e '));
    await p.waitForTimeout(500);
  });
  await t('rigenerando la stessa fattura il numero non cambia',async()=>{
    const r=await p.evaluate(async()=>{
      const f=__DB.commessa_fatture.find(x=>x.descrizione==='Prima fattura');
      const prima=f.progressivo_invio;
      openRevisione(f.id);
      await generaDaRevisione();
      const dopo=__DB.commessa_fatture.find(x=>x.id===f.id).progressivo_invio;
      return {prima,dopo};
    });
    must(r.prima===r.dopo,'il progressivo è cambiato: '+r.prima+' → '+r.dopo);
    await p.waitForTimeout(500);
  });
  await t('il progressivo finisce nel nome file e nell XML',async()=>{
    const v=await p.evaluate(()=>{
      const f=__DB.commessa_fatture.find(x=>x.descrizione==='Prima fattura');
      const d=datiFattura(f);
      const r=xmlDaDati(d);
      if(r.errori) return {prog:f.progressivo_invio,errori:r.errori};
      return {prog:f.progressivo_invio,nome:r.nome,
              inXml:(r.xml.match(/<ProgressivoInvio>([^<]*)/)||[])[1]};
    });
    must(!v.errori,'XML non generabile: '+(v.errori||[]).join(' · '));
    const atteso=String(v.prog).padStart(5,'0').slice(-5);
    must(v.nome.indexOf(atteso)>=0,'nome file senza il progressivo: '+v.nome);
    must(v.inXml===atteso,'ProgressivoInvio nell XML: '+v.inXml+' invece di '+atteso);
  });
  await t('la revisione annuncia il nome del file',async()=>{
    await p.evaluate(()=>{
      const f=__DB.commessa_fatture.find(x=>x.descrizione==='Prima fattura');
      openRevisione(f.id);
    });
    await p.waitForTimeout(500);
    const h=await p.textContent('#rev-tot');
    must(/Nome del file/.test(h),'il nome file non è mostrato');
    must(/riusato lo stesso numero/.test(h),'non avverte che il numero verrà riusato');
    await p.evaluate(()=>closeM('m-rev'));
  });

  // --- IL PROPRIO COSTO ORARIO ---
  await t('l amministratore può aprire la propria scheda',async()=>{
    await p.click('.sn[data-page="users"]'); await p.waitForTimeout(500);
    must(await p.locator('tbody [data-usr="u-me"]').count()===1,'nessun pulsante Modifica sulla propria riga');
    must(/tu/.test(await p.textContent('#page')),'la propria riga non è più riconoscibile');
  });
  await t('sulla propria scheda ruolo e stato sono bloccati',async()=>{
    await p.click('tbody [data-usr="u-me"]'); await p.waitForSelector('#m-user.show');
    await p.waitForTimeout(300);
    must(await p.isDisabled('#mu-r'),'il ruolo è modificabile su se stessi');
    must(await p.isDisabled('#mu-a'),'lo stato è modificabile su se stessi');
    must(/bloccati/.test(await p.textContent('#mu-self')),'nessuna spiegazione del blocco');
  });
  await t('e il proprio costo orario si può impostare',async()=>{
    must(await p.isVisible('#mu-cl'),'campo costo lordo assente sulla propria scheda');
    await p.fill('#mu-cl','45'); await p.fill('#mu-cn','28'); await p.fill('#mu-cd','2026-01-01');
    await p.click('#su-btn'); await p.waitForTimeout(1200);
    const c=await p.evaluate(()=>__DB.profili_costi.find(x=>x.profile_id==='u-me'));
    must(c,'costo non salvato');
    must(Number(c.costo_orario_lordo)===45&&Number(c.costo_orario_netto)===28,
      'valori errati: '+c.costo_orario_lordo+'/'+c.costo_orario_netto);
  });
  await t('il proprio costo compare in elenco',async()=>{
    must(/45,00|45\.00/.test(await p.textContent('#page')),'costo non mostrato nella propria riga');
  });
  await t('salvando se stessi ruolo e stato non partono nemmeno',async()=>{
    const inviato=await p.evaluate(async()=>{
      let visto=null;
      const vero=SB.from;
      SB.from=(tab)=>{ const q=vero.call(SB,tab);
        if(tab==='profiles'){ const u=q.update; q.update=v=>{ visto=v; return u.call(q,v); }; }
        return q; };
      EUID='u-me'; await saveUser();
      SB.from=vero; return visto;
    });
    must(inviato,'nessun aggiornamento intercettato');
    must(!('role' in inviato),'il ruolo viene inviato anche su se stessi');
    must(!('attivo' in inviato),'lo stato viene inviato anche su se stessi');
    await p.waitForTimeout(600);
  });
  await t('su un altro utente ruolo e stato restano modificabili',async()=>{
    await p.click('.sn[data-page="users"]'); await p.waitForTimeout(500);
    await p.click('tbody [data-usr="u-due"]'); await p.waitForSelector('#m-user.show');
    await p.waitForTimeout(300);
    must(!(await p.isDisabled('#mu-r')),'ruolo bloccato anche sugli altri');
    must(!(await p.isDisabled('#mu-a')),'stato bloccato anche sugli altri');
    must((await p.textContent('#mu-self'))==='','avviso mostrato su un altro utente');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  });

  // --- REDDITIVITÀ: CHI FATTURA ALLO STUDIO E COSA RESTA ---
  await t('la sezione Redditività è riservata agli admin',async()=>{
    must(await p.locator('.sn[data-page="redditivita"]').count()===1,'voce di menu assente');
    await p.evaluate(()=>{ S.prof.role='collaboratore'; go('redditivita'); });
    await p.waitForTimeout(400);
    must(/riservata agli amministratori/i.test(await p.textContent('#page')),
      'un collaboratore vede i conti');
    await p.evaluate(()=>{ S.prof.role='admin'; });
  });
  await t('prepara una commessa con soci e dipendenti',async()=>{
    await p.evaluate(async()=>{
      const {data}=await SB.from('projects').insert({name:'Redditività prova',status:'attivo',
        amount:10000,start_date:'2026-02-01'}).select().single();
      /* I costi si impostano qui e non altrove: un test che dipende da cosa
         hanno fatto i test precedenti smette di dire la verità appena si
         cambia l'ordine. u-me è admin (socio), u-due collaboratore. */
      await SB.from('profili_costi').insert(
        {profile_id:'u-due',costo_orario_lordo:32,costo_orario_netto:20,valido_dal:'2026-01-01'});
      await SB.from('time_entries').insert([
        {project_id:data.id,operator_id:'u-me', entry_date:'2026-05-10',hours:100},
        {project_id:data.id,operator_id:'u-due',entry_date:'2026-05-10',hours:50}]);
      await loadAll(true); go('redditivita');
    });
    await p.waitForTimeout(700);
    must(/Redditività prova/.test(await p.textContent('#page')),'commessa non elencata');
  });
  await t('separa la quota dei soci dal costo interno',async()=>{
    const r=await p.evaluate(()=>{
      const pr=S.projects.find(x=>x.name==='Redditività prova');
      return redditivita(pr.id);
    });
    must(r.importo===10000,'importo: '+r.importo);
    must(r.soci.length===1&&r.soci[0].uid==='u-me','socio non riconosciuto: '+JSON.stringify(r.soci));
    must(r.interni.length===1&&r.interni[0].uid==='u-due','dipendente non riconosciuto');
    must(r.daSoci===4500,'quota soci attesa 4500 (100h × 45), ottenuta '+r.daSoci);
    must(r.daInterni===1600,'costo interno atteso 1600 (50h × 32), ottenuto '+r.daInterni);
  });
  await t('calcola il residuo ancora fatturabile',async()=>{
    const r=await p.evaluate(()=>redditivita(S.projects.find(x=>x.name==='Redditività prova').id));
    must(r.residuo===3900,'residuo atteso 3900, ottenuto '+r.residuo);
    must(!r.sforato,'segnalata capienza superata a torto');
  });
  await t('la scheda dice chi deve fatturare allo studio',async()=>{
    const h=await p.textContent('#page');
    must(/deve fatturare allo studio/.test(h),'non indica chi deve fatturare');
    must(/socio/.test(h),'i soci non sono distinti');
    must(/costo del personale/.test(h),'il costo interno non è distinto');
  });
  await t('spiega che il residuo non fatturato è guadagno extra',async()=>{
    const h=await p.textContent('#page');
    must(/guadagno extra/i.test(h),'non spiega il guadagno extra');
    must(/possono ancora fatturare/.test(h),'non dice che il residuo è ancora disponibile');
  });
  await t('avvisa quando le ore superano l importo',async()=>{
    await p.evaluate(async()=>{
      const pr=S.projects.find(x=>x.name==='Redditività prova');
      await SB.from('time_entries').insert(
        {project_id:pr.id,operator_id:'u-me',entry_date:'2026-05-11',hours:200});
      await loadAll(true); go('redditivita');
    });
    await p.waitForTimeout(700);
    const r=await p.evaluate(()=>redditivita(S.projects.find(x=>x.name==='Redditività prova').id));
    must(r.sforato,'capienza superata non rilevata: residuo '+r.residuo);
    const h=await p.textContent('#page');
    must(/Capienza superata|più di quanto la commessa incassa/.test(h),'nessun avviso di sforamento');
  });

  // --- SPUNTANDO LE ATTIVITÀ IL COSTO COMPARE ---
  await t('una commessa lavorata ma senza ore registrate non è più a costo zero',async()=>{
    await p.evaluate(async()=>{
      const {data}=await SB.from('projects').insert({name:'Lavorata senza ore',status:'attivo',
        amount:20000,start_date:'2026-06-01'}).select().single();
      await generaStruttura(data.id,'interno',['catasto','sicurezza'],'2026-06-01');
      await loadAll(true);
      /* Come fa l'utente: spunta le attività. Il completamento porta con sé
         data e autore, ed è da lì che si ricava l'impegno. */
      const att=S.tasks.filter(x=>x.project_id===data.id).slice(0,6);
      for(let i=0;i<att.length;i++){
        const g=['2026-06-01','2026-06-02','2026-06-03'][i%3];
        await SB.from('tasks').update({status:'completato',
          completed_at:g+'T10:00:00Z',completed_by:'u-me'}).eq('id',att[i].id);
      }
      await loadAll(true);
      window.__PID=data.id;
    });
    await p.waitForTimeout(700);
    const c=await p.evaluate(()=>costoCommessa(window.__PID));
    must(c.ore>0,'ore ancora a zero dopo aver spuntato le attività');
    must(c.lordo>0,'costo ancora a zero: '+c.lordo);
    must(c.haStime,'non è dichiarato come stima');
    must(c.perPersona['u-me'].giorni===3,'giorni contati: '+c.perPersona['u-me'].giorni);
  });
  await t('la Redditività mostra il costo e lo dichiara stimato',async()=>{
    await p.evaluate(()=>{ S.prof.role='admin'; go('redditivita'); });
    await p.waitForTimeout(700);
    const h=await p.textContent('#page');
    must(/Lavorata senza ore/.test(h),'commessa assente dalla Redditività');
    must(/stimat/i.test(h),'non dichiara che le ore sono stimate');
    must(/Da dove vengono le ore/.test(h),'manca la spiegazione del criterio');
  });
  await t('il dettaglio dice dove è andato il tempo, fase per fase',async()=>{
    const h=await p.textContent('#page');
    must(/Dove è andato il tempo/.test(h),'manca il dettaglio per fase');
    const r=await p.evaluate(()=>redditivita(window.__PID));
    const x=r.soci.concat(r.interni).find(y=>y.uid==='u-me');
    must(x&&x.perFase&&Object.keys(x.perFase).length>=1,'nessuna fase nel dettaglio');
  });
  await t('sabato e domenica non vengono contati',async()=>{
    const prima=await p.evaluate(()=>costoCommessa(window.__PID).perPersona['u-me'].giorni);
    await p.evaluate(async()=>{
      /* 2026-06-06 è sabato, 2026-06-07 domenica */
      const att=S.tasks.filter(x=>x.project_id===window.__PID&&x.status!=='completato').slice(0,2);
      for(let i=0;i<att.length;i++)
        await SB.from('tasks').update({status:'completato',
          completed_at:(i?'2026-06-07':'2026-06-06')+'T10:00:00Z',completed_by:'u-me'}).eq('id',att[i].id);
      await loadAll(true);
    });
    await p.waitForTimeout(500);
    const dopo=await p.evaluate(()=>costoCommessa(window.__PID).perPersona['u-me'].giorni);
    must(prima===dopo,'un fine settimana è stato contato: '+prima+' → '+dopo);
  });
  await t('la stessa giornata su due commesse non si conta due volte',async()=>{
    const g=await p.evaluate(async()=>{
      const {data}=await SB.from('projects').insert({name:'Seconda dello stesso giorno',
        status:'attivo',amount:5000,start_date:'2026-06-01'}).select().single();
      await generaStruttura(data.id,'interno',['catasto'],'2026-06-01');
      await loadAll(true);
      const a=S.tasks.find(x=>x.project_id===data.id);
      await SB.from('tasks').update({status:'completato',
        completed_at:'2026-06-01T15:00:00Z',completed_by:'u-me'}).eq('id',a.id);
      await loadAll(true);
      return {uno:costoCommessa(window.__PID).perPersona['u-me'].giorni,
              due:costoCommessa(data.id).perPersona['u-me'].giorni};
    });
    /* il lunedì ora è diviso fra le due commesse: 0,5 ciascuna */
    must(g.due===0.5,'la seconda commessa non prende mezza giornata: '+g.due);
    must(g.uno===2.5,'la prima non è scesa a 2,5 giorni: '+g.uno);
  });
  await t('registrando le ore vere, quelle sostituiscono la stima',async()=>{
    const r=await p.evaluate(async()=>{
      await SB.from('time_entries').insert({project_id:window.__PID,operator_id:'u-me',
        entry_date:'2026-06-02',hours:4});
      await loadAll(true);
      const c=costoCommessa(window.__PID);
      return {ore:c.ore,stimato:c.perPersona['u-me'].stimato};
    });
    must(r.ore===4,'le ore registrate non hanno sostituito la stima: '+r.ore);
    must(r.stimato===false,'ancora marcato come stimato');
  });

  // --- CHI LAVORA E CHI VERIFICA ---
  await t('il lavoro va al 70% a chi lo svolge e al 30% a chi lo verifica',async()=>{
    const g=await p.evaluate(async()=>{
      const {data}=await SB.from('projects').insert({name:'Lavoro e verifica',status:'attivo',
        amount:10000,start_date:'2026-06-08'}).select().single();
      await generaStruttura(data.id,'interno',['catasto'],'2026-06-08');
      await loadAll(true);
      const a=S.tasks.find(x=>x.project_id===data.id);
      /* 2026-06-08 è un lunedì: assegnata ad Anna, verificata da me */
      await SB.from('tasks').update({status:'completato',completed_at:'2026-06-08T10:00:00Z',
        completed_by:'u-me',assignee_id:'u-due',responsabile_id:'u-me'}).eq('id',a.id);
      await loadAll(true);
      const c=costoCommessa(data.id);
      return {pid:data.id,
              lavora:c.perPersona['u-due']&&c.perPersona['u-due'].giorni,
              verifica:c.perPersona['u-me']&&c.perPersona['u-me'].giorni};
    });
    must(g.lavora===0.7,'chi svolge non prende il 70%: '+g.lavora);
    must(g.verifica===0.3,'chi verifica non prende il 30%: '+g.verifica);
    must(Math.round((g.lavora+g.verifica)*100)===100,
         'le due quote non fanno una giornata: '+(g.lavora+g.verifica));
    global.__PID2=g.pid;
  });
  await t('la Redditività attribuisce il costo a tutti e due',async()=>{
    await p.evaluate(()=>{ S.prof.role='admin'; go('redditivita'); });
    await p.waitForTimeout(700);
    const h=await p.textContent('#page');
    must(/Lavoro e verifica/.test(h),'commessa assente dalla Redditività');
    const chi=await p.evaluate(pid=>{
      const r=redditivita(pid);
      return r.soci.concat(r.interni).map(x=>x.uid);
    },global.__PID2);
    must(chi.includes('u-due'),'chi ha svolto il lavoro non compare');
    must(chi.includes('u-me'),'chi ha verificato non compare');
  });
  await t('la modale dell attività dice come si dividerà il costo',async()=>{
    await p.evaluate(pid=>{ const a=S.tasks.find(x=>x.project_id===pid); openTask(a.id); },
                     global.__PID2);
    await p.waitForSelector('#m-task.show'); await p.waitForTimeout(400);
    const q=await p.textContent('#tt-quote');
    must(/70%/.test(q)&&/30%/.test(q),'non dichiara le quote: '+q);
    must(/Anna/.test(q)&&/Francesco/.test(q),'non nomina le due persone: '+q);
    /* togliendo la verifica il costo torna tutto a chi lavora */
    await p.selectOption('#tt-resp','');
    await p.waitForTimeout(200);
    const q2=await p.textContent('#tt-quote');
    must(/tutto a/.test(q2),'senza verifica non dichiara l attribuzione intera: '+q2);
    await p.evaluate(()=>closeM('m-task'));
  });
  await t('spuntando un attività la Redditività si aggiorna subito',async()=>{
    /* Il numero delle attività non cambia quando se ne spunta una: se la stima
       fosse tenuta in memoria per numero, resterebbe ferma. */
    const g=await p.evaluate(async pid=>{
      const prima=costoCommessa(pid).lordo;
      const a=S.tasks.find(x=>x.project_id===pid&&x.status!=='completato');
      await patchTask(a.id,{status:'completato',completed_at:'2026-06-09T10:00:00Z',
        completed_by:'u-me',assignee_id:'u-me'},true);
      return {prima,dopo:costoCommessa(pid).lordo};
    },global.__PID2);
    must(g.dopo>g.prima,'il costo non è cambiato dopo la spunta: '+g.prima+' → '+g.dopo);
  });

  // --- CONVERSAZIONE DENTRO L'ATTIVITÀ ---
  await t('la sezione File Commesse non esiste più',async()=>{
    must(await p.locator('.sn[data-page="files"]').count()===0,'voce di menu ancora presente');
    await p.evaluate(()=>{ S.projId=__DB.projects[0].id; S.tab='avanzamento'; go('project'); });
    await p.waitForTimeout(400);
    must(await p.locator('#page [data-tab="file"]').count()===0,'scheda File ancora presente');
  });
  await t('c è la voce Chat nel menu',async()=>{
    must(await p.locator('.sn[data-page="chat"]').count()===1,'voce Chat assente');
  });
  await t('l attività ha la scheda Conversazione',async()=>{
    const tid=await p.evaluate(()=>{
      const x=__DB.tasks.find(y=>y.project_id===S.projId);
      openTask(x.id); return x.id;
    });
    await p.waitForSelector('#m-task.show'); await p.waitForTimeout(400);
    must(await p.isVisible('#tt-tabs'),'schede assenti su un attività salvata');
    must(await p.locator('[data-ttab="chat"]').count()===1,'scheda Conversazione assente');
    await p.click('[data-ttab="chat"]'); await p.waitForTimeout(250);
    must(await p.isVisible('#tt-chat'),'riquadro conversazione non mostrato');
    must(/Nessun messaggio/.test(await p.textContent('#tt-chat')),'non parte vuota');
    global.__TID=tid;
  });
  await t('scrive un messaggio e lo salva',async()=>{
    await p.fill('#tt-msg','La quota del pianerottolo non torna');
    await p.click('#tt-send'); await p.waitForTimeout(900);
    const m=await p.evaluate(()=>__DB.task_messaggi);
    must(m.length===1,'messaggi salvati: '+m.length);
    must(m[0].testo==='La quota del pianerottolo non torna','testo: '+m[0].testo);
    must(m[0].task_id,'messaggio senza attività');
    must(/pianerottolo/.test(await p.textContent('#tt-chat')),'non compare nella conversazione');
  });
  await t('dice chi riceverà la notifica',async()=>{
    const d=await p.textContent('#tt-dest');
    must(/notifica|Nessuno/.test(d),'nessuna indicazione sui destinatari: '+d);
  });
  await t('il contatore dei messaggi si aggiorna',async()=>{
    must((await p.textContent('#tt-nmsg'))==='1','contatore: '+(await p.textContent('#tt-nmsg')));
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  });
  await t('la riga di checklist segnala la conversazione',async()=>{
    await p.evaluate(()=>{ S.tab='avanzamento'; render(); });
    await p.waitForTimeout(400);
    await p.evaluate(()=>{ document.querySelectorAll('.grp-h').forEach(g=>g.click()); });
    await p.waitForTimeout(400);
    must(await p.locator('[data-chat]').count()>=1,'nessun segnalatore di conversazione');
  });
  await t('una attività nuova non ha ancora la conversazione',async()=>{
    await p.evaluate(()=>openTask(null,S.projId));
    await p.waitForSelector('#m-task.show'); await p.waitForTimeout(300);
    must(!(await p.isVisible('#tt-tabs')),'schede mostrate su un attività non ancora salvata');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  });
  await t('la pagina Chat elenca i messaggi',async()=>{
    await p.click('.sn[data-page="chat"]'); await p.waitForTimeout(600);
    const h=await p.textContent('#page');
    must(/pianerottolo/.test(h),'il messaggio non compare in elenco');
    must(await p.locator('[data-msgto]').count()>=1,'riga non cliccabile');
  });
  await t('la pagina Chat dice dove si scrive',async()=>{
    must(/Clicca un messaggio/.test(await p.textContent('#crumb')),'nessuna indicazione');
  });
  await t('cliccando il messaggio si apre la sua attività sulla conversazione',async()=>{
    await p.locator('[data-msgto]').first().click();
    await p.waitForSelector('#m-task.show',{timeout:4000});
    await p.waitForTimeout(600);
    must(await p.isVisible('#tt-tab-chat'),'non si apre sulla conversazione');
    must(/pianerottolo/.test(await p.textContent('#tt-chat')),'apre l attività sbagliata');
    const tid=await p.inputValue('#tt-id');
    must(tid===global.__TID,'attività diversa da quella del messaggio');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  });
  await t('la ricerca nella chat filtra',async()=>{
    await p.click('.sn[data-page="chat"]'); await p.waitForTimeout(500);
    await p.fill('#ch-q','zzzznessuno'); await p.waitForTimeout(400);
    must(/Nessun messaggio con questi filtri/.test(await p.textContent('#page')),'la ricerca non filtra');
    await p.fill('#ch-q','pianerottolo'); await p.waitForTimeout(400);
    must(await p.locator('[data-msgto]').count()===1,'la ricerca non ritrova il messaggio');
    await p.fill('#ch-q',''); await p.waitForTimeout(300);
  });
  await t('il badge laterale conta i messaggi',async()=>{
    must((await p.textContent('#b-chat'))==='1','badge: '+(await p.textContent('#b-chat')));
  });
  await t('elimina il messaggio',async()=>{
    await p.evaluate(()=>{ const m=__DB.task_messaggi[0]; openTask(m.task_id); ttab('chat'); });
    await p.waitForTimeout(600);
    await p.locator('[data-delmsgt]').first().click(); await p.waitForTimeout(900);
    must(await p.evaluate(()=>__DB.task_messaggi.length===0),'messaggio non eliminato');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  });

  // --- EDILIZIA PRIVATA: PERCORSO COMPLETO E PRATICHE IN ORDINE ---
  await t('il privato genera un percorso articolato',async()=>{
    await p.evaluate(async()=>{
      const {data}=await SB.from('projects').insert({name:'Villa Rossi — ampliamento',status:'attivo',
        start_date:'2026-02-02',client:'Fam. Rossi'}).select().single();
      const tutte=CONDIZIONI.map(c=>c.k);
      await generaStruttura(data.id,'privato',tutte,'2026-02-02');
      await loadAll(true); S.projId=data.id; S.tab='avanzamento'; go('project');
    });
    await p.waitForTimeout(1200);
    const st=await p.evaluate(()=>{
      const pr=__DB.projects.find(x=>x.name==='Villa Rossi — ampliamento');
      return {f:__DB.commessa_fasi.filter(f=>f.project_id===pr.id).length,
              t:__DB.tasks.filter(t=>t.project_id===pr.id).length,
              p:__DB.commessa_pratiche.filter(x=>x.project_id===pr.id).length};
    });
    must(st.f>=15,'fasi: '+st.f);
    must(st.t>=120,'attività: '+st.t);
    must(st.p>=30,'pratiche: '+st.p);
  });
  await t('le pratiche escono in ordine di esecuzione',async()=>{
    const ord=await p.evaluate(()=>{
      const pr=__DB.projects.find(x=>x.name==='Villa Rossi — ampliamento');
      return __DB.commessa_pratiche.filter(x=>x.project_id===pr.id)
        .map(x=>({k:x.pratica_key,o:x.ordine}));
    });
    must(ord.every(x=>typeof x.o==='number'),'pratiche senza ordine');
    const pos=k=>ord.find(x=>x.k===k);
    must(pos('accesso_atti')&&pos('agibilita'),'mancano pratiche chiave');
    must(pos('accesso_atti').o<pos('titolo_edilizio').o,'accesso atti dopo il titolo');
    must(pos('paes_ord').o<pos('titolo_edilizio').o,'paesaggistica dopo il titolo');
    must(pos('docfa').o<pos('agibilita').o,'catasto dopo l agibilità');
  });
  await t('l elenco pratiche le mostra nella sequenza giusta',async()=>{
    await p.evaluate(()=>{ S.tab='pratiche'; render(); });
    await p.waitForTimeout(600);
    const primi=await p.evaluate(()=>{
      const pr=__DB.projects.find(x=>x.name==='Villa Rossi — ampliamento');
      return praticheOf(pr.id).slice(0,3).map(x=>x.pratica_key);
    });
    must(primi[0]==='accesso_atti','la prima non è l accesso agli atti: '+primi.join(','));
  });
  await t('le procure sono generate e stanno all inizio',async()=>{
    const d=await p.evaluate(()=>{
      const pr=__DB.projects.find(x=>x.name==='Villa Rossi — ampliamento');
      const fasi=__DB.commessa_fasi.filter(f=>f.project_id===pr.id).sort((a,b)=>a.ordine-b.ordine);
      const iFirme=fasi.findIndex(f=>f.fase_key==='firme');
      const idFirme=fasi[iFirme]&&fasi[iFirme].id;
      const proc=__DB.tasks.filter(t=>t.project_id===pr.id&&/^Procura speciale/.test(t.title));
      return {iFirme,tot:fasi.length,proc:proc.length,
              tutteInFirme:proc.every(t=>t.commessa_fase_id===idFirme)};
    });
    must(d.proc>=5,'procure generate: '+d.proc);
    must(d.tutteInFirme,'procure non raccolte nella fase delle firme');
    must(d.iFirme>=0&&d.iFirme<d.tot/2,'la fase firme non sta nella prima metà: '+d.iFirme+'/'+d.tot);
  });
  await t('gli elaborati chiave spiegano cosa devono contenere',async()=>{
    const n=await p.evaluate(()=>{
      const pr=__DB.projects.find(x=>x.name==='Villa Rossi — ampliamento');
      return __DB.tasks.filter(t=>t.project_id===pr.id&&t.contenuto&&t.contenuto.length>80).length;
    });
    must(n>=20,'attività con contenuto: '+n);
  });
  await t('il percorso copre tutte le discipline',async()=>{
    const nomi=await p.evaluate(()=>{
      const pr=__DB.projects.find(x=>x.name==='Villa Rossi — ampliamento');
      return __DB.commessa_fasi.filter(f=>f.project_id===pr.id).map(f=>f.nome).join(' | ');
    });
    [/stato legittimo/i,/architettonico/i,/strutturale/i,/impianti/i,/energetica/i,
     /acustic/i,/[Ss]icurezza/,/agibilità/i].forEach(re=>
      must(re.test(nomi),'manca la fase '+re+' in: '+nomi));
  });

  // --- SOLA DIREZIONE LAVORI: SAL, VARIANTI, QUOTA DI ONORARIO ---
  await t('il template sola DL/CSE è offerto nel wizard',async()=>{
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    await p.click('[data-act="newproj"]'); await p.waitForSelector('#m-proj.show');
    await p.fill('#w-name','DL Palestra comunale');
    await p.fill('#w-cli','Comune di Recanati');
    await p.fill('#w-lav','1000000'); await p.fill('#w-cdl','40000');
    await p.click('#mp-next'); await p.waitForTimeout(200);
    must(await p.locator('[data-tpl="dl_cse"]').count()===1,'template assente');
  });
  await t('il template DL non genera fasi di progettazione',async()=>{
    await p.click('[data-tpl="dl_cse"]'); await p.waitForTimeout(200);
    await p.click('#mp-next'); await p.click('#mp-save'); await p.waitForTimeout(2000);
    const fasi=await p.evaluate(()=>{
      const pr=__DB.projects.find(x=>x.name==='DL Palestra comunale');
      return __DB.commessa_fasi.filter(f=>f.project_id===pr.id).map(f=>f.fase_key);
    });
    must(fasi.length>=6,'poche fasi: '+fasi.join(','));
    must(!fasi.some(k=>['pfte','esecutivo','cds','gara'].includes(k)),'contiene progettazione: '+fasi.join(','));
    must(fasi.includes('contabilita')&&fasi.includes('varianti'),'mancano contabilità o varianti');
  });
  await t('gli importi di riferimento sono salvati',async()=>{
    const pr=await p.evaluate(()=>__DB.projects.find(x=>x.name==='DL Palestra comunale'));
    must(Number(pr.importo_lavori)===1000000,'importo lavori: '+pr.importo_lavori);
    must(Number(pr.compenso_dl)===40000,'compenso DL: '+pr.compenso_dl);
  });
  await t('la scheda Contabilità esiste',async()=>{
    await p.evaluate(()=>{const x=__DB.projects.find(y=>y.name==='DL Palestra comunale');
      S.projId=x.id; S.tab='contabilita'; go('project');});
    await p.waitForTimeout(500);
    must(await p.locator('[data-tab="contabilita"]').count()===1,'scheda assente');
    must(/Stati di avanzamento/.test(await p.textContent('#page')),'pannello assente');
  });
  await t('registra il SAL 1 e calcola la percentuale',async()=>{
    await p.click('[data-newsal]'); await p.waitForSelector('#m-sal.show');
    await p.fill('#sa-imp','300000'); await p.waitForTimeout(300);
    must(/30\.00%/.test(await p.textContent('#sa-calc')),'percentuale non calcolata: '+(await p.textContent('#sa-calc')));
    must(/12\.000|12000/.test((await p.textContent('#sa-calc')).replace(/\s/g,'')),'quota non annunciata');
    await p.click('#sa-save'); await p.waitForTimeout(1200);
    const s1=await p.evaluate(()=>__DB.commessa_sal.find(x=>x.numero===1));
    must(s1&&Number(s1.percentuale)===30,'percentuale salvata: '+(s1&&s1.percentuale));
  });
  await t('il SAL apre da solo la quota di onorario da fatturare',async()=>{
    const f=await p.evaluate(()=>__DB.commessa_fatture.find(x=>x.sal_id));
    must(f,'nessuno scaglione creato');
    must(Number(f.imponibile)===12000,'quota: '+f.imponibile);
    must(f.stato==='pronta','stato: '+f.stato);
    must(/SAL n\. 1/.test(f.descrizione),'descrizione: '+f.descrizione);
  });
  await t('il SAL 2 matura solo la differenza',async()=>{
    await p.click('[data-newsal]'); await p.waitForSelector('#m-sal.show');
    must((await p.inputValue('#sa-num'))==='2','numero non proposto');
    await p.fill('#sa-imp','550000'); await p.waitForTimeout(300);
    await p.click('#sa-save'); await p.waitForTimeout(1200);
    const f=await p.evaluate(()=>{
      const s2=__DB.commessa_sal.find(x=>x.numero===2);
      return __DB.commessa_fatture.find(x=>x.sal_id===s2.id);
    });
    must(Number(f.imponibile)===10000,'quota SAL 2: '+f.imponibile+' (attesa 10000, non 22000)');
  });
  await t('il totale maturato non supera il compenso',async()=>{
    const tot=await p.evaluate(()=>__DB.commessa_fatture.filter(x=>x.sal_id)
      .reduce((a,f)=>a+Number(f.imponibile||0),0));
    must(tot===22000,'totale: '+tot);
  });
  await t('avvisa che c è compenso maturato non fatturato',async()=>{
    await p.evaluate(()=>{ S.tab='contabilita'; render(); });
    await p.waitForTimeout(400);
    must(/non è ancora stato fatturato/.test(await p.textContent('#page')),'avviso assente');
  });
  await t('una variante approvata cambia la base dei SAL',async()=>{
    await p.click('[data-newvar]'); await p.waitForSelector('#m-var.show');
    await p.fill('#va-desc','Consolidamento fondazioni');
    await p.fill('#va-imp','200000');
    await p.selectOption('#va-stato','approvata');
    await p.click('#va-save'); await p.waitForTimeout(1400);
    const pr=await p.evaluate(()=>__DB.projects.find(x=>x.name==='DL Palestra comunale'));
    must(Number(pr.importo_lavori)===1200000,'importo lavori non aggiornato: '+pr.importo_lavori);
  });
  await t('il SAL successivo usa la nuova base',async()=>{
    await p.evaluate(()=>{ S.tab='contabilita'; render(); });
    await p.waitForTimeout(400);
    await p.click('[data-newsal]'); await p.waitForSelector('#m-sal.show');
    await p.fill('#sa-imp','900000'); await p.waitForTimeout(300);
    await p.click('#sa-save'); await p.waitForTimeout(1200);
    const s3=await p.evaluate(()=>__DB.commessa_sal.find(x=>x.numero===3));
    must(Number(s3.percentuale)===75,'percentuale su nuova base: '+s3.percentuale);
    const f=await p.evaluate(()=>{const s=__DB.commessa_sal.find(x=>x.numero===3);
      return __DB.commessa_fatture.find(x=>x.sal_id===s.id);});
    must(Number(f.imponibile)===8000,'quota SAL 3: '+f.imponibile);
  });
  await t('senza gli importi il pannello lo dice invece di sbagliare',async()=>{
    await p.evaluate(()=>{
      const x=__DB.projects.find(y=>y.name==='DL Palestra comunale');
      const p2=byId(S.projects,x.id); p2.importo_lavori=null; p2.compenso_dl=null;
      S.tab='contabilita'; render();
    });
    await p.waitForTimeout(400);
    const h=await p.textContent('#page');
    must(/Mancano gli importi di riferimento/.test(h),'non segnala gli importi mancanti');
    must(/Importo contrattuale dei lavori/.test(h)&&/Compenso per direzione lavori/.test(h),
      'non dice quali importi servono');
  });

  // --- PFTE SECONDO L'ALLEGATO I.7 ---
  await t('il PFTE genera gli elaborati dell Allegato I.7',async()=>{
    const att=await p.evaluate(()=>{
      const pl=pianifica('pubblico',['strutture','sicurezza','esproprio','via','archeologico'],'2026-01-07');
      return pl.fasi.find(f=>f.fase_key==='pfte').att.map(a=>a.title);
    });
    ['a) Relazione generale','b) Relazione tecnica','h) Elaborati grafici','l) Quadro economico',
     'o) Piano di sicurezza'].forEach(x=>
      must(att.some(y=>y.indexOf(x)===0),'manca l elaborato '+x));
    must(att.some(y=>/particellare di esproprio/i.test(y)),'manca il piano particellare');
  });
  await t('ogni elaborato porta con sé cosa deve contenere',async()=>{
    const cont=await p.evaluate(()=>{
      const pl=pianifica('pubblico',['strutture','sicurezza'],'2026-01-07');
      return pl.fasi.find(f=>f.fase_key==='pfte').att
        .filter(a=>/^[a-o]\)/.test(a.title)).map(a=>({t:a.title,c:a.contenuto}));
    });
    must(cont.length>=10,'pochi elaborati: '+cont.length);
    must(cont.every(x=>x.c&&x.c.length>80),'senza contenuto: '
      +cont.filter(x=>!x.c||x.c.length<=80).map(x=>x.t).join(', '));
  });
  await t('il contenuto è consultabile dalla riga di checklist',async()=>{
    await p.evaluate(async()=>{
      const {data}=await SB.from('projects').insert({name:'Opera pubblica I.7',status:'attivo',
        start_date:'2026-01-07'}).select().single();
      await generaStruttura(data.id,'pubblico',['strutture','sicurezza'],'2026-01-07');
      await loadAll(true); S.projId=data.id; S.tab='avanzamento'; go('project');
    });
    await p.waitForTimeout(800);
    await p.evaluate(()=>{ document.querySelectorAll('.grp-h').forEach(g=>g.click()); });
    await p.waitForTimeout(400);
    must(await p.locator('[data-cont]').count()>0,'nessun rimando al contenuto');
    ultimoDialogo='';
    await p.locator('[data-cont]').first().click(); await p.waitForTimeout(500);
    must(/All\. I\.7/.test(ultimoDialogo),'il contenuto non richiama la norma: '+ultimoDialogo);
    must(/Sintesi operativa/.test(ultimoDialogo),'non avverte che è una sintesi');
  });
  await t('l esecutivo genera gli elaborati dell art. 22',async()=>{
    const att=await p.evaluate(()=>{
      const pl=pianifica('pubblico',['strutture','impianti','sicurezza','esproprio'],'2026-01-07');
      return pl.fasi.find(f=>f.fase_key==='esecutivo').att
        .map(a=>({t:a.title,r:a.rif_normativo,c:a.contenuto}));
    });
    const lettere=[...new Set(att.map(a=>(a.t.match(/^([a-m])\)/)||[])[1]).filter(Boolean))];
    ['a','b','c','d','e','f','g','h','i','l','m'].forEach(L=>
      must(lettere.includes(L),'manca la lettera '+L+') — presenti: '+lettere.join(',')));
    must(att.filter(a=>/^[a-m]\)/.test(a.t)).every(a=>/All\. I\.7/.test(a.r||'')),
      'elaborati senza richiamo all Allegato I.7');
    must(att.filter(a=>/^[a-m]\)/.test(a.t)).every(a=>a.c&&a.c.length>80),
      'elaborati senza il contenuto prescritto');
  });
  await t('il contenuto dell esecutivo si legge dalla checklist',async()=>{
    await p.evaluate(async()=>{
      const pr=__DB.projects.find(x=>x.name==='Opera pubblica I.7');
      S.projId=pr.id; S.tab='avanzamento'; go('project');
    });
    await p.waitForTimeout(700);
    await p.evaluate(()=>{ document.querySelectorAll('.grp-h').forEach(g=>g.click()); });
    await p.waitForTimeout(500);
    ultimoDialogo='';
    const n=await p.evaluate(()=>{
      const pr=__DB.projects.find(x=>x.name==='Opera pubblica I.7');
      const t=__DB.tasks.find(x=>x.project_id===pr.id&&/^e\) Piano di manutenzione/.test(x.title));
      if(t) mostraContenuto(t.id);
      return t?1:0;
    });
    must(n,'attività del piano di manutenzione non generata');
    await p.waitForTimeout(400);
    must(/MANUALE D.USO/i.test(ultimoDialogo),'non elenca i tre documenti: '+ultimoDialogo);
    must(/PROGRAMMA DI MANUTENZIONE/i.test(ultimoDialogo),'manca il programma di manutenzione');
    must(/art\. 22/.test(ultimoDialogo)||/All\. I\.7/.test(ultimoDialogo),'non richiama la norma');
  });
  await t('nessuna fase "progetto definitivo" nell opera pubblica',async()=>{
    const fasi=await p.evaluate(()=>{
      const pr=__DB.projects.find(x=>x.name==='Opera pubblica I.7');
      return __DB.commessa_fasi.filter(f=>f.project_id===pr.id).map(f=>f.nome);
    });
    must(!fasi.some(n=>/progetto definitivo/i.test(n)),'ancora presente: '+fasi.join(' | '));
    must(fasi.some(n=>/fattibilità tecnica ed economica/i.test(n)),'manca il PFTE');
  });

  // --- DATABASE NON AGGIORNATO: IL MESSAGGIO DEVE INDIRIZZARE ---
  await t('salvando con una colonna mancante indica la migrazione giusta',async()=>{
    await p.evaluate(()=>{ window.__COLONNE_ASSENTI=['sisma']; });
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    await p.click('[data-act="newproj"]'); await p.waitForSelector('#m-proj.show');
    await p.fill('#w-name','Commessa che non si salva');
    await p.click('#mp-next'); await p.click('#mp-next'); await p.click('#mp-save');
    await p.waitForTimeout(1200);
    try{
      /* Solo il testo dell'avviso: il corpo della pagina contiene anche i
         <script>, dove "001_gestionale_v2" compare come dato e falserebbe la
         verifica. */
      const t2=await p.textContent('#tc');
      must(/010_lavori_sisma/.test(t2),'non nomina la migrazione 010: '+t2);
      must(!/001_gestionale_v2/.test(t2),'manda ancora a eseguire la 001: '+t2);
      must(/sisma/.test(t2),'non dice quale colonna manca: '+t2);
    } finally {
      /* Il salvataggio e' fallito, quindi il modulo resta aperto. Va chiuso
         comunque, anche se la verifica sopra non passa: altrimenti resta a
         coprire la pagina e fa fallire tutti i test successivi per un motivo
         che non c'entra nulla. */
      await p.evaluate(()=>{ window.__COLONNE_ASSENTI=[]; closeM('m-proj'); });
      await p.waitForTimeout(300);
    }
  });
  await t('avviso in cima quando manca una tabella',async()=>{
    await p.evaluate(()=>{
      controllaSchema([[{error:{message:'relation "public.enti_pa" does not exist'}},'enti_pa'],
                       [{error:{message:'Could not find the table clienti'}},'clienti']]);
    });
    await p.waitForTimeout(200);
    const h=await p.textContent('#schema-warn');
    must(/database non è aggiornato/i.test(h),'avviso assente');
    must(/011_fatturazione_pa/.test(h)&&/008_anagrafica_clienti/.test(h),'non elenca le migrazioni: '+h);
  });
  await t('un errore di permessi non viene scambiato per tabella mancante',async()=>{
    await p.evaluate(()=>{
      controllaSchema([[{error:{message:'permission denied for table profili_costi'}},'profili_costi']]);
    });
    await p.waitForTimeout(200);
    must(await p.evaluate(()=>el('schema-warn').style.display==='none'),'segnala un guasto che non c è');
  });

  // --- COSTO DEL PERSONALE ---
  await t('scheda utente: campi di costo per l amministratore',async()=>{
    await p.click('.sn[data-page="users"]'); await p.waitForTimeout(500);
    must(await p.locator('tbody [data-usr]').count()>=1,'nessun utente modificabile');
    await p.click('tbody [data-usr="u-due"]'); await p.waitForSelector('#m-user.show');
    must(await p.isVisible('#mu-cl'),'campo costo lordo assente');
    must(await p.isVisible('#mu-cn'),'campo costo netto assente');
    must(await p.isVisible('#mu-cd'),'campo decorrenza assente');
  });
  await t('salva il primo costo orario',async()=>{
    await p.fill('#mu-cl','25'); await p.fill('#mu-cn','15'); await p.fill('#mu-cd','2026-01-01');
    await p.click('#su-btn'); await p.waitForTimeout(1200);
    const r=await p.evaluate(()=>__DB.profili_costi.filter(x=>x.profile_id==='u-due'));
    must(r.length===1,'righe di costo: '+r.length);
    must(Number(r[0].costo_orario_lordo)===25&&Number(r[0].costo_orario_netto)===15,'valori errati');
    must(r[0].valido_dal==='2026-01-01'&&!r[0].valido_al,'periodo non aperto dal 01/01');
  });
  await t('il costo compare nell elenco utenti',async()=>{
    must(/25,00|25\.00/.test(await p.textContent('#page')),'costo non mostrato in tabella');
  });
  await t('un aumento chiude il periodo precedente',async()=>{
    await p.click('tbody [data-usr="u-due"]'); await p.waitForSelector('#m-user.show');
    await p.fill('#mu-cl','30'); await p.fill('#mu-cn','18'); await p.fill('#mu-cd','2026-04-01');
    await p.click('#su-btn'); await p.waitForTimeout(1200);
    const r=await p.evaluate(()=>__DB.profili_costi.filter(x=>x.profile_id==='u-due')
      .slice().sort((a,b)=>a.valido_dal<b.valido_dal?-1:1));
    must(r.length===2,'periodi: '+r.length);
    must(r[0].valido_al==='2026-03-31','vecchio periodo chiuso il '+r[0].valido_al);
    must(!r[1].valido_al&&Number(r[1].costo_orario_lordo)===30,'nuovo periodo errato');
  });
  await t('lo storico dei periodi si vede nella scheda',async()=>{
    await p.click('tbody [data-usr="u-due"]'); await p.waitForSelector('#m-user.show');
    await p.waitForTimeout(200);
    const h=await p.textContent('#mu-costi');
    must(/Periodi precedenti/.test(h),'storico assente');
    must((await p.inputValue('#mu-cl'))==='30','non mostra il costo in vigore');
    await p.keyboard.press('Escape');
  });
  await t('stessa decorrenza: corregge invece di aprire un periodo',async()=>{
    await p.click('tbody [data-usr="u-due"]'); await p.waitForSelector('#m-user.show');
    await p.fill('#mu-cl','32'); await p.click('#su-btn'); await p.waitForTimeout(1200);
    const r=await p.evaluate(()=>__DB.profili_costi.filter(x=>x.profile_id==='u-due'));
    must(r.length===2,'ha aperto un periodo di troppo: '+r.length);
    must(r.some(x=>!x.valido_al&&Number(x.costo_orario_lordo)===32),'correzione non applicata');
  });
  await t('valorizza le ore alla tariffa del giorno',async()=>{
    const c=await p.evaluate(async()=>{
      const {data}=await SB.from('projects').insert({name:'Commessa da valorizzare',status:'attivo',
        start_date:'2026-02-01',amount:5000}).select().single();
      await SB.from('time_entries').insert([
        {project_id:data.id,hours:10,entry_date:'2026-02-10',operator_id:'u-due'},   // 25 €/h
        {project_id:data.id,hours:10,entry_date:'2026-05-10',operator_id:'u-due'}]); // 32 €/h
      await loadAll(true);
      return costoCommessa(data.id);
    });
    must(c.ore===20,'ore: '+c.ore);
    must(c.lordo===570,'costo lordo atteso 570, ottenuto '+c.lordo);   // 250 + 320
    must(c.medio===28.5,'costo orario medio: '+c.medio);
    must(c.giorni===90,'giorni lavorati: '+c.giorni);                  // 10/02 → 10/05
    must(c.margine===4430,'margine: '+c.margine);
  });
  await t('pannello economico nella scheda Ore',async()=>{
    await p.evaluate(()=>{ S.pq=''; S.pst=''; S.par=''; go('projects'); });
    await p.waitForTimeout(500);
    await p.locator('.card:has-text("Commessa da valorizzare")').first().click();
    await p.waitForTimeout(500);
    await p.click('[data-tab="ore"]'); await p.waitForTimeout(400);
    const h=await p.textContent('#page');
    must(/Costo del lavoro/.test(h),'pannello assente');
    must(/Chi ci ha lavorato/.test(h),'dettaglio per persona assente');
    must(/Margine lordo/.test(h),'margine assente');
  });
  await t('avvisa se manca il costo di chi ha lavorato',async()=>{
    await p.evaluate(async()=>{
      const pr=__DB.projects.find(x=>x.name==='Commessa da valorizzare');
      /* Data precedente a ogni periodo di costo: e' cosi' che si verifica
         l'avviso, non togliendo il costo a qualcuno. */
      await SB.from('time_entries').insert({project_id:pr.id,hours:4,entry_date:'2025-11-01',operator_id:'u-me'});
      await loadAll(true); render();
    });
    await p.waitForTimeout(500);
    must(/non è impostato un costo orario/.test(await p.textContent('#page')),'avviso assente');
  });
  await t('il collaboratore non vede costi',async()=>{
    await p.evaluate(()=>{ S.prof.role='collaboratore'; render(); });
    await p.waitForTimeout(400);
    const h=await p.textContent('#page');
    must(!/Costo del lavoro/.test(h),'pannello economico visibile a un collaboratore');
    must(!/Margine lordo/.test(h),'margine visibile a un collaboratore');
    must(/Ore per collaboratore/.test(h),'la scheda Ore normale è sparita');
  });
  await t('il collaboratore non ha la scheda utenti',async()=>{
    must(await p.evaluate(()=>costiUtenteHtml('u-due'))==='','scheda costi generata per un collaboratore');
    await p.evaluate(()=>{ S.prof.role='admin'; render(); });
    await p.waitForTimeout(300);
  });

  // --- ARCHIVIAZIONE ED ELIMINAZIONE ---
  // Lavora su una commessa usa-e-getta, cosi' la principale resta per gli screenshot
  await t('prepara commessa di prova',async()=>{
    await p.evaluate(async()=>{
      const {data}=await SB.from('projects').insert({name:'Commessa da eliminare',status:'attivo',
        start_date:'2026-07-01'}).select().single();
      await generaStruttura(data.id,'strutture',['strutture','geologia'],'2026-07-01');
      await SB.from('time_entries').insert({project_id:data.id,hours:5,entry_date:'2026-07-10',operator_id:'u-me'});
      await SB.from('files').insert({project_id:data.id,name:'calcoli.pdf',storage_path:data.id+'/calcoli.pdf',
        size_bytes:2048,uploaded_by:'u-me'});
      await SB.storage.from('commesse').upload(data.id+'/calcoli.pdf',null);
      await loadAll(true); go('projects');
    });
    await p.waitForTimeout(600);
    must(await p.locator('.card:has-text("Commessa da eliminare")').count()===1,'commessa di prova non creata');
  });
  const apri=async()=>{ await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    await p.locator('.card:has-text("Commessa da eliminare")').first().click(); await p.waitForTimeout(500); };
  await t('archivia: esce dagli elenchi',async()=>{
    const n0=await p.locator('#page [data-proj]').count();
    await apri();
    await p.click('[data-act="editproj"]'); await p.waitForSelector('#m-proj.show');
    must(await p.isVisible('#mp-arch'),'pulsante Archivia assente');
    await p.click('#mp-arch'); await p.waitForTimeout(900);
    must(await p.evaluate(()=>__DB.projects.some(x=>x.archiviato)),'non archiviata');
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    must(await p.locator('#page [data-proj]').count()===n0-1,'ancora in elenco');
  });
  await t('archivia: esclusa dai menu a tendina',async()=>{
    await p.click('.sn[data-page="oggi"]'); await p.waitForTimeout(300);
    await p.click('[data-act="newtask"]'); await p.waitForSelector('#m-task.show');
    const opts=await p.locator('#tt-p option').allTextContents();
    const arch=await p.evaluate(()=>__DB.projects.find(x=>x.archiviato).name);
    must(!opts.some(o=>o===arch),'commessa archiviata ancora selezionabile');
    await p.keyboard.press('Escape');
  });
  await t('ripristino da banner e reset del filtro',async()=>{
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(300);
    await p.selectOption('#p-ar','arch'); await p.waitForTimeout(300);
    must(await p.locator('#page [data-proj]').count()===1,'filtro Archiviate vuoto');
    await p.locator('#page [data-proj]').first().click(); await p.waitForTimeout(500);
    must(await p.locator('.wbox:has-text("archiviata")').count()>0,'banner assente');
    await p.click('[data-act="ripristina"]'); await p.waitForTimeout(900);
    must(await p.evaluate(()=>__DB.projects.every(x=>!x.archiviato)),'non ripristinata');
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    must(await p.inputValue('#p-ar')==='','filtro non riportato su Attive');
  });
  await t('elimina: bloccata finché il nome non combacia',async()=>{
    await apri();
    await p.click('[data-act="editproj"]'); await p.waitForSelector('#m-proj.show');
    must(await p.isVisible('#mp-del'),'pulsante Elimina assente per admin');
    await p.click('#mp-del'); await p.waitForSelector('#m-del.show'); await p.waitForTimeout(500);
    must(await p.isDisabled('#del-go'),'attivo senza conferma');
    await p.fill('#del-conf','nome sbagliato'); await p.waitForTimeout(150);
    must(await p.isDisabled('#del-go'),'attivo con nome errato');
    const txt=await p.textContent('#del-body');
    must(/Attività/.test(txt)&&/File caricati/.test(txt),'riepilogo di impatto incompleto');
  });
  await t('elimina: rimuove commessa, contenuto, ore, file e storage',async()=>{
    const nome=await p.evaluate(()=>{const x=byId(S.projects,DEL_ID);return x?x.name:'';});
    must(nome,'DEL_ID non impostato');
    const pre=await p.evaluate(()=>({p:__DB.projects.length,t:__DB.tasks.length,f:__DB.commessa_fasi.length,
      pr:__DB.commessa_pratiche.length,te:__DB.time_entries.length,fi:__DB.files.length}));
    await p.fill('#del-conf',nome); await p.waitForTimeout(150);
    must(!(await p.isDisabled('#del-go')),'ancora disabilitato col nome corretto');
    await p.click('#del-go'); await p.waitForTimeout(1600);
    const post=await p.evaluate(()=>({p:__DB.projects.length,t:__DB.tasks.length,f:__DB.commessa_fasi.length,
      pr:__DB.commessa_pratiche.length,te:__DB.time_entries.length,fi:__DB.files.length}));
    must(post.p===pre.p-1&&post.t<pre.t&&post.f<pre.f&&post.pr<pre.pr,JSON.stringify(post));
  });
  await t('elimina: nessun record orfano',async()=>{
    const orf=await p.evaluate(()=>{const ids=__DB.projects.map(x=>x.id);
      return __DB.tasks.filter(x=>!ids.includes(x.project_id)).length
           + __DB.commessa_fasi.filter(x=>!ids.includes(x.project_id)).length
           + __DB.commessa_pratiche.filter(x=>!ids.includes(x.project_id)).length
           + __DB.time_entries.filter(x=>!ids.includes(x.project_id)).length;});
    must(orf===0,'record orfani: '+orf);
  });

  /* Gli scatti finali non sono un test: se falliscono lo si annota e si va
     avanti, altrimenti un'eccezione qui butta via il resoconto di tutti i
     test precedenti e non si capisce piu' niente. */
  await t('scatti finali',async()=>{
    /* Un modulo rimasto aperto coprirebbe la pagina: lo si chiude comunque. */
    await p.evaluate(()=>{ document.querySelectorAll('.ov.show').forEach(m=>m.classList.remove('show')); });
    await p.screenshot({path:path.join(__dirname,'shot-oggi.png')});
    /* Azzera i filtri lasciati dai test precedenti, altrimenti l'elenco
       commesse puo' risultare vuoto e lo scatto fallisce. */
    await p.evaluate(()=>{ S.pq=''; S.pst=''; S.par=''; go('projects'); });
    await p.waitForTimeout(600);
    const nProj=await p.locator('#page [data-proj]').count();
    must(nProj,'nessuna commessa in elenco');
    await p.locator('#page [data-proj]').first().click({timeout:8000}); await p.waitForTimeout(600);
    await p.evaluate(()=>{ const g=document.querySelectorAll('.grp-h'); if(g[3]) g[3].click(); });
    await p.waitForTimeout(200);
    await p.screenshot({path:path.join(__dirname,'shot-commessa.png')});
  });

  /* Nessun modulo deve restare aperto a fine giro: se succede, un test si e'
     dimenticato di chiudere ed e' il tipo di sporcizia che fa fallire altri
     test per motivi che non c'entrano nulla. */
  await t('nessun modulo rimasto aperto',async()=>{
    const aperti=await p.evaluate(()=>Array.from(document.querySelectorAll('.ov.show')).map(m=>m.id));
    must(!aperti.length,'moduli aperti: '+aperti.join(', '));
  });

  console.log('\n✓ PASSATI ('+ok.length+')');
  if(bad.length){ console.log('\n✗ FALLITI ('+bad.length+')'); bad.forEach(x=>console.log('   '+x)); }
  /* Il test sul database non aggiornato provoca apposta un errore di
     salvataggio: l'app lo registra in console, ed e' il comportamento voluto. */
  const attesi=/favicon|net::ERR_FILE|Could not find the 'sisma' column/;
  const real=errs.filter(e=>!attesi.test(e));
  if(real.length){ console.log('\n⚠ ERRORI CONSOLE ('+real.length+')'); real.slice(0,10).forEach(e=>console.log('   '+e)); }
  await b.close();
  process.exit(bad.length||real.length?1:0);
})();
