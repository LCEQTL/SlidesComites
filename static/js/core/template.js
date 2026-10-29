// Template em um único arquivo (templates/bundle.json), gerado por tools/build_bundle.py.
import {emptyContent,LAYOUTS} from './domain.js';
export function loadTemplate(bundle){
 const cfg=bundle.config,structure=bundle.structure;
 const users=new Set(cfg.users.map(u=>u.id)),types=new Set(cfg.presentation_types.map(t=>t.id));
 if(users.size!==cfg.users.length)throw new Error('Usuário duplicado no template.');
 const slides={},sections=[],defs=Object.fromEntries(cfg.sections.map(s=>[s.id,s]));
 for(const row of structure){
  const id=row.id,sid=row.section_id;
  if(id in slides||!(sid in defs))throw new Error('ID duplicado ou seção inválida: '+id);
  const s=structuredClone(bundle.slides[id]);
  if(!s)throw new Error('Lâmina sem definição: '+id);
  if(!LAYOUTS.has(s.layout))throw new Error('Layout inválido: '+s.layout);
  if(s.layout==='pdf'&&id!=='dds')throw new Error('PDF permitido somente em DDS.');
  if(!row.owners.length||!row.owners.every(o=>users.has(o)))throw new Error('Responsável inválido: '+id);
  const inc=Object.keys(row.included);
  if(inc.length!==types.size||!inc.every(t=>types.has(t))||Object.values(row.included).some(v=>typeof v!=='boolean'))throw new Error('Inclusão por apresentação inválida: '+id);
  Object.assign(s,{id,title:row.title,owners:row.owners,included:row.included,section_id:sid,revision:0,excluded:false,ready:false,updated_at:null,updated_by:null,generic:false,ata_refs:[],ata_ref_sig:{},ata_review:[]});
  s.content={...emptyContent(),...(s.content||{})};slides[id]=s;
  let sec=sections.find(x=>x.id===sid);
  if(!sec){sec={id:sid,name:defs[sid].name,slides:[]};sections.push(sec);}
  sec.slides.push(id);
 }
 return {schema_version:2,settings:cfg.settings,users:cfg.users,wallets:cfg.wallets,presentation_types:cfg.presentation_types,sections,slides,mode:'editing',event:null,history:[],generation:0};
}
// Gera um novo bundle com a estrutura atual (ordem, títulos, responsáveis, lâminas adicionadas), sem conteúdo.
export function exportBundle(state){
 const structure=[],slides={};
 const config={settings:state.settings,users:state.users,wallets:state.wallets,presentation_types:state.presentation_types,version:2,sections:state.sections.map(s=>({id:s.id,name:s.name}))};
 for(const sec of state.sections)for(const id of sec.slides){
  const sl=state.slides[id];
  structure.push({id,section_id:sl.section_id,title:sl.title,owners:sl.owners,included:sl.included,file:'laminas/'+id+'.json'});
  const def={id,title:sl.title,owners:sl.owners,layout:sl.layout,limits:sl.limits};
  for(const k of ['captions','photo_limit'])if(k in sl)def[k]=sl[k];
  def.content={...emptyContent(),projection_last:sl.layout==='works'};slides[id]=def;
 }
 return {config,structure,slides};
}
