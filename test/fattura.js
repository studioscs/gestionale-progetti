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
vm.runInContext(blocks.slice(0,5).join('\n;\n')+'\n;Object.assign(globalThis,{STUDIO,S,xmlFattura,xmlDaDati,datiFattura,calcolaDa,validaFattura,calcolaFattura,impFattura,ibanDi,ibanValido,ibanLeggibile,latin,ascii,causaleSpezzata,spezza,anteprimaCausale,righeFattura,totRighe,byId,pd,iso,addD,esc,feuro,r2});',ctx);

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


console.log('\n— TESTO AMMESSO DALLO SCHEMA —');
t('virgolette curve convertite',ctx.latin('l’incarico “esecutivo”')==="l'incarico \"esecutivo\"",
  ctx.latin('l’incarico “esecutivo”'));
t('trattino lungo e puntini',ctx.latin('A — B…')==='A - B...',ctx.latin('A — B…'));
t('accenti conservati',ctx.latin('città perché più')==='città perché più',ctx.latin('città perché più'));
t('a capo del copia-incolla appiattiti',ctx.latin('riga uno\nriga due\t fine')==='riga uno riga due fine',
  ctx.latin('riga uno\nriga due\t fine'));
t('caratteri fuori Latin-1 rimossi',ctx.latin('ok 中文 fine')==='ok fine',ctx.latin('ok 中文 fine'));
t('spazio non separabile normalizzato',ctx.latin('a b')==='a b',JSON.stringify(ctx.latin('a b')));
t('ascii toglie gli accenti dai codici',ctx.ascii('Z1à2')==='Z12',ctx.ascii('Z1à2'));
t('causale lunga spezzata in piu pezzi',(()=>{const l=ctx.causaleSpezzata('parola '.repeat(80));
  return l.length>1&&l.every(x=>x.length<=200);})(),ctx.causaleSpezzata('parola '.repeat(80)).map(x=>x.length));

console.log('\n— FATTURA ALLA PUBBLICA AMMINISTRAZIONE —');
ctx.S.projects.push({id:'pa1', name:'Consolidamento scuola primaria', client:'Comune di Recanati',
  amount:80000, cliente_cf:'00201180434', cliente_piva:'00201180434',
  cliente_indirizzo:'Piazza Giacomo Leopardi 26', cliente_cap:'62019',
  cliente_comune:'Recanati', cliente_prov:'MC',
  ente_pubblico:true, codice_ufficio:'UFY9MB', split_payment:true,
  cig:'ZAB12CD345', cup:'J51B22000350001',
  rif_incarico:'DET-2026-118', rif_incarico_data:'2026-03-04', rif_incarico_tipo:'ordine',
  oggetto_servizio:'Progettazione esecutiva e coordinamento della sicurezza in fase di progettazione per il consolidamento sismico della scuola primaria “B. Gigli” — CUP J51B22000350001'});

const dPA=ctx.datiFattura({project_id:'pa1',descrizione:'Acconto 30%',imponibile:24000,
  numero_fattura:'2026/020',data_fattura:'2026-08-03'});
t('riconosce la commessa pubblica',dPA.pa===true,dPA.pa);
t('destinatario = codice univoco ufficio',dPA.destinatario==='UFY9MB',dPA.destinatario);
t('CIG e CUP separati',dPA.cig==='ZAB12CD345'&&dPA.cup==='J51B22000350001',[dPA.cig,dPA.cup]);
t('oggetto preso dall incarico',/scuola primaria/.test(dPA.oggetto),dPA.oggetto);
t('split payment attivo',dPA.split===true,dPA.split);

const cPA=ctx.calcolaDa(dPA);
t('imponibile',cPA.imponibile===24000,cPA.imponibile);
t('cassa 4%',cPA.cassa===960,cPA.cassa);
t('base imponibile IVA',cPA.base===24960,cPA.base);
t('IVA 22%',cPA.iva===5491.2,cPA.iva);
t('totale documento espone l IVA',cPA.totale===30451.2,cPA.totale);
t('in split payment l ente paga senza IVA',cPA.netto===24960,cPA.netto);

