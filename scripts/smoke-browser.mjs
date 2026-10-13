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
  if(viewer.renderer==='WebGL'){
    await page.waitForFunction(()=>window.RetailNavPins.getSolidState().mode==='solid-webgl-mesh', null,{timeout:30000});
    const solid=await page.evaluate(()=>window.RetailNavPins.getSolidState());
    log('SOLID_DIAG',solid);
    assert.equal(solid.mode,'solid-webgl-mesh','Mesh initialization: '+solid.lastError+' / '+solid.lastSkipped);
    assert.ok(solid.triangles>100 && solid.bodyThicknessWorld>.3);
    assert.ok(solid.ringThicknessWorld>.1 && solid.fixedWorldRotation);
    assert.ok(solid.rendered>=1);
    log('TRUE_3D_MESH',solid);
  }else{
    assert.ok(pinInfo.paintedPixels>40 && pinInfo.bluePixels>12,'Fallback Canvas draws markers');
  }
  await page.waitForFunction(()=>window.RetailNavPins.getState().photoLoaded===9,
    null,{timeout:20000});
  assert.equal((await page.evaluate(()=>window.RetailNavPins.getState())).photoErrors,0);
  if(viewer.renderer!=='WebGL')assert.ok(pinInfo.canvasWidth>300 && pinInfo.canvasHeight>300);
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

  // A small one-touch floor picker replaces the giant screen-covering
  // floating floor badge. The separation control remains collapsed.
  assert.equal(await page.locator('#floorPicker').isVisible(),true);
  assert.equal(await page.locator('#floorSpacing').isVisible(),true);
  assert.equal(await page.locator('#labels .label.floor').count(),0);
  await page.locator('#floorSelect').selectOption('UL');
  viewer=await page.evaluate(()=>window.__RETAILNAV__.getState());
  assert.equal(viewer.active,'UL');
  assert.deepEqual(viewer.visible,['UL']);
  assert.equal(await page.locator('#floorSpacing').isVisible(),false);
  await page.locator('#floorSelect').selectOption('ALL');
  assert.deepEqual((await page.evaluate(()=>window.__RETAILNAV__.getState())).visible,['LL','UL','L3']);
  assert.equal(await page.locator('#floorSpacing').isVisible(),true);
  log('FLOORS','Compact 3D floor selector isolates levels, no overlaid giant floor marker.');
  // Reference photography and traces are independently visible, never one
  // pre-rendered composite that cannot be switched off.
  await page.locator('#original').click();
  assert.equal(await page.locator('#compareDialog').isVisible(),true);
  assert.equal((await page.evaluate(()=>window.RetailNavComparison.getState())).floorCount,3);

  const initialStyle=await page.evaluate(()=>({
    state:window.RetailNavComparison.getState(),
    fill:document.querySelector('#traceOverlay .rnCompareFeature')?.getAttribute('fill'),
    outline:document.querySelector('#traceOverlay .rnCompareFeature')?.getAttribute('stroke'),
    line:document.querySelector('#traceOverlay .rnCompareFeature')?.getAttribute('stroke-width'),
    alpha:document.querySelector('#traceOverlay .rnCompareFeature')?.style.fillOpacity,
    overlayAlpha:document.querySelector('#traceOverlay').style.opacity
  }));
  assert.equal(initialStyle.fill,'#000000');
  assert.equal(initialStyle.outline,'#ffffff');
  assert.equal(initialStyle.line,'2');
  assert.equal(Number(initialStyle.alpha),.4);
  assert.equal(initialStyle.overlayAlpha,'1',
    'Changing fill opacity must NOT make the white outline transparent');
  assert.equal(initialStyle.state.issueCount,0);
  await page.locator('#compareMode').selectOption('outline');
  assert.equal((await page.evaluate(()=>window.RetailNavComparison.getState())).appliedFillOpacity,0);
  assert.equal(await page.locator('#traceOverlay .rnCompareFeature').first().evaluate(e=>e.style.fillOpacity),'0');
  assert.equal(await page.locator('#traceOverlay .rnCompareFeature').first().evaluate(e=>e.getAttribute('stroke')),'#ffffff');
  await page.locator('#compareMode').selectOption('filled');
  await page.locator('#compareMarkMode').check();
  await page.locator('#compareSvg').evaluate(svg=>{
    const box=svg.getBoundingClientRect();
    svg.dispatchEvent(new MouseEvent('click',{
      bubbles:true,clientX:box.left+box.width*.51,clientY:box.top+box.height*.53
    }));
  });
  assert.equal(await page.locator('#compareSaveIssue').isDisabled(),false);
  await page.locator('#compareIssueType').selectOption('division-missing');
  await page.locator('#compareIssueNote').fill('Prueba de división faltante');
  await page.locator('#compareSaveIssue').click();
  assert.equal((await page.evaluate(()=>window.RetailNavComparison.getState())).issueCount,1);
  assert.equal(await page.locator('#compareIssueMarkers circle').count(),1);
  assert.ok(await page.locator('#compareIssues').innerText().then(t=>t.includes('Prueba de división faltante')));
  await page.locator('#compareIssues button').first().click();
  assert.equal((await page.evaluate(()=>window.RetailNavComparison.getState())).issueCount,0);
  await page.locator('#compareMarkMode').uncheck();
  log('VECTOR_QA_STYLE','Black fill at 40% with independently opaque 2px white outline and JSON-ready per-floor issue markers.');

  await page.locator('#showVectors').uncheck();
  assert.equal((await page.evaluate(()=>window.RetailNavComparison.getState())).vectorsVisible,false);
  await page.locator('#showReference').uncheck();
  assert.equal((await page.evaluate(()=>window.RetailNavComparison.getState())).originalVisible,false);
  await page.locator('#showReference').check();
  await page.locator('#showVectors').check();
  await page.locator('#overlayOpacity').evaluate(el=>{el.value='.33';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#compareZoom').evaluate(el=>{el.value='200';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal((await page.evaluate(()=>window.RetailNavComparison.getState())).opacity,.33);
  assert.equal(await page.locator('#compareSvg').evaluate(e=>e.style.width),'200%');
  await page.locator('#compareLevel').selectOption('LL');
  assert.equal((await page.evaluate(()=>window.RetailNavComparison.getState())).level,'LL');
  assert.equal((await page.evaluate(()=>window.RetailNavComparison.getState())).hasReference,true);
  await page.locator('#compareDialog [data-close]').click();
  log('COMPARE','Reference and vector layers can be hidden independently, zoomed and switched by floor.');

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
  if(viewer.renderer==='WebGL'){
    const faceA=await page.evaluate(()=>window.RetailNavPins.getSolidState().frontFacingDot);
    await page.evaluate(()=>{
      const el=document.querySelector('#canvas'),r=el.getBoundingClientRect();
      const x=r.left+r.width/2,y=r.top+r.height/2;
      const dispatch=(type,dx)=>el.dispatchEvent(new PointerEvent(type,{
        bubbles:true,cancelable:true,pointerId:35,pointerType:'touch',
        clientX:x+dx,clientY:y,button:0,buttons:type==='pointerup'?0:1
      }));
      dispatch('pointerdown',-75);dispatch('pointermove',110);dispatch('pointerup',110);
    });
    const faceB=await page.evaluate(()=>window.RetailNavPins.getSolidState().frontFacingDot);
    assert.ok(Math.abs(faceA-faceB)>.05,
      'World-fixed 3D photo face must change viewing angle on map rotation');
    log('PIN_PARALLAX',{before:faceA,after:faceB});
  }


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
  await page.locator('#floorSelect').selectOption('ALL');
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
  // Contabo's reverse proxy can briefly return a 502 during reload. Retry
  // idempotent state reads rather than parsing the gateway error as JSON.
  const vanished=await guest.evaluate(async()=>{
    for(let attempt=0;attempt<8;attempt++){
      try{
        const response=await fetch('api/state',{credentials:'same-origin',cache:'no-store'});
        if(response.ok){
          const data=await response.json();
          if(Array.isArray(data.friends))return data.friends[0];
        }
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,450));
    }
    throw new Error('Repeated api/state failures during location-sharing test');
  });
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
  // A mall with just one known floor must not show any floor UI, not even
  // a floating badge or an unused separation/stacking slider.
  assert.equal(await apPage.locator('#floorPicker').isVisible(),false);
  assert.equal(await apPage.locator('#floorSpacing').isVisible(),false);
  assert.equal(await apPage.locator('#showAllFloors').isVisible(),false);
  assert.equal(await apPage.locator('#labels .label.floor').count(),0);
  await apPage.locator('#original').click();
  assert.equal(await apPage.locator('#compareDialog').isVisible(),true);
  const reference=await apPage.evaluate(()=>({
    ...window.RetailNavComparison.getState(),
    href:document.querySelector('#referenceImage').getAttribute('href')
  }));
  assert.equal(reference.level,'B1');
  assert.equal(reference.hasReference,true);
  assert.equal(reference.compareMode,'filled');
  assert.equal(reference.fillColor,'#000000');
  assert.equal(reference.outlineColor,'#ffffff');
  assert.equal(reference.outlineWidthPx,2);
  assert.equal(reference.appliedFillOpacity,.40);
  assert.equal(reference.codeLabelsVisible,true);
  assert.equal(reference.geometricValidation,'pending',
    'Do not falsely declare provisional photograph-derived vectors verified');
  assert.ok(reference.href.includes('reference/ap-plaza/B1.webp'));
  assert.equal(await apPage.evaluate(async()=>(
    await fetch(document.querySelector('#referenceImage').getAttribute('href'))
  ).status),200);
  await apPage.locator('#showVectors').uncheck();
  assert.equal(await apPage.locator('#traceOverlay').evaluate(el=>getComputedStyle(el).display),'none');
  await apPage.locator('#showReference').uncheck();
  assert.equal(await apPage.locator('#referenceImage').evaluate(el=>getComputedStyle(el).display),'none');
  await apPage.locator('#showVectors').check();
  assert.notEqual(await apPage.locator('#traceOverlay').evaluate(el=>getComputedStyle(el).display),'none');
  await apPage.locator('#showReference').check();
  await apPage.locator('#compareZoom').evaluate(el=>{el.value='225';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await apPage.locator('#compareSvg').evaluate(el=>el.style.width),'225%');
  await apPage.locator('#compareDialog [data-close]').click();
  log('AP_FLOOR_COMPARISON','No floor widget for one floor; original photo and geometry independently toggle at adjustable zoom.');
  assert.ok(apStatus.viewer.features[0][1]>=40);
  assert.equal(apStatus.social.demoFriendCount,6);
  assert.equal(apStatus.pins.registered,6);
  const districts=await apPage.evaluate(()=>window.RetailNavDistricts.getState());
  assert.equal(districts.count,8,'District titles from the photographed floor plan must be preserved');
  if(apStatus.viewer.renderer==='WebGL'){
    await apPage.waitForFunction(()=>window.RetailNavDistricts.getState().mode==='floating-solid-district-3d',
      null,{timeout:20000});
    const district3D=await apPage.evaluate(()=>window.RetailNavDistricts.getState());
    assert.ok(district3D.rendered>=6,'All visible commercial-area names must render in 3D');
    assert.equal(district3D.cameraFacing,false,'Floating area names rotate with the actual map, never face the screen');
    assert.equal(district3D.tiedToFloor,true,'Each title must use its own selected floor base elevation');
    assert.equal(district3D.hasPhysicalSides,true,'Floating plaques need true 3D sides');
    assert.equal(district3D.hasBottomFace,true,'A 3D plaque needs a visible underside');
    assert.ok(district3D.floorClearance>=5,'Areas must float clearly above tallest mall roofs');
    assert.ok(district3D.panelThickness>=.4,'Floating area labels need visible physical thickness');
    assert.ok(district3D.triangles>=district3D.rendered*14,
      '3D area signs include upper surfaces, lower surfaces, sidewalls and shadows');
    assert.equal(district3D.positions.length,district3D.rendered);
    assert.ok(district3D.positions.every(p=>
      p.floor==='B1' && p.airGap>=5 &&
      Math.abs(p.bottomY-p.floorY-2.2-p.airGap)<.001),
      'District labels must be suspended relative to B1 instead of a global screen layer');
    const perspective=await apPage.evaluate(()=>{
      const district=window.RetailNavDistricts.getState().positions[0];
      const view=window.__RETAILNAV__;
      const roof=view.projectWorld([district.center[0],district.floorY+2.2,district.center[2]]);
      const floating=view.projectWorld(district.center);
      return {roof,floating};
    });
    assert.ok(Math.hypot(
      perspective.roof.x-perspective.floating.x,
      perspective.roof.y-perspective.floating.y)>3,
      'Area name must have a visible gap above the actual mall roof in the 3D camera');
    log('FLOATING_DISTRICTS',{
      shown:district3D.rendered,clearance:district3D.floorClearance,
      thickness:district3D.panelThickness,triangles:district3D.triangles
    });
    await apPage.waitForFunction(()=>window.RetailNavPins.getSolidState().frames>=2,
      null,{timeout:20000});
    const pin3D=await apPage.evaluate(()=>window.RetailNavPins.getSolidState());
    assert.ok(pin3D.worldHeightLimit<=6.4,'Friend pins need a strict upper height cap');
    assert.ok(pin3D.maxPinHeightWorld<=pin3D.worldHeightLimit+.001,
      'Actual pin meshes must never exceed the district sign clearance');
    assert.equal(pin3D.noLabelIntersections,true,
      'No 3D friend pin may overlap any projected commercial-zone label');
    assert.ok(pin3D.maxPinHeightPx<115,
      'Reduce visually oversized pins on mobile, including oblique views');
    const cameraBefore=await apPage.evaluate(()=>window.__RETAILNAV__.getState().distance);
    await apPage.evaluate(()=>window.__RETAILNAV__.focusAt('B1',[400,280],83));
    await apPage.waitForFunction(d=>Math.abs(window.__RETAILNAV__.getState().distance-d)>10,
      cameraBefore,{timeout:15000});
    await apPage.waitForFunction(()=>window.RetailNavPins.getSolidState().noLabelIntersections,
      null,{timeout:15000});
    const afterZoom=await apPage.evaluate(()=>window.RetailNavPins.getSolidState());
    assert.equal(afterZoom.noLabelIntersections,true,
      'Zooming to floor must never put a pin through a suspended label');
    assert.ok(afterZoom.maxPinHeightWorld<=6.401);
    log('PIN_LABEL_COLLISION',{initial:pin3D.rendered,hidden:pin3D.occludedByLabels,
      maxHeight:pin3D.maxPinHeightWorld,afterZoom:afterZoom.maxPinHeightWorld});

  }
  await apPage.locator('#search').fill('Electronic Digital City');
  assert.ok(await apPage.locator('#results .rnDistrictResult').count()>=1);
  await apPage.locator('#results .rnDistrictResult').first().click();
  assert.equal((await apPage.evaluate(()=>window.RetailNavDistricts.getState())).focused,'electronic-digital-city');
  await apPage.locator('#search').fill('');
  log('DISTRICTS','Eight photographed zone names placed in world-space and searchable.');
  const ids=await apPage.evaluate(()=>window.RetailNavUnits.getState());
  assert.ok(ids.count>=80,'Shop identifiers must survive mall vectorisation');
  await apPage.locator('#search').fill('K1-31');
  assert.ok(await apPage.locator('#results .rnUnitResult').count()>=1);
  await apPage.locator('#results .rnUnitResult').first().click();
  assert.equal((await apPage.evaluate(()=>window.RetailNavUnits.getState())).selected,'K1-31');
  await apPage.locator('#rnUnitClose').click();
  await apPage.locator('#search').fill('');
  if(apStatus.viewer.renderer==='WebGL'){
    await apPage.evaluate(()=>window.RetailNavUnits.focus('A-01'));
    await apPage.waitForFunction(()=>window.RetailNavUnits.getRoofState()?.raised>=1,
      null,{timeout:18000});
    const roof=await apPage.evaluate(()=>window.RetailNavUnits.getRoofState());
    assert.equal(roof.cameraFacing,false);
    assert.ok(roof.labelledRoofs>=1);
    assert.equal(roof.raisedHasExtrudedBody,true);
    assert.equal(roof.raisedHasPhysicalPosts,true);
    log('ROOF_SIGNS',roof);
  }
  log('STORE_IDS','Shop codes indexed and searchable, including unresolved regions.');

  const poi=await apPage.evaluate(()=>window.RetailNavPOI?.getState());
  assert.ok(poi&&poi.count>=10,'AP Plaza must include semantic bathrooms, exits, escalators and information');
  assert.equal(await apPage.evaluate(()=>window.RetailNavPOI.show('ap-b1-info')),true);
  await apPage.waitForFunction(()=>window.RetailNavPOI?.getState().shown.includes('ap-b1-info'),
    null,{timeout:18000});
  assert.ok(await apPage.locator('#rnServicesToggle').isVisible());
  await apPage.locator('#search').fill('baños');
  assert.ok(await apPage.locator('#results .rnPoiResult').count()>=2,
    'Searching for toilets must return both AP Plaza bathroom facilities');
  await apPage.locator('#search').fill('');
  await apPage.locator('#rnServicesToggle').click();
  assert.equal((await apPage.evaluate(()=>window.RetailNavPOI.getState())).enabled,false);
  await apPage.locator('#rnServicesToggle').click();
  assert.equal((await apPage.evaluate(()=>window.RetailNavPOI.getState())).enabled,true);
  log('AP_AMENITIES','POI layer searchable: bathrooms, lift, metro, exits and information; uncertainty disclosed.');
  await apPage.waitForFunction(()=>window.RetailNavPins?.getState().photoLoaded===6,
    null,{timeout:25000});
  assert.equal(await apPage.locator('#routeBtn').isDisabled(),true);
  await apPage.locator('#friendsBtn').click();
  assert.equal(await apPage.locator('#rnDemoFriends .rnDemoPerson').count(),6);
  assert.equal(await apPage.locator('#rnMarkLocation').isDisabled(),true);
  await apPage.locator('#rnClose').click();
  await apPage.locator('#rnIndoorBtn').click();
  assert.ok(await apPage.locator('#rnIndoorDialog').isVisible());
  const indoors=await apPage.evaluate(()=>window.RetailNavIndoor.getState());
  assert.equal(indoors.anchor,null,'GPS may not fabricate any indoor coordinates');
  assert.equal(indoors.sendsDataToServer,false);
  await apPage.evaluate(()=>window.dispatchEvent(new CustomEvent('retailnav:map-point',{
    detail:{floor:'B1',x:525,y:320}
  })));
  const anchored=await apPage.evaluate(()=>window.RetailNavIndoor.getState());
  assert.equal(anchored.indoorSource,'manual-anchor');
  assert.equal(anchored.anchor.floor,'B1');
  await apPage.locator('#rnIndoorResetBtn').click();
  assert.equal((await apPage.evaluate(()=>window.RetailNavIndoor.getState())).anchor,null);
  await apPage.locator('#rnIndoorClose').click();
  log('INDOOR_CALIBRATION','Opt-in anchor, compass controls and data erasure.');
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
