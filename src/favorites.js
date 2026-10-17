/* Mall-scoped store favorites. Favorites describe a durable preference and
 * deliberately remain independent from the current visit plan. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const mallId=window.RETAILNAV_ACTIVE_MALL?.id||window.RETAILNAV_ACTIVE_MALL_ID||'';
const storageKey='retailnav:favorites:v1:'+mallId;
const action=$('rnStoreFavorite'),dock=$('rnStoreActions'),toast=$('rnFavoriteToast');
if(!mallId||!action||!dock||!toast)return;
const en=()=>String(document.documentElement.lang||navigator.language||'es').startsWith('en');
const tr=(es,english)=>en()?english:es;
const safe=value=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,180);
let favorites=new Set(),toastTimer=0;

function load(){
 try{
  const raw=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(!raw||raw.schema!=='retailnav.favorites.v1'||raw.mallId!==mallId||!Array.isArray(raw.storeIds))return new Set();
  return new Set(raw.storeIds.slice(0,250).map(safe).filter(id=>id.startsWith(mallId+':')));
 }catch{return new Set();}
}
function persist(){
 try{localStorage.setItem(storageKey,JSON.stringify({schema:'retailnav.favorites.v1',mallId,
  updatedAt:Date.now(),storeIds:[...favorites]}));}catch{}
}
function selectedStoreId(){return safe(window.RetailNavMeetups?.getState?.().selectedStoreId);}
function labelFor(storeId,fallback=''){
 const unit=window.RetailNavUnits?.getUnits?.().find(item=>item.storeId===storeId);
 return safe(unit?.name||unit?.code||fallback||tr('El local','The store'));
}
function announce(message){
 clearTimeout(toastTimer);toast.textContent=message;toast.hidden=false;
 toastTimer=setTimeout(()=>{toast.hidden=true;},1800);
}
function syncSearchActions(){
 for(const button of document.querySelectorAll('.rnStoreFavoriteAction')){
  const storeId=safe(button.dataset.rnFavoriteStore),included=favorites.has(storeId);
  const label=labelFor(storeId,button.dataset.rnFavoriteLabel);
  button.setAttribute('aria-pressed',String(included));
  button.title=included?tr('Quitar de favoritos','Remove from favorites'):tr('Agregar a favoritos','Add to favorites');
  button.setAttribute('aria-label',(included?tr('Quitar ','Remove '):tr('Agregar ','Add '))+label+
   (included?tr(' de favoritos',' from favorites'):tr(' a favoritos',' to favorites')));
 }
}
function syncAction(){
 const storeId=selectedStoreId(),included=favorites.has(storeId);
 action.disabled=!storeId;
 action.setAttribute('aria-pressed',String(included));
 action.title=included?tr('Quitar de favoritos','Remove from favorites'):tr('Agregar a favoritos','Add to favorites');
 action.setAttribute('aria-label',storeId?(included?tr('Quitar este local de favoritos','Remove this store from favorites'):
  tr('Marcar este local como favorito','Add this store to favorites')):
  tr('Seleccioná un comercio identificado para marcarlo como favorito','Select an identified store to add it to favorites'));
 syncSearchActions();
}
function setFavorite(storeId,value,{quiet=false,label=''}={}){
 storeId=safe(storeId);if(!storeId||!storeId.startsWith(mallId+':'))return false;
 const had=favorites.has(storeId);if(value===had){syncAction();return had;}
 if(value){if(favorites.size>=250){announce(tr('Podés guardar hasta 250 favoritos en este shopping.',
  'You can save up to 250 favorites in this mall.'));return false;}favorites.add(storeId);}
 else favorites.delete(storeId);
 persist();syncAction();
 if(!quiet){const name=labelFor(storeId,label);announce(value?
  tr(name+' se agregó a favoritos.',name+' was added to favorites.'):
  tr(name+' se quitó de favoritos.',name+' was removed from favorites.'));}
 window.dispatchEvent(new CustomEvent('retailnav:favorites-change',{detail:{mallId,storeId,favorite:value,
  count:favorites.size}}));
 return value;
}
function toggleStore(storeId,label=''){storeId=safe(storeId);return setFavorite(storeId,!favorites.has(storeId),{label});}
action.addEventListener('click',()=>{const storeId=selectedStoreId();if(storeId)toggleStore(storeId);});
window.addEventListener('retailnav:store-focus-start',()=>requestAnimationFrame(syncAction));
window.addEventListener('retailnav:store-focus-settled',syncAction);
document.getElementById('rnLanguageSelect')?.addEventListener('change',()=>requestAnimationFrame(syncAction));
new MutationObserver(()=>requestAnimationFrame(syncAction)).observe(dock,{attributes:true,
 attributeFilter:['hidden','class','data-context']});
for(const host of [$('results'),$('rnTagResultCards')].filter(Boolean))
 new MutationObserver(()=>requestAnimationFrame(syncSearchActions)).observe(host,{childList:true,subtree:true});
favorites=load();syncAction();
window.RetailNavFavorites={getState:()=>({mallId,storageKey,count:favorites.size,storeIds:[...favorites]}),
 toggleStore,setFavorite,isFavorite:storeId=>favorites.has(safe(storeId)),clear:()=>{
  favorites.clear();persist();syncAction();window.dispatchEvent(new CustomEvent('retailnav:favorites-change',
   {detail:{mallId,storeId:null,favorite:false,count:0}}));}};
})();
