/* RetailNav social interface. Explicitly opted-in, server-persisted anonymous contacts.
   Privacy: positions are MANUALLY marked, never GPS; simulated people are clearly labeled. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const API=new URL('api/',location.href);
let me=null, friends=[], incoming=[], outgoing=[], myPosition=null;
let inviteCode='', currentLink='', directLink='', joinCode='', joinMode='qr', ready=false, lastIncoming='', scannerStream=null;
let scannerTimer=0, demoVisible=true, socialStatus='', contactsRenderKey='', pendingAppClipName=null;
const DEMO=window.RETAILNAV_DEMO_CONTACTS||[];
const MALL_ID=window.RETAILNAV_ACTIVE_MALL_ID||'aventura';
const SHOW_REAL_POSITIONS=MALL_ID==='aventura';
const COORDINATE_SPACE=window.RETAILNAV_ACTIVE_MALL?.coordinateSpace||'mall-photo-pixels';
function positionMatchesMap(position){
  return position&&(position.mallId||'aventura')===MALL_ID&&
    (position.coordinateSpace||'mall-photo-pixels')===COORDINATE_SPACE&&
    Number.isFinite(position.x)&&Number.isFinite(position.y);
}
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
    headers:{'X-RetailNav-Mall':MALL_ID,'X-RetailNav-Coordinate-Space':COORDINATE_SPACE,
      ...(method==='POST'?{'Content-Type':'application/json'}:{})},
    ...(method==='POST'?{body:JSON.stringify(payload||{})}:{})
  });
  let data;
  try{data=await response.json();}catch{throw Error('El servidor devolvió una respuesta inesperada');}
  if(!response.ok)throw Error(data.error||'No se pudo completar la solicitud');
  return data;
}
function avatarUrl(id,version){
  if(!version||!/^[a-f0-9-]{36}$/.test(id))return '';
  return new URL('avatar/'+id+'?v='+encodeURIComponent(version),API).toString();
}
function setAvatar(img,initial,id,version){
  const url=avatarUrl(id,version);
  if(!url){img.hidden=true;initial.hidden=false;return;}
  img.onerror=()=>{img.hidden=true;initial.hidden=false;};
  if(img.getAttribute('src')!==url)img.src=url;
  img.hidden=false;
  initial.hidden=true;
}
async function photoFromFile(file){
  if(!file)return;
  if(!ready)return status('Esperá a que se conecte tu identidad.',true);
  if(!file.type.startsWith('image/')||file.size>8*1024*1024)
    return status('Elegí una foto de hasta 8 MB.',true);
  let objectURL;
  try{
    objectURL=URL.createObjectURL(file);
    const img=new Image();
    await new Promise((resolve,reject)=>{
      img.onload=resolve;img.onerror=()=>reject(Error('No se pudo leer esta foto en Safari'));
      img.src=objectURL;
    });
    if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>75000000)
      throw Error('Imagen demasiado grande para procesar');
    const canvas=document.createElement('canvas');
    canvas.width=192;canvas.height=192;
    const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx)throw Error('No se pudo preparar la foto');
    const crop=Math.min(img.naturalWidth,img.naturalHeight);
    const x=(img.naturalWidth-crop)/2,y=(img.naturalHeight-crop)/2;
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,192,192);
    ctx.drawImage(img,x,y,crop,crop,0,0,192,192);
    let data='',quality=.78;
    do{
      data=canvas.toDataURL('image/jpeg',quality);
      quality-=.12;
    }while(data.length>98000&&quality>.28);
    if(data.length>102000)throw Error('La foto es demasiado pesada.');
    merge(await request('avatar','POST',{image:data}));
    $('rnAvatarChoices').hidden=true;
    status('Foto actualizada. Tus amigos podrán verla.');
  }catch(e){status(e.message,true);}
  finally{if(objectURL)URL.revokeObjectURL(objectURL);}
}
function merge(snapshot){
  if(!snapshot||!snapshot.me)return;
  me=snapshot.me;
  friends=(snapshot.friends||[]).map(friend=>({...friend,
    position:positionMatchesMap(friend.position)?friend.position:undefined,
    positionFrameMismatch:Boolean(friend.positionFrameMismatch||
      (friend.position&&!positionMatchesMap(friend.position)))}));
  incoming=snapshot.incoming||[];
  outgoing=snapshot.outgoing||[];
  myPosition=positionMatchesMap(snapshot.myPosition)?snapshot.myPosition:null;
  ready=true;
  if(document.activeElement!==$('rnName'))$('rnName').value=me.name;
  $('rnMeCode').textContent='ID interno · '+me.id.slice(0,8).toUpperCase();
  const myImg=$('rnProfileImg'),myInitial=$('rnProfileInitial');
  myInitial.textContent=me.name.charAt(0).toUpperCase();
  setAvatar(myImg,myInitial,me.id,me.avatarVersion);
  $('rnAvatarRemove').hidden=!me.avatarVersion;
  $('rnStatusPosition').textContent=myPosition
    ? 'Compartiendo una marca manual en '+myPosition.floor+' · vence 10 min después de marcarla.'
    : (snapshot.positionFrameMismatch||snapshot.myPosition)?'Tu marca pertenece a otro plano. Volvé a indicar tu ubicación.':
      'Tu ubicación está oculta. No se utiliza GPS.';
  $('rnStopLocation').disabled=!(snapshot.hasSharedPosition||snapshot.myPosition);
  $('rnCreateRecovery').textContent=me.hasRecovery?'Reemplazar clave de recuperación':'Crear clave de recuperación';
  const badge=$('friendsCount');
  badge.textContent=String(friends.length+(demoVisible?DEMO.length:0));
  $('friendsBtn').title=friends.length+' contactos reales · '+(demoVisible?DEMO.length:0)+' personas DEMO';
  const pending=incoming.map(x=>x.id).sort().join(',');
  if(pending&&lastIncoming&&pending!==lastIncoming&&$('peopleDialog').hidden){
    const notify=$('rnPendingBadge');notify.hidden=false;
  }
  lastIncoming=pending;
  const nextContactsKey=JSON.stringify([friends,incoming,outgoing]);
  if(nextContactsKey!==contactsRenderKey){
    contactsRenderKey=nextContactsKey;
    renderContacts();
  }
  renderMarkers();
}
// App Clip sends the visitor name through a WebKit event rather than the URL,
// keeping personal data out of browser history, referrers and request paths.
async function applyPendingAppClipName(){
  if(!ready||pendingAppClipName===null)return;
  const name=pendingAppClipName;
  pendingAppClipName=null;
  try{
    merge(await request('me','POST',{name}));
    status('Nombre guardado. Ya podés usar el mapa.');
  }catch(e){
    pendingAppClipName=name;
    status('No se pudo guardar el nombre: '+e.message,true);
  }
}
window.addEventListener('retailnav:appclip-profile',event=>{
  const name=typeof event.detail?.name==='string'?event.detail.name.trim():'';
  if(!name||name.length>36)return;
  pendingAppClipName=name;
  void applyPendingAppClipName();
});
function button(text,callback,variant=''){
  const el=element('button',variant,text);el.type='button';el.addEventListener('click',callback);return el;
}
function friendRow(friend){
  const row=element('div','rnRow');
  const icon=element('span','rnAvatar');
  const initial=element('span','rnAvatarInitial',friend.name.slice(0,1).toUpperCase());
  const img=element('img','','');
  img.alt='Foto de '+friend.name;
  img.hidden=true;
  icon.append(initial,img);
  setAvatar(img,initial,friend.id,friend.avatarVersion);
  const info=element('div','rnPerson');
  info.append(element('strong','',friend.name));
  const detail=SHOW_REAL_POSITIONS&&friend.position
    ?friend.position.floor+' · posición que compartió hace '+Math.max(0,Math.ceil((Date.now()-friend.position.updated)/60000))+' min'
    :(friend.positionFrameMismatch?'Ubicación marcada en otro plano; hace falta una marca nueva':
      SHOW_REAL_POSITIONS?'No está compartiendo su ubicación':'Ubicación en otro shopping: oculta por privacidad');
  info.append(element('small','',detail));
  const actions=element('div','rnRowActions');
  const locate=button('📍',()=>{
    if(!SHOW_REAL_POSITIONS||!friend.position)return;
    const view=window.__RETAILNAV__;
    if(!view){status('Esperá a que cargue el mapa.',true);return;}
    window.RetailNavFocusedFriendId=friend.id;
     view.focusAt(friend.position.floor,[friend.position.x,friend.position.y],115);
    closePeople();
    status('Ubicación aproximada que compartió '+friend.name+'; no es GPS.');
  },'rnMapLocate');
  locate.title=SHOW_REAL_POSITIONS&&friend.position?'Mostrar la posición compartida de '+friend.name:'Ubicación no compartida en este shopping';
  locate.setAttribute('aria-label',locate.title);
  locate.disabled=!SHOW_REAL_POSITIONS||!friend.position;
  const more=button('⋯',()=>{removeWrap.hidden=!removeWrap.hidden;row.classList.toggle('rnExpanded',!removeWrap.hidden);},'rnFriendMore');
  more.setAttribute('aria-label','Opciones de '+friend.name);
  actions.append(locate,more);
  const removeWrap=element('div','rnRemoveWrap');
  removeWrap.hidden=true;
  removeWrap.append(button('Quitar amigo',async()=>{
    if(!confirm('¿Desvincular a '+friend.name+'? Se eliminará de ambas listas.'))return;
    try{merge(await request('contact/remove','POST',{id:friend.id}));status('Contacto desvinculado.');}
    catch(e){status(e.message,true);}
  }));
  row.append(icon,info,actions,removeWrap);
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
  $('rnPendingCount').textContent=String(incoming.length);
  $('rnDemoFriendsSection').hidden=!demoVisible;
  $('rnDemoFriendsCount').textContent=String(demoVisible?DEMO.length:0);
  renderDemoContacts();
  if(incoming.length)$('rnRequestsDetails').open=true;
}
function renderDemoContacts(){
  const list=$('rnDemoFriends');
  if(!list)return;
  list.replaceChildren();
  $('rnDemoFriendsCount').textContent=String(demoVisible?DEMO.length:0);
  $('rnDemoFriendsSection').hidden=!demoVisible;
  if(!demoVisible)return;
  for(const person of DEMO){
    const row=element('div','rnRow rnDemoPerson');
    row.setAttribute('role','listitem');
    row.dataset.personId=person.id;
    row.dataset.floor=person.position.floor;
    row.style.setProperty('--rn-person-color',person.visual.bodyColor);
    const avatar=element('span','rnAvatar');
    const image=element('img');
    image.src=person.avatarUrl;
    image.alt='Retrato ficticio de '+person.name;
    image.loading='lazy';
    image.width=38;image.height=38;
    avatar.append(image);
    const info=element('div','rnPerson');
    const name=element('strong','',person.name);
    name.append(element('span','rnDemoTag','DEMO'));
    info.append(name,element('small','',person.position.floor+' · Ubicación ficticia en el plano'));
    const buttonLocate=button('📍',()=>{
      const view=window.__RETAILNAV__;
      if(!view){status('El mapa 3D todavía se está preparando.',true);return;}
      window.RetailNavFocusedFriendId=person.id;
       view.focusAt(person.position.floor,[person.position.x,person.position.y],105);
      closePeople();
      status(person.name+' es un amigo ficticio. Posición de prueba en '+person.position.floor+'.');
    },'rnMapLocate');
    buttonLocate.setAttribute('aria-label','Enfocar a '+person.name+' (DEMO) en planta '+person.position.floor);
    buttonLocate.title='Ver a '+person.name+' (DEMO) en el mapa';
    const actions=element('div','rnRowActions');actions.append(buttonLocate);
    row.append(avatar,info,actions);
    list.append(row);
  }
}
function allPeople(){
  const actual=(SHOW_REAL_POSITIONS?friends.filter(f=>f.position):[]).map(f=>({
    id:f.id,name:f.name,demo:false,
    position:{...f.position,source:'manual',mallId:MALL_ID,coordinateSpace:COORDINATE_SPACE},
    avatarUrl:avatarUrl(f.id,f.avatarVersion),
    visual:{bodyColor:'#65e6e0',shadowColor:'#23647a',rimColor:'#f2ffff'}
  }));
  if(SHOW_REAL_POSITIONS&&myPosition)actual.push({
    id:'self',name:'Yo',demo:false,self:true,
    position:{...myPosition,source:'manual',mallId:MALL_ID,coordinateSpace:COORDINATE_SPACE},
    avatarUrl:me?avatarUrl(me.id,me.avatarVersion):'',
    visual:{bodyColor:'#73f1b3',shadowColor:'#3c9279',rimColor:'#ffffff'}
  });
  return actual.concat(demoVisible?DEMO:[]);
}
function renderMarkers(){
  // The exact same coordinate records power the contact list and the 3D pins.
  // The pins render as vector geometry above the real 3D floor, not HTML tags.
  window.RetailNavPins?.setPeople?.(allPeople());
}
function updateMarkers(){window.RetailNavPins?.draw?.();}
function positionPeople(){
  const trigger=$('friendsBtn');
  const panel=$('peopleDialog');
  if(panel.hidden)return;
  const rect=trigger.getBoundingClientRect();
  const panelWidth=Math.min(425,window.innerWidth-20);
  const maxRight=Math.max(10,window.innerWidth-panelWidth-10);
  const right=Math.min(maxRight,Math.max(10,window.innerWidth-rect.right));
  const top=Math.min(window.innerHeight-110,Math.max(8,rect.bottom+7));
  panel.style.setProperty('--rn-dropdown-right',right+'px');
  panel.style.setProperty('--rn-dropdown-top',top+'px');
}
function show(){
  const panel=$('peopleDialog');
  if(!panel.hidden)return;
  panel.hidden=false;
  $('friendsBtn').setAttribute('aria-expanded','true');
  positionPeople();
  $('rnPendingBadge').hidden=true;
}
function closePeople(){
  const panel=$('peopleDialog');
  if(panel.hidden)return;
  panel.hidden=true;
  $('friendsBtn').setAttribute('aria-expanded','false');
  closeScanner();
}
function togglePeople(){
  if($('peopleDialog').hidden)show();
  else closePeople();
}
async function handleHashInvite(){
  const fragment=new URLSearchParams(location.hash.replace(/^#/,''));
  if(!fragment.has('join'))return;
  const code=fragment.get('join');
  if(!ready){status('Conectando contactos para abrir la invitación...');return;}
  // Erase the one-use token from the address bar, browser history and referrer.
  history.replaceState(null,'',location.pathname+location.search);
  await previewJoin(code);
}
async function boot(){
  try{
    const s=await request('session','POST',{});
    merge(s);
    status('Identidad anónima activa. Tu navegador conserva los vínculos.');
    await applyPendingAppClipName();
    await handleHashInvite();
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
    // The friends pulldown closes BEFORE the independent QR modal opens.
    // Closing QR must not reopen the pulldown without a new click on its icon.
    const qrDialog=$('rnQrDialog');
    if(!qrDialog.open){
      closePeople();
      qrDialog.showModal();
    }
    $('rnQrExpiry').textContent='Válido durante 5 minutos. El enlace sirve una sola vez.';
    status('QR listo. La otra persona debe aceptar y después vos confirmás.');
  }catch(e){status(e.message,true);}
}
async function makeDirectLink(){
  if(!ready)return status('No se pudo conectar con el servidor de amigos.',true);
  try{
    const invite=await request('invite/link','POST',{});
    directLink=encodeLink(invite.code);
    $('rnDirectLink').value=directLink;
    $('rnDirectWrap').hidden=false;
    $('rnDirectWrap').scrollIntoView({block:'nearest',behavior:'smooth'});
    status('Tu enlace está listo. El destinatario deberá aceptarlo para agregarse recíprocamente.');
  }catch(e){status(e.message,true);}
}
async function shareDirectLink(){
  if(!directLink)return status('Primero generá un enlace.',true);
  if(typeof navigator.share==='function'){
    try{
      await navigator.share({
        title:'Invitación de RetailNav',
        text:'Te invito a que nos agreguemos como amigos en RetailNav. Si aceptás, quedamos vinculados.',
        url:directLink
      });
      status('Enlace compartido. Cuando lo acepten, ambos verán el contacto.');
      return;
    }catch(e){if(e.name==='AbortError')return;}
  }
  await copy(directLink);
}
async function previewJoin(code){
  if(!ready)return status('Esperá a que se conecte el servicio de contactos.',true);
  if(!/^[a-zA-Z0-9_-]{40,80}$/.test(code))return status('El enlace de invitación no es válido.',true);
  try{
    const preview=await request('invite/preview','POST',{code});
    joinCode=code;
    joinMode=preview.mode==='link'?'link':'qr';
    $('rnJoinName').textContent=preview.name;
    $('rnJoinConfirm').textContent=joinMode==='link'?'Agregar a mis amigos':'Solicitar vínculo';
    $('rnJoinExplain').textContent=joinMode==='link'
      ?'La persona que envió el enlace ya autorizó la invitación. Si aceptás, aparecerán recíprocamente como amigos.'
      :'Se enviará una solicitud. La otra persona debe aceptarla antes de que queden vinculados.';
    $('rnJoinWrap').hidden=false;
    show();
    status(joinMode==='link'?'Aceptá solamente si conocés a '+preview.name+'.':'Podés solicitar el vínculo con '+preview.name+'.');
  }catch(e){status(e.message,true);}
}
function parseInvite(input){
  const raw=input.trim();
  if(/^[A-Za-z0-9_-]{40,80}$/.test(raw))return raw;
  const u=new URL(raw,location.origin);
  if(u.origin!==location.origin||u.pathname!==location.pathname)throw Error('El enlace debe pertenecer a RetailNav');
  return new URLSearchParams(u.hash.replace(/^#/,'')).get('join')||'';
}
async function claim(){
  if(!joinCode)return;
  try{
    const result=await request('invite/claim','POST',{code:joinCode});
    joinCode='';$('rnJoinWrap').hidden=true;
    merge(await request('state'));
    status(result.linked
      ?'¡Ya son amigos! '+result.name+' también te verá en su lista. La ubicación sigue oculta.'
      :'Solicitud enviada a '+result.name+'. La otra persona tiene que aceptarla.');
  }catch(e){status(e.message,true);}
}
async function copy(text){
  try{
    await navigator.clipboard.writeText(text);
    status('Enlace copiado.');
  }catch{
    const input=text===directLink?$('rnDirectLink'):$('rnLink');
    input.hidden=false;input.value=text;input.focus();input.select();
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
  if(!navigator.mediaDevices?.getUserMedia){
    status('Este navegador no permite usar la cámara desde la web. Usá la Cámara del teléfono para abrir el QR.',true);
    return;
  }
  try{
    let detector=null;
    if('BarcodeDetector' in window){
      try{detector=new BarcodeDetector({formats:['qr_code']});}catch{}
    }
    if(!detector&&typeof window.jsQR!=='function')
      throw Error('No hay lector QR compatible con este navegador');
    scannerStream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:'environment'},width:{ideal:640},height:{ideal:480}},
      audio:false
    });
    const video=$('rnVideo');
    video.srcObject=scannerStream;
    $('rnScanner').hidden=false;
    await video.play();
    let checking=false,frameCanvas=null,frameCtx=null;
    async function loop(){
      if(!scannerStream)return;
      if(!checking&&video.readyState>=2){
        checking=true;
        try{
          let found='';
          if(detector){
            const codes=await detector.detect(video);
            found=codes[0]?.rawValue||'';
          }else if(video.videoWidth&&video.videoHeight){
            if(!frameCanvas){
              frameCanvas=document.createElement('canvas');
              frameCtx=frameCanvas.getContext('2d',{willReadFrequently:true});
            }
            if(frameCtx){
              const scale=Math.min(1,480/video.videoWidth);
              frameCanvas.width=Math.round(video.videoWidth*scale);
              frameCanvas.height=Math.round(video.videoHeight*scale);
              frameCtx.drawImage(video,0,0,frameCanvas.width,frameCanvas.height);
              const frame=frameCtx.getImageData(0,0,frameCanvas.width,frameCanvas.height);
              found=window.jsQR(frame.data,frame.width,frame.height,
                {inversionAttempts:'attemptBoth'})?.data||'';
            }
          }
          if(found){
            const code=parseInvite(found);
            closeScanner();
            await previewJoin(code);
            return;
          }
        }catch(e){
          if(e.message&&/enlace|código|invitación|RetailNav/i.test(e.message))
            status('El código escaneado no pertenece a RetailNav.',true);
        }finally{checking=false;}
      }
      scannerTimer=setTimeout(loop,350);
    }
    loop();
  }catch(e){
    closeScanner();
    status('No se pudo abrir la cámara: '+e.message+'. También podés usar la app Cámara del iPhone.',true);
  }
}
function onMapPoint(event){
  const detail=event.detail;
  if(detail?.localOnly===true)return;
  if(!SHOW_REAL_POSITIONS||!detail||!['LL','UL','L3'].includes(detail.floor)||
    !positionMatchesMap(detail))return;
  request('location','POST',{sharing:true,mallId:MALL_ID,coordinateSpace:COORDINATE_SPACE,
    floor:detail.floor,x:detail.x,y:detail.y})
    .then(s=>{merge(s);status('Ubicación manual compartida durante un máximo de 10 minutos.');show();})
    .catch(e=>{status(e.message,true);show();});
}
function bind(){
  $('friendsBtn').addEventListener('click',togglePeople);
  $('rnClose').addEventListener('click',closePeople);
  // A non-modal dropdown never blocks the floor map. Tapping anywhere else
  // closes it, including the canvas or an unrelated topbar control.
  document.addEventListener('pointerdown',event=>{
    if($('peopleDialog').hidden)return;
    // The independent QR dialog is in the top layer: interacting with it
    // must NEVER be mistaken for a tap outside the friends pulldown.
    if($('rnQrDialog').open || event.target.closest('#rnQrDialog'))return;
    if(event.target.closest('#peopleDialog, #friendsBtn'))return;
    closePeople();
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&$('rnQrDialog').open)return; // Native dialog handles Escape.
    if(event.key==='Escape'&&!$('peopleDialog').hidden){
      event.preventDefault();
      closePeople();
      $('friendsBtn').focus();
    }
  });
  window.addEventListener('resize',positionPeople);
  window.visualViewport?.addEventListener('resize',positionPeople);
  window.addEventListener('scroll',positionPeople,true);
  $('rnSaveName').addEventListener('click',async()=>{
    try{merge(await request('me','POST',{name:$('rnName').value}));status('Nombre actualizado.');}
    catch(e){status(e.message,true);}
  });
  $('rnName').addEventListener('keydown',event=>{
    if(event.key==='Enter'){$('rnSaveName').click();$('rnName').blur();}
  });
  $('rnAvatarTrigger').addEventListener('click',()=>{
    $('rnAvatarChoices').hidden=!$('rnAvatarChoices').hidden;
  });
  $('rnAvatarGalleryBtn').addEventListener('click',()=>$('rnAvatarGalleryInput').click());
  $('rnAvatarCameraBtn').addEventListener('click',()=>$('rnAvatarCameraInput').click());
  for(const id of ['rnAvatarGalleryInput','rnAvatarCameraInput']){
    $(id).addEventListener('change',async event=>{
      const file=event.target.files?.[0];
      event.target.value='';
      if(file)await photoFromFile(file);
    });
  }
  $('rnAvatarRemove').addEventListener('click',async()=>{
    if(!me?.avatarVersion)return;
    if(!confirm('¿Eliminar tu foto de perfil?'))return;
    try{
      merge(await request('avatar/delete','POST',{}));
      $('rnAvatarChoices').hidden=true;
      status('Foto eliminada. Se muestran tus iniciales.');
    }catch(e){status(e.message,true);}
  });
  const qrDialog=$('rnQrDialog');
  $('rnQrClose').addEventListener('click',()=>qrDialog.close());
  qrDialog.addEventListener('cancel',()=>{ /* Escape closes only the QR. */ });
  qrDialog.addEventListener('click',event=>{
    // Close on a tap directly on the backdrop, not on the QR content.
    if(event.target===qrDialog)qrDialog.close();
  });
  qrDialog.addEventListener('close',()=>{
    // Restore focus to the visible launcher, but keep the friends pulldown closed.
    $('friendsBtn').focus({preventScroll:true});
  });
  $('rnMakeInvite').addEventListener('click',createInvite);
  $('rnShareInvite').addEventListener('click',makeDirectLink);
  $('rnDirectShare').addEventListener('click',shareDirectLink);
  $('rnDirectCopy').addEventListener('click',()=>copy(directLink));
  $('rnPasteToggle').addEventListener('click',()=>{
    $('rnPasteWrap').hidden=!$('rnPasteWrap').hidden;
    if(!$('rnPasteWrap').hidden)$('rnInviteInput').focus();
  });
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
    closePeople();
    status('Tocá tu posición aproximada en el piso elegido. Podés cambiar de planta antes de marcar.');
  });
  $('rnStopLocation').addEventListener('click',async()=>{
    try{merge(await request('location','POST',{sharing:false}));status('Ubicación oculta a todos los contactos.');}
    catch(e){status(e.message,true);}
  });
  if(!SHOW_REAL_POSITIONS){
    $('rnMarkLocation').disabled=true;
    $('rnMarkLocation').title='Las ubicaciones reales se habilitarán tras calibrar este shopping.';
    $('rnStatusPosition').textContent='AP Plaza está en modo demostración. No se trasladan ubicaciones reales de Aventura.';
    $('rnDemoToggle').parentElement.lastChild.textContent=' Mostrar '+DEMO.length+' amigos simulados en este shopping';
  }
  $('rnDemoToggle').addEventListener('change',e=>{
    demoVisible=e.target.checked;
    renderDemoContacts();
    $('friendsCount').textContent=String(friends.length+(demoVisible?DEMO.length:0));
    $('friendsBtn').title=friends.length+' contactos reales · '+(demoVisible?DEMO.length:0)+' personas DEMO';
    renderMarkers();
    status(demoVisible?'Hay '+DEMO.length+' amigos ficticios de prueba distribuidos en LL, UL y L3.':'Amigos DEMO ocultos del mapa y la lista.');
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
  $('rnDeleteAccount').addEventListener('click',async()=>{
    if(!confirm('Se borrarán tu identidad, tus contactos y la ubicación compartida. ¿Continuar?'))return;
    if(!confirm('La eliminación es permanente. ¿Eliminar definitivamente?'))return;
    try{
      const result=await request('account/delete','POST',{});
      if(result.deleted){status('Datos eliminados. Se generará una identidad nueva.');location.replace(location.pathname);}
    }catch(e){status(e.message,true);}
  });
  window.addEventListener('retailnav:map-point',onMapPoint);
  window.addEventListener('retailnav:ready',()=>{
    renderMarkers();
    updateMarkers();
  });
  window.addEventListener('hashchange',()=>{handleHashInvite().catch(e=>status(e.message,true));});
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'){
      poll();
      if(location.hash.includes('join='))handleHashInvite().catch(e=>status(e.message,true));
    }
  });
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
renderDemoContacts();
renderMarkers();
$('friendsCount').textContent=String(DEMO.length);
boot();
window.RetailNavSocial={updateMarkers,renderMarkers,getState:()=>({
  anonymous:!!me,friendCount:friends.length,demoFriendCount:DEMO.length,
  demoFloors:DEMO.map(p=>p.position.floor),incoming:incoming.length,
  demoVisible,myPosition,ready,markerCount:window.RetailNavPins?.getState().registered||0,
  drawnPinCount:window.RetailNavPins?.getState().drawn||0
})};
})();
