// Regras de negócio (porte fiel de app/domain.py). Funções síncronas sobre o estado em memória;
// a persistência (Supabase) fica em backend.js/store-*.js.
export class Problem extends Error{constructor(message,status=400){super(message);this.status=status;}}
export const config={mediaPrefix:''};
const clone=x=>structuredClone(x);
export const randomHex=n=>[...crypto.getRandomValues(new Uint8Array(n))].map(b=>b.toString(16).padStart(2,'0')).join('');
export const LAYOUTS=new Set(['pdf','ata','image','gallery','visits','visits-clients','table','table-kpi','table-bullets','works','events','placeholder','text']);
export const ADDABLE=['text','image','table','table-bullets','table-kpi','gallery','events','works','visits','visits-clients'];
export const emptyContent=()=>({rows:[],bullets:[],text:'',image:null,photos:[],visits_agencies:'',visits_partners:'',resolved:'',chart_without:[],chart_with:[],pdf:null,font_size:0,projection_last:false});
export const now=()=>new Date(Date.now()-3*3600*1000).toISOString().slice(0,19)+'-03:00';

export function admin(u){if(u.role!=='admin')throw new Problem('Ação exclusiva dos administradores.',403);}
export const editable=(u,s)=>u.role==='admin'||s.owners.includes(u.id);
export function slideFor(st,u,id){const s=st.slides[id];if(!s)throw new Problem('Lâmina não encontrada.',404);if(!editable(u,s))throw new Problem('Você não é responsável por esta lâmina.',403);return s;}
export function section(st,id){const s=st.sections.find(x=>x.id===id);if(!s)throw new Problem('Seção não encontrada.',404);return s;}
export function log(st,u,text){st.history=[...(st.history||[]),{at:now(),user:u.name,action:text}].slice(-300);}
export function touch(s,u){s.revision+=1;s.updated_at=now();s.updated_by=u.name;}
export function checkRevision(s,p){if(p.revision!==s.revision)throw new Problem('Outra pessoa atualizou esta lâmina. Recupere seu rascunho e recarregue a versão salva.',409);}

export function asset(url){
 if(!url)return null;
 if(typeof url!=='string'||!/(^|\/)[a-f0-9]{64}\.(webp|jpg|pdf)$/.test(url)||!(url.startsWith('/uploads/')||(config.mediaPrefix&&url.startsWith(config.mediaPrefix))))throw new Problem('Arquivo não encontrado ou inválido.');
 return url;
}
function number(value){
 let raw=String(value).trim().replace(/%/g,'').replace(/R\$/g,'').replace(/ /g,'');
 if(['','-','—'].includes(raw))return null;
 if(raw.includes(','))raw=raw.replace(/\./g,'').replace(',','.');
 const v=Number(raw);
 if(Number.isNaN(v))throw new Problem('Valor numérico inválido: '+value);
 if(!Number.isFinite(v)||v<0)throw new Problem('Use números finitos e não negativos.');
 return v;
}
function matrix(rows,maximum=16){
 if(!Array.isArray(rows)||rows.length>1001)throw new Problem('A tabela aceita até 1.000 linhas de dados.');
 if(rows.length&&(!Array.isArray(rows[0])||!rows[0].length||rows[0].length>maximum))throw new Problem(`Use de 1 a ${maximum} colunas.`);
 if(rows.some(r=>!Array.isArray(r)||r.length!==rows[0].length||r.some(v=>typeof v!=='string'||v.length>600)))throw new Problem('Tabela irregular ou célula com mais de 600 caracteres.');
 return rows;
}
export function cleanTable(rows){
 const filled=r=>r.filter(v=>String(v).trim()).length,need=r=>Math.ceil(r.length/2),out=[...rows];
 while(out.length>1&&filled(out[0])<need(out[0])&&filled(out[1])>filled(out[0]))out.shift();
 if(out.length&&filled(out[0])<need(out[0]))throw new Problem('Cabeçalho incompleto: a primeira linha precisa ter título na maioria das colunas. Cole a tabela começando pela linha de cabeçalho.');
 return out;
}

// ---- ATA ----
const ataNorm=x=>String(x).replace(/\s+/g,' ').trim().toLowerCase();
const ataSig=row=>row.slice(1,4).map(ataNorm).join('|');
const ataLabel=row=>row.slice(1,3).filter(x=>x.trim()).map(x=>x.trim()).join(' — ').slice(0,90);
export const ataRows=st=>(st.slides.ata?.content?.rows||[]).slice(1);
const ascii=x=>String(x).normalize('NFKD').replace(/[^\x00-\x7F]/g,'').toLowerCase().trim();

