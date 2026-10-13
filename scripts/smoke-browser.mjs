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
  await page.waitForFunction(()=>window.RetailNavPins?.getState().registered===9,
    null,{timeout:20000});
  await page.waitForFunction(()=>window.RetailNavPins?.getState().drawn>=1,
    null,{timeout:20000});
  const pinInfo=await page.evaluate(()=>{
    const stage=document.getElementById('peoplePinCanvas');
    const p=window.RetailNavPins.getState();
    const rgba=stage.getContext('2d').getImageData(0,0,stage.width,stage.height).data;
    let occupied=0,bluePixels=0;
    for(let i=0;i<rgba.length;i+=47*4){
      if(rgba[i+3]>25)occupied++;
      if(rgba[i+3]>140&&rgba[i+2]>rgba[i]+22&&rgba[i+2]>rgba[i+1]+8)bluePixels++;
    }
    return {registered:p.registered,drawn:p.drawn,visibleIds:p.visibleIds,
      design:p.design,photoLoaded:p.photoLoaded,photoErrors:p.photoErrors,bluePixels,
      canvasWidth:stage.width,canvasHeight:stage.height,paintedPixels:occupied,
      floors:p.floors,colorPairs:p.colorPairs};
  });
  assert.equal(pinInfo.registered,9,'Nine seeded friend avatars registered');
  assert.ok(pinInfo.drawn>=1,'At least one projected 3D avatar pin must be visible');
  assert.ok(pinInfo.paintedPixels>40,'3D marker canvas must render actual colored pin pixels');
  assert.equal(pinInfo.design,'blue-reference-photographic-v1','Reference pin design must be deployed');
  assert.ok(pinInfo.bluePixels>12,'Blue teardrop body must be visible in rendered pixels');
  await page.waitForFunction(()=>window.RetailNavPins.getState().photoLoaded===9,
    null,{timeout:20000});
  assert.equal((await page.evaluate(()=>window.RetailNavPins.getState())).photoErrors,0);
  assert.ok(pinInfo.canvasWidth>300 && pinInfo.canvasHeight>300);
  assert.deepEqual(['LL','UL','L3'].map(level=>pinInfo.floors.filter(f=>f===level).length),[3,3,3]);
  for(const [id,color] of pinInfo.colorPairs){
    assert.match(color.body,/^#[0-9a-f]{6}$/i,'body color of '+id);
    assert.match(color.shadow,/^#[0-9a-f]{6}$/i,'shadow color of '+id);
    assert.notEqual(color.body,color.shadow,'Distinct shadow and body colors for '+id);
  }
  assert.equal(social.demoFriendCount,9);
  log('NINE_3D_PINS',{drawn:pinInfo.drawn,paintedPixels:pinInfo.paintedPixels,
    floors:pinInfo.floors,colorCount:pinInfo.colorPairs.length});

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
  const demoRows=page.locator('#rnDemoFriends .rnDemoPerson');
  assert.equal(await demoRows.count(),9,'Nine demo friends must appear in friends pulldown');
  const rowFloors=await demoRows.evaluateAll(rows=>rows.map(row=>row.dataset.floor));
  assert.deepEqual(['LL','UL','L3'].map(level=>rowFloors.filter(f=>f===level).length),[3,3,3]);
  assert.equal(await page.locator('#rnDemoFriendsCount').innerText(),'9');
  assert.equal(await page.locator('#friendsCount').innerText(),'9');
  await page.waitForFunction(()=>document.querySelector('#rnDemoFriends img')?.naturalWidth>0,
    null,{timeout:15000});
  assert.ok(await page.locator('#rnDemoFriends img').first().isVisible(),
    'Synthetic profile portraits must be visible in contact list');
  const pinPerson=await page.evaluate(()=>window.RETAILNAV_DEMO_CONTACTS[0]);
  await demoRows.first().locator('.rnMapLocate').click();
  await page.waitForFunction(()=>window.__RETAILNAV__.getState().active==='LL',
    null,{timeout:10000});
  assert.equal(await page.locator('#peopleDialog').isVisible(),false);
  await page.waitForFunction(()=>
    window.RetailNavPins.getState().visibleIds.includes('mock-ll-01'),
    null,{timeout:14000});
  log('FOCUS_DEMO','Contact list marker focuses '+pinPerson.name+' on LL with a 3D avatar pin.');
  await page.locator('#friendsBtn').click();
  await page.locator('#rnLocationDetails summary').click();
  await page.locator('#rnDemoToggle').uncheck();
  await page.waitForFunction(()=>window.RetailNavPins.getState().registered===0);
  assert.equal(await page.locator('#rnDemoFriends').isVisible(),false);
  assert.equal(await page.locator('#friendsCount').innerText(),'0');
  await page.locator('#rnDemoToggle').check();
  await page.waitForFunction(()=>window.RetailNavPins.getState().registered===9);
  assert.equal(await page.locator('#rnDemoFriends .rnDemoPerson').count(),9);
  assert.equal(await page.locator('#friendsCount').innerText(),'9');
  await page.locator('#rnClose').click();
  log('DEMO_TOGGLE','Disabling demo hides all nine pins and list entries; re-enabling restores both.');
  await page.locator('#showAllFloors').click();
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
  assert.equal(await page.locator('#peopleDialog').evaluate(el=>el.hidden),true,
    'Opening QR must first close the friends pulldown');
  assert.equal(await page.locator('#friendsBtn').getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('#rnQrDialog').evaluate(el=>el.tagName),'DIALOG');
  await page.locator('#rnQrClose').click();
  await page.waitForFunction(()=>!document.getElementById('rnQrDialog').open,
    null,{timeout:5000});
  assert.equal(await page.locator('#peopleDialog').isVisible(),false,
    'Closing QR must leave the friends pulldown closed');
  assert.equal(await page.locator('#friendsBtn').getAttribute('aria-expanded'),'false');
  await page.locator('#friendsBtn').click();
  assert.equal(await page.locator('#peopleDialog').isVisible(),true,
    'Only tapping the friends icon can reopen the pulldown');
  await page.locator('#rnMakeInvite').click();
  await page.waitForFunction(()=>document.getElementById('rnQrDialog')?.open===true);
  assert.equal(await page.locator('#peopleDialog').isVisible(),false,
    'Pulldown must also be hidden on subsequent QR opens');
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.getElementById('rnQrDialog').open,
    null,{timeout:5000});
  assert.equal(await page.locator('#peopleDialog').isVisible(),false,
    'Escape closes the QR without reopening the pulldown');
  await page.locator('#friendsBtn').click();
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
  log('QR','QR modal replaces the pulldown; closing it returns to the map.');
  await page.locator('#rnQrClose').click();
  await page.waitForFunction(()=>!document.getElementById('rnQrDialog').open,
    null,{timeout:5000});
  assert.equal(await page.locator('#peopleDialog').isVisible(),false,
    'Closing QR leaves friends hidden until its icon is tapped');

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
  await guest.waitForFunction(()=>window.RetailNavPins.getState().registered>=10);
  await guest.locator('#friendsBtn').click();
  const realLocate=guest.locator('#rnFriends .rnMapLocate');
  assert.equal(await realLocate.isEnabled(),true);
  await realLocate.click();
  await guest.waitForFunction(()=>window.__RETAILNAV__.getState().active==='UL');
  await guest.waitForFunction(id=>window.RetailNavPins.getState().visibleIds.includes(id),
    firstId,{timeout:14000});
  assert.equal(await guest.locator('#peopleDialog').isVisible(),false);
  log('REAL_FRIEND_PIN','Authorized position renders a 3D pin and can be focused through contact list.');
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
  await guest.waitForFunction(()=>window.RetailNavPins.getState().registered===9);
  assert.ok(!(await guest.evaluate(id=>window.RetailNavPins.getState().visibleIds.includes(id),firstId)));
  log('LOCATION_STOP','Contact no longer receives location or its 3D marker.');

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

  // Independent AP Plaza data and mall selector: no Aventura positions bleed in.
  const apContext=await makeContext();
  const apPage=await apContext.newPage();
  await apPage.goto(URL+'?mall=ap-plaza',{waitUntil:'domcontentloaded',timeout:45000});
  await apPage.waitForFunction(()=>window.__RETAILNAV__?.getState().ready===true,
    null,{timeout:45000});
  await apPage.waitForFunction(()=>window.RetailNavSocial?.getState().ready===true,
    null,{timeout:25000});
  const apStatus=await apPage.evaluate(()=>({
    viewer:window.__RETAILNAV__.getState(),
    social:window.RetailNavSocial.getState(),
    pins:window.RetailNavPins.getState(),
    mall:window.RETAILNAV_ACTIVE_MALL_ID
  }));
  assert.equal(apStatus.mall,'ap-plaza');
  assert.equal(apStatus.viewer.mallId,'ap-plaza');
  assert.deepEqual(apStatus.viewer.visible,['B1']);
  assert.ok(apStatus.viewer.features[0][1]>=40);
  assert.equal(apStatus.social.demoFriendCount,6);
  assert.equal(apStatus.pins.registered,6);
  await apPage.waitForFunction(()=>window.RetailNavPins?.getState().photoLoaded===6,
    null,{timeout:25000});
  assert.equal(await apPage.locator('#routeBtn').isDisabled(),true);
  await apPage.locator('#friendsBtn').click();
  assert.equal(await apPage.locator('#rnDemoFriends .rnDemoPerson').count(),6);
  assert.equal(await apPage.locator('#rnMarkLocation').isDisabled(),true);
  await apPage.locator('#rnClose').click();
  await apPage.locator('#mallSettingsBtn').click();
  assert.ok(await apPage.locator('#mallSettingsDialog').isVisible());
  assert.deepEqual(await apPage.locator('#mallSelect option').evaluateAll(
    options=>options.map(x=>x.value)),['aventura','ap-plaza']);
  assert.equal(await apPage.locator('#mallSelect').inputValue(),'ap-plaza');
  assert.match(await apPage.locator('#mallLocationStatus').innerText(),/desactivada/i);
  await apPage.locator('#mallSelect').selectOption('aventura');
  await Promise.all([
    apPage.waitForURL(url=>url.searchParams.get('mall')==='aventura'),
    apPage.locator('#mallApplyBtn').click()
  ]);
  await apPage.waitForFunction(()=>window.__RETAILNAV__?.getState().ready===true);
  assert.equal((await apPage.evaluate(()=>window.__RETAILNAV__.getState())).mallId,'aventura');
  log('MALL_SELECTOR','AP Plaza B1 and six isolated demo avatars work; settings switch back to Aventura.');
  // Do not leave a test identity on production.
  await apPage.waitForFunction(()=>window.RetailNavSocial?.getState().ready===true);
  await apPage.evaluate(async()=>fetch('api/account/delete',{
    method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:'{}'
  }));

  console.log('PASS WEB E2E: mobile browser, QR, consent, persistence, privacy and gesture');
}finally{
  await Promise.all(contexts.map(c=>c.close()));
  await browser.close();
}
