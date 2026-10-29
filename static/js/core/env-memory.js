// Modo demonstração: tudo na memória/localStorage do navegador, sem Supabase (backend:'memory' em config.js).
import {Problem} from './domain.js';
export function createMemoryEnv({password='demo',prefix='memory://media/'}={}){
 const toHex=buf=>[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
 const hash=async blob=>toHex(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()));
 let authed=typeof sessionStorage!=='undefined'&&sessionStorage.getItem('eq_team')==='1';
 const mem={profile:null};
 const ls=typeof localStorage!=='undefined'?localStorage:null;
 return {
  mediaPrefix:prefix,
  async loadBundle(){const r=await fetch('templates/bundle.json',{cache:'no-store'});return r.json();},
  async requireSession(){if(!authed){const e=new Problem('Entre com a senha da equipe.',401);e.code='team-login';throw e;}},
  async teamLogin(p){if(p!==password)throw new Problem('Senha da equipe incorreta.',400);authed=true;sessionStorage?.setItem('eq_team','1');},
  async teamLogout(){authed=false;sessionStorage?.removeItem('eq_team');},
  getProfile:()=>ls?ls.getItem('eq_profile'):mem.profile,setProfile:id=>ls?ls.setItem('eq_profile',id):(mem.profile=id),clearProfile:()=>ls?ls.removeItem('eq_profile'):(mem.profile=null),
  async processImage(blob){return {url:prefix+(await hash(blob))+'.webp'};},
  async processPdf(blob,name){const h=await hash(blob);return {name,source:prefix+h+'.pdf',pages:[{id:'1',number:1,url:prefix+h+'.webp'}]};},
 };
}
