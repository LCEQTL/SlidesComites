// Armazenamento em memória com a mesma semântica do Supabase (usado nos testes).
export function createMemoryStore({persistKey=null}={}){
 const ls=persistKey&&typeof localStorage!=='undefined'?localStorage:null;
 const docs=new Map();let version=0;
 if(ls&&ls.getItem(persistKey)){const saved=JSON.parse(ls.getItem(persistKey));version=saved.version;for(const [k,v] of Object.entries(saved.docs))docs.set(k,v);}
 const persist=()=>{if(ls)ls.setItem(persistKey,JSON.stringify({version,docs:Object.fromEntries(docs)}));};
 const clone=x=>x===undefined?undefined:structuredClone(x);
 return {
  async load(keys){const out={};for(const k of keys)if(docs.has(k))out[k]=clone(docs.get(k));return {version,docs:out};},
  async version(){return docs.has('current')?version:0;},
  async commit(expected,writes){
   if(expected!==version){const e=new Error('conflict');e.conflict=true;throw e;}
   version+=1;for(const [k,v] of Object.entries(writes))docs.set(k,clone(v));persist();return version;
  },
 };
}
