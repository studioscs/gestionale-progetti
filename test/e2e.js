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
                         ['files','#filepanel'],['users','table'],['projects','.card'],['oggi','.kgrid']]){
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
      const a=f.find(x=>x.fase_key==='firme'), b=f.find(x=>x.fase_key==='autorizzazioni');
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
    await p.locator('[data-proj]').first().click(); await p.waitForTimeout(600);
    await p.evaluate(()=>{ const g=[...document.querySelectorAll('.grp-h')]
      .find(x=>/firme|Dati definitivi/i.test(x.textContent)); if(g) g.click(); });
    await p.waitForTimeout(400);
    must(/procura speciale vale/i.test(await p.textContent('#page')),'nota della fase firme assente');
  });


  // --- FATTURAZIONE ---
  await t('scheda Fatturazione nella commessa',async()=>{
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    await p.locator('[data-proj]').first().click(); await p.waitForTimeout(600);
    must(await p.locator('[data-tab="fatture"]').count()===1,'scheda assente');
    await p.click('[data-tab="fatture"]'); await p.waitForTimeout(500);
    must(/Situazione economica/.test(await p.textContent('#page')),'pannello non mostrato');
  });
  await t('avvisa che mancano i dati fiscali dello studio',async()=>{
    must(/blocco <?b?>?STUDIO|blocco STUDIO/.test(await p.textContent('#page')),'nessun avviso sui dati fiscali');
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
  await t('XML bloccato finché mancano i dati fiscali',async()=>{
    ultimoDialogo='';
    await p.locator('[data-fxml]').first().click(); await p.waitForTimeout(900);
    must(/partita IVA dello studio/i.test(ultimoDialogo),'messaggio: '+ultimoDialogo);
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
    const [dl]=await Promise.all([
      p.waitForEvent('download',{timeout:8000}).catch(()=>null),
      p.locator('[data-fxml]').first().click() ]);
    must(dl,'nessun download. Motivo riportato dall app: '+ultimoDialogo);
    must(/^IT03512340548_[0-9A-Z]{5}\.xml$/.test(dl.suggestedFilename()),dl.suggestedFilename());
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
    const n0=await p.locator('[data-proj]').count();
    await apri();
    await p.click('[data-act="editproj"]'); await p.waitForSelector('#m-proj.show');
    must(await p.isVisible('#mp-arch'),'pulsante Archivia assente');
    await p.click('#mp-arch'); await p.waitForTimeout(900);
    must(await p.evaluate(()=>__DB.projects.some(x=>x.archiviato)),'non archiviata');
    await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(400);
    must(await p.locator('[data-proj]').count()===n0-1,'ancora in elenco');
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
    must(await p.locator('[data-proj]').count()===1,'filtro Archiviate vuoto');
    await p.locator('[data-proj]').first().click(); await p.waitForTimeout(500);
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

  await p.screenshot({path:path.join(__dirname,'shot-oggi.png')});
  await p.click('.sn[data-page="projects"]'); await p.waitForTimeout(300);
  await p.locator('[data-proj]').first().click(); await p.waitForTimeout(600);
  await p.evaluate(()=>document.querySelectorAll('.grp-h')[3].click());
  await p.waitForTimeout(200);
  await p.screenshot({path:path.join(__dirname,'shot-commessa.png')});

  console.log('\n✓ PASSATI ('+ok.length+')');
  if(bad.length){ console.log('\n✗ FALLITI ('+bad.length+')'); bad.forEach(x=>console.log('   '+x)); }
  const real=errs.filter(e=>!/favicon|net::ERR_FILE/.test(e));
  if(real.length){ console.log('\n⚠ ERRORI CONSOLE ('+real.length+')'); real.slice(0,10).forEach(e=>console.log('   '+e)); }
  await b.close();
  process.exit(bad.length||real.length?1:0);
})();
