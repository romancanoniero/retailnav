import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,join,extname,sep} from 'node:path';
import {chromium} from 'playwright';

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
const browser=await chromium.launch({headless:true,
 args:['--use-gl=angle','--use-angle=swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},
  deviceScaleFactor:1,isMobile:true,hasTouch:true});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const wait=async mallId=>{
  await page.waitForFunction(()=>window.__RETAILNAV__?.getState()?.ready===true&&
   window.RetailNavUnits?.getState()?.count!==undefined,null,{timeout:85000});
  const s=await page.evaluate(()=>window.__RETAILNAV__.getState());
  assert.equal(s.mallId,mallId);
  assert.equal(s.errors.length,0);
  return s;
 };

 await page.goto(base+'?mall=new-world-city-shanghai',{waitUntil:'domcontentloaded',timeout:50000});
 let state=await wait('new-world-city-shanghai');
 assert.equal(state.referenceFloor,'L1');
 assert.deepEqual(state.visible,['L1'],'the initial reference floor is ground/1, not all floors');
 const indoor=await page.evaluate(()=>window.RetailNavIndoor.getState());
 assert.equal(indoor.referenceSource,'fallback-floor');
 assert.equal(indoor.referenceFloor,'L1');
 assert.equal(indoor.entryReferenceAvailable,false);
 assert.equal(await page.locator('#rnMyPositionMarker').isVisible(),false,
  'no entry was recorded for New World City: never fake a user location');
 console.log('PASS provisional ground/first floor and no invented entrance');

 const input=page.locator('#search');
 await input.fill('equi');
 await page.waitForFunction(()=>[...document.querySelectorAll('.rnSuggestedTag')]
  .some(e=>e.dataset.tag==='equipaje'),null,{timeout:7000});
 assert.equal(await page.locator('#rnSearchSuggestions').isVisible(),true);
 assert.equal(await page.locator('.rnSuggestedTag[data-tag="equipaje"]').count(),1);
 await input.press('Enter');
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState()?.committedSearch==='equi',null,{timeout:8000});
 state=await page.evaluate(()=>window.__RETAILNAV__.getState());
 assert.deepEqual(state.visible,['L1','L5'],
  'confirming an existing luggage tag must open user floor and all matching floors');
 assert.equal(state.highlightedVectorCount,1);
 assert.equal(await page.locator('.rnUnitResult').filter({hasText:'5A10'}).count(),1);
 assert.ok((await page.locator('#rnFloorReference').textContent()).includes('L1'));
 const matches=await page.evaluate(()=>window.RetailNavUnits.find('equipaje')
  .map(({storeId,code,floor,polygonId,productsVerified})=>
   ({storeId,code,floor,polygonId,productsVerified})));
 assert.deepEqual(matches,[{storeId:'new-world-city-shanghai:L5:5A10',
  code:'5A10',floor:'L5',polygonId:matches[0].polygonId,productsVerified:false}]);
 assert.ok(matches[0].polygonId);
 assert.equal((await page.evaluate(()=>window.RetailNavUnits.getHighlightedCodes())).length,1);
 console.log('PASS incremental autocomplete and luggage across reference L1 plus vectorized L5');

 await input.fill('ropa');
 await input.press('Enter');
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState()?.committedSearch==='ropa');
 const many=await page.evaluate(()=>({
  state:window.__RETAILNAV__.getState(),
  matches:window.RetailNavUnits.find('ropa').length,
  highlighted:window.RetailNavUnits.getHighlightedCodes().length
 }));
 assert.ok(many.matches>4,'the old first-four search limit must be removed');
 assert.equal(many.highlighted,many.matches);
 assert.ok(many.state.visible.includes('L1'));
 assert.ok(many.state.visible.length>1);
 console.log('PASS all matching store vectors, not only first four or current floor');

 // Explicit user selection overrides the provisional reference, without
 // pretending the GNSS system measured the floor.
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('retailnav:map-point',{
  detail:{floor:'L3',x:450,y:300}})));
 await page.waitForFunction(()=>window.RetailNavIndoor.getState().anchor?.floor==='L3');
 await input.fill('equipaje');
 await input.press('Enter');
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState()?.committedSearch==='equipaje');
 state=await page.evaluate(()=>window.__RETAILNAV__.getState());
 assert.equal(state.referenceFloor,'L3');
 assert.deepEqual(state.visible,['L3','L5']);
 const manual=await page.evaluate(()=>window.RetailNavIndoor.getState());
 assert.equal(manual.anchor.source,'manual');
 assert.equal(manual.referenceSource,'manual');
 console.log('PASS manual indoor floor changes reference to L3 without GPS fabrication');

 await page.goto(base+'?mall=ap-plaza',{waitUntil:'domcontentloaded',timeout:50000});
 state=await wait('ap-plaza');
 assert.equal(state.referenceFloor,'B1');
 const ap=await page.evaluate(()=>window.RetailNavIndoor.getState());
 assert.equal(ap.referenceFloor,'B1');
 assert.equal(ap.referenceSource,'fallback-entry');
 assert.equal(ap.entryReferenceAvailable,true);
 assert.equal(ap.mapHasRecognizedEntrance,false,
  'a photographic EXIT sign is not a surveyed entrance');
 assert.ok(ap.referencePoint?.name.startsWith('Salida'));
 console.log('PASS source-linked AP Plaza access sign as explicitly provisional');
 await page.goto(base+'?mall=aventura',{waitUntil:'domcontentloaded',timeout:50000});
 state=await wait('aventura');
 assert.equal(state.referenceFloor,'LL');
 const aventura=await page.evaluate(()=>({
  unitCount:window.RetailNavUnits.getState().count,
  named:window.RetailNavUnits.find('JCPenney').length,
  inside:window.RetailNavIndoor.getState()
 }));
 assert.ok(aventura.unitCount>=100);
 assert.ok(aventura.named>0);
 assert.equal(aventura.inside.entryReferenceAvailable,false);
 assert.equal(await page.locator('#rnMyPositionMarker').isVisible(),false);
 console.log('PASS Aventura original vector references included, never invented shop codes or entrances');
 assert.deepEqual(errors,[]);
}finally{
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
