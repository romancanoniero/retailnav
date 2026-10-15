/* RetailNav mall map cache: versioned, per-shopping, Cache Storage first.
 * No location, contact, or account data is stored in this cache.
 * Source of truth is the build-generated per-mall map version in mallCatalog.
 */
(()=>{
'use strict';
const mall=window.RETAILNAV_ACTIVE_MALL||{};
const mallId=window.RETAILNAV_ACTIVE_MALL_ID||mall.id||'aventura';
const meta=mall.mapAsset||null;
const $=id=>document.getElementById(id);
const screen=$('rnMapDownloadScreen');
const title=$('rnMapDownloadMall');
const message=$('rnMapDownloadMessage');
const detail=$('rnMapDownloadDetail');
const meter=$('rnMapDownloadProgress');
const retry=$('rnMapDownloadRetry');
const CACHE_NAME='retailnav-mall-maps-v1';
const SCHEMA='retailnav.map.bundle.v1';
let phase='checking',origin='pending',cacheStatus='unknown',downloadedBytes=0,errorText='',version=meta?.version||'';
let loading=null;
function state(){
 return {mallId,phase,origin,cacheStatus,version,downloadedBytes,
  error:errorText,overlayVisible:Boolean(screen&&!screen.hidden),cached:origin==='cache'};
}
function present(next,text,percent=null,explanation=''){
 phase=next;
 if(screen)screen.hidden=false;
 if(title)title.textContent=mall.name||'Centro comercial';
 if(message)message.textContent=text;
 if(detail)detail.textContent=explanation;
 if(meter&&percent!==null){
  meter.value=Math.max(0,Math.min(100,Number(percent)||0));
  meter.setAttribute('aria-valuetext',Math.round(meter.value)+' %');
 }
 if(retry)retry.hidden=true;
}
function prepare(text,percent){
 present('preparing',text,percent,'Se abrirá el mapa cuando todas las plantas estén preparadas.');
}
function showError(reason){
 errorText=String(reason||'Error desconocido.');
 present('error','No se pudo descargar el mapa de '+(mall.name||'este shopping')+'.',0,
  'No se mostró un mapa incompleto. Revisá tu conexión y volvé a intentar.');
 if(retry)retry.hidden=false;
 console.error('RetailNav map cache:',errorText);
}
if(retry)retry.addEventListener('click',()=>location.reload());
function safeUrl(){
 if(!meta||typeof meta.url!=='string'||!/^[a-z0-9/-]+[.]json$/i.test(meta.url)||
    !/^([a-f0-9]{64})$/.test(meta.version||'')||
    !/^([a-f0-9]{64})$/.test(meta.sha256||''))throw Error('Información de versión del mapa inválida');
 const uri=new URL(meta.url,document.baseURI);
 const appRoot=new URL('.',document.baseURI);
 const staticUrl=appRoot.pathname+'maps/malls/'+mallId+'-'+meta.version+'.json';
  const dynamicUrl=appRoot.pathname+'api/public/maps/'+mallId+'/'+meta.version+'.json';
  if(uri.origin!==location.origin||![staticUrl,dynamicUrl].includes(uri.pathname))
   throw Error('El mapa no pertenece al shopping y versión seleccionados');
 return uri.href;
}
function validate(bundle){
 if(!bundle||bundle.schema!==SCHEMA||bundle.mallId!==mallId||bundle.version!==meta.version||
    !Array.isArray(bundle.floors)||bundle.floors.length!==meta.floorCount||
    bundle.floors.length===0)throw Error('El archivo no corresponde a la versión del shopping seleccionado.');
 const wanted=mall.floorLabels||[];
 if(wanted.length!==bundle.floors.length||
    bundle.floors.some((f,i)=>!Array.isArray(f)||f.length<5||f[0]!==wanted[i]||
      !Array.isArray(f[3])||f[3].length<1))
  throw Error('El mapa contiene plantas incompletas o de otro centro comercial.');
 return bundle.floors;
}
async function decoded(bytes){
 if(!bytes||bytes.byteLength===0)throw Error('El servidor envió un archivo vacío.');
 if(bytes.byteLength>32*1024*1024)throw Error('El mapa excede el tamaño de seguridad.');
 if(meta.sha256&&window.crypto?.subtle){
  const digest=await window.crypto.subtle.digest('SHA-256',bytes);
  const sum=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  if(sum!==meta.sha256)throw Error('La descarga no coincide con la versión publicada.');
 }
 let obj;
 try{obj=JSON.parse(new TextDecoder().decode(bytes));}
 catch{throw Error('El archivo de mapa recibido no es JSON válido.');}
 return validate(obj);
}
async function openCache(){
 if(!('caches' in window))return null;
 try{return await caches.open(CACHE_NAME);}
 catch{cacheStatus='unavailable';return null;}
}
async function cachedFloors(cache,url){
 if(!cache)return null;
 try{
  const saved=await cache.match(url);
  if(!saved){cacheStatus='miss';return null;}
  const raw=await saved.arrayBuffer();
  const floors=await decoded(raw);
  cacheStatus='hit';
  origin='cache';
  prepare('Abriendo mapa guardado de '+mall.name+'…',84);
  return floors;
 }catch(e){
  cacheStatus='invalid';
  try{await cache.delete(url);}catch{}
  console.warn('RetailNav: mapa guardado inválido, descargando una copia nueva.',e);
  return null;
 }
}
async function readStream(response){
 const total=Number(response.headers.get('content-length'))||Number(meta.bytes)||0;
 if(!response.body?.getReader){
  const bytes=await response.arrayBuffer();
  downloadedBytes=bytes.byteLength;
  present('downloading','Descargando el mapa de '+mall.name+'…',72,
    Math.round(downloadedBytes/1024)+' KB recibidos.');
  return bytes;
 }
 const reader=response.body.getReader();
 const chunks=[];
 let size=0;
 for(;;){
  const {done,value}=await reader.read();
  if(done)break;
  if(!value)continue;
  size+=value.byteLength;
  if(size>32*1024*1024){await reader.cancel();throw Error('Descarga de mapa demasiado grande.');}
  chunks.push(value);
  downloadedBytes=size;
  const pct=total?Math.min(73,Math.round(size/total*73)):Math.min(65,10+size/65536);
  present('downloading','Descargando el mapa de '+mall.name+'…',pct,
   (size/1024).toFixed(0)+' KB'+(total?' de '+(total/1024).toFixed(0)+' KB':'')+' descargados');
 }
 const data=new Uint8Array(size);
 let i=0;
 for(const chunk of chunks){data.set(chunk,i);i+=chunk.byteLength;}
 return data.buffer;
}
async function putCache(cache,url,bytes){
 if(!cache)return;
 try{
  await cache.put(url,new Response(bytes.slice(0),{
   status:200,headers:{'content-type':'application/json;charset=utf-8'}
  }));
  cacheStatus='stored';
  // Old versions of THIS mall can be removed only after the new map has been verified.
  // The cache of other malls must never be affected.
  const start=new URL('maps/malls/'+mallId+'-',document.baseURI).pathname;
  const startDynamic=new URL('api/public/maps/'+mallId+'/',document.baseURI).pathname;
  for(const key of await cache.keys()){
   const pathname=new URL(key.url).pathname;
   const suffix=pathname.startsWith(start)?pathname.slice(start.length):'';
   // Exact mall slug + immutable 64-character content hash, never a prefix
   // match that could accidentally evict a DIFFERENT similarly named mall.
   const dynamicSuffix=pathname.startsWith(startDynamic)?pathname.slice(startDynamic.length):'';
   if(key.url!==url&&(/^[a-f0-9]{64}[.]json$/.test(suffix)||
       /^[a-f0-9]{64}[.]json$/.test(dynamicSuffix)))await cache.delete(key);
  }
 }catch(e){cacheStatus='unavailable';console.warn('El mapa funciona pero no se pudo guardar para uso sin conexión.',e);}
}
async function load(){
 if(loading)return loading;
 loading=(async()=>{
  const url=safeUrl();
  present('checking','Buscando el mapa guardado de '+mall.name+'…',5,
   'Comprobando la versión '+meta.version.slice(0,12)+'.');
  const cache=await openCache();
  const saved=await cachedFloors(cache,url);
  if(saved)return saved;
  present('downloading','Descargando el mapa de '+mall.name+'…',2,
   'No se encontró la versión actual en este dispositivo.');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),90000);
  try{
   const response=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
   if(!response.ok)throw Error('HTTP '+response.status+' al solicitar el mapa.');
   if(response.url&&new URL(response.url).origin!==location.origin)throw Error('Origen de mapa no autorizado.');
   const bytes=await readStream(response);
   const floors=await decoded(bytes); // Validate before storing or displaying.
   origin='network';
   prepare('Preparando mapa descargado de '+mall.name+'…',78);
   await putCache(cache,url,bytes);
   return floors;
  }finally{clearTimeout(timer);}
 })().catch(e=>{showError(e?.name==='AbortError'?'La descarga agotó el tiempo de espera.':e.message);throw e;});
 return loading;
}
function ready(){
 phase='ready';
 if(screen)screen.hidden=true;
 if(retry)retry.hidden=true;
}
if(screen&&title)title.textContent=mall.name||'Centro comercial';
window.RetailNavMapCache={
 load,prepare,ready,showError,getState:state,
 // Source-of-truth version is published by the current HTML release,
 // so a cached map from another mall or an older version is NEVER shown.
 metadata:()=>meta?{mallId,version:meta.version,url:meta.url,bytes:meta.bytes,floorCount:meta.floorCount}:null
};
})();