export function normalizeAta(st,s,rows){
 if(!rows.length)return [];
 let header=rows[0].map(ascii);
 const hasHeader=['codigo','cod','id'].includes(header[0])||header[0].startsWith('o que');
 if(!hasHeader)header=[rows[0].length===6&&/^ATA-\d+$/i.test(rows[0][0].trim())?'codigo':'',...Array(rows[0].length-1).fill('')];
 const withCode=['codigo','cod','id'].includes(header[0]);
 if(header.length!==(withCode?6:5))throw new Problem('ATA: cole O quê? | Como? | Quem? | Prazo | Status, opcionalmente com Código na primeira coluna.');
 const data=hasHeader?rows.slice(1):rows;
 const old=(s.content.rows||[]).slice(1).filter(r=>r.length===6),oldmap=new Map();
 for(const r of old){const k=ataSig(r);if(!oldmap.has(k))oldmap.set(k,[]);oldmap.get(k).push(r[0]);}
 const entries=[];
 for(const row of data){
  const vals=withCode?row.slice(1):[...row];
  if(!vals[0].trim()&&entries.length)vals[0]=entries.at(-1)[0][0];
  const code=withCode?row[0].trim().toUpperCase():'';
  if(code&&!/^ATA-\d{3,6}$/.test(code))throw new Problem('Código inválido. Use ATA-001 ou deixe vazio para gerar.');
  entries.push([vals,code]);
 }
 const explicit=entries.map(e=>e[1]).filter(Boolean);
 for(const code of explicit)if(explicit.filter(x=>x===code).length>1)throw new Problem('Código de ata repetido: '+code);
 const taken=new Set(explicit);
 for(const e of entries){ // 1) mesmo conteúdo = mesmo código
  if(e[1])continue;
  for(const cand of oldmap.get(ataSig(['',...e[0].slice(0,3)]))||[])if(!taken.has(cand)){e[1]=cand;taken.add(cand);break;}
 }
 entries.forEach((e,n)=>{ // 2) mesma posição e mesmo assunto = item editado
  if(e[1]||n>=old.length)return;
  if(!taken.has(old[n][0])&&ataNorm(old[n][1])===ataNorm(e[0][0])){e[1]=old[n][0];taken.add(old[n][0]);}
 });
 const used=new Set([...taken].map(c=>Number(c.split('-')[1])));let n=1;
 for(const e of entries){ // 3) novos: menor número livre
  if(e[1])continue;
  while(used.has(n))n++;
  e[1]='ATA-'+String(n).padStart(3,'0');used.add(n);
 }
 return [['Código','O quê?','Como?','Quem?','Prazo','Status'],...entries.map(e=>[e[1],...e[0]])];
}

export function syncAtaRefs(st){
 const rows=ataRows(st),byCode=new Map(rows.map(r=>[r[0],r])),bySig=new Map();
 for(const r of rows){const k=ataSig(r);if(!bySig.has(k))bySig.set(k,[]);bySig.get(k).push(r[0]);}
 for(const s of Object.values(st.slides)){
  const info=s.ata_ref_sig||{},items=[...(s.ata_refs||[]).map(c=>[c,info[c]]),...(s.ata_review||[]).map(r=>[r.code,r])];
  const refs=[],sigs={},review=[];
  for(const [code,meta] of items){
   let sig=meta?.sig,label=meta?.label||'';const row=byCode.get(code);
   if(!sig&&row){sig=ataSig(row);label=label||ataLabel(row);}
   const cands=sig?(bySig.get(sig)||[]):[];
   const found=row&&sig===ataSig(row)?code:(cands.length===1?cands[0]:null);
   if(found){if(!refs.includes(found)){refs.push(found);sigs[found]={sig,label:label||ataLabel(byCode.get(found))};}}
   else if(!review.some(x=>x.code===code))review.push({code,sig:sig||'',label});
  }
  s.ata_refs=refs.slice(0,6);s.ata_ref_sig=Object.fromEntries(s.ata_refs.map(c=>[c,sigs[c]]));s.ata_review=review;
 }
}

