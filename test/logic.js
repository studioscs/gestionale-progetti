const fs=require('fs'),vm=require('vm');
const h=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const blocks=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);

// stub minimo di DOM/Supabase: ci interessa solo la logica pura
const noop=()=>{}; const elStub=()=>({value:'',textContent:'',innerHTML:'',style:{},classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},dataset:{},appendChild:noop,addEventListener:noop,querySelectorAll:()=>[],getBoundingClientRect:()=>({}),remove:noop,onclick:null});
const ctx={console,setTimeout,clearInterval,setInterval:()=>0,Date,Math,Number,String,Object,Array,Set,JSON,isNaN,parseInt,parseFloat,prompt:()=>null,confirm:()=>true,
  supabase:{createClient:()=>new Proxy({},{get:()=>()=>new Proxy({},{get:()=>()=>Promise.resolve({data:[],error:null})})})},
  window:{location:{href:''},innerWidth:1200,innerHeight:800},
  document:{getElementById:elStub,querySelector:elStub,querySelectorAll:()=>[],addEventListener:noop,createElement:elStub,body:elStub(),hidden:false}};
ctx.globalThis=ctx;
vm.createContext(ctx);
try{vm.runInContext(blocks.slice(0,4).join('\n;\n')+'\n;Object.assign(globalThis,{pd,iso,today,todayISO,addD,diffD,fdate,isLate,isSoon,dueLabel,esc,ini,pianifica,statoDerivato,scadenze,praticaLate,praticaOpen,progressOf,costoDi,costoAttuale,costoCommessa,migrazioneDi,feriale,impegnoStimato,STUDIO,S,TEMPLATES,CONDIZIONI,PRATICHE_CAT});',ctx)}catch(e){console.log('LOAD ERR',e.message)}

let fail=0;
const r2b=n=>Math.round(n*100)/100;
const t=(name,cond,got)=>{ if(!cond){fail++;console.log('  ✗',name,'→',JSON.stringify(got));} else console.log('  ✓',name); };

console.log('\n— DATE —');
t('pd/iso round-trip','2026-03-09'===ctx.iso(ctx.pd('2026-03-09')),ctx.iso(ctx.pd('2026-03-09')));
t('fdate italiano',ctx.fdate('2026-03-09')==='09/03/2026',ctx.fdate('2026-03-09'));
t('oggi NON è scaduto',ctx.isLate(ctx.todayISO())===false,ctx.isLate(ctx.todayISO()));
t('ieri è scaduto',ctx.isLate(ctx.iso(ctx.addD(ctx.today(),-1)))===true,null);
t('domani non è scaduto',ctx.isLate(ctx.iso(ctx.addD(ctx.today(),1)))===false,null);
t('dueLabel oggi',ctx.dueLabel(ctx.todayISO())==='oggi',ctx.dueLabel(ctx.todayISO()));
t('dueLabel domani',ctx.dueLabel(ctx.iso(ctx.addD(ctx.today(),1)))==='domani',null);
t('null safe',ctx.fdate(null)==='-'&&ctx.isLate(null)===false,null);
t('esc apostrofo',ctx.esc(`a'<b>`)==='a&#39;&lt;b&gt;',ctx.esc(`a'<b>`));
t('esc numero 0',ctx.esc(0)==='0',ctx.esc(0));
t('ini due iniziali',ctx.ini('Mario Rossi Bianchi')==='MR',ctx.ini('Mario Rossi Bianchi'));

console.log('\n— TEMPLATE —');
const tk=Object.keys(ctx.TEMPLATES);
t('7 template',tk.length===7,tk);
let tot=0,fasiTot=0;
tk.forEach(k=>{const T=ctx.TEMPLATES[k];fasiTot+=T.fasi.length;T.fasi.forEach(f=>tot+=f.att.length);});
console.log('   fasi totali:',fasiTot,'| attività totali:',tot);
t('ogni attività ha titolo',tk.every(k=>ctx.TEMPLATES[k].fasi.every(f=>f.att.every(a=>a.t&&a.t.length>3))),null);
t('cond usate esistono',(()=>{const ok=ctx.CONDIZIONI.map(c=>c.k);
  return tk.every(k=>ctx.TEMPLATES[k].fasi.every(f=>(!f.cond||ok.includes(f.cond))&&f.att.every(a=>!a.cond||ok.includes(a.cond))));})(),null);
t('pratiche: cond valide',ctx.PRATICHE_CAT.every(p=>!p.cond||ctx.CONDIZIONI.map(c=>c.k).includes(p.cond)),
  ctx.PRATICHE_CAT.filter(p=>p.cond&&!ctx.CONDIZIONI.map(c=>c.k).includes(p.cond)).map(p=>p.cond));

