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
 await context.addInitScript(()=>{if(!sessionStorage.getItem('rn-favorite-test-ready')){
  localStorage.clear();sessionStorage.setItem('rn-favorite-test-ready','1');
 }});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/retailnav/api/**',route=>route.fulfill({status:200,contentType:'application/json',
  body:JSON.stringify({meetings:[],pending:0,me:{id:'00000000-0000-4000-8000-000000000001',
   name:'Favorite test',hasRecovery:false},friends:[],incoming:[],outgoing:[],myPosition:null})}));
 const base='http://127.0.0.1:'+server.address().port+'/retailnav/index.html';
 const ready=mallId=>page.waitForFunction(mallId=>window.__RETAILNAV__?.getState().ready&&
  window.RETAILNAV_ACTIVE_MALL?.id===mallId&&window.RetailNavFavorites&&window.RetailNavVisitPlanner,mallId);
 const settle=()=>page.waitForFunction(()=>!window.__RETAILNAV__.getState().cameraFlying&&
  document.querySelector('#rnStoreActions')?.classList.contains('is-visible'));
 const radialSettled=()=>page.waitForFunction(()=>{
  const menu=document.querySelector('#rnStoreActions');if(!menu?.classList.contains('is-visible'))return false;
  const controls=[...menu.querySelectorAll('.rnStoreAction'),menu.querySelector('#rnStoreActionClose')];
  return controls.length===6&&!controls.some(node=>node.getAnimations?.().some(animation=>
   animation.playState==='running'||animation.playState==='pending'));
 });
 await page.goto(base+'?mall=alto-palermo',{waitUntil:'domcontentloaded',timeout:60000});await ready('alto-palermo');
 const store=await page.evaluate(()=>{
  const unit=window.RetailNavUnits.getUnits().find(candidate=>
   window.RetailNavUnits.getMapBindings(candidate).length===1);
  return {id:unit.storeId,name:unit.name,floor:window.RetailNavUnits.getMapBindings(unit)[0].floor};
 });
 assert.equal((await page.evaluate(()=>window.RetailNavFavorites.getState())).count,0);
 assert.equal((await page.evaluate(()=>window.RetailNavVisitPlanner.getState())).stops.length,0,
  'favorite starts independently from the visit plan');
 await page.locator('#search').fill(store.name);
 const searchStar=page.locator(`.rnStoreFavoriteAction[data-rn-favorite-store="${store.id}"]`).first();
 const searchVisit=page.locator(`.rnStoreVisitAction[data-rn-visit-store="${store.id}"]`).first();
 await searchStar.waitFor({state:'visible'});
 assert.ok((await searchStar.boundingBox()).width>=44,'favorite is a touch-sized search action');
 await searchStar.tap();
 assert.equal(await searchStar.getAttribute('aria-pressed'),'true');
 assert.equal(await searchVisit.getAttribute('aria-pressed'),'false',
  'favoriting never adds the store to the current visit plan');
 assert.deepEqual((await page.evaluate(()=>window.RetailNavFavorites.getState())).storeIds,[store.id]);
 assert.equal((await page.evaluate(()=>window.RetailNavVisitPlanner.getState())).stops.length,0);

 await page.evaluate(store=>window.RetailNavMeetups.selectStore(store.id,false,store.floor),store);
 await settle();await radialSettled();
 assert.equal(await page.locator('#rnStoreFavorite').getAttribute('aria-pressed'),'true',
  'contextual reflects a favorite added from search');
 assert.equal(await page.locator('#rnStoreAddToPlan').getAttribute('aria-pressed'),'false');
 const radial=await page.locator('#rnStoreActions').evaluate(menu=>{
  const close=menu.querySelector('#rnStoreActionClose').getBoundingClientRect();
  const centre=[close.left+close.width/2,close.top+close.height/2];
  return [...menu.querySelectorAll('.rnStoreAction')].map(button=>{
   const box=button.getBoundingClientRect();return{id:button.id,width:box.width,height:box.height,
    radius:Math.hypot(box.left+box.width/2-centre[0],box.top+box.height/2-centre[1]),
    shadow:getComputedStyle(button).boxShadow,round:getComputedStyle(button).borderRadius};
  });
 });
 assert.equal(radial.length,5);
 assert.ok(radial.every(item=>item.width>=44&&item.height>=44&&item.shadow!=='none'));
 assert.ok(Math.max(...radial.map(item=>item.radius))-Math.min(...radial.map(item=>item.radius))<1,
  'all contextual action centres share one imaginary circumference');
 mkdirSync('artifacts',{recursive:true});
 await page.screenshot({path:'artifacts/favorites-contextual-'+engine+'.png',fullPage:true});
 await page.locator('#rnStoreFavorite').tap();
 assert.equal(await searchStar.getAttribute('aria-pressed'),'false',
  'search reflects a favorite removed from contextual');
 await page.locator('#rnStoreFavorite').tap();
 assert.equal((await page.evaluate(()=>window.RetailNavFavorites.getState())).count,1);

 await page.reload({waitUntil:'domcontentloaded',timeout:60000});await ready('alto-palermo');
 assert.deepEqual((await page.evaluate(()=>window.RetailNavFavorites.getState())).storeIds,[store.id],
  'favorite persists locally across reloads');
 assert.equal((await page.evaluate(()=>window.RetailNavVisitPlanner.getState())).stops.length,0);
 await page.locator('#search').fill(store.name);
 const persistedStar=page.locator(`.rnStoreFavoriteAction[data-rn-favorite-store="${store.id}"]`).first();
 await persistedStar.waitFor({state:'visible'});
 assert.equal(await persistedStar.getAttribute('aria-pressed'),'true');
 await page.screenshot({path:'artifacts/favorites-'+engine+'.png',fullPage:true});

 await page.goto(base+'?mall=aventura',{waitUntil:'domcontentloaded',timeout:60000});await ready('aventura');
 assert.equal((await page.evaluate(()=>window.RetailNavFavorites.getState())).count,0,
  'favorites stay isolated per mall');
 assert.deepEqual(errors,[]);
 console.log('PASS favorites '+engine+': independent search/context state, local persistence, per-mall isolation and five-action radial geometry');
}finally{await browser.close();await new Promise(ok=>server.close(ok));}
