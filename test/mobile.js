/* iPad e iPhone: che tutto sia raggiungibile con un dito.
   Le due macchine hanno esigenze diverse e sono provate diversamente:
   - su iPad la barra laterale resta fissa e il lavoro si fa tutto da li';
   - su iPhone la barra diventa un cassetto, e quello che conta e' che si apra,
     si chiuda da sola quando serve, e non lasci niente fuori dal bordo. */
const {chromium}=require('playwright');const fs=require('fs'),path=require('path');
function launchOpts(){for(const q of ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome','/opt/pw-browsers/chromium/chrome-linux/chrome'])if(fs.existsSync(q))return{executablePath:q};return{};}

const SCHERMI=[
  ['iPhone SE',           320,568,  'telefono'],
  ['iPhone 13',           390,664,  'telefono'],
  ['iPhone orizzontale',  664,390,  'telefono'],
  ['iPad mini verticale', 768,1024, 'tavoletta'],
  ['iPad Pro verticale',  834,1194, 'tavoletta'],
  ['iPad orizzontale',   1024,768,  'tavoletta'],
];

(async()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  fs.writeFileSync(path.join(__dirname,'app-test.html'),
    src.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/,'<script src="mock.js"></script>'));
  const b=await chromium.launch(launchOpts());
  const URL0='file://'+path.join(__dirname,'app-test.html');
  const ok=[],ko=[];
  const must=(c,m)=>{ if(!c) throw new Error(m||'falso'); };
  const t=async(n,f)=>{ try{ await f(); ok.push(n); console.log('  ✓',n); }
                        catch(e){ ko.push(n+' → '+e.message.split('\n')[0]); console.log('  ✗',n,'→',e.message.split('\n')[0]); } };

  /* Chi sborda per davvero: non chi sta dentro un contenitore fatto apposta
     per scorrere in orizzontale, come le tabelle o la barra delle schede. */
  const SBORDANO=`(()=>{
    const pg=document.getElementById('page');
    const dentroScroller=e=>{ let n=e.parentElement;
      while(n&&n!==pg){ const st=getComputedStyle(n);
        if(st.overflowX==='auto'||st.overflowX==='scroll') return true; n=n.parentElement; }
      return false; };
    return [...pg.querySelectorAll('*')].filter(e=>{
      const r=e.getBoundingClientRect();
      return r.width>0 && r.right>window.innerWidth+1 && !dentroScroller(e);
    }).map(e=>e.tagName.toLowerCase()+'."'+(e.textContent||'').trim().slice(0,24)+'"');
  })()`;

  for(const [nome,w,h,tipo] of SCHERMI){
    console.log('\n— '+nome+' ('+w+'x'+h+') —');
    const ctx=await b.newContext({viewport:{width:w,height:h},isMobile:true,hasTouch:true});
    const p=await ctx.newPage();
    p.on('pageerror',e=>ko.push('PAGEERROR '+nome+': '+e.message));
    await p.goto(URL0); await p.waitForTimeout(1000);
    await p.evaluate(async()=>{
      const {data}=await SB.from('projects').insert({codice:'MOB_01',name:'Villa sul mare',
        status:'attivo',client:'Rossi Mario',amount:24000,start_date:'2026-03-02',
        end_date:'2026-09-30'}).select().single();
      await generaStruttura(data.id,'interno',['catasto'],'2026-03-02');
      await loadAll(true); go('projects');
    });
    await p.waitForTimeout(700);

    if(tipo==='tavoletta'){
      await t(nome+': la barra laterale resta al suo posto',async()=>{
        const g=await p.evaluate(()=>({
          largh:Math.round(document.getElementById('side').getBoundingClientRect().width),
          x:Math.round(document.getElementById('side').getBoundingClientRect().left),
          bottone:getComputedStyle(document.getElementById('menubtn')).display}));
        must(g.largh>200&&g.x===0,'la barra non e visibile a sinistra: '+JSON.stringify(g));
        must(g.bottone==='none','su tavoletta compare il pulsante del menu, che non serve');
      });
    } else {
      await t(nome+': la barra e un cassetto, e il contenuto prende tutto',async()=>{
        const g=await p.evaluate(()=>({
          main:Math.round(document.getElementById('main').getBoundingClientRect().width),
          bottone:getComputedStyle(document.getElementById('menubtn')).display,
          velo:document.getElementById('sidevelo').hidden}));
        must(g.main>=w-1,'al contenuto restano solo '+g.main+' punti su '+w);
        must(g.bottone!=='none','manca il pulsante per aprire il menu');
        must(g.velo===true,'il velo e gia visibile a cassetto chiuso');
      });
      await t(nome+': il cassetto si apre e si arriva in fondo al menu',async()=>{
        await p.tap('#menubtn'); await p.waitForTimeout(400);
        const g=await p.evaluate(()=>{
          const s=document.getElementById('side');
          s.scrollTop=s.scrollHeight;
          const voci=[...document.querySelectorAll('.sn')];
          const u=voci[voci.length-1].getBoundingClientRect();
          const alte=voci.filter(v=>v.getBoundingClientRect().height>=44).length;
          return {aperto:s.classList.contains('aperto'), velo:!document.getElementById('sidevelo').hidden,
                  ultimaDentro:u.top>=0&&u.bottom<=window.innerHeight+1&&u.left>=-1,
                  vociAlte:alte, voci:voci.length};
        });
        must(g.aperto,'il cassetto non si e aperto');
        must(g.velo,'il velo non e comparso');
        must(g.ultimaDentro,'l ultima voce del menu resta fuori dallo schermo');
        must(g.vociAlte===g.voci,'solo '+g.vociAlte+' voci su '+g.voci+' sono alte almeno 44 punti');
      });
      await t(nome+': scegliendo una voce il cassetto si richiude da solo',async()=>{
        await p.tap('.sn[data-page="fatturare"]'); await p.waitForTimeout(400);
        const g=await p.evaluate(()=>({
          aperto:document.getElementById('side').classList.contains('aperto'),
          velo:!document.getElementById('sidevelo').hidden, pagina:S.page}));
        must(g.pagina==='fatturare','non e andato su "Da fatturare": '+g.pagina);
        must(!g.aperto,'il cassetto e rimasto aperto sopra la pagina appena scelta');
        must(!g.velo,'il velo e rimasto');
      });
      await t(nome+': toccando il velo si richiude',async()=>{
        await p.tap('#menubtn'); await p.waitForTimeout(350);
        await p.tap('#sidevelo',{position:{x:w-10,y:h-10}}); await p.waitForTimeout(350);
        must(!(await p.evaluate(()=>document.getElementById('side').classList.contains('aperto'))),
          'il velo non richiude il cassetto');
      });
      await t(nome+': i campi non fanno ingrandire la pagina da soli',async()=>{
        /* Safari di iOS ingrandisce quando si tocca un campo sotto i 16px */
        await p.evaluate(()=>{ go('projects'); openNewProj(); });
        await p.waitForTimeout(400);
        const piccoli=await p.evaluate(()=>[...document.querySelectorAll('.ov.show input,.ov.show textarea,.ov.show select')]
          .filter(e=>parseFloat(getComputedStyle(e).fontSize)<16).length);
        must(piccoli===0,piccoli+' campi hanno il testo sotto i 16 punti: iOS ingrandirebbe la pagina');
        await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      });
    }

    await t(nome+': si apre una commessa toccandola',async()=>{
      await p.evaluate(()=>{ go('projects'); });
      await p.waitForTimeout(500);
      const riga=p.locator('#page [data-proj]').first();
      must(await riga.count()>0,'nessuna commessa da toccare');
      await riga.tap();
      await p.waitForTimeout(600);
      must(await p.evaluate(()=>S.page)==='project','la scheda non si e aperta');
    });
    await t(nome+': dentro la commessa niente finisce oltre il bordo',async()=>{
      const fuori=[];
      for(const tab of ['avanzamento','pratiche','fatturazione','contabilita','anagrafica','ore']){
        await p.evaluate(x=>{ S.tab=x; render(); },tab);
        await p.waitForTimeout(250);
        const s=await p.evaluate(SBORDANO);
        if(s.length) fuori.push(tab+': '+s.slice(0,2).join(', '));
      }
      must(fuori.length===0,'oltre il bordo → '+fuori.join(' | '));
    });
    await t(nome+': le finestre ci stanno nello schermo',async()=>{
      for(const apri of ['openNewProj()','openTask(null,S.projId)','openOre(S.projId)']){
        await p.evaluate(a=>{ eval(a); },apri);
        await p.waitForTimeout(350);
        const g=await p.evaluate(()=>{
          const m=document.querySelector('.ov.show .modal'); if(!m) return {salta:true};
          const r=m.getBoundingClientRect();
          return {ci:r.left>=-1&&r.right<=window.innerWidth+1&&r.height<=window.innerHeight+1,
                  w:Math.round(r.width),h:Math.round(r.height)};
        });
        if(!g.salta) must(g.ci,apri+' esce dallo schermo ('+g.w+'x'+g.h+')');
        await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      }
    });
    await ctx.close();
  }
  await b.close();
  console.log(ko.length?'\n✗ FALLITI ('+ko.length+')\n   '+ko.join('\n   '):'\n✓ PASSATI ('+ok.length+')');
  process.exit(ko.length?1:0);
})();
