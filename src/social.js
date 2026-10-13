/* RetailNav social interface. Explicitly opted-in, server-persisted anonymous contacts.
   Privacy: positions are MANUALLY marked, never GPS; simulated people are clearly labeled. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const API=new URL('api/',location.href);
let me=null, friends=[], incoming=[], outgoing=[], myPosition=null;
let inviteCode='', currentLink='', directLink='', joinCode='', joinMode='qr', ready=false, lastIncoming='', scannerStream=null;
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
  friends=snapshot.friends||[];
  incoming=snapshot.incoming||[];
  outgoing=snapshot.outgoing||[];
  myPosition=snapshot.myPosition||null;
  ready=true;
  if(document.activeElement!==$('rnName'))$('rnName').value=me.name;
  $('rnMeCode').textContent='ID interno · '+me.id.slice(0,8).toUpperCase();
  const myImg=$('rnProfileImg'),myInitial=$('rnProfileInitial');
  myInitial.textContent=me.name.charAt(0).toUpperCase();
  setAvatar(myImg,myInitial,me.id,me.avatarVersion);
  $('rnAvatarRemove').hidden=!me.avatarVersion;
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
  const icon=element('span','rnAvatar');
  const initial=element('span','rnAvatarInitial',friend.name.slice(0,1).toUpperCase());
  const img=element('img','','');
  img.alt='Foto de '+friend.name;
  img.hidden=true;
  icon.append(initial,img);
  setAvatar(img,initial,friend.id,friend.avatarVersion);
  const info=element('div','rnPerson');
  info.append(element('strong','',friend.name));
  const detail=friend.position
    ?friend.position.floor+' · posición que compartió hace '+Math.max(0,Math.ceil((Date.now()-friend.position.updated)/60000))+' min'
    :'No está compartiendo su ubicación';
  info.append(element('small','',detail));
  const actions=element('div','rnRowActions');
  const locate=button('📍',()=>{
    if(!friend.position)return;
    const view=window.__RETAILNAV__;
    if(!view){status('Esperá a que cargue el mapa.',true);return;}
    view.focusAt(friend.position.floor,[friend.position.x,friend.position.y],115);
    $('peopleDialog').close();
    status('Ubicación aproximada que compartió '+friend.name+'; no es GPS.');
  },'rnMapLocate');
  locate.title=friend.position?'Mostrar la posición compartida de '+friend.name:'Este contacto no comparte ubicación';
  locate.setAttribute('aria-label',locate.title);
  locate.disabled=!friend.position;
  const more=button('⋯',()=>{removeWrap.hidden=!removeWrap.hidden;},'rnFriendMore');
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
  if(incoming.length)$('rnRequestsDetails').open=true;
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