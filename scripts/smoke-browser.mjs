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
  await page.waitForFunction(()=>{
   const img=document.querySelector('#mallHeaderLogo');
   return img&&!img.hidden&&img.complete&&img.naturalWidth>0;
  },null,{timeout:15000});
  log('START',{renderer:viewer.renderer,active:viewer.active,features:viewer.features,social});
  assert.deepEqual(viewer.visible,['LL'],
   'Aventura should start on the provisional visitor ground floor');
  assert.equal(viewer.referenceFloor,'LL');
  // Product default is full spherical 360° rotation. Switch to Earth-like
  // panning explicitly for the map-pan, two-finger tilt and pinch checks below.
  // The right toolbar is intentionally hidden on mobile to preserve map space;
  // reveal it only in this harness so its interaction handlers remain covered.
  assert.equal(viewer.gestureMode,'orbit-3d','Spherical 360 rotation is the default');
  assert.equal(await page.locator('#pan').isVisible(),false,
    'Mobile map controls stay hidden to preserve the map viewport');
  await page.locator('.hudright').evaluate(el=>el.style.setProperty('display','flex','important'));
  await page.locator('#pan').click();
  assert.equal((await page.evaluate(()=>window.__RETAILNAV__.getState())).gestureMode,'map-pan');
  assert.ok(social.anonymous);
  const aventuraLayout=await page.evaluate(()=>{
    const stage=document.querySelector('.stage'),search=document.querySelector('#rnMapSearch');
    const a=stage.getBoundingClientRect(),b=search.getBoundingClientRect();
    return {
     headerName:document.querySelector('#mallHeaderName')?.textContent,
     logoHidden:document.querySelector('#mallHeaderLogo')?.hidden,
     searchCount:document.querySelectorAll('#search').length,
     searchInsideMap:stage.contains(document.querySelector('#search')),
     searchVisible:b.width>0&&b.height>0,
     searchNearTop:b.top>=a.top-2&&b.top<a.top+135,
     brandOrder:document.querySelector('#mallHeaderLogo').compareDocumentPosition(
       document.querySelector('#mallHeaderName'))&Node.DOCUMENT_POSITION_FOLLOWING,
     oldRetailNavWordmark:!!document.querySelector('.topbar .brand')
    };
  });
  assert.equal(aventuraLayout.headerName,'Aventura Mall');
  assert.equal(aventuraLayout.searchCount,1,'Exactly one real map search input');
  assert.ok(aventuraLayout.searchInsideMap&&aventuraLayout.searchVisible&&aventuraLayout.searchNearTop,
    'Aventura mall search sits visibly ABOVE the map, not below the viewer');
  assert.ok(aventuraLayout.brandOrder,'Official Aventura logo precedes the mall name');
  assert.equal(aventuraLayout.logoHidden,false,'Official Aventura logo should be available');
  assert.equal(aventuraLayout.oldRetailNavWordmark,false);
  assert.equal(viewer.searchPlacement,'map-top');
  log('TOP_MAP_SEARCH_AVENTURA',aventuraLayout);
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
  assert.equal(await page.locator('#floorSpacing').isVisible(),false,
   'Single reference floor should hide multi-level spacing');
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
  await page.locator('#compareDialog').waitFor({state:'visible',timeout:10000});
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
  const compareTouch=await page.evaluate(()=>{
    const svg=document.getElementById('compareSvg');
    const viewport=document.getElementById('compareViewport');
    const r=viewport.getBoundingClientRect();
    const x=r.left+r.width*.5,y=r.top+r.height*.48;
    const get=()=>window.RetailNavComparison.getState();
    const send=(type,id,dx,dy)=>svg.dispatchEvent(new PointerEvent(type,{
      bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,button:0,
      clientX:x+dx,clientY:y+dy,
      buttons:type==='pointerup'?0:1
    }));
    const before=get();
    send('pointerdown',71,-35,-20);
    send('pointermove',71,10,5);
    const panned=get();
    send('pointerup',71,10,5);
    send('pointerdown',72,-32,0);
    send('pointerdown',73,32,0);
    send('pointermove',73,92,0);
    const spread=get();
    send('pointerup',73,92,0);
    send('pointerup',72,-32,0);
    send('pointerdown',74,-95,0);
    send('pointerdown',75,95,0);
    send('pointermove',75,15,0);
    const closed=get();
    send('pointerup',75,15,0);
    send('pointerup',74,-95,0);
    // Capture AFTER releasing both fingers; 'closed' is a mid-gesture
    // snapshot and is expected to still contain two live pointer IDs.
    const afterRelease=get();
    return {
      before,panned,spread,closed,afterRelease,
      touchAction:getComputedStyle(viewport).touchAction,
      photographTransform:document.querySelector('#referenceImage').getScreenCTM().toString(),
      geometryTransform:document.querySelector('#traceOverlay').getScreenCTM().toString()
    };
  });
  assert.equal(compareTouch.touchAction,'none','The iPhone must not scroll the dialog while touching the map');
  assert.equal(compareTouch.before.zoomPercent,200);
  assert.ok(compareTouch.panned.panX>compareTouch.before.panX+20,
    'One-finger right swipe must pan image right');
  assert.ok(compareTouch.panned.panY>compareTouch.before.panY+8,
    'One-finger down swipe must pan image down');
  assert.ok(compareTouch.spread.zoomPercent>compareTouch.panned.zoomPercent,
    'Pinch OUT must enlarge the photograph and vectors as a single SVG');
  assert.ok(compareTouch.closed.zoomPercent<compareTouch.spread.zoomPercent,
    'Pinch IN must reduce scale');
  assert.equal(compareTouch.photographTransform,compareTouch.geometryTransform,
    'Source photo and vector paths MUST share exactly the same transform');
  assert.equal(compareTouch.closed.pointerCount,2,'Both synthetic fingers remain active during pinch-in');
  assert.equal(compareTouch.afterRelease.pointerCount,0,'No stale touch pointers after releasing both fingers');
  await page.locator('#compareResetView').click();
  const resetCompare=await page.evaluate(()=>window.RetailNavComparison.getState());
  assert.equal(resetCompare.zoomPercent,100,'Reset centres comparison and restores 100% zoom');
  assert.ok(Math.abs(resetCompare.panX)<30,'Reset clears large horizontal pan offset');
  await page.locator('#compareZoom').evaluate(el=>{
    el.value='300';el.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.locator('#compareLevel').selectOption('LL');
  assert.equal((await page.evaluate(()=>window.RetailNavComparison.getState())).level,'LL');
  assert.equal((await page.evaluate(()=>window.RetailNavComparison.getState())).hasReference,true);
  assert.equal((await page.evaluate(()=>window.RetailNavComparison.getState())).zoomPercent,100,
    'Changing levels resets pan and zoom, preventing an offscreen floor');
  log('COMPARE_TOUCH',{pan:true,pinchOut:true,pinchIn:true,zoomReset:true,
    photoAndGeometryAligned:true});
  await page.locator('#compareDialog [data-close]').click();
  log('COMPARE','Reference and vector layers can be hidden independently, zoomed and switched by floor.');

  // Mobile map gestures: a single touch pans WITHOUT changing yaw.
  const panning=await page.evaluate(()=>{
    const view=window.__RETAILNAV__,canvas=document.querySelector('#canvas');
    const r=canvas.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    const send=(type,dx)=>canvas.dispatchEvent(new PointerEvent(type,{
      bubbles:true,pointerType:'touch',pointerId:98,button:0,
      clientX:x+dx,clientY:y,buttons:type==='pointerup'?0:1
    }));
    const before=view.getState();
    send('pointerdown',-55);send('pointermove',55);
    const after=view.getState();send('pointerup',55);
    return {before,after};
  });
  assert.ok(Math.hypot(...panning.before.target.map((v,i)=>v-panning.after.target[i]))>.2,
    'One-finger drag pans the map');
  assert.ok(panning.before.q.every((v,i)=>Math.abs(v-panning.after.q[i])<.0001),
    'Map drag must not rotate the view');
  const tilting=await page.evaluate(()=>{
    const view=window.__RETAILNAV__,canvas=document.querySelector('#canvas');
    const r=canvas.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    const send=(type,id,dx,dy)=>canvas.dispatchEvent(new PointerEvent(type,{
      bubbles:true,pointerType:'touch',pointerId:id,button:0,
      clientX:x+dx,clientY:y+dy,buttons:type==='pointerup'?0:1
    }));
    const before=view.getState().orbitPitch;
    send('pointerdown',41,-50,0);send('pointerdown',42,50,0);
    // Swipe both fingers UP: negative screen Y means a higher camera pitch.
    send('pointermove',41,-50,-50);send('pointermove',42,50,-50);
    const after=view.getState().orbitPitch;
    send('pointerup',41,-50,-50);send('pointerup',42,50,-50);
    return {before,after};
  });
  assert.ok(tilting.after>tilting.before+.02,
    'iPhone direction: swipe two fingers UP to reveal a lower, more three-dimensional viewing angle');
  assert.ok(tilting.after>=-Math.PI/2&&tilting.after<=-.25,'Prevent camera inversion');
  log('TOUCH_MAP',{pan:true,tilting});
  // Two fingers: first remains anchored while second twists around it.
  const after=await page.evaluate(()=>{
    const view=window.__RETAILNAV__,canvas=document.querySelector('#canvas');
    const r=canvas.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    const send=(type,id,dx,dy)=>canvas.dispatchEvent(new PointerEvent(type,{
      bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',
      clientX:x+dx,clientY:y+dy,button:0,buttons:type==='pointerup'?0:1
    }));
    const before=view.getState().q,beforeYaw=view.getState().orbitYaw;
    send('pointerdown',10,-45,0);
    send('pointerdown',11,45,0);
    send('pointermove',11,0,45);
    const transformed=view.getState().q,afterYaw=view.getState().orbitYaw;
    send('pointerup',11,0,45);
    send('pointerup',10,-45,0);
    return {before,transformed,beforeYaw,afterYaw};
  });
  assert.ok(after.before.some((v,i)=>Math.abs(v-after.transformed[i])>0.001),
    'Two-finger anchored twist must rotate camera');
  assert.ok(after.afterYaw>after.beforeYaw+.3,
    'iPhone direction: clockwise two-finger twist must also rotate the map clockwise');
  log('TOUCH','Two-finger anchored twist changed camera quaternion in iPhone direction.');
  // Pinch-out must zoom IN; pinch-in must zoom OUT.
  const pinching=await page.evaluate(()=>{
    const view=window.__RETAILNAV__,canvas=document.querySelector('#canvas');
    const r=canvas.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    const send=(t,id,dx)=>canvas.dispatchEvent(new PointerEvent(t,{
      bubbles:true,pointerType:'touch',pointerId:id,button:0,
      clientX:x+dx,clientY:y,buttons:t==='pointerup'?0:1
    }));
    const initial=view.getState().distance;
    send('pointerdown',74,-35);send('pointerdown',75,35);
    send('pointermove',75,105);
    const spread=view.getState().distance;
    send('pointerup',75,105);send('pointerup',74,-35);
    send('pointerdown',76,-75);send('pointerdown',77,75);
    send('pointermove',77,15);
    const pinch=view.getState().distance;
    send('pointerup',77,15);send('pointerup',76,-75);
    return {initial,spread,pinch};
  });
  assert.ok(pinching.spread<pinching.initial,
    'Spreading two fingers must zoom in like iOS Maps');
  assert.ok(pinching.pinch>pinching.spread,
    'Closing two fingers must zoom out like iOS Maps');
  log('PINCH_NATIVE',pinching);
  if(viewer.renderer==='WebGL'){
    await page.locator('#pan').click();
    assert.equal((await page.evaluate(()=>window.__RETAILNAV__.getState())).gestureMode,'orbit-3d');
    assert.equal((await page.evaluate(()=>window.__RETAILNAV__.getState())).rotationAxes,3);
    assert.equal(await page.locator('#rnRollControls').isVisible(),true);
    const beforeOrbit=await page.evaluate(()=>({
      state:window.__RETAILNAV__.getState(),
      pins:window.RetailNavPins.getSolidState()
    }));
    await page.evaluate(()=>{
      const el=document.querySelector('#canvas'),r=el.getBoundingClientRect();
      const x=r.left+r.width/2,y=r.top+r.height/2;
      const dispatch=(type,dx)=>el.dispatchEvent(new PointerEvent(type,{
        bubbles:true,cancelable:true,pointerId:35,pointerType:'touch',
        clientX:x+dx,clientY:y,button:0,buttons:type==='pointerup'?0:1
      }));
      dispatch('pointerdown',-75);dispatch('pointermove',110);dispatch('pointerup',110);
    });
    const afterOrbit=await page.evaluate(()=>window.__RETAILNAV__.getState());
    assert.ok(afterOrbit.q.some((n,i)=>Math.abs(n-beforeOrbit.state.q[i])>.02),
      'Free 3D orbit must update camera quaternion on horizontal finger drag');
    await page.waitForFunction(previous=>
      window.RetailNavPins.getSolidState().frames>previous,
      beforeOrbit.pins.frames,{timeout:8000});
    const faceB=await page.evaluate(()=>window.RetailNavPins.getSolidState());
    const q=afterOrbit.q;
    const calculated=1-2*(q[0]*q[0]+q[1]*q[1]);
    assert.ok(Math.abs(faceB.frontFacingDot-calculated)<.003,
      '3D friend faces must obey the CURRENT camera quaternion, even when rotation angles have similar cosines');
    assert.equal(faceB.fixedWorldRotation,true,'Demo friend pins stay world-fixed during free orbit');
    log('PIN_PARALLAX',{before:beforeOrbit.pins.frontFacingDot,
      after:faceB.frontFacingDot,cameraQuaternionChanged:true});
    const freeAxes=await page.evaluate(()=>{
      const view=window.__RETAILNAV__,canvas=document.querySelector('#canvas');
      const r=canvas.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
      const send=(type,id,dx,dy)=>canvas.dispatchEvent(new PointerEvent(type,{
        bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',
        clientX:x+dx,clientY:y+dy,button:0,buttons:type==='pointerup'?0:1
      }));
      const before=view.getState();
      send('pointerdown',48,-100,0);
      send('pointermove',48,100,300);
      const pitched=view.getState();
      send('pointerup',48,100,300);
      send('pointerdown',49,-55,0);
      send('pointerdown',50,55,0);
      send('pointermove',50,8,60);
      const rolled=view.getState();
      send('pointerup',50,8,60);
      send('pointerup',49,-55,0);
      return {before,pitched,rolled};
    });
    assert.ok(Math.abs(freeAxes.before.orbitPitch-freeAxes.pitched.orbitPitch)>.9,
      'One-finger free-orbit gestures rotate across X without the map-mode inclination clamp');
    assert.ok(Math.abs(freeAxes.pitched.orbitYaw-freeAxes.before.orbitYaw)>.3,
      'One-finger free-orbit gestures also rotate around Y');
    assert.ok(Math.abs(freeAxes.rolled.orbitRoll-freeAxes.pitched.orbitRoll)>.25,
      'Two-finger twist in free-3D mode rotates over the third Z axis');
    assert.ok(Math.abs(freeAxes.rolled.orbitYaw-freeAxes.pitched.orbitYaw)<.001,
      'Two-finger free-3D roll must not unexpectedly change world yaw');
    const beforeButton=await page.evaluate(()=>window.__RETAILNAV__.getState().orbitRoll);
    await page.locator('#rollLeft').click();
    const afterButton=await page.evaluate(()=>window.__RETAILNAV__.getState().orbitRoll);
    assert.ok(Math.abs(afterButton-beforeButton)>.1,'Roll control rotates camera Z axis');
    await page.locator('#rollRight').click();
    await page.evaluate(()=>{
      const canvas=document.querySelector('#canvas');
      canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,
        deltaY:-190,clientX:canvas.getBoundingClientRect().left+85,
        clientY:canvas.getBoundingClientRect().top+85}));
    });
    const zoomed=await page.evaluate(()=>window.__RETAILNAV__.getState());
    assert.ok(zoomed.distance<freeAxes.rolled.distance,'Wheel zoom must remain operational after full-axis rotation');
    log('FREE_3D_AXES',{pitch:freeAxes.pitched.orbitPitch,roll:freeAxes.rolled.orbitRoll,
      distance:zoomed.distance});
    await page.locator('#pan').click();
    assert.equal((await page.evaluate(()=>window.__RETAILNAV__.getState())).gestureMode,'map-pan');
    assert.equal(await page.locator('#rnRollControls').isVisible(),false);
    assert.equal((await page.evaluate(()=>window.__RETAILNAV__.getState())).orbitRoll,0,
      'Map navigation returns to a stable screen-up camera');
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
    const center=floor.features.find(f=>f.k==='corridor'||f.k==='unit'||f.k==='anchor').c;
    const res=await fetch('api/location',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json',
        'X-RetailNav-Mall':window.RETAILNAV_ACTIVE_MALL.id,
        'X-RetailNav-Coordinate-Space':window.RETAILNAV_ACTIVE_MALL.coordinateSpace||'mall-photo-pixels'},
      body:JSON.stringify({sharing:true,mallId:window.RETAILNAV_ACTIVE_MALL.id,
        coordinateSpace:window.RETAILNAV_ACTIVE_MALL.coordinateSpace||'mall-photo-pixels',
        floor:'UL',x:center[0],y:center[1]})});
    return {code:res.status,body:await res.json()};
  });
  assert.equal(shared.code,200);assert.equal(shared.body.myPosition.floor,'UL');
  await guest.reload({waitUntil:'domcontentloaded'});
  await guest.waitForFunction(()=>window.RetailNavSocial?.getState().ready===true);
  const contact=await guest.evaluate(async()=>(await(await fetch('api/state',{headers:{
    'X-RetailNav-Mall':window.RETAILNAV_ACTIVE_MALL.id,
    'X-RetailNav-Coordinate-Space':window.RETAILNAV_ACTIVE_MALL.coordinateSpace||'mall-photo-pixels'
  }})).json()).friends[0]);
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
  assert.equal(await apPage.locator('#rnServicesToggle').isVisible(),false,
    'Mobile map toolbars remain hidden until opened');
  await apPage.locator('.hudright').evaluate(el=>el.style.setProperty('display','flex','important'));
  const apStatus=await apPage.evaluate(()=>({
    viewer:window.__RETAILNAV__.getState(),
    social:window.RetailNavSocial.getState(),
    pins:window.RetailNavPins.getState(),
    mall:window.RETAILNAV_ACTIVE_MALL_ID
  }));
  assert.equal(apStatus.mall,'ap-plaza');
  assert.equal(await apPage.locator('#mallHeaderName').innerText(),'AP Plaza');
  assert.equal(await apPage.locator('#mallHeaderLogo').isVisible(),false);
  assert.equal(await apPage.locator('#search').count(),1);
  assert.equal(await apPage.locator('#rnMapSearch').isVisible(),true);
  const apLayout=await apPage.evaluate(()=>{
   const stage=document.querySelector('.stage'),search=document.querySelector('#rnMapSearch');
   const b=stage.getBoundingClientRect(),r=search.getBoundingClientRect();
   return {insideMap:stage.contains(search),aboveMap:r.top>=b.top-1&&r.bottom<b.top+145,
    searchCount:document.querySelectorAll('#search').length,
    mobileTitleShown:getComputedStyle(document.querySelector('.mobiletitle')).display!=='none',
    branding:document.querySelector('#mallHeaderName').textContent};
  });
  assert.ok(apLayout.insideMap&&apLayout.aboveMap);
  assert.equal(apLayout.searchCount,1);
  assert.equal(apLayout.mobileTitleShown,false,'No duplicate mall name in map');
  assert.equal(apLayout.branding,'AP Plaza');
  log('TOP_MAP_SEARCH_AP_PORTRAIT',apLayout);
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
  const apPinch=await apPage.evaluate(()=>{
    const svg=document.querySelector('#compareSvg'),r=svg.getBoundingClientRect();
    const send=(t,id,dx)=>svg.dispatchEvent(new PointerEvent(t,{
      bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,button:0,
      clientX:r.left+r.width*.5+dx,clientY:r.top+80,
      buttons:t==='pointerup'?0:1
    }));
    send('pointerdown',22,-35);send('pointerdown',23,35);
    send('pointermove',23,85);
    const z=window.RetailNavComparison.getState().zoomPercent;
    send('pointerup',23,85);send('pointerup',22,-35);
    return z;
  });
  assert.ok(apPinch>225,'Touch gestures must work on AP Plaza as well as Aventura');
  await apPage.locator('#compareDialog [data-close]').click();
  log('AP_FLOOR_COMPARISON','No floor widget for one floor; original photo and geometry independently toggle at adjustable zoom.');
  assert.equal(apStatus.viewer.features[0][1],197,
    'Published AP Plaza B1 should use the new provisional AI2D v2 geometry');
  assert.equal(apStatus.viewer.zoomMin,4,
    'AP Plaza maximum zoom must allow up to six times closer than the previous 24-unit limit');
  assert.equal(apStatus.viewer.nativeGestureDirections,true);
  assert.equal(await apPage.evaluate(()=>window.RETAILNAV_ACTIVE_MALL.navigable),false);
  assert.equal(apStatus.social.demoFriendCount,6);
  assert.equal(apStatus.pins.registered,6);
  await apPage.waitForFunction(()=>window.RetailNavAreaLabels?.getState().frames>=1,
    null,{timeout:15000});
  const readable=await apPage.evaluate(()=>window.RetailNavAreaLabels.getState());
  assert.equal(readable.total,8);
  assert.equal(readable.webglLabelsAreUnified,true);
  assert.equal(readable.textUpright,true);
  assert.equal(readable.orientationResponsive,true);
  assert.equal(readable.alwaysAvailableInDirectory,8);
  assert.ok(readable.visibleCount>=1,'Zone names stay visible as screen-upright text');
  assert.equal(await apPage.locator('#rnAreasButton').isVisible(),true);
  await apPage.locator('#rnAreasButton').click();
  assert.equal(await apPage.locator('#rnAreasMenu .rnAreaMenuItem').count(),8);
  assert.equal(await apPage.locator('#rnAreasMenu .rnAreaMenuItem strong').first().innerText(),'ACG Zone');
  await apPage.setViewportSize({width:844,height:390});
  await apPage.waitForTimeout(160);
  const landscapeSearch=await apPage.evaluate(()=>{
   const stage=document.querySelector('.stage').getBoundingClientRect();
   const rect=document.querySelector('#rnMapSearch').getBoundingClientRect();
   return {top:rect.top,stageTop:stage.top,right:rect.right,width:rect.width,
    windowWidth:innerWidth,stageWidth:stage.width,visible:rect.height>20};
  });
  assert.ok(landscapeSearch.visible&&landscapeSearch.top>=landscapeSearch.stageTop-2
   &&landscapeSearch.top<landscapeSearch.stageTop+60
   &&landscapeSearch.width>200&&landscapeSearch.right<=landscapeSearch.windowWidth,
   'Search stays above map, full-width and accessible in landscape');
  log('TOP_MAP_SEARCH_LANDSCAPE',landscapeSearch);
  assert.equal(await apPage.locator('#rnAreasButton').isVisible(),true,
    'Complete zone directory available in landscape');
  assert.equal(await apPage.locator('#rnAreasMenu .rnAreaMenuItem').count(),8);
  assert.equal((await apPage.evaluate(()=>window.RetailNavAreaLabels.getState())).textUpright,true);
  await apPage.setViewportSize({width:390,height:844});
  await apPage.locator('#rnAreasMenu .rnAreaMenuItem').first().click();
  assert.equal((await apPage.evaluate(()=>window.RetailNavDistricts.getState())).focused,'acg-zone');
  const districts=await apPage.evaluate(()=>window.RetailNavDistricts.getState());
  assert.equal(districts.count,8,'District titles from the photographed floor plan must be preserved');
  if(apStatus.viewer.renderer==='WebGL'){
    await apPage.waitForFunction(()=>window.RetailNavDistricts.getState().mode==='camera-facing-solid-district-3d',
      null,{timeout:20000});
    const district3D=await apPage.evaluate(()=>window.RetailNavDistricts.getState());
    assert.ok(district3D.rendered>=6,'All visible commercial-area names must render in 3D');
    assert.equal(district3D.cameraFacing,true,
      'Original luminous 3D plaques face the camera instead of rotating unreadably');
    assert.equal(district3D.singleLabelPerZone,true,'Never duplicate zone names');
    assert.equal(district3D.screenUprightLabels,true);
    assert.equal(await apPage.locator('#rnDistrictOverlay .rnAreaLabel:visible').count(),0,
      'No second HTML sign may duplicate the actual camera-facing WebGL sign');
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
    const heading=await apPage.evaluate(()=>{
      const view=window.__RETAILNAV__.getState();
      const plaque=window.RetailNavDistricts.getState().positions[0];
      const [x,y,z,w]=view.q;
      const basis=[2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y)];
      const dot=basis.reduce((sum,n,i)=>sum+n*plaque.forward[i],0);
      return {dot};
    });
    assert.ok(heading.dot>.995,'Billboard sign normal must face camera for every quaternion');
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
  assert.equal(await apPage.locator('#rnMapSearch.finding').count(),1);
  assert.ok(await apPage.locator('#results').isVisible(),
    'Results dropdown opens immediately beneath the single map-top search');
  assert.ok(await apPage.locator('#results .rnDistrictResult').count()>=1);
  await apPage.locator('#results .rnDistrictResult').first().click();
  assert.equal(await apPage.locator('#rnMapSearch.finding').count(),0,
    'Choosing a search result dismisses the overlay');
  assert.equal(await apPage.locator('#search').count(),1);
  assert.equal((await apPage.evaluate(()=>window.RetailNavDistricts.getState())).focused,'electronic-digital-city');
  await apPage.locator('#search').fill('');
  log('DISTRICTS','Eight photographed zone names placed in world-space and searchable.');
  const ids=await apPage.evaluate(()=>window.RetailNavUnits.getState());
  assert.ok(ids.count>=80,'Shop identifiers must survive mall vectorisation');
  await apPage.locator('#search').fill('K1-31');
  assert.ok(await apPage.locator('#results .rnUnitResult').count()>=1);
  await apPage.locator('#results .rnUnitResult').first().click();
  assert.ok((await apPage.evaluate(()=>window.RetailNavUnits.getState())).selected.endsWith(':K1-31'),
    'Unit selection keeps the mall/floor-qualified identifier');
  await apPage.locator('#rnUnitClose').click();
  await apPage.locator('#search').fill('');
  if(apStatus.viewer.renderer==='WebGL'){
    await apPage.evaluate(()=>window.RetailNavUnits.focus('A-01'));
    await apPage.waitForFunction(()=>window.RetailNavUnits.getRoofState()?.renderMode!=='pending',
      null,{timeout:18000});
    const roof=await apPage.evaluate(()=>window.RetailNavUnits.getRoofState());
    assert.equal(roof.cameraFacing,false);
    assert.ok(roof.labelledRoofs>=1);
    assert.equal(roof.floatingPanels,0);
    assert.equal(roof.raised,0);
    assert.equal(roof.raisedHasExtrudedBody,false);
    assert.equal(roof.raisedHasPhysicalPosts,false);
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
  assert.equal(await apPage.locator('#rnMapSearch.finding').count(),0,
    'Clearing the search MUST close the floating results without hiding map controls');
  assert.equal(await apPage.locator('#results').isVisible(),false,
    'Empty query must collapse the result panel entirely');
  // The right-side service toggle remains clickable even if search had been
  // open a moment ago (regression from 2026-10-14 mobile UI release).
  await apPage.locator('#rnServicesToggle').click({timeout:5000});
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
  const oneHandZoom=await apPage.evaluate(()=>{
    const view=window.__RETAILNAV__,canvas=document.getElementById('canvas');
    const r=canvas.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    const send=(t,id,dy)=>canvas.dispatchEvent(new PointerEvent(t,{
      bubbles:true,pointerType:'touch',pointerId:id,button:0,
      clientX:x,clientY:y+dy,buttons:t==='pointerup'?0:1
    }));
    const before=view.getState().distance;
    send('pointerdown',81,0);send('pointerup',81,0);
    send('pointerdown',82,0);send('pointermove',82,-90);
    const zoomed=view.getState().distance;
    send('pointerup',82,-90);
    return {before,zoomed};
  });
  assert.ok(oneHandZoom.zoomed<oneHandZoom.before*.7,
    'Apple Maps double-tap HOLD + swipe up must zoom in');
  for(let i=0;i<36;i++)await apPage.locator('#zoomIn').click();
  const maximum=await apPage.evaluate(()=>window.__RETAILNAV__.getState());
  assert.ok(maximum.distance>=maximum.zoomMin-.0001&&maximum.distance<=maximum.zoomMin+.02,
    'Repeated zoom buttons must reach the new close-up limit without crossing near-plane safety bounds');
  assert.ok(maximum.q.every(Number.isFinite)&&maximum.target.every(Number.isFinite),
    'Close-up must not create NaN in the 3D camera');
  await apPage.locator('#reset').click();
  log('APPLE_NATIVE_ZOOM',{oneHandZoom,maxDistance:maximum.distance});
  await apPage.locator('#mallSettingsBtn').click();
  assert.ok(await apPage.locator('#mallSettingsDialog').isVisible());
  assert.deepEqual(await apPage.locator('#mallSelect option').evaluateAll(
    options=>options.map(x=>x.value)),['aventura','alto-palermo','ap-plaza','new-world-city-shanghai']);
  assert.equal(await apPage.locator('#mallSelect').inputValue(),'ap-plaza');
  assert.match(await apPage.locator('#mallLocationStatus').innerText(),/desactivada/i);
  await apPage.locator('#mallSelect').selectOption('aventura');
  await Promise.all([
    apPage.waitForURL(url=>url.searchParams.get('mall')==='aventura'),
    apPage.locator('#mallApplyBtn').click()
  ]);
  await apPage.waitForFunction(()=>window.__RETAILNAV__?.getState().ready===true);
  assert.equal((await apPage.evaluate(()=>window.__RETAILNAV__.getState())).mallId,'aventura');
  assert.equal(await apPage.locator('#mallHeaderName').innerText(),'Aventura Mall',
    'Switching a shopping center updates the masthead without a stale AP Plaza title');
  log('MALL_SELECTOR','AP Plaza B1 and six isolated demo avatars work; settings switch back to Aventura.');
  // Do not leave a test identity on production.
  await apPage.waitForFunction(()=>window.RetailNavSocial?.getState().ready===true);
  await apPage.evaluate(async()=>fetch('api/account/delete',{
    method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:'{}'
  }));

  // Independent new mall test: source photos L1-L7, no duplicate signage
  // index, 380 tagged directory rows (not 380 surveyed unit polygons).
  const nwContext=await makeContext(),nwPage=await nwContext.newPage();
  await nwPage.goto(URL+'?mall=new-world-city-shanghai',{
    waitUntil:'domcontentloaded',timeout:45000
  });
  await nwPage.waitForFunction(()=>window.__RETAILNAV__?.getState().ready===true,
    null,{timeout:45000});
  const nw=await nwPage.evaluate(()=>{
    const viewer=window.__RETAILNAV__.getState();
    const units=window.RetailNavUnits;
    const state=units.getState();
    const catalog=window.RETAILNAV_ACTIVE_MALL;
    return {mallName:catalog.name,viewer,units:state,
      floorLabels:catalog.floorLabels,
      geometryRegions:window.__RETAILNAV__.floors.reduce((n,f)=>n+f.features.length,0),
      directoryRecords:catalog.commercialDirectoryRecords,
      navigable:catalog.navigable,
      demoPeople:window.RETAILNAV_DEMO_CONTACTS.length,
      candidateBrands:{
        nike:units.find('NIKE').map(u=>u.code),
        sports:units.find('zapatillas').length,
        cosmetics:units.find('护肤').length,
        anime:units.find('anime').length,
        restaurant:units.find('7C01').map(u=>u.name),
        coffee:units.find('Starbucks').map(u=>u.floor)
      },
      onlineSources:units.getUnits().filter(u=>u.enrichmentURL).length
    };
  });
  assert.equal(nw.viewer.mallId,'new-world-city-shanghai');
  assert.equal(nw.viewer.ready,true);
  assert.equal(nw.viewer.searchPlacement,'map-top');
  assert.equal(await nwPage.locator('#mallHeaderName').innerText(),
    '新世界城 · Shanghai New World City');
  assert.deepEqual(nw.floorLabels,['L1','L2','L3','L4','L5','L6','L7','L8','L9']);
  assert.deepEqual(nw.viewer.visible,['L1'],
   'New World City should start on first/ground floor');
  assert.equal(nw.geometryRegions,195,'195 colour-island REGIONS, not stores');
  assert.equal(nw.directoryRecords,380);
  assert.equal(nw.units.count,380);
  assert.equal(nw.units.withTags,380);
  assert.ok(nw.units.withNames>=360);
  assert.equal(nw.navigable,false);
  assert.equal(nw.demoPeople,0,'No Aventura demo people may bleed into new mall');
  assert.ok(nw.candidateBrands.nike.includes('6B06-08'));
  assert.ok(nw.candidateBrands.sports>=28);
  assert.ok(nw.candidateBrands.cosmetics>=30);
  assert.ok(nw.candidateBrands.anime>=25);
  assert.deepEqual(nw.candidateBrands.restaurant,['陶陶居（粤菜）']);
  assert.deepEqual(nw.candidateBrands.coffee,['L3']);
  assert.equal(nw.onlineSources,6,
    'Exactly six examples have independently corroborated public URLs; never invent others');
  await nwPage.locator('#search').fill('zapatillas');
  assert.ok(await nwPage.locator('#results .rnUnitResult').count()>=18,
    'Product-tag search finds stores even when their geometric frontage is unresolved');
  await nwPage.locator('#search').fill('6C01');
  assert.ok(await nwPage.locator('#results .rnUnitResult').count()>=1);
  await nwPage.evaluate(()=>window.RetailNavUnits.focus('7C01'));
  assert.equal((await nwPage.evaluate(()=>window.__RETAILNAV__.getState())).active,'L7');
  const focusPosition=await nwPage.evaluate(()=>window.__RETAILNAV__.getState().target);
  assert.ok(focusPosition.every(Number.isFinite),
    'Unlocated directory row must not create NaN camera positions');
  assert.equal(await nwPage.locator('#rnUnitInfo').isVisible(),true);
  const photoStatus=await nwPage.evaluate(async()=>{
    const refs=window.RETAILNAV_ACTIVE_MALL.floorReferences;
    const files=Object.entries(refs).map(async([f,p])=>({
      floor:f,status:(await fetch(p.url,{cache:'no-cache'})).status
    }));
    return await Promise.all(files);
  });
  assert.equal(photoStatus.length,7);
  assert.ok(photoStatus.every(x=>x.status===200),
    'The exact seven user-photograph reference crops must be published');
  log('NEW_WORLD_CITY',{floors:nw.floorLabels,regions:nw.geometryRegions,
    codes:nw.units.count,categories:nw.units.withTags,sampleWebMatches:nw.onlineSources,
    photoStatus});

  console.log('PASS WEB E2E: mobile browser, QR, consent, persistence, privacy and gesture');
}finally{
  await Promise.all(contexts.map(c=>c.close()));
  await browser.close();
}
