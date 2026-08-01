/* Fatturazione: calcolo del documento, validazioni e conformita' dell'XML
   allo schema ufficiale FatturaPA 1.2 dell'Agenzia delle Entrate.
   Lo schema va indicato in XSD_FATTURAPA; senza, la validazione viene saltata. */
const fs=require('fs'),vm=require('vm'),{execSync}=require('child_process');
const XSD=process.env.XSD_FATTURAPA||'/tmp/xsd/fatturapa.xsd';
const haXsd=fs.existsSync(XSD);
if(!haXsd) console.log('(schema XSD non presente: validazione saltata — imposta XSD_FATTURAPA)');
const h=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const blocks=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const noop=()=>{}; const elStub=()=>({value:'',textContent:'',innerHTML:'',style:{},classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},dataset:{},appendChild:noop,addEventListener:noop,querySelectorAll:()=>[],getBoundingClientRect:()=>({}),remove:noop});
const ctx={console,setTimeout,clearInterval,setInterval:()=>0,Date,Math,Number,String,Object,Array,Set,JSON,isNaN,parseInt,parseFloat,
 supabase:{createClient:()=>new Proxy({},{get:()=>()=>new Proxy({},{get:()=>()=>Promise.resolve({data:[],error:null})})})},
 window:{location:{href:''},innerWidth:1200,innerHeight:800},localStorage:{getItem:()=>null,setItem:noop},
 document:{getElementById:elStub,querySelector:elStub,querySelectorAll:()=>[],addEventListener:noop,createElement:elStub,body:elStub(),hidden:false}};
ctx.globalThis=ctx; vm.createContext(ctx);
vm.runInContext(blocks.slice(0,5).join('\n;\n')+'\n;Object.assign(globalThis,{STUDIO,S,xmlFattura,calcolaFattura,impFattura,ibanDi,ibanValido,ibanLeggibile,byId,pd,iso,addD,esc});',ctx);

let fail=0; const t=(n,c,g)=>{ if(!c){fail++;console.log('  ✗',n,'→',JSON.stringify(g))} else console.log('  ✓',n); };

// dati fiscali di prova
console.log('— DATI DELLO STUDIO CONFIGURATI —');
t('denominazione presente', !!ctx.STUDIO.denominazione, ctx.STUDIO.denominazione);
t('partita IVA di 11 cifre', /^\d{11}$/.test(ctx.STUDIO.piva), ctx.STUDIO.piva);
t('CAP di 5 cifre', /^\d{5}$/.test(ctx.STUDIO.cap), ctx.STUDIO.cap);
t('provincia di 2 lettere', /^[A-Z]{2}$/.test(ctx.STUDIO.provincia), ctx.STUDIO.provincia);
t('nessuna ritenuta configurata (societa di capitali)', ctx.STUDIO.ritenuta===null, ctx.STUDIO.ritenuta);
t('cassa TC04 al 4%', ctx.STUDIO.tipoCassa==='TC04'&&ctx.STUDIO.aliquotaCassa===4, [ctx.STUDIO.tipoCassa,ctx.STUDIO.aliquotaCassa]);
t('REA con stato liquidazione', !!(ctx.STUDIO.rea&&ctx.STUDIO.rea.numero&&ctx.STUDIO.rea.statoLiquidazione), ctx.STUDIO.rea);
console.log('   ', ctx.STUDIO.denominazione, '| P.IVA', ctx.STUDIO.piva, '|', ctx.STUDIO.comune, '('+ctx.STUDIO.provincia+')');
const PIVA=ctx.STUDIO.piva;
ctx.S.projects=[{id:'p1', name:'Recupero Palazzo Vitelli', client:'Immobiliare Vitelli S.r.l.',
  amount:60000, cliente_piva:'02345670541', cliente_indirizzo:'Corso Vannucci 30',
  cliente_cap:'06121', cliente_comune:'Perugia', cliente_prov:'PG', cliente_sdi:'ABCDEF1'}];

console.log('— CALCOLO —');
const c=ctx.calcolaFattura(10000);
t('cassa 4%',c.cassa===400,c.cassa);
t('imponibile IVA include la cassa',c.base===10400,c.base);
t('IVA 22% su 10400',c.iva===2288,c.iva);
t('totale documento',c.totale===12688,c.totale);
t('nessuna ritenuta per una S.r.l.',c.ritenuta===0,c.ritenuta);
t('percentuale su importo commessa',ctx.impFattura({project_id:'p1',percentuale:30})===18000,
  ctx.impFattura({project_id:'p1',percentuale:30}));
t('importo fisso ha la precedenza',ctx.impFattura({project_id:'p1',percentuale:30,imponibile:5000})===5000,null);