export function validateContent(st,s,c){
 if(!c||typeof c!=='object'||Array.isArray(c))throw new Problem('Conteúdo inválido.');
 const out=emptyContent();out.rows=matrix(c.rows??[],s.limits.max_columns);
 if(s.layout==='ata')out.rows=normalizeAta(st,s,out.rows);else out.rows=cleanTable(out.rows);
 const bullets=c.bullets??[];
 if(!Array.isArray(bullets)||bullets.length>6||bullets.some(x=>typeof x!=='string'||x.length>180))throw new Problem('Use até 6 destaques de 180 caracteres.');
 out.bullets=bullets;
 const text=c.text??'';
 if(typeof text!=='string'||text.length>12000)throw new Problem('Texto deve ter até 12.000 caracteres.');
 out.text=text;out.image=asset(c.image);
 const photos=c.photos??[];
 if(!Array.isArray(photos)||photos.length>40)throw new Problem('Limite de 40 imagens por lâmina/grupo.');
 const ids=new Set();
 for(const p of photos){
  if(!p||typeof p!=='object'||typeof p.id!=='string'||ids.has(p.id))throw new Problem('Foto inválida ou duplicada.');
  const caption=String(p.caption??'').trim();
  if(caption.length>100)throw new Problem('A legenda pode ter até 100 caracteres.');
  ids.add(p.id);out.photos.push({id:p.id,url:asset(p.url),caption});
 }
 for(const key of ['visits_agencies','visits_partners','resolved']){
  const v=c[key]??'';
  if(v!==''&&(!/^\d+$/.test(String(v))||Number(v)>99999999))throw new Problem('Quantidade deve ser um número inteiro não negativo.');
  out[key]=String(v);
 }
 for(const key of ['chart_without','chart_with']){
  const rows=matrix(c[key]??[],3);
  if(rows.length){
   if(rows[0].length!==3||rows.length>13)throw new Problem('Gráfico: cole Mês | Realizado | Meta, com até 12 meses.');
   for(const r of rows.slice(1)){number(r[1]);number(r[2]);}
  }
  out[key]=rows;
 }
 const fs=c.font_size??0;
 if(typeof fs!=='number'||!Number.isInteger(fs)||!(fs===0||(fs>=8&&fs<=32)))throw new Problem('Tamanho de fonte da tabela inválido.');
 out.font_size=fs;
 const pl=c.projection_last??false;
 if(typeof pl!=='boolean')throw new Problem('Marcação de projeção inválida.');
 out.projection_last=pl;
 out.pdf=clone(s.content.pdf??null); // PDF só muda pelas rotas de upload/exclusão
 return out;
}

function saveUndo(con,st,u,ids=null,whole=false){
 con.write(whole?'undo:global':'undo:'+u.id,whole?{whole:true,state:clone(st)}:{whole:false,slides:Object.fromEntries(ids.map(i=>[i,clone(st.slides[i])]))});
}
function resetRevisions(next,old){for(const [id,s] of Object.entries(next.slides))s.revision=Math.max(s.revision||0,old.slides[id]?.revision||0)+1;}
function replaceState(st,src){for(const k of Object.keys(st))delete st[k];Object.assign(st,src);}

// Atualiza bases antigas para os tipos de apresentação do template (nomes novos, tipos removidos/criados).
export function migrateTypes(st,cfg){
 const types=cfg.presentation_types,ids=types.map(t=>t.id);
 st.presentation_types=clone(types);
 for(const s of Object.values(st.slides))s.included=Object.fromEntries(ids.map(i=>[i,Boolean(s.included?.[i]??true)]));
 if(!ids.includes(st.settings.default_type))st.settings.default_type=cfg.settings.default_type;
 if(st.event&&!ids.includes(st.event.type))st.event.type=st.settings.default_type;
 return st;
}

export function perform(st,con,u,action,p){const result=_perform(st,con,u,action,p);syncAtaRefs(st);return result;}