console.log('\n— PIANIFICAZIONE —');
const full=ctx.CONDIZIONI.map(c=>c.k);
const p1=ctx.pianifica('privato',full,'2026-01-07');
t('privato completo: 16 fasi',p1.fasi.length===16,p1.fasi.length);
console.log('   attività generate:',p1.fasi.reduce((a,f)=>a+f.att.length,0),'| pratiche:',p1.pratiche.length);
t('tutte le attività hanno scadenza',p1.fasi.every(f=>f.att.every(a=>a.due_date)),null);
t('scadenze crescenti nella fase',p1.fasi.every(f=>{const d=f.att.filter(a=>!a.is_milestone).map(a=>a.due_date);return d.every((x,i)=>i===0||x>=d[i-1]);}),null);
t('fasi ordinate',p1.fasi.every((f,i)=>f.ordine===i),null);
t('inizio = data richiesta',p1.fasi[0].data_inizio==='2026-01-07',p1.fasi[0].data_inizio);

const p2=ctx.pianifica('privato',['strutture','impianti'],'2026-01-07');
t('senza vincoli: meno fasi',p2.fasi.length<p1.fasi.length,[p2.fasi.length,p1.fasi.length]);
t('senza paesaggistico: nessuna ISTANZA paesaggistica',
  !p2.fasi.some(f=>f.att.some(a=>/^(Istanza|Relazione|Rendering).*paesagg/i.test(a.title))),
  p2.fasi.flatMap(f=>f.att.filter(a=>/^(Istanza|Relazione|Rendering).*paesagg/i.test(a.title)).map(a=>a.title)));
t('con paesaggistico: documentazione presente',
  p1.fasi.some(f=>f.att.some(a=>/^Relazione paesaggistica/.test(a.title))),null);
t('verifica vincoli sempre presente (base)',
  p2.fasi.some(f=>f.att.some(a=>/^Verifica dei vincoli/.test(a.title))),null);
t('senza sismica_aut: no art.94, si art.93',
  !p2.fasi.some(f=>f.att.some(a=>/\b94 DPR/.test(a.rif_normativo||''))) &&
   p2.fasi.some(f=>f.att.some(a=>/\b93\b/.test(a.rif_normativo||''))),null);
t('milestone scadono a fine fase',
  p1.fasi.every(f=>f.att.filter(a=>a.is_milestone).every(a=>a.due_date===f.data_fine_prevista)),null);
t('senza vvf: nessuna pratica VVF',!p2.pratiche.some(x=>/Vigili/.test(x.ente)),null);
const p3=ctx.pianifica('vuoto',[],null);
t('template vuoto: 1 fase 0 attività',p3.fasi.length===1&&p3.fasi[0].att.length===0,p3.fasi.length);
const p4=ctx.pianifica('pubblico',full,'2026-02-02');
t('pubblico: 9 fasi',p4.fasi.length===9,p4.fasi.length);
const p5=ctx.pianifica('strutture',full,null);
t('strutture: 8 fasi',p5.fasi.length===8,p5.fasi.length);
const p6=ctx.pianifica('vincolo',full,null);
t('vincolo: 6 fasi',p6.fasi.length===6,p6.fasi.length);

console.log('\n— AVANZAMENTO —');
ctx.S.tasks=[{id:'a',commessa_fase_id:'F',status:'da_fare',opzionale:false},
             {id:'b',commessa_fase_id:'F',status:'da_fare',opzionale:false},
             {id:'c',commessa_fase_id:'F',status:'da_fare',opzionale:true}];
t('nessuna chiusa → non_avviata',ctx.statoDerivato('F')==='non_avviata',ctx.statoDerivato('F'));
ctx.S.tasks[0].status='completato';
t('una chiusa → in_corso',ctx.statoDerivato('F')==='in_corso',ctx.statoDerivato('F'));
ctx.S.tasks[1].status='completato';
t('opzionale ignorata → completata',ctx.statoDerivato('F')==='completata',ctx.statoDerivato('F'));
ctx.S.tasks[1].status='in_corso';
t('in corso → in_corso',ctx.statoDerivato('F')==='in_corso',ctx.statoDerivato('F'));
t('fase senza attività → null',ctx.statoDerivato('X')===null,ctx.statoDerivato('X'));

console.log('\n— SCADENZE —');
ctx.S.tasks=[{id:'1',status:'da_fare',due_date:ctx.iso(ctx.addD(ctx.today(),-3)),title:'vecchio',project_id:'P',assignee_id:'U'},
             {id:'2',status:'completato',due_date:ctx.iso(ctx.addD(ctx.today(),-9)),title:'chiuso',project_id:'P',assignee_id:'U'},
             {id:'3',status:'da_fare',due_date:ctx.iso(ctx.addD(ctx.today(),5)),title:'futuro',project_id:'P',assignee_id:'Z'}];
