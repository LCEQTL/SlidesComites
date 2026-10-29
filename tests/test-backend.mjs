// Testa o backend do navegador (domínio + Supabase/CAS simulado em memória), sem precisar de Supabase real.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBackend} from '../static/js/core/backend.js';
import {migrateTypes} from '../static/js/core/domain.js';
import {createMemoryStore} from '../static/js/core/store-memory.js';
const bundle=JSON.parse(readFileSync(new URL('../templates/bundle.json',import.meta.url),'utf8'));
const prefix='https://proj.supabase.co/storage/v1/object/public/media/',hash='a'.repeat(64);
const store=createMemoryStore();
function client(){
 let profile=null;
 const env={mediaPrefix:prefix,loadBundle:async()=>bundle,requireSession:async()=>{},teamLogin:async()=>{},teamLogout:async()=>{},getProfile:()=>profile,setProfile:id=>{profile=id;},clearProfile:()=>{profile=null;},
  processImage:async()=>({url:prefix+hash+'.webp'}),processPdf:async(b,name)=>({name,source:prefix+hash+'.pdf',pages:[{id:'1',number:1,url:prefix+hash+'.webp'}]})};
 const b=createBackend({store,env});
 const call=async(path,body,headers)=>{try{return {status:200,...await b.handle(path,body,headers)};}catch(e){return {status:e.status||500,error:e.message};}};
 return {call,action:(name,params={})=>call('action',{action:name,...params}),login:id=>call('login',{id}),state:async()=>(await call('state')).state};
}
const admin=client(),editor=client(),other=client(),larisse=client();
assert.equal((await admin.call('state')).status,401);                                  // sem perfil
assert.equal((await admin.login('inexistente')).status,400);
await admin.login('lucas');await editor.login('layza');await other.login('wagner');await larisse.login('larisse');
let st=await admin.state();
assert.deepEqual([Object.keys(st.slides).length,st.sections.length,st.users.length],[74,24,15]);
assert.equal(st.history.length>=0,true);assert.equal((await editor.state()).history.length,0);
const rev=async(c,id)=>(await c.state()).slides[id].revision;

// --- permissões e revisão
const own='cobranca-picos';
let r=await editor.action('patch',{id:own,revision:0,patch:{title:'Régua — teste'}});assert.equal(r.status,200);
assert.equal((await editor.action('patch',{id:own,revision:0,patch:{title:'x'}})).status,409);   // revisão antiga
assert.equal((await other.action('patch',{id:own,revision:await rev(other,own),patch:{title:'x'}})).status,403);
assert.equal((await editor.action('reorder_sections',{ids:[]})).status,403);

// --- tabelas: linha de título removida, cabeçalho incompleto, fonte, projeção
const patchContent=async(c,id,content)=>c.action('patch',{id,revision:await rev(c,id),patch:{content}});
let content=(await editor.state()).slides[own].content;
content.rows=[['MÊS DE OUTUBRO','','',''],['ETAPA','DATA','EVENTO','AÇÃO'],['3','V+2','REAVISO','REVISAR']];
assert.equal((await patchContent(editor,own,content)).status,200);
st=await editor.state();assert.deepEqual(st.slides[own].content.rows[0],['ETAPA','DATA','EVENTO','AÇÃO']);assert.equal(st.slides[own].content.rows.length,2);
content=st.slides[own].content;content.rows=[['','','',''],['a','','','']];assert.equal((await patchContent(editor,own,content)).status,400);
content.rows=[['A','B'],['1','2']];content.font_size=14;assert.equal((await patchContent(editor,own,content)).status,200);
content.font_size=3;assert.equal((await patchContent(editor,own,content)).status,400);content.font_size='14';assert.equal((await patchContent(editor,own,content)).status,400);
content.font_size=0;content.projection_last='sim';assert.equal((await patchContent(editor,own,content)).status,400);
content.projection_last=false;content.rows=[['A','B'],['1']];assert.equal((await patchContent(editor,own,content)).status,400);   // tabela irregular
content.rows=[];content.chart_without=[['Mês','Realizado','Meta'],['Jan','x','3']];assert.equal((await patchContent(editor,own,content)).status,400);

