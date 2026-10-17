/* RetailNav lightweight store detail + group rendezvous UI.
 * No AR arrows or walking instructions are fabricated on unverified maps.
 * All requests are authorized by the existing first-party session.
 */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const mall=window.RETAILNAV_ACTIVE_MALL||{};
const panel=$('rnTagResultPanel'),cards=$('rnTagResultCards');
if(!panel||!cards)return;
const actionDock=$('rnStoreActions'),assistAction=$('rnStoreAssist'),inviteAction=$('rnStoreInvite'),infoAction=$('rnStoreInfoAction');
let selectedId='',detailOpen=false,meetings=[],friends=[],currentMeetingId='',revision=0;
const i18n=()=>document.documentElement.lang||navigator.language||'es';
const en=()=>i18n().startsWith('en');
const tr=(es,english)=>en()?english:es;
const api=new URL('api/',location.href);
const get=async pathname=>{
 const response=await fetch(new URL(pathname,api),{cache:'no-store',credentials:'same-origin'});
 if(!response.ok)throw Error('HTTP '+response.status);
 return response.json();
};
const post=async(pathname,data)=>{
 const response=await fetch(new URL(pathname,api),{
  method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(data)
 });
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'Error');
 return result;
};
function text(tag,value,className){
 const element=document.createElement(tag);element.textContent=value||'';
 if(className)element.className=className;
 return element;
}
function button(value,action,kind=''){
 const b=text('button',value,kind);b.type='button';b.onclick=action;return b;
}
const state={get selectedId(){return selectedId},get detailOpen(){return detailOpen},
 get meetingCount(){return meetings.length}};