ctx.S.pratiche=[{id:'p1',stato:'inviata',data_scadenza:ctx.iso(ctx.addD(ctx.today(),-1)),ente:'VVF',tipo:'SCIA',project_id:'P',responsabile_id:'U'},
                {id:'p2',stato:'rilasciata',data_scadenza:ctx.iso(ctx.addD(ctx.today(),-30)),ente:'X',tipo:'Y',project_id:'P',responsabile_id:'U'}];
const sc=ctx.scadenze(null);
t('esclude task completati',!sc.some(s=>s.id==='2'),sc.map(s=>s.id));
t('esclude pratiche rilasciate',!sc.some(s=>s.id==='p2'),null);
t('ordinate per data',sc.map(s=>s.date).every((d,i)=>i===0||d>=sc[i-1].date),sc.map(s=>s.date));
t('filtro per utente',ctx.scadenze('U').length===2,ctx.scadenze('U').length);
t('pratica scaduta rilevata',ctx.praticaLate(ctx.S.pratiche[0])===true,null);
t('pratica chiusa non scaduta',ctx.praticaLate(ctx.S.pratiche[1])===false,null);


console.log('\n— PRATICA SNELLA (interno) —');
const pi=ctx.pianifica('interno',full,'2026-09-01');
t('interno: 6 fasi',pi.fasi.length===6,pi.fasi.length);
const nAttI=pi.fasi.reduce((a,f)=>a+f.att.length,0);
console.log('   attività:',nAttI,'| pratiche:',pi.pratiche.length);
t('interno resta snella anche con tutte le condizioni', nAttI<60, nAttI);
t('interno genera pochissime pratiche', pi.pratiche.length<=3, pi.pratiche.map(x=>x.k));
t('interno genera la CILA', pi.pratiche.some(x=>x.k==='cila'), pi.pratiche.map(x=>x.k));
t('privato genera il titolo edilizio', ctx.pianifica('privato',full,null).pratiche.some(x=>x.k==='titolo_edilizio'), null);
t('interno non genera pareri di enti terzi',
  !pi.fasi.some(f=>f.att.some(a=>/Soprintendenza|Vigili del Fuoco|paesagg/i.test((a.ente||'')+a.title))),
  pi.fasi.flatMap(f=>f.att.filter(a=>/Soprintendenza|Vigili|paesagg/i.test((a.ente||'')+a.title)).map(a=>a.title)));

console.log('\n— FIRME ANTICIPATE —');
['interno','privato','strutture','vincolo'].forEach(k=>{
  const pl=ctx.pianifica(k,full,'2026-09-01');
  const idx=pl.fasi.findIndex(f=>f.fase_key==='firme');
  t(k+': ha la fase firme',idx>=0,idx);
  if(idx<0) return;
  t(k+': firme nella prima metà del percorso',idx<pl.fasi.length/2,idx+'/'+pl.fasi.length);
  const firme=pl.fasi[idx].att.filter(a=>a.categoria==='firma_cliente');
  t(k+': la fase firme contiene documenti da firmare',firme.length>=2,firme.length);
  // nessun documento da firmare deve stare DOPO la presentazione delle pratiche
  const ultimaFirma=Math.max(...pl.fasi.map((f,i)=>f.att.some(a=>a.categoria==='firma_cliente')?i:-1));
  t(k+': nessuna firma isolata a fine percorso',ultimaFirma<pl.fasi.length-1||k==='privato',ultimaFirma);
});
const pp=ctx.pianifica('privato',full,'2026-09-01');
t('privato: firme prima dei pareri agli enti',
  pp.fasi.findIndex(f=>f.fase_key==='firme') < pp.fasi.findIndex(f=>f.fase_key==='pareri'),
  pp.fasi.map(f=>f.fase_key));
t('privato: firme dopo che il progetto e impostato',
  pp.fasi.findIndex(f=>f.fase_key==='preliminare') < pp.fasi.findIndex(f=>f.fase_key==='firme'),null);
t('privato: una procura per ogni pratica telematica',(()=>{
  const nProc=pp.pratiche.filter(x=>x.proc).length;
  return nProc>=5;})(), pp.pratiche.filter(x=>x.proc).length);

console.log('\n— OPERE PUBBLICHE: DOCUMENTAZIONE PRIMA DEI PARERI —');
const pu=ctx.pianifica('pubblico',full,'2026-09-01');
const iEnti=pu.fasi.findIndex(f=>f.fase_key==='enti');
const iPfte=pu.fasi.findIndex(f=>f.fase_key==='pfte');
const iCds =pu.fasi.findIndex(f=>f.fase_key==='cds');
t('documentazione enti prima del PFTE',iEnti<iPfte,[iEnti,iPfte]);
t('PFTE prima della conferenza di servizi',iPfte<iCds,[iPfte,iCds]);
t('stralcio archeologico nella fase enti, non nel PFTE',
  pu.fasi[iEnti].att.some(a=>/stralcio.*archeolog/i.test(a.title)),null);
