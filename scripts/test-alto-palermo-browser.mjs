import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
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
const base='http://127.0.0.1:'+server.address().port+'/retailnav/index.html?mall=alto-palermo';
const browser=await chromium.launch({headless:true,
 args:['--use-gl=angle','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base,{waitUntil:'domcontentloaded',timeout:50000});
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState()?.ready===true,
  null,{timeout:85000});
 const audit=await page.evaluate(()=>({
  mall:window.RETAILNAV_ACTIVE_MALL.id,
  floors:window.__RETAILNAV__.floors.map(f=>({id:f.id,total:f.features.length,
   commercial:f.features.filter(feature=>feature.k==='unit').length,
   triangles:f.features.reduce((sum,feature)=>sum+feature.t.length/3,0),
   ids:f.features.map(feature=>feature.id)})),
  units:window.RetailNavUnits.getState(),
  viewer:window.__RETAILNAV__.getState()
 }));
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
  audit.viewer.roofTextSummary.codeLabels+audit.viewer.roofTextSummary.knownNameLabels);
 assert.equal(audit.viewer.roofTextSummary.vectorFontSourceSha256,
  '8c883f63b2c4157d997319f2c8bc6995ed4357ef371940d31ca159004a4aae63');
 assert.equal(audit.viewer.roofTextSummary.vectorCurveSegments,24);
 assert.ok(audit.viewer.roofTextSummary.knownNameLabels>0);
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
 assert.deepEqual(errors,[]);
 console.log('PASS Alto Palermo browser: 6 floors, 331 official SVG regions and 192 commercial contours rendered');
}finally{
 await browser.close();
 await new Promise(ok=>server.close(ok));
}
