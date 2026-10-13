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
const buttons=new Map();
function find(query){
 const text=String(query||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(!text)return[];
 return units.filter(u=>(u.code+' '+(u.name||'')).normalize('NFD')
   .replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(text));
}
function focus(code){
 const u=units.find(x=>x.code===code);
 if(!u)return false;
 selected=code;
 title.textContent=(u.name?u.name+' · ':'')+u.code;
 sub.textContent=(u.polygonId
  ?'Código transcrito del plano; asociado al contorno provisional '+u.polygonId+'.'
  :'Código visible en la fotografía; todavía sin asociación confiable con el polígono.')+
  ' Posición aproximada del texto, no de la entrada.';
 detail.hidden=false;
 window.__RETAILNAV__?.focusAt?.(u.floor,[u.x,u.y],67);
 window.__RETAILNAV__?.invalidate?.();
 return true;
}
function paint(){
 if(!host)return;
 const view=window.__RETAILNAV__,state=view?.getState();
 if(!state?.ready)return;
 frames++;visibleCount=0;
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
  if(!codesOn||!floors.has(u.floor)||(selected&&u.code!==selected&&state.distance>=145)){
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
window.RetailNavUnits={draw:paint,focus,find,getState:()=>({
 count:units.length,selected,frames,visibleCount,
 matched:units.filter(u=>u.polygonId).length,
 unmatched:units.filter(u=>!u.polygonId).length
})};
})();