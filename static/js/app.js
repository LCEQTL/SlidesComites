import{request,action,exportStructure,isSupabase}from'./api.js';
import{esc,stamp,ownerNames,canEdit,renderSlide,fitStages,parts,buildDeck,parseTSV,toTSV,cleanTable,validateRows,tableMetrics}from'./render.js';
const $=s=>document.querySelector(s), app=$('#app');
let onlyMine=false;
let state,user,hasPrevious,selection={kind:'cover'},activeField=null,collapsed=new Set(),pdfCollapsed=new Set(),drag=null;
let pending=new Map(),inflight=null,timer=null,saveError=null,formInvalid=false,localVersion=0,presenting=null;
const isAdmin=()=>user?.role==='admin';
const allowed=s=>state.mode==='editing'&&canEdit(user,s);
const lock='<svg class="lock" viewBox="0 0 12 15" aria-label="Somente leitura"><path fill="currentColor" d="M2 6V4a4 4 0 018 0v2h1v9H1V6h1zm2 0h4V4a2 2 0 00-4 0v2z"/></svg>';
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').style.display='none',6000);}
function status(message,error=false){const e=$('#save-status');if(e){e.textContent=message;e.classList.toggle('error',error);e.title=error?'Clique para tentar novamente ou recuperar a edição':'';}}
async function guard(fn){try{return await fn();}catch(e){toast(e.message);if(e.status===401)await loginScreen();}}
function savedLabel(){status(pending.size?'Alterações não salvas':'Todas as alterações salvas');}
function queue(slide,patch){
 pending.set(slide.id,{...(pending.get(slide.id)||{}),...structuredClone(patch)});localVersion++;saveError=null;status('Salvando…');clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),650);
}
async function flush(){
 clearTimeout(timer);
 if(inflight){await inflight;if(pending.size)return flush();return;}
 if(formInvalid)throw Error('Corrija os dados inválidos antes de continuar.');
 if(!pending.size)return;
 inflight=(async()=>{
  while(pending.size){
   const [id,patch]=pending.entries().next().value;pending.delete(id);const slide=state.slides[id];
   try{
    const {result}=await action('patch',{id,revision:slide.revision,patch});
    // Preserva campos que foram digitados durante a requisição.
    const newer=pending.get(id),merged={...result,...newer},content=slide.content;Object.assign(content,merged.content);merged.content=content;Object.assign(slide,merged);
   }catch(e){pending.set(id,{...patch,...(pending.get(id)||{})});saveError=e;status(e.status===409?'Conflito — clique para recuperar':'Não salvo — clique para tentar',true);throw e;}
  }
  savedLabel();renderSidebar();renderPreview();
 })();
 try{await inflight;}finally{inflight=null;}
}
async function reload({keepSelection=true}={}){
 const result=await request('state');state=result.state;user=result.user;hasPrevious=result.has_previous;
 if(!keepSelection)selection={kind:'cover'};
 if(selection.kind==='slide'&&!state.slides[selection.id])selection={kind:'cover'};
 const keep=$('#sidebar')?.scrollTop||0,keepPanel=$('#inspector')?.scrollTop||0;
 renderApp();
 if($('#sidebar'))$('#sidebar').scrollTop=keep;if($('#inspector'))$('#inspector').scrollTop=keepPanel;
}
async function teamLoginScreen(message=''){
 app.innerHTML=`<div class="login"><div class="login-brand"><img src="static/assets/logo-branca.png" alt="Equatorial"></div><h1>Apresentações</h1><p class="muted-text">Digite a senha da equipe para continuar.</p><div class="profiles" style="grid-template-columns:1fr"><input id="team-password" type="password" autocomplete="current-password" placeholder="Senha da equipe"><button id="team-enter" class="primary">Entrar</button></div><p class="error-text" id="team-error">${esc(message)}</p></div>`;
 const enter=()=>guard(async()=>{try{await request('team-login',{password:$('#team-password').value});}catch(e){$('#team-error').textContent=e.message;return;}await loginScreen();});
 $('#team-enter').onclick=enter;$('#team-password').onkeydown=e=>{if(e.key==='Enter')enter();};$('#team-password').focus();
}
async function loginScreen(){
 let users;try{({users}=await request('profiles'));}catch(e){if(e.code==='team-login')return teamLoginScreen();throw e;}
 app.innerHTML=`<div class="login"><div class="login-brand"><img src="static/assets/logo-branca.png" alt="Equatorial"></div><h1>Apresentações</h1><p class="muted-text">Selecione seu nome para continuar.</p><div class="profiles">${users.map(u=>`<button data-login="${u.id}" style="--owner:${u.color}"><span class="dot"></span>${esc(u.name)}<small>${u.role==='admin'?'Administrador':'Responsável'}</small></button>`).join('')}</div>${isSupabase?'<p class="login-note">Equipe autenticada • O perfil é escolhido sem senha. <a href="#" id="team-out">Sair da conta da equipe</a></p>':'<p class="login-note">Ambiente local de testes • Os perfis são selecionados sem senha.</p>'}</div>`;
 if($('#team-out'))$('#team-out').onclick=e=>{e.preventDefault();guard(async()=>{await request('team-logout',{});await loginScreen();});};
 app.querySelectorAll('[data-login]').forEach(b=>b.onclick=()=>guard(async()=>{await request('login',{id:b.dataset.login});pending.clear();saveError=null;formInvalid=false;selection={kind:'cover'};activeField=null;await reload();}));
}
function renderApp(){
 document.documentElement.style.setProperty('--owner',user.color);
 app.innerHTML=`<header class="topbar"><img class="brand" src="static/assets/logo-branca.png" alt="Equatorial"><span class="topbar-title">Apresentação • Regional Sul</span><span id="save-status" class="saved">Todas as alterações salvas</span>${isAdmin()?'<button id="summary">Resumo</button><button id="admin-menu" title="Template, restauração e nova reunião">Gerenciar</button>':'<button id="own-menu">Minhas lâminas</button>'}<button class="profile-button" id="profile"><span class="dot"></span>${esc(user.name)} ▾</button><button id="export-pdf" title="Gerar PDF da apresentação">Exportar PDF</button><button id="present" class="primary">${state.mode==='presenting'?'Assistir apresentação':'Apresentar ▾'}</button></header><div class="workspace"><aside class="sidebar" id="sidebar"></aside><main class="main"><div class="contextbar"><span id="context-title"></span><button id="preview-only">Visualizar</button></div>${state.mode==='presenting'?'<div class="lock-banner">Apresentação oficial em andamento. Edição bloqueada para todos.</div>':''}<div class="preview-wrap"><div class="preview-inner" id="preview"></div></div><div class="preview-bottom" id="preview-bottom"></div></main><aside class="inspector" id="inspector"></aside></div>`;
 renderSidebar();renderPreview();renderInspector();
 $('#profile').onclick=()=>guard(async()=>{await flush();await request('logout',{});await loginScreen();});
 $('#preview-only').onclick=()=>guard(async()=>{await flush();openPresentation(state,false,selection);});
 $('#export-pdf').onclick=()=>guard(async()=>{await flush();exportDialog();});
 $('#present').onclick=()=>guard(async()=>{await flush();if(state.mode==='presenting')return openPresentation(await request('official'),true);if(!isAdmin())return openPresentation(state,false);startDialog();});
 if(isAdmin()){$('#summary').onclick=()=>guard(async()=>{await flush();await reload();summaryDialog();});$('#admin-menu').onclick=()=>guard(async()=>{await flush();adminDialog();});}
 if($('#own-menu'))$('#own-menu').onclick=()=>guard(async()=>{await flush();ownDialog();});
 $('#save-status').onclick=()=>{if(saveError?.status===409)conflictDialog();else guard(()=>flush());};
 if(saveError)status('Não salvo — clique para recuperar',true);else savedLabel();
}
function thumb(item,label,owned=false,excluded=false,draggable=false){
 const key=JSON.stringify(item),selected=selection.kind===item.kind&&(item.kind==='slide'?selection.id===item.id&&(selection.part||0)===(item.part||0):item.kind==='divider'?selection.section===item.section:item.kind==='pdf'?selection.section===item.section&&selection.page===item.page:true);
 return `<div class="thumb-row ${owned?'owned':''} ${selected?'selected':''} ${excluded?'excluded':''}" data-select="${esc(key)}" ${draggable?'draggable="true"':''} ${item.id?`data-slide="${item.id}"`:''}><div class="stage-box"><div class="stage">${renderSlide(state,item)}</div></div><div class="thumb-caption"><span class="caption">${esc(label)}</span>${excluded?'<span title="Não incluir">⊘</span>':''}${item.id&&state.slides[item.id]?.ata_review?.length?'<span class="review-mark" title="Conferir referências da ata">⚠</span>':''}${!owned?lock:''}</div></div>`;
}
function renderSidebar(){
 if(!$('#sidebar'))return;const scroll=$('#sidebar').scrollTop;
 $('#sidebar').innerHTML=`<div class="side-head"><span>ESTRUTURA</span><span>${state.sections.length} seções</span></div><label class="check"><input id="only-mine" type="checkbox" ${onlyMine?'checked':''}>Somente minhas lâminas</label>${thumb({kind:'cover'},'Capa',isAdmin())}${thumb({kind:'agenda'},'Sumário',isAdmin())}${state.sections.filter(sec=>!onlyMine||sec.slides.some(id=>state.slides[id].owners.includes(user.id))).map((sec,index)=>`<section class="section" data-section="${sec.id}"><div class="section-head" ${isAdmin()&&state.mode==='editing'?'draggable="true"':''} data-head="${sec.id}">${isAdmin()?'<span class="handle" title="Arrastar seção inteira">⠿</span>':''}<span>${collapsed.has(sec.id)?'▸':'▾'}</span><span class="section-name">${String(index+1).padStart(2,'0')} ${esc(sec.name)}</span>${isAdmin()?`<button data-section-menu="${sec.id}" title="Mover ou renomear">⋯</button>`:''}</div>${collapsed.has(sec.id)?'':`<div class="section-body">${sec.slides.filter(id=>!onlyMine||state.slides[id].owners.includes(user.id)).map(id=>{const s=state.slides[id];return thumb({kind:'slide',id,part:0},s.title,canEdit(user,s),s.excluded,allowed(s))+(s.layout==='pdf'&&s.content.pdf?`<details class="pdf-group"><summary>PDF · ${s.content.pdf.pages.length} páginas</summary>${s.content.pdf.pages.map((p,i)=>thumb({kind:'slide',id,part:i},'Página '+(i+1),canEdit(user,s),s.excluded)).join('')}</details>`:'');}).join('')}${state.mode==='editing'&&(isAdmin()||sec.slides.some(id=>canEdit(user,state.slides[id])))?`<button class="add-slide" data-add="${sec.id}">+ Adicionar lâmina</button>`:''}</div>`}</section>`).join('')}${thumb({kind:'end'},'Fim',isAdmin())}`;
 $('#only-mine').onchange=e=>{onlyMine=e.target.checked;renderSidebar();};$('#sidebar').scrollTop=scroll;fitStages($('#sidebar'));
 $('#sidebar').querySelectorAll('[data-select]').forEach(e=>{
  e.onclick=()=>guard(async()=>{await flush();selection=JSON.parse(e.dataset.select);activeField=null;formInvalid=false;renderSidebar();renderPreview();renderInspector();});
  if(e.draggable){e.ondragstart=event=>{drag={type:'slide',id:e.dataset.slide,section:state.slides[e.dataset.slide].section_id};event.dataTransfer.effectAllowed='move';event.stopPropagation();};e.ondragover=event=>{if(drag?.type==='slide'&&drag.section===state.slides[e.dataset.slide].section_id)event.preventDefault();};e.ondrop=event=>{event.preventDefault();event.stopPropagation();guard(async()=>{await flush();if(drag?.type!=='slide')return;const sec=state.sections.find(s=>s.id===drag.section);if(!sec.slides.includes(e.dataset.slide))return;const ids=sec.slides.filter(id=>id!==drag.id);ids.splice(ids.indexOf(e.dataset.slide),0,drag.id);await action('reorder_slides',{section:sec.id,ids});await reload();});};}
 });
 $('#sidebar').querySelectorAll('[data-head]').forEach(e=>{
  e.onclick=event=>{if(event.target.closest('button'))return;const id=e.dataset.head;collapsed.has(id)?collapsed.delete(id):collapsed.add(id);renderSidebar();};
  e.ondragstart=event=>{drag={type:'section',id:e.dataset.head};event.dataTransfer.effectAllowed='move';};
 });
 $('#sidebar').querySelectorAll('[data-section]').forEach(e=>{
  e.ondragover=event=>{if(drag?.type==='section'&&isAdmin()){event.preventDefault();e.classList.add('drag-over');}};e.ondragleave=()=>e.classList.remove('drag-over');
  e.ondrop=event=>{e.classList.remove('drag-over');if(drag?.type!=='section')return;event.preventDefault();guard(async()=>{await flush();const ids=state.sections.map(s=>s.id).filter(id=>id!==drag.id);ids.splice(ids.indexOf(e.dataset.section),0,drag.id);await action('reorder_sections',{ids});await reload();});};
 });
 $('#sidebar').querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>guard(async()=>{await flush();addDialog(b.dataset.add);}));
 $('#sidebar').querySelectorAll('[data-section-menu]').forEach(b=>b.onclick=()=>guard(async()=>{await flush();sectionDialog(b.dataset.sectionMenu);}));

}
function renderPreview(){
 const s=selection.kind==='slide'?state.slides[selection.id]:null;
 if(s)selection.part=Math.min(selection.part||0,parts(s).length-1);
 $('#context-title').textContent=s?s.title:selection.kind==='cover'?'Capa':selection.kind==='pdf'?'Apresentação externa':selection.kind==='divider'?'Divisória de seção':selection.kind==='end'?'Slide final':'Sumário automático';
 $('#preview').innerHTML=`<div class="stage-box"><div class="stage">${renderSlide(state,selection,{editing:s&&allowed(s)})}</div></div>`;fitStages($('#preview'));
 $('#preview').querySelectorAll('[data-field]').forEach(e=>{const open=()=>{activeField=e.dataset.field;renderInspector();};e.onclick=open;e.onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();open();}};});
 const total=s?parts(s).length:1;
 $('#preview-bottom').innerHTML=total>1?`<button id="part-prev" ${!selection.part?'disabled':''}>←</button><span>Parte ${(selection.part||0)+1} de ${total} • divisão automática</span><button id="part-next" ${selection.part===total-1?'disabled':''}>→</button>`:`<span>${s?(allowed(s)?'Clique no conteúdo da lâmina para editar':'Somente leitura'):'Template padronizado • 16:9'}</span>`;
 if(total>1){$('#part-prev').onclick=()=>{selection.part--;renderPreview();};$('#part-next').onclick=()=>{selection.part++;renderPreview();};}
}
function renderInspector(){
 const panel=$('#inspector'),s=selection.kind==='slide'?state.slides[selection.id]:null;
 if(!s){panel.innerHTML='<h2>Template da apresentação</h2><p class="hint">Capa com data e tipo definidos ao apresentar. O sumário acompanha a ordem das seções e reaparece com o destaque da seção atual.</p>';return;}
 const editable=allowed(s);
 if(!activeField||!editable){
  panel.innerHTML=`<h2>${esc(s.title)}</h2><p class="hint">${editable?'Clique no conteúdo da lâmina para abrir a edição.':'Somente leitura. Edição disponível aos responsáveis fora do modo de apresentação.'}</p><div class="info"><strong>Responsáveis</strong><br>${esc(ownerNames(s,state))}<br>${esc(stamp(s.updated_at))}</div>`;
  if(editable){panel.innerHTML+='<button id="open-editor" class="primary">Editar conteúdo</button>';$('#open-editor').onclick=()=>{activeField='content';renderInspector();};}renderSlideActions(panel,s,editable);return;
 }
 const c=s.content,hasTable=['ata','table','table-kpi','table-bullets','works','events','visits-clients'].includes(s.layout),hasBullets=['visits','table-bullets'].includes(s.layout),hasImage=['image','visits','visits-clients'].includes(s.layout),hasPhotos=['gallery','events'].includes(s.layout);
 const field=(key,label,type='text')=>`<label>${label}</label><input data-value="${key}" type="${type}" ${type==='number'?'min="0" step="1"':''} value="${esc(c[key])}">`;
 const rowsField=(key,label)=>`<label>${label}</label><textarea data-matrix="${key}" spellcheck="false" placeholder="Cole as células do Excel, incluindo o cabeçalho">${esc(toTSV(c[key]))}</textarea>`;
 panel.innerHTML=`<h2>Editar conteúdo</h2><label>Título completo</label><input id="slide-title" maxlength="180" value="${esc(s.title)}">
 ${s.generic?`<div class="generic-bar"><span>Lâmina adicionada</span><button id="delete-top" class="danger" type="button">Excluir lâmina</button></div><label>Modelo da lâmina</label><select id="slide-layout">${LAYOUT_OPTIONS.map(([v,n])=>`<option value="${v}" ${v===s.layout?'selected':''}>${n}</option>`).join('')}</select><small>O conteúdo já preenchido é mantido quando o novo modelo usa os mesmos campos.</small>`:''}
 ${s.layout==='placeholder'?'<p class="hint">Modelo pendente de definição. O espaço permanece reservado.</p>':''}
 ${s.layout==='pdf'?'<button id="dds-upload" class="primary">↑ Inserir / substituir PDF DDS</button><div id="dds-pages"></div>':''}
 ${s.layout==='visits'?field('visits_agencies','Visitas a agências','number')+field('visits_partners','Visitas a credenciados','number'):''}
 ${s.layout==='charts'?`<p class="hint">Até 4 gráficos. Cole em cada um três colunas: <strong>Mês | Realizado | Meta</strong> (até 12 meses). Barra = realizado; traço = meta.</p><div id="charts-editor">${(c.charts||[]).map((ch,i)=>`<div class="chart-editor"><label>Gráfico ${i+1} — título</label><input data-chart-title="${i}" maxlength="100" value="${esc(ch.title)}"><label>Mês | Realizado | Meta</label><textarea data-chart-rows="${i}" spellcheck="false" placeholder="Cole as células do Excel, incluindo o cabeçalho">${esc(toTSV(ch.rows))}</textarea><button type="button" data-chart-del="${i}">Remover gráfico</button></div>`).join('')}</div>${(c.charts||[]).length<4?'<button id="chart-add" type="button">+ Adicionar gráfico</button>':''}<label class="check"><input type="checkbox" id="proj-last" ${c.projection_last?'checked':''}>Último mês é projeção (barra amarela)</label><small>Uma linha chamada Acumulado (ou Acum, Acc, Acu) fica azul, e a barra anterior vira a projeção.</small>`:''}
 ${s.layout==='works'?rowsField('chart_without','Sem obras — Mês | Realizado | Meta')+rowsField('chart_with','Com obras — Mês | Realizado | Meta')+`<label class="check"><input type="checkbox" id="proj-last" ${c.projection_last?'checked':''}>Último mês do gráfico é projeção (barra amarela)</label><small>Uma linha chamada Acumulado (ou Acum, Acc, Acu) fica azul, e a barra anterior vira a projeção.</small>`:''}
 ${hasTable?rowsField('rows',s.layout==='ata'?'ATA — O quê? | Como? | Quem? | Prazo | Status':s.layout==='visits-clients'?'Carteira | Jan … | Total | Meta (última linha: TOTAL)':'Tabela com cabeçalho')+'<small>Ctrl + V do Excel. Divisão automática em páginas.</small>':''}
 ${hasTable&&s.layout!=='ata'?`<label>Tamanho da fonte da tabela <span id="font-value"></span></label><div class="font-control"><input id="table-font" type="range" min="8" max="32" step="1"><button id="font-auto" type="button">Automático</button></div><small id="font-note"></small>`:''}
 ${s.layout==='visits-clients'?'<p class="hint">O gráfico “QTD VISITAS MÊS VIGENTE” é gerado da tabela: usa a coluna do último mês antes de “Total”, uma barra por carteira (a linha TOTAL fica de fora). A imagem à direita é o informe oficial.</p>':''}
 ${s.layout==='ata'?'<p class="hint"><strong>Preencha a ata primeiro</strong>, antes de referenciá-la nas outras lâminas. Os códigos (ATA-001, ATA-002…) são gerados na ordem das linhas; um item que já existe mantém o código e, ao apagar a ata inteira, a numeração recomeça em ATA-001. Se a ata mudar depois, cada responsável vê um aviso ⚠ para conferir as próprias referências.</p><button id="ata-renumber" type="button">Renumerar a partir de ATA-001</button>':''}
 ${s.layout==='table-kpi'?field('resolved','Resolvidos desde a última reunião','number'):''}
 ${hasBullets?'<label>Destaques</label><div id="bullet-inputs"></div><button id="add-bullet">+ Adicionar destaque</button>':''}
 ${hasImage?'<label>Imagem</label><input id="image-file" type="file" accept="image/*"><button id="remove-image">Remover imagem</button>':''}
 ${hasPhotos?'<label>Adicionar imagem</label><input id="photo-caption" maxlength="100" placeholder="Cidade / legenda (opcional)"><input id="photo-file" type="file" accept="image/*"><div id="photo-list"></div>':''}
 ${s.layout==='text'?'<label>Texto</label><textarea id="slide-text" maxlength="12000">'+esc(c.text)+'</textarea>':''}<p id="form-error" class="error-text"></p>`;
 const change=()=>{s.ready=false;queue(s,{content:s.content,ready:false});renderPreview();};
 const syncFont=()=>{const slider=$('#table-font');if(!slider)return;const m=tableMetrics(s);slider.min=8;slider.max=Math.max(8,m.fitMax);slider.value=m.font;$('#font-value').textContent=m.font+' px'+(m.auto?' · automático':'');$('#font-note').textContent=m.limited?'Tamanho limitado ao máximo que cabe sem quebrar palavras.':m.pages>1?'Neste tamanho a tabela ocupa '+m.pages+' lâminas.':'Palavras nunca são quebradas no meio.';};
 if($('#delete-top'))$('#delete-top').onclick=()=>$('#delete-slide').click();
 if($('#slide-layout'))$('#slide-layout').onchange=e=>guard(async()=>{await flush();try{await action('set_layout',{id:s.id,layout:e.target.value,revision:s.revision});}catch(err){e.target.value=s.layout;throw err;}activeField='content';await reload();renderInspector();});
 if(s.layout==='charts'){
  c.charts=c.charts||[];
  panel.querySelectorAll('[data-chart-title]').forEach(el=>el.oninput=()=>{c.charts[+el.dataset.chartTitle].title=el.value;change();});
  panel.querySelectorAll('[data-chart-rows]').forEach(el=>el.oninput=()=>{try{const rows=parseTSV(el.value);if(rows.length&&(rows[0].length!==3||rows.length>13))throw Error('Use 3 colunas (Mês | Realizado | Meta) e até 12 meses.');valid(el);c.charts[+el.dataset.chartRows].rows=rows;change();}catch(e){error(e,el);}});
  panel.querySelectorAll('[data-chart-del]').forEach(b=>b.onclick=()=>{c.charts.splice(+b.dataset.chartDel,1);change();renderInspector();});
  if($('#chart-add'))$('#chart-add').onclick=()=>{c.charts.push({title:'',rows:[]});change();renderInspector();};
 }
 if($('#proj-last'))$('#proj-last').onchange=e=>{c.projection_last=e.target.checked;change();};
 if($('#table-font')){syncFont();$('#table-font').oninput=e=>{c.font_size=+e.target.value;change();syncFont();};$('#font-auto').onclick=()=>{c.font_size=0;change();syncFont();};}
 if($('#ata-renumber'))$('#ata-renumber').onclick=()=>guard(async()=>{await flush();confirmDialog('Renumerar códigos da ata?','Os itens passam a ser ATA-001, ATA-002… na ordem atual das linhas. As referências já feitas nas outras lâminas acompanham os itens.',async()=>{await action('ata_renumber',{revision:s.revision});await reload();renderInspector();});});
 const invalid=new Map();
 const error=(e,key)=>{invalid.set(key,e.message);formInvalid=true;status('Dados inválidos — não salvo',true);$('#form-error').textContent=[...invalid.values()].join(' ');};
 const valid=key=>{invalid.delete(key);formInvalid=invalid.size>0;$('#form-error').textContent=[...invalid.values()].join(' ');};
 $('#slide-title').oninput=e=>{if(!e.target.value.trim())return error(Error('Preencha o título.'),'title');valid('title');s.title=e.target.value;queue(s,{title:s.title});renderPreview();};
 panel.querySelectorAll('[data-value]').forEach(el=>el.oninput=()=>{if(el.type==='number'&&el.value!==''&&(!Number.isInteger(+el.value)||+el.value<0))return error(Error('Use quantidade inteira não negativa.'),el);valid(el);c[el.dataset.value]=el.value;change();});
 panel.querySelectorAll('[data-matrix]').forEach(el=>{el.onpaste=()=>{el._pasted=true;};el.oninput=()=>{try{let rows=parseTSV(el.value);const key=el.dataset.matrix,max=key==='rows'?s.limits.max_columns:3;if(key==='rows'&&s.layout!=='ata'&&el._pasted){el._pasted=false;const cleaned=cleanTable(rows);if(cleaned.removed.length){rows=cleaned.rows;el.value=toTSV(rows);toast('Linha de título ignorada: “'+cleaned.removed.map(r=>r.filter(Boolean).join(' ')).join(' / ')+'”. A tabela começa no cabeçalho “'+rows[0].filter(Boolean).slice(0,3).join(', ')+'…”.');}}if(rows[0]?.length>max||rows.length>1001)throw Error('Tabela excede os limites do modelo.');if(key==='rows')validateRows({...s,content:{...c,rows}});else if(rows.length&&(rows[0].length!==3||rows.length>13))throw Error('Use 3 colunas e até 12 meses.');valid(el);c[key]=rows;change();syncFont();}catch(e){error(e,el);}};});
 if(hasBullets){renderBulletInputs(s,change);$('#add-bullet').onclick=()=>{if(c.bullets.length>=6)return;c.bullets.push('');change();renderBulletInputs(s,change);};}
 if($('#slide-text'))$('#slide-text').oninput=e=>{c.text=e.target.value;change();};
 const upload=async(file,target,caption='')=>{await flush();status('Enviando e comprimindo…');const result=await request('upload/image',file,{'X-Slide-Id':s.id,'X-Revision':String(s.revision),'X-Target':target,'X-Caption':encodeURIComponent(caption)});Object.assign(s,result);renderPreview();renderSidebar();renderInspector();savedLabel();};
 if(hasImage){$('#image-file').onchange=e=>guard(()=>e.target.files[0]&&upload(e.target.files[0],'image'));$('#remove-image').onclick=()=>{c.image=null;change();};}
 if(hasPhotos){
  $('#photo-file').onchange=e=>guard(async()=>{const file=e.target.files[0],caption=$('#photo-caption').value.trim();if(!file)return;await upload(file,'photos',caption);});
  $('#photo-list').innerHTML=c.photos.map((p,i)=>`<div class="photo-editor"><img src="${esc(p.url)}"><input data-caption="${i}" maxlength="100" value="${esc(p.caption)}" placeholder="Cidade / legenda (opcional)"><button data-photo-up="${i}" ${i===0?'disabled':''}>↑</button><button data-photo-delete="${i}">×</button></div>`).join('');
  panel.querySelectorAll('[data-caption]').forEach(el=>el.oninput=()=>{valid(el);c.photos[+el.dataset.caption].caption=el.value;change();});
  panel.querySelectorAll('[data-photo-delete]').forEach(el=>el.onclick=()=>{c.photos.splice(+el.dataset.photoDelete,1);change();renderInspector();});
  panel.querySelectorAll('[data-photo-up]').forEach(el=>el.onclick=()=>{const i=+el.dataset.photoUp;[c.photos[i-1],c.photos[i]]=[c.photos[i],c.photos[i-1]];change();renderInspector();});
 }
 if(s.layout==='pdf'){
  $('#dds-upload').onclick=()=>guard(async()=>{await flush();pdfDialog();});
  $('#dds-pages').innerHTML=c.pdf?`<p>${esc(c.pdf.name)} · ${c.pdf.pages.length} páginas</p><button id="remove-pdf">Excluir grupo</button>${c.pdf.pages.map((p,i)=>`<p>Página ${i+1} <button data-delete-page="${p.id}">Excluir</button></p>`).join('')}`:'';
  const remove=page=>guard(async()=>{await flush();confirmDialog('Excluir PDF / página?','A remoção afeta esta reunião.',async()=>{await action('pdf_remove',{revision:s.revision,page});await reload();});});
  if($('#remove-pdf'))$('#remove-pdf').onclick=()=>remove(null);panel.querySelectorAll('[data-delete-page]').forEach(b=>b.onclick=()=>remove(b.dataset.deletePage));
 }
 renderSlideActions(panel,s,true);
}
function renderBulletInputs(s,change){
 $('#bullet-inputs').innerHTML=s.content.bullets.map((value,i)=>`<div class="bullet-input"><input data-bullet="${i}" maxlength="${(s.limits.max_bullet_chars||180)}" placeholder="Destaque ${i+1}" value="${esc(value)}"><button data-remove-bullet="${i}" title="Remover destaque">×</button></div>`).join('');
 $('#bullet-inputs').querySelectorAll('[data-bullet]').forEach(input=>input.oninput=()=>{s.content.bullets[+input.dataset.bullet]=input.value;change();});
 $('#bullet-inputs').querySelectorAll('[data-remove-bullet]').forEach(b=>b.onclick=()=>{s.content.bullets.splice(+b.dataset.removeBullet,1);change();renderBulletInputs(s,change);});
 $('#add-bullet').disabled=s.content.bullets.length>=(s.limits.max_bullets||6);
}
function renderSlideActions(panel,s,editable){
 if(!editable)return;
 panel.insertAdjacentHTML('beforeend',`${s.ata_review?.length?`<div class="review-warning"><strong>⚠ Conferir referências da ata</strong><br>A ata foi alterada e estas referências não correspondem mais ao mesmo item:<br>${s.ata_review.map(r=>esc(r.code+(r.label?' · '+r.label:''))).join('<br>')}<br><button id="review-ata" type="button">Conferir agora</button></div>`:''}<label class="check"><input type="checkbox" id="exclude-slide" ${s.excluded?'checked':''}>Não incluir na apresentação</label><button id="ata-links">Referenciar ata</button><div class="actions"><button class="primary" id="ready-slide">${s.ready?'Desmarcar pronto':'Marcar como pronto'}</button><button id="reuse-slide" ${!hasPrevious?'disabled':''}>Reaproveitar anterior</button><button id="reset-slide">Resetar lâmina</button><button id="restore-own" ${!state.restore_available?'disabled':''}>Restaurar última versão</button>${s.generic?'<button id="delete-slide" class="danger">Excluir lâmina</button>':''}</div><span class="field-note">“Pronto” é uma marcação manual nesta versão de teste.</span>`);
 $('#ata-links').onclick=()=>guard(async()=>{await flush();ataDialog(s);});
 if($('#review-ata'))$('#review-ata').onclick=()=>guard(async()=>{await flush();ataDialog(s);});
 $('#exclude-slide').onchange=e=>{s.excluded=e.target.checked;queue(s,{excluded:s.excluded});renderPreview();};
 $('#ready-slide').onclick=()=>guard(async()=>{await flush();s.ready=!s.ready;queue(s,{ready:s.ready});await flush();renderInspector();renderPreview();});
 $('#reuse-slide').onclick=()=>guard(async()=>{await flush();confirmDialog('Reaproveitar esta lâmina?','Substitui o conteúdo pelo correspondente da apresentação anterior e guarda uma cópia para restauração.',async()=>{await action('reuse',{id:s.id});await reload();});});
 $('#reset-slide').onclick=()=>guard(async()=>{await flush();confirmDialog('Resetar esta lâmina?','Restaura o conteúdo definido no arquivo do template. Uma cópia do conteúdo atual será preservada.',async()=>{await action('reset',{id:s.id});activeField=null;await reload();});});
 $('#restore-own').onclick=()=>guard(async()=>{await flush();await action('restore',{});await reload();});
 if($('#delete-slide'))$('#delete-slide').onclick=()=>guard(async()=>{await flush();confirmDialog('Excluir lâmina adicional?','A lâmina será removida da estrutura atual.',async()=>{await action('delete',{id:s.id});selection={kind:'agenda'};activeField=null;await reload();});});
}
function dialog(html,setup){const d=$('#dialog');d.innerHTML=html;d.showModal();d.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>d.close());setup?.(d);}
function confirmDialog(title,message,fn){dialog(`<h2>${esc(title)}</h2><p>${esc(message)}</p><p class="error-text" id="dialog-error"></p><div class="dialog-actions"><button data-close>Cancelar</button><button class="primary" id="confirm">Confirmar</button></div>`,()=>{$('#confirm').onclick=async()=>{const button=$('#confirm');button.disabled=true;try{await fn();$('#dialog').close();toast('Concluído.');}catch(e){$('#dialog-error').textContent=e.message;button.disabled=false;}};});}
function startDialog(){
 dialog('<h2>Iniciar apresentação oficial</h2><p>A edição será bloqueada para todos até um administrador encerrar. A data será a de hoje.</p><label>Tipo de reunião</label><select id="event-type">'+state.presentation_types.map(t=>'<option value="'+t.id+'">'+esc(t.name)+'</option>').join('')+'</select><div class="dialog-actions"><button data-close>Cancelar</button><button class="primary" id="start-official">Iniciar apresentação</button></div>',()=>{$('#start-official').onclick=()=>guard(async()=>{await action('start',{type:$('#event-type').value});$('#dialog').close();await reload();openPresentation(await request('official'),true);});});
}
function summaryDialog(typeId=state.event?.type||state.settings.default_type){
 const rows=Object.values(state.slides),omitted=s=>s.excluded||s.included[typeId]===false;
 dialog(`<h2>Resumo da apresentação</h2><select id="summary-type">${state.presentation_types.map(t=>`<option value="${t.id}" ${t.id===typeId?'selected':''}>${esc(t.name)}</option>`).join('')}</select><p class="muted-text">Pronto = marcado manualmente. Lâminas omitidas não contam como pendência.</p><table class="summary-table"><thead><tr><th>Responsável</th><th>Prontas</th><th>Pendentes</th><th>Omitidas</th></tr></thead><tbody>${state.users.filter(u=>rows.some(s=>s.owners.includes(u.id))).map(u=>{const own=rows.filter(s=>s.owners.includes(u.id));return`<tr><td>${esc(u.name)}</td><td>${own.filter(s=>s.ready&&!omitted(s)).length}</td><td>${own.filter(s=>!s.ready&&!omitted(s)).length}</td><td>${own.filter(s=>omitted(s)).length}</td></tr>`;}).join('')}</tbody></table><h3>Lâminas e atualizações</h3><table class="summary-table"><thead><tr><th>Lâmina</th><th>Responsáveis</th><th>Status</th><th>Atualização</th></tr></thead><tbody>${state.sections.flatMap(sec=>sec.slides.map(id=>state.slides[id])).map(s=>`<tr><td>${esc(s.title)}</td><td>${esc(ownerNames(s,state))}</td><td><span class="pill ${s.ready?'ready':''}">${omitted(s)?'Não incluir':s.ready?'Pronto':'Pendente'}</span>${s.ata_review?.length?' <span class="pill" title="Referências da ata a conferir">⚠ conferir ata</span>':''}</td><td>${esc(stamp(s.updated_at))}${s.updated_by?' • '+esc(s.updated_by):''}</td></tr>`).join('')}</tbody></table><details style="margin-top:20px"><summary>Histórico recente</summary>${state.history.slice(-30).reverse().map(h=>`<p><small>${esc(stamp(h.at))} • ${esc(h.user)} • ${esc(h.action)}</small></p>`).join('')}</details><div class="dialog-actions"><button data-close>Fechar</button></div>`,()=>{$('#summary-type').onchange=e=>{const value=e.target.value;$('#dialog').close();summaryDialog(value);};});
}
function ownDialog(){
 dialog(`<h2>Minhas lâminas</h2><p>Estas ações afetam todas as lâminas nas quais você está indicado como responsável, inclusive as compartilhadas.</p><div style="display:grid;gap:12px"><button id="own-reuse" ${!hasPrevious?'disabled':''}>Reaproveitar minha parte da reunião anterior</button><button id="own-reset">Resetar minha parte para o template</button><button id="own-restore" ${!state.restore_available?'disabled':''}>Restaurar minha última versão</button></div><div class="dialog-actions"><button data-close>Fechar</button></div>`,()=>{
  for(const [id,name] of [['own-reuse','reuse'],['own-reset','reset'],['own-restore','restore']])$('#'+id).onclick=()=>{$('#dialog').close();confirmDialog('Aplicar às suas lâminas?','O conteúdo compartilhado também será atualizado para o outro responsável.',async()=>{await action(name,{scope:'own'});activeField=null;await reload();});};
 });
}
function adminDialog(){
 const locked=state.mode==='presenting';
 dialog(`<h2>Gerenciar apresentação</h2><p class="muted-text">Os arquivos em templates definem a estrutura inicial. O reset geral relê esses arquivos.</p><div style="display:grid;gap:12px">${locked?'<button id="unlock">Encerrar apresentação e liberar edição</button>':`<button id="structure">Estrutura, responsáveis e tipos</button><button id="new-cycle">Nova reunião • guardar a última e limpar conteúdo</button><button id="reset-all">Resetar tudo para o template</button><button id="restore-all" ${!state.restore_all_available?'disabled':''}>Restaurar versão anterior ao reset / nova reunião</button><button id="reuse-own" ${!hasPrevious?'disabled':''}>Reaproveitar minhas lâminas</button>`}</div><div class="dialog-actions"><button data-close>Fechar</button></div>`,()=>{
  if(locked){$('#unlock').onclick=()=>guard(async()=>{await action('stop');$('#dialog').close();await reload();});return;}
  $('#structure').onclick=()=>{ $('#dialog').close();structureDialog();};
  $('#new-cycle').onclick=()=>{$('#dialog').close();confirmDialog('Iniciar uma nova reunião?','Preserva a última apresentação oficial (ou a atual, caso ainda não tenha apresentado), mantém ordem e responsáveis, limpa os conteúdos e PDFs. Cada editor poderá reaproveitar suas lâminas.',async()=>{await action('new_meeting');selection={kind:'cover'};activeField=null;await reload();});};
  $('#reset-all').onclick=()=>{$('#dialog').close();confirmDialog('Resetar toda a apresentação?','Relê os arquivos do template: responsáveis, ordem, títulos e conteúdo. Guarda uma cópia do estado atual para restauração.',async()=>{await action('reset',{scope:'all'});selection={kind:'cover'};activeField=null;await reload();});};
  $('#restore-all').onclick=()=>guard(async()=>{await action('restore',{scope:'all'});$('#dialog').close();selection={kind:'cover'};activeField=null;await reload();});
  $('#reuse-own').onclick=()=>{$('#dialog').close();confirmDialog('Reaproveitar suas lâminas?','Serão substituídas as lâminas nas quais você está cadastrado como responsável.',async()=>{await action('reuse',{scope:'own'});await reload();});};
 });
}
const LAYOUT_OPTIONS=[['charts','Gráficos de barras (até 4)'],['text','Texto'],['image','Imagem'],['table','Tabela'],['table-bullets','Tabela + destaques'],['table-kpi','Tabela + card de resolvidos'],['works','Gráficos de obras + tabela'],['events','Tabela e imagens'],['gallery','Galeria'],['visits','Visitas (indicadores + imagem)'],['visits-clients','Visitas grandes clientes (gráfico + tabela + informe)']];
function addDialog(section){
 dialog(`<h2>Adicionar lâmina</h2><label>Modelo</label><select id="new-layout">${LAYOUT_OPTIONS.map(([v,n])=>`<option value="${v}">${n}</option>`).join('')}</select><div class="dialog-actions"><button data-close>Cancelar</button><button class="primary" id="create-slide">Adicionar</button></div>`,()=>{$('#create-slide').onclick=()=>guard(async()=>{const {result}=await action('add',{section,layout:$('#new-layout').value});$('#dialog').close();selection={kind:'slide',id:result.id,part:0};activeField=null;collapsed.delete(section);await reload();$('#sidebar').querySelector(`[data-slide="${result.id}"]`)?.scrollIntoView({block:'nearest'});});});
}
function sectionDialog(id){
 const sec=state.sections.find(s=>s.id===id),index=state.sections.indexOf(sec);
 dialog(`<h2>Organizar seção</h2><label>Nome</label><input id="section-name" value="${esc(sec.name)}" maxlength="100"><p class="hint">Arraste o cabeçalho da seção na barra lateral para mover todo o grupo.</p><div style="display:flex;gap:10px"><button id="move-up" ${index===0?'disabled':''}>↑ Subir seção</button><button id="move-down" ${index===state.sections.length-1?'disabled':''}>↓ Descer seção</button></div><div class="dialog-actions"><button data-close>Fechar</button><button class="primary" id="rename-section">Salvar nome</button></div>`,()=>{
  const move=delta=>guard(async()=>{const ids=state.sections.map(s=>s.id);[ids[index],ids[index+delta]]=[ids[index+delta],ids[index]];await action('reorder_sections',{ids});$('#dialog').close();await reload();});
  $('#move-up').onclick=()=>move(-1);$('#move-down').onclick=()=>move(1);
  $('#rename-section').onclick=()=>guard(async()=>{await action('rename_section',{id,name:$('#section-name').value});$('#dialog').close();await reload();});
 });
}
function pdfDialog(){
 dialog('<h2>Enviar PDF externo</h2><p>As páginas aparecerão agrupadas na lâmina DDS. Se já houver um PDF, o grupo inteiro será substituído.</p><input type="file" id="pdf-file" accept="application/pdf"><p class="muted-text">Até 50 MB e 100 páginas. Processamento local; aguarde o envio terminar.</p><p id="pdf-message"></p><div class="dialog-actions"><button data-close>Cancelar</button><button class="primary" id="upload-pdf">Enviar PDF</button></div>',()=>{$('#upload-pdf').onclick=async()=>{const file=$('#pdf-file').files[0];if(!file){$('#pdf-message').textContent='Selecione um PDF.';return;}const button=$('#upload-pdf');button.disabled=true;$('#pdf-message').textContent='Comprimindo e preparando páginas…';try{await request('upload/pdf',file,{'X-Slide-Id':'dds','X-Revision':String(state.slides.dds.revision),'X-File-Name':encodeURIComponent(file.name)});$('#dialog').close();await reload();toast('PDF pronto.');}catch(e){$('#pdf-message').textContent=e.message;button.disabled=false;}};});
}
function conflictDialog(){
 const backup=JSON.stringify([...pending.entries()],null,2);
 dialog(`<h2>Conflito de edição</h2><p>Outro acesso salvou esta lâmina. Copie seu conteúdo abaixo antes de recarregar a versão do servidor.</p><textarea id="conflict-copy" readonly style="width:100%;height:200px">${esc(backup)}</textarea><div class="dialog-actions"><button data-close>Voltar sem perder o rascunho</button><button id="conflict-download">Baixar rascunho</button><button id="conflict-reload">Recarregar versão salva</button></div>`,()=>{
  $('#conflict-download').onclick=()=>{const url=URL.createObjectURL(new Blob([backup],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='rascunho-conflito.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('#conflict-reload').onclick=()=>guard(async()=>{pending.clear();saveError=null;formInvalid=false;activeField=null;$('#dialog').close();await reload();});
 });
}
function openPresentation(snapshot,official=false,startItem=null){
 const deck=buildDeck(snapshot);let index=0;
 if(startItem){const at=deck.findIndex(d=>d.kind===startItem.kind&&(d.kind==='slide'?d.id===startItem.id&&(d.part||0)===(startItem.part||0):d.kind==='pdf'?d.section===startItem.section&&d.page===startItem.page:d.kind==='divider'?d.section===startItem.section:true));if(at>=0)index=at;}
 const overlay=document.createElement('div');overlay.className='presenter';document.body.appendChild(overlay);presenting=overlay;
 const draw=()=>{overlay.innerHTML=`<div class="stage-box"><div class="stage">${renderSlide(snapshot,deck[index])}</div></div><div class="presentation-controls"><button id="show-prev">←</button><span>${index+1} / ${deck.length}</span><button id="show-next">→</button><button id="exit-presentation">Sair da tela</button>${official&&isAdmin()?'<button id="end-official">Encerrar e liberar edição</button>':''}</div>`;fitStages(overlay);overlay.querySelector('#show-prev').onclick=()=>go(-1);overlay.querySelector('#show-next').onclick=()=>go(1);overlay.querySelector('#exit-presentation').onclick=close;if(overlay.querySelector('#end-official'))overlay.querySelector('#end-official').onclick=()=>guard(async()=>{await action('stop');close();await reload();});};
 const go=delta=>{index=Math.max(0,Math.min(deck.length-1,index+delta));draw();};
 function close(){document.removeEventListener('keydown',key);document.removeEventListener('fullscreenchange',full);overlay.remove();presenting=null;if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}
 const key=e=>{if(['ArrowRight',' ','PageDown'].includes(e.key)){e.preventDefault();go(1);}else if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();go(-1);}else if(e.key==='Home'){e.preventDefault();index=0;draw();}else if(e.key==='End'){e.preventDefault();index=deck.length-1;draw();}else if(e.key==='Escape')close();};
 const full=()=>{if(!document.fullscreenElement&&overlay.isConnected)close();};
 document.addEventListener('keydown',key);document.addEventListener('fullscreenchange',full);draw();overlay.requestFullscreen?.().catch(()=>{});
 overlay.addEventListener('click',e=>{if(e.target.closest('button'))return;const x=e.clientX/window.innerWidth;if(x<.13)go(-1);else if(x>.87)go(1);});
}
window.addEventListener('beforeunload',e=>{if(pending.size||inflight||formInvalid){e.preventDefault();e.returnValue='Há alterações não salvas.';}});
// Atualiza alterações de colegas quando não há campo sendo editado nem rascunho pendente.
setInterval(async()=>{
 if(!user||!$('#sidebar')||pending.size||inflight||saveError||formInvalid||$('#dialog').open||presenting)return;
 try{const result=await request('state');if(result.state.mode!==state.mode){state=result.state;user=result.user;activeField=null;renderApp();return;}
 if(!activeField&&result.state.generation!==state.generation){state=result.state;renderSidebar();renderPreview();renderInspector();}}
 catch{};
},6000);
try{await reload();}catch(e){if(e.status===401)await loginScreen();else{app.innerHTML=`<p class="loading">${isSupabase?'Não foi possível abrir. Confira static/config.js e o projeto no Supabase, depois recarregue.':'Não foi possível abrir. Verifique o terminal do servidor e recarregue.'}</p><p class="loading">${esc(e.message)}</p>`;toast(e.message);}}
function ataDialog(s){
 const rows=state.slides.ata.content.rows.slice(1),review=s.ata_review||[];
 dialog(`<h2>Referenciar itens da ata</h2><p>O código e o status do item aparecem discretamente no rodapé. Confira se cada item marcado é realmente o que esta lâmina trata.</p>${review.length?`<div class="review-warning"><strong>⚠ Referências que mudaram na ata</strong><br>${review.map(r=>esc(r.code+(r.label?' · '+r.label:''))).join('<br>')}<br>Marque abaixo o item correto, se ainda existir. Ao salvar, este aviso é removido.</div>`:''}${rows.length?rows.map(r=>`<label class="check"><input type="checkbox" data-ata="${esc(r[0])}" ${s.ata_refs.includes(r[0])?'checked':''}>${esc(r[0]+' · '+r[1]+' · '+r[2]+' · '+r[5])}</label>`).join(''):'<p>Preencha a ata primeiro.</p>'}<p class="error-text" id="ata-error"></p><div class="dialog-actions"><button data-close>Cancelar</button><button id="save-ata" class="primary">Salvar referências</button></div>`,()=>{$('#save-ata').onclick=()=>guard(async()=>{const refs=[...$('#dialog').querySelectorAll('[data-ata]:checked')].map(el=>el.dataset.ata);if(refs.length>6){$('#ata-error').textContent='Selecione no máximo 6 itens.';return;}s.ata_refs=refs;s.ata_review=[];queue(s,{ata_refs:refs});await flush();$('#dialog').close();renderSidebar();renderPreview();renderInspector();});});
}
function structureDialog(){
 const slides=state.sections.flatMap(sec=>sec.slides.map(id=>state.slides[id]));
 dialog(`<h2>Estrutura e inclusão por apresentação</h2><p>Altere os responsáveis e a inclusão de cada lâmina. Todas começam incluídas. A ordem é ajustada arrastando as seções e lâminas no editor.</p><table class="summary-table"><thead><tr><th>Lâmina</th><th>Responsáveis</th>${state.presentation_types.map(t=>`<th>${esc(t.name)}</th>`).join('')}</tr></thead><tbody>${slides.map(s=>`<tr><td>${esc(s.title)}</td><td><button data-owners="${s.id}">${esc(ownerNames(s,state))}</button></td>${state.presentation_types.map(t=>`<td><input type="checkbox" data-include="${s.id}" data-type="${t.id}" ${s.included[t.id]?'checked':''}></td>`).join('')}</tr>`).join('')}</tbody></table><div class="dialog-actions"><button id="export-structure">Baixar configuração atual</button><button data-close>Fechar</button></div>`,()=>{
  $('#dialog').querySelectorAll('[data-include]').forEach(el=>el.onchange=()=>guard(async()=>{const s=state.slides[el.dataset.include],included={...s.included,[el.dataset.type]:el.checked};el.disabled=true;try{const {result}=await action('patch',{id:s.id,revision:s.revision,patch:{included}});Object.assign(s,result);renderPreview();}catch(e){el.checked=!el.checked;throw e;}finally{el.disabled=false;}}));
  $('#dialog').querySelectorAll('[data-owners]').forEach(el=>el.onclick=()=>{const s=state.slides[el.dataset.owners];$('#dialog').close();dialog(`<h2>Responsáveis — ${esc(s.title)}</h2>${state.users.map(u=>`<label class="check"><input data-owner="${u.id}" type="checkbox" ${s.owners.includes(u.id)?'checked':''}>${esc(u.name)}</label>`).join('')}<div class="dialog-actions"><button data-close>Cancelar</button><button id="save-owners">Salvar</button></div>`,()=>{$('#save-owners').onclick=()=>guard(async()=>{const owners=[...$('#dialog').querySelectorAll('[data-owner]:checked')].map(el=>el.dataset.owner);await action('patch',{id:s.id,revision:s.revision,patch:{owners}});$('#dialog').close();await reload();structureDialog();});});});
  $('#export-structure').onclick=()=>guard(()=>exportStructure());
 });
}

function exportDialog(){
 dialog(`<h2>Exportar PDF</h2><p>Gera todas as lâminas em 16:9, uma por página, a partir do conteúdo atual. Na janela que abrir, escolha <strong>Salvar como PDF</strong> como destino, desative <strong>Cabeçalhos e rodapés</strong> e deixe as margens em <strong>Nenhuma</strong>.</p><label>Tipo de reunião</label><select id="export-type">${state.presentation_types.map(t=>`<option value="${t.id}" ${t.id===(state.event?.type||state.settings.default_type)?'selected':''}>${esc(t.name)}</option>`).join('')}</select><p class="error-text" id="export-error"></p><div class="dialog-actions"><button data-close>Cancelar</button><button class="primary" id="export-go">Gerar PDF</button></div>`,()=>{
  $('#export-go').onclick=()=>guard(async()=>{
   const button=$('#export-go');button.disabled=true;button.textContent='Preparando…';
   const snapshot=state.mode==='presenting'&&state.event?.type===$('#export-type').value?state:{...state,event:{type:$('#export-type').value,date:new Date().toLocaleDateString('sv-SE',{timeZone:'America/Sao_Paulo'})}};
   const root=document.createElement('div');root.id='print-root';
   root.innerHTML=buildDeck(snapshot).map(item=>`<div class="print-page">${renderSlide(snapshot,item)}</div>`).join('');document.body.appendChild(root);
   const images=[...root.querySelectorAll('img')];
   await Promise.all(images.map(i=>i.complete?null:new Promise(r=>{i.onload=i.onerror=r;})));
   await new Promise(r=>setTimeout(r,200));$('#dialog').close();document.body.classList.add('printing');
   const done=()=>{document.body.classList.remove('printing');root.remove();window.removeEventListener('afterprint',done);};
   window.addEventListener('afterprint',done);window.print();
  });
 });
}