t('prerequisiti dei pareri marcati',
  pu.fasi[iEnti].att.filter(a=>a.categoria==='prereq_parere').length>=5,
  pu.fasi[iEnti].att.filter(a=>a.categoria==='prereq_parere').length);
/* Il PFTE ha assorbito il vecchio definitivo: quella fase non deve piu' esistere
   in nessuna configurazione del template pubblico. */
t('il progetto definitivo non esiste piu nel pubblico',
  ctx.TEMPLATES.pubblico.fasi.every(f=>f.k!=='definitivo'),
  ctx.TEMPLATES.pubblico.fasi.map(f=>f.k));
t('nessuna condizione "definitivo" residua',
  !ctx.CONDIZIONI.some(c=>c.k==='definitivo'),ctx.CONDIZIONI.map(c=>c.k));
t('generando non compare la fase definitivo',
  ctx.pianifica('pubblico',['strutture','dl','definitivo'],null).fasi.every(f=>f.fase_key!=='definitivo'),null);

console.log('\n— PFTE SECONDO L ALLEGATO I.7 —');
const pfte=ctx.TEMPLATES.pubblico.fasi.find(f=>f.k==='pfte');
t('la fase PFTE esiste',!!pfte,null);
const tit=pfte.att.map(a=>a.t);
/* Le lettere dell'art. 6 c. 7: se una sparisce dal template, l'elaborato non
   viene generato e il collaboratore non sa che deve produrlo. */
['a) Relazione generale','b) Relazione tecnica','c) Relazione di verifica preventiva',
 'd) Studio di impatto ambientale','e) Relazione di sostenibilità','f) Rilievi plano-altimetrici',
 'g) Modelli informativi','h) Elaborati grafici','i) Computo estimativo',
 'l) Quadro economico','m) Piano economico e finanziario','n) Cronoprogramma',
 'o) Piano di sicurezza'].forEach(x=>
  t('elaborato presente: '+x, tit.some(y=>y.indexOf(x)===0), tit.filter(y=>y[0]===x[0])));
t('piano particellare di esproprio previsto',
  tit.some(y=>/particellare di esproprio/i.test(y)),null);
t('verifica di completezza sull Allegato I.7',
  tit.some(y=>/completezza rispetto all/i.test(y)),null);
t('ogni elaborato richiama la norma',
  pfte.att.filter(a=>/^[a-o]\)/.test(a.t)).every(a=>/All\. I\.7/.test(a.rif||'')),
  pfte.att.filter(a=>/^[a-o]\)/.test(a.t)&&!/All\. I\.7/.test(a.rif||'')).map(a=>a.t));
t('ogni elaborato dice cosa deve contenere',
  pfte.att.filter(a=>/^[a-o]\)/.test(a.t)).every(a=>(a.cont||'').length>80),
  pfte.att.filter(a=>/^[a-o]\)/.test(a.t)&&(a.cont||'').length<=80).map(a=>a.t));
t('gli elaborati condizionati restano tali',
  pfte.att.find(a=>/^d\)/.test(a.t)).cond==='via'
  && pfte.att.find(a=>/^c\)/.test(a.t)).cond==='archeologico',null);
t('esproprio e una condizione selezionabile',
  ctx.CONDIZIONI.some(c=>c.k==='esproprio'),null);
t('senza esproprio il piano particellare non viene generato',
  ctx.pianifica('pubblico',['strutture'],null).fasi
    .find(f=>f.fase_key==='pfte').att.every(a=>!/particellare/i.test(a.title)),null);

console.log('\n— PROGETTO ESECUTIVO SECONDO L ALLEGATO I.7 —');
const ese=ctx.TEMPLATES.pubblico.fasi.find(f=>f.k==='esecutivo');
t('la fase esecutivo esiste',!!ese,null);
const tEs=ese.att.map(a=>a.t);
/* Le lettere dell'art. 22 c. 1: se una manca, l'elaborato non viene generato */
[['a','Relazione generale'],['b','Relazioni specialistiche'],['c','Elaborati grafici'],
 ['d','Calcoli esecutivi'],['e','Piano di manutenzione'],['f','Aggiornamento del piano di sicurezza'],
 ['g','Quadro di incidenza della manodopera'],['h','Cronoprogramma'],
 ['i','Elenco dei prezzi unitari'],['l','Computo metrico'],['m','Schema di contratto']
].forEach(([L,x])=>
  t('lettera '+L+') presente: '+x, tEs.some(y=>y.indexOf(L+') '+x)===0), tEs.filter(y=>y.indexOf(L+')')===0)));
t('anche il capitolato speciale, sempre lettera m)',
  tEs.some(y=>/^m\) Capitolato speciale/.test(y)),null);
t('anche il quadro economico, sempre lettera l)',
  tEs.some(y=>/^l\) Quadro economico/.test(y)),null);
