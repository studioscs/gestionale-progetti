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
try{vm.runInContext(blocks.slice(0,4).join('\n;\n')+'\n;Object.assign(globalThis,{pd,iso,today,todayISO,addD,diffD,fdate,isLate,isSoon,dueLabel,esc,ini,pianifica,statoDerivato,scadenze,praticaLate,praticaOpen,progressOf,S,TEMPLATES,CONDIZIONI,PRATICHE_CAT});',ctx)}catch(e){console.log('LOAD ERR',e.message)}

let fail=0;
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
t('5 template',tk.length===5,tk);
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
t('privato completo: 13 fasi',p1.fasi.length===13,p1.fasi.length);
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
t('con paesaggistico: istanza presente',
  p1.fasi.some(f=>f.att.some(a=>/^Istanza di autorizzazione paesaggistica/.test(a.title))),null);
t('verifica vincoli sempre presente (base)',
  p2.fasi.some(f=>f.att.some(a=>/^Verifica dei vincoli/.test(a.title))),null);
t('senza sismica_aut: no art.94, si art.93',
  !p2.fasi.some(f=>f.att.some(a=>/94 DPR/.test(a.rif_normativo||''))) &&
   p2.fasi.some(f=>f.att.some(a=>/93 DPR/.test(a.rif_normativo||''))),null);
t('milestone scadono a fine fase',
  p1.fasi.every(f=>f.att.filter(a=>a.is_milestone).every(a=>a.due_date===f.data_fine_prevista)),null);
t('senza vvf: nessuna pratica VVF',!p2.pratiche.some(x=>/Vigili/.test(x.ente)),null);
const p3=ctx.pianifica('vuoto',[],null);
t('template vuoto: 1 fase 0 attività',p3.fasi.length===1&&p3.fasi[0].att.length===0,p3.fasi.length);
const p4=ctx.pianifica('pubblico',full,'2026-02-02');
t('pubblico: 9 fasi',p4.fasi.length===9,p4.fasi.length);
const p5=ctx.pianifica('strutture',full,null);
t('strutture: 7 fasi',p5.fasi.length===7,p5.fasi.length);
const p6=ctx.pianifica('vincolo',full,null);
t('vincolo: 5 fasi',p6.fasi.length===5,p6.fasi.length);

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

console.log(fail?'\n'+fail+' TEST FALLITI':'\nTUTTI I TEST PASSATI');
process.exit(fail?1:0);