const rPA=ctx.xmlDaDati(dPA);
t('genera senza errori',!rPA.errori,rPA.errori);
if(!rPA.errori){
  t('formato FPA12',/<FormatoTrasmissione>FPA12<\/FormatoTrasmissione>/.test(rPA.xml),null);
  t('versione FPA12 sull elemento radice',/versione="FPA12"/.test(rPA.xml),null);
  t('codice destinatario a 6 caratteri',/<CodiceDestinatario>UFY9MB<\/CodiceDestinatario>/.test(rPA.xml),null);
  t('CIG nel documento correlato',/<CodiceCIG>ZAB12CD345<\/CodiceCIG>/.test(rPA.xml),null);
  t('CUP nel documento correlato',/<CodiceCUP>J51B22000350001<\/CodiceCUP>/.test(rPA.xml),null);
  t('riferimento all atto di affidamento',/<IdDocumento>DET-2026-118<\/IdDocumento>/.test(rPA.xml),null);
  t('esigibilita IVA in scissione',/<EsigibilitaIVA>S<\/EsigibilitaIVA>/.test(rPA.xml),null);
  t('importo pagamento al netto dell IVA',/<ImportoPagamento>24960\.00<\/ImportoPagamento>/.test(rPA.xml),null);
  /* La causale non si riempie piu' da sola: l'oggetto sta nella descrizione
     della riga, dove il committente lo legge, e le note restano vuote finche'
     qualcuno non ci scrive dentro. */
  t('l oggetto sta nella riga, non nelle note',
    /<Descrizione>[^<]*scuola primaria/.test(rPA.xml)&&!/<Causale>/.test(rPA.xml),
    (rPA.xml.match(/<Causale>[^<]*<\/Causale>/g)||[]).join(' | '));
  t('virgolette curve ripulite nell XML',!/[‘’“”—]/.test(rPA.xml),null);
  fs.writeFileSync('/tmp/fatt-pa.xml',rPA.xml);
  let out=''; try{out=execSync('xmllint --noout --schema '+XSD+' /tmp/fatt-pa.xml 2>&1').toString();}
  catch(e){out=(e.stdout||'')+(e.stderr||'');}
  t('VALIDO secondo l XSD ufficiale',haXsd?/validates/.test(out):true,out.slice(0,600));
}

console.log('\n— CONTROLLI SPECIFICI DELLA PA —');
const senza=(patch)=>ctx.validaFattura(Object.assign({},dPA,patch)).join(' | ');
t('blocca senza CIG',/CIG/.test(senza({cig:''})),senza({cig:''}));
t('blocca CIG di lunghezza sbagliata',/10 caratteri/.test(senza({cig:'ABC'})),senza({cig:'ABC'}));
t('blocca CUP di lunghezza sbagliata',/15 caratteri/.test(senza({cup:'XYZ'})),senza({cup:'XYZ'}));
t('blocca senza atto di affidamento',/atto di affidamento/.test(senza({rifDoc:''})),senza({rifDoc:''}));
t('blocca riferimento troppo lungo',/20 caratteri/.test(senza({rifDoc:'DETERMINAZIONE DIRIGENZIALE 118/2026'})),null);
t('blocca codice ufficio a 7 caratteri',/6 caratteri/.test(senza({destinatario:'ABCDEFG'})),senza({destinatario:'ABCDEFG'}));
t('blocca senza oggetto del servizio',/oggetto del servizio/.test(senza({oggetto:''})),senza({oggetto:''}));
t('una commessa privata non pretende il CIG',
  ctx.validaFattura(Object.assign({},dPA,{pa:false,destinatario:'ABCDEF1',cig:'',rifDoc:'',oggetto:'x'})).length===0,
  ctx.validaFattura(Object.assign({},dPA,{pa:false,destinatario:'ABCDEF1',cig:'',rifDoc:'',oggetto:'x'})));