// --- ATA: numeração sem contador escondido, referências que acompanham o item
const ata=(...items)=>[['O quê?','Como?','Quem?','Prazo','Status'],...items.map(i=>[...i])];
const saveAta=async rows=>{const c=(await larisse.state()).slides.ata.content;c.rows=rows;const x=await patchContent(larisse,'ata',c);assert.equal(x.status,200,x.error);return (await larisse.state()).slides.ata.content.rows;};
const codes=rows=>rows.slice(1).map(r=>r[0]);
let rows=await saveAta(ata(['IAR','Revisar','Layza','10/10','Em andamento'],['IAR','Enviar','Layza','11/10','Pendente'],['PECLD','Cobrar','Mariana','12/10','Pendente']));
assert.deepEqual(codes(rows),['ATA-001','ATA-002','ATA-003']);
rows=await saveAta(ata(['IAR','Revisar','Layza','10/10','Concluído'],['IAR','Enviar','Layza','11/10','Pendente'],['PECLD','Cobrar','Mariana','12/10','Pendente']));
assert.deepEqual(codes(rows),['ATA-001','ATA-002','ATA-003']);
assert.deepEqual(await saveAta([]),[]);
rows=await saveAta(ata(['FER','Analisar','Vinícius','20/10','Pendente'],['FER','Reportar','Vinícius','21/10','Pendente']));assert.deepEqual(codes(rows),['ATA-001','ATA-002']);
rows=await saveAta(ata(['FER','Analisar','Vinícius','20/10','Pendente'],['NOVO','Item','Alguém','22/10','Pendente'],['FER','Reportar','Vinícius','21/10','Pendente']));assert.deepEqual(codes(rows),['ATA-001','ATA-003','ATA-002']);
rows=await saveAta(ata(['TOTALMENTE','Diferente','Outro','01/11','Pendente'],['TUDO','Novo','Outro','02/11','Pendente']));assert.deepEqual(codes(rows),['ATA-001','ATA-002']);
rows=await saveAta([['APRESENTAÇÃO','Incluir código','Lucas','15/10','Concluído'],['IAR','Atualizar régua','Lucas','07/10','Atrasado']]);   // sem cabeçalho
assert.deepEqual(rows.slice(1).map(r=>r[1]),['APRESENTAÇÃO','IAR']);
rows=await saveAta(ata(['TOTALMENTE','Diferente','Outro','01/11','Pendente'],['TUDO','Novo','Outro','02/11','Pendente']));
assert.equal((await editor.action('patch',{id:own,revision:await rev(editor,own),patch:{ata_refs:['ATA-002']}})).status,200);
rows=await saveAta(ata(['TUDO','Novo','Outro','02/11','Concluído'],['TOTALMENTE','Diferente','Outro','01/11','Pendente']));
st=await editor.state();assert.deepEqual(st.slides[own].ata_refs,['ATA-002']);assert.deepEqual(st.slides[own].ata_review,[]);
await saveAta(ata(['TOTALMENTE','Diferente','Outro','01/11','Pendente']));
st=await editor.state();assert.deepEqual(st.slides[own].ata_refs,[]);assert.equal(st.slides[own].ata_review[0].code,'ATA-002');
await saveAta(ata(['TOTALMENTE','Diferente','Outro','01/11','Pendente'],['TUDO','Novo','Outro','02/11','Pendente']));
st=await editor.state();assert.equal(st.slides[own].ata_refs.length,1);assert.deepEqual(st.slides[own].ata_review,[]);   // item voltou
assert.equal((await editor.action('ata_renumber',{revision:await rev(editor,'ata')})).status,403);
assert.equal((await larisse.action('ata_renumber',{revision:await rev(larisse,'ata')})).status,200);
assert.deepEqual(codes((await larisse.state()).slides.ata.content.rows),['ATA-001','ATA-002']);

// --- lâminas adicionadas: trocar modelo e excluir
let a=await editor.action('add',{section:'iar',layout:'table'});assert.equal(a.status,200);const sid=a.result.id;
content=(await editor.state()).slides[sid].content;content.rows=[['A','B'],['1','2']];assert.equal((await patchContent(editor,sid,content)).status,200);
assert.equal((await editor.action('set_layout',{id:sid,layout:'visits-clients',revision:await rev(editor,sid)})).status,200);
assert.deepEqual((await editor.state()).slides[sid].content.rows,[['A','B'],['1','2']]);
assert.equal((await editor.action('set_layout',{id:sid,layout:'ata',revision:await rev(editor,sid)})).status,400);
assert.equal((await editor.action('set_layout',{id:'iar-picos',layout:'table',revision:0})).status,400);
assert.equal((await editor.action('delete',{id:'iar-picos'})).status,400);
assert.equal((await editor.action('delete',{id:sid})).status,200);assert.ok(!(await editor.state()).slides[sid]);

