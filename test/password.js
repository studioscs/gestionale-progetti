/* Recupero password: percorsi che partono dal link ricevuto per email.
   Ogni caso vive in una scheda separata perche' dipende dall'URL di apertura. */
const {chromium}=require('playwright');const fs=require('fs'),path=require('path');
function launchOpts(){
  for(const q of ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome','/opt/pw-browsers/chromium/chrome-linux/chrome'])
    if(fs.existsSync(q)) return {executablePath:q};
  return {};
}
(async()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  fs.writeFileSync(path.join(__dirname,'app-test.html'),
    src.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/,'<script src="mock.js"></script>'));
  const b=await chromium.launch(launchOpts());
  const ok=[],ko=[]; const must=(c,m)=>{if(!c)throw new Error(m||'falso')};
  const t=async(n,f)=>{try{await f();ok.push(n)}catch(e){ko.push(n+' → '+e.message.split('\n')[0])}};
  const URL0='file://'+path.join(__dirname,'app-test.html');
  const nuova=async(hash)=>{ const p=await b.newPage({viewport:{width:900,height:900}});
    p.on('pageerror',e=>ko.push('PAGEERROR '+e.message));
    await p.goto(URL0+(hash||'')); await p.waitForTimeout(900); return p; };

  await t('link di recupero: mostra il form, NON entra nell app',async()=>{
    const p=await nuova('#access_token=abc&refresh_token=r&type=recovery');
    must(await p.isVisible('#resetpanel'),'form nuova password non mostrato');
    must(!(await p.isVisible('#loginpanel')),'form di login ancora visibile');
    must(!(await p.isVisible('#app')),'e entrato nell app senza chiedere la password');
    must(/f@scs.it/.test(await p.textContent('#reswho')),'email non mostrata');
    await p.close();
  });
  await t('stesso comportamento con parametri in query',async()=>{
    const p=await b.newPage(); await p.goto(URL0+'?type=recovery&code=xyz'); await p.waitForTimeout(900);
    must(await p.isVisible('#resetpanel'),'query non riconosciuta');
    must(!(await p.isVisible('#app')),'e entrato nell app');
    await p.close();
  });
  await t('evento PASSWORD_RECOVERY senza parametri in URL',async()=>{
    const p=await nuova();
    must(await p.isVisible('#app'),'sessione normale non entra');
    await p.evaluate(()=>window.__AUTHCB('PASSWORD_RECOVERY',{user:{email:'f@scs.it'}}));
    await p.waitForTimeout(400);
    must(await p.isVisible('#resetpanel'),'evento ignorato');
    must(!(await p.isVisible('#app')),'app ancora aperta');
    await p.close();
  });
  await t('validazione: password corta',async()=>{
    const p=await nuova('#type=recovery');
    await p.fill('#np1','abc'); await p.fill('#np2','abc');
    await p.click('#nbtn'); await p.waitForTimeout(300);
    must(await p.isVisible('#reserr'),'nessun errore mostrato');
    must(/8 caratteri/.test(await p.textContent('#reserr')));
    must(await p.evaluate(()=>!window.__UPDATED),'ha chiamato updateUser');
    await p.close();
  });
  await t('validazione: password diverse',async()=>{
    const p=await nuova('#type=recovery');
    await p.fill('#np1','password123'); await p.fill('#np2','password999');
    await p.click('#nbtn'); await p.waitForTimeout(300);
    must(/non coincidono/.test(await p.textContent('#reserr')));
    await p.close();
  });
  await t('errore del server tradotto',async()=>{
    const p=await nuova('#type=recovery');
    await p.fill('#np1','VecchiaPass1'); await p.fill('#np2','VecchiaPass1');
    await p.click('#nbtn'); await p.waitForTimeout(500);
    must(/diversa da quella attuale/.test(await p.textContent('#reserr')),await p.textContent('#reserr'));
    await p.close();
  });
  await t('salvataggio riuscito: aggiorna e apre l app',async()=>{
    const p=await nuova('#type=recovery&access_token=a');
    await p.fill('#np1','NuovaPass2026'); await p.fill('#np2','NuovaPass2026');
    await p.click('#nbtn'); await p.waitForSelector('#app.show',{timeout:6000});
    must(await p.evaluate(()=>window.__UPDATED&&window.__UPDATED.password==='NuovaPass2026'),'password non inviata');
    must(!(await p.isVisible('#auth')),'schermata di accesso ancora visibile');
    must(!/type=recovery/.test(await p.evaluate(()=>location.href)),'URL non ripulito: al refresh si riaprirebbe');
    await p.close();
  });
  await t('link scaduto: messaggio chiaro e login normale',async()=>{
    const p=await b.newPage();
    await p.addInitScript(()=>{ window.__NOSESSION=true; });
    await p.goto(URL0+'#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    await p.waitForTimeout(1000);
    must(await p.isVisible('#aerr'),'nessun errore mostrato');
    must(!(await p.isVisible('#app')),'e entrato nell app con link scaduto e nessuna sessione');
    must(/invalid or has expired/.test(await p.textContent('#aerr')),await p.textContent('#aerr'));
    must(!/error_description/.test(await p.evaluate(()=>location.href)),'URL non ripulito');
    await p.close();
  });
  await t('"entra senza cambiarla" funziona',async()=>{
    const p=await nuova('#type=recovery');
    await p.click('#nskip'); await p.waitForSelector('#app.show',{timeout:6000});
    must(await p.evaluate(()=>!window.__UPDATED),'ha cambiato la password');
    await p.close();
  });
  await t('richiesta di reset usa un URL pulito',async()=>{
    const p=await b.newPage();
    await p.addInitScript(()=>{ window.__NOSESSION=true; });
    await p.goto(URL0+'#error=x&error_description=boh'); await p.waitForTimeout(900);
    await p.fill('#aemail','mario@scs.it');
    await p.click('#aforgot'); await p.waitForTimeout(500);
    const r=await p.evaluate(()=>window.__RESET);
    must(r&&r.email==='mario@scs.it','email non passata');
    must(!/#/.test(r.opts.redirectTo),'redirectTo contiene un frammento: '+r.opts.redirectTo);
    await p.close();
  });
  await t('reset senza email: avvisa',async()=>{
    const p=await b.newPage();
    await p.addInitScript(()=>{ window.__NOSESSION=true; });
    await p.goto(URL0); await p.waitForTimeout(900);
    await p.fill('#aemail',''); await p.click('#aforgot'); await p.waitForTimeout(400);
    must(/Inserisci prima la tua email/.test(await p.textContent('#tc')),await p.textContent('#tc'));
    await p.close();
  });
  console.log('✓ '+ok.length+' passati'); ko.forEach(x=>console.log('✗ '+x));
  await b.close(); process.exit(ko.length?1:0);
})();
