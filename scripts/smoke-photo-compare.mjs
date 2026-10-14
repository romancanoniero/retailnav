// Focused public-HTTPS photo/vector E2E; independent of QR/social API health.
// Browser emulates an iPhone for Chromium and Safari WebKit, exercising the
// exact SVG used by the user to compare their New World City floor photographs.
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

const URL='https://improvingyourreality.com/retailnav/';
const engine=process.env.RN_BROWSER==='webkit'?webkit:chromium;
const browser=await engine.launch({
 headless:true,...(engine===chromium?{args:['--no-sandbox']}:{})
});

async function compareMall(mall){
 const context=await browser.newContext({
  viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,
  hasTouch:true,locale:'es-AR'
 });
 const page=await context.newPage();
 try{
  page.on('pageerror',e=>console.error(mall,'PAGE ERROR:',e.message));
  await page.goto(URL+'?mall='+mall,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>window.__RETAILNAV__?.getState().ready,
   null,{timeout:45000});
  await page.locator('#original').click();
  assert.equal(await page.locator('#compareDialog').isVisible(),true);
  const initial=await page.evaluate(()=>{
   const v=window.RetailNavComparison.getState();
   const frame=document.querySelector('#compareViewport');
   return {v,frameHeight:frame.getBoundingClientRect().height,
    frameWidth:frame.getBoundingClientRect().width,
    touch:getComputedStyle(frame).touchAction,
    ref:document.querySelector('#referenceImage').getAttribute('href')};
  });
  assert.equal(initial.v.touchGesturesEnabled,true);
  assert.equal(initial.v.panPinchSynchronized,true);
  assert.equal(initial.v.zoomPercent,100);
  assert.equal(initial.touch,'none');
  assert.ok(initial.frameWidth>200&&initial.frameHeight>160);
  assert.ok(initial.ref,'Source photograph must load');
  const level=initial.v.level;
  await page.locator('#compareZoom').evaluate(input=>{
   input.value='200';input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  const response=await page.evaluate(()=>{
   const svg=document.getElementById('compareSvg'),frame=document.getElementById('compareViewport');
   const rect=frame.getBoundingClientRect();
   const x=rect.left+rect.width*.48,y=rect.top+rect.height*.49;
   const snap=()=>window.RetailNavComparison.getState();
   const touch=(type,id,dx,dy)=>svg.dispatchEvent(new PointerEvent(type,{
    bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,button:0,
    buttons:type==='pointerup'?0:1,clientX:x+dx,clientY:y+dy
   }));
   const baseline=snap();
   // One finger, move the image just as it follows a finger in Apple Maps.
   touch('pointerdown',131,-30,-15);
   touch('pointermove',131,13,17);
   const panned=snap();
   touch('pointerup',131,13,17);
   // Two fingers spread then pinch. The SVG's intrinsic photo/vector
   // coordinate system must remain unchanged; only one root transform moves.
   touch('pointerdown',132,-30,0);
   touch('pointerdown',133,30,0);
   touch('pointermove',133,100,0);
   const pinchOut=snap();
   touch('pointerup',133,100,0);
   touch('pointerup',132,-30,0);
   touch('pointerdown',134,-75,0);
   touch('pointerdown',135,75,0);
   touch('pointermove',135,20,0);
   const pinchIn=snap();
   touch('pointerup',135,20,0);
   touch('pointerup',134,-75,0);
   const released=snap();
   const a=document.querySelector('#referenceImage').getScreenCTM();
   const b=document.querySelector('#traceOverlay').getScreenCTM();
   const same=Array.from(['a','b','c','d','e','f']).every(key=>Math.abs(a[key]-b[key])<.00001);
   return {baseline,panned,pinchOut,pinchIn,released,same,
    slider:document.querySelector('#compareZoom').value};
  });
  assert.equal(response.baseline.zoomPercent,200);
  assert.ok(response.panned.panX>response.baseline.panX+18,
   'A positive X drag moves the photo to the right');
  assert.ok(response.panned.panY>response.baseline.panY+7,
   'A positive Y drag moves the photo downward');
  assert.ok(response.pinchOut.zoomPercent>response.panned.zoomPercent,
   'Spreading two fingers enlarges the map');
  assert.ok(response.pinchIn.zoomPercent<response.pinchOut.zoomPercent,
   'Bringing two fingers together reduces scale');
  assert.equal(response.released.pointerCount,0,
   'Pointer IDs are cleared AFTER both contacts are released');
  assert.ok(response.same,'Photo and polygon paths have identical screen CTM');
  assert.equal(Number(response.slider),response.pinchIn.zoomPercent,
   'Slider stays in sync after pinch');
  await page.locator('#compareResetView').click();
  const reset=await page.evaluate(()=>window.RetailNavComparison.getState());
  assert.equal(reset.zoomPercent,100);
  assert.ok(Math.abs(reset.panX)<35);
  await page.locator('#compareZoom').evaluate(input=>{
   input.value='1200';input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  assert.equal((await page.evaluate(()=>window.RetailNavComparison.getState())).zoomPercent,1200);
  await page.locator('#compareResetView').click();
  if(mall==='new-world-city-shanghai'){
   await page.locator('#compareLevel').selectOption('L3');
   const changed=await page.evaluate(()=>window.RetailNavComparison.getState());
   assert.equal(changed.level,'L3');
   assert.equal(changed.zoomPercent,100);
   assert.equal(changed.pointerCount,0);
  }
  console.log('PHOTO_COMPARE_PASS',JSON.stringify({
   engine:engine.name(),mall,level,frame:[initial.frameWidth,initial.frameHeight],
   pan:true,pinchOut:true,pinchIn:true,
   zoom1200:true,reset:true,aligned:true
  }));
 } finally{
  await context.close();
 }
}

try{
 await compareMall('aventura');
 await compareMall('new-world-city-shanghai');
 console.log('PASS focused iPhone photo/vector compare gestures:',engine.name());
}finally{
 await browser.close();
}
