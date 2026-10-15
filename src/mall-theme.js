/* Per-tenant colors/styles. No CSS URLs, user-provided stylesheets or HTML are executed. */
(()=>{
 'use strict';
 const keys={
  background:'bg',surface:'surface',text:'text',muted:'muted',
  accent:'accent',accentText:'accent-text',border:'border',
  mapUnit:'map-unit',mapAnchor:'map-anchor',mapCorridor:'map-corridor',
  mapZone:'map-zone',mapSlab:'map-slab',mapOutline:'map-outline'
 };
 function apply(mall){
  const t=mall?.theme;
  if(!t||typeof t!=='object'){
   document.body.classList.remove('rnThemeEnabled');
   return false;
  }
  const root=document.documentElement.style;
  for(const [key,css] of Object.entries(keys))
   if(/^#[a-f0-9]{6}$/i.test(t[key]||''))root.setProperty('--rn-theme-'+css,t[key]);
  document.body.classList.add('rnThemeEnabled');
  document.body.dataset.rnFont=['editorial','modern','rounded'].includes(t.font)?t.font:'modern';
  document.body.dataset.rnCorners=t.corners==='square'?'square':'soft';
  if(/^#[a-f0-9]{6}$/i.test(t.background||'')){
   document.querySelector('meta[name="theme-color"]')?.setAttribute('content',t.background);
  }
  return true;
 }
 window.RetailNavTheme={apply,getActive:()=>window.RETAILNAV_ACTIVE_MALL?.theme||null};
})();