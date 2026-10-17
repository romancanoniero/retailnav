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
 const waitForRadialSettled=()=>page.waitForFunction(()=>{
  const menu=document.querySelector('#rnStoreActions');
  if(!menu?.classList.contains('is-visible')||menu.hidden)return false;
  const controls=[...menu.querySelectorAll('.rnStoreAction'),
   menu.querySelector('#rnStoreActionClose')].filter(Boolean);
  const transitioning=[menu,...controls].some(node=>node.getAnimations?.()
   .some(animation=>animation.playState==='running'||animation.playState==='pending'));
  return controls.length===4&&!transitioning&&
   [menu,...controls].every(node=>Math.abs(parseFloat(getComputedStyle(node).opacity)-1)<.001);
 },null,{timeout:5000});
 const select=async(id,floor=null)=>{
  await page.evaluate(({id,floor})=>window.RetailNavMeetups.selectStore(id,false,floor),{id,floor});
  await settle();
  const assist=page.locator('#rnStoreAssist');
  if(await assist.isEnabled()){await assist.tap();await settle();}
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
 const fixtureOrigin={floor:'LL',x:284.25644526,y:-1364.7832};
 const setOrigin=async origin=>{
  await page.evaluate(({origin,coordinateSpace})=>window.dispatchEvent(
   new CustomEvent('retailnav:map-point',{detail:{...origin,mallId:'aventura',
    coordinateSpace,localOnly:true}})),{origin,coordinateSpace:routing.coordinateSpace});
  await settle();
 };
 const native=async()=>{
  assert.equal(await page.evaluate(()=>window.__originalWayfindingCanvas===
   document.querySelector('#canvas')),true,'wayfinding must reuse the original 3D canvas');
  assert.equal(await page.locator('#rnSourceVectorMap,.stage>.viewport iframe').count(),0,
   'no separate map or external embedded substitute');
  assert.equal(await page.locator('#rnPOIOverlay .rnPoiMarker:visible').count(),0,
   'uncertain connector symbols must not clutter orientation');
 };
 const tabletHeader=async()=>{
  await page.waitForFunction(()=>document.querySelector('#rnMapSearch')?.parentElement===
   document.querySelector('.topbar'));
  const h=await page.evaluate(()=>{
   const box=el=>el.getBoundingClientRect().toJSON();
   const visible=el=>{const r=el.getBoundingClientRect();return (
    !(el.closest('details:not([open])')&&!el.matches('summary'))&&r.width>0&&r.height>0&&
    getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none');};
   return {header:box(document.querySelector('.topbar')),brand:box(document.querySelector('.rnMallBrand')),
    search:box(document.querySelector('#rnMapSearch .searchbox')),
    controls:[...document.querySelectorAll('.topbar button,.topbar summary')]
     .filter(el=>!el.closest('#rnMapSearch')&&visible(el)).map(el=>({id:el.id,rect:box(el)}))};
  });
  const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&
   Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
  assert.equal(await page.locator('#rnMapSearch').count(),1,'tablet keeps one search surface');
  assert.equal(await page.locator('#search').count(),1,'tablet keeps one real search input');
  assert.equal(await page.locator('#badge').isVisible(),false,'the technical WebGL badge is removed');
  assert.ok(Math.abs(h.header.height-70)<1,'tablet header remains 70px tall');
  assert.ok(h.search.left>=h.brand.right+4,'search sits to the right of the mall name');
  assert.ok(h.search.top>=h.header.top&&h.search.bottom<=h.header.bottom,
   'the complete search box fits in the header');
  assert.ok(h.search.width>=200,'tablet search retains practical typing space');
  const language=await page.locator('#rnLanguageSelect').boundingBox();
  assert.ok(language&&language.height>=44&&language.width>=44,'header language selection remains a 44px target');
  for(const [i,control] of h.controls.entries()){
   const r=control.rect;
   assert.ok(r.left>=h.header.left&&r.right<=h.header.right+1&&r.top>=h.header.top&&r.bottom<=h.header.bottom+1,
    control.id+' must fit in the header');
   assert.ok(r.width>=44&&r.height>=44,control.id+' remains a 44px touch target');
   assert.equal(overlap(r,h.search),false,control.id+' must not overlap the search');
   assert.equal(overlap(r,h.brand),false,control.id+' must not overlap the mall name');
   for(const other of h.controls.slice(i+1))assert.equal(overlap(r,other.rect),false,
    control.id+' must not overlap '+other.id);
  }
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
 await page.locator('#showAllFloors').tap();await settle();
 assert.deepEqual((await state()).visible,['LL','UL','L3']);
 await native();
 assert.equal(await page.locator('#rnWayfinding').isVisible(),false,
  'connector icons must be absent in the ordinary all-floor map, independently of wayfinding CSS');
 await tabletHeader();
 await page.locator('#rnHeaderMoreToggle').tap();
 assert.equal(await page.locator('#helpBtn').isVisible(),true,'help remains available through the header menu');
 assert.equal(await page.locator('#downloadBtn').isVisible(),true,'export remains available through the header menu');
 await page.locator('#rnHeaderMoreToggle').tap();
 await page.locator('#rnLanguageSelect').selectOption('es-AR');
 await page.locator('#search').fill('Coffee');
 await page.locator('.rnResultTag[data-concept-id="food.coffee"]').click();
 await page.locator('#rnTagResultCards .rnStoreCard[data-store-id="'+joe+'"]').tap();
 await settle();
 let s=await state();
 assert.equal(await page.locator('#rnWayfinding').isVisible(),false,
  'selecting a store keeps the large orientation card closed');
 assert.equal(await page.locator('#rnStoreActions').isVisible(),true,
  'compact actions appear only after the camera settles');
 await waitForRadialSettled();
 const radial=await page.locator('#rnStoreActions').evaluate(menu=>{
  const box=menu.getBoundingClientRect(),close=menu.querySelector('#rnStoreActionClose').getBoundingClientRect();
  const centre={x:close.left+close.width/2,y:close.top+close.height/2};
  const actions=[...menu.querySelectorAll('.rnStoreAction')].map(node=>{
   const item=node.getBoundingClientRect(),style=getComputedStyle(node);
   const itemCentre={x:item.left+item.width/2,y:item.top+item.height/2};
   return {width:item.width,height:item.height,radius:style.borderRadius,shadow:style.boxShadow,
    orbitRadius:Math.hypot(itemCentre.x-centre.x,itemCentre.y-centre.y)};
  });
  return {actions,close:{width:close.width,height:close.height,
   radius:getComputedStyle(menu.querySelector('#rnStoreActionClose')).borderRadius},
   centreOffset:Math.hypot(centre.x-(box.left+box.width/2),centre.y-(box.top+box.height/2))};
 });
 assert.equal(radial.actions.length,3);
 assert.ok(radial.actions.every(a=>a.width>=44&&a.width<=50&&Math.abs(a.height-a.width)<.2&&
  (a.radius==='50%'||Math.abs(parseFloat(a.radius)-a.width/2)<1)&&a.shadow!=='none'),
  'the three options are small circular touch targets with shadows: '+JSON.stringify(radial));
 assert.ok(Math.max(...radial.actions.map(a=>a.orbitRadius))-
  Math.min(...radial.actions.map(a=>a.orbitRadius))<1,
  'every option centre follows the same imaginary circumference: '+JSON.stringify(radial));
 assert.ok(radial.centreOffset<1&&radial.close.width>=44&&radial.close.width<=46&&
  Math.abs(radial.close.width-radial.close.height)<.2,
  'the circular close button occupies the exact centre: '+JSON.stringify(radial));
 await page.locator('#rnStoreActionClose').tap();
 assert.equal(await page.locator('#rnStoreActions').isVisible(),false,
  'the central X closes the contextual menu');
 await page.evaluate(id=>window.RetailNavMeetups.selectStore(id,false,'LL'),fixtures['Joe & The Juice']);
 await settle();
 assert.equal(await page.locator('#rnStoreActions').isVisible(),true,
  'selecting the store again restores the radial menu');
 await waitForRadialSettled();
 mkdirSync('artifacts',{recursive:true});
 await page.screenshot({path:'artifacts/store-actions-tablet-'+engine+'.png'});
 await page.locator('#rnTagResultClose').tap();
 await page.locator('#rnStoreInfoAction').tap();
 assert.equal(await page.locator('#rnStoreDetails').isVisible(),true,
  'the information action reuses the selected store profile without requiring the list');
 await page.locator('#rnStoreDetails .rnBackToStores').tap();
 assert.equal(await page.locator('#rnTagResultPanel').isVisible(),false,
  'closing standalone information returns directly to the map');
 await page.locator('#rnStoreInvite').tap();
 assert.equal(await page.locator('#rnQuickInvite').isVisible(),true,
  'the invitation action opens the existing private meetup flow directly from the map');
 await page.locator('#rnQuickInvite button').filter({hasText:/Cerrar|Close/}).tap();
 const disabledStyle=await page.locator('#rnStoreAssist').evaluate(el=>({disabled:el.disabled,
  grayscale:getComputedStyle(el).filter,background:getComputedStyle(el).backgroundColor}));
 assert.equal(disabledStyle.disabled,true,'navigation stays disabled until an indoor location exists');
 assert.match(disabledStyle.grayscale,/grayscale\(1\)/,'the unavailable navigation icon is visibly grey');
 assert.equal(s.wayfinding.origin,null,'a default floor must not masquerade as the visitor position');
 assert.equal(await page.locator('#rnWayfinding').isVisible(),false);

 const upperNode=routing.floors.find(f=>f.id==='UL').nodes[0];
 await setOrigin({floor:'UL',x:upperNode[0],y:upperNode[1]});await settle();s=await state();
 assert.equal(await page.locator('#rnStoreAssist').isEnabled(),true);
 assert.equal(await page.locator('#rnStoreAssist').evaluate(el=>el.classList.contains('is-route-ready')),true,
  'a compatible location changes navigation to the primary state');
 await page.locator('#rnStoreAssist').tap();await settle();s=await state();
 assert.equal(s.wayfindingCompact,true,'navigation opens as a compact map path');
 assert.equal(await page.locator('#rnWayfinding').isVisible(),false,'the large orientation dialog stays closed');
 assert.equal(s.wayfinding.mode,'different-floor');assert.equal(s.wayfinding.floorDelta,-1);
 assert.equal(s.wayfinding.routeReason,'vertical-connection-unavailable');
 assert.deepEqual(s.visible,['LL','UL']);
 assert.equal(await page.locator('#rnWayfindingDots .rnWayfindingDot:visible').count(),0,
  'missing verified landings cannot produce an invented cross-floor shortcut');
 await markerLayout();await native();
 mkdirSync('artifacts',{recursive:true});
 await page.locator('#toast').waitFor({state:'hidden',timeout:7000});
 await page.screenshot({path:'artifacts/wayfinding-floors-tablet-'+engine+'.png'});
 await page.locator('#rnStoreActionClose').tap();
 assert.equal((await state()).wayfindingOpen,false,'the central X closes the contextual route');
 assert.equal(await page.locator('#rnStoreActions').isVisible(),false);
 console.log('PASS location-gated primary navigation and connector-safe cross-floor preparation');

 await setOrigin(fixtureOrigin);
 await page.evaluate(id=>window.RetailNavMeetups.selectStore(id,false,'LL'),joe);await settle();s=await state();
 assert.equal(s.wayfinding.mode,'same-floor');assert.equal(s.wayfinding.floorDelta,0);
 assert.equal(s.earth2D,true,'same-floor orientation must be viewed from above');
 assert.ok(Math.abs(s.orbitPitch+Math.PI/2)<.025,'camera is genuinely cenital');
 assert.deepEqual(s.visible,['LL']);
 assert.equal(s.route,0,'source previews stay separate from the old fictional route layer');
 await native();
 const unchanged={q:s.q,target:s.target,distance:s.distance};
 await page.evaluate(()=>window.dispatchEvent(new Event('retailnav:indoor-observation')));
 await settle();s=await state();
 assert.deepEqual({q:s.q,target:s.target,distance:s.distance},unchanged,
  'an unchanged indoor observation must not restart the orientation camera');
 console.log('PASS exact floor count, same-floor top-down view and stable origin/destination framing');

 // This independently audited source node has an unbroken source-line path
 // toward Venchi. It is a preview ending outside the storefront, never safe
 // turn-by-turn guidance. Other manual marks may have no connected linework.
 await setOrigin(fixtureOrigin);await select(fixtures.Venchi);
 await page.waitForFunction(()=>window.__RETAILNAV__.getState().wayfinding.status==='provisional');
 await settle();s=await state();
 assert.equal(s.wayfinding.mode,'same-floor');assert.ok(s.wayfinding.points.length>3);
 assert.equal(s.wayfindingCompact,true);
 assert.equal(s.route,0,'preview circles must remain separate from verified navigation');
 assert.equal(await page.locator('#rnWayfinding').isVisible(),false,
  'touching navigation draws on the map without restoring the large dialog');
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
     color:style.borderColor,background:style.backgroundColor,animation:style.animationName,
     deviation:Math.min(...line.slice(1).map((q,i)=>segmentDistance(p,line[i],q)))};
   });
 });
 assert.ok(dots.length>=8,'the source preview must be shown with visible circles');
 assert.ok(dots.every(d=>Math.abs(d.width-d.height)<.1&&d.radius==='50%'),
  'the path uses actual circular markers');
 assert.ok(dots.every(d=>d.deviation<1.5),'every circle must stay on the projected source path');
 assert.ok(dots.every(d=>d.animation==='rnRouteDotFlow'&&d.background!=='rgba(0, 0, 0, 0)'),
  'the requested path uses animated primary-colour dots');
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
 assert.deepEqual(locationRequests,[]);
 console.log('PASS source-constrained animated dots, compact route state and no invented off-network route');

 await page.setViewportSize({width:768,height:1024});
 await page.waitForFunction(()=>window.__RETAILNAV__.getState().cameraFlying);
 await settle();
 await markerLayout();await native();await tabletHeader();
 await page.locator('#rnStoreActions').waitFor({state:'visible'});
 await waitForRadialSettled();
 for(const id of ['rnStoreAssist','rnStoreActionClose']){
  const box=await page.locator('#'+id).boundingBox();
  assert.ok(box&&box.width>=44&&box.height>=44,id+' must provide a 44px tablet touch target');
 }
 await page.locator('#toast').waitFor({state:'hidden',timeout:7000});
 await page.screenshot({path:'artifacts/wayfinding-tablet-portrait-'+engine+'.png'});
 await select(fixtures['Sens Coffee']);s=await state();
 assert.equal(s.wayfinding.mode,'unplaced');assert.deepEqual(s.focusedStoreVectors,[]);
 assert.equal(await page.locator('#rnStoreAssist').isDisabled(),true,
  'assistance is unavailable when the store has no source-map position');
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
 await page.locator('#rnStoreAssist').tap();
 assert.equal(await page.locator('#rnWayfinding').isVisible(),false);
 assert.equal(await page.locator('#rnWayfindingOrigin').isVisible(),false);
 assert.equal(await page.locator('#rnWayfindingTarget').isVisible(),false);
 assert.equal(await page.locator('#rnWayfindingDots .rnWayfindingDot:visible').count(),0);
 await page.evaluate(()=>window.__RETAILNAV__.beginManualLocation(true));
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