t('tutte le lettere da a) a m) coperte',(()=>{
  const L=new Set(tEs.map(y=>(y.match(/^([a-m])\)/)||[])[1]).filter(Boolean));
  return ['a','b','c','d','e','f','g','h','i','l','m'].every(x=>L.has(x));})(),
  [...new Set(tEs.map(y=>(y.match(/^([a-m])\)/)||[])[1]).filter(Boolean))]);
t('ogni elaborato richiama l Allegato I.7',
  ese.att.filter(a=>/^[a-m]\)/.test(a.t)).every(a=>/All\. I\.7/.test(a.rif||'')),
  ese.att.filter(a=>/^[a-m]\)/.test(a.t)&&!/All\. I\.7/.test(a.rif||'')).map(a=>a.t));
t('ogni elaborato dice cosa deve contenere',
  ese.att.filter(a=>/^[a-m]\)/.test(a.t)).every(a=>(a.cont||'').length>80),
  ese.att.filter(a=>/^[a-m]\)/.test(a.t)&&(a.cont||'').length<=80).map(a=>a.t));
/* Il piano di manutenzione ha tre parti e vanno nominate: e' l'errore piu'
   frequente, consegnarne solo una. */
t('il piano di manutenzione nomina i suoi tre documenti',(()=>{
  const c=ese.att.find(a=>/^e\)/.test(a.t)).cont;
  return /MANUALE D.USO/i.test(c)&&/MANUALE DI MANUTENZIONE/i.test(c)&&/PROGRAMMA DI MANUTENZIONE/i.test(c);})(),
  ese.att.find(a=>/^e\)/.test(a.t)).cont);
t('i calcoli esecutivi chiedono il giudizio di accettabilita',
  /accettabilit/i.test(ese.att.find(a=>/^d\) Calcoli esecutivi delle strutture/.test(a.t)).cont),null);
t('strutture e impianti restano condizionati',
  ese.att.find(a=>/^d\) Calcoli esecutivi delle strutture/.test(a.t)).cond==='strutture'
  && ese.att.find(a=>/^d\) Calcoli esecutivi degli impianti/.test(a.t)).cond==='impianti',null);
t('verifica di completezza sull Allegato I.7',
  tEs.some(y=>/completezza rispetto all/i.test(y)),null);
/* Il fascicolo dell'opera accompagna l'esecutivo ma non e' una delle lettere
   dell'art. 22: nasce dal D.Lgs 81/2008 e va richiamato per quello. */
t('il fascicolo non e spacciato per una lettera dell art. 22',
  tEs.some(y=>y==='Fascicolo con le caratteristiche dell’opera'),
  tEs.filter(y=>/Fascicolo/.test(y)));
t('senza strutture non si generano i calcoli strutturali',
  ctx.pianifica('pubblico',['impianti'],null).fasi.find(f=>f.fase_key==='esecutivo')
    .att.every(a=>!/^d\) Calcoli esecutivi delle strutture/.test(a.title)),null);

console.log('\n— TEMPLATE SOLA DIREZIONE LAVORI —');
const dl=ctx.TEMPLATES.dl_cse;
t('il template esiste',!!dl,null);
t('nessuna fase di progettazione',
  dl.fasi.every(f=>['pfte','esecutivo','definitivo','progetto','cds','gara'].indexOf(f.k)<0),
  dl.fasi.map(f=>f.k));
t('parte dall affidamento dell incarico',dl.fasi[0].k==='incarico',dl.fasi[0].k);
t('ha la fase di contabilita e SAL',dl.fasi.some(f=>f.k==='contabilita'),null);
t('ha la fase delle varianti',dl.fasi.some(f=>f.k==='varianti'),null);
t('ha il coordinamento sicurezza in esecuzione',dl.fasi.some(f=>f.k==='sicurezza_ese'),null);
t('chiede di registrare importo lavori e compenso DL',
  dl.fasi[0].att.some(a=>/importo contrattuale.*compenso/i.test(a.t)),null);
const genDl=ctx.pianifica('dl_cse',['sicurezza','dl'],'2026-03-01');
t('genera fasi e attivita',genDl.fasi.length>=6&&genDl.fasi.reduce((a,f)=>a+f.att.length,0)>=40,
  [genDl.fasi.length,genDl.fasi.reduce((a,f)=>a+f.att.length,0)]);
t('non genera pratiche di progetto',
  genDl.pratiche.every(x=>x.k==='notifica81'),genDl.pratiche.map(x=>x.k));

console.log('\n— PROCURE PER PRATICA —');
t('le pratiche telematiche sono marcate proc',
  ctx.PRATICHE_CAT.filter(x=>x.proc).length>=15, ctx.PRATICHE_CAT.filter(x=>x.proc).length);
t('catasto e notifiche non richiedono procura speciale',
  !ctx.PRATICHE_CAT.find(x=>x.k==='docfa').proc && !ctx.PRATICHE_CAT.find(x=>x.k==='notifica81').proc, null);