const details=document.createElement('section');
details.id='rnStoreDetails';details.className='rnStoreDetails';details.hidden=true;
panel.append(details);
const inboxButton=button('☕ · 0',()=>openInbox());
inboxButton.id='rnMeetupInboxButton';inboxButton.className='rnMeetupInboxButton';
inboxButton.title=tr('Propuestas de encuentro','Meetup invitations');
$('friendsBtn')?.before(inboxButton);
const inbox=document.createElement('dialog');inbox.id='rnMeetupInbox';inbox.className='rnMeetupInbox';
inbox.setAttribute('aria-label',tr('Invitaciones para encontrarnos','Meetup invitations'));
document.body.append(inbox);
const inboxContent=document.createElement('div');inboxContent.className='rnMeetupInboxContent';inbox.append(inboxContent);
const quickInvite=document.createElement('dialog');quickInvite.id='rnQuickInvite';quickInvite.className='rnMeetupInbox rnQuickInvite';
quickInvite.setAttribute('aria-label',tr('Invitar a encontrarnos','Invite people to meet'));
const quickInviteContent=document.createElement('div');quickInviteContent.className='rnMeetupInboxContent';quickInvite.append(quickInviteContent);document.body.append(quickInvite);
async function openInbox(){
 inbox.showModal();await refresh().catch(e=>{inboxContent.textContent=e.message;});
}
const meetingBox=document.createElement('section');
meetingBox.id='rnMeetingBox';meetingBox.className='rnMeetingBox';meetingBox.hidden=true;
panel.append(meetingBox);
function store(){return window.RetailNavUnits?.getUnits()?.find(u=>u.storeId===selectedId);}
function describeLocation(u){
 if(!u.sourceGeometry&&u.source!=='aventura-official-directory')return u.locationLabel||
  [...new Set([u.floor,...(u.documentedFloors||[])].filter(Boolean))].join(' / ')||
  tr('Planta sin confirmar','Floor not confirmed');
 const mapped=window.RetailNavUnits?.getMappedFloors?.(u)||[];
 if(mapped.length)return tr('Vinculado al mapa · ','Linked to map · ')+mapped.join(' / ');
 const published=u.locationLabel||[...new Set([u.floor,...(u.documentedFloors||[])].filter(Boolean))].join(' / ');
 return published?tr('Directorio: ','Directory: ')+published+tr(' · ubicación en mapa pendiente',' · map location pending'):
  tr('Ubicación en mapa pendiente','Map location pending');
}
function safeLogo(host,u){
 const label=u.name||u.code||'?';
 const span=text('span',label.slice(0,2).toUpperCase(),'rnDetailLogoFallback');
 host.append(span);
 const raw=u.logoURL||u.logoUrl||u.logo||u.brandLogoURL||u.brandLogoUrl;
 if(typeof raw!=='string')return;
 try{
  const url=new URL(raw,location.href);
  if(url.protocol!=='https:'&&url.origin!==location.origin)return;
  const img=document.createElement('img');img.alt=tr('Logo de ','Logo of ')+label;
  img.loading='lazy';img.src=url.href;
  img.onerror=()=>img.remove();
  host.prepend(img);
 }catch{}
}
function external(host,u,key,label){
 if(!u[key]||typeof u[key]!=='string')return;
 try{const url=new URL(u[key]);if(url.protocol!=='https:')return;
  const a=text('a',label);a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';
  host.append(a);
 }catch{}
}
const selectionStatus=document.createElement('p');
selectionStatus.id='rnStoreSelectionStatus';
selectionStatus.className='rnStoreSelectionStatus';
selectionStatus.setAttribute('role','status');
selectionStatus.setAttribute('aria-live','polite');
selectionStatus.hidden=true;
cards.before(selectionStatus);
function showSelectionStatus(u,focus){
 selectionStatus.hidden=false;
 const label=u.name||u.code;
 selectionStatus.textContent=focus?.located
  ?tr('Ubicación del destino: ','Destination location: ')+label+' · '+tr('Planta ','Floor ')+focus.floor
  :tr('Seleccionado: ','Selected: ')+label+' · '+
   (u.locationLabel||u.documentedFloors?.length
    ?tr('Ubicación indicada por el directorio; falta vincularla con el plano.',
      'Directory location is available, but not yet linked to the map.')
    :tr('Ubicación pendiente de identificar en el plano; no se puede enfocar ni resaltar.',
      'Map position is unknown; focus and map highlight are not available.'));
 const levels=window.RetailNavUnits?.getMappedFloors?.(u)||[];
 selectionStatus.classList.toggle('rnStoreFloorPrompt',levels.length>1);
 selectionStatus.hidden=levels.length<=1;
 if(levels.length>1){
  const choices=document.createElement('span');choices.className='rnStoreFloorChoices';
  for(const floor of levels){const b=button(tr('Planta ','Floor ')+floor,()=>selectStore(u.storeId,false,floor));
   b.dataset.storeFloor=floor;b.setAttribute('aria-pressed',String(focus?.floor===floor));choices.append(b);}
  selectionStatus.append(choices);
 }
}
function selectStore(id,showDetails=false,requestedFloor=null){
 const u=window.RetailNavUnits?.getUnits()?.find(s=>s.storeId===id);
 if(!u)return;
 selectedId=id;
 $('rnMapSearch')?.classList.remove('finding');$('search')?.blur();
 cards.querySelectorAll('[data-store-id]').forEach(el=>{
  const current=el.dataset.storeId===id;
  el.classList.toggle('rnStoreSelected',current);
  el.setAttribute('aria-selected',String(current));
 });
 // Never center on an unknown directory position. Only the photographed
 // store point and its existing same-floor vector may drive the camera.
 const located=Number.isFinite(u.x)&&Number.isFinite(u.y)&&Boolean(u.floor);
 let focus=window.__RETAILNAV__?.focusCatalogStore?.(
  id,requestedFloor||(located?u.floor:null),located?[u.x,u.y]:null,located?u.polygonId:null);
 window.RetailNavUnits?.selectStoreOnly?.(id);
 $('rnUnitInfo').hidden=true;
 $('detail').hidden=true;
 panel.dataset.selectedStore=id;
 panel.dataset.locationKnown=String(Boolean(focus?.located));
 // A directory-only result must still give visible confirmation of selection.
 // Never suggest that the map has highlighted a polygon that is not linked.
 showSelectionStatus(u,focus);
 if(!focus?.located)panel.setAttribute('data-location-note',
  tr('Ubicación exacta no identificada en el plano','Exact map location unknown'));
 else panel.removeAttribute('data-location-note');
 if(showDetails)showStoreDetails();
 else{details.hidden=true;detailOpen=false;meetingBox.hidden=true;}
 window.__RETAILNAV__?.invalidate?.();
 return focus||{located:false,storeId:id};
}
function openStoreInfo(){
 const u=store();if(!u)return;
 const standalone=panel.hidden;
 if(standalone){
  panel.dataset.quickInfo='true';panel.hidden=false;document.body.classList.add('rnTagResultsOpen');
  $('rnTagResultTitle').textContent=u.name||u.code||tr('Local seleccionado','Selected store');
 }
 selectionStatus.hidden=true;cards.hidden=true;showStoreDetails();
}
function showStoreDetails(){
 const u=store();if(!u)return;
 details.replaceChildren();details.hidden=false;detailOpen=true;meetingBox.hidden=true;
 const back=button('← '+tr(panel.dataset.quickInfo==='true'?'Volver al mapa':'Volver a la lista',panel.dataset.quickInfo==='true'?'Back to map':'Back to list'),()=>{
  details.hidden=true;detailOpen=false;meetingBox.hidden=true;
  if(panel.dataset.quickInfo==='true'){
   delete panel.dataset.quickInfo;panel.hidden=true;document.body.classList.remove('rnTagResultsOpen');
  }else cards.hidden=false;
 });
 back.className='rnBackToStores';details.append(back);
 const head=document.createElement('div');head.className='rnDetailHeading';
 const logo=document.createElement('div');logo.className='rnDetailLogo';safeLogo(logo,u);
 head.append(logo);
 const heading=document.createElement('div');
 heading.append(text('h3',u.name||u.code),text('span',describeLocation(u),'rnDetailFloor'));
 head.append(heading);details.append(head);
 if(u.officialDescription)details.append(text('p',u.officialDescription,'rnDetailDescription'));
 const spec=window.RetailNavI18n?.summary?.(u,6)||u.category||'';
 if(spec)details.append(text('p',spec,'rnDetailSpecialties'));
 const notice=Boolean(u.vectorVerified&&u.productsVerified)
  ?tr('Datos verificados por el shopping','Mall-verified data')
  :tr('Directorio provisional. Ubicación, horarios y oferta sujetos a verificación.',
       'Provisional directory. Store location and offerings are unverified.');
 details.append(text('p',notice,'rnStoreUncertainty'));
 const media=document.createElement('div');media.className='rnDetailLinks';
 external(media,u,'menuURL',tr('Ver menú','View menu'));
 external(media,u,'menuUrl',tr('Ver menú','View menu'));
 external(media,u,'websiteURL',tr('Sitio oficial','Official website'));
 external(media,u,'website',tr('Sitio oficial','Official website'));
 external(media,u,'enrichmentURL',tr('Fuente del directorio','Directory source'));
 external(media,u,'diningSource',tr('Ficha del local','Store listing'));
 external(media,u,'conceptSource',tr('Más información','More information'));
 if(!media.children.length)media.append(text('p',tr('Menú y datos de contacto aún no disponibles','Menu and contact details not yet available')));
 details.append(media);
 const actions=document.createElement('div');actions.className='rnDetailActions';
 actions.append(button(tr('Invitar amigos a encontrarnos','Invite friends to meet'),openInvitation));
 const nav=button('AR · '+tr('Indicaciones','Directions'),()=>showNavigation(u));
 nav.disabled=true;
 nav.title=tr('Requiere mapa, ruta y posición/orientación interiores verificados','Requires verified map, route and indoor pose');
 actions.append(nav);details.append(actions);
 details.append(text('p',tr('AR no disponible: este plano todavía no está calibrado para guiar caminando.','AR unavailable: indoor walking guidance requires surveyed map and pose.'),'rnStoreUncertainty'));
 cards.hidden=true;
}
function showNavigation(u){
 if(!u.vectorVerified||!mall.navigable)
  return alert(tr('No hay ruta peatonal ni anclaje AR verificados para este local.','No certified walking route or AR anchor exists for this store.'));
}
async function refresh(){
 const [list,people]=await Promise.all([get('meetups'),get('state')]);
 meetings=list.meetings||[];
 friends=people.friends||[];
 const unread=meetings.filter(m=>!m.isOrganizer&&((m.status==='pending'&&m.myResponse==='pending')||m.status==='counter')).length;
 inboxButton.textContent='☕ · '+unread;
 inboxButton.setAttribute('aria-label',unread+' '+tr('invitaciones de encuentro','meetup invitations'));
 renderMeetingList(panel);
 if(inbox.open)renderMeetingList(inboxContent);
}
function openInvitation(){
 const standalone=panel.hidden;
 const host=standalone?quickInviteContent:meetingBox;
 host.hidden=false;host.replaceChildren();
 if(standalone){if(!quickInvite.open)quickInvite.showModal();}
 else{cards.hidden=true;details.hidden=true;detailOpen=false;}
 const u=store();if(!u)return;
 host.append(text('h4',tr('Proponer encuentro','Suggest a meetup')));
 const hint=text('p',tr('Elegí amigos reales vinculados. Se les enviará solo el destino, nunca tu posición.','Choose linked friends. Only the destination is shared, never your position.'));
 host.append(hint);
 const row=document.createElement('div');row.className='rnMeetFriends';
 const selected=new Set();
 for(const f of friends){
  const label=document.createElement('label'),input=document.createElement('input');
  input.type='checkbox';input.value=f.id;
  input.onchange=()=>input.checked?selected.add(f.id):selected.delete(f.id);
  label.append(input,document.createTextNode(' '+f.name));row.append(label);
 }
 if(!friends.length)row.append(text('p',tr('Todavía no hay amigos reales vinculados por QR.','No real linked friends yet.')));
 host.append(row);
 const status=text('p','','rnMeetingStatus');host.append(status);
 const send=button(tr('Enviar propuesta','Send invitation'),async()=>{
  if(!selected.size){status.textContent=tr('Elegí por lo menos un amigo','Select at least one friend');return;}
  try{await post('meetups/create',{mallId:mall.id,inviteeIds:[...selected],
   destination:{storeId:u.storeId,name:u.name||u.code,floor:u.floor||null}});
   status.textContent=tr('Propuesta enviada','Invitation sent');await refresh();
  }catch(e){status.textContent=e.message;}
 });
 send.disabled=!friends.length;host.append(send);
 host.append(button(tr('Cerrar','Close'),()=>{
  if(standalone)quickInvite.close();else{meetingBox.hidden=true;cards.hidden=false;}
 }));
}
function renderMeetingList(container){
 container.querySelector('.rnMeetingsList')?.remove();
 if(container===inboxContent)inboxContent.replaceChildren(button('× '+tr('Cerrar','Close'),()=>inbox.close()));
 if(!meetings.length){if(container===inboxContent)container.append(text('p',tr('Sin encuentros pendientes','No meetups pending')));return;}
 const host=document.createElement('section');host.className='rnMeetingsList';
 host.append(text('h4',tr('Mis encuentros','My meetups')));
 for(const m of meetings.slice(0,15)){
  const row=document.createElement('div');row.className='rnMeetingRow';
  if(m.mallId!==mall.id){const link=text('a',tr('Abrir el shopping del encuentro','Open meetup mall'));
   const dest=new URL(location.href);dest.searchParams.set('mall',m.mallId);link.href=dest.href;row.append(link);}
  const status={pending:tr('Pendiente','Pending'),confirmed:tr('Confirmado','Confirmed'),
   counter:tr('Alternativa propuesta','Alternative suggested'),
   declined:tr('Rechazado','Declined'),cancelled:tr('Cancelado','Cancelled')}[m.status]||m.status;
  row.append(text('strong',m.destination.name+' · '+status));
  row.append(text('small',m.ownerName+' · '+m.acceptedCount+'/'+m.inviteeCount+' '+tr('aceptaron','accepted')));
  const actions=document.createElement('div');actions.className='rnMeetingActions';
  const decide=async(action,destination)=>{
   try{await post('meetups/decision',{id:m.id,action,destination});await refresh();}
   catch(e){row.append(text('p',e.message,'rnMeetingStatus'));}
  };
  if(!m.isOrganizer&&m.myResponse==='pending'&&m.status==='pending'){
   actions.append(button(tr('Aceptar','Accept'),()=>decide('accept')),
    button(tr('Rechazar','Decline'),()=>decide('decline')));
   const alt=document.createElement('select');alt.setAttribute('aria-label',tr('Otro local','Alternative store'));
   const empty=document.createElement('option');empty.value='';empty.textContent=tr('Elegir otro local…','Choose another store…');alt.append(empty);
   if(m.mallId===mall.id){
    for(const u of (window.RetailNavUnits?.getUnits?.()||[]).filter(u=>u.name&&u.storeId!==m.destination.storeId).slice(0,650)){
     const option=document.createElement('option');option.value=u.storeId;option.textContent=u.name+' · '+(u.floor||'?');alt.append(option);
    }
   }
   const alternative=button(tr('Proponer este local','Suggest this store'),()=>{
    const u=window.RetailNavUnits?.getUnits?.().find(u=>u.storeId===alt.value);
    if(!u||m.mallId!==mall.id)return;
    decide('counter',{storeId:u.storeId,name:u.name||u.code,floor:u.floor||null});
   });actions.append(alt,alternative);
  }
  if(m.isOrganizer&&m.status==='counter'&&m.counter){
   row.append(text('p',tr('Propuesta alternativa: ','Alternative: ')+m.counter.destination.name));
   actions.append(button(tr('Aceptar alternativa','Approve alternative'),()=>decide('approve')),
    button(tr('Mantener original','Keep original'),()=>decide('reject')));
  }
  if(m.isOrganizer&&['pending','counter','confirmed'].includes(m.status))
   actions.append(button(tr('Cancelar','Cancel'),()=>decide('cancel')));
  if(m.status==='confirmed')row.append(text('p',tr('Destino acordado. Navegación AR pendiente de validación del mapa.','Destination agreed. AR navigation requires verified mapping.'),'rnMeetingStatus'));
  row.append(actions);host.append(row);
 }
 container.append(host);
}
let priorTap={id:'',time:0};
const observer=new MutationObserver(()=>{
 if(panel.hidden||!panel.isConnected)return;
 for(const card of cards.querySelectorAll('.rnStoreCard')){
  if(card.dataset.rnMeetingBound)continue;
  card.dataset.rnMeetingBound='1';
  card.addEventListener('click',event=>{
   // Safari touch sometimes dispatches two independent clicks with detail=1.
   const id=card.dataset.storeId,now=performance.now();
   const secondTap=id===priorTap.id&&(now-priorTap.time<430||event.detail>=2);
   priorTap={id,time:now};
   event.stopImmediatePropagation();
   selectStore(id,secondTap);
  },true);
  card.addEventListener('keydown',event=>{
   if(event.key==='Enter'&&selectedId===card.dataset.storeId){event.preventDefault();selectStore(card.dataset.storeId,true);}
  },true);
 }
 if(!selectedId){details.hidden=true;cards.hidden=false;}
});
observer.observe(cards,{childList:true,subtree:false});
window.addEventListener('retailnav:ready',()=>{});
const open=()=>{
 if(panel.hidden){selectionStatus.hidden=true;details.hidden=true;cards.hidden=false;meetingBox.hidden=true;delete panel.dataset.quickInfo;return;}
 refresh().catch(()=>{});
};
new MutationObserver(open).observe(panel,{attributes:true,attributeFilter:['hidden']});
window.addEventListener('retailnav:store-focus-start',()=>{
 if(actionDock){actionDock.classList.remove('is-visible');actionDock.hidden=true;}
});
window.addEventListener('retailnav:store-focus-settled',event=>{
 const focus=event.detail||{};
 if(!actionDock||!selectedId||focus.storeId!==selectedId||focus.assistanceOpen)return;
 assistAction.disabled=!focus.located;
 assistAction.title=focus.located?tr('Orientarme','Guide me'):tr('Ubicación sin vincular','Location not mapped');
 assistAction.setAttribute('aria-label',assistAction.title);
 actionDock.hidden=false;requestAnimationFrame(()=>actionDock.classList.add('is-visible'));
});
assistAction?.addEventListener('click',()=>{
 if(!selectedId||assistAction.disabled)return;
 actionDock.classList.remove('is-visible');actionDock.hidden=true;
 window.__RETAILNAV__?.openStoreAssistance?.(selectedId);
});
inviteAction?.addEventListener('click',()=>{if(selectedId)openInvitation();});
infoAction?.addEventListener('click',openStoreInfo);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh().catch(()=>{});});
setInterval(()=>{if(!document.hidden)refresh().catch(()=>{});},20000);
window.addEventListener('retailnav:ready',()=>refresh().catch(()=>{}));
window.RetailNavMeetups={getState:()=>({...state,meetings:meetings.map(m=>({id:m.id,status:m.status})),
 actionDockVisible:Boolean(actionDock&&!actionDock.hidden)}),
 refresh,selectStore,showStoreDetails,openInvitation,openStoreInfo};
})();
