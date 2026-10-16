/* Tablet wayfinding through the existing native 3D canvas. The real manual
 * placement gesture is exercised; API requests are intercepted so the same
 * smoke test can safely run against a deployed build without sharing a point.
 */
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {chromium,webkit} from 'playwright';

const root=resolve('public');
const routing=JSON.parse(readFileSync('data/official-maps/aventura-routing-preview.json','utf8'));
const types={'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8',
 '.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.css':'text/css',
 '.js':'application/javascript'};
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 if(!path.startsWith('/retailnav/')){res.writeHead(404);res.end();return;}
 const file=resolve(root,path.slice('/retailnav/'.length)||'index.html');
 if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{const bytes=readFileSync(file);res.writeHead(200,{'content-type':types[extname(file)]||
  'application/octet-stream','cache-control':'no-store'});res.end(bytes);}
 catch{res.writeHead(404);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const engine=process.env.BROWSER==='webkit'?'webkit':'chromium';
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,
 args:engine==='webkit'?[]:['--use-gl=angle','--use-angle=swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});
 const page=await context.newPage(),errors=[],locationRequests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/retailnav/api/**',async route=>{
  const req=route.request();
  if(req.method()==='POST'&&new URL(req.url()).pathname.endsWith('/location'))
   locationRequests.push(req.postDataJSON());
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   me:{id:'00000000-0000-4000-8000-000000000001',name:'Tablet test',avatarVersion:0,
    hasRecovery:false},friends:[],incoming:[],outgoing:[],myPosition:null})});
 });
 const url=new URL(process.env.RETAILNAV_TEST_URL||
  'http://127.0.0.1:'+server.address().port+'/retailnav/index.html');
 url.searchParams.set('mall','aventura');
 await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState().ready&&
  window.RetailNavMeetups&&window.RetailNavSocial?.getState().ready,null,{timeout:85000});
 const state=()=>page.evaluate(()=>window.__RETAILNAV__.getState());
 const settle=async()=>{
  await page.waitForFunction(()=>!window.__RETAILNAV__.getState().cameraFlying);
  await page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
 };
 const select=async(id,floor=null)=>{
  await page.evaluate(({id,floor})=>window.RetailNavMeetups.selectStore(id,false,floor),{id,floor});
  await settle();
 };
 await page.evaluate(()=>{
  window.__originalWayfindingCanvas=document.querySelector('#canvas');
  window.__wayfindingMapPoints=[];
  window.addEventListener('retailnav:map-point',e=>{
   window.__wayfindingMapPoints.push(e.detail);
   const view=window.__RETAILNAV__,p=e.detail,r=document.querySelector('#canvas').getBoundingClientRect();
   const projected=view.projectWorld(view.pinWorld(p.floor,p.x,p.y));
   window.__wayfindingMapPointProjection={x:projected.x+r.left,y:projected.y+r.top};
  },true);
 });
 const fixtures=await page.evaluate(()=>Object.fromEntries(
  ['Joe & The Juice','Venchi','Sens Coffee','Starbucks'].map(name=>[name,
   window.RetailNavUnits.getUnits().find(u=>u.source==='aventura-official-directory'&&
    u.name===name)?.storeId])));
 for(const [name,id] of Object.entries(fixtures))assert.ok(id,'missing fixture '+name);
 const joe=fixtures['Joe & The Juice'];
 const native=async()=>{
  assert.equal(await page.evaluate(()=>window.__originalWayfindingCanvas===
   document.querySelector('#canvas')),true,'wayfinding must reuse the original 3D canvas');
  assert.equal(await page.locator('#rnSourceVectorMap,.stage>.viewport iframe').count(),0,
   'no separate map or external embedded substitute');
  assert.equal(await page.locator('#rnPOIOverlay .rnPoiMarker:visible').count(),0,
   'uncertain connector symbols must not clutter orientation');
 };
 const markerLayout=async()=>{
  const layout=await page.evaluate(()=>{
   const box=el=>{const r=el.getBoundingClientRect();return {
    left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
   const visible=el=>el&&!el.hidden&&getComputedStyle(el).display!=='none'&&
    el.getBoundingClientRect().width>0&&getComputedStyle(el).visibility!=='hidden';
   return {canvas:box(document.querySelector('#canvas')),
    markers:['rnWayfindingOrigin','rnWayfindingTarget'].map(id=>{
     const el=document.getElementById(id),label=el?.querySelector('.rnWayfindingMarkerLabel');
     const a=el&&box(el),b=label&&box(label);
     const rect=a&&b?{left:Math.min(a.left,b.left),right:Math.max(a.right,b.right),
      top:Math.min(a.top,b.top),bottom:Math.max(a.bottom,b.bottom)}:a;
     return {id,visible:visible(el),rect};
    }),panels:['rnWayfinding','rnMapSearch','rnTagResultPanel'].map(id=>document.getElementById(id))
     .filter(visible).map(el=>({id:el.id,rect:box(el)}))};
  });
  const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&
   Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2;
  for(const marker of layout.markers){
   assert.equal(marker.visible,true,marker.id+' must be visible');
   const r=marker.rect,c=layout.canvas;
   assert.ok(r.left>=c.left-2&&r.right<=c.right+2&&r.top>=c.top-2&&r.bottom<=c.bottom+2,
    marker.id+' must fit entirely in the tablet map: '+JSON.stringify(layout));
   for(const panel of layout.panels)assert.equal(overlap(r,panel.rect),false,
    marker.id+' must remain clear of '+panel.id+': '+JSON.stringify(layout));
  }
  assert.equal(overlap(layout.markers[0].rect,layout.markers[1].rect),false,
   'origin and destination labels must remain independently legible');
 };
 const markOrigin=async(floor)=>{
  const chosenBefore=(await state()).wayfinding.storeId;
  await page.locator('#rnWayfindingOriginFloor').selectOption(floor);
  await page.locator('#rnWayfindingLocate').tap();
  await page.waitForFunction(()=>window.__RETAILNAV__.getState().placingPosition);
  await settle();
  const nodes=routing.floors.find(f=>f.id===floor).nodes;
  const click=await page.evaluate(({floor,nodes})=>{
   const view=window.__RETAILNAV__,canvas=document.querySelector('#canvas');
   const r=canvas.getBoundingClientRect();
   const target=view.floors.find(f=>f.id==='LL')?.features.find(f=>
    f.id==='1e262d8a02e8023eecf555d59ee77313')?.c;
   return nodes.map(p=>{
    const world=view.pinWorld(floor,p[0],p[1]),s=world&&view.projectWorld(world);
    if(!s||s.w<=0||s.x<55||s.x>r.width-55||s.y<55||s.y>r.height-55)return null;
    const x=r.left+s.x,y=r.top+s.y;
    if(document.elementFromPoint(x,y)!==canvas)return null;
    if(floor==='LL'&&target&&Math.hypot(p[0]-target[0],p[1]-target[1])<600)return null;
    return {x,y,source:p,score:Math.hypot(s.x-r.width*.5,s.y-r.height*.62)};
   }).filter(Boolean).sort((a,b)=>a.score-b.score)[0]||null;
  },{floor,nodes});
  assert.ok(click,'a real public-floor point must be tappable while marking '+floor);
  await page.touchscreen.tap(click.x,click.y);
  await page.waitForFunction(({floor,chosen})=>{
   const s=window.__RETAILNAV__.getState();return !s.placingPosition&&
    s.wayfinding?.origin?.floor===floor&&s.wayfinding.storeId===chosen;
  },{floor,chosen:chosenBefore});
  await settle();
  const point=await page.evaluate(()=>window.__wayfindingMapPoints.at(-1));
  assert.equal(point.localOnly,true,'orientation placement must not opt into location sharing');
  assert.equal(point.floor,floor);
  assert.equal(point.mallId,'aventura');
  assert.equal(point.coordinateSpace,routing.coordinateSpace);
  const projected=await page.evaluate(()=>window.__wayfindingMapPointProjection);
  assert.ok(Math.hypot(projected.x-click.x,projected.y-click.y)<1.5,
   'the point must project back to the actual tap within touch-event pixel rounding: '+
    JSON.stringify({click,point,projected}));
  assert.deepEqual(locationRequests,[],'manual orientation must not POST /location');
  assert.equal(await page.locator('#peopleDialog').isVisible(),false,
   'marking an origin must not open the contacts drawer');
 };
 await page.locator('#rnLanguageSelect').selectOption('es-AR');
 await page.locator('#search').fill('Coffee');
 await page.locator('.rnResultTag[data-concept-id="food.coffee"]').click();
 await page.locator('#rnTagResultCards .rnStoreCard[data-store-id="'+joe+'"]').tap();
 await settle();
 let s=await state();
 assert.equal(s.wayfinding.mode,'no-origin');
 assert.equal(s.wayfinding.origin,null,'a default floor must not masquerade as the visitor position');
 assert.equal(await page.locator('#rnWayfindingOrigin').isVisible(),false);
 assert.equal(await page.locator('#rnWayfindingLocate').isVisible(),true);
 assert.match(await page.locator('#rnWayfindingDestination').textContent(),/Joe & The Juice/);
 assert.equal(await page.locator('#rnWayfindingDots .rnWayfindingDot:visible').count(),0);
 await native();

 await markOrigin('UL');s=await state();
 assert.equal(s.wayfinding.mode,'different-floor');
 assert.equal(s.wayfinding.floorDelta,-1);
 assert.equal(s.wayfinding.floor,'LL');
 assert.deepEqual(s.visible,['LL','UL']);
 assert.equal(s.earth2D,false,'different floors use the existing 3D perspective');
 assert.match(await page.locator('#rnWayfindingRelation').textContent(),/1/);
 const levels=await page.locator('#rnWayfindingLevels').textContent();
 assert.match(levels,/LL/);assert.match(levels,/UL/);
 assert.equal(s.route,0,'unverified vertical connectors cannot create walking instructions');
 assert.equal(await page.locator('#rnWayfindingDots .rnWayfindingDot:visible').count(),0);
 await markerLayout();await native();
 mkdirSync('artifacts',{recursive:true});
 await page.locator('#toast').waitFor({state:'hidden',timeout:7000});
 await page.screenshot({path:'artifacts/wayfinding-floors-tablet-'+engine+'.png'});
 console.log('PASS actual manual placement, preserved destination, local-only origin and one-floor 3D relation');

 await markOrigin('L3');s=await state();
 assert.equal(s.wayfinding.floorDelta,-2,'floor separation counts real levels, not floor labels or height estimates');
 assert.match(await page.locator('#rnWayfindingRelation').textContent(),/2/);
 assert.deepEqual(s.visible,['LL','L3']);
 await markerLayout();

 await markOrigin('LL');s=await state();
 assert.equal(s.wayfinding.mode,'same-floor');assert.equal(s.wayfinding.floorDelta,0);
 assert.equal(s.earth2D,true,'same-floor orientation must be viewed from above');
 assert.ok(Math.abs(s.orbitPitch+Math.PI/2)<.025,'camera is genuinely cenital');
 assert.deepEqual(s.visible,['LL']);
 assert.match(await page.locator('#rnWayfindingRelation').textContent(),/misma|same/i);
 assert.equal(s.route,0,'source candidates are not promoted to verified walking routes');
 await markerLayout();await native();
 const unchanged={q:s.q,target:s.target,distance:s.distance};
 await page.evaluate(()=>window.dispatchEvent(new Event('retailnav:indoor-observation')));
 await settle();s=await state();
 assert.deepEqual({q:s.q,target:s.target,distance:s.distance},unchanged,
  'an unchanged indoor observation must not restart the orientation camera');
 console.log('PASS exact floor count, same-floor top-down view and stable origin/destination framing');

 // This independently audited source node has an unbroken source-line path
 // toward Venchi. It is a preview ending outside the storefront, never safe
 // turn-by-turn guidance. Other manual marks may have no connected linework.
 const fixtureOrigin={floor:'LL',x:284.25644526,y:-1364.7832};
 const setOrigin=async origin=>{
  await page.evaluate(({origin,coordinateSpace})=>window.dispatchEvent(
   new CustomEvent('retailnav:map-point',{detail:{...origin,mallId:'aventura',
    coordinateSpace,localOnly:true}})),{origin,coordinateSpace:routing.coordinateSpace});
  await settle();
 };
 await setOrigin(fixtureOrigin);await select(fixtures.Venchi);
 await page.waitForFunction(()=>window.__RETAILNAV__.getState().wayfinding.status==='provisional');
 await settle();s=await state();
 assert.equal(s.wayfinding.mode,'same-floor');assert.ok(s.wayfinding.points.length>3);
 assert.equal(s.route,0,'preview circles must remain separate from verified navigation');
 assert.match(await page.locator('#rnWayfindingStatus').textContent(),/provisional/i);
 assert.match(await page.locator('#rnWayfindingStatus').textContent(),/sin verificar|unverified/i);
 assert.equal(await page.locator('#rnIndoorArrow').isVisible(),false,
  'uncalibrated phone heading cannot imply a verified walking direction');
 const dots=await page.evaluate(()=>{
  const view=window.__RETAILNAV__,w=view.getState().wayfinding;
  const r=document.querySelector('#canvas').getBoundingClientRect();
  const line=w.points.map(p=>{
   const world=view.pinWorld(w.floor,p[0],p[1]);world[1]+=.5;
   return view.projectWorld(world);
  });
  const segmentDistance=(p,a,b)=>{
   const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
   const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
   return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
  };
  return [...document.querySelectorAll('#rnWayfindingDots .rnWayfindingDot')]
   .filter(el=>!el.hidden).map(el=>{
    const b=el.getBoundingClientRect(),style=getComputedStyle(el);
    const p={x:(b.left+b.right)/2-r.left,y:(b.top+b.bottom)/2-r.top};
    return {width:b.width,height:b.height,radius:style.borderRadius,
     color:style.borderColor,background:style.backgroundColor,
     deviation:Math.min(...line.slice(1).map((q,i)=>segmentDistance(p,line[i],q)))};
   });
 });
 assert.ok(dots.length>=8,'the source preview must be shown with visible circles');
 assert.ok(dots.every(d=>Math.abs(d.width-d.height)<.1&&d.radius==='50%'),
  'the path uses actual circular markers');
 assert.ok(dots.every(d=>d.deviation<1.5),'every circle must stay on the projected source path');
 assert.ok(dots.every(d=>/^rgba\(/.test(d.background)),
  'provisional circles retain a translucent centre distinct from verified routes');
 await markerLayout();
 await page.locator('#toast').waitFor({state:'hidden',timeout:7000});
 await page.screenshot({path:'artifacts/wayfinding-tablet-'+engine+'.png'});
 await setOrigin({floor:'LL',x:1000,y:1000});s=await state();
 assert.equal(s.wayfinding.status,'unavailable');assert.deepEqual(s.wayfinding.points,[]);
 assert.equal(await page.locator('#rnWayfindingDots .rnWayfindingDot:visible').count(),0,
  'an arbitrary origin must not receive an invented straight-line path');
 await setOrigin(fixtureOrigin);
 await page.waitForFunction(()=>window.__RETAILNAV__.getState().wayfinding.status==='provisional');
 await settle();
 await page.locator('#rnWayfindingLocate').tap();
 const start=page.locator('.rnWayfindingStart:visible').first();
 await start.waitFor({state:'visible'});
 const chosenStart=await start.evaluate(el=>({...el.sourcePoint}));
 const startBox=await start.boundingBox();
 assert.ok(startBox.width>=44&&startBox.height>=44,'source start choices must be comfortable to tap');
 await start.tap();
 await page.waitForFunction(()=>!window.__RETAILNAV__.getState().placingPosition&&
  window.__RETAILNAV__.getState().wayfinding.status==='provisional');
 await settle();s=await state();
 assert.equal(s.wayfinding.storeId,fixtures.Venchi);
 assert.deepEqual([s.wayfinding.origin.floor,s.wayfinding.origin.x,s.wayfinding.origin.y],
  [chosenStart.floor,chosenStart.x,chosenStart.y],
  'an explicit corridor choice uses exactly the selected source point');
 assert.deepEqual(locationRequests,[]);
 await setOrigin(fixtureOrigin);
 console.log('PASS source-constrained cyan circles, explicit provisional state and no invented off-network route');

 await page.setViewportSize({width:768,height:1024});
 await page.waitForFunction(()=>window.__RETAILNAV__.getState().cameraFlying);
 await settle();
 await markerLayout();await native();
 for(const id of ['rnWayfindingOriginFloor','rnWayfindingLocate','rnWayfindingReframe','rnWayfindingClose']){
  const box=await page.locator('#'+id).boundingBox();
  assert.ok(box&&box.width>=44&&box.height>=44,id+' must provide a 44px tablet touch target');
 }
 await page.locator('#toast').waitFor({state:'hidden',timeout:7000});
 await page.screenshot({path:'artifacts/wayfinding-tablet-portrait-'+engine+'.png'});
 await select(fixtures['Sens Coffee']);s=await state();
 assert.equal(s.wayfinding.mode,'unplaced');assert.deepEqual(s.focusedStoreVectors,[]);
 assert.equal(await page.locator('#rnWayfindingTarget').isVisible(),false,
  'unmapped stores must not acquire a made-up destination marker');
 assert.equal(await page.locator('#rnWayfindingDots .rnWayfindingDot:visible').count(),0);
 await page.evaluate(ids=>{for(const id of ids)window.RetailNavMeetups.selectStore(id);},
  [joe,fixtures.Venchi,fixtures.Starbucks]);
 await settle();s=await state();
 assert.equal(s.wayfinding.storeId,fixtures.Starbucks);assert.equal(s.wayfinding.mode,'unplaced');
 assert.deepEqual(s.focusedStoreVectors,[]);
 await page.emulateMedia({reducedMotion:'reduce'});await select(joe);s=await state();
 assert.equal(s.cameraFlying,false);assert.equal(s.lastStoreFocus.animated,false);
 assert.equal(s.wayfinding.mode,'same-floor');await markerLayout();
 await page.locator('#rnWayfindingClose').tap();
 assert.equal(await page.locator('#rnWayfinding').isVisible(),false);
 assert.equal(await page.locator('#rnWayfindingOrigin').isVisible(),false);
 assert.equal(await page.locator('#rnWayfindingTarget').isVisible(),false);
 assert.equal(await page.locator('#rnWayfindingDots .rnWayfindingDot:visible').count(),0);
 await select(joe);
 await page.locator('#rnWayfindingLocate').tap();
 assert.equal((await state()).placingPosition,true);
 const manualCount=await page.evaluate(()=>window.__wayfindingMapPoints.length);
 await page.locator('#search').fill('Apple');
 assert.equal((await state()).placingPosition,false,
  'changing the search must cancel placement, including its hidden pointer state');
 assert.equal(await page.locator('#rnWayfinding').isVisible(),false);
 assert.equal(await page.locator('.rnWayfindingStart:visible').count(),0);
 const emptyTap=await page.evaluate(()=>{
  const canvas=document.querySelector('#canvas'),r=canvas.getBoundingClientRect();
  for(const dx of [.5,.3,.7])for(const dy of [.7,.85,.5]){
   const p={x:r.left+r.width*dx,y:r.top+r.height*dy};
   if(document.elementFromPoint(p.x,p.y)===canvas)return p;
  }
 });
 assert.ok(emptyTap);await page.touchscreen.tap(emptyTap.x,emptyTap.y);
 assert.equal(await page.evaluate(()=>window.__wayfindingMapPoints.length),manualCount,
  'a later map tap must not silently move the origin after placement was cancelled');
 assert.deepEqual(locationRequests,[]);assert.deepEqual((await state()).errors,[]);assert.deepEqual(errors,[]);
 console.log('PASS portrait tablet, touch targets, unknown destinations, rapid selection and reduced motion');
}finally{await browser.close();await new Promise(ok=>server.close(ok));}
