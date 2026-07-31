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
    const cks=p.locator('.grp.open .ck');
    const n=await cks.count();
    for(let i=0;i<n;i++){ await cks.nth(0).click(); await p.waitForTimeout(60);
      if(!(await p.locator('.grp.open .ck:not(.on)').count())) break; }
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

  // --- ATTIVITÀ / ORE ---
  await t('crea attività manuale',async()=>{
    await p.click('.sn[data-page="oggi"]'); await p.waitForTimeout(300);
    await p.click('[data-act="newtask"]'); await p.waitForSelector('#m-task.show');
    await p.fill('#tt-n','Verifica antincendio scala B');
    await p.click('#st-btn'); await p.waitForTimeout(600);
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
