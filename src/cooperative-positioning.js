/* RetailNav web positioning cooperation: opt-in, transient, QR fallback.
 * No silent microphone/BLE discovery, GPS uploads or assumed distance.
 * Backend references are one-use, 90-second, anonymous, unverified anchors.
 */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const mall=window.RETAILNAV_ACTIVE_MALL||{};
const engine=window.RetailNavPositioningCore;
const indoor=()=>window.RetailNavIndoor?.getState?.()||null;
const panel=$('rnIndoorDialog'),consent=$('rnCoopConsent'),colocated=$('rnCoopColocated');
const offer=$('rnCoopOffer'),join=$('rnCoopJoin'),revoke=$('rnCoopRevoke');
const quality=$('rnCoopQuality'),status=$('rnCoopStatus'),mode=$('rnCoopMode');
const input=$('rnCoopCode'),qr=$('rnCoopQr'),share=$('rnCoopShare'),link=$('rnCoopLink');
if(!panel||!engine||!offer)return;
let activeOffer=null,lastAssessment=null,collaborationUsed=false;
let busy=false,consented=false;
const api=new URL('api/',location.href);
const floorIds=()=>window.__RETAILNAV__?.floors?.map(f=>f.id)||[];
const time=()=>Date.now();
async function request(route,payload){
 const response=await fetch(new URL(route,api),{
  method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify(payload),cache:'no-store'
 });
 let data=null;
 try{data=await response.json();}catch{}
 if(!response.ok)throw Error(data?.error||'No se pudo comunicar con el servidor');
 return data;
}
function statusMessage(value,error=false){
 status.textContent=value;
 status.classList.toggle('error',Boolean(error));
}
function assess(){
 const i=indoor();
 const gps=i?.gpsTimestampMs?{
  altitudeM:i.gpsAltitudeM,verticalAccuracyM:i.gpsVerticalAccuracyM,
  horizontalAccuracyM:i.gpsAccuracyM,timestampMs:i.gpsTimestampMs
 }:null;
 const a=i?.anchor?{...i.anchor,
  uncertaintyM:i.motionScaleCalibrated?i.uncertaintyMetres:null}:null;
 return engine.evaluate({
  gps,anchor:a,nearMall:i?.nearMall===true,
  calibration:mall.geodeticFloorCalibration||null,
  floorIds:floorIds()
 });
}
function refresh(){
 lastAssessment=assess();
 const i=indoor(),a=i?.anchor;
 const gps=lastAssessment;
 const floorGps=gps.floorFromGps?
  ' · planta GPS candidata: '+gps.floorFromGps:'';
 const state=gps.status==='manual-reference'?'Referencia propia registrada.':
  gps.status==='cooperative-provisional'?'Referencia colaborativa sin distancia verificada.':
  gps.status==='gps-near-mall'?'GPS cercano al shopping; piso interior desconocido.':
  gps.status==='gps-only'?'GPS no confirma ubicación interior.':
  'Sin punto interior: elegí un lugar del plano o recibí una referencia.';
 const help=gps.helpNeeded?' Conviene solicitar una referencia.':
  ' No hace falta conexión con otros teléfonos.';
 quality.textContent=state+floorGps+help;
 const web=engine.chooseTransport({browser:true});
 mode.textContent='Web: '+web.method+
  ' · no se presupone Bluetooth/UWB ni medición acústica en Safari.';
 const canOffer=consented&&a?.source==='manual'&&
  Number.isFinite(a.timestampMs)&&time()-a.timestampMs<=120000&&
  floorIds().includes(a.floor);
 offer.disabled=busy||!canOffer;
 join.disabled=busy||!consented||!colocated.checked||!input.value.trim();
 revoke.disabled=busy||!activeOffer;
 if(activeOffer&&time()>=activeOffer.expiresAt){
  activeOffer=null;share.hidden=true;revoke.disabled=true;
  statusMessage('La referencia expiró. Podés generar otra desde una posición manual reciente.');
 }
 return lastAssessment;
}
async function ensureSession(){
 await request('session',{});
}
async function publishOffer(){
 if(busy)return;
 refresh();
 if(offer.disabled){statusMessage('Marcá de nuevo tu punto en el mapa antes de ofrecer una referencia.',true);return;}
 busy=true;refresh();
 try{
  await ensureSession();
  const p=indoor().anchor;
  const response=await request('positioning/offer',{
   mallId:mall.id,source:'manual-anchor',
   floor:p.floor,x:p.x,y:p.y,observedAtMs:p.timestampMs,
   explicitConsent:true
  });
  const address=new URL(location.href);
  address.search='';
  address.searchParams.set('mall',mall.id);
  address.hash='rnp='+encodeURIComponent(response.code);
  link.value=address.href;
  qr.replaceChildren();
  if(typeof QRCode!=='undefined'){
   new QRCode(qr,{text:address.href,width:176,height:176,
    colorDark:'#102133',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
  }
  activeOffer={expiresAt:response.expiresAt};
  share.hidden=false;
  statusMessage('Mostrá este QR EN PERSONA. Expira en 90 segundos y solo puede utilizarse una vez. No mide distancias.');
  window.setTimeout(()=>refresh(),Math.max(0,response.expiresAt-time())+100);
 }catch(e){statusMessage('No se publicó la referencia: '+e.message,true);}
 finally{busy=false;refresh();}
}
function extractCode(raw){
 const s=String(raw||'').trim();
 if(/^[A-Za-z0-9_-]{40,90}$/.test(s))return s;
 try{
  const u=new URL(s,location.href);
  const p=new URLSearchParams(u.hash.replace(/^#/,''));
  const token=p.get('rnp');
  return /^[A-Za-z0-9_-]{40,90}$/.test(token||'')?token:null;
 }catch{return null;}
}
async function acceptReference(){
 if(busy||!consented||!colocated.checked)return;
 const code=extractCode(input.value);
 if(!code){statusMessage('Pegá un código o enlace QR válido de RetailNav.',true);return;}
 busy=true;refresh();
 try{
  await ensureSession();
  const result=await request('positioning/claim',{
   code,mallId:mall.id,explicitConsent:true,confirmColocated:true
  });
  if(result.mallId!==mall.id||result.physicalProximityVerified!==false||
      !floorIds().includes(result.floor)||
      !window.RetailNavIndoor?.adoptPeerAnchor?.(result))
   throw Error('Referencia no aplicable: verificá el shopping y la planta');
  collaborationUsed=true;
  input.value='';colocated.checked=false;
  if(location.hash.includes('rnp=')){
   history.replaceState(history.state,'',location.pathname+location.search);
  }
  statusMessage('Referencia recibida. La cercanía fue declarada, NO medida. Verificá visualmente tu posición en el plano.');
 }catch(e){statusMessage('No se pudo aceptar: '+e.message,true);}
 finally{busy=false;refresh();}
}
async function cancelOffer(){
 if(busy)return;
 busy=true;refresh();
 try{
  await ensureSession();
  await request('positioning/revoke',{});
  activeOffer=null;share.hidden=true;
  statusMessage('Referencia cancelada. Ningún código vigente queda compartido.');
 }catch(e){statusMessage('Cancelación no confirmada: '+e.message,true);}
 finally{busy=false;refresh();}
}
consent.addEventListener('change',()=>{
 consented=consent.checked;
 if(!consented){
  if(activeOffer)cancelOffer();
  else statusMessage('Colaboración desactivada. Ningún dato de sensores se envía.');
 }
 refresh();
});
colocated.addEventListener('change',refresh);
input.addEventListener('input',refresh);
offer.addEventListener('click',publishOffer);
join.addEventListener('click',acceptReference);
revoke.addEventListener('click',cancelOffer);
$('rnCoopCopy')?.addEventListener('click',async()=>{
 try{
  if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(link.value);
  else{link.focus();link.select();document.execCommand('copy');}
  statusMessage('Enlace copiado. Mostralo solo a quien está físicamente junto a vos.');
 }catch{statusMessage('Seleccioná el enlace y copialo manualmente.',true);}
});
window.addEventListener('retailnav:indoor-observation',()=>{
 // Resetting local positioning never leaves a published reference active.
 if(!indoor()?.anchor&&activeOffer)cancelOffer();
 refresh();
});
window.addEventListener('retailnav:ready',refresh);
document.addEventListener('visibilitychange',refresh);
window.addEventListener('online',refresh);
window.addEventListener('offline',refresh);
// Opening a QR in Safari navigates to the same web app, NOT to a tracking URL.
// Token is in the hash, which is not sent as a Referer or server request path.
const startupCode=new URLSearchParams(location.hash.replace(/^#/,'')).get('rnp');
if(startupCode&&extractCode(startupCode)){
 input.value=startupCode;
 history.replaceState(history.state,'',location.pathname+location.search);
 window.addEventListener('load',()=>{
  if(!panel.open)panel.showModal();
  statusMessage('QR detectado. Marcá las dos autorizaciones y aceptá la referencia únicamente si estás junto al otro teléfono.');
  refresh();
 },{once:true});
}
refresh();
window.RetailNavCooperativePositioning=Object.freeze({
 getState:()=>({consent:consented,
  offerActive:Boolean(activeOffer&&activeOffer.expiresAt>time()),
  quality:lastAssessment,
  method:engine.chooseTransport({browser:true}),
  collaborationUsed,
  scansWithoutConsent:false,transmitsRawGps:false,
  physicalRangingVerified:false,
  serverPersistence:'ephemeral-memory-only'
 }),
 refresh
});
})();
