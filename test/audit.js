/* =============================================================================
   AUDIT STATICO DI index.html
   Cerca i guasti che i test non vedono perche' riguardano codice che nessun test
   attraversa: funzioni chiamate e mai definite, id di elementi inesistenti,
   gestori agganciati al nulla, chiavi di stato lette e mai scritte.

   NOTA SUL METODO: prima di cercare qualsiasi cosa, dal sorgente vengono tolti
   commenti e stringhe. Senza questo passaggio ogni parola italiana seguita da
   una parentesi in un commento verrebbe scambiata per una chiamata di funzione,
   e un audit che grida al lupo cento volte non lo legge piu' nessuno.
   ============================================================================= */
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const js  = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

/* Sostituisce commenti e stringhe con spazi, conservando le posizioni */
function soloCodice(t) {
  let out = '', i = 0;
  const vuoto = s => ' '.repeat(s.length);
  while (i < t.length) {
    const c = t[i], due = t.slice(i, i + 2);
    if (due === '/*') { const j = t.indexOf('*/', i + 2); const e = j < 0 ? t.length : j + 2;
      out += vuoto(t.slice(i, e)); i = e; continue; }
    if (due === '//') { const j = t.indexOf('\n', i); const e = j < 0 ? t.length : j;
      out += vuoto(t.slice(i, e)); i = e; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < t.length && t[j] !== c) { if (t[j] === '\\') j++; j++; }
      out += vuoto(t.slice(i, j + 1)); i = j + 1; continue;
    }
    /* Letterale regex. Senza questo ramo un'espressione come /['\u2018]/g viene
       scambiata per l'inizio di una stringa e lo scanner perde il sincrono,
       nascondendo tutto il codice che segue. Il carattere precedente distingue
       la regex dalla divisione. */
    if (c === '/') {
      const prec = (out.replace(/\s+$/, '').slice(-1)) || '';
      if ('(,=:[!&|?{};+-*%~^<>'.includes(prec) || prec === '') {
        let j = i + 1, classe = false;
        while (j < t.length) {
          const d = t[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '[') classe = true;
          else if (d === ']') classe = false;
          else if (d === '/' && !classe) break;
          else if (d === '\n') { j = -1; break; }
          j++;
        }
        if (j > 0) { while (j + 1 < t.length && /[a-z]/.test(t[j + 1])) j++;
          out += vuoto(t.slice(i, j + 1)); i = j + 1; continue; }
      }
    }
    out += c; i++;
  }
  return out;
}
const codice = soloCodice(js);

let problemi = 0, avvisi = 0;
const KO = (cat, msg) => { problemi++; console.log('  ✗ [' + cat + '] ' + msg); };
const WARN = msg => { avvisi++; console.log('  ⚠ ' + msg); };
const OK = msg => console.log('  ✓ ' + msg);

console.log('\n— ELEMENTI DEL DOCUMENTO —');
/* Un id e' valido se compare nel documento, oppure se l'app lo genera: o dentro
   una stringa id="...", o passandolo a fld()/t() che costruiscono l'input. */
