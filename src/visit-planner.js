/* Local, mall-scoped visit plan. This first step only preserves the visitor's
 * chosen order; route optimization, duration estimates and offers are separate
 * features and must not be inferred here. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const mall=window.RETAILNAV_ACTIVE_MALL||{};
const mallId=mall.id||window.RETAILNAV_ACTIVE_MALL_ID||'';
const storageKey='retailnav:visit-plan:v1:'+mallId;
const action=$('rnStoreAddToPlan'),dock=$('rnStoreActions');
const toggle=$('rnVisitPlanToggle'),count=$('rnVisitPlanCount'),panel=$('rnVisitPlan');
const close=$('rnVisitPlanClose'),list=$('rnVisitPlanStops'),summary=$('rnVisitPlanSummary');
const clear=$('rnVisitPlanClear'),toast=$('rnVisitPlanToast');
if(!mallId||!action||!toggle||!panel||!list)return;
const en=()=>String(document.documentElement.lang||navigator.language||'es').startsWith('en');
const tr=(es,english)=>en()?english:es;
const safe=value=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,120);
let stops=[],toastTimer=0;

function load(){
 try{
  const raw=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(!raw||raw.schema!=='retailnav.visit-plan.v1'||raw.mallId!==mallId||!Array.isArray(raw.stops))return[];
  const unique=new Map();
  for(const item of raw.stops.slice(0,24)){
   const id=safe(item?.id),floor=safe(item?.floor);
   if(!id.startsWith(mallId+':')||!floor||unique.has(id))continue;
   unique.set(id,{id,storeId:safe(item.storeId)||null,spaceId:safe(item.spaceId)||null,
    floor,polygonId:safe(item.polygonId)||null,label:safe(item.label)||tr('Local sin identificar','Unidentified store space'),
    commercial:Boolean(item.storeId),addedAt:Number.isFinite(item.addedAt)?item.addedAt:Date.now()});
  }
  return [...unique.values()];
 }catch{return[];}
}
function persist(){
 try{localStorage.setItem(storageKey,JSON.stringify({schema:'retailnav.visit-plan.v1',mallId,
  mapVersion:mall.mapAsset?.version||null,updatedAt:Date.now(),stops}));}catch{}
}
function destinationForStore(storeId,preferredFloor=null){
  const unit=window.RetailNavUnits?.getUnits?.().find(item=>item.storeId===storeId);
  if(!unit)return null;
  const focus=window.__RETAILNAV__?.getState?.()||{};
  const bindings=window.RetailNavUnits?.getMapBindings?.(unit)||[];
  const binding=bindings.find(item=>item.floor===(preferredFloor||focus.focusFloorId))||bindings[0]||null;
  const floor=safe(binding?.floor||unit.floor||focus.focusFloorId);
  const polygonId=safe(binding?.polygonId||unit.polygonId);
  const spaceId=floor&&polygonId?mallId+':space:'+floor+':'+polygonId:null;
  return {id:unit.storeId,storeId:unit.storeId,spaceId,polygonId:polygonId||null,
   floor:floor||tr('Sin planta','No floor'),label:safe(unit.name||unit.code||tr('Local','Store')),
   commercial:true,addedAt:Date.now()};
}
function currentDestination(){
 const context=window.RetailNavMeetups?.getState?.()||{};
 if(context.selectedStoreId)return destinationForStore(context.selectedStoreId);
 const geometry=context.geometryContext;
 if(geometry?.spaceId&&geometry.floor)return{id:safe(geometry.spaceId),storeId:null,
  spaceId:safe(geometry.spaceId),polygonId:safe(geometry.featureId)||null,floor:safe(geometry.floor),
  label:tr('Local sin identificar','Unidentified store space'),commercial:false,addedAt:Date.now()};
 return null;
}
const contains=id=>Boolean(id&&stops.some(stop=>stop.id===id));
function syncAction(){
 const destination=currentDestination(),included=contains(destination?.id);
 action.disabled=!destination;
 action.setAttribute('aria-pressed',String(included));
 action.title=included?tr('Quitar del recorrido','Remove from route'):tr('Agregar al recorrido','Add to route');
 action.setAttribute('aria-label',destination
  ?(included?tr('Quitar este local del recorrido','Remove this store from the route'):
    tr('Agregar este local al recorrido','Add this store to the route'))
  :tr('Seleccioná un local para agregarlo','Select a store to add it'));
 const use=action.querySelector('use');if(use)use.setAttribute('href',included?'#i-check':'#i-flag');
 syncSearchActions();
}
function syncSearchActions(){
 for(const button of document.querySelectorAll('.rnStoreVisitAction')){
  const included=stops.some(stop=>stop.storeId===button.dataset.rnVisitStore);
  button.setAttribute('aria-pressed',String(included));
  button.title=included?tr('Quitar del recorrido','Remove from route'):tr('Agregar al recorrido','Add to route');
  const use=button.querySelector('use');if(use)use.setAttribute('href',included?'#i-check':'#i-flag');
 }
}
function announce(message){
 clearTimeout(toastTimer);toast.textContent=message;toast.hidden=false;
 toastTimer=setTimeout(()=>{toast.hidden=true;},1800);
}
function closePanel(){panel.hidden=true;toggle.setAttribute('aria-expanded','false');
 document.body.classList.remove('rnVisitPlanOpen');}
function openPanel(){if(!stops.length)return;panel.hidden=false;toggle.setAttribute('aria-expanded','true');
 document.body.classList.add('rnVisitPlanOpen');}
function focus(stop){
 closePanel();
 if(stop.storeId){window.RetailNavMeetups?.selectStore?.(stop.storeId,false,stop.floor);return;}
 const result=window.__RETAILNAV__?.focusGeometrySpace?.(stop.spaceId,stop.floor);
 window.RetailNavMeetups?.showGeometryContext?.({spaceId:stop.spaceId,featureId:stop.polygonId,
  floor:stop.floor,matchCount:0,located:Boolean(result?.located),originKnown:Boolean(result?.originKnown),
  assistanceOpen:Boolean(result?.assistanceOpen),message:tr(
   'Destino físico guardado. Sus datos comerciales todavía no fueron identificados.',
   'Saved physical destination. Its commercial details are not identified yet.')});
}
function remove(id,{quiet=false}={}){
 const removed=stops.find(stop=>stop.id===id);if(!removed)return;
 stops=stops.filter(stop=>stop.id!==id);persist();render();
 if(!quiet)announce(tr('Se quitó '+removed.label+' del recorrido.','Removed '+removed.label+' from the route.'));
}
function row(stop){
 const item=document.createElement('li');item.className='rnVisitPlanStop';item.dataset.destinationId=stop.id;
 const open=document.createElement('button');open.type='button';open.className='rnVisitPlanFocus';
 open.setAttribute('aria-label',tr('Ver ','View ')+stop.label+' · '+stop.floor);
 const name=document.createElement('strong');name.textContent=stop.label;
 const meta=document.createElement('small');meta.textContent=tr('Planta ','Floor ')+stop.floor+
  (stop.commercial?'':tr(' · identidad pendiente',' · identity pending'));
 open.append(name,meta);open.onclick=()=>focus(stop);
 const del=document.createElement('button');del.type='button';del.className='rnVisitPlanRemove';
 del.title=tr('Quitar parada','Remove stop');del.setAttribute('aria-label',tr('Quitar ','Remove ')+stop.label);
 del.innerHTML='<svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>';
 del.onclick=()=>remove(stop.id);item.append(open,del);return item;
}
function render(){
 const size=stops.length;count.textContent=String(size);toggle.hidden=size===0;
 toggle.setAttribute('aria-label',tr('Abrir recorrido · ','Open route · ')+size+' '+
  (size===1?tr('parada','stop'):tr('paradas','stops')));
 summary.textContent=size===1?tr('1 parada guardada en este dispositivo.','1 stop saved on this device.'):
  tr(size+' paradas guardadas en este dispositivo.',size+' stops saved on this device.');
 list.replaceChildren(...stops.map(row));clear.disabled=size===0;
 if(!size)closePanel();syncAction();
 window.dispatchEvent(new CustomEvent('retailnav:visit-plan-change',{detail:{mallId,count:size}}));
}
function updateLanguage(){
 $('rnVisitPlanEyebrow').textContent=tr('TU RECORRIDO','YOUR ROUTE');
 $('rnVisitPlanTitle').textContent=tr('Paradas elegidas','Chosen stops');
 $('rnVisitPlanOrder').textContent=tr('El orden es el que elegiste.','Stops remain in your chosen order.');
 clear.textContent=tr('Vaciar','Clear');
 close.setAttribute('aria-label',tr('Cerrar recorrido','Close route'));
 render();
}
function toggleCurrent(){
 const destination=currentDestination();if(!destination)return;
 if(contains(destination.id)){remove(destination.id);return;}
 if(stops.length>=24){announce(tr('El recorrido admite hasta 24 paradas.','A route can contain up to 24 stops.'));return;}
 stops.push(destination);persist();render();announce(tr(destination.label+' se agregó al recorrido.',
  destination.label+' was added to the route.'));
}
function toggleStore(storeId,floor=null){
 const existing=stops.find(stop=>stop.storeId===storeId);
 if(existing){remove(existing.id);return;}
 const destination=destinationForStore(storeId,floor);if(!destination)return;
 if(stops.length>=24){announce(tr('El recorrido admite hasta 24 paradas.','A route can contain up to 24 stops.'));return;}
 stops.push(destination);persist();render();announce(tr(destination.label+' se agregó al recorrido.',
  destination.label+' was added to the route.'));
}
action.addEventListener('click',toggleCurrent);
toggle.addEventListener('click',()=>panel.hidden?openPanel():closePanel());
close.addEventListener('click',closePanel);
clear.addEventListener('click',()=>{if(!stops.length)return;stops=[];persist();render();
 announce(tr('Se vació el recorrido.','The route was cleared.'));});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden)closePanel();});
document.getElementById('rnLanguageSelect')?.addEventListener('change',()=>requestAnimationFrame(updateLanguage));
document.addEventListener('pointerdown',event=>{
 if(panel.hidden||panel.contains(event.target)||toggle.contains(event.target))return;closePanel();
},{capture:true});
window.addEventListener('retailnav:store-focus-start',()=>requestAnimationFrame(syncAction));
window.addEventListener('retailnav:store-focus-settled',syncAction);
new MutationObserver(()=>requestAnimationFrame(syncAction)).observe(dock,{attributes:true,
 attributeFilter:['hidden','class','data-context']});
new MutationObserver(()=>requestAnimationFrame(syncSearchActions)).observe(document.getElementById('results')||document.body,
 {childList:true,subtree:true});
new MutationObserver(()=>requestAnimationFrame(syncSearchActions)).observe(document.getElementById('rnTagResultCards')||document.body,
 {childList:true,subtree:true});
stops=load();updateLanguage();
window.RetailNavVisitPlanner={getState:()=>({mallId,storageKey,open:!panel.hidden,
 stops:stops.map(stop=>({...stop}))}),open:openPanel,close:closePanel,toggleCurrent,toggleStore,
 containsStore:storeId=>stops.some(stop=>stop.storeId===storeId),
 clear:()=>{stops=[];persist();render();}};
})();
