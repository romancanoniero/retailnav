/* RetailNav automatic local positioning. Geolocation starts at app startup;
 * the BROWSER still owns the permission decision. Photo-only malls cannot
 * turn a GNSS fix into a fabricated indoor floor or pixel coordinate.
 * Motion requires gesture/scale calibration; peer sharing remains opt-in.
 * Raw coordinates and sensor observations never leave this module.
 */
(()=>{
'use strict';
const mall=window.RETAILNAV_ACTIVE_MALL||{};
const coordinateSpace=mall.coordinateSpace||'mall-photo-pixels';
const matchesFrame=p=>p&&(p.mallId===undefined||p.mallId===mall.id)&&
 (p.coordinateSpace||'mall-photo-pixels')===coordinateSpace;
const validPoint=p=>matchesFrame(p)&&[p.x,p.y].every(Number.isFinite);
const $=id=>document.getElementById(id);
const ui={open:$('rnIndoorBtn'),panel:$('rnIndoorDialog'),
 close:$('rnIndoorClose'),gps:$('rnGPSBtn'),anchor:$('rnAnchorBtn'),
 compass:$('rnCompassBtn'),align:$('rnHeadingAlignBtn'),
 motion:$('rnMotionBtn'),scale:$('rnScale100Input'),
 status:$('rnIndoorStatus'),heading:$('rnHeadingStatus'),
 position:$('rnIndoorPositionStatus'),point:$('rnMyPositionMarker'),
 reset:$('rnIndoorResetBtn'),live:$('rnAutoLocationStatus')};
if(!ui.panel||!ui.point)return;
let near=false,gpsAccuracy=null,gpsDistance=null,geoWatch=null;
let gpsAltitude=null,gpsVerticalAccuracy=null,gpsObservedAt=null;
let gpsLatitude=null,gpsLongitude=null,gpsStatus='starting';
let gpsStartedAutomatically=false,gpsManuallyStopped=false,gpsGeneration=0;
let anchor=null,heading=null,headingSource='unavailable',compassEnabled=false;
let compassOffset=null,stepEnabled=false,steps=0,lastMotion=0,gravitational=9.81;
let uncertaintyMetres=null,motionScale=null,compassListener=false,motionListener=false;
const reference=mall.defaultVisitorReference||{};
const entry=reference.entry;
const fallbackAnchor=validPoint(entry)&&
 typeof entry.floor==='string'?{
  floor:entry.floor,x:entry.x,y:entry.y,source:'fallback-entry',mallId:mall.id,coordinateSpace,
  name:entry.name,entryVerified:Boolean(entry.entryVerified),timestampMs:null
 }:null;
function effectiveReference(){
 // Explicit manual, peer or surveyed fixes take precedence unless clearly outside.
 const outside=gpsStatus==='active'&&!near&&Number.isFinite(gpsDistance)&&
  Number.isFinite(gpsAccuracy)&&gpsDistance>(mall.gps?.radiusM||0)+Math.max(500,gpsAccuracy*2);
 return outside?(fallbackAnchor||null):(anchor||fallbackAnchor||null);
}
const referenceFloor=()=>effectiveReference()?.floor||reference.floor||null;
const radians=d=>d*Math.PI/180;
function proximity(lat,lon) {
 if(!mall.gps)return Infinity;
 const phi=radians(lat),ph2=radians(mall.gps.lat),dl=radians(lon-mall.gps.lon);
 const dphi=ph2-phi;
 const a=Math.sin(dphi/2)**2+Math.cos(phi)*Math.cos(ph2)*Math.sin(dl/2)**2;
 return 6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function renderLiveLocation(){
 const fresh=Number.isFinite(gpsObservedAt)&&Date.now()-gpsObservedAt<30000;
 const hasFix=fresh&&Number.isFinite(gpsLatitude)&&Number.isFinite(gpsLongitude);
 const a=anchor,validAnchor=a&&Number.isFinite(a.timestampMs)&&
   Date.now()-a.timestampMs<(a.source==='gps-survey-registered'?30000:
     a.source==='peer-qr-colocation-asserted'?120000:30*60000);
 let text='Buscando ubicación…',state='locating';
 if(gpsStatus==='denied'){text='Ubicación no autorizada · tocar ◎';state='blocked';}
 else if(gpsStatus==='unavailable'){text='GPS no disponible · ubicación manual';state='blocked';}
 else if(gpsStatus==='stopped'){text='Ubicación detenida';state='stopped';}
 else if(hasFix){
  text='GPS ±'+Math.round(gpsAccuracy??0)+' m · '+(near?'Shopping cercano':'Zona sin confirmar');
  state='located';
 }else if(gpsStatus==='timeout'||gpsStatus==='error'){
  text='Señal GPS insuficiente · reintentar';state='waiting';
 }else if(gpsStatus==='stale'){text='GPS antiguo · esperando señal';state='waiting';}
 if(validAnchor){
  const type=a.source==='gps-survey-registered'?'GPS 3D calibrado':
    a.source==='peer-qr-colocation-asserted'?'QR provisional':'Punto manual';
  text=type+' · '+a.floor+(hasFix?' · ±'+Math.round(gpsAccuracy??0)+' m GPS':'');
  state=a.source==='gps-survey-registered'?'verified':'referenced';
 }else if(hasFix){
  text='GPS ±'+Math.round(gpsAccuracy??0)+' m · Piso sin determinar';
 }
 if(!validAnchor&&reference.floor&&gpsStatus!=='stopped'){
  text+=' · Referencia provisional '+reference.floor;
  // Keep GPS permission/fix status independent from the displayed floor:
  // a ground-level fallback is never a substitute for a valid GNSS reading.
  if(state==='locating')state='provisional';
 }
 const full=hasFix?'Lat '+gpsLatitude.toFixed(6)+', Lon '+gpsLongitude.toFixed(6)+
  '. Error horizontal ±'+Math.round(gpsAccuracy??0)+' m. '+
  (Number.isFinite(gpsAltitude)?'Altitud '+Math.round(gpsAltitude)+' m. ':'Altitud no disponible. ')+
  (Number.isFinite(gpsVerticalAccuracy)?'Precisión vertical ±'+
   Math.round(gpsVerticalAccuracy)+' m. ':'Precisión vertical no disponible. '):'';
 if(ui.live){ui.live.textContent=text;ui.live.dataset.state=state;
  ui.live.title=full+(validAnchor?' Planta candidata '+a.floor+'. ':'')+
   'No se inventan plantas ni coordenadas sobre un plano sin calibración.';}
 if(ui.open){
  ui.open.dataset.locationState=state;
  ui.open.title=text+(full?' · '+full:'');
  ui.open.setAttribute('aria-label','Mi ubicación: '+text+'. Abrir detalles');
 }
}
function updateMessage(){
 const gps=near?'Dentro de la zona aproximada de '+mall.name+'.':
  gpsStatus==='starting'||gpsStatus==='locating'?'Localizando automáticamente…':
  gpsStatus==='denied'?'El navegador denegó la ubicación.':
  gpsStatus==='stopped'?'Ubicación automática detenida.':
  gpsDistance===null?'GPS sin señal todavía.':'No se ha confirmado este shopping por GPS.';
 const isPeer=anchor?.source==='peer-qr-colocation-asserted';
 const isSurveyGps=anchor?.source==='gps-survey-registered';
 const place=anchor
  ?(isPeer?'Referencia QR colaborativa no verificada: ':
    isSurveyGps?'GPS 3D registrado con mapa y alturas verificadas: ':
    'Referencia interior manual: ')+
   anchor.floor+' · '+(isPeer?'cercanía declarada, no medida; ':
    isSurveyGps?'coordenadas GNSS calibradas; ':'posición seleccionada; ')+
   (Number.isFinite(uncertaintyMetres)?'incertidumbre orientativa ±'+
      Math.round(uncertaintyMetres)+' m.':'sin precisión métrica calibrada.')
  :fallbackAnchor
   ?'Referencia provisional '+fallbackAnchor.floor+' · '+fallbackAnchor.name+
     '. Acceso dibujado en el plano; NO representa tu ubicación GPS.'
   :'Referencia provisional '+(reference.floor||'sin planta')+
     ': no hay entrada registrada con coordenadas; no se coloca esfera.';
 ui.status.textContent=gps+
  (Number.isFinite(gpsLatitude)&&Number.isFinite(gpsLongitude)?
   ' Latitud '+gpsLatitude.toFixed(6)+'; longitud '+gpsLongitude.toFixed(6)+'.':'')+
  (gpsAccuracy!==null?' Precisión horizontal GPS: ±'+Math.round(gpsAccuracy)+' m.':'')+
  (Number.isFinite(gpsAltitude)?' Altitud GPS: '+Math.round(gpsAltitude)+' m':
    ' Altitud no disponible')+
  (Number.isFinite(gpsVerticalAccuracy)?' (±'+Math.round(gpsVerticalAccuracy)+' m vertical).':
   ' (sin precisión vertical).')+
  ' La planta solo se puede inferir si existen alturas absolutas verificadas.';
 ui.position.textContent=place;
 ui.heading.textContent=heading===null?'Brújula apagada.':
  'Orientación '+Math.round(heading)+'° ('+headingSource+'). '+(
    compassOffset===null?'Aún no alineada al plano.':'Alineada manualmente al mapa.'
  )+(steps?' · '+steps+' pasos detectados':'');
 renderLiveLocation();
}
function reset(){
 // Explicit Stop persists for this page session. Never silently restart a
 // watcher immediately after the user has revoked local positioning.
 gpsManuallyStopped=true;gpsGeneration++;
 anchor=null;heading=null;compassOffset=null;steps=0;near=false;
 gpsDistance=null;gpsAccuracy=null;uncertaintyMetres=null;motionScale=null;
 gpsLatitude=null;gpsLongitude=null;
 gpsAltitude=null;gpsVerticalAccuracy=null;gpsObservedAt=null;stepEnabled=false;
 gpsStatus='stopped';
 if(geoWatch!==null){navigator.geolocation?.clearWatch(geoWatch);geoWatch=null;}
 ui.scale.value='';ui.point.hidden=true;updateMessage();
 window.dispatchEvent(new Event('retailnav:indoor-observation'));
 window.__RETAILNAV__?.invalidate?.();
}
function startGeolocation(automatic=false){
 if(gpsManuallyStopped&&automatic)return false;
 if(!navigator.geolocation){
  gpsStatus='unavailable';updateMessage();return false;
 }
 gpsManuallyStopped=false;
 if(automatic)gpsStartedAutomatically=true;
 const generation=++gpsGeneration;
 if(geoWatch!==null){navigator.geolocation.clearWatch(geoWatch);geoWatch=null;}
 gpsStatus='locating';
 ui.status.textContent=automatic?'Detectando automáticamente tu ubicación…':
  'Actualizando ubicación del navegador…';
 updateMessage();
 try{
 geoWatch=navigator.geolocation.watchPosition(pos=>{
  if(generation!==gpsGeneration||gpsManuallyStopped)return;
  gpsStatus='active';
  gpsLatitude=Number.isFinite(pos.coords.latitude)?pos.coords.latitude:null;
  gpsLongitude=Number.isFinite(pos.coords.longitude)?pos.coords.longitude:null;
  gpsAccuracy=pos.coords.accuracy;
  const observed=window.RetailNavPositioningCore?.gpsObservation(pos);
  gpsAltitude=observed?.altitudeM??null;
  gpsVerticalAccuracy=observed?.verticalAccuracyM??null;
  gpsObservedAt=observed?.timestampMs??null;
  gpsDistance=proximity(pos.coords.latitude,pos.coords.longitude);
  near=gpsDistance<=((mall.gps?.radiusM||0)+Math.min(gpsAccuracy,150));
  // A photo-only mall cannot map GPS to indoor X/Y/Z. A fully registered,
  // surveyed mall may: no BLE, infrastructure or guessed floor required.
  const registered=window.RetailNavPositioningCore?.registeredGpsToPhoto(
    observed,mall.geodeticFloorCalibration||null)?.anchor;
  if(validPoint(registered)&&(anchor===null||
      ['peer-qr-colocation-asserted','gps-survey-registered'].includes(anchor.source))&&
      window.__RETAILNAV__?.floors?.some(f=>f.id===registered.floor)){
    anchor={...registered,mallId:mall.id,coordinateSpace};uncertaintyMetres=registered.uncertaintyM;
    stepEnabled=false;ui.point.hidden=false;
    window.__RETAILNAV__?.invalidate?.();
  }
  if(!near&&anchor){
    // Hide stale mall anchor if GPS leaves the expected area by a large margin.
    const outside=gpsDistance>(mall.gps?.radiusM||0)+Math.max(500,gpsAccuracy*2);
    if(outside){anchor=null;ui.point.hidden=true;}
  }
  updateMessage();
  window.dispatchEvent(new Event('retailnav:indoor-observation'));
 },err=>{
  if(generation!==gpsGeneration||gpsManuallyStopped)return;
  gpsStatus=err.code===1?'denied':err.code===3?'timeout':'unavailable';
  updateMessage();
  window.dispatchEvent(new Event('retailnav:indoor-observation'));
 },{enableHighAccuracy:true,maximumAge:15000,timeout:13000});
 }catch(e){
  if(generation!==gpsGeneration)return false;
  gpsStatus='error';updateMessage();return false;
 }
 return true;
}
ui.open?.addEventListener('click',()=>{updateMessage();ui.panel.showModal();});
ui.close?.addEventListener('click',()=>ui.panel.close());
ui.reset?.addEventListener('click',reset);
ui.gps?.addEventListener('click',()=>startGeolocation(false));
// Geolocation requires a browser/system permission, but generally not a
// gesture; start on page load without waiting for the user to press ◎.
// If an engine requires a gesture, the explicit refresh button remains.
window.setTimeout(()=>startGeolocation(true),0);
ui.anchor?.addEventListener('click',()=>{
 ui.panel.close();
 if(!window.__RETAILNAV__?.getState().ready)return;
 window.__RETAILNAV__.beginManualLocation();
});
window.addEventListener('retailnav:map-point',event=>{
 const p=event.detail;
 if(!validPoint(p)||
  !window.__RETAILNAV__?.floors.some(f=>f.id===p.floor))return;
 anchor={floor:p.floor,x:p.x,y:p.y,source:'manual',mallId:mall.id,coordinateSpace,
  timestampMs:Date.now()};
 uncertaintyMetres=motionScale?.5:null;
 steps=0;ui.point.hidden=false;
 ui.position.textContent='Ubicación manual colocada. Activá la brújula y alineá el mapa.';
 window.__RETAILNAV__?.invalidate?.();
 updateMessage();
 window.dispatchEvent(new Event('retailnav:indoor-observation'));
});
function readOrientation(e){
 if(Number.isFinite(e.webkitCompassHeading)){
  heading=(e.webkitCompassHeading+360)%360;
  headingSource='brújula iOS';compassEnabled=true;
 }else if(e.absolute&&Number.isFinite(e.alpha)){
  heading=(360-e.alpha)%360;
  headingSource='brújula absoluta';compassEnabled=true;
 }else if(Number.isFinite(e.alpha)){
  heading=(360-e.alpha)%360;
  headingSource='orientación relativa — necesita alineación';compassEnabled=true;
 }
 updateMessage();window.__RETAILNAV__?.invalidate?.();
}
// Use orientation readings automatically where the browser permits them
// without a user gesture. Safari/iOS still requires the explicit button and
// sensor authorization; never bypass or misstate its permission model.
const orientationCtor=window.DeviceOrientationEvent;
if(orientationCtor&&typeof orientationCtor.requestPermission!=='function'){
 window.addEventListener('deviceorientation',readOrientation,{passive:true});
 compassListener=true;
}
ui.compass?.addEventListener('click',async()=>{
 const ctor=window.DeviceOrientationEvent;
 if(!ctor){ui.heading.textContent='No hay sensor de orientación disponible.';return;}
 try{
  if(typeof ctor.requestPermission==='function'){
   const permission=await ctor.requestPermission();
   if(permission!=='granted')throw Error('Permiso no concedido');
  }
  if(!compassListener){
   window.addEventListener('deviceorientation',readOrientation);
   compassListener=true;
  }
  ui.heading.textContent='Brújula activada. Esperando datos del sensor…';
 }catch(e){ui.heading.textContent='Brújula sin permiso: '+e.message;}
});
ui.align?.addEventListener('click',()=>{
 if(heading===null){ui.heading.textContent='Primero activá la brújula y recibí una lectura.';return;}
 if(!anchor){ui.heading.textContent='Primero indicá en qué punto del plano estás.';return;}
 // The visitor points their phone in the real-world direction matching UP in
 // the displayed floor plan, then taps this. It calibrates map-relative north.
 compassOffset=heading;
 updateMessage();window.__RETAILNAV__?.invalidate?.();
});
function processMotion(e){
 if(!stepEnabled||!anchor||heading===null||compassOffset===null||!motionScale)return;
 const a=e.accelerationIncludingGravity||e.acceleration;
 if(!a||![a.x,a.y,a.z].every(Number.isFinite))return;
 const mag=Math.hypot(a.x,a.y,a.z);
 gravitational=gravitational*.92+mag*.08;
 const now=e.timeStamp||performance.now();
 if(mag-gravitational>1.65&&now-lastMotion>420){
  lastMotion=now;steps++;
  const rad=radians(heading-compassOffset);
  const stride=0.70; // indicative adult stride; not a personal measurement
  const px=stride/motionScale;
  anchor.x+=Math.sin(rad)*px;
  anchor.y-=Math.cos(rad)*px;
  uncertaintyMetres=(uncertaintyMetres||0)+.65;
  if(steps>=30||uncertaintyMetres>18){
   stepEnabled=false;
   ui.position.textContent='Estimación de pasos detenida: demasiada deriva. Recalibrá tu posición.';
  }
  updateMessage();window.__RETAILNAV__?.invalidate?.();
  window.dispatchEvent(new Event('retailnav:indoor-observation'));
 }
}
ui.motion?.addEventListener('click',async()=>{
 if(!anchor||heading===null||compassOffset===null){
  ui.position.textContent='Antes de estimar pasos, calibrá punto y orientación.';return;
 }
 const measured=Number(ui.scale.value);
 if(!Number.isFinite(measured)||measured<1||measured>200){
  ui.position.textContent='Indicá cuántos metros reales representan 100 píxeles del plano (escala medida).';
  return;
 }
 motionScale=measured/100;uncertaintyMetres=Math.max(1,uncertaintyMetres||0);
 const ctor=window.DeviceMotionEvent;
 if(!ctor){ui.position.textContent='Acelerómetro no disponible.';return;}
 try{
  if(typeof ctor.requestPermission==='function'){
   const access=await ctor.requestPermission();
   if(access!=='granted')throw Error('Permiso denegado');
  }
  if(!motionListener){window.addEventListener('devicemotion',processMotion);motionListener=true;}
  stepEnabled=true;
  ui.position.textContent='Pasos experimentales activados. Usá el punto sólo como estimación.';
 }catch(e){ui.position.textContent='Sensor de movimiento: '+e.message;}
});
function draw(){
 // A stale 3D GPS position must never remain rendered as a current fix.
 if(anchor?.source==='gps-survey-registered'&&Date.now()-anchor.timestampMs>30000){
  anchor=null;uncertaintyMetres=null;ui.point.hidden=true;
  gpsStatus=gpsStatus==='active'?'stale':gpsStatus;
  updateMessage();
  window.dispatchEvent(new Event('retailnav:indoor-observation'));
 }
 if(!ui.point)return;
 const referencePoint=effectiveReference();
 if(!referencePoint){ui.point.hidden=true;return;}
 const provisional=referencePoint.source==='fallback-entry';
 ui.point.classList.toggle('is-provisional',provisional);
 ui.point.title=provisional?'Referencia de acceso provisional (NO tu posición): '+referencePoint.name:
  'Referencia interior: '+referencePoint.source;
 ui.point.setAttribute('aria-label',ui.point.title);
 const view=window.__RETAILNAV__;
 if(!view?.getState().visible.includes(referencePoint.floor)){ui.point.hidden=true;return;}
 const world=view.pinWorld(referencePoint.floor,referencePoint.x,referencePoint.y);
 const p=world&&view.projectWorld([world[0],world[1]+2,world[2]]);
 if(!p||p.w<=0||p.z<=-1||p.z>=1||p.x<5||p.y<5||
  p.x>ui.point.parentElement.clientWidth-5||
  p.y>ui.point.parentElement.clientHeight-5){ui.point.hidden=true;return;}
 ui.point.hidden=false;ui.point.style.left=p.x+'px';ui.point.style.top=p.y+'px';
 const arrow=ui.point.querySelector('.rnIndoorArrow');
 if(arrow){
  arrow.hidden=heading===null;
  arrow.title=compassOffset===null?
   'Sentido provisional del teléfono; norte del plano sin calibrar':
   'Orientación de dispositivo calibrada manualmente';
 }
 if(arrow&&heading!==null){
  const r=radians(heading-(compassOffset??0));
  const dist=7;
  const p2=view.projectWorld([world[0]+Math.sin(r)*dist,world[1]+2,world[2]-Math.cos(r)*dist]);
  if(p2&&p2.w>0)arrow.style.transform='translate(-50%,-90%) rotate('+
    (Math.atan2(p2.x-p.x,-(p2.y-p.y))*180/Math.PI)+'deg)';
 }
}
updateMessage();
function adoptPeerAnchor(reference){
 // Only called after consent + explicit QR claim. A peer never proves range.
 const floors=window.__RETAILNAV__?.floors||[];
 if(!reference||reference.source!=='peer-qr-colocation-asserted'||
  reference.mallId!==mall.id||
  !floors.some(f=>f.id===reference.floor)||
  !validPoint(reference)||![reference.x,reference.y].every(v=>
   coordinateSpace==='roveiq:107:local-decimeters-v1'?Math.abs(v)<=10000:v>=0&&v<=2000))return false;
 if(Number.isFinite(reference.expiresAt)&&Date.now()>=reference.expiresAt)return false;
 anchor={floor:reference.floor,x:reference.x,y:reference.y,
  source:'peer-qr-colocation-asserted',mallId:mall.id,coordinateSpace,timestampMs:Date.now()};
 // Without an independently surveyed scale there is NO credible metric error.
 uncertaintyMetres=null;motionScale=null;steps=0;stepEnabled=false;
 ui.scale.value='';
 ui.point.hidden=false;
 updateMessage();window.__RETAILNAV__?.invalidate?.();
 window.__RETAILNAV__?.focusAt?.(anchor.floor,[anchor.x,anchor.y],100);
 window.dispatchEvent(new Event('retailnav:indoor-observation'));
 return true;
}
window.RetailNavIndoor={draw,adoptPeerAnchor,getState:()=>({
 referenceFloor:referenceFloor(),
 referencePoint:effectiveReference()?{...effectiveReference()}:null,
 referenceSource:effectiveReference()?.source||'fallback-floor',
 entryReferenceAvailable:Boolean(fallbackAnchor),
 defaultGroundFloor:reference.floor||null,
 mapHasRecognizedEntrance:Boolean(entry?.entryVerified),
 nearMall:near,gpsAccuracyM:gpsAccuracy,mallDistanceM:gpsDistance,
 gpsLatitude,gpsLongitude,gpsAltitudeM:gpsAltitude,
 gpsVerticalAccuracyM:gpsVerticalAccuracy,gpsTimestampMs:gpsObservedAt,
 gpsStatus,gpsStartedAutomatically,gpsManuallyStopped,
 anchor:anchor?{...anchor}:null,
 indoorSource:anchor?(anchor.source==='manual'?'manual-anchor':
   anchor.source==='gps-survey-registered'?'gps-3d-survey-registered':
   'peer-qr-provisional'):null,
 headingDeg:heading,headingSource,aligned:compassOffset!==null,
 steps,motionScaleCalibrated:motionScale!==null,stepEnabled,
 uncertaintyMetres,geolocationStored:false,sendsDataToServer:false,
 confidence:anchor?(anchor.source==='peer-qr-colocation-asserted'?'peer-unverified':
   anchor.source==='gps-survey-registered'?'gnss-survey-calibrated':
   stepEnabled?'low-dead-reckoning':'manual-anchor'):'none'
})};
window.dispatchEvent(new Event('retailnav:indoor-observation'));
})();