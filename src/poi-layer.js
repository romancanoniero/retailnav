/* RetailNav semantic POIs from reviewed symbols on the photographed floor guide.
 * A POI is a labelled map reference, not a measured doorway or routing endpoint.
 */
(()=>{
'use strict';
const mall=window.RETAILNAV_ACTIVE_MALL||{};
const i18n=window.RetailNavI18n;
const semanticService={toilet:'service.restroom',elevator:'service.elevator',exit:'service.exit',information:'service.information',parking:'service.parking'};
const all=Array.isArray(mall.pois)?mall.pois:[];
const overlay=document.getElementById('rnPOIOverlay');
const toggle=document.getElementById('rnServicesToggle');
const drawer=document.getElementById('rnPoiInfo');
const title=document.getElementById('rnPoiTitle');
const description=document.getElementById('rnPoiDescription');
const icon={toilet:'🚻',elevator:'🛗',metro:'Ⓜ',exit:'↗',information:'ⓘ',
  'vertical-uncertain':'↕',parking:'P','sign-you-are-here':'●'};
const aliases={toilet:'baño baños servicios sanitario toilet wc restroom',elevator:'ascensor elevador lift elevator',
  metro:'subte subway metro línea 2 tren',exit:'salida entrada exit',
  information:'información informes ayuda information',
  'vertical-uncertain':'escalera escalera mecánica escalator stairs comunicación vertical',
  parking:'parking estacionamiento coche', 'sign-you-are-here':'ubicación cartel mapa punto rojo'};
let markers=new Map(),shown=[],enabled=true,selected=null,frames=0;
if(toggle){toggle.hidden=!all.length;toggle.disabled=!all.length;toggle.setAttribute('aria-pressed',String(enabled));}
const canPlace=p=>Number.isFinite(p.x)&&Number.isFinite(p.y);
const lookup=id=>all.find(p=>p.id===id);
function describe(p){
  const status=p.confidence==='cartel'?'Identificado en el cartel; coordenada aproximada.'
    :p.confidence==='por-revisar'?'Símbolo o tipo de acceso pendiente de confirmación.'
    :'Se indica en la leyenda; no hay punto preciso verificado.';
  return status+
    (p.category==='sign-you-are-here'?' Es la posición fija del cartel fotografiado, NO tu GPS actual.':'')+
    ' No utilizar para rutas hasta calibrar el plano en el edificio.';
}
function show(id){
  const p=lookup(id);
  if(!p||!drawer)return false;
  selected=p.id;
  title.textContent=semanticService[p.category]&&i18n?.label?.(semanticService[p.category])||p.name;
  description.textContent=describe(p);
  drawer.hidden=false;
  const view=window.__RETAILNAV__;
  if(canPlace(p)&&view?.getState().ready){
    view.focusAt(p.floor,[p.x,p.y],92);
  }
  for(const [key,button] of markers)button.classList.toggle('selected',key===id);
  return true;
}
function make(p){
  const button=document.createElement('button');
  button.type='button';
  button.className='rnPoiMarker'+(p.confidence!=='cartel'?' tentative':'');
  button.dataset.poiId=p.id;
  button.textContent=icon[p.category]||'●';
  button.title=p.name+(p.confidence==='cartel'?'':' (pendiente de confirmar)');
  button.setAttribute('aria-label','Servicio: '+p.name+', '+describe(p));
  button.addEventListener('click',e=>{e.stopPropagation();show(p.id);});
  overlay.append(button);
  return button;
}
function draw(){
  const view=window.__RETAILNAV__;
  if(!overlay||!view?.getState().ready)return;
  frames++;
  shown=[];
  const state=view.getState();
 const visible=new Set(state.visible);
  for(const p of all){
    if(!canPlace(p))continue;
    let button=markers.get(p.id);
    if(!button){button=make(p);markers.set(p.id,button);}
    if(!enabled||!visible.has(p.floor)){button.hidden=true;continue;}
    // Bathroom and elevator roofs now exist as true 3D room volumes with
    // raised WC/LIFT lettering. Suppress the old floating HTML POI badge,
    // which appears disconnected from the building during 360° rotation.
    // The physical 3D room remains selectable by tapping its own roof and
    // the service stays searchable through the POI index.
    const roofAnchored=window.RETAILNAV_ROOF_ATTACHMENTS?.has(p.geometryId);
    const vectorFootprint=Boolean(p.geometryId&&p.source==='photo-colour-candidate');
    // Render every mapped service as world geometry, never as a detached
    // screen-coordinate emoji. This applies to WebGL and Canvas fallbacks.
    // Unmapped services remain searchable via POI.find/show, but should not
    // generate a fake position or a sticker floating in space.
    if(roofAnchored||vectorFootprint){
      button.hidden=true;continue;
    }
    const world=view.pinWorld(p.floor,p.x,p.y);
    const projected=world&&view.projectWorld([world[0],world[1]+1.6,world[2]]);
    if(!projected||projected.w<=0||projected.z>=1||projected.z<=-1||
      projected.x<12||projected.x>overlay.clientWidth-12||
      projected.y<12||projected.y>overlay.clientHeight-12){
      button.hidden=true;continue;
    }
    button.hidden=false;
    button.style.left=projected.x.toFixed(1)+'px';
    button.style.top=projected.y.toFixed(1)+'px';
    shown.push(p.id);
  }
}
if(toggle)toggle.addEventListener('click',()=>{
  enabled=!enabled;
  toggle.setAttribute('aria-pressed',String(enabled));
  if(!enabled&&drawer)drawer.hidden=true;
  window.__RETAILNAV__?.invalidate?.();
  draw();
});
document.getElementById('rnPoiClose')?.addEventListener('click',()=>{drawer.hidden=true;selected=null;});
window.RetailNavPOI={draw,show,find:query=>{
  const text=String(query||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  if(!text)return[];
  return all.filter(p=>(p.name+' '+(aliases[p.category]||'')).normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(text)||
    Boolean(semanticService[p.category]&&i18n?.matchConcept(semanticService[p.category],query)));
},getState:()=>({count:all.length,shown:shown.slice(),enabled,selected,frames,
  verified:all.filter(p=>p.confidence==='cartel').length})};
})();