console.log('\n— MODIFICHE FATTE IN REVISIONE —');
const mod=Object.assign({},dPA,{imponibile:10000,aliquotaIva:10,split:false,
  numero:'2026/021',oggetto:'Perizia di variante'});
const cMod=ctx.calcolaDa(mod);
t('i totali seguono le modifiche',cMod.imponibile===10000&&cMod.cassa===400&&cMod.iva===1040,
  [cMod.imponibile,cMod.cassa,cMod.iva]);
t('togliendo lo split l importo torna comprensivo di IVA',cMod.netto===11440,cMod.netto);
const rMod=ctx.xmlDaDati(mod);
t('l XML rispecchia le modifiche',!rMod.errori
  &&/<Numero>2026\/021<\/Numero>/.test(rMod.xml)
  &&/<EsigibilitaIVA>I<\/EsigibilitaIVA>/.test(rMod.xml)
  &&/Perizia di variante/.test(rMod.xml),rMod.errori);
if(!rMod.errori){
  fs.writeFileSync('/tmp/fatt-mod.xml',rMod.xml);
  let out=''; try{out=execSync('xmllint --noout --schema '+XSD+' /tmp/fatt-mod.xml 2>&1').toString();}
  catch(e){out=(e.stdout||'')+(e.stderr||'');}
  t('anche la fattura modificata e VALIDA',haXsd?/validates/.test(out):true,out.slice(0,600));
}


console.log('\n— PIÙ SERVIZI NELLA STESSA FATTURA —');
ctx.S.projects=[{id:'pR',name:'Recupero Palazzo Vitelli',codice:'2026_07',
  client:'Immobiliare Vitelli S.r.l.',amount:60000,cliente_piva:'02345670541',
  cliente_indirizzo:'Corso Vannucci 30',cliente_cap:'06121',cliente_comune:'Perugia',
  cliente_prov:'PG',cliente_sdi:'ABCDEF1'}];
/* imponibile volutamente vecchio: e' il caso reale del momento in cui si
   modificano le righe e il trigger del database non ha ancora scritto la
   somma. Le righe devono vincere comunque, subito. */
const FR={id:'fR',project_id:'pR',descrizione:'Primo acconto',imponibile:999,stato:'pronta',note:null};
ctx.S.fatture=[FR];
ctx.S.fattRighe=[
 {id:'r3',fattura_id:'fR',ordine:2,descrizione:'Deposito sismico',importo:1299.50},
 {id:'r1',fattura_id:'fR',ordine:0,descrizione:'Rilievo e restituzione grafica',importo:1500},
 {id:'r2',fattura_id:'fR',ordine:1,descrizione:'Pratica edilizia (SCIA)',importo:2200.50}];

t('le righe escono nell ordine indicato, non in quello di arrivo',
  ctx.righeFattura('fR').map(r=>r.ordine).join()==='0,1,2',ctx.righeFattura('fR').map(r=>r.ordine));
t('i servizi vincono sull imponibile vecchio dello scaglione',
  ctx.impFattura(FR)===5000,ctx.impFattura(FR));
t('senza righe vale l importo scritto a mano',
  ctx.impFattura({id:'ignota',project_id:'pR',imponibile:800})===800,null);
t('senza righe e senza importo vale la percentuale',
  ctx.impFattura({id:'ignota',project_id:'pR',percentuale:10})===6000,null);

