// Implementa as mesmas rotas do servidor Python (login, state, action, upload...) sobre um "store" e um "env".
import {Problem,perform,migrateTypes,slideFor,checkRevision,touch,log,admin,config,randomHex} from './domain.js';
import {loadTemplate,exportBundle} from './template.js';
const clone=x=>structuredClone(x);

export function createBackend({store,env}){
 config.mediaPrefix=env.mediaPrefix||'';
 let bundle=null,cache=null;
 const getBundle=async()=>bundle??=await env.loadBundle();
 const findUser=(st,id)=>{const u=st.users.find(x=>x.id===id);if(!u)throw new Problem('Escolha seu perfil para entrar.',401);return u;};

 async function snapshot(profile){
  const keys=['current','previous','official','undo:global',...(profile?['undo:'+profile]:[])];
  let snap=await store.load(keys);
  if(!snap.docs.current){
   const state=loadTemplate(await getBundle());
   try{await store.commit(0,{current:state});}catch(e){if(!e.conflict)throw e;}
   snap=await store.load(keys);
  }
  const cfg=(await getBundle()).config;
  migrateTypes(snap.docs.current,cfg);if(snap.docs.official)migrateTypes(snap.docs.official,cfg);
  return snap;
 }
 async function mutate(fn){
  await getBundle();
  for(let attempt=0;;attempt++){
   const profile=env.getProfile(),{version,docs}=await snapshot(profile),st=docs.current,writes={};
   const con={read:k=>docs[k]==null?null:clone(docs[k]),write:(k,v)=>{writes[k]=v;docs[k]=clone(v);},template:()=>loadTemplate(bundle)};
   const result=fn(st,con,findUser(st,profile));
   st.generation=(st.generation||0)+1;writes.current=st;
   try{await store.commit(version,writes);cache=null;return result;}
   catch(e){
    if(!e.conflict)throw e;
    if(attempt>=7)throw new Problem('Muitas pessoas salvando ao mesmo tempo. Tente novamente.',503);
    await new Promise(r=>setTimeout(r,60+Math.random()*180));
   }
  }
 }
 async function getState(){
  const profile=env.getProfile(),ver=await store.version();
  if(cache&&ver&&cache.version===ver&&cache.profile===profile)return clone(cache.payload);
  const {version,docs}=await snapshot(profile),st=docs.current,user=findUser(st,profile);
  st.restore_available=docs['undo:'+user.id]!=null;st.restore_all_available=docs['undo:global']!=null;
  if(user.role!=='admin')st.history=[];
  const payload={state:st,user,has_previous:docs.previous!=null};
  cache={version,profile,payload:clone(payload)};
  return payload;
 }
 async function upload(kind,body,headers){
  const ident=headers['X-Slide-Id'],revision=Number(headers['X-Revision']??-1),gallery=headers['X-Target']==='photos';
  const caption=decodeURIComponent(headers['X-Caption']||'').trim();
  const profile=env.getProfile(),{docs}=await snapshot(profile),st0=docs.current,u0=findUser(st0,profile);
  if(st0.mode==='presenting')throw new Problem('Apresentação oficial bloqueia alterações.',423);
  const sl0=slideFor(st0,u0,ident);checkRevision(sl0,{revision});
  if(kind==='image'){
   if(!(gallery?['gallery','events']:['image','visits','visits-clients','events']).includes(sl0.layout))throw new Problem('Este modelo não aceita este tipo de imagem.');
   if(gallery&&(sl0.content.photos.length>=40||caption.length>100))throw new Problem('Limite: 40 imagens e 100 caracteres por legenda.');
  }else if(ident!=='dds')throw new Problem('PDF externo está disponível somente no DDS.');
  let result;
  try{result=kind==='image'?await env.processImage(body):await env.processPdf(body,decodeURIComponent(headers['X-File-Name']||'DDS.pdf'));}
  catch(e){throw new Problem((kind==='image'?'Não foi possível ler a imagem: ':'Não foi possível ler o PDF: ')+(e.message||e));}
  return mutate((st,con,user)=>{
   if(st.mode==='presenting')throw new Problem('Apresentação oficial bloqueia alterações.',423);
   const sl=slideFor(st,user,ident);checkRevision(sl,{revision});
   if(kind==='image'){
    if(gallery)sl.content.photos.push({id:randomHex(8),url:result.url,caption});else sl.content.image=result.url;
    log(st,user,'Enviou imagem para '+sl.title);
   }else{sl.content.pdf=result;log(st,user,'Enviou PDF DDS');}
   sl.ready=false;touch(sl,user);return sl;
  });
 }
 async function handle(path,body,headers={}){
  try{
   if(path==='team-login'){await env.teamLogin(body?.password);return {ok:true};}
   if(path==='team-logout'){await env.teamLogout();env.clearProfile();cache=null;return {ok:true};}
   await env.requireSession();
   if(path==='profiles'){const {docs}=await snapshot(null);return {users:docs.current.users};}
   if(path==='login'){const {docs}=await snapshot(null);if(!docs.current.users.some(u=>u.id===body?.id))throw new Problem('Perfil não encontrado.');env.setProfile(body.id);cache=null;return {ok:true};}
   if(path==='logout'){env.clearProfile();cache=null;return {ok:true};}
   if(path==='state')return await getState();
   if(path==='official'){
    const profile=env.getProfile(),{docs}=await snapshot(profile);findUser(docs.current,profile);
    if(!docs.official)throw new Problem('Apresentação oficial ainda não iniciada.',404);
    return docs.official;
   }
   if(path==='template-export'){
    const profile=env.getProfile(),{docs}=await snapshot(profile);admin(findUser(docs.current,profile));
    return exportBundle(docs.current);
   }
   if(path==='action'){const result=await mutate((st,con,u)=>perform(st,con,u,body.action,body));return {result};}
   if(path==='upload/image')return await upload('image',body,headers);
   if(path==='upload/pdf')return await upload('pdf',body,headers);
   throw new Problem('Rota não encontrada.',404);
  }catch(e){
   if(e instanceof Problem||e.status)throw e;
   if(e instanceof TypeError&&!/fetch|network|load/i.test(e.message)){const p=new Problem('Dados inválidos na requisição.',400);p.cause=e;throw p;}
   throw e;
  }
 }
 return {handle};
}
