import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
const base='http://127.0.0.1:'+server.address().port+'/retailnav/index.html?mall=alto-palermo';
const engine=process.env.RETAILNAV_BROWSER==='webkit'?webkit:chromium;
const browser=await engine.launch({headless:true,
 args:engine===chromium?['--use-gl=angle','--use-angle=swiftshader']:[]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base,{waitUntil:'domcontentloaded',timeout:50000});
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState()?.ready===true,
  null,{timeout:85000});
 const audit=await page.evaluate(()=>{
  const allFloors=window.__RETAILNAV__.floors;
  const frontVertices=allFloors.flatMap(f=>Array.from(f.roofText?.frontNames||[]));
  const frontY=frontVertices.filter((_,index)=>index%10===1);
  let minFrontY=Infinity,maxFrontY=-Infinity;
  for(const y of frontY){minFrontY=Math.min(minFrontY,y);maxFrontY=Math.max(maxFrontY,y);}
  return {
  mall:window.RETAILNAV_ACTIVE_MALL.id,
  floors:allFloors.map(f=>({id:f.id,total:f.features.length,
   commercial:f.features.filter(feature=>feature.k==='unit').length,
   triangles:f.features.reduce((sum,feature)=>sum+feature.t.length/3,0),
   ids:f.features.map(feature=>feature.id)})),
  units:window.RetailNavUnits.getState(),
  viewer:window.__RETAILNAV__.getState(),
  frontGeometry:{vertices:frontVertices.length/10,
   verticalSpan:frontY.length?maxFrontY-minFrontY:0}
  };
 });
 assert.equal(audit.mall,'alto-palermo');
 assert.deepEqual(audit.floors.map(f=>[f.id,f.total,f.commercial]),[
  ['SS',137,4],['PB',73,72],['EP',14,12],['P1',47,46],['P2',44,43],['P3',16,15]
 ]);
 assert.equal(audit.floors.reduce((sum,f)=>sum+f.total,0),331);
 assert.equal(audit.floors.reduce((sum,f)=>sum+f.commercial,0),192);
 assert.ok(audit.floors.every(f=>f.triangles>f.commercial));
 assert.ok(audit.floors.every(f=>f.ids.every(id=>!id.includes('-SLAB-'))));
 assert.equal(audit.units.count,158);
 assert.equal(audit.units.matched,55);
 assert.equal(audit.units.unmatched,103);
 assert.equal(audit.viewer.roofTextSummary.codeLabels,55);
 assert.equal(audit.viewer.roofTextSummary.commercialRoofs,192);
 assert.equal(audit.viewer.roofTextSummary.textGeometry,'vector-outline-extruded');
 assert.equal(audit.viewer.roofTextSummary.rasterGlyphLabels,0);
 assert.equal(audit.viewer.roofTextSummary.vectorGlyphLabels,
  audit.viewer.roofTextSummary.codeLabels+audit.viewer.roofTextSummary.knownNameLabels+
  audit.viewer.roofTextSummary.frontNameLabels);
 assert.equal(audit.viewer.roofTextSummary.vectorFontSourceSha256,
  '8c883f63b2c4157d997319f2c8bc6995ed4357ef371940d31ca159004a4aae63');
 assert.equal(audit.viewer.roofTextSummary.vectorCurveSegments,24);
 assert.equal(audit.viewer.roofTextSummary.knownNameLabels,55);
 assert.equal(audit.viewer.roofTextSummary.frontNameLabels,55);
 assert.equal(audit.viewer.roofTextSummary.roofImageNameSuppressions,0);
 assert.ok(audit.viewer.roofTextSummary.roomLabels.every(label=>
  !label.name||(label.nameRaised==='vector'&&label.frontNameRaised==='vector')));
 assert.ok(audit.frontGeometry.vertices>1000);
 assert.ok(audit.frontGeometry.verticalSpan>.1,'facade lettering must be vertical geometry');
 const roofImagePolicy=await page.evaluate(()=>{
  const mall=window.RETAILNAV_ACTIVE_MALL;
  const unit=mall.units.find(item=>item.polygonId&&item.name&&item.facade);
  const sourceFloor=window.__RETAILNAV__.floors.find(f=>f.id===unit.floor);
  const feature=sourceFloor.features.find(f=>f.id===unit.polygonId);
  const floor={id:sourceFloor.id,features:[structuredClone(feature)]};
  const textured={...structuredClone(unit),roofImageURL:'roof-textures/test.webp'};
  const summary=window.RetailNavRoofText.prepare([floor],[textured],[],mall.origin,mall.scale);
  return {
   logoIsRoof:window.RetailNavRoofText.hasRoofImage({logoURL:'brand.png'}),
   explicitIsRoof:window.RetailNavRoofText.hasRoofImage(textured),
   nestedIsRoof:window.RetailNavRoofText.hasRoofImage({roof:{textureURL:'roof.webp'}}),
   names:summary.knownNameLabels,frontNames:summary.frontNameLabels,
   suppressed:summary.roofImageNameSuppressions,
   roofVertices:floor.roofText.names.length,
   frontVertices:floor.roofText.frontNames.length
  };
 });
 assert.equal(roofImagePolicy.logoIsRoof,false,'card logo must not suppress roof lettering');
 assert.equal(roofImagePolicy.explicitIsRoof,true);
 assert.equal(roofImagePolicy.nestedIsRoof,true);
 assert.deepEqual([roofImagePolicy.names,roofImagePolicy.frontNames,roofImagePolicy.suppressed],
  [0,1,1]);
 assert.equal(roofImagePolicy.roofVertices,0);
 assert.ok(roofImagePolicy.frontVertices>0,'roof imagery must preserve the smaller facade name');
 assert.deepEqual(audit.viewer.errors,[]);
 await page.waitForFunction(()=>window.RetailNavUnits.getRoofState()?.raisedVectorTriangles>0);
 const raisedSign=await page.evaluate(()=>window.RetailNavUnits.getRoofState());
 assert.equal(raisedSign.renderMode,'world-space-vector-outline-extruded-signs');
 assert.equal(raisedSign.raisedTextGeometry,'vector-outline-double-sided-extruded');
 assert.equal(raisedSign.raisedRasterAtlasCreated,false);
 assert.ok(raisedSign.raisedVectorTriangles>100);
 assert.equal(await page.locator('#mallHeaderLogo').isVisible(),true);
 assert.match(await page.locator('#mallHeaderLogo').getAttribute('src'),
  /branding\/malls\/alto-palermo\/mall-mark\.png$/);
 await page.locator('#search').fill('Adidas');
 await page.waitForFunction(()=>document.querySelector('.rnUnitResult .rnStoreResultLogo img')?.complete===true);
 const adidasLogo=await page.locator('.rnUnitResult .rnStoreResultLogo img').first().evaluate(img=>({
  src:img.getAttribute('src'),width:img.naturalWidth,height:img.naturalHeight
 }));
 assert.match(adidasLogo.src,/branding\/malls\/alto-palermo\/stores\/adidas-[a-f0-9]{8}\.png$/);
 assert.ok(adidasLogo.width>0&&adidasLogo.height>0);
 const fashion=await page.evaluate(()=>window.RetailNavUnits.suggestions('moda',15));
 assert.ok(fashion.some(item=>item.count>=40));
 await page.locator('#search').fill('caf');
 await page.waitForFunction(()=>[...document.querySelectorAll('.rnUnitResult')]
  .some(element=>element.dataset.storeId==='alto-palermo:EP:L04'));
 const coffeeSearch=await page.evaluate(()=>({
  labels:[...document.querySelectorAll('.rnResultTag')].map(element=>element.dataset.tag
   .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()),
  stores:[...document.querySelectorAll('#results .rnUnitResult')].map(element=>element.dataset.storeId),
  starbucks:[...document.querySelectorAll('#results .rnUnitResult')]
   .filter(element=>element.dataset.storeId==='alto-palermo:EP:L04').length
 }));
 assert.equal(new Set(coffeeSearch.labels).size,coffeeSearch.labels.length,
  'legacy café tag and canonical coffee concept must not duplicate a visible suggestion');
 assert.equal(new Set(coffeeSearch.stores).size,coffeeSearch.stores.length,
  'a store matching several tags must appear only once in the autocomplete');
 assert.equal(coffeeSearch.starbucks,1,'Starbucks must be rendered once for the caf query');
 await page.locator('#results .rnUnitResult[data-store-id="alto-palermo:EP:L04"]').click();
 await page.waitForFunction(()=>!window.__RETAILNAV__.getState().cameraFlying&&
  document.querySelector('#rnStoreActions')?.classList.contains('is-visible'));
 await page.waitForFunction(()=>{
  const menu=document.querySelector('#rnStoreActions');
  return menu&&!menu.hidden&&[menu,...menu.querySelectorAll('button')].every(node=>
   !node.getAnimations?.().some(animation=>animation.playState==='running'||
    animation.playState==='pending'));
 });
 const radialSelection=await page.evaluate(()=>({
  selected:window.RetailNavMeetups.getState().selectedStoreId,
  legacyCardVisible:!document.querySelector('#detail').hidden,
  actionDockVisible:window.RetailNavMeetups.getState().actionDockVisible,
  buttons:[...document.querySelectorAll('#rnStoreActions button')].map(button=>{
   const box=button.getBoundingClientRect();return {width:box.width,height:box.height,
    radius:getComputedStyle(button).borderRadius};
  })
 }));
 assert.equal(radialSelection.selected,'alto-palermo:EP:L04');
 assert.equal(radialSelection.legacyCardVisible,false);
 assert.equal(radialSelection.actionDockVisible,true);
 assert.equal(radialSelection.buttons.length,4);
 assert.ok(radialSelection.buttons.every(button=>button.width>=44&&button.height>=44&&
  button.radius==='50%'),'every selected-store action, including X, remains circular');

 const unboundSelection=await page.evaluate(()=>{
  const units=window.RetailNavUnits.getUnits(),view=window.__RETAILNAV__;
  const feature=view.floors.flatMap(f=>f.features).find(candidate=>candidate.k==='unit'&&
   units.filter(unit=>window.RetailNavUnits.getMapBindings(unit).some(binding=>
    binding.floor===candidate.floor&&binding.polygonId===candidate.id)).length!==1);
  view.select(feature);
  return {featureId:feature?.id,legacyCardVisible:!document.querySelector('#detail').hidden,
   actionDockVisible:window.RetailNavMeetups.getState().actionDockVisible,
   selectedStoreId:window.RetailNavMeetups.getState().selectedStoreId,
   notice:document.querySelector('#toast').textContent};
 });
 assert.ok(unboundSelection.featureId);
 assert.equal(unboundSelection.legacyCardVisible,false,
  'unlinked geometry must not resurrect the obsolete rectangular store actions');
 assert.equal(unboundSelection.actionDockVisible,false);
 assert.equal(unboundSelection.selectedStoreId,null);
 assert.match(unboundSelection.notice,/no está vinculado|varios comercios/);
 await page.locator('#search').fill('');
 await page.locator('#floorSelect').selectOption('PB');
 await page.waitForFunction(()=>window.__RETAILNAV__.getState().visible.length===1&&
  window.__RETAILNAV__.getState().visible[0]==='PB');
 const pb=await page.evaluate(()=>({
  visible:window.__RETAILNAV__.getState().visible,
  polygons:window.__RETAILNAV__.floors.find(f=>f.id==='PB').features.length,
  commercial:window.__RETAILNAV__.floors.find(f=>f.id==='PB').features
   .filter(feature=>feature.k==='unit').length,
  canvas:document.querySelector('#canvas').getBoundingClientRect().toJSON()
 }));
 assert.deepEqual(pb.visible,['PB']);
 assert.equal(pb.polygons,73);
 assert.equal(pb.commercial,72);
 assert.ok(pb.canvas.width>900&&pb.canvas.height>450);
 await page.screenshot({path:'/tmp/retailnav-alto-palermo-vectorized.png',fullPage:true});
 const starbucks=await page.evaluate(()=>window.RetailNavUnits.getUnits()
  .find(unit=>unit.storeId==='alto-palermo:EP:L04'));
 assert.ok(starbucks?.polygonId);
 const focused=await page.evaluate(unit=>window.__RETAILNAV__.focusCatalogStore(
  unit.storeId,unit.floor,[unit.x,unit.y],unit.polygonId),starbucks);
 assert.equal(focused.located,true);
 await page.waitForFunction(()=>!window.__RETAILNAV__.getState().cameraFlying);
 await page.screenshot({path:'/tmp/retailnav-alto-palermo-roof-and-facade-names.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS Alto Palermo browser: 6 floors, 331 official SVG regions and 192 commercial contours rendered');
}finally{
 await browser.close();
 await new Promise(ok=>server.close(ok));
}
