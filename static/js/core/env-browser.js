// Ambiente do navegador para o backend Supabase: sessão da equipe, perfil, Storage e processamento de mídia.
import {Problem} from './domain.js';
const loadScript=src=>new Promise((resolve,reject)=>{
 if(document.querySelector(`script[data-src="${src}"]`))return resolve();
 const s=document.createElement('script');s.src=src;s.dataset.src=src;s.onload=resolve;s.onerror=()=>reject(new Error('Não foi possível carregar '+src));document.head.appendChild(s);
});
const toHex=buf=>[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
const sha256=async blob=>toHex(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()));
const toBlob=(canvas,type,quality)=>new Promise(resolve=>canvas.toBlob(resolve,type,quality));

export async function createBrowserEnv(cfg){
 if(!cfg.supabaseUrl||!cfg.supabaseAnonKey||/COLE_/.test(cfg.supabaseUrl+cfg.supabaseAnonKey))throw new Problem('Configure static/config.js com a URL e a chave anon do Supabase.',500);
 await loadScript('static/vendor/supabase.js');
 const client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
 const bucket=cfg.bucket||'media',mediaPrefix=`${cfg.supabaseUrl.replace(/\/$/,'')}/storage/v1/object/public/${bucket}/`;

 async function put(blob,ext,type){
  const name=(await sha256(blob))+ext;
  const {error}=await client.storage.from(bucket).upload(name,blob,{contentType:type,cacheControl:'31536000',upsert:false});
  if(error&&!/exist|duplicate/i.test(error.message||'')&&String(error.statusCode)!=='409')throw new Error(error.message);
  return mediaPrefix+name;
 }
 async function encode(source,width,height,maxW,maxH,quality){
  const scale=Math.min(1,maxW/width,maxH/height),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0,w,h);
  let blob=await toBlob(canvas,'image/webp',quality),ext='.webp';
  if(!blob||blob.type!=='image/webp'){ // navegador sem WebP: JPEG com fundo branco
   ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
   blob=await toBlob(canvas,'image/jpeg',quality);ext='.jpg';
  }
  return {blob,ext,width:w,height:h};
 }
 async function processImage(file){
  if(file.size>25*1024*1024)throw new Error('Imagem maior que 25 MB.');
  let bmp;try{bmp=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{bmp=await createImageBitmap(file);}
  if(bmp.width*bmp.height>40_000_000)throw new Error('Imagem excede 40 megapixels.');
  const out=await encode(bmp,bmp.width,bmp.height,2560,1440,.88);bmp.close?.();
  return {url:await put(out.blob,out.ext,out.blob.type),bytes:out.blob.size,width:out.width,height:out.height};
 }
 async function processPdf(file,name){
  if(file.size>50*1024*1024)throw new Error('PDF maior que 50 MB.');
  await loadScript('static/vendor/pdf.min.js');
  const lib=window.pdfjsLib;lib.GlobalWorkerOptions.workerSrc=new URL('static/vendor/pdf.worker.min.js',document.baseURI).href;
  const data=new Uint8Array(await file.arrayBuffer());let doc;
  try{doc=await lib.getDocument({data:data.slice()}).promise;}catch(e){if(e?.name==='PasswordException')throw new Error('Envie um PDF sem senha.');throw e;}
  if(doc.numPages<1||doc.numPages>100)throw new Error('O PDF deve ter entre 1 e 100 páginas.');
  const pages=[];
  for(let i=1;i<=doc.numPages;i++){
   const page=await doc.getPage(i),base=page.getViewport({scale:1}),vp=page.getViewport({scale:Math.min(1920/base.width,1920/base.height)});
   const canvas=document.createElement('canvas');canvas.width=Math.round(vp.width);canvas.height=Math.round(vp.height);
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
   await page.render({canvasContext:ctx,viewport:vp}).promise;
   let blob=await toBlob(canvas,'image/webp',.9),ext='.webp';
   if(!blob||blob.type!=='image/webp'){blob=await toBlob(canvas,'image/jpeg',.9);ext='.jpg';}
   pages.push({id:String(i),number:i,url:await put(blob,ext,blob.type)});
  }
  const source=await put(new Blob([data],{type:'application/pdf'}),'.pdf','application/pdf');
  return {name:String(name).slice(0,160),source,pages};
 }
 return {
  client,mediaPrefix,processImage,processPdf,
  async loadBundle(){const r=await fetch('templates/bundle.json',{cache:'no-store'});if(!r.ok)throw new Error('templates/bundle.json não encontrado.');return r.json();},
  async requireSession(){const {data}=await client.auth.getSession();if(!data.session){const e=new Problem('Entre com a senha da equipe.',401);e.code='team-login';throw e;}},
  async teamLogin(password){const {error}=await client.auth.signInWithPassword({email:cfg.teamEmail,password:String(password||'')});if(error)throw new Problem('Senha da equipe incorreta.',400);},
  async teamLogout(){await client.auth.signOut();},
  getProfile:()=>localStorage.getItem('eq_profile'),setProfile:id=>localStorage.setItem('eq_profile',id),clearProfile:()=>localStorage.removeItem('eq_profile'),
 };
}
