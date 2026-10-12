// End-to-end checks against the public HTTPS deployment in a touch-enabled browser.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const URL='https://improvingyourreality.com/retailnav/';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
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
  await page.locator('#rnMakeInvite').click();
  await page.waitForFunction(()=>document.querySelector('#rnLink')?.value.includes('#join='));
  assert.ok(await page.locator('#rnQr canvas, #rnQr img').count());
  const link=await page.locator('#rnLink').inputValue();
  assert.ok(link.startsWith(URL+'#join='));
  log('QR','Generated local QR image and one-time fragment invitation.');

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
  await page.locator('#rnFriends button',{hasText:'Quitar'}).click();
  await page.waitForFunction(()=>window.RetailNavSocial?.getState().friendCount===0);
  await guest.reload({waitUntil:'domcontentloaded'});
  await guest.waitForFunction(()=>window.RetailNavSocial?.getState().ready===true);
  assert.equal((await guest.evaluate(()=>window.RetailNavSocial.getState())).friendCount,0);
  log('CLEANUP','Reciprocal test contact removed from both accounts.');
  console.log('PASS WEB E2E: mobile browser, QR, consent, persistence, privacy and gesture');
}finally{
  await Promise.all(contexts.map(c=>c.close()));
  await browser.close();
}