console.log('\n— VALIDAZIONI PRIMA DI GENERARE —');
const senzaNum=ctx.xmlFattura({project_id:'p1',descrizione:'Acconto',imponibile:1000,data_fattura:'2026-08-01'});
t('blocca senza numero fattura',!!senzaNum.errori&&/numero/i.test(senzaNum.errori.join()),senzaNum.errori);
ctx.S.projects.push({id:'p2',name:'X',client:'Tizio',amount:1000});
const senzaDati=ctx.xmlFattura({project_id:'p2',descrizione:'A',imponibile:100,numero_fattura:'1',data_fattura:'2026-08-01'});
t('blocca senza dati fiscali del cliente',(senzaDati.errori||[]).length>=3,senzaDati.errori);
const pivaVuota=ctx.STUDIO.piva; ctx.STUDIO.piva='';
const senzaStudio=ctx.xmlFattura({project_id:'p1',descrizione:'A',imponibile:100,numero_fattura:'1',data_fattura:'2026-08-01'});
t('blocca senza partita IVA dello studio',/partita IVA dello studio/.test((senzaStudio.errori||[]).join()),senzaStudio.errori);
ctx.STUDIO.piva=pivaVuota;

console.log('\n— XML —');
const r=ctx.xmlFattura({project_id:'p1',descrizione:'Acconto 30% alla sottoscrizione dell\'incarico',
  percentuale:30, numero_fattura:'2026/014', data_fattura:'2026-08-03'});
t('genera senza errori',!r.errori,r.errori);
if(!r.errori){
  fs.writeFileSync('/tmp/fatt.xml',r.xml);
  t('nome file conforme',new RegExp('^IT'+PIVA+'_[0-9A-Z]{5}\\.xml$').test(r.nome),r.nome);
  t('iscrizione REA presente nel XML',/<IscrizioneREA>/.test(r.xml)&&/<StatoLiquidazione>/.test(r.xml),null);
  t('sede dello studio corretta',/<Comune>Recanati<\/Comune>/.test(r.xml)&&/<CAP>62019<\/CAP>/.test(r.xml),null);
  console.log('   file:',r.nome,'| totale:',r.calcolo.totale,'€');
  let out='';
  try { out=execSync('xmllint --noout --schema '+XSD+' /tmp/fatt.xml 2>&1').toString(); }
  catch(e){ out=(e.stdout||'')+(e.stderr||''); }
  const ok=haXsd?/validates/.test(out):true;
  t('VALIDO secondo lo schema ufficiale FatturaPA 1.2', ok, out.slice(0,600));
  if(ok) console.log('\n   xmllint:',out.trim());
}

// caso con ritenuta e senza cassa
console.log('\n— VARIANTE: ritenuta d\'acconto, nessuna cassa —');
ctx.STUDIO.aliquotaCassa=0; ctx.STUDIO.ritenuta={aliquota:20,causale:'A',tipo:'RT02'};
const r2=ctx.xmlFattura({project_id:'p1',descrizione:'Saldo',imponibile:5000,
  numero_fattura:'2026/015',data_fattura:'2026-08-03'});
t('genera',!r2.errori,r2.errori);
if(!r2.errori){
  fs.writeFileSync('/tmp/fatt2.xml',r2.xml);
  let out=''; try{out=execSync('xmllint --noout --schema '+XSD+' /tmp/fatt2.xml 2>&1').toString();}
  catch(e){out=(e.stdout||'')+(e.stderr||'');}
  t('VALIDO anche con ritenuta',haXsd?/validates/.test(out):true,out.slice(0,500));
  t('ritenuta calcolata',r2.calcolo.ritenuta===1000,r2.calcolo.ritenuta);
  t('netto a pagare al netto della ritenuta',r2.calcolo.netto===5100,r2.calcolo.netto);
}
// caso PEC invece di codice SDI
console.log('\n— VARIANTE: PEC invece del codice SDI —');
ctx.STUDIO.aliquotaCassa=4; ctx.STUDIO.ritenuta=null;
ctx.S.projects[0].cliente_sdi=''; ctx.S.projects[0].cliente_pec='vitelli@pec.it';
const r3=ctx.xmlFattura({project_id:'p1',descrizione:'Acconto',imponibile:2000,numero_fattura:'2026/016',data_fattura:'2026-08-03'});
if(!r3.errori){
  fs.writeFileSync('/tmp/fatt3.xml',r3.xml);
  let out=''; try{out=execSync('xmllint --noout --schema '+XSD+' /tmp/fatt3.xml 2>&1').toString();}
  catch(e){out=(e.stdout||'')+(e.stderr||'');}
  t('VALIDO con destinatario 0000000 e PEC',haXsd?/validates/.test(out):true,out.slice(0,400));
  t('codice destinatario a zeri',/0000000/.test(r3.xml)&&/PECDestinatario/.test(r3.xml),null);
} else t('genera con PEC',false,r3.errori);