console.log('\n— COSTO DEL PERSONALE —');
/* Due periodi per la stessa persona: 25 €/h fino al 31/03, 30 €/h dal 01/04 */
ctx.S.costi=[
  {id:'c1',profile_id:'u1',costo_orario_lordo:25,costo_orario_netto:15,valido_dal:'2026-01-01',valido_al:'2026-03-31'},
  {id:'c2',profile_id:'u1',costo_orario_lordo:30,costo_orario_netto:18,valido_dal:'2026-04-01',valido_al:null},
  {id:'c3',profile_id:'u2',costo_orario_lordo:40,costo_orario_netto:24,valido_dal:'2026-01-01',valido_al:null}];
ctx.S.projects=[{id:'p1',name:'Commessa test',amount:10000}];
ctx.S.time=[
  {project_id:'p1',operator_id:'u1',entry_date:'2026-02-10',hours:10},
  {project_id:'p1',operator_id:'u1',entry_date:'2026-05-10',hours:10},
  {project_id:'p1',operator_id:'u2',entry_date:'2026-05-10',hours:5},
  {project_id:'p1',operator_id:'u3',entry_date:'2026-05-10',hours:3}];

t('costo di febbraio alla tariffa vecchia',ctx.costoDi('u1','2026-02-10').costo_orario_lordo===25,
  ctx.costoDi('u1','2026-02-10'));
t('costo di maggio alla tariffa nuova',ctx.costoDi('u1','2026-05-10').costo_orario_lordo===30,null);
t('ultimo giorno del vecchio periodo',ctx.costoDi('u1','2026-03-31').costo_orario_lordo===25,null);
t('primo giorno del nuovo periodo',ctx.costoDi('u1','2026-04-01').costo_orario_lordo===30,null);
t('prima di ogni periodo: nessun costo',ctx.costoDi('u1','2025-12-31')===null,ctx.costoDi('u1','2025-12-31'));
t('chi non ha tariffa non ha costo',ctx.costoDi('u3','2026-05-10')===null,null);
t('periodo aperto = costo attuale',ctx.costoAttuale('u1').costo_orario_lordo===30,null);

const cc=ctx.costoCommessa('p1');
t('ore totali',cc.ore===28,cc.ore);
t('costo lordo alle tariffe del giorno',cc.lordo===750,cc.lordo); // 250+300+200+0
t('costo netto',cc.netto===450,cc.netto);                        // 150+180+120+0
t('costo orario medio sul totale ore',cc.medio===26.79,cc.medio); // 750/28
t('persone coinvolte',cc.persone===3,cc.persone);
t('durata dalla prima all ultima ora',cc.giorni===90,cc.giorni);  // 10/02 -> 10/05
t('margine sull importo di commessa',cc.margine===9250,cc.margine);
t('segnala chi lavora senza tariffa',cc.perPersona.u3.senzaCosto===true&&cc.perPersona.u1.senzaCosto===false,null);
t('commessa senza ore: nessun costo',(()=>{const v=ctx.costoCommessa('mai');
  return v.ore===0&&v.lordo===0&&v.giorni===0&&v.medio===0;})(),ctx.costoCommessa('mai'));

console.log('\n— DIAGNOSI DI DATABASE NON AGGIORNATO —');
/* Il messaggio deve nominare la migrazione giusta: mandare a eseguire la 001
   quando manca una colonna della 010 fa perdere tempo a chi lo legge. */
t('sisma → migrazione 010',ctx.migrazioneDi('sisma')==='sql/010_lavori_sisma.sql',ctx.migrazioneDi('sisma'));
t('ente_pubblico → migrazione 011',ctx.migrazioneDi('ente_pubblico')==='sql/011_fatturazione_pa.sql',
  ctx.migrazioneDi('ente_pubblico'));
t('cup → migrazione 011',ctx.migrazioneDi('cup')==='sql/011_fatturazione_pa.sql',ctx.migrazioneDi('cup'));
t('profili_costi → migrazione 009',ctx.migrazioneDi('profili_costi')==='sql/009_costi_personale.sql',null);
t('enti_pa → migrazione 011',ctx.migrazioneDi('enti_pa')==='sql/011_fatturazione_pa.sql',null);
t('clienti → migrazione 008',ctx.migrazioneDi('clienti')==='sql/008_anagrafica_clienti.sql',null);
t('referente_tec → migrazione 007',ctx.migrazioneDi('referente_tec')==='sql/007_referente_tecnico.sql',null);
t('cliente_sdi → migrazione 005',ctx.migrazioneDi('cliente_sdi')==='sql/005_fatturazione.sql',null);
t('colonna sconosciuta non inventa un file',ctx.migrazioneDi('pippo')===null,ctx.migrazioneDi('pippo'));
/* Il messaggio reale di PostgREST, quello visto dall'utente */
const msg="Could not find the 'sisma' column of 'projects' in the schema cache";
const nome=(msg.match(/'([a-z_]+)' column/i)||[])[1];
t('estrae il nome dal messaggio di PostgREST',nome==='sisma',nome);
t('e ne ricava la migrazione',ctx.migrazioneDi(nome)==='sql/010_lavori_sisma.sql',null);