const dR=ctx.datiFattura(FR); dR.numero='2026/030'; dR.data='2026-09-08'; dR.progressivo=7;
const rR=ctx.xmlDaDati(dR);
t('l XML si genera',!rR.errori,rR.errori);
if(!rR.errori){
  const linee=rR.xml.match(/<DettaglioLinee>[\s\S]*?<\/DettaglioLinee>/g)||[];
  /* una premessa senza importo piu' i tre servizi */
  t('una riga di fattura per ogni servizio',linee.length===3,linee.length);
  t('le righe sono numerate da 1 in su',
    linee.map((l,i)=>(l.match(/<NumeroLinea>(\d+)/)||[])[1]===String(i+1)).every(Boolean),
    linee.map(l=>(l.match(/<NumeroLinea>(\d+)/)||[])[1]));
  t('ogni riga porta la sua descrizione',
    /Rilievo e restituzione grafica/.test(rR.xml)&&/Pratica edilizia \(SCIA\)/.test(rR.xml)
    &&/Deposito sismico/.test(rR.xml),null);
  const somma=ctx.r2(linee.map(l=>Number((l.match(/<PrezzoTotale>([\d.]+)/)||[])[1])).reduce((a,b)=>a+b,0));
  t('le righe sommano esattamente l imponibile',somma===5000,somma);
  /* Lo SdI scarta il documento se il riepilogo non torna con le righe:
     ImponibileImporto = somma delle righe + contributo cassa. */
  const riep=Number((rR.xml.match(/<ImponibileImporto>([\d.]+)/)||[])[1]);
  t('il riepilogo IVA torna con le righe più la cassa',riep===ctx.r2(somma*1.04),[riep,somma]);
  fs.writeFileSync('/tmp/fatt-righe.xml',rR.xml);
  let out=''; try{out=execSync('xmllint --noout --schema '+XSD+' /tmp/fatt-righe.xml 2>&1').toString();}
  catch(e){out=(e.stdout||'')+(e.stderr||'');}
  t('la fattura a più righe e VALIDA',haXsd?/validates/.test(out):true,out.slice(0,600));
  let wf=''; try{execSync('xmllint --noout /tmp/fatt-righe.xml 2>&1');}catch(e){wf=(e.stdout||'')+(e.stderr||'');}
  t('ed e XML ben formato',wf==='',wf.slice(0,300));
}


console.log('\n— NELLE NOTE VA SOLO QUELLO CHE SCRIVE UNA PERSONA —');
/* Il gestionale si componeva le note da solo - oggetto dell'incarico piu'
   riferimento alla commessa - e in fattura compariva sempre una nota che
   nessuno aveva scritto e nessuno poteva togliere. Caso reale, commessa
   VIVIANA ZOPPI. */
const PRIMA={projects:ctx.S.projects,fatture:ctx.S.fatture,righe:ctx.S.fattRighe};
const OGG='Art. 1 OGGETTO DEL SERVIZIO DA REALIZZARE SU IMMOBILE SITO IN VIA LA FONTE 22 '
  +'A SIROLO (AN)';
ctx.S.projects=ctx.S.projects.concat([{id:'pZ',name:'VIVIANA ZOPPI',codice:'2026_33',
  client:'Viviana Zoppi',amount:9000,cliente_cf:'ZPPVVN80A41E783Q',
  cliente_indirizzo:'Via La Fonte 22',cliente_cap:'60020',
  cliente_comune:'Sirolo',cliente_prov:'AN',cliente_sdi:'0000000'}]);
const FZ={id:'fZ',project_id:'pZ',descrizione:OGG,imponibile:3000,stato:'pronta',
  note:'promemoria interno',richiesta_note:'chiedi a giorgio'};
ctx.S.fatture=[FZ];
ctx.S.fattRighe=[
 {id:'z1',fattura_id:'fZ',ordine:0,descrizione:'A. Rilievo',importo:1000},
 {id:'z2',fattura_id:'fZ',ordine:1,descrizione:'B. Progetto',importo:2000}];
const dZ=ctx.datiFattura(FZ); dZ.numero='2026/050'; dZ.data='2026-09-09'; dZ.progressivo=60;
const rZ=ctx.xmlDaDati(dZ);
t('l XML si genera',!rZ.errori,rZ.errori);
const cauZ=(rZ.errori?[]:rZ.xml.match(/<Causale>[^<]*<\/Causale>/g))||[];

t('senza note scritte, il documento non ha note',cauZ.length===0,cauZ);
t('l oggetto dell incarico NON ci finisce piu da solo',
  !/Art\. 1 OGGETTO DEL SERVIZIO/.test(rZ.xml),'oggetto trovato nel documento');
