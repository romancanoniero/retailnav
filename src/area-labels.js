/* Readable, camera-upright commercial zone names, anchored in the 3D mall.
 * Physical floating plaques still follow the 3D floor; these semantic labels
 * always face the device screen (including phone rotation and landscape).
 * If the view is crowded, the dedicated accessible list includes ALL zones.
 */
(()=>{
'use strict';
const mall=window.RETAILNAV_ACTIVE_MALL||{};
const areas=Array.isArray(mall.districts)?mall.districts:[];
const host=document.getElementById('rnDistrictOverlay');
const menu=document.getElementById('rnAreasMenu');
const trigger=document.getElementById('rnAreasButton');
const canvas=document.getElementById('canvas');
const elements=new Map();
let boxes=[],shown=[],frames=0,menuOpen=false;
if(!host||!trigger||!menu)return;

function focus(id){
 menu.hidden=true;menuOpen=false;trigger.setAttribute('aria-expanded','false');
 window.RetailNavDistricts?.focus?.(id);
 window.__RETAILNAV__?.invalidate?.();
}

for(const a of areas){
 const el=document.createElement('button');
 el.type='button';el.className='rnAreaLabel';el.textContent=a.name;
 el.title=a.name+(a.detail?' · '+a.detail:'');
 el.setAttribute('aria-label','Enfocar zona '+a.name);
 el.dataset.areaId=a.id;
 el.addEventListener('click',event=>{event.stopPropagation();focus(a.id);});
 host.append(el);elements.set(a.id,el);
 const item=document.createElement('button');
 item.type='button';item.className='rnAreaMenuItem';
 const title=document.createElement('strong');title.textContent=a.name;
 item.append(title);
 if(a.detail){
  const desc=document.createElement('small');desc.textContent=a.detail;
  item.append(desc);
 }
 item.addEventListener('click',()=>focus(a.id));
 menu.append(item);
}
trigger.textContent='Zonas '+areas.length;
trigger.hidden=areas.length===0;
menu.hidden=true;
trigger.setAttribute('aria-expanded','false');
trigger.setAttribute('aria-controls','rnAreasMenu');
trigger.addEventListener('click',event=>{
 event.stopPropagation();menuOpen=!menuOpen;menu.hidden=!menuOpen;
 trigger.setAttribute('aria-expanded',String(menuOpen));
 window.__RETAILNAV__?.invalidate?.();
});
document.addEventListener('pointerdown',event=>{
 if(menuOpen&&!menu.contains(event.target)&&!trigger.contains(event.target)){
  menuOpen=false;menu.hidden=true;trigger.setAttribute('aria-expanded','false');
 }
});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&menuOpen){
  menuOpen=false;menu.hidden=true;trigger.setAttribute('aria-expanded','false');
  trigger.focus();event.stopPropagation();
 }
});
function intersect(a,b,pad=5){
 return a.x0<b.x1+pad&&a.x1+pad>b.x0&&a.y0<b.y1+pad&&a.y1+pad>b.y0;
}
function draw(){
 const view=window.__RETAILNAV__,state=view?.getState();
 if(!state?.ready||!areas.length)return;
 frames++;
 // WebGL owns the single, blue illuminated 3D sign for every zone. Rendering
 // a second HTML badge caused the duplicated text reported on iPhone.
 // HTML plaques are ONLY a fallback when 3D rendering is unavailable.
 if(state.renderer==='WebGL'){
  for(const el of elements.values())el.hidden=true;
  boxes=[];shown=window.RetailNavDistricts?.getState?.().visibleIds||[];
  trigger.dataset.visibleNames=String(shown.length);
  trigger.setAttribute('aria-label','Ver las '+areas.length+' zonas comerciales');
  return;
 }
 const visible=new Set(state.visible);
 const screenWidth=canvas.clientWidth,screenHeight=canvas.clientHeight;
 if(!screenWidth||!screenHeight)return;
 const portrait=screenHeight>=screenWidth,compact=screenWidth<650;
 const top=compact?(portrait?126:70):100;
 const bottom=compact?(portrait?110:70):92;
 const occupied=[],placed=[];
 // Prefer zones near the center, then place others around their anchors.
 const candidates=areas.map(area=>{
  const point=visible.has(area.floor)?view.pinWorld(area.floor,area.x,area.y):null;
  const screen=point?view.projectWorld([point[0],point[1]+9.3,point[2]]):null;
  return {area,screen};
 }).sort((a,b)=>{
  const metric=c=>c.screen?Math.hypot(c.screen.x-screenWidth/2,c.screen.y-screenHeight/2):1e9;
  return metric(a)-metric(b);
 });
 for(const {area,screen} of candidates){
  const el=elements.get(area.id);
  el.hidden=true;
  if(!screen||!Number.isFinite(screen.x+screen.y)||screen.w<=0
     ||screen.z<=-1||screen.z>=1)continue;
  const w=el.offsetWidth||110,h=el.offsetHeight||28;
  if(screenWidth<w+16||screenHeight<top+bottom+h)continue;
  const cx=Math.max(w/2+10,Math.min(screenWidth-w/2-10,screen.x));
  const cy=Math.max(top+h/2,Math.min(screenHeight-bottom-h/2,screen.y));
  // Avoid covering neighboring area names. Search nearby readable placements;
  // the list control always provides access to all 8, even on tiny screens.
  let found=null;
  for(const dy of [0,-32,32,-64,64,-96,96,-128,128,-160,160]){
   if(found)break;
   for(const dx of [0,-98,98,-175,175,-250,250]){
    const x=cx+dx,y=cy+dy;
    if(x-w/2<9||x+w/2>screenWidth-9||
       y-h/2<top||y+h/2>screenHeight-bottom)continue;
    const box={id:area.id,floor:area.floor,
      x0:x-w/2,y0:y-h/2,x1:x+w/2,y1:y+h/2};
    if(!occupied.some(other=>intersect(box,other,7))){found={x,y,box};break;}
   }
  }
  if(!found)continue;
  occupied.push(found.box);placed.push(area.id);
  el.hidden=false;el.style.left=found.x.toFixed(1)+'px';
  el.style.top=found.y.toFixed(1)+'px';
 }
 boxes=occupied;shown=placed;
 trigger.dataset.visibleNames=String(shown.length);
 trigger.setAttribute('aria-label','Ver las '+areas.length+
  ' zonas comerciales; '+shown.length+' legibles sobre el mapa');
}
function getProjectedBoxes(){return boxes.map(b=>({...b}));}
window.RetailNavAreaLabels={
 draw,getProjectedBoxes,focus,getState:()=>({
  total:areas.length,visibleCount:shown.length,
  visibleIds:shown.slice(),frames,
  textUpright:true,screenSpace:true,orientationResponsive:true,
  webglLabelsAreUnified:true,
  alwaysAvailableInDirectory:areas.length,
  menuOpen,boxes:getProjectedBoxes()
 })
};
window.addEventListener('orientationchange',()=>window.__RETAILNAV__?.invalidate?.());
window.visualViewport?.addEventListener('resize',()=>window.__RETAILNAV__?.invalidate?.());
window.__RETAILNAV__?.invalidate?.();
})();
