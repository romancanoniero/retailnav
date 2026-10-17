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
 assert.equal(audit.viewer.roofTextSummary.frontCodeLabels+
  audit.viewer.roofTextSummary.roofCodeLabels,55);
 assert.equal(audit.viewer.roofTextSummary.frontCodeLabels,0);
 assert.equal(audit.viewer.roofTextSummary.roofCodeLabels,55);
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
 assert.ok(audit.viewer.roofTextSummary.roomLabels.every(label=>
  label.codeRaised==='vector'&&label.codePlacement==='roof-bottom-right-inset'&&
  !label.frontCodeRaised));
 assert.ok(audit.viewer.roofTextSummary.roomLabels.every(label=>
  label.codeInset?.corner==='bottom-right'&&label.codeInset.insideSurface&&
  label.codeInset.rightInset>=.095&&label.codeInset.bottomInset>=.095&&
  label.codeInset.clearance>=.05),
 'every local code must keep real right/bottom perspective-safe roof clearance');
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
   roofCodes:summary.roofCodeLabels,frontCodes:summary.frontCodeLabels,
   suppressed:summary.roofImageNameSuppressions,
   codePlacement:summary.roomLabels[0]?.codePlacement,
   codeInset:summary.roomLabels[0]?.codeInset,
   roofVertices:floor.roofText.names.length,
   frontVertices:floor.roofText.frontNames.length
  };
 });
 assert.equal(roofImagePolicy.logoIsRoof,false,'card logo must not suppress roof lettering');
 assert.equal(roofImagePolicy.explicitIsRoof,true);
 assert.equal(roofImagePolicy.nestedIsRoof,true);
 assert.deepEqual([roofImagePolicy.names,roofImagePolicy.frontNames,roofImagePolicy.suppressed],
  [0,1,1]);
 assert.deepEqual([roofImagePolicy.roofCodes,roofImagePolicy.frontCodes],[0,1],
  'a roof image moves the local code to the lower facade instead of floating it');
 assert.equal(roofImagePolicy.codePlacement,'facade-bottom-right-inset');
 assert.ok(roofImagePolicy.codeInset?.rightInset>=.095&&
  roofImagePolicy.codeInset?.bottomInset>=.095,
 'facade code must preserve right and bottom margins');
 assert.equal(roofImagePolicy.roofVertices,0);
 assert.ok(roofImagePolicy.frontVertices>0,'roof imagery must preserve the smaller facade name');
 assert.deepEqual(audit.viewer.errors,[]);
 await page.waitForFunction(()=>window.RetailNavUnits.getRoofState()?.renderMode!=='pending');
 const surfaceLabels=await page.evaluate(()=>({
  ...window.RetailNavUnits.getRoofState(),
  floatingCodes:[...document.querySelectorAll('#rnUnitOverlay .rnUnitCode')]
   .filter(element=>!element.hidden).length
 }));
 assert.equal(surfaceLabels.renderMode,'vector-labels-owned-by-shop-surfaces');
 assert.equal(surfaceLabels.floatingPanels,0);
 assert.equal(surfaceLabels.raised,0);
 assert.equal(surfaceLabels.raisedTextGeometry,'none');
 assert.equal(surfaceLabels.raisedRasterAtlasCreated,false);
 assert.equal(surfaceLabels.floatingCodes,0);
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
 assert.equal(await page.locator('#rnUnitOverlay .rnUnitCode:visible').count(),0,
  'selecting a store must not create a floating local-code placard');
 await page.screenshot({path:'/tmp/retailnav-alto-palermo-contextual.png',fullPage:true});

 const directMappedPolygonSelection=await page.evaluate(()=>{
  const unit=window.RetailNavUnits.getUnits().find(candidate=>candidate.name==='Ver'&&
   candidate.floor==='PB');
  const binding=window.RetailNavUnits.getMapBindings(unit)[0];
  const floor=window.__RETAILNAV__.floors.find(candidate=>candidate.id===binding?.floor);
  const feature=floor?.features.find(candidate=>candidate.id===binding?.polygonId);
  window.__RETAILNAV__.select(feature);
  return {storeId:unit?.storeId,binding,selected:window.RetailNavMeetups.getState().selectedStoreId,
   focused:window.__RETAILNAV__.getState().focusedStoreId,
   vectors:window.__RETAILNAV__.getState().focusedStoreVectors};
 });
 assert.equal(directMappedPolygonSelection.binding?.polygonId,'PB-SVG-035');
 assert.equal(directMappedPolygonSelection.selected,directMappedPolygonSelection.storeId,
  'tapping a provisionally linked official SVG region must select its sole store');
 assert.equal(directMappedPolygonSelection.focused,directMappedPolygonSelection.storeId);
 assert.deepEqual(directMappedPolygonSelection.vectors,['PB:PB-SVG-035']);

 const unboundSelection=await page.evaluate(()=>{
  const units=window.RetailNavUnits.getUnits(),view=window.__RETAILNAV__;
  const feature=view.floors.flatMap(f=>f.features).find(candidate=>candidate.k==='unit'&&
   candidate.floor==='EP'&&
   units.filter(unit=>window.RetailNavUnits.getMapBindings(unit).some(binding=>
    binding.floor===candidate.floor&&binding.polygonId===candidate.id)).length!==1);
  view.select(feature);
  return {featureId:feature?.id,legacyCardVisible:!document.querySelector('#detail').hidden,
   actionDockVisible:window.RetailNavMeetups.getState().actionDockVisible,
   actionContext:window.RetailNavMeetups.getState().actionContext,
   selectedStoreId:window.RetailNavMeetups.getState().selectedStoreId,
   geometryContext:window.RetailNavMeetups.getState().geometryContext,
   assistDisabled:document.querySelector('#rnStoreAssist').disabled,
   inviteDisabled:document.querySelector('#rnStoreInvite').disabled,
   infoDisabled:document.querySelector('#rnStoreInfoAction').disabled,
   mapTitle:document.querySelector('#mapTitle').textContent,
   floorReference:document.querySelector('#rnFloorReference').textContent,
   notice:document.querySelector('#toast').textContent};
 });
 assert.ok(unboundSelection.featureId);
 assert.equal(unboundSelection.legacyCardVisible,false,
  'unlinked geometry must not resurrect the obsolete rectangular store actions');
 assert.equal(unboundSelection.actionDockVisible,true,
  'unlinked geometry must retain the radial contextual menu and central close control');
 assert.equal(unboundSelection.actionContext,'geometry');
 assert.equal(unboundSelection.selectedStoreId,null);
 assert.equal(unboundSelection.geometryContext.featureId,unboundSelection.featureId);
 assert.equal(unboundSelection.assistDisabled,true);
 assert.equal(unboundSelection.inviteDisabled,true);
 assert.equal(unboundSelection.infoDisabled,false);
 assert.match(unboundSelection.mapTitle,/EP/);
 assert.doesNotMatch(unboundSelection.mapTitle,/Starbucks/);
 assert.doesNotMatch(unboundSelection.floorReference,/Destino/);
 assert.match(unboundSelection.notice,/no está vinculado|varios comercios/);
 await page.waitForFunction(()=>document.querySelector('#rnStoreActions')?.classList.contains('is-visible'));
 const unboundLayout=await page.evaluate(()=>{
  const menu=document.querySelector('#rnStoreActions').getBoundingClientRect();
  const toast=document.querySelector('#toast').getBoundingClientRect();
  return {menu:{top:menu.top,bottom:menu.bottom},toast:{top:toast.top,bottom:toast.bottom}};
 });
 assert.ok(unboundLayout.toast.bottom<=unboundLayout.menu.top||
  unboundLayout.toast.top>=unboundLayout.menu.bottom,
 'the unlinked-geometry explanation must not cover the radial controls');
 await page.screenshot({path:'/tmp/retailnav-alto-palermo-unbound-contextual'+
  (process.env.RETAILNAV_BROWSER==='webkit'?'-webkit':'')+'.png',fullPage:true});
 await page.locator('#rnStoreInfoAction').click();
 assert.match(await page.locator('#toast').textContent(),/no está vinculado|varios comercios/);
 await page.locator('#rnStoreActionClose').click();
 await page.waitForFunction(()=>!window.RetailNavMeetups.getState().actionDockVisible);

 const unlinkedMarker=await page.evaluate(()=>{
  const units=window.RetailNavUnits.getUnits();
  const unit=units.find(candidate=>candidate.name&&Number.isFinite(candidate.x)&&
   Number.isFinite(candidate.y)&&window.RetailNavUnits.getMapBindings(candidate).length===0&&
   window.RetailNavUnits.findDetailed(candidate.name).length===1);
  return unit&&{storeId:unit.storeId,name:unit.name,floor:unit.floor,x:unit.x,y:unit.y};
 });
 assert.ok(unlinkedMarker,'fixture needs one uniquely searchable unlinked official marker');
 await page.locator('#search').fill(unlinkedMarker.name);
 await page.locator('#search').press('Enter');
 await page.evaluate(unit=>window.__RETAILNAV__.focusAt(unit.floor,[unit.x,unit.y],65),unlinkedMarker);
 await page.waitForFunction(storeId=>{
  const marker=document.querySelector('#rnSearchMarkers [data-store-id="'+storeId+'"]');
  return marker&&!marker.hidden;
 },unlinkedMarker.storeId);
 await page.locator('#rnSearchMarkers [data-store-id="'+unlinkedMarker.storeId+'"]').evaluate(marker=>marker.click());
 await page.waitForFunction(storeId=>window.RetailNavMeetups.getState().selectedStoreId===storeId&&
  window.RetailNavMeetups.getState().actionDockVisible,unlinkedMarker.storeId);
 assert.equal(await page.locator('#rnStoreAssist').isDisabled(),true,
  'an unlinked marker opens the contextual menu but cannot invent a route');
 assert.equal(await page.locator('#rnStoreInvite').isEnabled(),true);
 assert.equal(await page.locator('#rnStoreInfoAction').isEnabled(),true);
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
 const grounded=await page.evaluate(async()=>{
  const mall=window.RETAILNAV_ACTIVE_MALL,view=window.__RETAILNAV__;
  window.dispatchEvent(new CustomEvent('retailnav:map-point',{detail:{floor:'PB',x:3100,y:1800,
   mallId:mall.id,coordinateSpace:mall.coordinateSpace||'mall-photo-pixels',localOnly:true}}));
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const marker=document.querySelector('#rnMyPositionMarker'),canvas=document.querySelector('#canvas');
  const box=marker.getBoundingClientRect(),canvasBox=canvas.getBoundingClientRect();
  const projected=view.projectWorld(view.pinWorld('PB',3100,1800));
  return {visible:!marker.hidden,bottom:box.bottom,groundY:canvasBox.top+projected.y};
 });
 assert.equal(grounded.visible,true,'the manually set visitor location must be visible');
 assert.ok(Math.abs(grounded.bottom-grounded.groundY)<1.1,
  'the visitor sphere must touch its projected floor point instead of floating');
 const buttmanRoute=await page.evaluate(async()=>{
  const view=window.__RETAILNAV__,unit=window.RetailNavUnits.getUnits()
   .find(candidate=>candidate.name==='Buttman'&&candidate.floor==='PB');
  const focus=view.focusCatalogStore(unit.storeId,'PB');
  while(view.getState().cameraFlying)await new Promise(resolve=>requestAnimationFrame(resolve));
  const opened=view.openStoreAssistance(unit.storeId,'PB');
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const state=view.getState(),origin=document.querySelector('#rnWayfindingOrigin');
  const box=origin.getBoundingClientRect(),canvasBox=document.querySelector('#canvas').getBoundingClientRect();
  const projected=view.projectWorld(view.pinWorld('PB',3100,1800));
  return {focus,opened,wayfinding:state.wayfinding,bottom:box.bottom,
   groundY:canvasBox.top+projected.y,dots:document.querySelectorAll('#rnWayfindingDots .rnWayfindingDot:not([hidden])').length};
 });
 assert.equal(buttmanRoute.focus.located,true);
 assert.equal(buttmanRoute.opened.status,'provisional');
 assert.equal(buttmanRoute.wayfinding.mode,'same-floor');
 assert.equal(buttmanRoute.wayfinding.routeReason,'official-svg-free-space-preview');
 assert.ok(buttmanRoute.wayfinding.points.length>3&&buttmanRoute.dots>8,
  'a same-floor Alto Palermo selection must draw the provisional dotted corridor preview');
 assert.ok(Math.abs(buttmanRoute.bottom-buttmanRoute.groundY)<1.1,
  'the navigation origin sphere must remain grounded');
 assert.deepEqual(buttmanRoute.wayfinding.connectorsUsed,[],
  'same-floor derivation must not fabricate escalators or other vertical connectors');
 await page.screenshot({path:'/tmp/retailnav-alto-palermo-wayfinding-grounded'+
  (process.env.RETAILNAV_BROWSER==='webkit'?'-webkit':'')+'.png',fullPage:true});
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