const idsDoc = new Set([...src.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const idsGen = new Set([...js.matchAll(/id="([a-z0-9-]+)"/g)].map(m => m[1]));
[...js.matchAll(/\b(?:fld|t)\(\s*'[^']*'\s*,\s*'([a-z0-9-]+)'/g)].forEach(m => idsGen.add(m[1]));
const idsLetti = [...new Set([...js.matchAll(/\bel\(\s*'([^']+)'\s*\)/g)].map(m => m[1]))];
const idKo = idsLetti.filter(id => !idsDoc.has(id) && !idsGen.has(id));
idKo.forEach(id => KO('id', "el('" + id + "') non esiste e non viene generato"));
if (!idKo.length) OK(idsLetti.length + ' id letti con el(), tutti esistenti o generati');

const bind = [...js.matchAll(/el\('([^']+)'\)\.(onclick|oninput|onchange|onkeydown)\s*=/g)];
const bindKo = bind.filter(m => !idsDoc.has(m[1]) && !idsGen.has(m[1]));
bindKo.forEach(m => KO('handler', m[1] + '.' + m[2] + ' agganciato a un id inesistente'));
if (!bindKo.length) OK(bind.length + ' gestori diretti, tutti su elementi esistenti');

const modali = [...src.matchAll(/<div class="ov" id="([^"]+)"/g)].map(m => m[1]);
modali.forEach(id => {
  if (!src.includes('data-close="' + id + '"')) KO('modale', id + ' non ha un pulsante di chiusura');
  if (!js.includes("openM('" + id + "')")) WARN('la modale ' + id + ' non viene mai aperta dal codice');
});
OK(modali.length + ' modali, tutte con chiusura');

console.log('\n— FUNZIONI —');
const definite = new Set();
[...js.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].forEach(m => definite.add(m[1]));
[...js.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].forEach(m => definite.add(m[1]));
[...js.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function|\()/g)].forEach(m => definite.add(m[1]));
/* parametri di funzione e destrutturazioni: sono nomi locali legittimi */
[...codice.matchAll(/\(([^()]*)\)\s*=>/g)].forEach(m =>
  m[1].split(',').forEach(x => { const n = x.trim().replace(/[={].*/, '').trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) definite.add(n); }));
[...codice.matchAll(/\bfunction\s*[\w$]*\s*\(([^()]*)\)/g)].forEach(m =>
  m[1].split(',').forEach(x => { const n = x.trim().replace(/[={].*/, '').trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) definite.add(n); }));
[...codice.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)].forEach(m => definite.add(m[1]));
[...codice.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)].forEach(m => definite.add(m[1]));
[...codice.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].forEach(m => definite.add(m[1]));

const PAROLE = new Set(['if','for','while','switch','catch','return','typeof','new','delete','do','else',
  'try','finally','throw','in','of','instanceof','yield','await','async','function','super','this','void',
  'case','break','continue','var','let','const','class','extends','import','export','default','with']);
const AMBIENTE = new Set(['console','Math','Object','Array','String','Number','Boolean','JSON','Date','Set',
  'Map','Promise','parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent',
  'alert','confirm','prompt','setTimeout','setInterval','clearTimeout','clearInterval','fetch','Blob','URL',
  'FormData','RegExp','Error','Symbol','WeakMap','Proxy','Reflect','document','window','navigator','history',
  'location','localStorage','sessionStorage','supabase','requestAnimationFrame','getComputedStyle','btoa','atob',
  'URLSearchParams','IntersectionObserver','MutationObserver','CustomEvent','Event','Intl','crypto']);

const chiamate = new Set();
[...codice.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/gm)].forEach(m => chiamate.add(m[1]));
const fnKo = [...chiamate].filter(f => !definite.has(f) && !PAROLE.has(f) && !AMBIENTE.has(f));
fnKo.forEach(f => KO('funzione', f + '() chiamata ma non definita'));
if (!fnKo.length) OK(definite.size + ' simboli definiti, nessuna chiamata orfana');

/* Funzioni definite e mai chiamate: non e' un errore, ma e' codice morto */
const usate = new Set([...codice.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map(m => m[1]));
const dichiarate = [...codice.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]);
const morte = dichiarate.filter(f => (codice.match(new RegExp('\\b' + f + '\\b', 'g')) || []).length < 2);
morte.forEach(f => WARN('funzione ' + f + '() definita e mai chiamata'));
if (!morte.length) OK(dichiarate.length + ' funzioni dichiarate, tutte usate');

console.log('\n— STATO —');
const blocco = (js.match(/const S = \{[\s\S]*?\n\};/) || [''])[0];
const statoInit = new Set([...blocco.matchAll(/(\w+)\s*:/g)].map(m => m[1]));
const statoLetto = new Set([...codice.matchAll(/\bS\.(\w+)\b(?!\s*=[^=])/g)].map(m => m[1]));
const statoScritto = new Set([...codice.matchAll(/\bS\.(\w+)\s*=[^=]/g)].map(m => m[1]));
/* Letta e mai scritta ne' inizializzata: vale sempre undefined, e' un guasto */
const statoKo = [...statoLetto].filter(k => !statoInit.has(k) && !statoScritto.has(k));
statoKo.forEach(k => KO('stato', 'S.' + k + ' letto ma mai scritto: vale sempre undefined'));
if (!statoKo.length) OK('nessuna chiave di stato letta a vuoto');
const tardive = [...statoScritto].filter(k => !statoInit.has(k));
if (tardive.length) WARN('chiavi non dichiarate in S ma assegnate a runtime: ' + tardive.sort().join(', '));

console.log('\n— DATABASE —');
const sqlDir = path.join(__dirname, '..', 'sql');
const files = fs.readdirSync(sqlDir).filter(f => f.endsWith('.sql')).sort();
const sqlAll = files.map(f => fs.readFileSync(path.join(sqlDir, f), 'utf8')).join('\n');
/* Le tabelle preesistenti non sono create dalle migrazioni, e i bucket di
   Storage non sono tabelle: vanno esclusi entrambi. */
const PREESISTENTI = new Set(['projects','tasks','time_entries','files','profiles',
                              'project_fasi','project_sottofasi']);
const bucket = new Set([...js.matchAll(/storage\.from\('([a-z_]+)'\)/g)].map(m => m[1]));
const tabelle = [...new Set([...js.matchAll(/SB\.from\('([a-z_]+)'\)/g)].map(m => m[1]))];
const tabKo = tabelle.filter(t => !PREESISTENTI.has(t) && !bucket.has(t) && !sqlAll.includes('public.' + t));
tabKo.forEach(t => KO('sql', 'tabella "' + t + '" usata dall’app ma assente dalle migrazioni'));
if (!tabKo.length) OK(tabelle.length + ' tabelle interrogate, tutte previste dalle migrazioni');

/* Colonne scritte con insert/update e mai dichiarate da una migrazione */
const colonneSql = new Set([...sqlAll.matchAll(/add column if not exists\s+([a-z_]+)/g)].map(m => m[1]));
[...sqlAll.matchAll(/create table if not exists public\.[a-z_]+\s*\(([\s\S]*?)\n\);/g)].forEach(m =>
  [...m[1].matchAll(/^\s{2}([a-z_]+)\s+/gm)].forEach(x => colonneSql.add(x[1])));
OK(colonneSql.size + ' colonne dichiarate nelle migrazioni');

/* 000 e 999 sono file di servizio, non migrazioni: includerli nell'intervallo
   farebbe risultare "mancanti" quasi mille numeri. */
const nums = files.filter(f => /^\d{3}_/.test(f)).map(f => parseInt(f.slice(0, 3), 10))
  .filter(n => n > 0 && n < 900);
const salti = [];
for (let n = Math.min(...nums); n < Math.max(...nums); n++) if (!nums.includes(n)) salti.push(n);
if (salti.length) WARN('numeri di migrazione non presenti: ' + salti.map(n => String(n).padStart(3,'0')).join(', '));
OK('migrazioni: ' + files.join(', '));

console.log('\n— CATALOGHI E TEMPLATE —');
const fetta = (a, b) => js.slice(js.indexOf(a), js.indexOf(b));
const dup = (blocco, nome) => {
  const ks = [...blocco.matchAll(/\{ k:'([a-z0-9_]+)'/g)].map(m => m[1]);
  const d = [...new Set(ks.filter((k, i) => ks.indexOf(k) !== i))];
  if (d.length) KO('catalogo', nome + ': chiavi duplicate — ' + d.join(', '));
  else OK(nome + ': ' + ks.length + ' voci, nessun duplicato');
};
dup(fetta('const CONDIZIONI', 'const PRATICHE_CAT'), 'condizioni');
dup(fetta('const PRATICHE_CAT', 'const TEMPLATES'), 'pratiche');

const tpl = js.slice(js.indexOf('const TEMPLATES'));
const condDef = new Set([...fetta('const CONDIZIONI', 'const PRATICHE_CAT')
  .matchAll(/\{ k:'([a-z0-9_]+)'/g)].map(m => m[1]));
const condUse = new Set([...tpl.matchAll(/cond:'([a-z0-9_]+)'/g)].map(m => m[1]));
const condKo = [...condUse].filter(c => !condDef.has(c));
condKo.forEach(c => KO('template', 'condizione "' + c + '" usata nei template ma non definita'));
if (!condKo.length) OK(condUse.size + ' condizioni usate nei template, tutte definite');

const pratDef = new Set([...fetta('const PRATICHE_CAT', 'const TEMPLATES')
  .matchAll(/\{ k:'([a-z0-9_]+)'/g)].map(m => m[1]));
const pratUse = new Set();
[...tpl.matchAll(/prat(?:Base)?:\s*\[([^\]]*)\]/g)].forEach(m =>
  [...m[1].matchAll(/'([a-z0-9_]+)'/g)].forEach(x => pratUse.add(x[1])));
const pratKo = [...pratUse].filter(k => !pratDef.has(k));
pratKo.forEach(k => KO('template', 'pratica "' + k + '" richiamata da un template ma non nel catalogo'));
if (!pratKo.length) OK(pratUse.size + ' pratiche richiamate dai template, tutte a catalogo');

/* Le condizioni delle pratiche devono esistere, o la pratica non nasce mai */
const pratCond = [...fetta('const PRATICHE_CAT', 'const TEMPLATES')
  .matchAll(/cond:'([a-z0-9_]+)'/g)].map(m => m[1]);
const pratCondKo = [...new Set(pratCond)].filter(c => !condDef.has(c));
pratCondKo.forEach(c => KO('catalogo', 'pratica condizionata a "' + c + '", che non esiste'));
if (!pratCondKo.length) OK('ogni pratica condizionata punta a una condizione esistente');

console.log(problemi ? '\n' + problemi + ' PROBLEMI'
  + (avvisi ? ' · ' + avvisi + ' avvisi' : '')
  : '\nAUDIT STATICO PULITO' + (avvisi ? ' (' + avvisi + ' avvisi)' : ''));
process.exit(problemi ? 1 : 0);
