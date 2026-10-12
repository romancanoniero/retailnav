/* RetailNav social interface. Explicitly opted-in, server-persisted anonymous contacts.
   Privacy: positions are MANUALLY marked, never GPS; simulated people are clearly labeled. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const API=new URL('api/',location.href);
let me=null, friends=[], incoming=[], outgoing=[], myPosition=null;
let inviteCode='', currentLink='', joinCode='', ready=false, lastIncoming='', scannerStream=null;
let scannerTimer=0, demoVisible=true, markers=[], socialStatus='';
const demoNames=['Sofía','Marcos','Lucía','Nico'];
const demoLevels=['UL','LL','L3','UL'];
const demoColors=['#f29abd','#ffd38b','#a6a3ff','#91e0c1'];
function element(tag,className,text){
  const el=document.createElement(tag);
  if(className)el.className=className;
  if(text!==undefined)el.textContent=text;
  return el;
}
function status(text,error=false){
  socialStatus=text;
  const output=$('rnSocialStatus');
  if(output){output.textContent=text;output.classList.toggle('error',error);}
}
async function request(route,method='GET',payload){
  const url=new URL(route,API);
  const response=await fetch(url.toString(),{
    method,credentials:'same-origin',cache:'no-store',
    headers:method==='POST'?{'Content-Type':'application/json'}:{},
    ...(method==='POST'?{body:JSON.stringify(payload||{})}:{})
  });
  let data;
  try{data=await response.json();}catch{throw Error('El servidor devolvió una respuesta inesperada');}
  if(!response.ok)throw Error(data.error||'No se pudo completar la solicitud');
  return data;
}
function merge(snapshot){
  if(!snapshot||!snapshot.me)return;
  me=snapshot.me;
  friends=snapshot.friends||[];
  incoming=snapshot.incoming||[];
  outgoing=snapshot.outgoing||[];
  myPosition=snapshot.myPosition||null;
  ready=true;
  $('rnName').value=me.name;
  $('rnMeCode').textContent='Identidad privada · '+me.id.slice(0,8).toUpperCase();
  $('rnStatusPosition').textContent=myPosition
    ? 'Compartiendo una marca manual en '+myPosition.floor+' · vence 10 min después de marcarla.'
    : 'Tu ubicación está oculta. No se utiliza GPS.';
  $('rnStopLocation').disabled=!myPosition;
  $('rnCreateRecovery').textContent=me.hasRecovery?'Reemplazar clave de recuperación':'Crear clave de recuperación';
  const badge=$('friendsCount');
  badge.textContent=String(friends.length);
  const pending=incoming.map(x=>x.id).sort().join(',');
  if(pending&&lastIncoming&&pending!==lastIncoming&&!$('peopleDialog').open){
    const notify=$('rnPendingBadge');notify.hidden=false;
  }
  lastIncoming=pending;
  renderContacts();
  renderMarkers();
}
function button(text,callback,variant=''){
  const el=element('button',variant,text);el.type='button';el.addEventListener('click',callback);return el;
}
function friendRow(friend){
  const row=element('div','rnRow');
  const icon=element('span','rnAvatar',friend.name.slice(0,1).toUpperCase());
  const info=element('div','rnPerson');
  info.append(element('strong','',friend.name));
  const detail=friend.position
    ? friend.position.floor+' · marcado manualmente · '+Math.max(0,Math.ceil((Date.now()-friend.position.updated)/60000))+' min'
    : 'Ubicación no compartida';
  info.append(element('small','',detail));
  const actions=element('div','rnRowActions');
  if(friend.position)actions.append(button('Ver',()=>{
    const view=window.__RETAILNAV__;
    if(!view){status('Todavía se está preparando el mapa.',true);return;}
    view.setFloor(friend.position.floor);
    view.focusAt(friend.position.floor,[friend.position.x,friend.position.y],115);
    $('peopleDialog').close();
    status('Posición marcada por '+friend.name+'; no es GPS.');
  }));
  actions.append(button('Quitar',async()=>{
    if(!confirm('¿Desvincular a '+friend.name+'? El vínculo se eliminará para ambos.'))return;
    try{merge(await request('contact/remove','POST',{id:friend.id}));status('Contacto desvinculado.');}
    catch(error){status(error.message,true);}
  },'rnMinor'));
  row.append(icon,info,actions);
  return row;
}
function renderContacts(){
  const host=$('rnFriends');host.replaceChildren();
  if(!friends.length)host.append(element('p','rnEmpty','Todavía no tenés contactos reales. Compartí tu QR para empezar.'));
  else friends.forEach(friend=>host.append(friendRow(friend)));
  const inc=$('rnIncoming');inc.replaceChildren();
  if(!incoming.length)inc.append(element('p','rnEmpty','No hay solicitudes pendientes.'));
  incoming.forEach(item=>{
    const row=element('div','rnRow');
    const info=element('span','rnPerson');
    info.append(element('strong','',item.name),element('small','','Quiere vincularse con vos'));
    const actions=element('div','rnRowActions');
    actions.append(button('Aceptar',async()=>{try{merge(await request('request/decide','POST',{id:item.id,action:'accept'}));status('Contacto agregado para ambos.');}catch(e){status(e.message,true);}}));
    actions.append(button('Rechazar',async()=>{try{merge(await request('request/decide','POST',{id:item.id,action:'reject'}));status('Solicitud rechazada.');}catch(e){status(e.message,true);}},'rnMinor'));
    row.append(info,actions);inc.append(row);
  });
  const out=$('rnOutgoing');out.replaceChildren();
  outgoing.forEach(item=>{
    const row=element('div','rnRow');
    row.append(element('span','rnPerson','Esperando que '+item.name+' acepte'));
    row.append(button('Cancelar',async()=>{try{merge(await request('request/cancel','POST',{id:item.id}));status('Solicitud cancelada.');}catch(e){status(e.message,true);}},'rnMinor'));
    out.append(row);
  });
  $('rnOutgoingWrap').hidden=!outgoing.length;
  $('rnPendingBadge').hidden=!incoming.length;
  $('rnRealFriendsCount').textContent=String(friends.length);
}
function demoPeople(){
  const view=window.__RETAILNAV__;
  if(!view||!demoVisible)return [];
  const result=[];
  demoNames.forEach((name,i)=>{
    const floor=view.floors.find(f=>f.id===demoLevels[i]);
    const corridors=floor?.features.filter(f=>f.k==='corridor'&&f.c&&f.c.length===2)||[];
    const candidate=corridors[Math.floor(corridors.length*(i+1)/(demoNames.length+1))];
    if(!candidate)return;
    const x=candidate.c[0],y=candidate.c[1];
    result.push({id:'simulation-'+i,name,floor:floor.id,x,y,demo:true,color:demoColors[i]});
  });
  return result;
}
function allPeople(){
  const real=friends.filter(f=>f.position).map(f=>({
    id:f.id,name:f.name,floor:f.position.floor,
    x:f.position.x,y:f.position.y,demo:false,color:'#65e6e0'
  }));
  if(myPosition)real.push({id:'self',name:'Yo',floor:myPosition.floor,
    x:myPosition.x,y:myPosition.y,demo:false,self:true,color:'#6de5a8'});
  return real.concat(demoPeople());
}
function renderMarkers(){
  const host=$('peopleOverlay');
  if(!host)return;
  host.replaceChildren();markers=[];
  const view=window.__RETAILNAV__;
  if(!view)return;
  for(const person of allPeople()){
    const pin=element('div','rnMapPin'+(person.demo?' rnDemoPin':''),person.name+(person.demo?' · DEMO':''));
    pin.style.setProperty('--rnPinColor',person.color);
    pin.title=person.demo?'Amigo simulado; no corresponde a una persona real':
      person.self?'Posición indicada por vos; no es GPS':
        'Posición que tu contacto indicó manualmente; no es GPS';
    pin.setAttribute('aria-label',pin.title);
    host.append(pin);markers.push({pin,person});
  }
  updateMarkers();
}
function updateMarkers(){
  const view=window.__RETAILNAV__;
  if(!view)return;
  const state=view.getState();
  const visible=new Set(state.visible);
  for(const marker of markers){
    const {person,pin}=marker;
    if(!visible.has(person.floor)){pin.hidden=true;continue;}
    const screen=view.project(person.floor,[person.x,person.y]);
    const w=window.innerWidth, h=window.innerHeight;
    const shown=screen&&screen.w>0&&screen.z<1&&
      screen.x>20&&screen.x<Math.max(40,view.viewportWidth?view.viewportWidth():w)&&
      screen.y>65&&screen.y<h;
    pin.hidden=!shown;
    if(shown){
      pin.style.left=screen.x+'px';
      pin.style.top=screen.y+'px';
    }
  }
}
function show(){
  const dialog=$('peopleDialog');
  if(!dialog.open)dialog.showModal();
  $('rnPendingBadge').hidden=true;
}
async function boot(){
  try{
    const s=await request('session','POST',{});
    merge(s);
    status('Identidad anónima activa. Tu navegador conserva los vínculos.');
    const p=new URLSearchParams(location.hash.replace(/^#/,''));
    if(p.has('join')){
      const code=p.get('join');
      history.replaceState(null,'',location.pathname+location.search);
      await previewJoin(code);
    }
  }catch(e){
    status('Contactos reales no disponibles: '+e.message+'. La simulación sigue funcionando.',true);
  }
}
async function poll(){
  if(!ready||document.visibilityState==='hidden')return;
  try{merge(await request('state'));}
  catch(e){status('Sin conexión con el servidor de contactos. Se conservarán los vínculos.',true);}
}
function encodeLink(code){
  const u=new URL(location.pathname,location.origin);
  u.hash='join='+encodeURIComponent(code);
  return u.toString();
}
async function createInvite(){
  if(!ready)return status('No hay conexión con el servidor de contactos.',true);
  try{
    const {code,expires}=await request('invite','POST',{});
    inviteCode=code;currentLink=encodeLink(code);
    const host=$('rnQr');
    host.replaceChildren();
    if(typeof QRCode==='undefined')throw Error('Generador de QR no disponible');
    new QRCode(host,{text:currentLink,width:190,height:190,
      colorDark:'#102133',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
    $('rnLink').value=currentLink;
    $('rnQrWrap').hidden=false;
    $('rnQrExpiry').textContent='Válido durante 5 minutos. El enlace sirve una sola vez.';
    status('QR listo. La otra persona debe aceptar y después vos confirmás.');
  }catch(e){status(e.message,true);}
}
async function previewJoin(code){
  if(!ready)return status('Esperá a que se conecte el servicio de contactos.',true);
  if(!/^[a-zA-Z0-9_-]{40,80}$/.test(code))return status('El enlace de invitación no es válido.',true);
  try{
    const preview=await request('invite/preview','POST',{code});
    joinCode=code;
    $('rnJoinName').textContent=preview.name;
    $('rnJoinWrap').hidden=false;
    show();
    status('Confirmá si querés solicitar el vínculo con '+preview.name+'.');
  }catch(e){status(e.message,true);}
}
function parseInvite(input){
  const raw=input.trim();
  if(/^[A-Za-z0-9_-]{40,80}$/.test(raw))return raw;
  const u=new URL(raw,location.origin);
  if(u.origin!==location.origin)throw Error('El enlace debe pertenecer a RetailNav');
  return new URLSearchParams(u.hash.replace(/^#/,'')).get('join')||'';
}
async function claim(){
  if(!joinCode)return;
  try{
    const result=await request('invite/claim','POST',{code:joinCode});
    joinCode='';$('rnJoinWrap').hidden=true;
    status('Solicitud enviada a '+result.name+'. La otra persona tiene que aceptarla.');
    merge(await request('state'));
  }catch(e){status(e.message,true);}
}
async function copy(text){
  try{
    await navigator.clipboard.writeText(text);
    status('Enlace copiado.');
  }catch{
    const input=$('rnLink');
    input.focus();input.select();
    status('Seleccioná y copiá el enlace.');
  }
}
function closeScanner(){
  clearTimeout(scannerTimer);
  if(scannerStream)scannerStream.getTracks().forEach(track=>track.stop());
  scannerStream=null;
  const video=$('rnVideo');
  if(video){video.pause();video.srcObject=null;}
  $('rnScanner').hidden=true;
}
async function scan(){
  if(!('BarcodeDetector' in window)||!navigator.mediaDevices?.getUserMedia){
    status('Este navegador no permite escanear dentro de la web. Abrí la Cámara del teléfono, apuntá al QR y tocá el enlace.',true);
    return;
  }
  try{
    const detector=new BarcodeDetector({formats:['qr_code']});
    scannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    const video=$('rnVideo');
    video.srcObject=scannerStream;
    $('rnScanner').hidden=false;
    await video.play();
    let checking=false;
    async function loop(){
      if(!scannerStream)return;
      if(!checking&&video.readyState>=2){
        checking=true;
        try{
          const codes=await detector.detect(video);
          if(codes.length){
            const code=parseInvite(codes[0].rawValue);
            closeScanner();await previewJoin(code);
            return;
          }
        }catch{}
        finally{checking=false;}
      }
      scannerTimer=setTimeout(loop,300);
    }
    loop();
  }catch(e){closeScanner();status('No se pudo abrir la cámara. Podés usar la Cámara del teléfono o pegar el enlace.',true);}
}
function onMapPoint(event){
  const detail=event.detail;
  if(!detail||!['LL','UL','L3'].includes(detail.floor))return;
  request('location','POST',{sharing:true,floor:detail.floor,x:detail.x,y:detail.y})
    .then(s=>{merge(s);status('Ubicación manual compartida durante un máximo de 10 minutos.');show();})
    .catch(e=>{status(e.message,true);show();});
}
function bind(){
  $('friendsBtn').addEventListener('click',show);
  $('rnClose').addEventListener('click',()=>{$('peopleDialog').close();closeScanner();});
  $('peopleDialog').addEventListener('close',closeScanner);
  $('rnSaveName').addEventListener('click',async()=>{
    try{merge(await request('me','POST',{name:$('rnName').value}));status('Nombre actualizado.');}
    catch(e){status(e.message,true);}
  });
  $('rnMakeInvite').addEventListener('click',createInvite);
  $('rnCopyLink').addEventListener('click',()=>copy(currentLink));
  $('rnShareLink').addEventListener('click',async()=>{
    if(!currentLink)return;
    if(navigator.share){
      try{await navigator.share({title:'Vinculemos nuestros contactos en RetailNav',
        text:'Invitación temporal, requiere aceptación de ambos',url:currentLink});}
      catch(e){if(e.name!=='AbortError')status(e.message,true);}
    }else await copy(currentLink);
  });
  $('rnJoinPaste').addEventListener('click',async()=>{
    try{await previewJoin(parseInvite($('rnInviteInput').value));}
    catch{status('Ingresá un enlace válido de RetailNav.',true);}
  });
  $('rnJoinConfirm').addEventListener('click',claim);
  $('rnJoinCancel').addEventListener('click',()=>{joinCode='';$('rnJoinWrap').hidden=true;status('Invitación descartada.');});
  $('rnScan').addEventListener('click',scan);
  $('rnStopScan').addEventListener('click',closeScanner);
  $('rnMarkLocation').addEventListener('click',()=>{
    const view=window.__RETAILNAV__;
    if(!view)return status('El mapa todavía se está preparando.',true);
    if(view.getState().active==='ALL')view.setFloor('UL');
    view.beginManualLocation();
    $('peopleDialog').close();
    status('Tocá tu posición aproximada en el piso elegido. Podés cambiar de planta antes de marcar.');
  });
  $('rnStopLocation').addEventListener('click',async()=>{
    try{merge(await request('location','POST',{sharing:false}));status('Ubicación oculta a todos los contactos.');}
    catch(e){status(e.message,true);}
  });
  $('rnDemoToggle').addEventListener('change',e=>{
    demoVisible=e.target.checked;
    renderMarkers();
    status(demoVisible?'Los personajes son simulados, no visitantes reales.':'Personajes simulados ocultos.');
  });
  $('rnCreateRecovery').addEventListener('click',async()=>{
    if(!confirm('Se creará una clave nueva. Cualquier clave anterior dejará de funcionar. ¿Continuar?'))return;
    try{
      const r=await request('recovery/create','POST',{});
      $('rnRecoveryOutput').hidden=false;
      $('rnRecoveryCode').value=r.recoveryCode;
      me.hasRecovery=true;
      status('Clave creada. Guardala fuera de este navegador: no podrá recuperarse después.');
    }catch(e){status(e.message,true);}
  });
  $('rnCopyRecovery').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText($('rnRecoveryCode').value);status('Clave copiada: guardala en un lugar seguro.');}
    catch{status('Seleccioná y copiá la clave manualmente.',true);}
  });
  $('rnRestore').addEventListener('click',async()=>{
    const code=$('rnRestoreCode').value.trim();
    if(!code)return status('Ingresá tu clave de recuperación.',true);
    if(!confirm('¿Restaurar tu identidad anónima anterior en este navegador?'))return;
    try{
      merge(await request('recovery/restore','POST',{code}));
      $('rnRestoreCode').value='';
      status('Identidad recuperada. Tus contactos vuelven a estar disponibles.');
    }catch(e){status(e.message,true);}
  });
  window.addEventListener('retailnav:map-point',onMapPoint);
  window.addEventListener('retailnav:ready',()=>{
    renderMarkers();
    updateMarkers();
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')poll();});
  setInterval(poll,12000);
  setInterval(()=>{
    if(document.visibilityState==='hidden')return;
    if(myPosition&&myPosition.updated+10*60000<Date.now()){
      myPosition=null;renderMarkers();
    }
    if(window.__RETAILNAV__)window.__RETAILNAV__.invalidate();
  },4500);
}
bind();
boot();
window.RetailNavSocial={updateMarkers,renderMarkers,getState:()=>({
  anonymous:!!me,friendCount:friends.length,incoming:incoming.length,
  demoVisible,myPosition,ready,markerCount:markers.length})};
})();