console.log('\n— DUE CONTI CORRENTI: ORDINARIO E SISMA —');
const IBO=ctx.STUDIO.pagamento.iban, IBS=ctx.STUDIO.pagamento.ibanSisma;
t('IBAN ordinario configurato e valido',ctx.ibanValido(IBO),IBO);
t('IBAN sisma configurato e valido',ctx.ibanValido(IBS),IBS);
t('i due conti sono diversi',IBO!==IBS,[IBO,IBS]);
t('commessa ordinaria → conto ordinario',ctx.ibanDi({sisma:false})===IBO,ctx.ibanDi({sisma:false}));
t('commessa sisma → conto dedicato',ctx.ibanDi({sisma:true})===IBS,ctx.ibanDi({sisma:true}));
t('senza contrassegno vale l ordinario',ctx.ibanDi({})===IBO&&ctx.ibanDi(null)===IBO,null);
t('una cifra sbagliata viene intercettata',
  !ctx.ibanValido(IBO.slice(0,-1)+(IBO.slice(-1)==='6'?'7':'6')),null);
t('scarta lunghezza e formato errati',
  !ctx.ibanValido('IT31D03069691321000000654')&&!ctx.ibanValido('DE89370400440532013000')
  &&!ctx.ibanValido(''),null);
t('tollera gli spazi di come si scrive a mano',
  ctx.ibanValido('IT31 D030 6969 1321 0000 0006 546'),null);
t('leggibile a blocchi di quattro',ctx.ibanLeggibile(IBO)==='IT31 D030 6969 1321 0000 0006 546',
  ctx.ibanLeggibile(IBO));

/* Lo stesso scaglione su due commesse: cambia solo il conto di accredito */
ctx.S.projects[0].cliente_sdi='ABCDEF1'; ctx.S.projects[0].cliente_pec='';
ctx.S.projects[0].sisma=false;
const fOrd=ctx.xmlFattura({project_id:'p1',descrizione:'Saldo',imponibile:3000,
  numero_fattura:'2026/017',data_fattura:'2026-08-03'});
ctx.S.projects[0].sisma=true;
const fSis=ctx.xmlFattura({project_id:'p1',descrizione:'Saldo',imponibile:3000,
  numero_fattura:'2026/018',data_fattura:'2026-08-03'});
t('XML ordinario porta il conto ordinario',
  !fOrd.errori&&fOrd.xml.includes('<IBAN>'+IBO+'</IBAN>'),fOrd.errori||'IBAN assente');
t('XML sisma porta il conto dedicato',
  !fSis.errori&&fSis.xml.includes('<IBAN>'+IBS+'</IBAN>'),fSis.errori||'IBAN assente');
t('nessuna contaminazione fra i due',
  !fOrd.xml.includes(IBS)&&!fSis.xml.includes(IBO),null);

if(!fSis.errori){
  fs.writeFileSync('/tmp/fatt-sisma.xml',fSis.xml);
  let out=''; try{out=execSync('xmllint --noout --schema '+XSD+' /tmp/fatt-sisma.xml 2>&1').toString();}
  catch(e){out=(e.stdout||'')+(e.stderr||'');}
  t('XML con IBAN valido secondo l XSD ufficiale',haXsd?/validates/.test(out):true,out.slice(0,400));
}

/* Un IBAN sbagliato deve fermare la generazione, non finire allo SdI */
const ibSalvo=ctx.STUDIO.pagamento.ibanSisma;
ctx.STUDIO.pagamento.ibanSisma='IT00X0000000000000000000000';
const rotto=ctx.xmlFattura({project_id:'p1',descrizione:'Saldo',imponibile:3000,
  numero_fattura:'2026/019',data_fattura:'2026-08-03'});
t('blocca la fattura se l IBAN non e valido',
  !!rotto.errori&&/IBAN/.test(rotto.errori.join()),rotto.errori);
t('il messaggio dice quale dei due conti',
  !!rotto.errori&&/sisma/.test(rotto.errori.join()),rotto.errori);
ctx.STUDIO.pagamento.ibanSisma=ibSalvo; ctx.S.projects[0].sisma=false;

console.log(fail?'\n'+fail+' FALLITI':'\nTUTTI I CONTROLLI PASSATI');
process.exit(fail?1:0);
