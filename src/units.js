/* Mall-specific store IDs read from floor plan. These labels are geographically
 * approximate and not proof of a doorway, lease, accessibility or tenant name.
 * Unmatched codes are still searchable and remain distinct records.
 */
(()=>{
'use strict';
const mall=window.RETAILNAV_ACTIVE_MALL||{};
const units=Array.isArray(mall.units)?mall.units:[];
const host=document.getElementById('rnUnitOverlay');
const detail=document.getElementById('rnUnitInfo');
const title=document.getElementById('rnUnitName');
const sub=document.getElementById('rnUnitDescription');
let selected=null,visibleCount=0,frames=0;
let searchHighlights=[];
function setQuery(text){
 const next=String(text||'').trim().length<2?[]:find(text).slice(0,4).map(u=>u.code);
 if(searchHighlights.join('|')===next.join('|'))return;
 searchHighlights=next;
 window.__RETAILNAV__?.invalidate?.();
}
const buttons=new Map();
function find(query){
 const text=String(query||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(!text)return[];
 return units.filter(u=>{
   const haystack=[u.code,u.name,u.aliases,u.category,u.tags].filter(Boolean).join(' ');
   return haystack.normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(text);
 });
}
function focus(code){
 const u=units.find(x=>x.code===code);
 if(!u)return false;
 selected=code;
 title.textContent=(u.name?u.name+' · ':'')+u.code;
 const brand=u.name?' · '+u.name:'';
 const activity=u.category?' · '+u.category:'';
 sub.textContent=(u.polygonId
  ?'Sector cromático provisional '+u.polygonId+
   '. Puede incluir varios locales y no es la puerta de la tienda.'
  :Number.isFinite(u.x)&&Number.isFinite(u.y)
   ?'Código de directorio con ubicación aproximada del texto, sin pared atribuida.'
   :'Comercio identificado en el directorio; ubicación exacta sin verificar.')+
   activity+(u.tags?' · Productos/servicios: '+u.tags.replaceAll(',',', '):'')+
   '. Directorio fotográfico; la presencia comercial puede cambiar.';
 if(u.enrichmentURL){
  try{
   const url=new URL(u.enrichmentURL);
   if(url.protocol==='https:'){
    const link=document.createElement('a');
    link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';
    link.textContent=' Fuente externa: coincidencia de esta marca o local (no prueba vigencia actual).';
    link.style.color='#92eafa';
    sub.append(document.createElement('br'),link);
   }
  }catch{}
 }
 detail.hidden=false;
 if(Number.isFinite(u.x)&&Number.isFinite(u.y))
   window.__RETAILNAV__?.focusAt?.(u.floor,[u.x,u.y],67);
 else window.__RETAILNAV__?.setFloor?.(u.floor);
 window.__RETAILNAV__?.invalidate?.();
 return true;
}
function paint(){
 if(!host)return;
 const view=window.__RETAILNAV__,state=view?.getState();
 if(!state?.ready)return;
 frames++;visibleCount=0;
 if(state.renderer==='WebGL'&&window.RetailNavUnits?.draw3D){
  // Geometry-bearing WebGL wall signs take priority. Screen-space DOM badges
  // are only a 2D fallback and must never masquerade as fixed 3D shopfronts.
  for(const el of buttons.values())el.hidden=true;
  return;
 }
 const codesOn=state.distance<145||Boolean(selected);
 const floors=new Set(state.visible);
 const occupied=[];
 for(const u of units){
  let el=buttons.get(u.code);
  if(!el){
   el=document.createElement('button');
   el.type='button';el.className='rnUnitCode';
   el.textContent=u.code;
   el.dataset.unitCode=u.code;
   el.title=u.name?u.code+' · '+u.name:u.code+' · código del plano';
   el.setAttribute('aria-label','Local '+el.title);
   el.addEventListener('click',e=>{e.stopPropagation();focus(u.code)});
   host.appendChild(el);buttons.set(u.code,el);
  }
  if(!Number.isFinite(u.x)||!Number.isFinite(u.y)||!codesOn||
    !floors.has(u.floor)||(selected&&u.code!==selected&&state.distance>=145)){
   el.hidden=true;continue;
  }
  const world=view.pinWorld(u.floor,u.x,u.y);
  const p=world&&view.projectWorld([world[0],world[1]+2.9,world[2]]);
  if(!p||p.w<=0||p.z>=1||p.z<=-1||p.x<27||p.x>host.clientWidth-27||p.y<8||p.y>host.clientHeight-10){
   el.hidden=true;continue;
  }
  const rect=[p.x-23,p.y-12,p.x+23,p.y+12];
  const collides=occupied.some(q=>rect[0]<q[2]+3&&rect[2]>q[0]-3&&rect[1]<q[3]+3&&rect[3]>q[1]-3);
  if(collides&&u.code!==selected){el.hidden=true;continue;}
  occupied.push(rect);
  el.hidden=false;el.classList.toggle('selected',u.code===selected);
  el.style.left=p.x.toFixed(1)+'px';el.style.top=p.y.toFixed(1)+'px';
  visibleCount++;
 }
}
document.getElementById('rnUnitClose')?.addEventListener('click',()=>{detail.hidden=true;selected=null;window.__RETAILNAV__?.invalidate?.();});
window.RetailNavUnits={draw:paint,focus,find,setQuery,
 getHighlightedCodes:()=>searchHighlights.slice(),
 getUnits:()=>units.slice(),getState:()=>({
 count:units.length,selected,frames,visibleCount,searchHighlights:searchHighlights.slice(),
 matched:units.filter(u=>u.polygonId).length,
 located:units.filter(u=>Number.isFinite(u.x)&&Number.isFinite(u.y)).length,
 withTags:units.filter(u=>u.tags).length,
 withNames:units.filter(u=>u.name).length,
 facadeCount:units.filter(u=>u.facade).length,
 unmatched:units.filter(u=>!u.polygonId).length
})};
})();