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
  await t('link di INVITO: chiede la password, NON fa entrare',async()=>{
    /* L'invito da Supabase (Authentication > Users > Invite) autentica gia'
       l'utente: senza questo controllo si finiva dentro l'app con un account
       che una password non ce l'ha, e chiunque avesse quella mail entrava. */
    const p=await nuova('#access_token=abc&refresh_token=r&type=invite');
    must(await p.isVisible('#resetpanel'),'non chiede di scegliere la password');
    must(!(await p.isVisible('#app')),'e ENTRATO NELL APP senza password');
    await p.close();
  });
  await t('e lo dice con le parole giuste: è la prima, non un recupero',async()=>{
    const p=await nuova('#access_token=abc&refresh_token=r&type=invite');
    const txt=await p.textContent('#reswho');
    must(/scegli|prima password|benvenut/i.test(txt),'parla di reimpostare invece che di scegliere: '+txt);
    await p.close();
  });
  await t('link magico: stessa cosa, la password va scelta',async()=>{
    const p=await nuova('#access_token=abc&refresh_token=r&type=magiclink');
    must(await p.isVisible('#resetpanel'),'non chiede la password');
    must(!(await p.isVisible('#app')),'e entrato senza password');
    await p.close();
  });

  await t('aprire l invito e chiudere la finestra non basta per entrare',async()=>{
    /* La scorciatoia piu' ovvia: apro l'invito, non scelgo niente, chiudo. La
       sessione resta valida - e senza contrassegno il giorno dopo si entrava. */
    const p=await nuova('#access_token=abc&refresh_token=r&type=invite');
    must(await p.isVisible('#resetpanel'),'primo giro: non chiede la password');
    const segnato=await p.evaluate(()=>window.__UPDATED);
    must(segnato&&segnato.data&&segnato.data.pwd_da_scegliere===true,
      'l account non e stato segnato come senza password: '+JSON.stringify(segnato));
    await p.close();
    /* si riapre il gestionale, senza link, con la sessione ancora buona */
    const q=await b.newPage({viewport:{width:900,height:900}});
    await q.addInitScript(()=>{ window.__PWDDASCEGLIERE=true; });
    await q.goto(URL0); await q.waitForTimeout(900);
    must(await q.isVisible('#resetpanel'),'al secondo giro NON chiede la password');
    must(!(await q.isVisible('#app')),'al secondo giro e ENTRATO senza password');
    await q.close();
  });
  await t('scelta la password, il contrassegno se ne va e si entra',async()=>{
    const p=await b.newPage({viewport:{width:900,height:900}});
    await p.addInitScript(()=>{ window.__PWDDASCEGLIERE=true; });
    await p.goto(URL0); await p.waitForTimeout(900);
    must(await p.isVisible('#resetpanel'),'non chiede la password');
    await p.fill('#np1','PasswordNuova1'); await p.fill('#np2','PasswordNuova1');
    await p.click('#nbtn'); await p.waitForTimeout(900);
    const u=await p.evaluate(()=>window.__UPDATED);
    must(u&&u.password==='PasswordNuova1','password non inviata: '+JSON.stringify(u));
    must(u&&u.data&&u.data.pwd_da_scegliere===false,
      'il contrassegno non e stato tolto: '+JSON.stringify(u));
    await p.close();
  });
  await t('al primo accesso non c e nessun "entra senza cambiarla"',async()=>{
    const p=await nuova('#access_token=abc&refresh_token=r&type=invite');
    must(!(await p.isVisible('#nskip')),'la scorciatoia per entrare senza password e ancora li');
    await p.close();
  });
  await t('ma su un recupero resta, che la password ce l ha gia',async()=>{
    const p=await nuova('#access_token=abc&refresh_token=r&type=recovery');
    must(await p.isVisible('#nskip'),'tolta anche dove serviva');
    await p.close();
  });

  await t('il client chiede esplicitamente il flusso implicit',async()=>{
    /* La causa del bug segnalato: senza questa scelta esplicita, le versioni
       recenti della libreria generano link "?code=..." che vanno scambiati
       esplicitamente, e funzionano SOLO dallo stesso browser che ha chiesto
       il recupero. Aprirli da un altro dispositivo - il caso piu' comune,
       mail sul telefono e richiesta fatta dal computer - non fa niente, e
       senza questa impostazione l'app non se ne accorgerebbe nemmeno. */
    const p=await nuova('');
    const opts=await p.evaluate(()=>window.__CLIENTOPTS);
    must(opts&&opts.auth&&opts.auth.flowType==='implicit',
      'la app non forza il flusso implicit: '+JSON.stringify(opts));
    await p.close();
  });
  await t('un link "?code=" viene comunque scambiato, come difesa in più',async()=>{
    /* Anche forzando implicit, se un ?code= comparisse lo stesso - un
       progetto Supabase configurato diversamente - non deve più sparire nel
       nulla come faceva prima: va scambiato, ed è il caso in cui riesce. */
    const p=await b.newPage({viewport:{width:900,height:900}});
    await p.goto(URL0+'?code=un-codice-valido'); await p.waitForTimeout(900);
    must(await p.evaluate(()=>window.__EXCHANGED)==='un-codice-valido',
      'il codice non è mai stato scambiato: il link sembra non fare niente, come nel bug segnalato');
    must(await p.isVisible('#resetpanel'),'scambiato il codice, non porta comunque alla scelta della password');
    must(!(await p.isVisible('#app')),'è entrato nell app senza passare dalla password');
    await p.close();
  });
  await t('un "?code=" aperto dal dispositivo sbagliato mostra un errore, non una pagina muta',async()=>{
    /* Questo È il bug segnalato dal collaboratore, riprodotto: il link si
       apre e "non succede niente" perché lo scambio fallisce in silenzio.
       Deve invece comparire un messaggio che dice perché e cosa fare. */
    const p=await b.newPage({viewport:{width:900,height:900}});
    await p.addInitScript(()=>{ window.__EXCHFAIL=true; });
    await p.goto(URL0+'?code=un-codice-di-un-altro-dispositivo'); await p.waitForTimeout(900);
    must(!(await p.isVisible('#resetpanel')),'mostra comunque il form della password nonostante l errore');
    must(!(await p.isVisible('#app')),'è entrato nell app nonostante lo scambio fallito');
    must(await p.isVisible('#loginpanel'),'non torna nemmeno al login');
    const err=await p.textContent('#aerr');
    must(/dispositivo diverso|non è più valido/i.test(err),
      'non spiega il motivo più comune (dispositivo diverso): '+err);
    must(/Password dimenticata/i.test(err),'non indica come richiederne un altro: '+err);
    await p.close();
  });
  await t('il codice si toglie dall url anche quando lo scambio fallisce',async()=>{
    /* Altrimenti un refresh della pagina ritenterebbe con un codice già
       consumato, riproponendo lo stesso errore in un loop silenzioso. */
    const p=await b.newPage({viewport:{width:900,height:900}});
    await p.addInitScript(()=>{ window.__EXCHFAIL=true; });
    await p.goto(URL0+'?code=xyz'); await p.waitForTimeout(900);
    must(!/code=xyz/.test(await p.evaluate(()=>location.href)),'l url mostra ancora il codice consumato');
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
