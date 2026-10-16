import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {chromium,webkit} from 'playwright';

const root=resolve('public');
const types={'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8',
 '.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.css':'text/css'};
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(!url.pathname.startsWith('/retailnav/')){res.writeHead(404);res.end();return;}
 const file=resolve(root,url.pathname.slice('/retailnav/'.length)||'index.html');
 if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{
  const bytes=readFileSync(file);
  res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream',
   'content-length':bytes.length,'cache-control':'no-store'});
  res.end(bytes);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base='http://127.0.0.1:'+server.address().port+'/retailnav/index.html';
const engine=process.env.BROWSER==='webkit'?'webkit':'chromium';
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,
 args:engine==='webkit'?[]:['--use-gl=angle','--use-angle=swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const url=new URL(process.env.RETAILNAV_TEST_URL||base);url.searchParams.set('mall','aventura');
 await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState().ready&&window.RetailNavMeetups,
  null,{timeout:85000});
 const state=()=>page.evaluate(()=>window.__RETAILNAV__.getState());
 await page.waitForFunction(()=>document.querySelector('#rnMapSearch')?.parentElement===
  document.querySelector('.topbar'));
 const header=await page.evaluate(()=>({
  height:document.querySelector('.topbar').getBoundingClientRect().height,
  brandRight:document.querySelector('.rnMallBrand').getBoundingClientRect().right,
  searchLeft:document.querySelector('#rnMapSearch .searchbox').getBoundingClientRect().left,
  count:document.querySelectorAll('#search').length
 }));
 assert.ok(Math.abs(header.height-70)<1);
 assert.ok(header.searchLeft>=header.brandRight+4,'tablet search sits beside the mall name');
 assert.equal(header.count,1);assert.equal(await page.locator('#badge').isVisible(),false);
 const settle=async()=>{
  await page.waitForFunction(()=>!window.__RETAILNAV__.getState().cameraFlying);
  await page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
 };
 await page.evaluate(()=>{window.__testedNativeCanvas=document.querySelector('#canvas');});
 const assertNative=async()=>{
  assert.equal(await page.evaluate(()=>window.__testedNativeCanvas===document.querySelector('#canvas')),true,
   'selecting a store must retain the original canvas and renderer');
  assert.equal(await page.locator('#rnSourceVectorMap').count(),0,'no separate source-map view');
  assert.equal(await page.locator('.stage>.viewport iframe').count(),0,'no embedded map substitute');
  assert.equal(await page.evaluate(()=>typeof window.RetailNavSourceMap),'undefined');
  assert.equal(await page.locator('#canvas').isVisible(),true);
 };
 const assertInMap=async polygonId=>{
  await settle();
  const geometry=await page.evaluate(id=>{
   const view=window.__RETAILNAV__,floor=view.floors.find(fl=>fl.features.some(f=>f.id===id));
   const feature=floor?.features.find(f=>f.id===id);
   if(!feature)return null;
   const canvas=document.querySelector('#canvas').getBoundingClientRect();
   const panel=document.querySelector('#rnTagResultPanel').getBoundingClientRect();
   return {points:feature.r.flat().map(p=>view.project(floor.id,p)),
    width:canvas.width,height:canvas.height,right:canvas.right,panelLeft:panel.left};
  },polygonId);
  assert.ok(geometry&&geometry.points.length>=3,'selected source polygon exists in the native 3D meshes');
  assert.ok(geometry.right<=geometry.panelLeft+2,'tablet results must not cover the map canvas');
  assert.ok(geometry.points.every(p=>p&&p.w>0&&p.x>=0&&p.y>=0&&p.x<=geometry.width&&p.y<=geometry.height),
   'the complete selected polygon stays inside the canvas after rotation and zoom');
 };
 const fixtures=await page.evaluate(()=>Object.fromEntries(
  ['Joe & The Juice','Venchi','Sens Coffee','Starbucks','JCPenney'].map(name=>{
   const unit=window.RetailNavUnits.getUnits().find(u=>u.source==='aventura-official-directory'&&u.name===name);
   return [name,unit?.storeId];
  })));
 for(const [name,id] of Object.entries(fixtures))assert.ok(id,'missing fixture '+name);
 const card=name=>page.locator('#rnTagResultCards .rnStoreCard[data-store-id="'+fixtures[name]+'"]');
 const joe='1e262d8a02e8023eecf555d59ee77313',venchi='106b53c386cd808785a547936cfed059';
 await assertNative();
 assert.ok(['WebGL','Canvas 3D'].includes((await state()).renderer));
 // Exercise the existing controls before deliberately rolling the camera over.
 // Selection must recover from this real user-controlled orientation, with a
 // transition in the original camera, rather than opening a second surface.
 await page.locator('#plan').tap();assert.equal((await state()).earth2D,true);
 await page.locator('#plan').tap();assert.equal((await state()).earth2D,false);
 // The compact tablet UI hides the legacy HUD; its existing handler still
 // supplies a deterministic inverted-camera regression fixture.
 await page.locator('#pan').evaluate(el=>el.click());assert.equal((await state()).gestureMode,'orbit-3d');
 await page.locator('#rollRight').evaluate(el=>{for(let i=0;i<18;i++)el.click();});
 const before=await state();assert.ok(before.cameraUp[1]<0,'fixture should start with an inverted camera');
 await page.locator('#rnLanguageSelect').selectOption('en');
 await page.locator('#search').fill('Coffee');
 await page.locator('.rnResultTag[data-concept-id="food.coffee"]').click();
 await card('Joe & The Juice').tap();
 let s=await state();
 assert.equal(s.lastStoreFocus.source,true);assert.equal(s.lastStoreFocus.located,true);
 assert.equal(s.lastStoreFocus.floor,'LL');assert.equal(s.lastStoreFocus.animated,true);
 assert.equal(s.lastStoreFocus.rotated,true,'selection corrects the inverted camera');
 assert.deepEqual(s.focusedStoreVectors,['LL:'+joe]);assert.equal(s.focusedStoreVector,'LL:'+joe);
 assert.equal(await card('Joe & The Juice').getAttribute('aria-selected'),'true');
 await assertInMap(joe);s=await state();
 assert.equal(await page.locator('#rnSearchMarkers [data-store-id="'+fixtures['Joe & The Juice']+'"]').textContent(),
  'Joe & The Juice','map labels show merchant names, never internal directory codes');
 assert.ok(Math.abs(s.distance-before.distance)>1,'selection animates a meaningful zoom');
 assert.ok(s.q.some((v,i)=>Math.abs(v-before.q[i])>.1),'selection rotates the native camera');
 assert.ok(s.cameraUp[1]>.3,'the selected store is viewed upright');
 assert.match(await page.locator('#rnStoreSelectionStatus').textContent(),/Destination location.*Joe.*Floor LL/i);
 assert.equal(s.wayfinding.mode,'no-origin');
 assert.equal(s.route,0,'source linework is not automatically a verified pedestrian route');
 await assertNative();
 console.log('PASS native 3D canvas, source-bound highlight, camera rotation/zoom and tablet viewport');

 // A manually declared user floor is in this map's coordinate frame. Keep
 // both that reference and the destination visible without letting the upper
 // floor's filled polygons hide the selected destination below.
 await page.evaluate(()=>{
  const floor=window.__RETAILNAV__.floors.find(f=>f.id==='UL');
  const p=floor.features.find(f=>f.k==='unit')?.c||floor.features[0].c;
  window.dispatchEvent(new CustomEvent('retailnav:map-point',{detail:{floor:'UL',x:p[0],y:p[1],
   mallId:'aventura',coordinateSpace:window.RETAILNAV_ACTIVE_MALL.coordinateSpace}}));
 });
 await page.waitForFunction(()=>window.__RETAILNAV__.getState().referenceFloor==='UL');
 if(await page.locator('#rnClose').isVisible())await page.locator('#rnClose').click();
 await card('Joe & The Juice').tap();await settle();s=await state();
 assert.deepEqual(s.visible,['LL','UL'],'destination and visitor floor must both remain visible');
 assert.equal(s.focusFloorId,'LL');assert.equal(s.referenceFloor,'UL');
 const floorLabel=await page.locator('#rnFloorReference').textContent();
 assert.match(floorLabel,/LL/);assert.match(floorLabel,/UL/);
 const observationBefore={q:s.q,target:s.target,distance:s.distance};
 await page.evaluate(()=>window.dispatchEvent(new Event('retailnav:indoor-observation')));
 await settle();s=await state();
 assert.deepEqual({q:s.q,target:s.target,distance:s.distance},observationBefore,
  'same-floor GPS/step observations preserve the selected shop and camera');
 assert.deepEqual(s.focusedStoreVectors,['LL:'+joe]);assert.equal(s.route,0);
 await assertInMap(joe);await assertNative();
 mkdirSync('artifacts',{recursive:true});
 await page.locator('#toast').waitFor({state:'hidden',timeout:7000});
 await page.screenshot({path:'artifacts/source-map-tablet-'+engine+'.png'});
 console.log('PASS reference/destination floors and stable camera during indoor observations');

 await card('Venchi').tap();await settle();
 assert.deepEqual((await state()).focusedStoreVectors,['LL:'+venchi],
  'choosing another store clears the previous ownership highlight');
 await assertInMap(venchi);
 await card('Sens Coffee').tap();s=await state();
 assert.equal(s.lastStoreFocus.located,false);assert.deepEqual(s.focusedStoreVectors,[]);
 assert.ok(s.visible.includes('L3')&&s.visible.includes('UL'),
  'an unplaced store can show its documented floor and visitor floor without inventing its polygon');
 await card('Starbucks').tap();s=await state();
 assert.equal(s.lastStoreFocus.located,false);assert.deepEqual(s.focusedStoreVectors,[]);
 assert.equal(s.focusedStoreVector,null);assert.equal(s.route,0);
 // Rapid choices cancel the previous flight and never leave its highlight.
 await card('Joe & The Juice').tap();await card('Venchi').tap();await card('Starbucks').tap();
 await settle();s=await state();
 assert.equal(s.lastStoreFocus.storeId,fixtures.Starbucks);assert.equal(s.lastStoreFocus.located,false);
 assert.deepEqual(s.focusedStoreVectors,[]);assert.equal(s.route,0);
 await page.emulateMedia({reducedMotion:'reduce'});await card('Joe & The Juice').tap();
 s=await state();assert.equal(s.cameraFlying,false);assert.equal(s.lastStoreFocus.animated,false);
 await assertInMap(joe);
 await page.setViewportSize({width:820,height:1180});await assertInMap(joe);await assertNative();
 await page.screenshot({path:'artifacts/source-map-tablet-portrait-'+engine+'.png'});
 // Source-bound multi-floor shops expose their real linked floors through
 // the same selection panel, with independent geometry per destination.
 await page.evaluate(()=>window.RetailNavMeetups.selectStore('aventura:directory:joey-aventura'));
 assert.deepEqual((await state()).focusedStoreVectors,['LL:057452fb036953f93bf75ee5ed446b8b']);
 await page.locator('#rnStoreSelectionStatus button[data-store-floor="UL"]').tap();
 s=await state();assert.equal(s.lastStoreFocus.floor,'UL');assert.equal(s.lastStoreFocus.located,true);
 assert.deepEqual(s.focusedStoreVectors,['UL:e3f00b2b41f9ef040b22406bd2d602dd']);
 assert.deepEqual(s.visible,['UL']);
 assert.equal(await page.locator('#rnStoreSelectionStatus button[data-store-floor="UL"]').getAttribute('aria-pressed'),'true');
 await assertInMap('e3f00b2b41f9ef040b22406bd2d602dd');
 await page.locator('#rnStoreSelectionStatus button[data-store-floor="LL"]').tap();
 assert.deepEqual((await state()).focusedStoreVectors,['LL:057452fb036953f93bf75ee5ed446b8b']);
 assert.deepEqual((await state()).visible,['LL','UL']);
 // A store may occupy multiple documented floors while only one has a bound
 // geometry. An explicit request for its unmapped floor cannot reuse LL.
 const directoryFloor=await page.evaluate(id=>window.__RETAILNAV__.focusCatalogStore(id,'UL'),fixtures.JCPenney);
 assert.equal(directoryFloor.located,false);assert.deepEqual((await state()).focusedStoreVectors,[]);
 const invalid=await page.evaluate(id=>window.__RETAILNAV__.focusCatalogStore(
  'ap-plaza:directory:joe-and-the-juice','LL',[0,0],id),joe);
 assert.equal(invalid.located,false);assert.deepEqual((await state()).focusedStoreVectors,[]);
 // Old photo-coordinate entries are still references, never source-space shop
 // polygons. Neither caller-supplied coordinates nor a real source ID can
 // turn a legacy or unrecognized catalog entry into an authorized highlight.
 const legacy=await page.evaluate(id=>{
  return window.__RETAILNAV__.focusCatalogStore('aventura:LL:LL-002','LL',[0,0],id);
 },joe);
 assert.equal(legacy.located,false);assert.deepEqual((await state()).focusedStoreVectors,[]);
 await page.locator('#rnTagResultClose').tap();
 await page.locator('#rnWayfindingClose').tap();
 await page.locator('#floorSelect').selectOption('UL');
 assert.deepEqual((await state()).visible,['UL'],'original floor selector still controls the native scene');
 await assertNative();
 assert.deepEqual((await state()).errors,[]);assert.deepEqual(errors,[]);
 console.log('PASS rapid selections, unknown geometry, coordinate-frame isolation, reduced motion and portrait tablet');
}finally{await browser.close();await new Promise(ok=>server.close(ok));}
