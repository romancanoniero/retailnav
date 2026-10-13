// End-to-end checks against the public HTTPS deployment in a touch-enabled browser.
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

const URL='https://improvingyourreality.com/retailnav/';
const engine=process.env.RN_BROWSER==='webkit'?webkit:chromium;
console.log('BROWSER_ENGINE',engine.name());
const browser=await engine.launch({headless:true,...(engine===chromium?{args:['--no-sandbox']}:{})});
const contexts=[];
const makeContext=async()=>{
  const context=await browser.newContext({
    viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,
    hasTouch:true,locale:'es-AR',ignoreHTTPSErrors:false
  });
  contexts.push(context);
  return context;
};
function log(tag,value){console.log(tag,typeof value==='string'?value:JSON.stringify(value));}
async function waitReady(page){
  await page.goto(URL,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>window.__RETAILNAV__?.getState().ready===true,
    null,{timeout:45000});
  await page.waitForFunction(()=>window.RetailNavSocial?.getState().ready===true,
    null,{timeout:25000});
}
try {
  const first=await makeContext();
  const page=await first.newPage();
  page.on('pageerror',err=>{console.error('PAGE_ERROR',err.message);});
  await waitReady(page);
  let viewer=await page.evaluate(()=>window.__RETAILNAV__.getState());
  let social=await page.evaluate(()=>window.RetailNavSocial.getState());
  log('START',{renderer:viewer.renderer,active:viewer.active,features:viewer.features,social});
  assert.deepEqual(viewer.visible,['LL','UL','L3']);
  assert.ok(social.anonymous);
  assert.ok(social.markerCount>=3,'Simulated friends must appear in map overlay');
  const own=await page.evaluate(async()=>{
    const res=await fetch('api/state',{credentials:'same-origin'});
    return {code:res.status,body:await res.json()};
  });
  assert.equal(own.code,200);
  assert.equal(own.body.me.anonymous,true);
  const firstId=own.body.me.id;

  // Floor label, isolation and a clearly visible path back to all 3 levels.
  await page.evaluate(()=>document.querySelector('#labels .label.floor')?.click());
  viewer=await page.evaluate(()=>window.__RETAILNAV__.getState());
  assert.notEqual(viewer.active,'ALL');
  assert.equal(viewer.visible.length,1);
  assert.equal(await page.locator('#showAllFloors').isVisible(),true);
  await page.locator('#showAllFloors').click();
  assert.deepEqual((await page.evaluate(()=>window.__RETAILNAV__.getState())).visible,
    ['LL','UL','L3']);
  log('FLOORS','Click on level indicator isolates floor; return restores all.');

  // Simulate two fingers: first remains anchored while second twists around it.
  const after=await page.evaluate(()=>{
    const view=window.__RETAILNAV__,canvas=document.querySelector('#canvas');
    const r=canvas.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    const send=(type,id,dx,dy)=>canvas.dispatchEvent(new PointerEvent(type,{
      bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',
      clientX:x+dx,clientY:y+dy,button:0,buttons:type==='pointerup'?0:1
    }));
    const before=view.getState().q;
    send('pointerdown',10,-45,0);
    send('pointerdown',11,45,0);
    send('pointermove',11,0,45);
    const transformed=view.getState().q;
    send('pointerup',11,0,45);
    send('pointerup',10,-45,0);
    return {before,transformed};
  });
  assert.ok(after.before.some((v,i)=>Math.abs(v-after.transformed[i])>0.001),
    'Two-finger anchored twist must rotate camera');
  log('TOUCH','Two-finger anchored twist changed camera quaternion.');

  await page.locator('#friendsBtn').click();
  const panel=page.locator('#peopleDialog');
  assert.equal(await panel.evaluate(e=>e.tagName),'ASIDE','Friends menu must not be a dialog');
  assert.equal(await panel.evaluate(e=>e.hidden),false);
  assert.equal(await page.locator('#friendsBtn').getAttribute('aria-expanded'),'true');
  const panelRect=await panel.boundingBox();
  log('PULLDOWN_GEOMETRY',{rect:panelRect,style:await panel.evaluate(el=>{
    const s=getComputedStyle(el);
    return {left:s.left,right:s.right,width:s.width,top:s.top,position:s.position,
      transform:s.transform,innerWidth:window.innerWidth,visualWidth:window.visualViewport?.width};
  })});
  assert.ok(panelRect && panelRect.width<=375 && panelRect.height<610,
    'Friends pulldown must leave the map visible');
  assert.ok(panelRect.x>=0 && panelRect.x+panelRect.width<=390,
    'Friends pulldown must be fully inside the mobile viewport');
  assert.ok(await page.locator('#rnAvatarTrigger').isVisible());
  assert.ok(await page.locator('#rnShareInvite').isVisible());
  assert.ok(await page.locator('#rnFriends').isVisible());
  log('PULLDOWN',{x:Math.round(panelRect.x),width:Math.round(panelRect.width),height:Math.round(panelRect.height)});
  // No backdrop: interacting with the map outside the pulldown dismisses it.
  await page.mouse.click(4,240);
  assert.equal(await panel.isVisible(),false,'Outside tap should dismiss pulldown');
  assert.equal(await page.locator('#friendsBtn').getAttribute('aria-expanded'),'false');
  await page.locator('#friendsBtn').click();
  assert.equal(await panel.isVisible(),true);
  await page.keyboard.press('Escape');
  assert.equal(await panel.isVisible(),false,'Escape should dismiss pulldown');
  await page.locator('#friendsBtn').click();
  assert.equal(await panel.isVisible(),true);
  await page.locator('#friendsBtn').click();
  assert.equal(await panel.isVisible(),false,'Icon should toggle its own pulldown');
  await page.locator('#friendsBtn').click();
  log('OUTSIDE_TAP','Dismiss on map tap, Escape and icon toggle; floor map stays interactive.');
  await page.locator('#rnMakeInvite').click();
  await page.waitForFunction(()=>document.getElementById('rnQrDialog')?.open===true);
  assert.equal(await page.locator('#peopleDialog').evaluate(el=>el.hidden),false,
    'Showing the QR must not close the friends pulldown');
  assert.equal(await page.locator('#peopleDialog').isVisible(),true);
  assert.equal(await page.locator('#rnQrDialog').evaluate(el=>el.tagName),'DIALOG');
  await page.locator('#rnQrClose').click();
  assert.equal(await page.locator('#rnQrDialog').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#peopleDialog').isVisible(),true,
    'Closing QR must return to the open friends pulldown');
  await page.locator('#rnMakeInvite').click();
  await page.waitForFunction(()=>document.getElementById('rnQrDialog')?.open===true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.getElementById('rnQrDialog')?.open===false);
  assert.equal(await page.locator('#peopleDialog').isVisible(),true,
    'Escape must close only the QR, not the friends pulldown');
  await page.locator('#rnMakeInvite').click();
  await page.waitForFunction(()=>document.getElementById('rnQrDialog')?.open===true);
  await page.waitForFunction(()=>document.querySelector('#rnLink')?.value.includes('#join='));
  assert.ok(await page.locator('#rnQr canvas, #rnQr img').count());
  const link=await page.locator('#rnLink').inputValue();
  assert.ok(link.startsWith(URL+'#join='));
  const decodedQR=await page.evaluate(()=>{
    const canvas=document.querySelector('#rnQr canvas');
    if(!canvas||typeof window.jsQR!=='function')return null;
    const frame=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
    return window.jsQR(frame.data,frame.width,frame.height)?.data||null;
  });
  assert.equal(decodedQR,link,'QR image must decode to actual invitation even in Safari');
  log('QR','Independent modal stays above open pulldown and returns to it after closing.');
  await page.locator('#rnQrClose').click();
  assert.equal(await page.locator('#peopleDialog').isVisible(),true,
    'Friends pulldown remains accessible after closing QR');

  const other=await makeContext(),guest=await other.newPage();
  guest.on('pageerror',err=>console.error('GUEST_PAGE_ERROR',err.message));
  await guest.goto(link,{waitUntil:'domcontentloaded',timeout:45000});
  await guest.waitForFunction(()=>window.RetailNavSocial?.getState().ready===true,
    null,{timeout:40000});
  await guest.locator('#rnJoinWrap').waitFor({state:'visible',timeout:25000});
  const secondId=await guest.evaluate(async()=>(await(await fetch('api/state')).json()).me.id);
  assert.notEqual(firstId,secondId);
  await guest.locator('#rnJoinConfirm').click();
  await guest.waitForFunction(()=>document.querySelector('#rnSocialStatus').textContent.includes('Solicitud enviada'),
    null,{timeout:15000});
  const notYet=await guest.evaluate(async()=>(await(await fetch('api/state')).json()).friends.length);
  assert.equal(notYet,0,'Guest QR scan must not auto-link before host acceptance');
  log('PENDING','Guest requested contact; no connection without reciprocal consent.');

  await page.bringToFront();
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.RetailNavSocial?.getState().ready===true);
  await page.locator('#friendsBtn').click();
  await page.waitForFunction(()=>window.RetailNavSocial.getState().incoming===1);
  await page.locator('#rnIncoming button',{hasText:'Aceptar'}).click();
  await page.waitForFunction(()=>window.RetailNavSocial.getState().friendCount===1);
  await guest.bringToFront();
  await guest.reload({waitUntil:'domcontentloaded'});
  await guest.waitForFunction(()=>window.RetailNavSocial?.getState().friendCount===1);
  log('RECIPROCAL','Both browsers have one persistent relationship.');

  // Explicit opt-in manually placed location; no real geolocation permission used.
  const shared=await page.evaluate(async()=>{
    const floor=window.__RETAILNAV__.floors[1];
    const center=floor.features.find(f=>f.k==='corridor').c;
    const res=await fetch('api/location',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({sharing:true,floor:'UL',x:center[0],y:center[1]})});
    return {code:res.status,body:await res.json()};
  });
  assert.equal(shared.code,200);assert.equal(shared.body.myPosition.floor,'UL');
  await guest.reload({waitUntil:'domcontentloaded'});
  await guest.waitForFunction(()=>window.RetailNavSocial?.getState().ready===true);
  const contact=await guest.evaluate(async()=>(await(await fetch('api/state')).json()).friends[0]);
  assert.equal(contact.position.source,'manual');
  assert.equal(contact.position.floor,'UL');
  log('LOCATION','Explicit manual position visible only to linked friend.');
  const blocked=await page.evaluate(async()=>{
    const res=await fetch('api/location',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({sharing:false})});
    return {code:res.status,body:await res.json()};
  });
  assert.equal(blocked.code,200);
  await guest.reload({waitUntil:'domcontentloaded'});
  await guest.waitForFunction(()=>window.RetailNavSocial?.getState().ready===true);
  const vanished=await guest.evaluate(async()=>(await(await fetch('api/state')).json()).friends[0]);
  assert.equal(vanished.position,undefined);
  log('LOCATION_STOP','Contact no longer receives location.');

  // Unlink test pair, leaving no mock friendship in production.
  page.on('dialog',dialog=>dialog.accept());
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.RetailNavSocial?.getState().ready===true);
  await page.locator('#friendsBtn').click();
  await page.locator('#rnFriends .rnFriendMore').click();
  await page.locator('#rnFriends .rnRemoveWrap button',{hasText:'Quitar amigo'}).click();
  await page.waitForFunction(()=>window.RetailNavSocial?.getState().friendCount===0);
  await guest.reload({waitUntil:'domcontentloaded'});
  await guest.waitForFunction(()=>window.RetailNavSocial?.getState().ready===true);
  assert.equal((await guest.evaluate(()=>window.RetailNavSocial.getState())).friendCount,0);
  log('CLEANUP','Reciprocal test contact removed from both accounts.');
  // A messenger invitation is authorized by its creator. The recipient alone
  // must explicitly accept; both lists update immediately, without an extra
  // owner approval step.
  await page.locator('#rnShareInvite').click();
  await page.locator('#rnDirectWrap').waitFor({state:'visible'});
  const chatLink=await page.locator('#rnDirectLink').inputValue();
  assert.ok(chatLink.startsWith(URL+'#join='));
  await guest.goto(chatLink,{waitUntil:'domcontentloaded',timeout:45000});
  await guest.waitForFunction(()=>window.RetailNavSocial?.getState().ready===true);
  await guest.locator('#rnJoinWrap').waitFor({state:'visible'});
  assert.equal(await guest.locator('#rnJoinConfirm').innerText(),'Agregar a mis amigos');
  const beforeLink=await guest.evaluate(async()=>(await(await fetch('api/state')).json()).friends.length);
  assert.equal(beforeLink,0);
  await guest.locator('#rnJoinConfirm').click();
  await guest.waitForFunction(()=>window.RetailNavSocial?.getState().friendCount===1);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.RetailNavSocial?.getState().friendCount===1);
  log('MESSAGE_LINK','Opening link alone does nothing; recipient consent links both immediately.');

  // Persist a compressed photo, make it available to accepted friends only,
  // and verify the mobile UI displays actual image data.
  const avatarImage=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');
    canvas.width=192;canvas.height=192;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#187980';ctx.fillRect(0,0,192,192);
    ctx.fillStyle='#edb887';ctx.fillRect(40,35,112,112);
    return canvas.toDataURL('image/jpeg',.75);
  });
  await page.locator('#friendsBtn').click();
  await page.locator('#rnAvatarTrigger').click();
  assert.ok(await page.locator('#rnAvatarGalleryBtn').isVisible());
  assert.equal(await page.locator('#rnAvatarCameraInput').getAttribute('capture'),'user');
  await page.locator('#rnAvatarGalleryInput').setInputFiles({
    name:'profile.jpeg',mimeType:'image/jpeg',
    buffer:Buffer.from(avatarImage.split(',')[1],'base64')
  });
  await page.waitForFunction(()=>{
    const img=document.getElementById('rnProfileImg');
    return img&&!img.hidden&&img.complete&&img.naturalWidth>0;
  },null,{timeout:20000});
  assert.equal(await page.locator('#rnProfileImg').isVisible(),true);
  const uploaded=await page.evaluate(async()=>(await(await fetch('api/state')).json()).me);
  assert.ok(uploaded.avatarVersion,'Avatar version should persist');
  await guest.reload({waitUntil:'domcontentloaded'});
  await guest.waitForFunction(()=>window.RetailNavSocial?.getState().ready===true);
  const avatarCheck=await guest.evaluate(async(id)=>{
    const data=await(await fetch('api/state')).json();
    const photo=await fetch('api/avatar/'+id,{credentials:'same-origin'});
    return {version:data.friends[0].avatarVersion,
      photoStatus:photo.status,type:photo.headers.get('content-type'),
      bytes:(await photo.arrayBuffer()).byteLength};
  },firstId);
  assert.equal(avatarCheck.photoStatus,200);
  assert.match(avatarCheck.type,/image\/jpeg/);
  assert.ok(avatarCheck.bytes>100);
  await guest.locator('#friendsBtn').click();
  await guest.waitForFunction(()=>document.querySelector('#rnFriends img')?.complete===true);
  assert.equal(await guest.locator('#rnFriends img').isVisible(),true);
  log('PHOTO','Anonymous JPEG avatar uploaded, persisted, and visible to linked friend.');

  await page.locator('#rnFriends .rnFriendMore').click();
  await page.locator('#rnFriends .rnRemoveWrap button',{hasText:'Quitar amigo'}).click();
  await page.waitForFunction(()=>window.RetailNavSocial.getState().friendCount===0);
  await guest.reload({waitUntil:'domcontentloaded'});
  await guest.waitForFunction(()=>window.RetailNavSocial?.getState().friendCount===0);
  const denied=await guest.evaluate(async(id)=>(await fetch('api/avatar/'+id)).status,firstId);
  assert.equal(denied,404,'Former contact can no longer fetch protected avatar');
  log('AVATAR_PRIVACY','Photo inaccessible after friendship removal.');

  for(const visitorPage of [page,guest]){
    const result=await visitorPage.evaluate(async()=>{
      const r=await fetch('api/account/delete',{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},body:'{}'
      });
      return {code:r.status,data:await r.json()};
    });
    assert.equal(result.code,200);
    assert.equal(result.data.deleted,true);
  }
  log('DATA_ERASURE','Both temporary production test identities permanently removed.');

  console.log('PASS WEB E2E: mobile browser, QR, consent, persistence, privacy and gesture');
}finally{
  await Promise.all(contexts.map(c=>c.close()));
  await browser.close();
}
