import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {chromium,webkit} from 'playwright';

const root=resolve('public');
const types={'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8',
 '.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.js':'application/javascript'};
const server=createServer((req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(!pathname.startsWith('/retailnav/')){res.writeHead(404);res.end();return;}
 const file=resolve(root,pathname.slice('/retailnav/'.length)||'index.html');
 if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{const bytes=readFileSync(file);res.writeHead(200,{'content-type':types[extname(file)]||
  'application/octet-stream','cache-control':'no-store'});res.end(bytes);}
 catch{res.writeHead(404);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const engine=process.env.RETAILNAV_BROWSER==='webkit'?'webkit':'chromium';
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,
 args:engine==='webkit'?[]:['--use-gl=angle','--use-angle=swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});
 await context.addInitScript(()=>{if(!sessionStorage.getItem('rn-plan-test-ready')){
  localStorage.clear();sessionStorage.setItem('rn-plan-test-ready','1');
 }});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/retailnav/api/**',route=>route.fulfill({status:200,contentType:'application/json',
  body:JSON.stringify({meetings:[],pending:0,me:{id:'00000000-0000-4000-8000-000000000001',
   name:'Plan test',hasRecovery:false},friends:[],incoming:[],outgoing:[],myPosition:null})}));
 const url='http://127.0.0.1:'+server.address().port+'/retailnav/index.html?mall=alto-palermo';
 const ready=()=>page.waitForFunction(()=>window.__RETAILNAV__?.getState().ready&&
  window.RetailNavMeetups&&window.RetailNavVisitPlanner);
 const waitForVisitHighlights=count=>page.waitForFunction(expected=>
  window.__RETAILNAV__?.getState().visitPlanHighlightedVectorCount===expected,count);
 const settle=()=>page.waitForFunction(()=>!window.__RETAILNAV__.getState().cameraFlying&&
  document.querySelector('#rnStoreActions')?.classList.contains('is-visible'));
 const radialSettled=()=>page.waitForFunction(()=>{
  const menu=document.querySelector('#rnStoreActions');if(!menu?.classList.contains('is-visible'))return false;
  const controls=[...menu.querySelectorAll('.rnStoreAction'),menu.querySelector('#rnStoreActionClose')];
  return controls.length===6&&!controls.some(node=>node.getAnimations?.().some(animation=>
   animation.playState==='running'||animation.playState==='pending'));
 });
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await ready();
 assert.equal(await page.locator('#rnVisitPlanToggle').isVisible(),false,'empty plan stays out of the map chrome');
 const stores=await page.evaluate(()=>{
  const units=window.RetailNavUnits.getUnits().filter(unit=>
   window.RetailNavUnits.getMapBindings(unit).length>0);
  return units.slice(0,2).map(unit=>({id:unit.storeId,name:unit.name,
   floor:window.RetailNavUnits.getMapBindings(unit)[0].floor,
   vectors:window.RetailNavUnits.getMapBindings(unit).map(binding=>binding.floor+':'+binding.polygonId)}));
 });
 assert.equal(stores.length,2,'needs two mapped stores');
 await page.locator('#search').fill(stores[0].name);
 const searchVisit=page.locator(`.rnStoreVisitAction[data-rn-visit-store="${stores[0].id}"]`).first();
 await searchVisit.waitFor({state:'visible'});await searchVisit.tap();
 assert.equal(await searchVisit.getAttribute('aria-pressed'),'true',
  'search result exposes the shared add-to-visit action');
 assert.equal(await page.locator('#rnVisitPlanCount').textContent(),'1');
 await waitForVisitHighlights(new Set(stores[0].vectors).size);
 const firstHighlight=await page.evaluate(()=>({view:window.__RETAILNAV__.getState(),
  features:window.__RETAILNAV__.floors.flatMap(floor=>floor.features)
   .filter(feature=>feature.visitPlanned).map(feature=>feature.floor+':'+feature.id)}));
 assert.deepEqual(new Set(firstHighlight.view.visitPlanVectors),new Set(stores[0].vectors),
  'adding a store paints every explicitly bound polygon');
 assert.deepEqual(new Set(firstHighlight.features),new Set(stores[0].vectors),
  'render features receive the same visit-plan state as the counter');
 assert.equal(firstHighlight.view.visitPlanColor,
  await page.evaluate(()=>window.RetailNavThemes.color('accent','#BBD74A')),
  'map stops use the exact theme accent shown by the visit counter');
 await page.locator('#search').fill('');
 await page.evaluate(store=>window.RetailNavMeetups.selectStore(store.id,false,store.floor),stores[0]);await settle();await radialSettled();
 const radial=await page.locator('#rnStoreActions').evaluate(menu=>{
  const close=menu.querySelector('#rnStoreActionClose').getBoundingClientRect();
  const centre=[close.left+close.width/2,close.top+close.height/2];
  return [...menu.querySelectorAll('.rnStoreAction')].map(button=>{
   const box=button.getBoundingClientRect();return {id:button.id,width:box.width,height:box.height,
    radius:Math.hypot(box.left+box.width/2-centre[0],box.top+box.height/2-centre[1]),
    round:getComputedStyle(button).borderRadius,shadow:getComputedStyle(button).boxShadow};
  });
 });
 assert.equal(radial.length,5,'visit and favorite extend the existing radial menu compatibly');
 assert.ok(radial.some(action=>action.id==='rnStoreAddToPlan'));
 assert.ok(radial.some(action=>action.id==='rnStoreFavorite'));
 assert.ok(radial.every(action=>action.width>=44&&action.height>=44&&action.shadow!=='none'));
 assert.ok(Math.max(...radial.map(action=>action.radius))-Math.min(...radial.map(action=>action.radius))<1,
  'all four action centres stay on one circumference');
 assert.equal(await page.locator('#rnStoreAddToPlan').getAttribute('aria-pressed'),'true',
  'map contextual reflects a stop added from search');
 assert.equal(await page.locator('#rnVisitPlanCount').textContent(),'1');
 assert.equal(await page.locator('#rnVisitPlanToggle').isVisible(),true);
 assert.equal((await page.evaluate(()=>window.RetailNavVisitPlanner.getState())).stops[0].storeId,stores[0].id);

 await page.evaluate(store=>window.RetailNavMeetups.selectStore(store.id,false,store.floor),stores[1]);await settle();
 await page.locator('#rnStoreAddToPlan').tap();
 assert.equal(await page.locator('#rnVisitPlanCount').textContent(),'2');
 const expectedStoreVectors=new Set(stores.flatMap(store=>store.vectors));
 await waitForVisitHighlights(expectedStoreVectors.size);
 assert.deepEqual(new Set(await page.evaluate(()=>window.__RETAILNAV__.getState().visitPlanVectors)),
  expectedStoreVectors,'every selected stop remains marked across its bound floors');
 await page.locator('#rnVisitPlanToggle').tap();
 assert.equal(await page.locator('#rnVisitPlan').isVisible(),true);
 assert.equal(await page.locator('.rnVisitPlanStop').count(),2);
 assert.deepEqual(await page.locator('.rnVisitPlanFocus strong').allTextContents(),stores.map(store=>store.name));
 assert.equal(await page.locator('#canvas').count(),1,'visit plan must reuse the original map');
 await page.locator('.rnVisitPlanFocus').first().tap();await settle();
 assert.equal(await page.locator('#rnVisitPlan').isVisible(),false);
 assert.equal((await page.evaluate(()=>window.RetailNavMeetups.getState())).selectedStoreId,stores[0].id);

 await page.reload({waitUntil:'domcontentloaded',timeout:60000});await ready();
 assert.equal((await page.evaluate(()=>window.RetailNavVisitPlanner.getState())).stops.length,2,
  'plan persists locally across reloads');
 assert.equal(await page.locator('#rnVisitPlanCount').textContent(),'2');
 await waitForVisitHighlights(expectedStoreVectors.size);
 assert.deepEqual(new Set(await page.evaluate(()=>window.__RETAILNAV__.getState().visitPlanVectors)),
  expectedStoreVectors,'map highlights restore with the locally persisted plan');
 await page.evaluate(()=>{
  const units=window.RetailNavUnits.getUnits(),view=window.__RETAILNAV__;
  const feature=view.floors.flatMap(floor=>floor.features).find(candidate=>candidate.k==='unit'&&
   units.filter(unit=>window.RetailNavUnits.getMapBindings(unit).some(binding=>
    binding.floor===candidate.floor&&binding.polygonId===candidate.id)).length===0);
  view.select(feature);
 });
 await settle();await page.locator('#rnStoreAddToPlan').tap();
 const state=await page.evaluate(()=>window.RetailNavVisitPlanner.getState());
 assert.equal(state.stops.length,3);
 assert.ok(state.stops.some(stop=>stop.spaceId&&stop.storeId===null),
  'an unidentified physical shop space remains a valid itinerary stop');
 const unidentified=state.stops.find(stop=>stop.storeId===null);
 await waitForVisitHighlights(new Set([...expectedStoreVectors,
  unidentified.floor+':'+unidentified.polygonId]).size);
 assert.ok((await page.evaluate(()=>window.__RETAILNAV__.getState().visitPlanVectors))
  .includes(unidentified.floor+':'+unidentified.polygonId),
  'an unidentified physical space receives the same green map state');
 await page.locator('#rnVisitPlanToggle').tap();
 assert.equal(await page.locator('.rnVisitPlanStop').count(),3);
 assert.match((await page.locator('.rnVisitPlanFocus small').last().textContent()),/identidad pendiente|identity pending/);
 const panel=await page.locator('#rnVisitPlan').boundingBox(),canvas=await page.locator('#canvas').boundingBox();
 assert.ok(panel&&canvas&&panel.x>=canvas.x&&panel.x+panel.width<=canvas.x+canvas.width&&
  panel.y+panel.height<=canvas.y+canvas.height,
  'responsive visit sheet stays inside the map viewport: '+JSON.stringify({panel,canvas}));
 mkdirSync('artifacts',{recursive:true});
 await page.screenshot({path:'artifacts/visit-plan-'+engine+'.png',fullPage:true});
 await page.locator('.rnVisitPlanRemove').last().tap();
 assert.equal(await page.locator('.rnVisitPlanStop').count(),2);
 await waitForVisitHighlights(expectedStoreVectors.size);
 await page.setViewportSize({width:390,height:844});
 await page.waitForTimeout(120);
 const mobilePanel=await page.locator('#rnVisitPlan').boundingBox();
 const mobileCanvas=await page.locator('#canvas').boundingBox();
 assert.ok(mobilePanel&&mobileCanvas&&mobilePanel.x>=mobileCanvas.x&&
  mobilePanel.x+mobilePanel.width<=mobileCanvas.x+mobileCanvas.width&&
  mobilePanel.y+mobilePanel.height<=mobileCanvas.y+mobileCanvas.height,
  'mobile visit sheet stays inside the map viewport: '+JSON.stringify({mobilePanel,mobileCanvas}));
 await page.screenshot({path:'artifacts/visit-plan-mobile-'+engine+'.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS visit plan '+engine+': green map state on every bound polygon, search/context state, five-action radial menu, identified and physical-space stops, local persistence and desktop/mobile sheet');
}finally{await browser.close();await new Promise(ok=>server.close(ok));}
