import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {chromium,webkit} from 'playwright';

const root=resolve('public');
const types={'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8',
 '.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png'};
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 if(!path.startsWith('/retailnav/')){res.writeHead(404);res.end();return;}
 const file=resolve(root,path.slice('/retailnav/'.length)||'index.html');
 if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{const bytes=readFileSync(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream',
  'content-length':bytes.length,'cache-control':'no-store'});res.end(bytes);}
 catch{res.writeHead(404);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const engine=process.env.BROWSER==='webkit'?'webkit':'chromium';
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,
 args:engine==='webkit'?[]:['--use-gl=angle','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1024,height:768},hasTouch:true});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const url=new URL(process.env.RETAILNAV_TEST_URL||'http://127.0.0.1:'+server.address().port+'/retailnav/index.html');
 url.searchParams.set('mall','aventura');
 await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState().ready&&window.RetailNavComparison,
  null,{timeout:85000});
 await page.emulateMedia({reducedMotion:'reduce'});
 const settle=()=>page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));

 // The source mesh is the active scene, but the original photo QA keeps its
 // original pixel vectors and labels. Source-space coordinates cannot leak in.
 await page.locator('#original').tap();
 await page.locator('#compareDialog').waitFor({state:'visible'});
 for(const level of ['LL','UL','L3']){
  await page.locator('#compareLevel').selectOption(level);
  const original=JSON.parse(readFileSync(resolve(root,'maps',level+'.json')));
  const actual=await page.evaluate(()=>({
   paths:[...document.querySelectorAll('#traceOverlay path')].map(p=>p.getAttribute('d')),
   labels:[...document.querySelectorAll('#compareUnitLabels text')].map(p=>({
    code:p.textContent,x:Number(p.getAttribute('x')),y:Number(p.getAttribute('y'))})),
   reference:document.querySelector('#referenceImage').getAttribute('href'),
   state:window.RetailNavComparison.getState(),
   nativeCounts:window.__RETAILNAV__.getState().features
  }));
  const expectedPaths=original.geometry.filter(feature=>feature[1]!==5).map(feature=>{
   let x=0,y=0;const points=[];
   for(let i=0;i<feature[3].length;i+=2){x+=feature[3][i];y+=feature[3][i+1];points.push([x/2,y/2]);}
   return feature[4].map(ring=>'M'+ring.map(i=>points[i].join(',')).join(' L')+'Z').join(' ');
  });
  assert.deepEqual(actual.paths,expectedPaths,level+': photo overlay must use every original pixel ring');
  const expectedLabels=original.geometry.filter(feature=>[0,1].includes(feature[1]))
   .map(feature=>({code:feature[0],x:feature[6][0],y:feature[6][1]}));
  assert.deepEqual(actual.labels,expectedLabels,level+': only original photo codes may label a photo');
  assert.ok(actual.labels.every(label=>!label.code.startsWith('directory-')));
  assert.ok(actual.reference&&actual.state.hasReference&&actual.state.originalVisible);
  assert.equal(actual.state.level,level);
  assert.equal(actual.nativeCounts.reduce((sum,[,count])=>sum+count,0),616,
   'opening photo QA must not replace the native source mesh');
 }
 await page.locator('[data-close="compareDialog"]').tap();
 console.log('PASS original photo comparator: three exact legacy vector overlays and 131 original code positions');

 // A selection made outside a committed search also changes GPU colours.
 // Returning to the floor must restore the pixels, not just clear JS state.
 await page.locator('#floorSelect').selectOption('LL');
 await page.locator('#labelsToggle').evaluate(el=>el.click());
 const fixture=await page.evaluate(()=>{
  window.RetailNavPins?.setPeople?.([]);
  const store=window.RetailNavUnits.getUnits().find(u=>u.name==='JCPenney'&&u.sourceGeometry);
  return {storeId:store.storeId,floor:store.floor,point:[store.x,store.y]};
 });
 assert.equal(fixture.floor,'LL');
 const sample=async()=>{
  await settle();
  return page.evaluate(fixture=>{
   const view=window.__RETAILNAV__,canvas=document.querySelector('#canvas'),gl=canvas.getContext('webgl');
   const world=view.pinWorld(fixture.floor,...fixture.point);
   const p=view.projectWorld([world[0],world[1]+1.41,world[2]]);
   const size=7,px=Math.round(p.x*canvas.width/canvas.clientWidth),py=canvas.height-Math.round(p.y*canvas.height/canvas.clientHeight);
   if(!gl)return {renderer:view.getState().renderer};
   if(px<4||py<4||px>=canvas.width-4||py>=canvas.height-4)throw Error('Pixel fixture outside canvas');
   const pixels=new Uint8Array(size*size*4);gl.readPixels(px-3,py-3,size,size,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   return {renderer:view.getState().renderer,pixels:[...pixels],state:view.getState()};
  },fixture);
 };
 const before=await sample();
 assert.equal(before.renderer,'WebGL','GPU cancellation regression needs the native WebGL renderer');
 assert.equal(before.state.searchFloorIDs,null);
 await page.evaluate(id=>window.__RETAILNAV__.focusCatalogStore(id,'LL'),fixture.storeId);
 const focused=await sample();
 assert.ok(focused.state.focusedStoreVectors.length>0);
 assert.notDeepEqual(focused.pixels,before.pixels,'fixture must visibly change colour while selected');
 await page.locator('#floorSelect').selectOption('UL');
 await page.locator('#floorSelect').selectOption('LL');
 const after=await sample();
 assert.deepEqual(after.state.focusedStoreVectors,[]);
 assert.equal(after.state.focusedStoreId,null);
 assert.deepEqual(after.pixels,before.pixels,'returning to a floor must remove stale GPU selection colours');
 await page.locator('#downloadBtn').evaluate(el=>el.click());
 const svgDownload=page.waitForEvent('download');
 await page.locator('#svgBtn').click();
 const svg=readFileSync(await (await svgDownload).path(),'utf8');
 const [x,y,width,height]=svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
 const native=await page.evaluate(()=>window.__RETAILNAV__.floors.find(f=>f.id==='LL').features.map(f=>({
  id:f.id,points:f.p,outer:f.r[0],holes:f.r.slice(1)})));
 assert.ok(width>0&&height>0);
 assert.ok(native.flatMap(f=>f.points).every(p=>p[0]>=x&&p[0]<=x+width&&p[1]>=y&&p[1]<=y+height),
  'SVG export must frame the full native source coordinates rather than the former photo bounds');
 const jsonDownload=page.waitForEvent('download');
 await page.locator('#jsonBtn').click();
 const exported=JSON.parse(readFileSync(await (await jsonDownload).path(),'utf8'));
 assert.equal(exported.coordinateSpace,'roveiq:107:local-decimeters-v1');
 assert.match(exported.calibration,/decímetros/);
 assert.deepEqual(exported.levels.map(f=>f.id),['LL']);
 assert.deepEqual(exported.levels[0].features.map(f=>({id:f.id,...f.geometry})),
  native.map(({id,outer,holes})=>({id,outer,holes})));
 assert.deepEqual(errors,[]);
 console.log('PASS floor changes remove native GPU highlighting without a committed search');
 console.log('PASS SVG/JSON exports retain source bounds, coordinate space and polygon rings');
}finally{await browser.close();await new Promise(ok=>server.close(ok));}
