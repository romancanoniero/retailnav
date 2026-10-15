/* RetailNav mall picker, opt-in coarse GPS site recognition, no tracking.
 * Coordinates identify an entire shopping centre, NEVER an indoor floor/passage.
 * Aventura remains the default unless a valid mall= query parameter is present.
 */
(()=>{
'use strict';
const node=document.getElementById('mallCatalog');
let catalog={};
try{catalog=JSON.parse(node?.textContent||'{}');}catch(e){console.error('Mall catalog invalid',e);}
const url=new URL(location.href);
const requested=url.searchParams.get('mall');
const active=Object.hasOwn(catalog,requested)?requested:'aventura';
window.RETAILNAV_MALL_CATALOG=catalog;
window.RETAILNAV_ACTIVE_MALL_ID=active;
window.RETAILNAV_ACTIVE_MALL=catalog[active];
window.RetailNavThemes?.apply?.(catalog[active]);
function get(id){return document.getElementById(id);}
// Mall branding uses an official logo mark to the LEFT of the mall name.
// The persisted VPS brand registry is authoritative; use the previously
// reviewed copy as a fallback when the optional API is unavailable.
function setMallHeaderBrand(mall){
 const header=get('mallHeaderName'),img=get('mallHeaderLogo');
 if(header)header.textContent=mall.name||'Centro comercial';
 // The separate loader-brand script has already loaded the logo before
 // this large catalog/viewer script, so never reset the loader here.
 window.RETAILNAV_BRAND_STATUS={mallId:mall.id,source:'none',databaseRegistered:false,visible:false};
 if(!img)return;
 img.hidden=true;img.removeAttribute('src');header?.classList.remove('rnHasWordmark');
 img.alt='Símbolo de '+(mall.name||'centro comercial');
 const appRoot=new URL('.',document.baseURI);
 function safeImage(raw){
  if(typeof raw!=='string'||!raw.trim())return null;
  try{
   const uri=new URL(raw,document.baseURI);
   if(uri.origin!==location.origin||!uri.pathname.startsWith(appRoot.pathname)||
      !/\.(?:svg|png|webp|jpe?g)$/i.test(uri.pathname))return null;
   return uri;
  }catch{return null;}
 }
 const fallback=safeImage(mall.logoSymbolUrl||mall.logoUrl||mall.logo);
 const state=window.RETAILNAV_BRAND_STATUS;
 if(fallback){
  img.onload=()=>{img.hidden=false;state.visible=true;};
  img.onerror=()=>{img.hidden=true;state.visible=false;};
  img.src=fallback.href;
  state.source='static';
 }
 const endpoint='api/mall-brands/'+mall.id;
 if(mall.publicLogoMetadataUrl!==endpoint||!/^[a-z0-9-]{2,80}$/.test(mall.id))return;
 // Never block map loading for a decorative brand asset.
 window.RETAILNAV_BRAND_REQUEST=(async()=>{
  try{
   const reply=await fetch(new URL(endpoint,document.baseURI),{
    method:'GET',credentials:'same-origin',cache:'no-store'
   });
   if(!reply.ok)return false;
   const record=await reply.json();
   if(record.mallId!==mall.id||record.available!==true||
      record.logo?.placement!=='left-of-name'||
      record.logo?.mime!=='image/svg+xml'||
      !/^[a-f0-9]{64}$/.test(record.logo.sha256||'')||
      record.logo.url!==endpoint+'/logo.svg')return false;
   const logo=safeImage(record.logo.url);
   if(!logo)return false;
   const probe=new Image();
   const ready=await new Promise(resolve=>{
    probe.onload=()=>resolve(true);
    probe.onerror=()=>resolve(false);
    probe.src=logo.href;
   });
   if(!ready)return false;
   // Only replace the static logo after successfully loading the DB asset.
   img.src=logo.href;
   img.hidden=false;
   window.RetailNavLoaderBrand?.useVerifiedLogo?.(logo.href);
   state.source='database';
   state.visible=true;
   state.databaseRegistered=true;
   return true;
  }catch(error){
   console.warn('RetailNav: logo persistente no disponible; usando la copia de respaldo.',error);
   return false;
  }
 })();
}
setMallHeaderBrand(window.RETAILNAV_ACTIVE_MALL);
function human(mall){return mall.name+' · '+mall.city+(mall.status==='vectorizado-provisional'?' · EN REVISIÓN':'');}
const panel=get('mallSettingsDialog');
const select=get('mallSelect');
if(!panel||!select)return;
for(const id of Object.keys(catalog)){
  const option=document.createElement('option');
  option.value=id;
  option.textContent=human(catalog[id]);
  select.append(option);
}
select.value=active;
window.RetailNavThemes?.setupEditor?.();
function switchMall(id){
  if(!Object.hasOwn(catalog,id))return;
  const destination=new URL(location.href);
  destination.searchParams.set('mall',id);
  // The URL is the explicit source of truth; no IP/device fingerprint/storage.
  location.assign(destination.toString());
}
get('mallSettingsBtn').addEventListener('click',()=>{
  select.value=active;
  get('mallLocationStatus').textContent='La ubicación GPS está desactivada hasta que pulses el botón.';
  panel.showModal();
});
get('mallSettingsClose').addEventListener('click',()=>panel.close());
get('mallApplyBtn').addEventListener('click',()=>switchMall(select.value));
get('mallDetectBtn').addEventListener('click',()=>{
  const output=get('mallLocationStatus');
  if(!navigator.geolocation){
    output.textContent='Este navegador no ofrece ubicación GPS.';
    return;
  }
  output.textContent='Solicitando permiso para determinar el shopping cercano…';
  navigator.geolocation.getCurrentPosition(position=>{
    const lat=position.coords.latitude,lon=position.coords.longitude;
    const rad=x=>x*Math.PI/180;
    const distances=Object.values(catalog).filter(x=>x.gps).map(mall=>{
      const dlat=rad(mall.gps.lat-lat),dlon=rad(mall.gps.lon-lon);
      const a=Math.sin(dlat/2)**2+
        Math.cos(rad(lat))*Math.cos(rad(mall.gps.lat))*Math.sin(dlon/2)**2;
      return {mall,metres:6371000*2*Math.asin(Math.min(1,Math.sqrt(a)))};
    }).sort((a,b)=>a.metres-b.metres);
    const nearest=distances[0];
    if(nearest&&nearest.metres<=nearest.mall.gps.radiusM+Math.max(100,position.coords.accuracy)){
      select.value=nearest.mall.id;
      output.textContent='Cerca de '+nearest.mall.name+' (aprox. '+Math.round(nearest.metres)+' m del punto de referencia). Pulsa “Cambiar mapa” para confirmar. El GPS NO indica planta ni pasillo.';
    }else{
      output.textContent='No hay un shopping del catálogo suficientemente cerca. Puedes elegirlo manualmente.';
    }
  },error=>{
    output.textContent=error.code===1?'Permiso de GPS denegado. Puedes seleccionar el shopping manualmente.':'No se pudo determinar tu ubicación. El selector manual sigue disponible.';
  },{enableHighAccuracy:false,timeout:12000,maximumAge:60000});
});
})();