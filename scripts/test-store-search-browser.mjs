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
 await page.waitForFunction(()=>[...document.querySelectorAll('.rnResultTag')]
  .some(e=>e.dataset.tag==='equipaje'),null,{timeout:7000});
 assert.equal(await page.locator('#rnSearchSuggestions').isVisible(),false,
  'incremental tags and grouped results are rendered in one results list');
 assert.equal(await page.locator('.rnResultTag[data-tag="equipaje"]').count(),1);
 await page.locator('.rnResultTag[data-tag="equipaje"]').click();
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState()?.committedSearch==='equipaje',null,{timeout:8000});
 state=await page.evaluate(()=>window.__RETAILNAV__.getState());
 assert.deepEqual(state.visible,['L1','L5'],
  'confirming an existing luggage tag must open user floor and all matching floors');
 assert.equal(await page.locator('#floorSelect').inputValue(),'MATCHES',
  'Floor picker must clearly display multi-floor search mode instead of pretending only L1 is open');
 assert.equal(state.highlightedVectorCount,0,
  'The photographed directory entry 5A10 does not yet have a verified map region; never invent a polygon');
 assert.equal(await page.locator('.rnUnitResult').filter({hasText:'5A10'}).count(),1);
 assert.ok((await page.locator('#rnFloorReference').textContent()).includes('L1'));
 const matches=await page.evaluate(()=>window.RetailNavUnits.find('equipaje')
  .map(({storeId,code,floor,polygonId,productsVerified})=>
   ({storeId,code,floor,polygonId,productsVerified})));
 assert.deepEqual(matches,[{storeId:'new-world-city-shanghai:L5:5A10',
  code:'5A10',floor:'L5',polygonId:matches[0].polygonId,productsVerified:false}]);
 assert.equal(matches[0].polygonId,null,
  '5A10 must remain a directory-only candidate until the photographed code is mapped');
 assert.equal((await page.evaluate(()=>window.RetailNavUnits.getHighlightedCodes())).length,1);
 console.log('PASS incremental autocomplete and luggage directory result across L1/L5 without inventing an absent vector');

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
 console.log('PASS all matching directory entries, not only first four or current floor');

 const withVector=await page.evaluate(()=>window.RetailNavUnits.getUnits()
  .find(u=>u.polygonId&&u.name));
 assert.ok(withVector,'fixture needs at least one photograph-associated commercial polygon');
 await input.fill(withVector.code);
 await input.press('Enter');
 await page.waitForFunction(code=>window.__RETAILNAV__?.getState()?.committedSearch===code,
  withVector.code,{timeout:8000});
 const mapped=await page.evaluate(()=>({
  vectors:window.RetailNavUnits.getMatchedVectors(),
  open:window.__RETAILNAV__.getState().visible,
  highlighted:window.__RETAILNAV__.getState().highlightedVectorCount
 }));
 assert.ok(mapped.highlighted>=1,'all legitimately related vector regions must be highlighted');
 assert.ok(mapped.vectors.some(v=>v.floor===withVector.floor&&v.polygonId===withVector.polygonId));
 assert.ok(mapped.open.includes(withVector.floor)&&mapped.open.includes('L1'));
 console.log('PASS independently matched source polygon is highlighted on its own floor');

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

 // Locale is read from the browser and may be overridden without changing
 // canonical concept IDs, losing search matches or redownloading geometry.
 assert.ok(await page.evaluate(()=>window.RetailNavI18n.getState().conceptCount>=15));
 const aventuraIndex=await page.evaluate(()=>({
  units:window.RetailNavUnits.getUnits(),
  state:window.RetailNavUnits.getState()
 }));
 assert.equal(aventuraIndex.units.filter(u=>u.codeKind==='map-vector-reference-not-lease-number'&&u.conceptIds.length).length,14);
 const appleDirectory=aventuraIndex.units.find(u=>u.source==='aventura-official-directory'&&u.name==='Apple');
 assert.ok(appleDirectory);
 assert.equal(appleDirectory.floor,null);
 assert.equal(appleDirectory.locationLabel,'Outdoor Courtyard');
 assert.equal(appleDirectory.polygonId,null);
 const jcpenneyDirectory=aventuraIndex.units.find(u=>u.source==='aventura-official-directory'&&u.name==='JCPenney');
 assert.deepEqual(jcpenneyDirectory.documentedFloors,['LL','UL']);
 assert.equal(jcpenneyDirectory.floor,null);
 assert.equal(jcpenneyDirectory.polygonId,null);
 await page.locator('#rnLanguageSelect').selectOption('en');
 await input.fill('Japanese cuisine');
 await page.waitForFunction(()=>[...document.querySelectorAll('.rnResultTag')]
  .some(el=>el.dataset.tag==='Japanese cuisine'));
 const diningPanel=await page.evaluate(()=>({
  heading:document.querySelector('#results .rnResultHeading')?.textContent,
  firstTag:document.querySelector('#results .rnResultTag')?.dataset.tag,
  firstGroup:document.querySelector('#results .rnResultGroup h5')?.textContent,
  groupId:document.querySelector('#results .rnResultGroup')?.dataset.conceptId,
  count:document.querySelector('.rnResultTag[data-tag="Japanese cuisine"] small')?.textContent,
  stores:[...document.querySelectorAll('#results .rnResultGroup[data-concept-id="cuisine.japanese"] .rnUnitResult')]
   .map(e=>e.dataset.storeId),
  firstResult:document.querySelector('#results').firstElementChild?.className
 }));
 assert.equal(diningPanel.heading,'Matching tags');
 assert.equal(diningPanel.firstTag,'Japanese cuisine');
 assert.match(diningPanel.count,/in this mall/);
 assert.equal(diningPanel.groupId,'cuisine.japanese');
 assert.ok(diningPanel.firstGroup.startsWith('Japanese cuisine'));
 assert.equal(diningPanel.firstResult,'rnResultHeading','tag summaries appear before grouped stores');
 assert.ok(diningPanel.stores.some(id=>id.startsWith('aventura:directory:')));
 assert.equal(Number(diningPanel.count.match(/^(\d+)/)?.[1]),diningPanel.stores.length,
  'tag count equals unique shop IDs, not floor appearances');
 assert.equal(new Set(diningPanel.stores).size,diningPanel.stores.length,
  'one directory store appears only once under a semantic tag');
 assert.equal(await page.locator('#rnSearchSuggestions').isVisible(),false,
  'the grouped result list is the single incremental search surface');
 await page.locator('.rnResultTag[data-concept-id="cuisine.japanese"]').click();
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState()?.committedSearch==='Japanese cuisine');
 const carousel=page.locator('#rnTagResultCards');
 assert.equal(await page.locator('#rnTagResultPanel').isVisible(),true,
  'selecting a semantic tag opens a dedicated panel outside the autocomplete dropdown');
 assert.equal(await page.locator('#rnMapSearch.finding').count(),0,
  'the autocomplete dropdown closes after a tag is selected');
 assert.equal(await page.locator('#results .rnStoreCard').count(),0,
  'selected-tag cards do not remain inside the dropdown');
 assert.equal(await carousel.getAttribute('data-concept-id'),'cuisine.japanese',
  'the carousel keeps its canonical tag identity');
 assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('rnTagResultsOpen')),true,
  'the former left information panel is closed while tag results are open');
 assert.ok(await carousel.locator('.rnStoreCard').count()>1,
  'selecting a category presents its matching establishments horizontally');
 assert.ok((await carousel.locator('.rnStoreCard').first().textContent()).length>0,
  'cards show the local name and its available specialties');
 const firstCard=carousel.locator('.rnStoreCard').first();
 const firstStoreId=await firstCard.getAttribute('data-store-id');
 assert.ok(await firstCard.locator('.rnStoreCardLogo').count(),
  'each card reserves space for the store logo or initials fallback');
 const mobilePanelPosition=await page.locator('#rnTagResultPanel').evaluate(el=>({
  bottom:getComputedStyle(el).bottom,top:getComputedStyle(el).top
 }));
 assert.equal(mobilePanelPosition.bottom,'44px','phone carousel sits at the bottom edge of the map');
 await page.locator('#rnLanguageSelect').selectOption('es-AR');
 assert.equal(await carousel.getAttribute('data-concept-id'),'cuisine.japanese',
  'changing device language keeps the selected tag group attached to its canonical ID');
 assert.ok(await carousel.locator('.rnStoreCard').count()>1,
  'changing language preserves the active store carousel');
 await firstCard.click();
 assert.equal(await page.locator('#rnUnitInfo').isVisible(),true,
  'selecting a local opens its map focus/details');
 assert.ok(firstStoreId);
 await page.locator('#rnUnitClose').click();
 await page.setViewportSize({width:900,height:900});
 await input.fill('Japanese cuisine');
 await page.locator('.rnResultTag[data-concept-id="cuisine.japanese"]').click();
 const tabletPanel=await page.locator('#rnTagResultPanel').evaluate(el=>({
  right:getComputedStyle(el).right,left:getComputedStyle(el).left
 }));
 assert.equal(tabletPanel.left,'auto','tablet carousel is docked on the map right side');
 assert.equal(await page.locator('#rnTagResultPanel').isVisible(),true);
 assert.equal(await page.locator('#sidebar').isVisible(),false,
  'tablet tag results close the former left information panel');
 await page.locator('#rnTagResultClose').click();
 assert.equal(await page.locator('#rnTagResultPanel').isVisible(),false,
  'the tag carousel has a direct close control');
 await page.setViewportSize({width:390,height:844});
 await page.locator('#rnExpandView').click();
 assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('rnExpandedView')),true);
 await page.locator('#rnExitExpandedView').click();
 assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('rnExpandedView')),false,
  'expanded viewport has a one-tap exit control');
 await page.locator('#rnLanguageSelect').selectOption('es-AR');
 await input.fill('cocina');
 const translated=await page.evaluate(()=>({
  label:document.querySelector('.rnResultTag[data-concept-id="cuisine.japanese"]')?.dataset.tag,
  group:document.querySelector('.rnResultGroup[data-concept-id="cuisine.japanese"]')?.dataset.conceptId,
  count:document.querySelector('.rnResultTag[data-concept-id="cuisine.japanese"] small')?.textContent
 }));
 assert.equal(translated.label,'cocina japonesa');
 assert.equal(translated.group,'cuisine.japanese','group identity remains semantic across locale changes');
 assert.match(translated.count,/locales en este mall/);
 const italian=page.locator('.rnResultGroup[data-concept-id="cuisine.italian"] .rnUnitResult').first();
 if(await italian.count()){
  await italian.click();
  assert.equal(await page.locator('#rnUnitInfo').isVisible(),true,
   'each matched establishment remains selectable for map focus/details');
 }
 await page.locator('#rnLanguageSelect').selectOption('en');
 await input.fill('Apple');
 assert.ok(await page.locator('.rnUnitResult').filter({hasText:'Apple'}).first().getAttribute('data-match-types')
  .then(value=>value.includes('name')),'commercial-name matches retain their match type');
 await input.fill('smartphone');
 assert.ok(await page.locator('.rnUnitResult[data-match-types*="product"]').count()>0,
  'product matches remain distinguishable');
 await input.fill('optical');
 assert.ok(await page.locator('.rnUnitResult[data-match-types*="service"]').count()>0,
  'service matches remain distinguishable');
 await input.fill('restaurant');
 assert.ok(await page.locator('.rnUnitResult[data-match-types*="category"]').count()>0,
  'category matches remain distinguishable');
 await input.fill('JCPenney');
 await input.press('Enter');
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState()?.committedSearch==='JCPenney');
 state=await page.evaluate(()=>window.__RETAILNAV__.getState());
 assert.deepEqual(state.visible,['LL','UL'],
  'an official multi-level listing opens its documented levels without claiming a vector boundary');
 await input.fill('Apple');
 await input.press('Enter');
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState()?.committedSearch==='Apple');
 const appleSearch=await page.evaluate(()=>({
  directory:window.RetailNavUnits.find('Apple').find(u=>u.source==='aventura-official-directory'),
  vectors:window.RetailNavUnits.getMatchedVectors()
 }));
 assert.equal(appleSearch.directory.polygonId,null);
 assert.ok(appleSearch.vectors.some(v=>v.floor==='LL'&&v.polygonId==='LL-002'),
  'retain the separate map-labeled Apple anchor as provisional');
 await page.locator('#rnLanguageSelect').selectOption('es-AR');
 await page.waitForFunction(()=>document.documentElement.lang==='es-AR');
 assert.match(await input.getAttribute('placeholder'),/Buscar/);
 await input.fill('lugg');
 await page.waitForFunction(()=>[...document.querySelectorAll('.rnResultTag')]
  .some(el=>el.dataset.tag==='valijas'));
 const luggageSuggestion=page.locator('.rnResultTag[data-tag="valijas"]');
 assert.ok(await luggageSuggestion.count()>=1);
 await luggageSuggestion.click();
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState()?.committedSearch==='valijas');
 assert.equal(await page.locator('#results').isVisible(),true,
  'confirmed search results must remain visible and clickable');
 state=await page.evaluate(()=>window.__RETAILNAV__.getState());
 assert.deepEqual(state.visible,['LL','UL','L3']);
 assert.ok(state.highlightedVectorCount>=4);
 const matchingIds=await page.evaluate(()=>window.RetailNavUnits.find('valijas').map(u=>u.storeId).sort());
 assert.ok(matchingIds.length>4);
 assert.deepEqual(matchingIds,await page.evaluate(()=>window.RetailNavUnits.find('luggage')
  .map(u=>u.storeId).sort()));
 assert.deepEqual(matchingIds,await page.evaluate(()=>window.RetailNavUnits.find('行李箱')
  .map(u=>u.storeId).sort()));
 await page.locator('#rnLanguageSelect').selectOption('en');
 await page.waitForFunction(()=>document.documentElement.lang==='en');
 assert.match(await input.getAttribute('placeholder'),/Search/);
 assert.ok((await page.locator('.rnUnitResult').allTextContents()).some(x=>x.includes('luggage')));
 await input.fill('reparar celular');
 await input.press('Enter');
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState()?.committedSearch==='reparar celular');
 const repairs=await page.evaluate(()=>window.RetailNavUnits.find('reparar celular'));
 assert.ok(repairs.some(u=>u.name==='Apple'&&u.source==='aventura-official-directory'));
 assert.ok(repairs.some(u=>u.name==='Apple'&&u.code==='LL-002'),
  'the old Apple map association remains separately marked as provisional');
 const unknown=await page.evaluate(()=>window.RetailNavUnits.getUnits().filter(u=>!u.name));
 assert.ok(unknown.length>100&&unknown.every(u=>u.conceptIds.length===0),
  'never invent product categories for unidentified photographed rooms');
 console.log('PASS Aventura locale switching, product/service synonyms, mapped floors and safe unknown stores');
 assert.deepEqual(errors,[]);
}finally{
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
