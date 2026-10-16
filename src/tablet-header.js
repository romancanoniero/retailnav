/* One search control, moved between the tablet header and the phone map.
 * Moving the existing nodes preserves their values, handlers and ARIA IDs. */
(()=>{
 'use strict';
 const search=document.getElementById('rnMapSearch'),header=document.querySelector('.topbar');
 const brand=header?.querySelector('.rnMallBrand'),more=document.getElementById('rnHeaderMore');
 const actions=document.getElementById('rnHeaderMoreActions'),toggle=document.getElementById('rnHeaderMoreToggle');
 if(!search||!header||!brand||!more||!actions||!toggle)return;
 const searchHome=document.createComment('Shared search: original map position');
 search.before(searchHome);
 const homes=new Map(),labels={helpBtn:['Ayuda','Help'],rnExpandView:['Ampliar mapa','Expand map'],
  downloadBtn:['Exportar planos','Export maps'],rnMeetupInboxButton:['Encuentros','Meetups']};
 const media=window.matchMedia('(min-width: 761px)');
 let active=false;
 function language(){
  const en=window.RetailNavI18n?.locale?.().startsWith('en');
  const title=en?'More options':'Más opciones';
  toggle.setAttribute('aria-label',title);toggle.title=title;actions.setAttribute('aria-label',title);
  for(const [id,text] of Object.entries(labels)){
   const button=document.getElementById(id);if(!button)continue;
   button.dataset.headerLabel=text[en?1:0];
  }
 }
 function moveActions(){
  for(const id of Object.keys(labels)){
   const button=document.getElementById(id);if(!button||button.parentElement===actions)continue;
   if(!homes.has(id)){const home=document.createComment('Header action: '+id);button.before(home);homes.set(id,home);}
   actions.append(button);
  }
  language();
 }
 function sync(){
  const wanted=media.matches&&!document.body.classList.contains('rnExpandedView');
  if(wanted===active){if(active)moveActions();return;}
  const focused=search.contains(document.activeElement)?document.activeElement:null;
  const selection=focused?.tagName==='INPUT'?[focused.selectionStart,focused.selectionEnd,focused.selectionDirection]:null;
  active=wanted;more.open=false;
  document.body.classList.toggle('rnTabletHeaderSearch',active);
  if(active){brand.after(search);moveActions();more.hidden=false;}
  else{
   searchHome.after(search);
   for(const [id,home] of homes){const button=document.getElementById(id);if(button&&home.isConnected)home.after(button);}
   more.hidden=true;
  }
  if(focused){
   focused.focus({preventScroll:true});
   if(selection&&selection[0]!==null)try{focused.setSelectionRange(...selection);}catch{}
  }
  window.dispatchEvent(new Event('retailnav:header-layout'));
 }
 more.addEventListener('click',event=>{if(event.target.closest('button'))more.open=false;});
 document.addEventListener('pointerdown',event=>{if(more.open&&!more.contains(event.target))more.open=false;});
 more.addEventListener('keydown',event=>{if(event.key==='Escape'){more.open=false;toggle.focus();event.stopPropagation();}});
 window.addEventListener('retailnav:localechange',language);
 if(media.addEventListener)media.addEventListener('change',sync);else media.addListener(sync);
 new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class']});
 new MutationObserver(()=>{if(active)moveActions();}).observe(header,{childList:true});
 language();sync();
})();
