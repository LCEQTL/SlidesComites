// Tabela kv (chave/valor jsonb) + função kv_commit (compare-and-swap atômico). Veja supabase/schema.sql.
export function createSupabaseStore(client){
 const fail=error=>{const e=new Error(error.message||'Falha ao acessar o Supabase.');if(/conflict/i.test(error.message||''))e.conflict=true;return e;};
 return {
  async load(keys){
   const {data,error}=await client.from('kv').select('key,value,version').in('key',keys);
   if(error)throw fail(error);
   let version=0;const docs={};
   for(const r of data){docs[r.key]=r.value;if(r.key==='current')version=Number(r.version);}
   return {version,docs};
  },
  async version(){
   const {data,error}=await client.from('kv').select('version').eq('key','current').maybeSingle();
   if(error)throw fail(error);
   return data?Number(data.version):0;
  },
  async commit(expected,writes){
   const {data,error}=await client.rpc('kv_commit',{p_expected:expected,p_writes:writes});
   if(error)throw fail(error);
   return Number(data);
  },
 };
}
