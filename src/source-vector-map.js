/* Native RetailNav SVG renderer. Official coordinates stay in their own frame;
 * photographed-map coordinates and visitor anchors are never reprojected by guesswork. */
(()=>{
'use strict';
const mall=window.RETAILNAV_ACTIVE_MALL;
if(mall?.id!=='aventura')return;
const source=JSON.parse(document.getElementById('rnSourceMapData').textContent);
const NS='http://www.w3.org/2000/svg';
const tr=(es,en)=>(document.documentElement.lang||'es').startsWith('en')?en:es;
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
const svgEl=(tag,attrs={})=>{const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
const project=([lon,lat])=>[(lon+80.143)*100000,-(lat-25.9565)*111320];
const rings=g=>g.type==='Polygon'?g.coordinates:g.type==='MultiPolygon'?g.coordinates.flat():[];
const path=g=>rings(g).map(r=>r.map((p,i)=>(i?'L':'M')+project(p).join(',')).join(' ')+'Z').join(' ');
const root=el('section',null,'rnSourceVectorMap');root.id='rnSourceVectorMap';root.hidden=true;
root.setAttribute('aria-label','RetailNav · mapa vectorial de fuente oficial');
const header=el('header');const title=el('strong');const back=el('button',tr('Plano fotográfico 3D','Photo plan 3D'));
back.type='button';back.onclick=()=>hide();header.append(title,back);
const tabs=el('nav',null,'rnSourceFloors');tabs.setAttribute('aria-label','Plantas del comercio');
const body=el('div',null,'rnSourceMapPanes');const status=el('p',null,'rnSourceRouteStatus');status.setAttribute('role','status');
root.append(header,tabs,body,status);document.querySelector('.stage>.viewport').append(root);
const cameras=new Map();
let revision=0,frames=new Set(),panes=[],state={visible:false,selectedStore:null,highlighted:[],routeVerified:false,route:[],cameraFlying:false};
function hide(){revision++;root.hidden=true;document.body.classList.remove('rnSourceMapOpen');state.visible=false;state.cameraFlying=false;for(const id of frames)cancelAnimationFrame(id);frames.clear();}
function bounds(points){return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];}
function binding(unit){
 const b=unit?.sourceGeometry;
 if(unit?.mallId!==source.mallId||b?.mallId!==source.mallId||b.storeId!==unit.storeId||b.coordinateSpace!==source.coordinateSpace)return [];
 const loc=source.locations.find(l=>l.id===b.locationId);if(!loc)return [];
 return b.polygons.filter(p=>{const f=source.floors.find(f=>f.id===p.floor&&f.sourceFloorId===p.sourceFloorId&&f.datasetId===p.datasetId);
  return loc.suiteIds.includes(p.polygonId)&&f?.features.some(g=>g.id===p.polygonId&&g.locationId===loc.id);});
}
function pane(floorId,selectedIds,label,isMain){
 const floor=source.floors.find(f=>f.id===floorId);if(!floor)return null;
 const panel=el('section',null,isMain?'rnSourceMain':'rnSourceReference');panel.dataset.floor=floorId;
 const heading=el('h4',label+' · '+floorId);const svg=svgEl('svg',{viewBox:'-300 -240 600 480',role:'img','aria-label':label+' '+floorId});
 const group=svgEl('g');svg.append(group);panel.append(heading,svg);body.append(panel);
 for(const g of floor.circulation){if(g.type!=='LineString')continue;
  const n=svgEl('path',{d:g.coordinates.map((p,i)=>(i?'L':'M')+project(p).join(',')).join(' '),class:'rnSourceCirculation'});group.append(n);}
 const all=[];const chosen=[];
 for(const feature of floor.features){
  const points=rings(feature.geometry).flat().map(project);if(!points.length)continue;all.push(...points);
  const selected=selectedIds.includes(feature.id);if(selected)chosen.push(...points);
  const n=svgEl('path',{d:path(feature.geometry),class:'rnSourcePolygon'+(selected?' rnSourceSelected':''),'data-polygon-id':feature.id,'fill-rule':'evenodd'});
  n.append(svgEl('title'));n.firstChild.textContent=selected?state.storeName:(source.locations.find(l=>l.id===feature.locationId)?.name||tr('Geometría fuente','Source geometry'));
  group.append(n);
 }
 for(const c of source.connectors.filter(c=>c.floors.includes(floorId))){const [x,y]=project([c.longitude,c.latitude]);
  const g=svgEl('g',{'data-connector-id':c.id});const circle=svgEl('circle',{cx:x,cy:y,r:2.5,class:'rnSourceConnector'});
  const tip=svgEl('title');tip.textContent=c.name+' · '+c.floors.join(' / ')+tr(' · conexión sin validar para indicaciones',' · connection not validated for guidance');g.append(tip,circle);group.append(g);}
 const box=bounds(all);const overview={x:(box[0]+box[2])/2,y:(box[1]+box[3])/2,scale:Math.min(540/(box[2]-box[0]),420/(box[3]-box[1])),angle:0};
 let camera={...(isMain?cameras.get(floorId)||overview:overview)},animation=0;
 const draw=()=>{group.setAttribute('transform',`scale(${camera.scale}) rotate(${camera.angle}) translate(${-camera.x} ${-camera.y})`);if(isMain)cameras.set(floorId,{...camera});};
 const animate=destination=>{const start={...camera},beg=performance.now(),token=++animation,rev=revision;
  const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:860;state.cameraFlying=duration>0;
  const tick=now=>{if(token!==animation||rev!==revision)return;const t=duration?Math.min(1,(now-beg)/duration):1,k=t*t*(3-2*t);
   for(const key of ['x','y','scale','angle'])camera[key]=start[key]+(destination[key]-start[key])*k;draw();
   if(t<1){const id=requestAnimationFrame(n=>{frames.delete(id);tick(n);});frames.add(id);}else{state.cameraFlying=false;state.camera={...camera};}};tick(beg);};
 const focus=()=>{if(!chosen.length){animate(overview);return;}
  const b=bounds(chosen);let longest=0,angle=0;
  for(const f of floor.features.filter(f=>selectedIds.includes(f.id)))for(const r of rings(f.geometry)){for(let i=1;i<r.length;i++){
   const a=project(r[i-1]),b=project(r[i]),len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len>longest){longest=len;angle=-Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;}}}
  while(angle>90)angle-=180;while(angle< -90)angle+=180;
  animate({x:(b[0]+b[2])/2,y:(b[1]+b[3])/2,scale:Math.min(5,340/Math.max(60,b[2]-b[0],b[3]-b[1])),angle});};
 draw();if(isMain)focus();
 const controls=el('div',null,'rnSourceCameraControls');
 for(const [text,fn] of [['+',()=>zoom(1.35)],['−',()=>zoom(1/1.35)],[tr('Enfocar','Focus'),focus],[tr('Planta completa','Whole floor'),()=>animate(overview)]]){const b=el('button',text);b.type='button';b.onclick=fn;controls.append(b);}panel.append(controls);
 function zoom(factor){animation++;state.cameraFlying=false;camera.scale=Math.max(.25,Math.min(18,camera.scale*factor));draw();}
 svg.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.15:1/1.15);},{passive:false});
 const pointers=new Map();let prior=null;
 svg.addEventListener('pointerdown',e=>{animation++;state.cameraFlying=false;svg.setPointerCapture(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);prior=null;});
 svg.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;const old=pointers.get(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);
  if(pointers.size===2){const [a,b]=[...pointers.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]);if(prior)zoom(d/prior);prior=d;return;}
  const rect=svg.getBoundingClientRect(),ratio=Math.max(600/rect.width,480/rect.height)/camera.scale,rad=camera.angle*Math.PI/180;
  const dx=(e.clientX-old[0])*ratio,dy=(e.clientY-old[1])*ratio;camera.x-=dx*Math.cos(rad)+dy*Math.sin(rad);camera.y-=-dx*Math.sin(rad)+dy*Math.cos(rad);draw();});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])svg.addEventListener(event,e=>{pointers.delete(e.pointerId);prior=null;});
 return {floor:floorId,focus};
}
function show(unit,preferredFloor){
 const canonical=window.RetailNavUnits?.getUnits?.().find(u=>u.storeId===unit?.storeId&&u.mallId===source.mallId);
 if(!canonical||unit.mallId!==source.mallId){hide();return {located:false};}
 unit=canonical;
 hide();state={visible:true,selectedStore:unit.storeId,storeName:unit.name||unit.code,highlighted:[],routeVerified:false,route:[],cameraFlying:false};
 const links=binding(unit);const known=[...new Set(links.map(p=>p.floor).concat(unit.documentedFloors||[]))].filter(id=>source.floors.some(f=>f.id===id));
 const indoor=window.RetailNavIndoor?.getState?.();const reference=window.__RETAILNAV__?.getState?.().referenceFloor||'LL';
 const destination=known.includes(preferredFloor)?preferredFloor:known[0];
 state.destinationFloor=destination||null;state.referenceFloor=reference;state.located=links.length>0;
 root.hidden=false;document.body.classList.add('rnSourceMapOpen');back.textContent=tr('Plano fotográfico 3D','Photo plan 3D');title.textContent=state.storeName+' · '+tr('Mapa vectorial RetailNav','RetailNav vector map');
 body.replaceChildren();tabs.replaceChildren();panes=[];
 for(const f of known){const b=el('button',tr('Destino ','Destination ')+f+(links.some(p=>p.floor===f)?'':tr(' · sin polígono',' · no polygon')));b.type='button';b.setAttribute('aria-pressed',String(f===destination));b.onclick=()=>show(unit,f);tabs.append(b);}
 const selectedIds=links.filter(l=>l.floor===destination).map(l=>l.polygonId);state.highlighted=selectedIds;state.located=selectedIds.length>0;
 const provisional=!indoor?.anchor||['fallback-entry','fallback-floor'].includes(indoor?.referenceSource);
 const refLabel=provisional?tr('Planta de referencia provisional','Provisional reference floor'):tr('Tu planta indicada','Your indicated floor');
 if(destination)panes.push(pane(destination,selectedIds,tr('Destino','Destination'),true));
 if(reference!==destination||!destination)panes.push(pane(reference,[],refLabel,!destination));
 else tabs.append(el('span',refLabel+' · '+reference));
 status.textContent=(selectedIds.length?tr('Polígono vinculado a la fuente oficial. ','Polygon linked to the official source. '):tr('Ubicación exacta sin vincular; vista de planta provisional. ','Exact position not linked; provisional floor view. '))+
  tr('Sin ruta peatonal validada: tu posición no está calibrada en este mapa. Líneas grises: red de circulación fuente; círculos: conectores, incluidas escaleras. No son indicaciones de recorrido.',
  'No verified walking route: your position is not calibrated in this map. Grey lines: source circulation network; circles: connectors, including escalators. These are not walking directions.');
 return {...state,source:true};
}
for(const id of ['rnTagResultClose','showAllFloors','floorSelect','mallSelect'])document.getElementById(id)?.addEventListener('click',hide);
document.getElementById('search')?.addEventListener('input',hide);
window.addEventListener('retailnav:indoor-observation',()=>{if(state.visible){const unit=window.RetailNavUnits?.getUnits?.().find(u=>u.storeId===state.selectedStore);if(unit)show(unit,state.destinationFloor);}});
window.RetailNavSourceMap={show,hide,getState:()=>({...state}),binding};
})();