// --- imagens: legenda opcional, layout inválido, revisão antiga
const file=new Blob(['x']),up=(c,id,extra={})=>c.call('upload/image',file,{'X-Slide-Id':id,'X-Revision':String(extra.rev??0),...extra.h});
let u=await up(admin,'boas-praticas',{rev:await rev(admin,'boas-praticas'),h:{'X-Target':'photos'}});assert.equal(u.status,200);assert.equal(u.content.photos[0].caption,'');
u=await up(admin,'boas-praticas',{rev:u.revision,h:{'X-Target':'photos','X-Caption':encodeURIComponent('Floriano')}});assert.equal(u.content.photos[1].caption,'Floriano');
assert.equal((await up(admin,'boas-praticas',{rev:0,h:{'X-Target':'photos'}})).status,409);
assert.equal((await up(admin,'cobranca-picos',{rev:await rev(admin,'cobranca-picos')})).status,400);   // tabela não aceita imagem
u=await up(editor,'metas-picos',{rev:await rev(editor,'metas-picos')});assert.equal(u.status,200);assert.equal(u.content.image,prefix+hash+'.webp');
content=(await admin.state()).slides['metas-picos'].content;content.image='https://evil.example/'+hash+'.webp';assert.equal((await patchContent(admin,'metas-picos',content)).status,400);   // URL fora do Storage
let pdf=await admin.call('upload/pdf',new Blob(['%PDF']),{'X-Slide-Id':'dds','X-Revision':String(await rev(admin,'dds')),'X-File-Name':'DDS.pdf'});assert.equal(pdf.status,200);
assert.equal((await admin.call('upload/pdf',new Blob(['%PDF']),{'X-Slide-Id':'metas-picos','X-Revision':String(await rev(admin,'metas-picos'))})).status,400);

// --- apresentação oficial, bloqueio e nova reunião
assert.equal((await editor.action('start',{type:'governanca'})).status,403);
assert.equal((await admin.action('start',{type:'inexistente'})).status,400);
assert.equal((await admin.action('start',{type:'governanca'})).status,200);
assert.equal((await editor.action('patch',{id:own,revision:await rev(editor,own),patch:{title:'bloqueado'}})).status,423);
assert.equal((await up(admin,'metas-picos',{rev:await rev(admin,'metas-picos')})).status,423);
const official=await editor.call('official');assert.equal(official.status,200);assert.equal(official.mode,'presenting');
assert.equal((await admin.action('stop')).status,200);
assert.equal((await editor.call('official')).status,200);
assert.equal((await admin.action('new_meeting')).status,200);
assert.equal((await editor.call('official')).status,404);
st=await editor.state();assert.equal(st.has_previous,undefined);assert.equal((await editor.call('state')).has_previous,true);
assert.deepEqual(st.slides[own].content.rows,[]);
assert.equal((await editor.action('reuse',{})).status,200);                                        // reaproveita a anterior (lâminas do próprio editor)
assert.equal((await editor.state()).slides[own].title.length>0,true);
assert.equal((await admin.action('restore',{scope:'all'})).status,200);                           // desfaz a nova reunião
assert.equal((await admin.action('reset',{scope:'all'})).status,200);
st=await admin.state();assert.equal(Object.keys(st.slides).length,74);assert.equal(st.slides.dds.content.pdf,null);

// --- concorrência: duas gravações simultâneas em lâminas diferentes são ambas aplicadas (CAS + repetição)
const [x,y]=await Promise.all([editor.action('patch',{id:own,revision:await rev(editor,own),patch:{title:'Picos A'}}),other.action('patch',{id:'interligacao-ga-floriano',revision:await rev(other,'interligacao-ga-floriano'),patch:{title:'GA B'}})]);
assert.equal(x.status,200);assert.equal(y.status,200);
st=await admin.state();assert.equal(st.slides[own].title,'Picos A');assert.equal(st.slides['interligacao-ga-floriano'].title,'GA B');

// --- tipos de apresentação: nomes novos e migração de bases antigas
assert.deepEqual(st.presentation_types.map(x=>x.name),['Comitê de Clientes','Comitê de Relacionamento com o Cliente','Comitê de Cobrança']);
const oldState=structuredClone(st);oldState.presentation_types=[{id:'comite'},{id:'governanca'},{id:'ceneged'}];
for(const s of Object.values(oldState.slides))s.included={comite:true,governanca:false,ceneged:true};
oldState.settings.default_type='ceneged';oldState.event={type:'ceneged',date:'2026-10-08'};
migrateTypes(oldState,bundle.config);assert.deepEqual(oldState.presentation_types.map(x=>x.id),['comite','governanca','cobranca']);
assert.deepEqual(oldState.slides.dds.included,{comite:true,governanca:false,cobranca:true});assert.deepEqual([oldState.settings.default_type,oldState.event.type],['governanca','governanca']);

// --- exportação da estrutura
const ex=await admin.call('template-export');assert.equal(Object.keys(ex.slides).length,74);assert.equal(ex.config.sections.length,24);assert.equal((await editor.call('template-export')).status,403);
console.log('OK: backend JS — permissões, revisão, tabelas, ata, lâminas adicionadas, mídia, apresentação oficial, nova reunião, restauração, concorrência e exportação.');
