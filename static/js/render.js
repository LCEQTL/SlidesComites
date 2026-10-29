export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const stamp=s=>s?new Date(s).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Não atualizado';
export const ownerNames=(s,state)=>s.owners.map(id=>state.users.find(u=>u.id===id)?.name||id).join(' / ');
export const canEdit=(u,s)=>u.role==='admin'||s.owners.includes(u.id);
export const included=(state,s)=>!s.excluded&&s.included[state.event?.type||state.settings.default_type]!==false;
export const visibleSections=state=>state.sections.filter(sec=>sec.slides.some(id=>included(state,state.slides[id])));
export function parseTSV(text){
 if(!text.trim())return [];
 let rows=[],row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'&&(quoted||!cell)){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(!quoted&&(c==='\t'||c==='\n'||c==='\r')){row.push(cell);cell='';if(c!=='\t'){if(c==='\r'&&text[i+1]==='\n')i++;rows.push(row);row=[];}}
  else cell+=c;
 }
 if(quoted)throw Error('Há uma célula com aspas sem fechamento. Copie novamente do Excel.');
 if(cell||row.length){row.push(cell);rows.push(row);}
 while(rows.length&&rows.at(-1).every(c=>!c))rows.pop();
 const width=Math.max(0,...rows.map(r=>r.length));
 return rows.map(r=>[...r,...Array(width-r.length).fill('')]);
}
// Remove linhas de título coladas antes do cabeçalho (ex.: "MÊS DE OUTUBRO" + células vazias) e exige cabeçalho preenchido.
export function cleanTable(rows){
 const filled=r=>r.filter(v=>String(v).trim()).length,need=r=>Math.ceil(r.length/2),out=[...rows],removed=[];
 while(out.length>1&&filled(out[0])<need(out[0])&&filled(out[1])>filled(out[0]))removed.push(out.shift());
 if(out.length&&filled(out[0])<need(out[0]))throw Error('Cabeçalho incompleto: a primeira linha precisa ter título na maioria das colunas. Cole a tabela começando pela linha de cabeçalho.');
 return{rows:out,removed};
}
export function toTSV(rows){return(rows||[]).map(r=>r.map(c=>/[\t\n"]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c).join('\t')).join('\n');}
let measureContext;const lineCache=new Map();
function wrappedLines(text,width,font){
 const key=font+'|'+Math.round(width)+'|'+text;if(lineCache.has(key))return lineCache.get(key);
 if(typeof document!=='undefined'&&!measureContext)measureContext=document.createElement('canvas').getContext('2d');
 if(measureContext)measureContext.font=`bold ${font}px Arial`;
 const measure=t=>measureContext?measureContext.measureText(t).width:t.length*font*.7;
 let total=0;
 for(const line of String(text).split('\n')){let used=0,count=1;for(const word of line.split(/\s+/)){const w=measure(word),gap=used?measure(' '):0;if(used&&used+gap+w>width){count++;used=0;}if(w>width){for(const char of word){const cw=measure(char);if(used+cw>width){count++;used=0;}used+=cw;}}else used+=(used?gap:0)+w;}total+=count;}
 if(lineCache.size>10000)lineCache.clear();lineCache.set(key,total);return total;
}

// ---- Tabelas: nunca quebram palavra ao meio; fonte automática ou escolhida; largura total ----
const PAD_X=7,PAD_Y=5,LINE=1.28,SAFE_MIN=1.04,SAFE_WRAP=1.02,FONT_MIN=8,FONT_MAX=32,wordCache=new Map(),planCache=new Map();
function w100(text,bold){
 const key=(bold?'b':'n')+text;let v=wordCache.get(key);
 if(v===undefined){
  if(typeof document!=='undefined'&&!measureContext)measureContext=document.createElement('canvas').getContext('2d');
  if(measureContext){measureContext.font=`${bold?'bold ':''}100px Arial`;v=measureContext.measureText(text).width;}else v=text.length*(bold?58:54);
  if(wordCache.size>50000)wordCache.clear();wordCache.set(key,v);
 }
 return v;
}
const tw=(text,font,bold,safe=SAFE_WRAP)=>w100(text,bold)*font/100*safe;
const lineWords=cell=>String(cell??'').split('\n').map(l=>l.split(/\s+/).filter(Boolean));
function wrapCount(text,width,font,bold){
 const space=tw(' ',font,bold);let total=0;
 for(const words of lineWords(text)){let used=0,count=1;for(const w of words){const ww=tw(w,font,bold);if(used&&used+space+ww>width){count++;used=ww;}else used+=(used?space:0)+ww;}total+=count;}
 return total;
}
function columnInfo(rows,font){
 const n=rows[0].length,min=Array(n).fill(0),nat=Array(n).fill(0),pad=2*PAD_X+2,space=tw(' ',font,false,SAFE_MIN);
 rows.forEach((r,ri)=>{for(let i=0;i<n;i++){let mn=0,nt=0;for(const words of lineWords(r[i])){let line=0;words.forEach((w,k)=>{const ww=tw(w,font,ri===0,SAFE_MIN);mn=Math.max(mn,ww);line+=ww+(k?space:0);});nt=Math.max(nt,line);}min[i]=Math.max(min[i],mn+pad);nat[i]=Math.max(nat[i],nt+pad);}});
 return{min,nat};
}
function columnWidths(info,W,force=false){
 const sumMin=info.min.reduce((a,b)=>a+b,0);
 if(sumMin>W)return force?info.min.map(v=>v*W/sumMin):null;
 const want=info.nat.map((v,i)=>Math.max(0,v-info.min[i])),sumWant=want.reduce((a,b)=>a+b,0),extra=W-sumMin;
 if(sumWant<=extra){const spare=extra-sumWant,sumNat=info.nat.reduce((a,b)=>a+b,0);return info.nat.map(v=>v+spare*v/sumNat);}
 return info.min.map((v,i)=>v+extra*want[i]/sumWant);
}
const normText=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
function cellClass(v,ri,ci,last,opts){
 const out=[];
 if(ri>0){const n=normText(v);if(n.length<=30){if(/FORA (DO )?PRAZO/.test(n))out.push('cell-late');else if(n.includes('PROGRAMADA'))out.push('cell-planned');}}
 return out.length?` class="${out.join(' ')}"`:'';
}
function tableHtml(rows,widths,font,opts={}){
 const total=widths.reduce((a,b)=>a+b,0),last=rows[0].length-1;
 return `<table class="data-table fit-table ${opts.cls||''}" style="font-size:${font}px;line-height:${LINE}"><colgroup>${widths.map(v=>`<col style="width:${v/total*100}%">`).join('')}</colgroup><thead><tr>${rows[0].map((v,ci)=>`<th${cellClass(v,0,ci,last,opts)}>${esc(v)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((r,ri)=>`<tr>${r.map((v,ci)=>`<td${cellClass(v,ri+1,ci,last,opts)}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
// No navegador, a altura das linhas é medida de verdade num elemento oculto; sem navegador (testes), é estimada.
let measureHost;
function domHeights(rows,widths,font){
 if(typeof document==='undefined'||!document.body)return null;
 if(!measureHost||!measureHost.isConnected){measureHost=document.createElement('div');measureHost.setAttribute('aria-hidden','true');measureHost.style.cssText='position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;font-family:Arial,sans-serif';document.body.appendChild(measureHost);}
 measureHost.style.width=widths.reduce((a,b)=>a+b,0)+'px';measureHost.innerHTML=tableHtml(rows,widths,font);
 const heights=[...measureHost.querySelectorAll('tr')].map(r=>r.getBoundingClientRect().height);measureHost.innerHTML='';
 return heights.length===rows.length&&heights.every(h=>h>0)?heights:null;
}
function layoutAt(rows,font,W,force=false){
 const widths=columnWidths(columnInfo(rows,font),W,force);if(!widths)return null;
 const base=font*LINE+2*PAD_Y+1;
 return{widths,heights:domHeights(rows,widths,font)||rows.map((r,ri)=>Math.max(base,...r.map((v,i)=>wrapCount(v,widths[i]-2*PAD_X-2,font,ri===0)*font*LINE+2*PAD_Y+1)))};
}
function paginate(heights,first,rest){
 const pages=[];let page=[],used=0,limit=first;
 for(let i=1;i<heights.length;i++){if(page.length&&used+heights[0]+heights[i]>limit){pages.push(page);page=[];used=0;limit=rest;}page.push(i);used+=heights[i];}
 if(page.length||!pages.length)pages.push(page);return pages;
}
function fitMaxFont(rows,W){
 if(!columnWidths(columnInfo(rows,FONT_MIN),W))return 0;
 let lo=FONT_MIN,hi=FONT_MAX;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(columnWidths(columnInfo(rows,mid),W))lo=mid;else hi=mid-1;}
 return lo;
}
function tablePlan(rows,W,first,rest,requested=0){
 const key=JSON.stringify([rows,W,first,rest,requested]);if(planCache.has(key))return planCache.get(key);
 let fitMax=fitMaxFont(rows,W),forced=!fitMax,font;if(forced)fitMax=FONT_MIN;
 if(requested)font=Math.min(requested,fitMax);
 else{ // automático: maior fonte que cabe em 1 lâmina; senão, o menor número de lâminas com fonte ≥ 11
  font=0;let best=Infinity;
  for(let f=Math.min(24,fitMax);f>=Math.min(11,fitMax)&&!forced;f--){const n=paginate(layoutAt(rows,f,W).heights,first,rest).length;if(n<best){best=n;font=f;if(n===1)break;}}
  if(!font)font=Math.min(fitMax,14);
 }
 const L=layoutAt(rows,font,W,true),plan={font,fitMax,forced,auto:!requested,limited:!!requested&&requested>fitMax,widths:L.widths,heights:L.heights,pages:paginate(L.heights,first,rest)};
 if(planCache.size>300)planCache.clear();planCache.set(key,plan);return plan;
}
const TABLE_LAYOUTS=['table','table-kpi','table-bullets','works','events','visits-clients'];
const CHART_H=215;
const reserved=s=>s.layout==='table-bullets'?stripInfo(s.content.bullets).height:s.layout==='visits-clients'?CHART_H:0;
function tableDims(s){const photos=s.layout==='events'&&s.content.photos?.length;return{W:s.layout==='visits-clients'?700:photos?770:1200,avail:s.layout==='works'?250:s.layout==='table-kpi'?440:565};}
// Faixa de destaques acima da tabela (até 3 por linha).
function stripInfo(list,W=1200){
 const items=(list||[]).filter(Boolean),n=items.length;if(!n)return{cols:0,height:0};
 const cols=n<=3?n:n===4?2:3,gap=10,inner=(W-gap*(cols-1))/cols-28;let height=0;
 for(let i=0;i<n;i+=cols){height+=Math.max(...items.slice(i,i+cols).map(b=>wrapCount(b,inner,17,false)*17*1.3+16))+(i?gap:0);}
 return{cols,height:height+12};
}
export function tableMetrics(s){
 const rows=s.content.rows||[];if(!rows.length||!rows[0]?.length)return{font:16,fitMax:FONT_MAX,auto:true,limited:false,pages:1};
 const{W,avail}=tableDims(s),strip=reserved(s),plan=tablePlan(rows,W,avail-strip,avail,s.content.font_size||0);
 return{font:plan.font,fitMax:plan.fitMax,auto:plan.auto,limited:plan.limited,pages:plan.pages.length};
}
function geometry(s,rows=s.content.rows||[]){
 const half=s.layout==='table-bullets'||s.layout==='events'&&s.content.photos?.length;
 const width=half?770:1200,font=rows[0]?.length>9?16:rows[0]?.length>6?18:21;
 const n=rows[0]?.length||1,weights=Array.from({length:n},(_,i)=>Math.min(30,Math.max(8,...rows.map(r=>String(r[i]||'').length))));
 const widths=s.layout==='ata'?[85,170,400,185,145,215]:weights.map(v=>v/weights.reduce((a,b)=>a+b,0)*width);
 const height=r=>(s.layout==='ata'?12:0)+Math.max(font*1.35+20,...r.map((v,i)=>wrappedLines(v,Math.max(15,widths[i]-22),font)*font*1.35+20));
 return{font,widths,height,available:s.layout==='works'?250:s.layout==='table-kpi'?440:530};
}
export function validateRows(s){
 const rows=s.content.rows||[];if(!rows.length)return;
 if(s.layout==='ata'){const g=geometry(s);if(g.height(rows[0])>140||rows.slice(1).some(r=>g.height(r)+g.height(rows[0])>g.available))throw Error('Uma célula não cabe com leitura adequada. Resuma o texto ou divida a tabela.');return;}
 const{W,avail}=tableDims(s),plan=tablePlan(rows,W,avail,avail,s.content.font_size||0);
 if(plan.forced)throw Error('Há colunas ou palavras longas demais para a largura da lâmina. Reduza colunas ou abrevie os textos.');
 if(plan.heights[0]>140||plan.heights.slice(1).some(h=>h+plan.heights[0]>avail))throw Error('Uma célula não cabe com leitura adequada. Resuma o texto ou divida a tabela.');
}
function bulletParts(list,limit=520){const pages=[];let page=[],used=0;for(const text of (list||[]).filter(Boolean)){const h=Math.ceil(text.length/27)*25+28;if(page.length&&used+h>limit){pages.push(page);page=[];used=0;}page.push(text);used+=h;}if(page.length||!pages.length)pages.push(page);return pages;}
export function parts(s){
 const c=s.content;
 if(s.layout==='visits')return bulletParts(c.bullets,290).map(bullets=>({bullets}));
 if(s.layout==='pdf')return c.pdf?.pages.length?c.pdf.pages.map(page=>({pdf:page})):[{}];
 if(s.layout==='gallery')return c.photos?.length?Array.from({length:Math.ceil(c.photos.length/(s.photo_limit||4))},(_,i)=>({photos:c.photos.slice(i*(s.photo_limit||4),(i+1)*(s.photo_limit||4))})):[{photos:[]}];
 if(s.layout==='text'){
  const lines=[];for(const line of (c.text||'').split('\n')){let rest=line;while(rest.length>72){let cut=rest.lastIndexOf(' ',72);if(cut<25)cut=72;lines.push(rest.slice(0,cut));rest=rest.slice(cut).replace(/^ /,'');}lines.push(rest);}
  return Array.from({length:Math.max(1,Math.ceil(lines.length/11))},(_,i)=>({text:lines.slice(i*11,i*11+11).join('\n')}));
 }
 if(s.layout==='ata'){
  const rows=c.rows||[],g=geometry(s),out=[];let page=[],used=0;
  for(const r of rows.slice(1)){let h=g.height(r);if(page.length&&used+h>g.available-g.height(rows[0])){out.push({rows:[rows[0],...page]});page=[];used=0;}page.push(r);used+=h;}
  if(page.length||!out.length)out.push({rows:rows.length?[rows[0],...page]:[]});
  return out;
 }
 if(TABLE_LAYOUTS.includes(s.layout)){
  const rows=c.rows||[],{W,avail}=tableDims(s),list=s.layout==='table-bullets'?(c.bullets||[]).filter(Boolean):[],strip=reserved(s);
  let out=[{}];
  if(rows.length){const plan=tablePlan(rows,W,avail-strip,avail,c.font_size||0);out=plan.pages.map((idx,n)=>({rows:[rows[0],...idx.map(i=>rows[i])],font:plan.font,widths:plan.widths,bullets:n===0?list:[]}));}
  else if(list.length)out=[{bullets:list}];
  if(s.layout==='events'){const photos=c.photos||[],count=Math.max(out.length,Math.ceil(photos.length/4));return Array.from({length:count},(_,i)=>({...out[i],photos:photos.slice(i*4,i*4+4)}));}
  return out;
 }
 return[{}];
}
export function buildDeck(state){const deck=[{kind:'cover'},{kind:'agenda'}];for(const sec of visibleSections(state)){deck.push({kind:'divider',section:sec.id});for(const id of sec.slides)if(included(state,state.slides[id]))parts(state.slides[id]).forEach((_,part)=>deck.push({kind:'slide',id,part}));}deck.push({kind:'end'});return deck;}
function orderedAta(state,s){
 const ordered=state.sections.flatMap(sec=>sec.slides).filter(id=>included(state,state.slides[id])),rows=s.content.rows||[];
 const rank=r=>{const targets=ordered.map((id,i)=>state.slides[id].ata_refs?.includes(r[0])?i:Infinity).filter(Number.isFinite);if(targets.length)return Math.min(...targets);const topic=r[1].toLocaleUpperCase('pt-BR');const sec=state.sections.find(sec=>topic.includes(sec.name.toLocaleUpperCase('pt-BR')));const first=sec?.slides.find(id=>ordered.includes(id));return first?ordered.indexOf(first):Infinity;};
 return rows.length?[rows[0],...rows.slice(1).map((r,i)=>({r,i})).sort((a,b)=>rank(a.r)-rank(b.r)||a.i-b.i).map(x=>x.r)]:[];
}
function table(s,rows,part={}){
 if(!rows?.length)return empty('Cole a tabela do Excel');if(s.layout==='ata')return ataTable(s,rows);
 return tableHtml(rows,part.widths,part.font,{cls:s.layout==='visits-clients'?'plain-table':''});
}
function ataTable(s,rows){
 const g=geometry(s),data=rows.slice(1),status=v=>/conclu|resolvid/i.test(v)?'done':/atras|vencido/i.test(v)?'late':/andamento/i.test(v)?'progress':'warning';
 return `<table class="data-table ata-table" style="font-size:19px;line-height:1.35"><colgroup>${g.widths.map(w=>`<col style="width:${w/1200*100}%">`).join('')}</colgroup><thead><tr>${rows[0].map(v=>`<th>${esc(v)}</th>`).join('')}</tr></thead><tbody>${data.map((r,i)=>{let span=1;while(i+span<data.length&&data[i+span][1]===r[1])span++;const group=i===0||data[i-1][1]!==r[1];return `<tr><td class="ata-code">${esc(r[0])}</td>${group?`<td class="ata-topic" rowspan="${span}">${esc(r[1])}</td>`:''}<td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td><td><span class="ata-status ${status(r[5])}">${esc(r[5])}</span></td></tr>`;}).join('')}</tbody></table>`;
}
const empty=t=>`<div class="empty-block">${esc(t)}</div>`;
const img=url=>url?`<img src="${esc(url)}" alt="Conteúdo enviado">`:empty('Clique para inserir uma imagem');
function gallery(photos=[]){return photos.length?`<div class="gallery-grid photos-${photos.length}">${photos.map(p=>`<figure><img src="${esc(p.url)}" alt="${esc(p.caption)}">${p.caption?`<figcaption>${esc(p.caption)}</figcaption>`:''}</figure>`).join('')}</div>`:empty('Adicione imagens e legendas');}
function visitsChart(rows){
 if(!rows?.length)return '';
 const head=rows[0],totalIdx=head.findIndex(h=>normText(h)==='TOTAL'),mi=totalIdx>1?totalIdx-1:head.length-1;
 const data=rows.slice(1).filter(r=>normText(r[0])!=='TOTAL').map(r=>({label:String(r[0]??''),v:Math.max(0,parseFloat(String(r[mi]??'').replace(',','.'))||0)}));
 if(!data.length)return '';
 const W=700,H=CHART_H-12,base=H-34,top=58,max=Math.max(1,...data.map(d=>d.v)),slot=W/data.length,bw=Math.min(90,slot*.55);
 const pts=data.map((d,i)=>({x:slot*i+slot/2,y:base-(d.v/max)*(base-top),v:d.v,label:d.label}));
 const month=normText(head[mi])&&mi>0?` (${esc(head[mi])})`:'';
 return `<svg class="visits-chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><text x="${W/2}" y="20" text-anchor="middle" font-size="17" font-weight="bold" fill="#1a1f6e">QTD VISITAS MÊS VIGENTE${month}</text>${pts.map(p=>`<rect x="${p.x-bw/2}" y="${p.y}" width="${bw}" height="${base-p.y}" fill="#00b050"/>`).join('')}<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="#222" stroke-width="1.5"/>${pts.length>1?`<polyline points="${pts.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="#111" stroke-width="3" stroke-dasharray="9 6"/>`:''}${pts.map(p=>`<text x="${p.x}" y="${p.y-8}" text-anchor="middle" font-size="17" font-weight="bold" fill="#111">${p.v}</text><text x="${p.x}" y="${base+19}" text-anchor="middle" font-size="12" fill="#444">${esc(p.label)}</text>`).join('')}</svg>`;
}
function strip(list){const info=stripInfo(list);return `<div class="bullet-strip" style="grid-template-columns:repeat(${info.cols},minmax(0,1fr))">${list.map(b=>`<div class="strip-card">${esc(b)}</div>`).join('')}</div>`;}
function bullets(c){return `<div class="highlight-list">${c.bullets?.filter(Boolean).map(b=>`<div class="highlight-card">${esc(b)}</div>`).join('')||empty('Adicionar destaques')}</div>`;}
const num=v=>{let t=String(v).replace(/[%R$\s]/g,'');if(!t||t==='-'||t==='—')return null;if(t.includes(','))t=t.replace(/\./g,'').replace(',','.');return Number(t);};
const isAcc=v=>/^AC[UC]/.test(normText(v));
function chart(rows,title,projection=false){
 if(!rows?.length)return `<div class="chart"><h3>${title}</h3>${empty('Cole Mês • Realizado • Meta')}</div>`;
 const data=rows.slice(1),firstAcc=data.findIndex(r=>isAcc(r[0])),projIdx=!projection?-1:firstAcc>0?firstAcc-1:firstAcc===0?-1:data.length-1,barColor=(r,i,v,target)=>isAcc(r[0])?'#1f5fbf':i===projIdx?'#f2b705':target===null?'#167caf':v>=target?'#229b73':'#dc665d',max=Math.max(1,...data.flatMap(r=>[num(r[1])||0,num(r[2])||0]))*1.18,n=data.length||1,step=500/n,y=v=>185-v/max*145;
 return `<div class="chart"><h3>${title}</h3><svg viewBox="0 0 560 230" role="img" aria-label="${title}"><line x1="40" y1="185" x2="550" y2="185" stroke="#cbd5e1"/>${[0,.5,1].map(f=>`<text x="35" y="${y(max*f)+4}" text-anchor="end" font-size="12" fill="#68798a">${Math.round(max*f)}</text>`).join('')}${data.map((r,i)=>{const v=num(r[1]),target=num(r[2]),x=45+i*step;return `${v!==null?`<rect x="${x}" y="${y(v)}" width="${step*.64}" height="${185-y(v)}" fill="${barColor(r,i,v,target)}"/><text x="${x+step*.32}" y="${y(v)-6}" text-anchor="middle" font-size="12">${esc(r[1])}</text>`:''}${target!==null?`<line x1="${x-3}" x2="${x+step*.7}" y1="${y(target)}" y2="${y(target)}" stroke="#243b66" stroke-width="2"/>`:''}<text x="${x+step*.32}" y="205" text-anchor="middle" font-size="12">${esc(r[0])}</text>`;}).join('')}<text x="280" y="225" text-anchor="middle" font-size="11" fill="#64748b">Barra: realizado • Traço: meta • Verde: meta atingida • Vermelho: abaixo${projIdx>=0?' • Amarelo: projeção':''}${firstAcc>=0?' • Azul: acumulado':''}</text></svg></div>`;
}
export function renderSlide(state,item,{editing=false}={}){
 const info=state.event||{type:state.settings.default_type,date:new Date().toLocaleDateString('sv-SE')},type=state.presentation_types.find(t=>t.id===info.type)||state.presentation_types[0];
 if(item.kind==='cover')return `<article class="slide cover"><div class="cover-title">${esc(state.settings.cover_title).replace(/\n/g,'<br>')}</div><div class="cover-subtitle">${esc(type.cover)}<br>${esc(state.settings.regional)}<div class="cover-date">${info.date.split('-').reverse().join('/')}</div></div></article>`;
 if(['agenda','divider'].includes(item.kind)){const secs=visibleSections(state);return `<article class="slide agenda"><h1>AGENDA <span>| ${esc(type.name)}</span></h1><div class="agenda-grid" style="grid-template-rows:repeat(${Math.max(1,Math.ceil(secs.length/2))},${Math.min(39,480/Math.max(1,Math.ceil(secs.length/2)))}px)">${secs.map((sec,i)=>`<div class="agenda-row ${item.kind==='divider'&&item.section!==sec.id?'muted':''} ${item.section===sec.id?'current':''}"><span>${String(i+1).padStart(2,'0')}</span><strong style="font-size:${sec.name.length>55?12:17}px">${esc(sec.name)}</strong></div>`).join('')}</div><div class="agenda-line"></div><img class="agenda-logo" src="static/assets/logo-branca.png" alt="Equatorial"></article>`;}
 if(item.kind==='end')return `<article class="slide cover end"><div class="end-title">${esc(state.settings.end_title||'FIM')}</div><div class="end-sub">${esc(type.cover)}<br>${esc(state.settings.regional)}</div></article>`;
 let s=state.slides[item.id];if(!s)return '';
  const all=parts(s),part=all[item.part||0]||all[0],c=s.content;
 const zone=(field,html,cls='')=>`<div class="edit-zone ${cls}" ${editing?`data-field="${field}" tabindex="0" role="button" aria-label="Editar ${field}"`:''}>${html}</div>`;
 let content='';
 if(s.layout==='pdf'&&part.pdf)return `<article class="slide pdf-page">${zone('pdf',img(part.pdf.url),'image-area')}</article>`;
 if(s.layout==='pdf')content=zone('pdf',empty('DDS • Inserir PDF externo'),'image-area');
 else if(s.layout==='placeholder')content=zone('placeholder',empty('Modelo do Anexo IV a definir'),'image-area');
 else if(s.layout==='image')content=zone('image',img(c.image),'image-area');
 else if(s.layout==='gallery')content=zone('photos',gallery(part.photos),'gallery-area');
 else if(s.layout==='visits')content=`<div class="visits-layout">${zone('bullets',`<div class="metric"><strong>${esc(c.visits_agencies||'—')}</strong>Visitas a agências</div><div class="metric"><strong>${esc(c.visits_partners||'—')}</strong>Visitas a credenciados</div>${bullets({...c,bullets:part.bullets})}`)}${zone('image',img(c.image),'image-area')}</div>`;
 else if(s.layout==='table-bullets'){const list=part.bullets||[];content=`<div class="tb-layout">${list.length?zone('bullets',strip(list),'strip-area'):''}${zone('rows',table(s,part.rows,part),'table-area')}</div>${!list.length&&editing&&(item.part||0)===0?'<div class="edit-zone add-highlights" data-field="bullets" tabindex="0" role="button" aria-label="Adicionar destaques">+ Destaques (opcional)</div>':''}`;}
  else if(s.layout==='visits-clients')content=`<div class="vc-layout"><div class="vc-left">${zone('rows',`${(item.part||0)===0?`<div class="chart-area">${visitsChart(c.rows)}</div>`:''}${table(s,part.rows,part)}`,'table-area')}</div>${zone('image',img(c.image),'image-area')}</div>`;
  else if(s.layout==='charts'){const list=(c.charts||[]).filter(x=>x.rows?.length||x.title);content=zone('charts',list.length?`<div class="charts-grid charts-${list.length}">${list.map(x=>chart(x.rows,esc(x.title||''),c.projection_last)).join('')}</div>`:empty('Adicione até 4 gráficos de barras'),'charts-area');}
  else if(s.layout==='works')content=`<div class="works-charts">${zone('chart_without',chart(c.chart_without,'Sem obras',c.projection_last))}${zone('chart_with',chart(c.chart_with,'Com obras',c.projection_last))}</div>${zone('rows',table(s,part.rows,part),'works-table')}`;
 else if(s.layout==='events')content=c.photos?.length?`<div class="events-layout ${c.rows?.length?'':'only-photos'}">${c.rows?.length?zone('rows',table(s,part.rows,part),'table-area'):''}${zone('photos',gallery(part.photos),'gallery-area')}</div>`:zone('rows',table(s,part.rows,part),'table-area');
 else if(s.layout==='table-kpi')content=`<h2 class="table-heading">Chamados Pendentes</h2>${zone('rows',table(s,part.rows,part),'table-area')}<div class="resolved-card">${zone('resolved',`<strong>${esc(c.resolved||'—')}</strong> Chamados resolvidos desde a última reunião`)}</div>`;
 else if(['table','ata'].includes(s.layout))content=zone('rows',table(s,part.rows,part),'table-area');
 else content=zone('text',part.text?esc(part.text):empty('Clique para digitar'),'text-area');
 const ata=state.slides.ata?.content.rows||[],refs=(s.ata_refs||[]).map(code=>{const row=ata.find(r=>r[0]===code);return `${code} · ${row?(row[5].slice(0,30)||'Sem status'):'conferir referência'}`;});
 return `<article class="slide content-slide layout-${s.layout}" style="--header-h:${state.settings.header_height}px"><header class="slide-header"><h1 style="font-size:${s.title.length>85?21:26}px"><i></i>${esc(s.title)}</h1><img src="static/assets/logo-branca.png" alt="Equatorial"></header><div class="slide-body">${content}</div><footer class="slide-footer"><span>${all.length>1?`${(item.part||0)+1}/${all.length} • `:''}${esc(refs.join(' | '))}</span><span>${s.updated_at?'Atualizado ':''}${esc(stamp(s.updated_at))}</span></footer></article>`;
}
export function fitStages(root=document){root.querySelectorAll('.stage-box').forEach(box=>{const stage=box.firstElementChild;if(!stage)return;const resize=()=>stage.style.transform=`scale(${box.clientWidth/1280})`;resize();if(!box._observer){box._observer=new ResizeObserver(resize);box._observer.observe(box);}});}
