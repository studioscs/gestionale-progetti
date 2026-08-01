/* Mock in-memory di Supabase: replica il minimo dell'API usata dall'app */
(function(){
  const UID='u-me', U2='u-due';
  const DB={
    profiles:[{id:UID,full_name:'Francesco Neri',email:'f@scs.it',role:'admin',attivo:true},
              {id:U2,full_name:'Anna Verdi',email:'a@scs.it',role:'collaboratore',attivo:true}],
    projects:[], tasks:[], commessa_fasi:[], commessa_pratiche:[],
    pratica_eventi:[], notifiche:[], time_entries:[], files:[],
    project_fasi:[], project_sottofasi:[], commessa_fatture:[], clienti:[],
    profili_costi:[], enti_pa:[], commessa_sal:[], commessa_varianti:[]
  };
  window.__DB=DB;
  /* Colonne che il database NON ha: simula una migrazione non eseguita, come fa
     PostgREST quando l'app e' piu' avanti dello schema. */
  window.__COLONNE_ASSENTI=[];
  function verificaColonne(v){
    const assenti=window.__COLONNE_ASSENTI||[]; if(!assenti.length) return null;
    for(const rec of (Array.isArray(v)?v:[v]))
      for(const k of Object.keys(rec||{}))
        if(assenti.includes(k))
          return {message:"Could not find the '"+k+"' column of 'projects' in the schema cache"};
    return null;
  }
  let seq=0; const uid=()=>'id'+(++seq);
  const clone=x=>JSON.parse(JSON.stringify(x));
  const giornoPrima=d=>{ const x=new Date(d+'T00:00:00'); x.setDate(x.getDate()-1);
    return x.toISOString().slice(0,10); };
  const r2=n=>Math.round(n*100)/100;

  /* --- trigger della migrazione 012, replicati --- */
  function percSal(s){
    if(s.percentuale!=null) return;
    const p=DB.projects.find(x=>x.id===s.project_id);
    const base=p&&Number(p.importo_lavori||0);
    if(base>0) s.percentuale=Math.min(100,r2(Number(s.importo_progressivo||0)/base*100));
  }
  function maturaDL(s){
    const p=DB.projects.find(x=>x.id===s.project_id);
    const compenso=p?Number(p.compenso_dl||0):0;
    const perc=Number(s.percentuale||0);
    if(compenso<=0||perc<=0) return;
    const maturato=r2(compenso*perc/100);
    const prima=DB.commessa_fatture.filter(f=>f.project_id===s.project_id&&f.sal_id&&f.stato!=='annullata')
      .filter(f=>{const s2=DB.commessa_sal.find(y=>y.id===f.sal_id); return s2&&s2.numero<s.numero;})
      .reduce((a,f)=>a+Number(f.imponibile||0),0);
    const quota=r2(maturato-prima);
    const desc='Direzione lavori — quota su SAL n. '+s.numero+' ('+perc.toFixed(2)+'%)';
    const esistente=DB.commessa_fatture.find(f=>f.sal_id===s.id&&f.stato!=='annullata');
    if(quota<=0){ if(esistente&&['da_emettere','pronta'].includes(esistente.stato)) esistente.imponibile=0; return; }
    if(esistente){ if(['da_emettere','pronta'].includes(esistente.stato)){
        esistente.imponibile=quota; esistente.descrizione=desc; } return; }
    DB.commessa_fatture.push({id:uid(),project_id:s.project_id,descrizione:desc,
      ordine:DB.commessa_fatture.filter(f=>f.project_id===s.project_id).length+1,
      imponibile:quota,data_prevista:s.data_emissione||null,stato:'pronta',sal_id:s.id,
      created_at:new Date().toISOString()});
  }
  function applicaVariante(v){
    if(v.stato!=='approvata'||v._applicata||!v.aggiorna_importo||v.importo==null) return;
    const p=DB.projects.find(x=>x.id===v.project_id);
    if(p){ p.importo_lavori=Number(p.importo_lavori||0)+Number(v.importo); v._applicata=true; }
  }

  function Q(table){
    // vista calcolata: conteggio messaggi per pratica
    if(table==='v_pratiche_chat'){
      DB[table]=DB.commessa_pratiche.map(p=>({pratica_id:p.id,project_id:p.project_id,
        messaggi:DB.pratica_eventi.filter(e=>e.pratica_id===p.id&&e.tipo==='messaggio').length,
        eventi_totali:DB.pratica_eventi.filter(e=>e.pratica_id===p.id).length}));
    }
    let rows=()=>clone(DB[table]||[]);
    const flt=[]; let ord=null, lim=null, single=false, maybe=false;
    const api={
      select(c,o){ if(o&&o.head){api._count=true;} return api; },
      order(c,o){ ord={c,asc:!o||o.ascending!==false}; return api; },
      limit(n){ lim=n; return api; },
      eq(c,v){ flt.push(r=>r[c]===v); return api; },
      neq(c,v){ flt.push(r=>r[c]!==v); return api; },
      in(c,a){ flt.push(r=>a.includes(r[c])); return api; },
      single(){ single=true; return api; },
      maybeSingle(){ maybe=true; return api; },
      insert(v){ const err=verificaColonne(v); if(err){ api._err=err; return api; }
        const arr=Array.isArray(v)?v:[v];
        const made=arr.map(x=>Object.assign({id:uid(),created_at:new Date().toISOString()},x));
        /* Replica il trigger trg_chiudi_costo della migrazione 009: inserendo un
           nuovo costo, il periodo aperto precedente si chiude il giorno prima. */
        if(table==='profili_costi') made.forEach(n=>{
          DB.profili_costi.forEach(r=>{ if(r.profile_id===n.profile_id&&!r.valido_al&&r.valido_dal<n.valido_dal)
            r.valido_al=giornoPrima(n.valido_dal); }); });
        DB[table].push(...made);
        /* Trigger della migrazione 012: percentuale calcolata e quota di DL
           che matura sul SAL. Replicati qui perche' l'app ci conta. */
        if(table==='commessa_sal') made.forEach(percSal), made.forEach(maturaDL);
        if(table==='commessa_varianti') made.forEach(applicaVariante);
        api._res=made; return api; },
      upsert(v,opt){ const arr=Array.isArray(v)?v:[v]; const keys=(opt&&opt.onConflict||'').split(',').filter(Boolean);
        const made=[];
        arr.forEach(x=>{ const dup=keys.length&&DB[table].some(r=>keys.every(k=>r[k]===x[k]));
          if(dup&&opt&&opt.ignoreDuplicates)return;
          const rec=Object.assign({id:uid(),created_at:new Date().toISOString()},x); DB[table].push(rec); made.push(rec); });
        api._res=made; return api; },
      update(v){ const err=verificaColonne(v); if(err){ api._err=err; return api; }
        api._upd=v; return api; },
      _dopoUpdate(){
        if(table==='commessa_sal') DB.commessa_sal.filter(r=>flt.every(f=>f(r)))
          .forEach(r=>{ percSal(r); maturaDL(r); });
        if(table==='commessa_varianti') DB.commessa_varianti.filter(r=>flt.every(f=>f(r)))
          .forEach(applicaVariante);
      },
      delete(){ api._del=true; return api; },
      then(res,rej){
        try{
          if(api._err) return res({data:null,error:api._err});
          if(api._upd){ DB[table].forEach(r=>{ if(flt.every(f=>f(r))) Object.assign(r,api._upd); });
            api._dopoUpdate(); return res({data:null,error:null}); }
          if(api._del){ DB[table]=DB[table].filter(r=>!flt.every(f=>f(r))); return res({data:null,error:null}); }
          if(api._res!==undefined){ const d=api._res; return res({data:single||maybe?d[0]||null:d,error:null}); }
          let d=rows().filter(r=>flt.every(f=>f(r)));
          if(api._count) return res({data:null,count:d.length,error:null});
          if(ord) d.sort((a,b)=>{const x=a[ord.c],y=b[ord.c];
            if(x==null&&y==null)return 0; if(x==null)return 1; if(y==null)return -1;
            return (x>y?1:x<y?-1:0)*(ord.asc?1:-1);});
          if(lim) d=d.slice(0,lim);
          return res({data:single||maybe?(d[0]||null):d,error:null});
        }catch(e){ return res({data:null,error:{message:String(e)}}); }
      }
    };
    return api;
  }
  window.supabase={createClient:()=>({
    from:t=>Q(t),
    auth:{
      getSession:()=>Promise.resolve({data:{session:window.__NOSESSION?null:{user:{id:UID,email:'f@scs.it'}}}}),
      getUser:()=>Promise.resolve({data:{user:{id:UID,email:'f@scs.it'}}}),
      onAuthStateChange:(cb)=>{ window.__AUTHCB=cb; return {data:{subscription:{unsubscribe(){}}}}; },
      updateUser:(attrs)=>{ window.__UPDATED=attrs;
        if(attrs.password==='VecchiaPass1') return Promise.resolve({data:null,error:{message:'New password should be different from the old password.'}});
        return Promise.resolve({data:{user:{id:'u-me'}},error:null}); },
      resetPasswordForEmail:(em,o)=>{ window.__RESET={email:em,opts:o}; return Promise.resolve({data:{},error:null}); },
      signOut:()=>Promise.resolve({error:null})
    },
    storage:{from:()=>({
      list:(prefix)=>Promise.resolve({data:(window.__STORAGE||[]).filter(x=>x.startsWith(prefix+'/'))
              .map(x=>({name:x.split('/').slice(1).join('/')})),error:null}),
      upload:(p)=>{ (window.__STORAGE=window.__STORAGE||[]).push(p); return Promise.resolve({data:{},error:null}); },
      remove:(ps)=>{ window.__STORAGE=(window.__STORAGE||[]).filter(x=>!ps.includes(x)); return Promise.resolve({data:{},error:null}); },
      createSignedUrl:()=>Promise.resolve({data:{signedUrl:'#'},error:null})
    })}
  })};
})();