console.log('\n— EDILIZIA PRIVATA: PERCORSO COMPLETO —');
const pv=ctx.TEMPLATES.privato;
t('percorso articolato',pv.fasi.length>=14,pv.fasi.length);
const nAtt=pv.fasi.reduce((a,f)=>a+f.att.length,0);
t('almeno 110 attivita',nAtt>=110,nAtt);
console.log('   privato →',pv.fasi.length,'fasi ·',nAtt,'attivita');

/* La sequenza delle fasi e' essa stessa un'informazione: lo stato legittimo
   prima del progetto, i pareri prima del titolo, il titolo prima del cantiere. */
const kf=pv.fasi.map(f=>f.k);
const pos=k=>kf.indexOf(k);
t('stato legittimo prima del progetto',pos('legittimo')<pos('preliminare'),kf);
t('indagini prima del progetto architettonico',pos('indagini')<pos('architettonico'),kf);
t('pareri prima della presentazione del titolo',pos('pareri')<pos('presentazione'),kf);
t('architettonico prima di strutture e impianti',
  pos('architettonico')<pos('strutture')&&pos('architettonico')<pos('impianti'),kf);
t('titolo prima dell avvio del cantiere',pos('presentazione')<pos('avvio'),kf);
t('cantiere prima della chiusura',pos('avvio')<pos('dl')&&pos('dl')<pos('chiusura'),kf);

/* Le discipline che il committente si aspetta di trovare tutte */
[['legittimo','stato legittimo'],['architettonico','architettonico'],['strutture','strutturale'],
 ['impianti','impianti'],['energetica','energetica'],['acustica','acustica'],
 ['sicurezza','sicurezza'],['chiusura','agibilità']].forEach(([k,l])=>
  t('c e la fase '+l, kf.includes(k), kf));