function _perform(st,con,u,action,p){
 if(st.mode==='presenting'&&action!=='stop')throw new Problem('A apresentação oficial está bloqueada. Encerre-a para editar.',423);
 if(action==='patch'){
  const s=slideFor(st,u,p.id);checkRevision(s,p);const patch=p.patch||{};
  if('content' in patch){s.content=validateContent(st,s,patch.content);s.ready=false;}
  if('title' in patch){const title=String(patch.title).trim();if(!(title.length>=1&&title.length<=180))throw new Problem('Título deve ter entre 1 e 180 caracteres.');s.title=title;s.ready=false;}
  if('ata_refs' in patch){
   const refs=patch.ata_refs,rows=Object.fromEntries(ataRows(st).map(r=>[r[0],r]));
   if(!Array.isArray(refs)||refs.length>6||!refs.every(c=>c in rows))throw new Problem('Selecione até 6 referências válidas da ata por lâmina.');
   const uniq=[...new Set(refs)];s.ata_refs=uniq;s.ata_ref_sig=Object.fromEntries(uniq.map(c=>[c,{sig:ataSig(rows[c]),label:ataLabel(rows[c])}]));s.ata_review=[];
  }
  for(const key of ['excluded','ready'])if(key in patch)s[key]=Boolean(patch[key]);
  if('included' in patch||'owners' in patch){
   admin(u);
   if('included' in patch){
    const inc=patch.included,types=st.presentation_types.map(t=>t.id);
    if(!inc||typeof inc!=='object'||Object.keys(inc).length!==types.length||!types.every(t=>t in inc)||Object.values(inc).some(v=>typeof v!=='boolean'))throw new Problem('Tipos de reunião inválidos.');
    s.included=inc;
   }
   if('owners' in patch){
    const owners=patch.owners,ids=st.users.map(x=>x.id);
    if(!Array.isArray(owners)||!owners.length||!owners.every(o=>ids.includes(o)))throw new Problem('Responsáveis inválidos.');
    s.owners=[...new Set(owners)];
   }
  }
  touch(s,u);log(st,u,'Atualizou '+s.title);return s;
 }
 if(action==='reorder_sections'){
  admin(u);const ids=p.ids;
  if(!Array.isArray(ids)||ids.length!==st.sections.length||new Set(ids).size!==ids.length||!ids.every(i=>st.sections.some(x=>x.id===i)))throw new Problem('Ordem inválida.');
  const lookup=Object.fromEntries(st.sections.map(s=>[s.id,s]));st.sections=ids.map(i=>lookup[i]);log(st,u,'Reordenou seções');return {};
 }
 if(action==='reorder_slides'){
  const sec=section(st,p.section),ids=p.ids;
  if(!Array.isArray(ids)||ids.length!==sec.slides.length||new Set(ids).size!==ids.length||!ids.every(i=>sec.slides.includes(i)))throw new Problem('Ordem inválida.');
  sec.slides.forEach((id,j)=>{if(!editable(u,st.slides[id])&&ids[j]!==id)throw new Problem('Mova somente lâminas sob sua responsabilidade.',403);});
  sec.slides=ids;log(st,u,'Reordenou '+sec.name);return {};
 }
 if(action==='rename_section'){
  admin(u);const name=String(p.name).trim();
  if(!(name.length>=1&&name.length<=100))throw new Problem('Nome inválido.');
  section(st,p.id).name=name;return {};
 }
 if(action==='add'){
  const sec=section(st,p.section),layout=p.layout;
  if(u.role!=='admin'&&!sec.slides.some(id=>editable(u,st.slides[id])))throw new Problem('Você não é responsável por esta seção.',403);
  if(!ADDABLE.includes(layout))throw new Problem('Modelo adicional inválido.');
  const id='extra-'+randomHex(6);
  const s={id,title:'Nova lâmina',section_id:sec.id,owners:[u.id],layout,limits:{max_columns:16},content:emptyContent(),included:Object.fromEntries(st.presentation_types.map(t=>[t.id,true])),revision:0,ready:false,excluded:false,updated_at:null,updated_by:null,generic:true,ata_refs:[],ata_ref_sig:{},ata_review:[],captions:false,photo_limit:4};
  st.slides[id]=s;sec.slides.push(id);touch(s,u);log(st,u,'Adicionou lâmina');return s;
 }
 if(action==='set_layout'){
  const s=slideFor(st,u,p.id);checkRevision(s,p);const layout=p.layout;
  if(!s.generic)throw new Problem('Só lâminas adicionadas podem trocar de modelo.');
  if(!ADDABLE.includes(layout))throw new Problem('Modelo inválido.');
  if(layout!==s.layout){s.content=validateContent(st,{...s,layout},s.content);s.layout=layout;s.ready=false;touch(s,u);log(st,u,'Trocou o modelo da lâmina');}
  return s;
 }
 if(action==='delete'){
  const s=slideFor(st,u,p.id);
  if(!s.generic)throw new Problem('Use “Não incluir” nas lâminas fixas.');
  if(u.role==='admin')saveUndo(con,st,u,null,true);
  const sec=section(st,s.section_id);sec.slides=sec.slides.filter(x=>x!==s.id);delete st.slides[s.id];log(st,u,'Excluiu '+s.title);return {};
 }
 if(action==='reset'||action==='reuse'){
  let whole=p.scope==='all';
  if(whole)admin(u);
  let ids=whole?Object.keys(st.slides):Object.entries(st.slides).filter(([,s])=>s.owners.includes(u.id)).map(([id])=>id);
  if(p.id){ids=[slideFor(st,u,p.id).id];whole=false;}
  const source=action==='reset'?con.template():con.read('previous');
  if(!source)throw new Problem('Ainda não há reunião anterior. Finalize a atual e use “Nova reunião”.');
  saveUndo(con,st,u,ids,whole);
  if(whole&&action==='reset'){const old=clone(st),gen=old.generation;replaceState(st,source);st.generation=gen;resetRevisions(st,old);}
  else{
   let count=0;
   for(const id of ids){
    const s=st.slides[id],old=source.slides[id];
    if(!old&&action==='reuse')continue;
    s.content=clone(old?old.content:emptyContent());s.ready=false;s.excluded=old?(old.excluded||false):false;
    s.ata_refs=old?clone(old.ata_refs||[]):[];s.ata_ref_sig=old?clone(old.ata_ref_sig||{}):{};s.ata_review=old?clone(old.ata_review||[]):[];
    if(old)s.title=old.title;
    touch(s,u);count++;
   }
   if(!count)throw new Problem('Não há lâminas correspondentes para reaproveitar.');
  }
  log(st,u,action==='reset'?'Resetou template':'Reaproveitou reunião anterior');return {};
 }
 if(action==='restore'){
  const whole=p.scope==='all';
  if(whole)admin(u);
  const key=whole?'undo:global':'undo:'+u.id,saved=con.read(key);
  if(!saved)throw new Problem('Ainda não há uma versão de restauração.');
  if(saved.whole){const old=clone(st),gen=old.generation;replaceState(st,saved.state);st.mode='editing';st.generation=gen;resetRevisions(st,old);con.write(key,{whole:true,state:old});}
  else{
   const current={};
   for(const [id,prev] of Object.entries(saved.slides)){
    if(!(id in st.slides))continue;
    const s=slideFor(st,u,id);current[id]=clone(s);const revision=s.revision;st.slides[id]=clone(prev);st.slides[id].revision=revision;touch(st.slides[id],u);
   }
   con.write(key,{whole:false,slides:current});
  }
  log(st,u,'Restaurou versão anterior');return {};
 }
 if(action==='start'){
  admin(u);const kind=st.presentation_types.find(t=>t.id===p.type);
  if(!kind)throw new Problem('Tipo de apresentação inválido.');
  const stamp=now();st.event={type:kind.id,date:stamp.slice(0,10),started_at:stamp};st.mode='presenting';con.write('official',clone(st));log(st,u,'Iniciou '+kind.name);return {};
 }
 if(action==='stop'){admin(u);st.mode='editing';log(st,u,'Encerrou apresentação oficial');return {};}
 if(action==='new_meeting'){
  admin(u);saveUndo(con,st,u,null,true);con.write('previous',con.read('official')||clone(st));con.write('official',null);
  for(const s of Object.values(st.slides)){s.content=emptyContent();s.ready=false;s.excluded=false;s.ata_refs=[];s.ata_ref_sig={};s.ata_review=[];s.revision+=1;s.updated_at=null;s.updated_by=null;}
  st.event=null;st.mode='editing';log(st,u,'Iniciou nova reunião');return {};
 }
 if(action==='ata_renumber'){
  const s=slideFor(st,u,'ata');checkRevision(s,p);const rows=s.content.rows;
  if(rows.length<2)throw new Problem('A ata está vazia.');
  const mapping=Object.fromEntries(rows.slice(1).map((r,i)=>[r[0],'ATA-'+String(i+1).padStart(3,'0')]));
  s.content.rows=[rows[0],...rows.slice(1).map(r=>[mapping[r[0]],...r.slice(1)])];
  for(const sl of Object.values(st.slides)){
   const info=sl.ata_ref_sig||{};
   sl.ata_refs=[...new Set((sl.ata_refs||[]).map(c=>mapping[c]??c))];sl.ata_ref_sig=Object.fromEntries(Object.entries(info).map(([c,v])=>[mapping[c]??c,v]));
  }
  s.ready=false;touch(s,u);log(st,u,'Renumerou os códigos da ata');return s;
 }
 if(action==='pdf_remove'){
  const s=slideFor(st,u,'dds');checkRevision(s,p);const pdf=s.content.pdf;
  if(p.page&&pdf){pdf.pages=pdf.pages.filter(x=>x.id!==p.page);if(!pdf.pages.length)s.content.pdf=null;}
  else s.content.pdf=null;
  s.ready=false;touch(s,u);log(st,u,'Removeu página/grupo PDF');return s;
 }
 throw new Problem('Ação desconhecida.',404);
}
