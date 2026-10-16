import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,join,extname,sep} from 'node:path';
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
const browser=await (process.env.BROWSER==='webkit'?webkit:chromium).launch({headless:true,
 args:process.env.BROWSER==='webkit'?[]:['--use-gl=angle','--use-angle=swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.RETAILNAV_TEST_URL||base)+'?mall=aventura',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState().ready&&window.RetailNavMeetups,{timeout:85000});
 await page.locator('#rnLanguageSelect').selectOption('en');
 await page.locator('#search').fill('Coffee');
 await page.locator('.rnResultTag[data-concept-id="food.coffee"]').click();
 const card=name=>page.locator('#rnTagResultCards .rnStoreCard').filter({hasText:name}).first();
 await card('Joe & The Juice').tap();
 await page.waitForFunction(()=>window.RetailNavSourceMap?.getState().visible);
 assert.equal(await page.locator('#rnSourceVectorMap iframe').count(),0);
 await page.waitForFunction(()=>!window.RetailNavSourceMap.getState().cameraFlying);
 let s=await page.evaluate(()=>window.RetailNavSourceMap.getState());
 assert.deepEqual(s.highlighted,['1e262d8a02e8023eecf555d59ee77313']);
 assert.equal(s.destinationFloor,'LL');assert.equal(s.located,true);assert.ok(s.camera.scale>1);assert.ok(Math.abs(s.camera.angle)>1);
 assert.equal(await page.locator('.rnSourceSelected').count(),1);
 assert.equal(await page.locator('.rnSourceSelected').getAttribute('data-polygon-id'),s.highlighted[0]);
 const layout=await page.evaluate(()=>({map:document.querySelector('#rnSourceVectorMap').getBoundingClientRect().toJSON(),panel:document.querySelector('#rnTagResultPanel').getBoundingClientRect().toJSON()}));
 assert.ok(layout.map.right<=layout.panel.left+2);
 // A real source polygon must remain in the SVG viewport after rotation/zoom.
 const bb=await page.locator('.rnSourceSelected').boundingBox();const vb=await page.locator('.rnSourceMain svg').boundingBox();
 assert.ok(bb.x>=vb.x&&bb.y>=vb.y&&bb.x+bb.width<=vb.x+vb.width&&bb.y+bb.height<=vb.y+vb.height);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('retailnav:map-point',{detail:{floor:'UL',x:450,y:300}})));
 await page.waitForFunction(()=>window.RetailNavSourceMap.getState().referenceFloor==='UL');
 if(await page.locator('#rnClose').isVisible())await page.locator('#rnClose').click();
 assert.equal(await page.locator('.rnSourceMain[data-floor="LL"]').count(),1);
 assert.equal(await page.locator('.rnSourceReference[data-floor="UL"]').count(),1);
 assert.match(await page.locator('.rnSourceRouteStatus').textContent(),/No verified walking route/);
 await page.waitForFunction(()=>!window.RetailNavSourceMap.getState().cameraFlying);
 assert.equal(await page.evaluate(()=>{const svg=document.querySelector('.rnSourceMain svg'),transform=svg.firstChild.getAttribute('transform');
  window.dispatchEvent(new Event('retailnav:indoor-observation'));
  return svg===document.querySelector('.rnSourceMain svg')&&transform===svg.firstChild.getAttribute('transform');}),true,'same-floor GPS/step observations preserve camera and pointer targets');
 assert.deepEqual((await page.evaluate(()=>window.RetailNavSourceMap.getState())).route,[]);
 assert.ok(await page.locator('[data-connector-id]').count()>0);
 mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/source-map-tablet.png'});
 await card('Venchi').tap();await page.waitForFunction(()=>!window.RetailNavSourceMap.getState().cameraFlying);
 assert.equal(await page.locator('.rnSourceSelected').getAttribute('data-polygon-id'),'106b53c386cd808785a547936cfed059');
 await card('Sens Coffee').tap();
 assert.equal(await page.locator('.rnSourceSelected').count(),0);
 assert.equal(await page.locator('.rnSourceMain[data-floor="L3"]').count(),1);
 await card('Starbucks').tap();assert.equal(await page.locator('.rnSourceSelected').count(),0);
 assert.equal((await page.evaluate(()=>window.RetailNavSourceMap.getState())).located,false);
 // Rapid choices must cancel the previous animation and clear stale ownership.
 await card('Joe & The Juice').tap();await card('Venchi').tap();await card('Starbucks').tap();
 await page.waitForTimeout(950);assert.equal(await page.locator('.rnSourceSelected').count(),0);
 await page.emulateMedia({reducedMotion:'reduce'});await card('Joe & The Juice').tap();
 assert.equal((await page.evaluate(()=>window.RetailNavSourceMap.getState())).cameraFlying,false);
 await page.setViewportSize({width:820,height:1180});await page.screenshot({path:'artifacts/source-map-tablet-portrait.png'});
 assert.equal(await page.locator('#rnSourceVectorMap').isVisible(),true);
 await page.locator('#rnSourceVectorMap>header button').tap();assert.equal(await page.locator('#rnSourceVectorMap').isVisible(),false);
 const directoryFloor=await page.evaluate(()=>{const u=window.RetailNavUnits.getUnits().find(u=>u.storeId==='aventura:directory:jcpenney');return window.RetailNavSourceMap.show(u,'UL');});
 assert.equal(directoryFloor.destinationFloor,'UL');assert.equal(directoryFloor.located,false);
 assert.equal(await page.locator('.rnSourceSelected').count(),0);
 assert.match(await page.locator('.rnSourceRouteStatus').textContent(),/Exact position not linked/);
 // Reject a foreign mall even when the caller supplies a valid Aventura ID.
 const invalid=await page.evaluate(()=>window.RetailNavSourceMap.show({mallId:'ap-plaza',storeId:'aventura:directory:joe-and-the-juice'}));
 assert.equal(invalid.located,false);assert.equal(await page.locator('#rnSourceVectorMap').isVisible(),false);
 assert.deepEqual(errors,[]);console.log('PASS tablet native source vectors, camera rotation/zoom, both floors, stale selection, reduced motion, no unsafe routes or iframe');
}finally{await browser.close();await new Promise(ok=>server.close(ok));}