t('e nemmeno il riferimento alla commessa',
  !/VIVIANA ZOPPI|2026_33/.test(rZ.xml),'riferimento alla commessa trovato');
t('le note interne restano fuori',!/promemoria interno/.test(rZ.xml),null);
t('la nota all amministrazione pure',!/chiedi a giorgio/.test(rZ.xml),null);
t('i servizi restano quelli, con i loro importi',
  (rZ.xml.match(/<DettaglioLinee>/g)||[]).length===2
  &&/A\. Rilievo/.test(rZ.xml)&&/B\. Progetto/.test(rZ.xml),null);

/* Quello che si scrive nella casella, invece, ci finisce - e solo quello */
const FN2=Object.assign({},FZ,{note_fattura:'Pagamento a 60 giorni come da disciplinare'});
ctx.S.fatture=[FN2];
const dN2=ctx.datiFattura(FN2); dN2.numero='2026/051'; dN2.data='2026-09-09'; dN2.progressivo=61;
const rN2=ctx.xmlDaDati(dN2);
const cauN2=(rN2.errori?[]:rN2.xml.match(/<Causale>([^<]*)<\/Causale>/g))||[];
t('la casella "Note in fattura" arriva al documento',
  cauN2.some(c=>/Pagamento a 60 giorni/.test(c)),cauN2);
t('e ci arriva SOLO quella',
  cauN2.join(' ').replace(/<\/?Causale>/g,'').trim()==='Pagamento a 60 giorni come da disciplinare',
  cauN2);
t('l anteprima in revisione dice la stessa cosa del file',
  ctx.anteprimaCausale(dN2)==='Pagamento a 60 giorni come da disciplinare',ctx.anteprimaCausale(dN2));
if(!rN2.errori){
  fs.writeFileSync('/tmp/fatt-note.xml',rN2.xml);
  let out=''; try{out=execSync('xmllint --noout --schema '+XSD+' /tmp/fatt-note.xml 2>&1').toString();}
  catch(e){out=(e.stdout||'')+(e.stderr||'');}
  t('la fattura con le note e VALIDA',haXsd?/validates/.test(out):true,out.slice(0,600));
  let wf=''; try{execSync('xmllint --noout /tmp/fatt-note.xml 2>&1');}catch(e){wf=(e.stdout||'')+(e.stderr||'');}
  t('ed e XML ben formato',wf==='',wf.slice(0,300));
}

/* Una nota lunga continua sull elemento successivo, non viene tagliata */
const LUNGA=Array(40).fill('clausola contrattuale di dettaglio numero uno').join(', ');
const pezzi=ctx.causaleSpezzata(LUNGA,20);
t('una nota lunga viene spezzata, non tagliata',
  pezzi.length>1&&pezzi.every(x=>x.length<=200),pezzi.map(x=>x.length));
t('rimettendo insieme i pezzi si rilegge tutto il testo',
  pezzi.join(' ')===ctx.latin(LUNGA),pezzi.join(' ').length+' vs '+ctx.latin(LUNGA).length);
ctx.S.projects=PRIMA.projects; ctx.S.fatture=PRIMA.fatture; ctx.S.fattRighe=PRIMA.righe;

console.log('\n— IN FATTURA NON ESCE NIENTE DI SCRITTO PER USO INTERNO —');
/* Il difetto di partenza era la RIPETIZIONE: con una riga sola, la causale
   riportava la stessa identica frase gia' scritta in <Descrizione>, e la si
   leggeva due volte nello stesso documento. Oggi non puo' piu' succedere in
   nessun caso: le note le scrive una persona, e finche' non lo fa non c'e'
   proprio nessun elemento <Causale> nel file. */
const cau=(rR.errori?[]:rR.xml.match(/<Causale>([^<]*)<\/Causale>/g))||[];
t('senza note scritte a mano non c e nessuna causale',cau.length===0,cau);
t('e la descrizione della riga non compare da nessun altra parte',
  !rR.errori&&(rR.xml.match(/Rilievo e restituzione grafica/g)||[]).length===1,
  (rR.errori?[]:rR.xml.match(/Rilievo e restituzione grafica/g)||[]).length);

