/* Mall-specific store IDs read from floor plan. These labels are geographically
 * approximate and not proof of a doorway, lease, accessibility or tenant name.
 * Unmatched codes are still searchable and remain distinct records.
 */
(()=>{
'use strict';
const mall=window.RETAILNAV_ACTIVE_MALL||{};
const units=Array.isArray(mall.units)?mall.units.filter(u=>u.activeMap!==false):[];
const i18n=window.RetailNavI18n;
const host=document.getElementById('rnUnitOverlay');
const detail=document.getElementById('rnUnitInfo');
const title=document.getElementById('rnUnitName');
const sub=document.getElementById('rnUnitDescription');
let selected=null,visibleCount=0,frames=0;
let searchHighlights=[];
let committedQuery='';
const normalized=text=>String(text||'').trim().normalize('NFD')
 .replace(/[\u0300-\u036f]/g,'').toLowerCase();
const storeKey=u=>u.storeId||(mall.id+':'+u.floor+':'+u.code);
const unitByStoreId=new Map(units.map(u=>[storeKey(u),u]));
const mapEvidence=new Set(['official-location-suite-and-polygon-id',
 'official-directory-location-and-source-polygon-id']);
function getMapBindings(store){
 const unit=unitByStoreId.get(typeof store==='string'?store:store?.storeId);
 const binding=unit?.sourceGeometry;
 if(!unit||unit.mallId!==mall.id||!binding||binding.mallId!==mall.id||
  binding.storeId!==unit.storeId||!mall.sourceMapSha256||
  binding.sourceSha256!==mall.sourceMapSha256||!mapEvidence.has(binding.evidence)||
  !Array.isArray(binding.polygons))return[];
 const loadedFloors=window.__RETAILNAV__?.floors;
 return [...new Map(binding.polygons.filter(p=>p&&typeof p.floor==='string'&&
  typeof p.polygonId==='string'&&p.polygonId&&(!loadedFloors||loadedFloors.some(f=>
   f.id===p.floor&&f.features.some(feature=>feature.id===p.polygonId))))
  .map(p=>[p.floor+':'+p.polygonId,{...p}])).values()];
}
function getMappedFloors(store){return [...new Set(getMapBindings(store).map(p=>p.floor))];}
// Display names may repeat; storeId is the stable tenant identity across floors.
const suggestionKey=u=>storeKey(u);
const buttons=new Map();
function find(query){
 // The map and results list must use the same matching rules. Retain all
 // legacy floor records for a matched identity so other malls keep their pins.
 const matches=new Set(findDetailed(query).map(record=>record.storeId));
 return units.filter(unit=>matches.has(storeKey(unit)));
}
function matchesText(values,query){
 return values.filter(Boolean).some(value=>normalized(value).includes(normalized(query))||
  Boolean(i18n?.termsMatch(value,query,{prefix:true})));
}
function findDetailed(query){
 const text=String(query||'').trim();
 if(!text)return[];
 const matched=units.flatMap(unit=>{
  const ids=[...new Set(unit.conceptIds||[])];
  const matchedConceptIds=ids.filter(id=>i18n?.matchConcept(id,text,{prefix:true}));
  const kinds=new Set();
  if(matchesText([unit.name,unit.aliases,unit.code],text))kinds.add('name');
  if(matchesText(unit.productTerms||[],text))kinds.add('product');
  if(matchesText(unit.serviceTerms||[],text))kinds.add('service');
  if(matchesText([unit.category,unit.tags,unit.locationLabel],text))kinds.add('category');
  for(const id of matchedConceptIds){
   const kind=i18n?.concepts?.[id]?.kind;
   if(kind==='product')kinds.add('product');
   else if(kind==='service')kinds.add('service');
   else if(kind==='category'||kind==='cuisine'||kind==='food-type')kinds.add('category');
  }
  if(!kinds.size)return[];
  return[{unit,storeId:storeKey(unit),matchTypes:[...kinds],matchedConceptIds}];
 });
 const unique=new Map();
 for(const record of matched){
  const current=unique.get(record.storeId);
  const mappedFloors=getMappedFloors(record.unit);
  const recordFloors=mappedFloors.length?mappedFloors:[record.unit.floor].filter(Boolean);
  if(!current){record.floors=recordFloors;unique.set(record.storeId,record);continue;}
  current.matchTypes=[...new Set([...current.matchTypes,...record.matchTypes])];
  current.matchedConceptIds=[...new Set([...current.matchedConceptIds,...record.matchedConceptIds])];
  for(const floor of recordFloors)if(!current.floors.includes(floor))current.floors.push(floor);
  const hasLocation=u=>Boolean(u.polygonId||Number.isFinite(u.x)&&Number.isFinite(u.y));
  if(!hasLocation(current.unit)&&hasLocation(record.unit))current.unit=record.unit;
 }
 return[...unique.values()];
}
function tagVocabulary(){
 const known=new Map();
 for(const u of units){
  const terms=[
   ...String(u.tags||'').split(','),
   ...(Array.isArray(u.productTerms)?u.productTerms:[])
  ];
  for(const raw of terms){
   const label=raw.trim(),id=normalized(label);
   if(!id||id.length<2)continue;
   const item=known.get(id)||{label,members:new Map(),verified:0};
   item.members.set(suggestionKey(u),u);item.verified+=Number(Boolean(u.productsVerified));
   known.set(id,item);
  }
 }
 for(const item of known.values())item.count=item.members.size;
 return known;
}
const tags=tagVocabulary();
function suggestions(query,limit=8){
 const q=normalized(query);
 if(!q)return[];
 // Preserve legacy photographed-directory suggestions. Combine them with
 // language-neutral concepts actually linked to shops in THIS mall only.
 const legacy=[...tags.entries()]
  .filter(([key])=>key.includes(q))
  .sort((a,b)=>Number(b[0].startsWith(q))-Number(a[0].startsWith(q))||
   b[1].count-a[1].count||a[1].label.localeCompare(b[1].label))
  .map(([key,data])=>({key,term:data.label,count:data.count,verified:data.verified,
   stores:[...data.members.values()].map(u=>({storeId:storeKey(u),name:u.name||u.code,code:u.code,floor:u.floor}))}));
 const semantic=i18n?.searchSuggestions(query,units,20)||[];
 // A legacy directory tag and a canonical concept can have the same visible
 // label (for example `café`). They are two evidence paths for one suggestion,
 // not two choices for the visitor. Merge by normalized display label and keep
 // the canonical concept identity whenever one is available.
 const unique=new Map();
 for(const entry of [...legacy,...semantic]){
  const id=normalized(entry.term);if(!id)continue;
  const current=unique.get(id);
  if(!current){unique.set(id,{...entry,conceptIds:entry.conceptId?[entry.conceptId]:[],stores:[...(entry.stores||[])]});continue;}
  const preferred=!current.conceptId&&entry.conceptId?entry:current;
  const stores=new Map([...(current.stores||[]),...(entry.stores||[])]
   .map(store=>[store.storeId,store]));
  unique.set(id,{...current,...preferred,
   conceptIds:[...new Set([...(current.conceptIds||[]),current.conceptId,entry.conceptId].filter(Boolean))],
   stores:[...stores.values()],count:stores.size,
   verified:Math.max(current.verified||0,entry.verified||0)});
 }
 return [...unique.values()].sort((a,b)=>{
  const aPrefix=Number(normalized(a.term).startsWith(q));
  const bPrefix=Number(normalized(b.term).startsWith(q));
  return bPrefix-aPrefix||b.count-a.count||a.term.localeCompare(b.term);
 }).slice(0,Math.max(0,Math.min(15,limit)));
}
function setQuery(text){
 const query=String(text||'').trim();
 const next=query?find(query).map(storeKey):[];
 if(committedQuery===query&&searchHighlights.join('|')===next.join('|'))return;
 committedQuery=query;
 searchHighlights=next;
 window.__RETAILNAV__?.invalidate?.();
}
function clearQuery(){setQuery('');}
function getHighlightedCodes(){
 const active=new Set(searchHighlights);
 return units.filter(u=>active.has(storeKey(u))).map(u=>u.code);
}
function getMatchedVectors(){
 const active=new Set(searchHighlights);
 return [...new Map(units.filter(u=>active.has(storeKey(u))).flatMap(u=>{
  const bindings=getMapBindings(u);
  if(bindings.length)return bindings;
  return u.polygonId&&u.vectorRelation!=='shared-vector-unverified'?[{floor:u.floor,polygonId:u.polygonId}]:[];
 }).map(p=>[p.floor+':'+p.polygonId,{...p,vectorVerified:false}])).values()];
}
function focusUnit(u,floor){
 if(!u)return false;
 if(window.RetailNavMeetups?.selectStore)return window.RetailNavMeetups.selectStore(u.storeId,false,floor||u.floor);
 document.getElementById('rnMapSearch')?.classList.remove('finding');
 document.getElementById('search')?.blur();
 selected=storeKey(u);
 title.textContent=u.nameStatus==='official-directory'?u.name:
  (u.name?u.name+(u.code?' · ':''):'')+(u.code||'');
 const activity=u.conceptIds?.length
  ?' · '+(i18n?.ui('category')||'Tipo de local')+': '+i18n.summary(u,8)
  :(u.category?' · '+u.category:'');
 sub.textContent=(u.polygonId
  ?'Sector cromático provisional '+u.polygonId+
   '. Puede incluir varios locales y no es la puerta de la tienda.'
  :Number.isFinite(u.x)&&Number.isFinite(u.y)
   ?'Código de directorio con ubicación aproximada del texto, sin pared atribuida.'
   :'Comercio identificado en el directorio; ubicación exacta sin verificar.')+
   (u.locationLabel?' Ubicación publicada: '+u.locationLabel+'.':'')+
   activity+(u.tags?' · Etiquetas del directorio: '+u.tags.replaceAll(',',', '):'')+
   (u.productTerms?.length?' · '+(i18n?.ui('products')||'Productos asociados')+': '+u.productTerms.join(', '):'')+
   '. '+(i18n?.ui('mapWarning')||'La presencia comercial puede cambiar.');
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
 window.__RETAILNAV__?.focusCatalogStore?.(u.storeId,floor||u.floor,[u.x,u.y],u.polygonId);
 window.__RETAILNAV__?.invalidate?.();
 return true;
}
function focus(code,floor){
 return focusUnit(units.find(x=>x.code===code&&
  (floor===undefined||x.floor===floor||getMappedFloors(x).includes(floor))),floor);
}
function selectStoreOnly(storeId){
 const unit=units.find(u=>storeKey(u)===storeId);
 if(!unit)return false;
 selected=storeId;
 window.__RETAILNAV__?.invalidate?.();
 return true;
}
function focusStore(storeId,floor){
 const matches=units.filter(x=>storeKey(x)===storeId);
 const u=matches.find(x=>x.polygonId||Number.isFinite(x.x)&&Number.isFinite(x.y))||matches[0];
 return focusUnit(u,floor||u?.floor);
}
function paint(){
 if(!host)return;
 const view=window.__RETAILNAV__,state=view?.getState();
 if(!state?.ready)return;
 frames++;visibleCount=0;
 const webglSigns=state.renderer==='WebGL'&&window.RetailNavUnits?.draw3D;
 const sourceMarkerOverlay=webglSigns&&mall.id==='alto-palermo';
 if(webglSigns&&!sourceMarkerOverlay){
  for(const el of buttons.values())el.hidden=true;
  return;
 }
 const codesOn=state.distance<(sourceMarkerOverlay?230:145)||Boolean(selected)||Boolean(searchHighlights.length);
 const floors=new Set(state.visible);
 const occupied=[];
 for(const u of units){
  const key=storeKey(u);
  let el=buttons.get(key);
  if(!el){
   el=document.createElement('button');
   el.type='button';el.className='rnUnitCode';
   el.textContent=u.sourceGeometry?u.name:(u.code||u.name);
   el.dataset.unitCode=u.code;el.dataset.storeId=key;
   el.title=u.code?(u.name?u.code+' · '+u.name:u.code+' · código del plano'):
    u.name+' · sin código publicado';
   el.setAttribute('aria-label','Local '+el.title);
   el.addEventListener('click',e=>{e.stopPropagation();focusUnit(u,u.floor)});
   host.appendChild(el);buttons.set(key,el);
  }
  // A mapped shop receives real roof-attached WebGL lettering. An unmatched
  // official marker remains a small 2D code at its published marker position;
  // it does not claim ownership of a nearby roof.
  if(webglSigns&&u.polygonId){el.hidden=true;continue;}
  if((state.focusFloorId&&u.storeId!==state.focusedStoreId)||!Number.isFinite(u.x)||!Number.isFinite(u.y)||!codesOn||
    !floors.has(u.floor)||(selected&&key!==selected&&state.distance>=145&&!searchHighlights.includes(key))){
   el.hidden=true;continue;
  }
  const world=view.pinWorld(u.floor,u.x,u.y);
  const p=world&&view.projectWorld([world[0],world[1]+2.9,world[2]]);
  if(!p||p.w<=0||p.z>=1||p.z<=-1||p.x<27||p.x>host.clientWidth-27||p.y<8||p.y>host.clientHeight-10){
   el.hidden=true;continue;
  }
  const rect=[p.x-23,p.y-12,p.x+23,p.y+12];
  const collides=occupied.some(q=>rect[0]<q[2]+3&&rect[2]>q[0]-3&&rect[1]<q[3]+3&&rect[3]>q[1]-3);
  if(collides&&key!==selected&&!searchHighlights.includes(key)){el.hidden=true;continue;}
  occupied.push(rect);
  el.hidden=false;el.classList.toggle('selected',key===selected);
  el.classList.toggle('search-match',searchHighlights.includes(key));
  el.style.left=p.x.toFixed(1)+'px';el.style.top=p.y.toFixed(1)+'px';
  visibleCount++;
 }
}
document.getElementById('rnUnitClose')?.addEventListener('click',()=>{detail.hidden=true;selected=null;window.__RETAILNAV__?.invalidate?.();});
window.RetailNavUnits={draw:paint,focus,focusStore,selectStoreOnly,find,findDetailed,suggestions,setQuery,clearQuery,
 getHighlightedCodes,getHighlightedStoreIds:()=>searchHighlights.slice(),
 getMatchedVectors,getMapBindings,getMappedFloors,
 getUnits:()=>units.slice(),getState:()=>({
 count:units.length,selected,frames,visibleCount,searchHighlights:searchHighlights.slice(),
 committedQuery,matchedVectorCount:getMatchedVectors().length,tagCount:tags.size,
 matched:units.filter(u=>u.polygonId).length,
 located:units.filter(u=>Number.isFinite(u.x)&&Number.isFinite(u.y)).length,
 withTags:units.filter(u=>u.tags).length,
 withNames:units.filter(u=>u.name).length,
 facadeCount:units.filter(u=>u.facade).length,
 withConcepts:units.filter(u=>(u.conceptIds||[]).length).length,
 language:i18n?.locale?.()||'es',
 unmatched:units.filter(u=>!u.polygonId).length
})};
})();
