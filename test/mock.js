/* Mock in-memory di Supabase: replica il minimo dell'API usata dall'app */
(function(){
  const UID='u-me', U2='u-due';
  const DB={
    profiles:[{id:UID,full_name:'Francesco Neri',email:'f@scs.it',role:'admin',attivo:true},
              {id:U2,full_name:'Anna Verdi',email:'a@scs.it',role:'collaboratore',attivo:true}],
    projects:[], tasks:[], commessa_fasi:[], commessa_pratiche:[],
    pratica_eventi:[], notifiche:[], time_entries:[], files:[]
  };
  window.__DB=DB;
  let seq=0; const uid=()=>'id'+(++seq);
  const clone=x=>JSON.parse(JSON.stringify(x));

  function Q(table){
    let rows=()=>clone(DB[table]||[]);
    const flt=[]; let ord=null, lim=null, single=false, maybe=false;
    const api={
      select(){ return api; },
      order(c,o){ ord={c,asc:!o||o.ascending!==false}; return api; },
      limit(n){ lim=n; return api; },
      eq(c,v){ flt.push(r=>r[c]===v); return api; },
      neq(c,v){ flt.push(r=>r[c]!==v); return api; },
      in(c,a){ flt.push(r=>a.includes(r[c])); return api; },
      single(){ single=true; return api; },
      maybeSingle(){ maybe=true; return api; },
      insert(v){ const arr=Array.isArray(v)?v:[v];
        const made=arr.map(x=>Object.assign({id:uid(),created_at:new Date().toISOString()},x));
        DB[table].push(...made); api._res=made; return api; },
      upsert(v,opt){ const arr=Array.isArray(v)?v:[v]; const keys=(opt&&opt.onConflict||'').split(',').filter(Boolean);
        const made=[];
        arr.forEach(x=>{ const dup=keys.length&&DB[table].some(r=>keys.every(k=>r[k]===x[k]));
          if(dup&&opt&&opt.ignoreDuplicates)return;
          const rec=Object.assign({id:uid(),created_at:new Date().toISOString()},x); DB[table].push(rec); made.push(rec); });
        api._res=made; return api; },
      update(v){ api._upd=v; return api; },
      delete(){ api._del=true; return api; },
      then(res,rej){
        try{
          if(api._upd){ DB[table].forEach(r=>{ if(flt.every(f=>f(r))) Object.assign(r,api._upd); }); return res({data:null,error:null}); }
          if(api._del){ DB[table]=DB[table].filter(r=>!flt.every(f=>f(r))); return res({data:null,error:null}); }
          if(api._res!==undefined){ const d=api._res; return res({data:single||maybe?d[0]||null:d,error:null}); }
          let d=rows().filter(r=>flt.every(f=>f(r)));
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
      getSession:()=>Promise.resolve({data:{session:{user:{id:UID,email:'f@scs.it'}}}}),
      getUser:()=>Promise.resolve({data:{user:{id:UID,email:'f@scs.it'}}}),
      onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
      signOut:()=>Promise.resolve({error:null})
    },
    storage:{from:()=>({
      upload:()=>Promise.resolve({data:{},error:null}),
      remove:()=>Promise.resolve({data:{},error:null}),
      createSignedUrl:()=>Promise.resolve({data:{signedUrl:'#'},error:null})
    })}
  })};
})();