/* NIENTE DI QUELLO CHE SI SCRIVE FRA COLLEGHI ESCE IN FATTURA.
   Il caso e' vero: sulla commessa Rinaldelli la nota per l'amministrazione
   ("chiedi a giorgio le spese catastali") e' arrivata dentro il documento. Le
   note dello scaglione e la nota della richiesta di fatturazione servono a
   parlarsi in studio, e in fattura non ci devono andare per conto loro. */
const FN=Object.assign({},FR,{id:'fN',
  note:'ricordarsi il bollo',
  richiesta_note:'chiedi a giorgio le spese catastali'});
ctx.S.fatture=[FN]; ctx.S.fattRighe=ctx.S.fattRighe.map(r=>Object.assign({},r,{fattura_id:'fN'}));
const dN=ctx.datiFattura(FN); dN.numero='2026/031'; dN.data='2026-09-08'; dN.progressivo=8;
const rN=ctx.xmlDaDati(dN);
t('la nota per l amministrazione NON esce in fattura',
  !rN.errori&&!/spese catastali/.test(rN.xml),rN.errori||'trovata nel documento');
t('nemmeno le note interne dello scaglione',
  !rN.errori&&!/ricordarsi il bollo/.test(rN.xml),rN.errori||'trovate nel documento');
t('la causale nasce vuota',ctx.datiFattura(FN).causale==='',ctx.datiFattura(FN).causale);
t('e la descrizione della riga resta fuori dalla causale',
  !rN.errori&&(rN.xml.match(/<Causale>([^<]*)<\/Causale>/g)||[])
    .every(c=>!/Rilievo e restituzione/.test(c)),null);

/* Quello che il committente deve leggere lo si scrive apposta in revisione */
const dC=Object.assign({},dN,{causale:'Prestazioni rese come da disciplinare del 12/03/2026'});
const rC=ctx.xmlDaDati(dC);
t('la causale scritta in revisione ci finisce',
  !rC.errori&&/disciplinare del 12\/03\/2026/.test(rC.xml),rC.errori);
t('e ci finisce da sola, senza il riferimento alla commessa appiccicato',
  !rC.errori&&(rC.xml.match(/<Causale>([^<]*)<\/Causale>/g)||[])
    .every(c=>!/Recupero Palazzo Vitelli|2026_07/.test(c)),
  (rC.errori?[]:rC.xml.match(/<Causale>[^<]*<\/Causale>/g)||[]));
t('e continua a non tirarsi dietro le note interne',
  !rC.errori&&!/spese catastali|ricordarsi il bollo/.test(rC.xml),null);

console.log('\n— UNA FATTURA CHE NON QUADRA NON SI GENERA —');
const rotta=Object.assign({},dR,{righe:[{descrizione:'Voce A',importo:1000},
                                        {descrizione:'Voce B',importo:500}],imponibile:5000});
t('somma delle righe diversa dall imponibile: bloccata',
  ctx.validaFattura(rotta).some(x=>/sommano/.test(x)),ctx.validaFattura(rotta));
const vuota=Object.assign({},dR,{righe:[{descrizione:'',importo:5000}],imponibile:5000});
t('un servizio senza descrizione: bloccato',
  ctx.validaFattura(vuota).some(x=>/senza descrizione/.test(x)),ctx.validaFattura(vuota));
const zero=Object.assign({},dR,{righe:[{descrizione:'Voce',importo:0}],imponibile:0});
t('servizi che sommano zero: bloccati',
  ctx.validaFattura(zero).some(x=>/zero/.test(x)),ctx.validaFattura(zero));
ctx.S.fattRighe=[]; ctx.S.fatture=[];

console.log(fail?'\n'+fail+' FALLITI':'\nTUTTI I CONTROLLI PASSATI');
process.exit(fail?1:0);
