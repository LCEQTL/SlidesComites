// Camada de acesso: "server" = servidor Python local; "supabase" = GitHub Pages + Supabase (tudo no navegador).
const cfg=window.EQ_CONFIG||{backend:'server'};
export const isSupabase=cfg.backend==='supabase'||cfg.backend==='memory';
let backendPromise;
function backend(){
 return backendPromise??=(async()=>{
  const {createBackend}=await import('./core/backend.js');
  if(cfg.backend==='memory'){ // modo demonstração (sem Supabase): dados só neste navegador
   const [{createMemoryStore},{createMemoryEnv}]=await Promise.all([import('./core/store-memory.js'),import('./core/env-memory.js')]);
   return createBackend({store:createMemoryStore({persistKey:'eq_demo'}),env:createMemoryEnv({password:cfg.demoPassword||'demo'})});
  }
  const [{createSupabaseStore},{createBrowserEnv}]=await Promise.all([import('./core/store-supabase.js'),import('./core/env-browser.js')]);
  const env=await createBrowserEnv(cfg);return createBackend({store:createSupabaseStore(env.client),env});
 })();
}
export async function request(path,body,headers={}){
 if(isSupabase){
  try{return await(await backend()).handle(path,body,headers);}
  catch(e){backendPromise=backendPromise&&e.status===500?null:backendPromise;throw e;}
 }
 const response=await fetch('/api/'+path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':body instanceof Blob?'application/octet-stream':'application/json',...headers},body:body instanceof Blob?body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok){const error=Error(result.error||'Falha no servidor');error.status=response.status;throw error;}return result;
}
export const action=(name,params={})=>request('action',{action:name,...params});
export async function exportStructure(){
 const a=document.createElement('a');
 if(isSupabase){const bundle=await request('template-export');a.href=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,1)],{type:'application/json'}));a.download='bundle.json';}
 else{a.href='/api/template-export';a.download='templates-atualizados.zip';}
 a.click();
}
