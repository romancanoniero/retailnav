/* The white map-download layer must show the selected mall's real logo
 * before the large map viewer, catalog and social modules have parsed.
 * Build-web injects a small, validated public identity manifest immediately
 * following the loading layer. No user IDs, positions or private mall data.
 */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const icon=$('rnMapDownloadLogo'),title=$('rnMapDownloadMall');
 const source=$('rnLoaderBrandCatalog');
 let entries={};
 try{entries=JSON.parse(source?.textContent||'{}');}
 catch(e){console.warn('RetailNav: no se pudo leer la marca del precargador.',e);}
 const slug=new URL(location.href).searchParams.get('mall');
 const selected=Object.hasOwn(entries,slug)?slug:'aventura';
 const mall=entries[selected]||{name:'Centro comercial'};
 const name=typeof mall.name==='string'&&mall.name.trim()?mall.name:'Centro comercial';
 if(title)title.textContent=name;
 if(icon){icon.hidden=true;icon.alt='Logo de '+name;}
 const root=new URL('.',document.baseURI);
 // Apply the mall's default font before the remaining application is parsed.
 // The visitor's local preview, if present, is applied by the full theme
 // controller later, using these same allowlisted preset definitions.
 const fontStacks={
  editorial:'"Helvetica Neue","Avenir Next",Arial,"PingFang SC","Noto Sans CJK SC",sans-serif',
  modern:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Noto Sans CJK SC",sans-serif',
  rounded:'"Trebuchet MS","Avenir Next Rounded","Arial Rounded MT Bold",Arial,"PingFang SC","Noto Sans CJK SC",sans-serif',
  'alto-inter':'"RetailNav Alto Inter","Inter","Segoe UI",Arial,sans-serif'
 };
 document.documentElement.style.setProperty('--rn-font-family',
  fontStacks[mall.font]||fontStacks.modern);
 const allowedFile=/^branding\/(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:svg|png|webp|jpe?g)$/;
 const allowedApi='api/mall-brands/'+selected+'/logo.svg';
 let seq=0,visible=false,activeSource='none',urlString='';
 function canonical(raw){
  if(typeof raw!=='string'||!(allowedFile.test(raw)||raw===allowedApi))return null;
  try{
   const u=new URL(raw,document.baseURI);
   if(u.origin!==location.origin||!u.pathname.startsWith(root.pathname))return null;
   return u.href;
  }catch{return null;}
 }
 function render(src,kind){
  if(!icon)return false;
  const target=canonical(src);
  if(!target)return false;
  const current=++seq;
  // Store the absolute URL at once. A visible image is only announced after
  // successful decoding (no blank or broken-image placeholders).
  icon.onload=()=>{
   if(current!==seq)return;
   if(icon.naturalWidth>0&&icon.naturalHeight>0){
    icon.hidden=false;visible=true;activeSource=kind;urlString=target;
   }else{
    icon.hidden=true;visible=false;
   }
  };
  icon.onerror=()=>{
   if(current!==seq)return;
   icon.hidden=true;visible=false;activeSource='unavailable';urlString='';
  };
  icon.src=target;
  // The SVG can be in Safari's memory cache and load synchronously.
  if(icon.complete&&icon.naturalWidth>0&&icon.naturalHeight>0){
   icon.hidden=false;visible=true;activeSource=kind;urlString=target;
  }
  return true;
 }
 const fallback=mall.logoSymbolUrl||mall.logoUrl||null;
 render(fallback,'static');
 window.RetailNavLoaderBrand={
  mallId:selected,
  // The later tenant-specific brand API must confirm ownership, hash, MIME,
  // and load success before calling this method. It cannot change mall IDs.
  useVerifiedLogo(raw){
   if(raw!==allowedApi&&raw!==new URL(allowedApi,document.baseURI).href)return false;
   const target=canonical(allowedApi);
   if(!target)return false;
   const probe=new Image();
   probe.onload=()=>{
    if(probe.naturalWidth>0&&probe.naturalHeight>0)render(allowedApi,'database');
   };
   probe.src=target;
   if(probe.complete&&probe.naturalWidth>0&&probe.naturalHeight>0)
    render(allowedApi,'database');
   return true;
  },
  getState:()=>({mallId:selected,name,visible,source:activeSource,url:urlString})
 };
})();
