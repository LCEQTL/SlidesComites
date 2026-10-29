import assert from 'node:assert/strict';import fs from 'node:fs';import{parseTSV,toTSV,cleanTable,parts,buildDeck,renderSlide,validateRows,tableMetrics}from'../static/js/render.js';
const root=new URL(fs.existsSync(new URL('../templates/apresentacao.json',import.meta.url))?'../templates/':'../fontes-templates/',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root)));
const cfg=read('apresentacao.json'),structure=read('estrutura.json'),state={...cfg,slides:{},sections:[],event:null};
for(const row of structure){const s={...read(row.file),...row,ready:false,excluded:false,updated_at:null,ata_refs:[]};state.slides[s.id]=s;let sec=state.sections.find(x=>x.id===row.section_id);if(!sec){sec={...cfg.sections.find(x=>x.id===row.section_id),slides:[]};state.sections.push(sec);}sec.slides.push(s.id);}
const rows=parseTSV('Cidade\tValor\r\nFloriano\t92%\r\n"Texto\ncom quebra"\t"Valor ""citado"""\r\n');assert.equal(rows[2][0],'Texto\ncom quebra');assert.deepEqual(parseTSV(toTSV(rows)),rows);
assert.equal(buildDeck(state).length,101);assert.equal(Object.keys(state.slides).length,74);assert.equal(buildDeck(state).at(-1).kind,'end');
const secOf=id=>state.sections.find(x=>x.slides.includes(id)).id;assert.equal(state.sections.find(x=>x.id==='pecld').slides.join(),'pecld-sul');assert.equal(secOf('cobranca-picos'),'iar');assert.ok(!state.slides['evidencias-agencias']);assert.equal(state.slides['anexo-backlog'].layout,'image');assert.equal(state.sections.find(x=>x.id==='matriz-relacionamento').slides.at(-1),'boas-praticas');assert.equal(state.slides['boas-praticas'].layout,'gallery');assert.ok(renderSlide(state,{kind:'end'}).includes('FIM'));
const s=state.slides['interligacao-picos'];s.content.rows=[['Cidade','Valor'],...Array.from({length:55},(_,i)=>['Cidade '+i,''+i])];s.content.bullets=Array(6).fill('Destaque com bastante texto para verificar paginação e garantir que todo o conteúdo continue visível na tela sem ultrapassar a área disponível.');validateRows(s);let pp=parts(s);assert.ok(pp.length>1);assert.equal(pp.reduce((n,p)=>n+(p.rows?.length||1)-1,0),55);assert.equal(pp.flatMap(p=>p.bullets).length,6);assert.equal(pp[1].bullets.length,0);
const gallery=state.slides.imprensa;gallery.content.photos=Array.from({length:5},(_,i)=>({id:''+i,url:'/test.webp',caption:''}));assert.deepEqual(parts(gallery).map(p=>p.photos.length),[2,2,1]);
s.title='<script>alert(1)</script>';let html=renderSlide(state,{kind:'slide',id:s.id,part:0});assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('Não atualizado'));assert.ok(!html.includes('Em edição'));assert.ok(!html.includes('Pronto'));
for(const slide of Object.values(state.slides))slide.included.cobranca=false;state.event={type:'cobranca',date:'2026-10-08'};assert.equal(buildDeck(state).length,3);
// Interligação/contrato: muitas colunas, tabela em largura total, destaques acima e fonte ajustável.
const wide=state.slides['contrato-obras-picos'];const head=['Cliente','Nº do contrato','Município','Situação da obra','Responsável pela execução','Data prevista','Prazo (dias)','Observações'];
wide.content.bullets=[];wide.content.rows=[head,...Array.from({length:12},(_,i)=>['Cliente '+i,'CT-2026/'+(100+i),'São Raimundo Nonato','Aguardando documentação complementar','Equipe regional','15/11/2026',''+(60+i),'Sem pendências adicionais registradas'])];
validateRows(wide);let m=tableMetrics(wide);assert.ok(m.auto&&m.font>=9&&m.font<=24&&m.fitMax>=m.font);
let wp=parts(wide);assert.equal(wp.length,1);const widthSum=wp[0].widths.reduce((a,b)=>a+b,0);assert.ok(Math.abs(widthSum-1200)<1,'tabela ocupa toda a largura');
let html2=renderSlide(state,{kind:'slide',id:wide.id,part:0});assert.ok(!html2.includes('bullet-strip'));assert.ok(html2.includes('fit-table'));
wide.content.bullets=['Primeiro destaque','Segundo destaque'];html2=renderSlide(state,{kind:'slide',id:wide.id,part:0});assert.ok(html2.includes('bullet-strip'));assert.ok(html2.indexOf('bullet-strip')<html2.indexOf('fit-table'),'destaques acima da tabela');
wide.content.font_size=10;assert.equal(tableMetrics(wide).font,10);wide.content.font_size=32;m=tableMetrics(wide);assert.ok(m.limited&&m.font===m.fitMax&&m.font<32,'fonte grande é limitada para não quebrar palavras');
wide.content.font_size=0;wide.content.rows=[head,['Cliente','Supercalifragilisticoespialidoso','Município','Situação','Responsável','Data','Prazo','Obs']];m=tableMetrics(wide);assert.ok(m.fitMax<32);
// Visitas de grandes clientes: gráfico do último mês antes de Total + tabela; status coloridos; projeção.
const vc=state.slides['visitas-consultores'];assert.equal(vc.layout,'visits-clients');
vc.content.rows=[['Carteira','Jan','Fev','Set','Total','Meta'],['HIB SRN','13','1','0','34','47'],['PPM FLO','15','4','9','52','54'],['TOTAL','62','11','9','175','397']];validateRows(vc);
let vh=renderSlide(state,{kind:'slide',id:vc.id,part:0});assert.ok(vh.includes('QTD VISITAS MÊS VIGENTE')&&vh.includes('visits-chart')&&vh.includes('plain-table')&&vh.includes('image-area'));assert.equal((vh.match(/<rect /g)||[]).length,2,'uma barra por carteira, sem a linha TOTAL');
const cob=state.slides['cobranca-picos'];cob.content.rows=[['UC','Situação'],['1','FORA PRAZO'],['2','Programada'],['3','No prazo']];let ch=renderSlide(state,{kind:'slide',id:cob.id,part:0});assert.equal((ch.match(/cell-late/g)||[]).length,1);assert.equal((ch.match(/cell-planned/g)||[]).length,1);
const wk=state.slides['obras-ns-picos'];assert.ok(wk.content.projection_last);
wk.content.rows=[['Mês','Jul','Ago','Set'],['Obras','80%','90%','95%']];assert.ok(!renderSlide(state,{kind:'slide',id:wk.id,part:0}).includes('proj-cell'),'tabela não tem coluna de projeção');
// Gráfico de barras: último mês amarelo (projeção); linha Acumulado em azul e a barra anterior vira a projeção.
const bars=h=>[...h.matchAll(/<rect [^>]*fill="(#[0-9a-f]+)"/g)].map(m=>m[1]);
wk.content.chart_without=[['Mês','Realizado','Meta'],['Jul','80','90'],['Ago','95','90'],['Set','70','90']];
let wh=renderSlide(state,{kind:'slide',id:wk.id,part:0});assert.deepEqual(bars(wh).slice(0,3),['#dc665d','#229b73','#f2b705']);
wk.content.chart_without=[['Mês','Realizado','Meta'],['Jul','80','90'],['Ago','95','90'],['Set','70','90'],['Acumulado','245','270']];
assert.deepEqual(bars(renderSlide(state,{kind:'slide',id:wk.id,part:0})).slice(0,4),['#dc665d','#229b73','#f2b705','#1f5fbf']);
for(const name of ['Acum','ACC','Acu.','acumulado'])wk.content.chart_without[4][0]=name,assert.equal(bars(renderSlide(state,{kind:'slide',id:wk.id,part:0}))[3],'#1f5fbf');
wk.content.projection_last=false;assert.ok(!bars(renderSlide(state,{kind:'slide',id:wk.id,part:0})).includes('#f2b705'));wk.content.projection_last=true;
// Cabeçalho colado com linha de título
const pasted=parseTSV('MÊS DE OUTUBRO\t\t\t\nETAPA\tDATA\tEVENTO\tAÇÃO\n3\tV+2\tREAVISO\tREVISAR');const cleaned=cleanTable(pasted);assert.equal(cleaned.removed.length,1);assert.deepEqual(cleaned.rows[0],['ETAPA','DATA','EVENTO','AÇÃO']);
assert.deepEqual(cleanTable(parseTSV('A\tB\n1\t2')).removed,[]);assert.throws(()=>cleanTable(parseTSV('\t\t\t\na\t\t\t')),/Cabeçalho incompleto/);
assert.deepEqual(state.sections.find(x=>x.id==='eventos').slides,['eventos-ppm-floriano','eventos-bom-jesus','eventos-picos','eventos-sao-raimundo']);
assert.ok(state.slides['uso-mutuo-picos']&&state.slides['uso-mutuo-picos'].layout==='table-bullets');
console.log('OK: 74 modelos, 24 seções, 101 páginas iniciais, tabelas sem quebra de palavra, fonte ajustável, TSV, paginação, galerias, escape, rodapé e inclusão por tipo.');
