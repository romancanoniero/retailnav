import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFileSync,statSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {chromium} from 'playwright';

const root=resolve('public');
const sourceHtml=readFileSync(join(root,'index.html'),'utf8');
const mime={'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8',
 '.js':'text/javascript;charset=utf-8','.webp':'image/webp',
 '.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.css':'text/css'};
let html=sourceHtml;
const overrides=new Map();
const requests=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(!url.pathname.startsWith('/retailnav/')){res.writeHead(404);return res.end();}
 const tail=url.pathname.slice('/retailnav/'.length);
 const target=resolve(root,tail||'index.html');
 if(!target.startsWith(root+'/')&&target!==join(root,'index.html')){res.writeHead(403);return res.end();}
 try{
  let body;
  if((tail||'index.html')==='index.html')body=Buffer.from(html);
  else if(overrides.has(tail))body=overrides.get(tail);
  else body=readFileSync(target);
  if(tail.startsWith('maps/malls/')){
   requests.set(tail,(requests.get(tail)||0)+1);
   await sleep(325); // Force the white download overlay to be observable.
  }
  res.writeHead(200,{
   'Content-Type':mime[extname(target)]||'application/octet-stream',
   'Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
  });
  res.end(body);
 }catch(e){res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const base='http://127.0.0.1:'+port+'/retailnav/index.html';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,
  isMobile:true,hasTouch:true});
 const page=await context.newPage();
 page.on('pageerror',e=>console.error('PAGEERROR',e));
 const waitReady=async(expected)=>{
  await page.waitForFunction(()=>window.RetailNavMapCache?.getState().phase==='ready'&&
   window.__RETAILNAV__?.getState().ready===true,null,{timeout:85000});
  const state=await page.evaluate(()=>window.__RETAILNAV__.getState());
  assert.equal(state.mallId,expected);
  assert.equal(state.ready,true);
  assert.equal(state.mapCache.overlayVisible,false);
  return state;
 };
 await page.goto(base+'?mall=aventura',{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>document.getElementById('rnMapDownloadMall').textContent==='Aventura Mall',null,{timeout:10000});
 assert.equal(await page.locator('#rnMapDownloadScreen').isVisible(),true,
  'First-time unpopulated cache must display full white screen');
 const white=await page.locator('#rnMapDownloadScreen').evaluate(el=>getComputedStyle(el).backgroundColor);
 assert.equal(white,'rgb(255, 255, 255)','Loading background should be white');
 assert.equal(await page.locator('#rnMapDownloadPowered').textContent(),'Powered by RetailNav');
 assert.equal(await page.locator('#rnMapDownloadPowered').isVisible(),true);
 const loadingOrder=await page.locator('.rnMapDownloadCenter').evaluate(el=>
  [...el.children].map(node=>node.id).slice(0,3));
 assert.deepEqual(loadingOrder,['rnMapDownloadLogo','rnMapDownloadMall','rnMapDownloadPowered'],
  'Loaded shopping logo must be above its name and Powered by RetailNav');
 await page.waitForFunction(()=>{
  const logo=document.getElementById('rnMapDownloadLogo');
  return logo&&!logo.hidden&&logo.complete&&logo.naturalWidth>0;
 },null,{timeout:10000});
 assert.match(await page.locator('#rnMapDownloadLogo').getAttribute('src'),
  /branding\/aventura-mark\.svg$/);
 const first=await waitReady('aventura');
 assert.equal(first.mapCache.origin,'network');
 assert.equal(requests.size,1);
 assert.equal(first.features.length,3);
 assert.equal(first.mapCache.version.length,64);
 const paths=await page.evaluate(async()=>{
  const cache=await caches.open('retailnav-mall-maps-v1');
  return (await cache.keys()).map(k=>new URL(k.url).pathname);
 });
 assert.equal(paths.length,1);
 console.log('PASS first visit with download screen, 3 floors and versioned cache');

 await page.reload({waitUntil:'domcontentloaded',timeout:45000});
 const hit=await waitReady('aventura');
 assert.equal(hit.mapCache.origin,'cache');
 assert.equal(hit.mapCache.cacheStatus,'hit');
 assert.equal([...requests.values()].reduce((a,b)=>a+b,0),1,
  'Version-matched map should not be fetched a second time');
 console.log('PASS cache hit without downloading geometry');

 await page.goto(base+'?mall=ap-plaza',{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>document.getElementById('rnMapDownloadMall').textContent==='AP Plaza');
 assert.equal(await page.locator('#rnMapDownloadPowered').textContent(),'Powered by RetailNav');
 assert.equal(await page.locator('#rnMapDownloadLogo').isVisible(),false,
  'Shoppings without a logo must not show placeholder artwork');
 const ap=await waitReady('ap-plaza');
 assert.equal(ap.features.length,1);
 assert.equal(ap.mapCache.origin,'network');
 assert.equal(requests.size,2);
 await page.goto(base+'?mall=aventura',{waitUntil:'domcontentloaded',timeout:45000});
 const returned=await waitReady('aventura');
 assert.equal(returned.mapCache.origin,'cache');
 assert.equal(requests.size,2);
 console.log('PASS mall isolation and return to cached site');

 // Simulate a real deployment with a changed floor file and new build metadata.
 const tag='<script id="mallCatalog" type="application/json">';
 const firstIndex=sourceHtml.indexOf(tag)+tag.length;
 const lastIndex=sourceHtml.indexOf('</script>',firstIndex);
 assert.ok(firstIndex>tag.length-1&&lastIndex>firstIndex);
 const catalog=JSON.parse(sourceHtml.slice(firstIndex,lastIndex));
 const oldUrl=catalog.aventura.mapAsset.url;
 const original=JSON.parse(readFileSync(join(root,oldUrl),'utf8'));
 const newHash=createHash('sha256').update('new-map-release-for-browser-test').digest('hex');
 original.version=newHash;
 original.floors[0][1]='Lower Level (version updated)';
 const newBody=Buffer.from(JSON.stringify(original));
 const newUrl='maps/malls/aventura-'+newHash+'.json';
 catalog.aventura.mapAsset={
  ...catalog.aventura.mapAsset,url:newUrl,version:newHash,
  sha256:createHash('sha256').update(newBody).digest('hex'),
  bytes:newBody.length
 };
 overrides.set(newUrl,newBody);
 html=sourceHtml.slice(0,firstIndex)+JSON.stringify(catalog)+sourceHtml.slice(lastIndex);
 await page.goto(base+'?mall=aventura',{waitUntil:'domcontentloaded',timeout:45000});
 assert.equal(await page.locator('#rnMapDownloadScreen').isVisible(),true,
  'New version must show white download overlay');
 const refreshed=await waitReady('aventura');
 assert.equal(refreshed.mapCache.origin,'network','New version must not load old cache');
 assert.equal(refreshed.mapCache.version,newHash);
 assert.equal(refreshed.features.length,3);
 const finalPaths=await page.evaluate(async()=>{
  const cache=await caches.open('retailnav-mall-maps-v1');
  return (await cache.keys()).map(k=>new URL(k.url).pathname);
 });
 assert.equal(finalPaths.length,2,'One Aventura version + cached AP Plaza');
 assert.ok(finalPaths.some(s=>s.endsWith(newHash+'.json')),'New version was cached');
 assert.ok(!finalPaths.some(s=>s.endsWith(oldUrl.split('/').at(-1))),
  'Old Aventura version was evicted after validating replacement');
 assert.ok(finalPaths.some(s=>s.includes('ap-plaza-')),'Other mall cache unaffected');
 console.log('PASS new version download/revalidation with old map eviction');

 const other=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const failure=await other.newPage();
 await failure.route('**/maps/malls/*.json',route=>route.abort('failed'));
 await failure.goto(base+'?mall=ap-plaza',{waitUntil:'domcontentloaded',timeout:45000});
 await failure.waitForFunction(()=>window.RetailNavMapCache?.getState().phase==='error',null,{timeout:20000});
 const broken=await failure.evaluate(()=>window.RetailNavMapCache.getState());
 assert.equal(broken.overlayVisible,true);
 assert.equal(await failure.locator('#rnMapDownloadRetry').isVisible(),true);
 assert.equal(await failure.locator('#rnMapDownloadScreen').isVisible(),true);
 assert.equal(await failure.locator('#rnMapDownloadMall').textContent(),'AP Plaza');
 assert.equal(await failure.locator('#rnMapDownloadPowered').textContent(),'Powered by RetailNav');
 assert.equal(await failure.locator('#rnMapDownloadLogo').isVisible(),false);
 assert.equal(await failure.evaluate(()=>!!window.__RETAILNAV__?.getState().ready),false,
  'Failed download must never expose an incomplete map');
 await other.close();
 console.log('PASS graceful failed download, retry and no incomplete map');
}finally{
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
