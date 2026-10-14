import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {resolve,extname} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';

// Host the static app from one HTTP origin. file:// pages taint locally loaded
// avatars for WebGL texture uploads, while the real Contabo site is same-origin.
const root=resolve('public');
const staticServer=createServer((req,res)=>{
 try{
  const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
    .slice(1)||'index.html';
  const full=resolve(root,relative);
  if(!full.startsWith(root+'/')){res.writeHead(403);res.end();return;}
  const mime={'.html':'text/html','.js':'application/javascript',
    '.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png',
    '.svg':'image/svg+xml','.json':'application/json'};
  const bytes=readFileSync(full);
  res.writeHead(200,{'Content-Type':mime[extname(full)]||'application/octet-stream'});
  res.end(bytes);
 }catch(err){
  if(!res.headersSent)res.writeHead(404);
  res.end();
 }
});
staticServer.listen(0,'127.0.0.1');
await once(staticServer,'listening');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:840}});
const exceptions=[];
page.on('pageerror',e=>exceptions.push(String(e)));
try {
  await page.goto('http://127.0.0.1:'+staticServer.address().port
     +'/index.html?mall=new-world-city-shanghai');
  await page.waitForFunction(()=>window.__RETAILNAV__?.getState().ready, {timeout:45000});
  let state=await page.evaluate(()=>window.__RETAILNAV__.getState());
  assert.equal(state.mallId,'new-world-city-shanghai');
  assert.equal(state.features.length,9,'RetailNav must display NINE floors, not seven');
  assert.deepEqual(state.features.map(f=>f[0]),['L1','L2','L3','L4','L5','L6','L7','L8','L9']);
  assert.equal(state.features.reduce((sum,f)=>sum+f[1],0),737);
  assert.ok(await page.locator('#mallHeaderName').innerText().then(t=>t.includes('新世界城')));
  assert.equal(await page.locator('#floorSelect option').count(),10);
  assert.equal(await page.evaluate(()=>window.RetailNavPOI.getState().count),110);
  assert.ok(await page.evaluate(()=>window.RetailNavUnits.getState().count)>=380);
  const mall=await page.evaluate(()=>window.RETAILNAV_ACTIVE_MALL);
  assert.equal(mall.navigable,false);
  assert.equal(mall.floorAlignmentApproved,false);
  assert.equal(mall.floorReferences.L8.imageSize[0],1376);
  // Full spherical 3D is the default for this mall, with roll/pitch/yaw
  // independent and no special block on an upside-down camera.
  assert.equal(state.trackball360,true);
  assert.equal(state.gestureMode,'orbit-3d');
  assert.equal(state.rotationAxes,3);
  assert.equal(state.verticalConnectorCount,39);
  assert.ok(await page.locator('#rnHeightsPanel').isVisible());
  assert.ok(await page.locator('#rnConnectorsToggle').isVisible());
  assert.equal(await page.evaluate(()=>window.RetailNavPins.getState().registered),18);
  const guests=await page.evaluate(()=>window.RETAILNAV_DEMO_CONTACTS);
  assert.equal(guests.length,18);
  assert.deepEqual([...new Set(guests.map(p=>p.position.floor))].sort(),
    ['L1','L2','L3','L4','L5','L6','L7','L8','L9']);
  assert.ok(guests.every(p=>p.position.verified===false
     &&p.position.placementStatus==='photo-corridor-candidate-unverified'));

  // One finger rotates the quaternion (not just a bounded map pitch).
  const spherical=await page.evaluate(()=>{
    const el=document.getElementById('canvas'),r=el.getBoundingClientRect();
    const x=r.left+r.width/2,y=r.top+r.height/2;
    const send=(type,dx,dy)=>el.dispatchEvent(new PointerEvent(type,{
      bubbles:true,cancelable:true,pointerType:'touch',pointerId:66,
      button:0,buttons:type==='pointerup'?0:1,clientX:x+dx,clientY:y+dy
    }));
    const before=window.__RETAILNAV__.getState().cameraQuaternion;
    send('pointerdown',-80,-50);
    send('pointermove',90,150);
    const after=window.__RETAILNAV__.getState().cameraQuaternion;
    send('pointerup',90,150);
    for(let i=0;i<24;i++)el.dispatchEvent(new KeyboardEvent('keydown',{
       bubbles:true,cancelable:true,key:'PageDown'
    }));
    const inverted=window.__RETAILNAV__.getState();
    return {before,after,inverted};
  });
  assert.ok(spherical.before.some((v,i)=>Math.abs(v-spherical.after[i])>.12),
    'Drag on sphere rotates camera orientation');
  assert.ok(spherical.inverted.cameraUp.every(Number.isFinite));
  assert.ok(spherical.inverted.cameraUp[1]<0,
    'Camera must pass above, below, and upside down without a pole clamp');
  assert.ok(Math.abs(Math.hypot(...spherical.inverted.cameraQuaternion)-1)<.00001);
  await page.locator('#reset').click();

  // Changing L3 from 4m to 6m moves L4-L9 AND recomputes every link from L3.
  const original=await page.evaluate(()=>({
    state:window.__RETAILNAV__.getState(),
    links:window.__RETAILNAV__.getVerticalConnections()
  }));
  assert.equal(original.state.floorHeightsMetres.L3,4);
  assert.equal(original.state.floorElevationsMetres.L4,12);
  const success=await page.evaluate(()=>window.__RETAILNAV__.editFloorHeight('L3',6));
  assert.equal(success,true);
  const updated=await page.evaluate(()=>({
    state:window.__RETAILNAV__.getState(),
    links:window.__RETAILNAV__.getVerticalConnections()
  }));
  assert.equal(updated.state.floorHeightsMetres.L3,6);
  assert.equal(updated.state.floorElevationsMetres.L4,14);
  assert.equal(updated.state.floorElevationsMetres.L9,34);
  const link3=updated.links.find(x=>x.from==='L3'&&x.to==='L4');
  assert.ok(link3&&link3.riseMetres===6);
  assert.ok(updated.links.every(x=>x.verified===false));
  assert.ok(updated.links.find(x=>x.from==='L3').toY>
    original.links.find(x=>x.from==='L3').toY);
  await page.locator('#rnHeightsPanel summary').click();
  await page.locator('#rnHeightLevel').selectOption('L3');
  assert.equal(await page.locator('#rnHeightValue').inputValue(),'6');
  await page.locator('#rnHeightValue').fill('5');
  await page.locator('#rnHeightValue').dispatchEvent('change');
  assert.equal(await page.evaluate(()=>window.__RETAILNAV__.getState().floorHeightsMetres.L3),5);
  await page.locator('#rnHeightReset').click();
  assert.equal(await page.evaluate(()=>window.__RETAILNAV__.getState().floorHeightsMetres.L3),4);
  await page.locator('#rnHeightsPanel summary').click();

  // Connector show/hide must be a real interaction, not an inert legend.
  await page.locator('#rnConnectorsToggle').click();
  assert.equal((await page.evaluate(()=>window.__RETAILNAV__.getState())).verticalConnectionsVisible,false);
  await page.locator('#rnConnectorsToggle').click();
  assert.equal((await page.evaluate(()=>window.__RETAILNAV__.getState())).verticalConnectionsVisible,true);

  await page.locator('#floorSelect').selectOption('L8');
  await page.waitForFunction(()=>window.__RETAILNAV__?.getState().active==='L8');
  await page.locator('#original').click();
  await page.waitForFunction(()=>document.getElementById('compareDialog').open);
  await page.locator('#compareLevel').selectOption('L9');
  await page.waitForFunction(()=>document.getElementById('referenceImage').getAttribute('href')?.includes('L9.webp'));
  await page.screenshot({path:'/tmp/retailnav-newworld9-main.png'});
  assert.deepEqual(exceptions,[],exceptions.join('\n'));
  console.log('PASS main RetailNav New World City L1–L9 map / photo comparison / POIs');
}finally {
  await browser.close();
  await new Promise(done=>staticServer.close(done));
}
