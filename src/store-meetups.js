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
const meetingBox=document.createElement('section');
meetingBox.id='rnMeetingBox';meetingBox.className='rnMeetingBox';meetingBox.hidden=true;
panel.append(meetingBox);
function store(){return window.RetailNavUnits?.getUnits()?.find(u=>u.storeId===selectedId);}
function describeLocation(u){
 if(u.locationLabel)return u.locationLabel;
 return [...new Set([u.floor,...(u.documentedFloors||[])].filter(Boolean))].join(' / ')||
   tr('Planta sin confirmar','Floor not confirmed');
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
function selectStore(id,showDetails=false){
 const u=window.RetailNavUnits?.getUnits()?.find(s=>s.storeId===id);
 if(!u)return;
 selectedId=id;
 cards.querySelectorAll('[data-store-id]').forEach(el=>{
  const current=el.dataset.storeId===id;
  el.classList.toggle('rnStoreSelected',current);
  el.setAttribute('aria-selected',String(current));
 });
 if(u.floor||u.documentedFloors?.length)
  window.RetailNavUnits?.focusStore?.(id);
 $('rnUnitInfo').hidden=true;
 $('detail').hidden=true;
 const reason=!u.polygonId&&!Number.isFinite(u.x);
 panel.dataset.selectedStore=id;
 panel.dataset.locationKnown=String(!reason);
 if(showDetails)showStoreDetails();
 else{details.hidden=true;detailOpen=false;meetingBox.hidden=true;}
 window.__RETAILNAV__?.invalidate?.();
}
function showStoreDetails(){
 const u=store();if(!u)return;
 details.replaceChildren();details.hidden=false;detailOpen=true;meetingBox.hidden=true;
 const back=button('← '+tr('Volver a la lista','Back to list'),()=>{details.hidden=true;detailOpen=false;cards.hidden=false;meetingBox.hidden=true;});
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
 meetings=(list.meetings||[]).filter(m=>m.mallId===mall.id);
 friends=people.friends||[];
 renderMeetingList();
}
function openInvitation(){
 meetingBox.hidden=false;meetingBox.replaceChildren();
 const u=store();if(!u)return;
 meetingBox.append(text('h4',tr('Proponer encuentro','Suggest a meetup')));
 const hint=text('p',tr('Elegí amigos reales vinculados. Se les enviará solo el destino, nunca tu posición.','Choose linked friends. Only the destination is shared, never your position.'));
 meetingBox.append(hint);
 const row=document.createElement('div');row.className='rnMeetFriends';
 const selected=new Set();
 for(const f of friends){
  const label=document.createElement('label'),input=document.createElement('input');
  input.type='checkbox';input.value=f.id;
  input.onchange=()=>input.checked?selected.add(f.id):selected.delete(f.id);
  label.append(input,document.createTextNode(' '+f.name));row.append(label);
 }
 if(!friends.length)row.append(text('p',tr('Todavía no hay amigos reales vinculados por QR.','No real linked friends yet.')));
 meetingBox.append(row);
 const status=text('p','','rnMeetingStatus');meetingBox.append(status);
 const send=button(tr('Enviar propuesta','Send invitation'),async()=>{
  if(!selected.size){status.textContent=tr('Elegí por lo menos un amigo','Select at least one friend');return;}
  try{await post('meetups/create',{mallId:mall.id,inviteeIds:[...selected],
   destination:{storeId:u.storeId,name:u.name||u.code,floor:u.floor||null}});
   status.textContent=tr('Propuesta enviada','Invitation sent');await refresh();
  }catch(e){status.textContent=e.message;}
 });
 send.disabled=!friends.length;meetingBox.append(send);
 meetingBox.append(button(tr('Cerrar','Close'),()=>meetingBox.hidden=true));
}
function renderMeetingList(){
 const old=$('rnMeetingsList');if(old)old.remove();
 if(!meetings.length)return;
 const host=document.createElement('section');host.id='rnMeetingsList';host.className='rnMeetingsList';
 host.append(text('h4',tr('Mis encuentros','My meetups')));
 for(const m of meetings.slice(0,15)){
  const row=document.createElement('div');row.className='rnMeetingRow';
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
   const alternative=button(tr('Proponer otro local','Suggest another store'),()=>{
    if(!selectedId||selectedId===m.destination.storeId){
     row.append(text('p',tr('Seleccioná otro local de la lista primero','Select another store from the list first')));return;
    }
    const u=store();
    decide('counter',{storeId:u.storeId,name:u.name||u.code,floor:u.floor||null});
   });actions.append(alternative);
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
 panel.append(host);
}
const observer=new MutationObserver(()=>{
 if(panel.hidden||!panel.isConnected)return;
 for(const card of cards.querySelectorAll('.rnStoreCard')){
  if(card.dataset.rnMeetingBound)continue;
  card.dataset.rnMeetingBound='1';
  card.addEventListener('click',event=>{
   if(event.detail>=2){event.stopImmediatePropagation();selectStore(card.dataset.storeId,true);}
   else{event.stopImmediatePropagation();selectStore(card.dataset.storeId,false);}
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
 if(panel.hidden){selectedId='';details.hidden=true;cards.hidden=false;meetingBox.hidden=true;return;}
 refresh().catch(()=>{});
};
new MutationObserver(open).observe(panel,{attributes:true,attributeFilter:['hidden']});
window.RetailNavMeetups={getState:()=>({...state,meetings:meetings.map(m=>({id:m.id,status:m.status}))}),
 refresh,selectStore,showStoreDetails};
})();