const attPv=[];pv.fasi.forEach(f=>f.att.forEach(a=>attPv.push(a)));
const titoli=attPv.map(a=>a.t).join(' | ');
[['Salva Casa','stato legittimo','art. 9-bis'],
 ['tolleranze','tolleranze costruttive','34-bis'],
 ['barriere','barriere architettoniche','L. 13/1989'],
 ['rinnovabili','fonti rinnovabili','199/2021'],
 ['acustica passiva','requisiti acustici passivi','DPCM 5/12/1997'],
 ['collaudo statico','collaudo statico','art. 67'],
 ['catasto','DOCFA',''],
 ['gialli e rossi','gialli e rossi','']].forEach(([et,frase])=>
  t('previsto: '+et, new RegExp(frase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i').test(titoli), null));

t('i riferimenti normativi ci sono',attPv.filter(a=>a.rif).length>=20,
  attPv.filter(a=>a.rif).length);
t('gli elaborati chiave dicono cosa contenere',attPv.filter(a=>a.cont).length>=25,
  attPv.filter(a=>a.cont).length);

console.log('\n— PRATICHE IN ORDINE DI ESECUZIONE —');
t('ogni pratica ha un ordine',ctx.PRATICHE_CAT.every(p=>typeof p.ord==='number'),
  ctx.PRATICHE_CAT.filter(p=>typeof p.ord!=='number').map(p=>p.k));
const o=k=>ctx.PRATICHE_CAT.find(x=>x.k===k).ord;
t('accesso agli atti e il primo passo',o('accesso_atti')<o('cdu')&&o('cdu')<o('titolo_edilizio'),null);
t('la sanatoria precede il nuovo titolo',o('sanatoria')<o('titolo_edilizio'),null);
t('i pareri vincolanti precedono il titolo',
  o('paes_ord')<o('titolo_edilizio')&&o('sopr_art21')<o('titolo_edilizio')
  &&o('vvf_prog')<o('titolo_edilizio')&&o('idrogeo')<o('titolo_edilizio'),null);
t('il sismico segue il titolo e precede il cantiere',
  o('sismica_dep')>o('titolo_edilizio')&&o('sismica_dep')<o('notifica81'),null);
t('la notifica preliminare sta prima degli allacci',o('notifica81')<o('enel'),null);
t('catasto e APE precedono l agibilita',
  o('docfa')<o('agibilita')&&o('ape')<o('agibilita'),null);
t('il collaudo statico precede l agibilita',o('collaudo_statico')<o('agibilita'),null);
t('agibilita in fondo',ctx.PRATICHE_CAT.filter(p=>p.k!=='altro').every(p=>p.ord<=o('agibilita')),
  ctx.PRATICHE_CAT.filter(p=>p.k!=='altro'&&p.ord>o('agibilita')).map(p=>p.k));

const gen=ctx.pianifica('privato',ctx.CONDIZIONI.map(c=>c.k),'2026-01-07');
t('genera le pratiche gia ordinate',
  gen.pratiche.every((x,i,arr)=>i===0||arr[i-1].ord<=x.ord),
  gen.pratiche.map(x=>x.ord));
t('genera un numero realistico di pratiche',gen.pratiche.length>=30,gen.pratiche.length);
console.log('   pratiche generate:',gen.pratiche.length,'| prima:',gen.pratiche[0].k,
            '| ultima:',gen.pratiche[gen.pratiche.length-1].k);
t('senza condizioni restano solo le pratiche di base',
  ctx.pianifica('privato',[],'2026-01-07').pratiche.map(x=>x.k).sort().join(',')
    ==='accesso_atti,cdu,titolo_edilizio',
  ctx.pianifica('privato',[],'2026-01-07').pratiche.map(x=>x.k));

console.log('\n— IMPEGNO STIMATO DALLE ATTIVITÀ COMPLETATE —');
/* 2026-06-01 è un lunedì; 06 e 07 sono sabato e domenica */
t('lunedì è feriale',ctx.feriale('2026-06-01')===true,null);
t('venerdì è feriale',ctx.feriale('2026-06-05')===true,null);
t('sabato non conta',ctx.feriale('2026-06-06')===false,null);
t('domenica non conta',ctx.feriale('2026-06-07')===false,null);

ctx.S.costi=[{id:'c1',profile_id:'u1',costo_orario_lordo:50,costo_orario_netto:30,
  valido_dal:'2026-01-01',valido_al:null}];
ctx.S.projects=[{id:'pA',name:'A',amount:20000},{id:'pB',name:'B',amount:9000}];
ctx.S.time=[];
const T=(id,pid,fase,giorno)=>({id,project_id:pid,commessa_fase_id:fase,status:'completato',
  completed_at:giorno+'T10:00:00Z',completed_by:'u1'});
/* lun 1: solo pA · mar 2: pA e pB · sab 6: solo pA (non deve contare) */
ctx.S.tasks=[T('t1','pA','f1','2026-06-01'),T('t2','pA','f1','2026-06-02'),
             T('t3','pB','f9','2026-06-02'),T('t4','pA','f2','2026-06-06')];

const iA=ctx.impegnoStimato('pA');
t('la persona compare nella stima',!!iA.u1,Object.keys(iA));
/* lunedì intero + martedì diviso a metà = 1,5 giorni. Sabato escluso. */
t('giorni contati con il sabato escluso e la giornata divisa',iA.u1.giorni===1.5,iA.u1.giorni);
t('ore coerenti con 8 ore al giorno',iA.u1.ore===12,iA.u1.ore);
t('costo = ore per tariffa',iA.u1.costo===600,iA.u1.costo);

const iB=ctx.impegnoStimato('pB');
t('l altra commessa prende la mezza giornata',iB.u1.giorni===0.5,iB.u1.giorni);
t('la stessa giornata non è contata due volte per intero',
  r2b(iA.u1.giorni+iB.u1.giorni)===2, iA.u1.giorni+iB.u1.giorni);

t('il dettaglio per fase c è',!!iA.u1.perFase.f1,Object.keys(iA.u1.perFase));
t('la fase del sabato non compare',!iA.u1.perFase.f2,Object.keys(iA.u1.perFase));

console.log('\n— IL COSTO COMPARE ANCHE SENZA ORE REGISTRATE —');
const stimA=ctx.costoCommessa('pA');
t('la commessa non risulta più a costo zero',stimA.lordo===600,stimA.lordo);
t('è dichiarato come stima',stimA.haStime===true,stimA.haStime);
t('la persona è marcata stimata',stimA.perPersona.u1.stimato===true,null);
t('il margine tiene conto del costo stimato',stimA.margine===19400,stimA.margine);
t('il periodo di lavoro non è più vuoto',stimA.prima==='2026-06-01'&&stimA.ultima==='2026-06-06',
  [stimA.prima,stimA.ultima]);

/* Le ore registrate restano il dato buono e non si sommano alla stima */
ctx.S.time=[{project_id:'pA',operator_id:'u1',entry_date:'2026-06-01',hours:3}];
const veroA=ctx.costoCommessa('pA');
t('le ore registrate vincono sulla stima',veroA.ore===3&&veroA.lordo===150,[veroA.ore,veroA.lordo]);
t('e non vengono marcate come stimate',veroA.perPersona.u1.stimato===false,null);
ctx.S.time=[];

console.log(fail?'\n'+fail+' TEST FALLITI':'\nTUTTI I TEST PASSATI');
process.exit(fail?1:0);
