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
  // Default: the visitor's provisional reference floor. The previous
  // nine-floor regression now explicitly selects the all-floors view to
  // check exactly the same 25 escalator banks and geometric invariants.
  assert.equal(state.active,'L1');
  assert.deepEqual(state.visible,['L1']);
  await page.locator('#floorSelect').selectOption('ALL');
  await page.waitForFunction(()=>window.__RETAILNAV__?.getState().active==='ALL');
  state=await page.evaluate(()=>window.__RETAILNAV__.getState());
  assert.deepEqual(state.visible,['L1','L2','L3','L4','L5','L6','L7','L8','L9']);
  // Both shops and services now belong to their own REAL 3D polygon
  // geometry, including actual raised voxel-mesh characters on shop roofs.
  const roof=await page.evaluate(()=>{
    const state=window.__RETAILNAV__.getState(),floors=window.__RETAILNAV__.floors;
    const bath=floors.flatMap(f=>f.features).find(f=>f.k==='amenity'&&
      f.amenityCategory==='toilet');
    const lift=floors.flatMap(f=>f.features).find(f=>f.k==='amenity'&&
      f.amenityCategory==='elevator');
    const labelled=floors.flatMap(f=>f.features).find(f=>f.k==='unit'&&f.storeName);
    const roofData=floors.reduce((n,f)=>n+
      (f.roofText?.codes?.length||0)+(f.roofText?.services?.length||0)+
      (f.roofText?.names?.length||0),0);
    const svc=(bath||lift)&&window.RETAILNAV_ACTIVE_MALL.pois.find(
      p=>p.geometryId===(bath||lift).id&&p.floor===(bath||lift).floor);
    const hiddenMarker=svc&&document.querySelector(
      '.rnPoiMarker[data-poi-id="'+svc.id+'"]');
    return {
      summary:state.roofTextSummary,bath:{id:bath?.id,k:bath?.k,
        floor:bath?.floor,category:bath?.amenityCategory,poiId:bath?.poiId},
      lift:{id:lift?.id,k:lift?.k,category:lift?.amenityCategory},
      knownLabel:labelled&&{id:labelled.id,name:labelled.storeName,
        code:labelled.storeCode},
      roofData,hiddenMarker:!!hiddenMarker&&hiddenMarker.hidden,
      attached:window.RETAILNAV_ROOF_ATTACHMENTS?.size,
      visibleCodes:floors.flatMap(f=>f.features).filter(
        f=>f.k==='unit'&&f.storeCode).length,
      raisedLettersOnL7:(floors.find(f=>f.id==='L7')?.roofText?.codes?.length||0)>300,
      serviceFaces:floors.reduce((n,f)=>n+(f.roofGpu?.services?.n||0),0),
      raisedHasThickness:floors.some(f=>(f.roofText?.codes?.length||0)>100
        &&f.roofText.codes.some((v,i)=>i%10===4&&Math.abs(v)<.01))
    };
  });
  assert.ok(roof.summary.serviceRoofs>=6,'Service footprint areas must be solid 3D rooms');
  assert.ok(roof.summary.servicePictograms>=6,
    'WC and lift pictograms must be actual raised geometry on the service roofs');
  assert.ok(roof.summary.services.some(s=>s.extrudedIcon&&s.category==='toilet'));
  assert.ok(roof.summary.services.some(s=>s.extrudedIcon&&s.category==='elevator'));
  const vectorServices=await page.evaluate(()=>{
    const library=window.RetailNavServiceIcons;
    return {
      version:library?.version,categories:library?.categories,
      bathroomPolygons:library?.shapes?.toilet?.length||0,
      elevatorPolygons:library?.shapes?.elevator?.length||0,
      bathroomSvg:library?.svg?.('toilet'),
      elevatorSvg:library?.svg?.('elevator'),
      detachedCandidatesVisible:[...document.querySelectorAll('.rnPoiMarker')]
        .filter(el=>!el.hidden&&window.RETAILNAV_ACTIVE_MALL.pois.some(
          p=>p.id===el.dataset.poiId&&p.source==='photo-colour-candidate')).length
    };
  });
  assert.ok(vectorServices.version.includes('3d-v1'));
  assert.deepEqual(vectorServices.categories,['toilet','elevator']);
  assert.ok(vectorServices.bathroomPolygons>=10);
  assert.ok(vectorServices.elevatorPolygons>=18);
  assert.ok(vectorServices.bathroomSvg.includes('<svg')&&
    vectorServices.bathroomSvg.includes('<polygon'));
  assert.ok(vectorServices.elevatorSvg.includes('<svg')&&
    vectorServices.elevatorSvg.includes('<polygon'));
  assert.equal(vectorServices.detachedCandidatesVisible,0,
    'Photo-derived services must not leave disconnected emoji on screen');
  assert.ok(roof.summary.commercialRoofs>=550,'3D roofs available for every shop candidate');
  assert.ok(roof.summary.codeLabels>=200,'Many individual codes must have true raised geometry');
  assert.ok(roof.summary.extrudedTriangles>900,'Letters must have top and 3D side triangles');
  assert.ok(roof.bath.id&&roof.bath.poiId&&roof.lift.id);
  assert.ok(roof.raisedLettersOnL7&&roof.raisedHasThickness);
  assert.ok(roof.serviceFaces>100);
  assert.equal(roof.hiddenMarker,true,'Bathroom icon must not float detached from roof');
  assert.ok(roof.attached>=6);
  assert.ok(roof.visibleCodes>=550);
  assert.ok(roof.knownLabel||roof.summary.knownNameLabels===0,
    'Unverified names must never be fabricated');
  const bathUI=await page.evaluate(()=>{
    const room=window.__RETAILNAV__.floors.flatMap(f=>f.features).find(
      f=>f.k==='amenity'&&f.amenityCategory==='toilet');
    window.__RETAILNAV__.select(room);
    return document.getElementById('detailName').textContent;
  });
  assert.ok(bathUI.includes('Baños'),'Tap on bathroom 3D roof selects its amenity');

  // The user selected full 360° orbit as the DEFAULT, including underside.
  assert.equal(state.trackball360,true);
  assert.equal(state.gestureMode,'orbit-3d');
  assert.equal(state.rotationAxes,3);
  assert.equal(state.escalatorFixtureCount,25);
  assert.equal(state.escalatorRenderStats.banks,25);
  assert.ok(state.escalatorRenderStats.triangles>2500);
  assert.equal(state.escalatorRenderStats.display,'physical-estimate');
  const stairs=await page.evaluate(()=>window.__RETAILNAV__.getEscalatorModels());
  assert.equal(stairs.length,25);
  assert.ok(stairs.every(s=>s.stepRows>=16&&s.angleDegrees>=27&&s.angleDegrees<=33));
  assert.ok(stairs.every(s=>s.verified===false&&s.entryExitKnown===false&&s.direction==='unknown'));
  assert.equal(stairs.filter(s=>s.floor==='L7').length,4);
  assert.equal(await page.locator('#plan').getAttribute('aria-label'),'Pasar a vista 2D');
  assert.equal(await page.locator('#north').count(),1,
    'compass control remains available to the viewer even when the side HUD is hidden');
  // Secondary mode retains native Earth gestures and compass.
  await page.locator('#pan').click();
  state=await page.evaluate(()=>window.__RETAILNAV__.getState());
  assert.equal(state.trackball360,false);
  assert.equal(state.gestureMode,'map-pan');
  assert.equal(state.gestureProfile,'google-earth-touch-v1');
  assert.equal(state.compassReference,'photo-top-only-not-calibrated-true-north');
  assert.equal(state.verticalConnectorCount,39);
  assert.equal(state.liftShaftCandidateCount,3);
  assert.equal(state.liftShaftStats.continuousCount,1);
  assert.equal(state.liftShaftStats.shape,'framed-transparent-shaft');
  assert.equal(state.liftShaftStats.navigationApproved,false);
  const liftCores=await page.evaluate(()=>window.__RETAILNAV__.getLiftShaftModels());
  assert.equal(liftCores.length,1);
  assert.equal(liftCores[0].from,'L1');
  assert.equal(liftCores[0].to,'L9');
  assert.deepEqual(liftCores[0].floors,
    ['L1','L2','L3','L4','L5','L6','L7','L8','L9']);
  assert.ok(liftCores[0].heightWorld>34);
  assert.ok(liftCores[0].continuous===true);
  assert.ok(liftCores[0].maxPhotoDeviationPx>50,
    'L3 registration mismatch must remain explicitly provisional');
  assert.equal(liftCores[0].landingMatchVerified,false);
  assert.ok(await page.locator('#rnHeightsPanel').isVisible());
  assert.ok(await page.locator('#rnConnectorsToggle').isVisible());
  assert.equal(await page.evaluate(()=>window.RetailNavPins.getState().registered),18);
  const guests=await page.evaluate(()=>window.RETAILNAV_DEMO_CONTACTS);
  assert.equal(guests.length,18);
  assert.deepEqual([...new Set(guests.map(p=>p.position.floor))].sort(),
    ['L1','L2','L3','L4','L5','L6','L7','L8','L9']);
  assert.ok(guests.every(p=>p.position.verified===false
     &&p.position.placementStatus==='photo-corridor-candidate-unverified'));

  // Google Earth: drag one finger moves map without rotating it.
  const earth=await page.evaluate(()=>{
    const view=window.__RETAILNAV__,el=document.querySelector('#canvas');
    const rect=el.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;
    const event=(type,id,dx,dy)=>el.dispatchEvent(new PointerEvent(type,{
      bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,button:0,
      buttons:type==='pointerup'?0:1,clientX:x+dx,clientY:y+dy
    }));
    const before=view.getState();
    event('pointerdown',101,-80,-50);event('pointermove',101,45,35);
    const panned=view.getState();event('pointerup',101,45,35);

    const preTilt=view.getState();
    event('pointerdown',102,-50,0);event('pointerdown',103,50,0);
    event('pointermove',102,-50,-54);
    event('pointermove',103,50,-54);
    const tilted=view.getState();
    event('pointerup',103,50,-54);event('pointerup',102,-50,-54);

    const preTwist=view.getState();
    event('pointerdown',104,-60,0);event('pointerdown',105,60,0);
    event('pointermove',105,8,80);
    const twisted=view.getState();
    event('pointerup',105,8,80);event('pointerup',104,-60,0);

    const prePinch=view.getState();
    event('pointerdown',106,-30,0);event('pointerdown',107,30,0);
    event('pointermove',106,-90,0);event('pointermove',107,90,0);
    const pinched=view.getState();
    event('pointerup',107,90,0);event('pointerup',106,-90,0);

    return {before,panned,preTilt,tilted,preTwist,twisted,prePinch,pinched};
  });
  assert.ok(Math.hypot(...earth.panned.target.map((v,i)=>v-earth.before.target[i]))>.25,
    'One-finger drag translates the Earth-style map');
  assert.ok(earth.panned.q.every((v,i)=>Math.abs(v-earth.before.q[i])<.0001),
    'Pan should not orbit the camera');
  assert.ok(earth.tilted.orbitPitch>earth.preTilt.orbitPitch+.12,
    'Two fingers moving up tilt the map toward a side perspective');
  assert.ok(earth.twisted.orbitYaw>earth.preTwist.orbitYaw+.4,
    'Clockwise two-finger twist rotates the map');
  assert.ok(earth.pinched.distance<earth.prePinch.distance*.55,
    'Two-finger pinch-out zooms closer');
  assert.ok(earth.twisted.orbitPitch<=-.25&&earth.twisted.orbitPitch>=-Math.PI/2,
    'Earth-like tilt never flips the floor upside-down');
  const northBefore=await page.evaluate(()=>window.__RETAILNAV__.getState());
  await page.locator('#north').click();
  const northAfter=await page.evaluate(()=>window.__RETAILNAV__.getState());
  assert.ok(Math.abs(northAfter.orbitYaw)<.00001,'Compass resets photo reference heading');
  assert.equal(northAfter.distance,northBefore.distance,'Compass preserves zoom');
  assert.ok(Math.abs(northAfter.orbitPitch-northBefore.orbitPitch)<.001,
    'Compass preserves tilt');
  await page.locator('#plan').click();
  const flat=await page.evaluate(()=>window.__RETAILNAV__.getState());
  assert.equal(flat.earth2D,true);
  assert.ok(Math.abs(flat.orbitPitch+Math.PI/2)<.00001);
  assert.equal(flat.distance,northAfter.distance,'2D toggle preserves zoom');
  assert.equal(await page.locator('#rnViewModeLabel').textContent(),'3D');
  await page.locator('#plan').click();
  const tiltedAgain=await page.evaluate(()=>window.__RETAILNAV__.getState());
  assert.equal(tiltedAgain.earth2D,false);
  assert.ok(tiltedAgain.orbitPitch> -Math.PI/2+.15,'3D restores a usable tilt');
  assert.equal(tiltedAgain.distance,northAfter.distance,'3D toggle preserves zoom');
  assert.equal(await page.locator('#rnViewModeLabel').textContent(),'2D');

  // Advanced mode remains available without replacing the Earth gestures.
  await page.locator('#pan').click();
  state=await page.evaluate(()=>window.__RETAILNAV__.getState());
  assert.equal(state.trackball360,true);
  assert.equal(state.gestureMode,'orbit-3d');
  assert.equal(state.rotationAxes,3);

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
  // The 2D control intentionally focuses L2, so restore the whole building
  // before validating geometry changes across its nine storeys.
  await page.locator('#floorSelect').selectOption('ALL');
  await page.waitForFunction(()=>window.__RETAILNAV__.getState().active==='ALL');

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
  const lifted=await page.evaluate(()=>window.__RETAILNAV__.getLiftShaftModels());
  assert.equal(lifted.length,1);
  assert.ok(Math.abs(lifted[0].heightWorld-liftCores[0].heightWorld-2)<.01,
    'Changing the L3 height extends the continuous shaft automatically');
  const stairs6=await page.evaluate(()=>window.__RETAILNAV__.getEscalatorModels());
  assert.equal(stairs6.find(s=>s.id==='L3-west').riseMetres,6);
  assert.ok(stairs6.every(s=>s.riseMetres<=12&&!s.verified),
    'Height edits must rebuild only schematic escalator 3D risers');
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
  assert.equal(await page.evaluate(()=>window.__RETAILNAV__.getState().escalatorRenderStats.banks),2);
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
