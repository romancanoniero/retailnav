/* Test the actual FIRST PAINT, not a header logo visible after map loading.
 * Stream the HTML in two chunks with a deliberate pause before the full
 * catalog, viewer or map-cache scripts parse. This reproduces Safari's white
 * loading screen on slow mobile connections.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {createServer} from 'node:http';
import {chromium,webkit} from 'playwright';

const root=resolve('public');
const html=readFileSync(resolve(root,'index.html'));
const text=html.toString('utf8');
const beforeViewer=text.indexOf('<svg xmlns="http://www.w3.org/2000/svg" width="0"');
assert.ok(beforeViewer>1000);
assert.ok(text.indexOf('id="rnLoaderBrandCatalog"')<beforeViewer);
assert.ok(text.indexOf('window.RetailNavLoaderBrand')<beforeViewer);
assert.ok(text.indexOf('id="mallCatalog"')>beforeViewer);
const firstByteCount=Buffer.byteLength(text.slice(0,beforeViewer));
const mime={'.html':'text/html; charset=utf-8','.svg':'image/svg+xml',
 '.json':'application/json','.webp':'image/webp','.png':'image/png',
 '.jpg':'image/jpeg','.css':'text/css'};
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(!url.pathname.startsWith('/retailnav/')){res.writeHead(404);res.end();return;}
 const tail=url.pathname.slice('/retailnav/'.length)||'index.html';
 if(tail==='index.html'&&url.searchParams.get('firstpaint')==='1'){
  res.writeHead(200,{'content-type':mime['.html'],'cache-control':'no-store'});
  res.write(html.subarray(0,firstByteCount));
  setTimeout(()=>res.end(html.subarray(firstByteCount)),2400);
  return;
 }
 const file=resolve(root,tail);
 if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{
  const bytes=readFileSync(file);
  res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream',
   'content-length':bytes.length,'cache-control':'no-store'});
  res.end(bytes);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port+'/retailnav/index.html';
async function checkEngine(engine){
 const browser=await engine.launch({headless:true,...(engine===chromium?{
  args:['--use-gl=angle','--use-angle=swiftshader']}:{})});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},
   deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'?mall=aventura&firstpaint=1',{waitUntil:'commit'});
  await page.waitForFunction(()=>{
   const brand=window.RetailNavLoaderBrand?.getState?.();
   const icon=document.getElementById('rnMapDownloadLogo');
   return brand?.visible===true && brand.mallId==='aventura' &&
    brand.source==='static' &&
    document.getElementById('rnMapDownloadMall')?.textContent==='Aventura Mall' &&
    icon && !icon.hidden && icon.complete && icon.naturalWidth>0 &&
    // This proves the logo appeared BEFORE the full viewer was parsed.
    document.getElementById('mallCatalog')===null;
  },null,{timeout:2000});
  const early=await page.evaluate(()=>{
   const img=document.getElementById('rnMapDownloadLogo');
   const name=document.getElementById('rnMapDownloadMall');
   const iconBox=img.getBoundingClientRect();
   const titleBox=name.getBoundingClientRect();
   return {
    src:img.getAttribute('src'),
    naturalWidth:img.naturalWidth,
    naturalHeight:img.naturalHeight,
    boxWidth:iconBox.width,
    boxHeight:iconBox.height,
    logoBottom:iconBox.bottom,
    nameTop:titleBox.top,
    loaderVisible:!document.getElementById('rnMapDownloadScreen').hidden,
    powered:document.getElementById('rnMapDownloadPowered').textContent,
    cacheNotYetLoaded:window.RetailNavMapCache===undefined,
    font:getComputedStyle(name).fontFamily
   };
  });
  assert.match(early.src,/\/branding\/aventura-mark\.svg$/);
  assert.ok(early.naturalWidth>0&&early.naturalHeight>0);
  assert.ok(early.boxWidth>20&&early.boxHeight>15,
   'Logo must have visible layout dimensions, not only downloaded bytes');
  assert.ok(early.logoBottom<early.nameTop,
   'Logo must be ABOVE the shopping name during the white loading screen');
  assert.equal(early.loaderVisible,true);
  assert.equal(early.cacheNotYetLoaded,true);
  assert.equal(early.powered,'Powered by RetailNav');
  assert.match(early.font,/Helvetica Neue/);
  console.log('PASS',engine.name(),'logo FIRST PAINT before full application parse');
  await page.waitForFunction(()=>window.RetailNavMapCache?.getState()?.phase==='ready'&&
   window.__RETAILNAV__?.getState()?.ready===true,null,{timeout:70000});
  const count=await page.evaluate(()=>window.__RETAILNAV__.getState().features.length);
  assert.equal(count,3);
  console.log('PASS',engine.name(),'all original Aventura floors after loading');

  const other=await context.newPage();
  await other.goto(base+'?mall=ap-plaza&firstpaint=1',{waitUntil:'commit'});
  await other.waitForFunction(()=>window.RetailNavLoaderBrand?.getState()?.mallId==='ap-plaza'&&
   document.getElementById('mallCatalog')===null,null,{timeout:1300});
  const missing=await other.evaluate(()=>{
   const logo=document.getElementById('rnMapDownloadLogo');
   return {hidden:logo.hidden,name:document.getElementById('rnMapDownloadMall').textContent,
    logoSrc:logo.getAttribute('src')};
  });
  assert.equal(missing.name,'AP Plaza');
  assert.equal(missing.hidden,true);
  assert.equal(missing.logoSrc,null);
  console.log('PASS',engine.name(),'mall without logo shows its name alone');

  // Unavailable assets must never show a broken-image placeholder.
  const failContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await failContext.route('**/branding/aventura-mark.svg',route=>route.abort('failed'));
  const blocked=await failContext.newPage();
  await blocked.goto(base+'?mall=aventura&firstpaint=1',{waitUntil:'commit'});
  await blocked.waitForFunction(()=>window.RetailNavLoaderBrand?.getState()?.source==='unavailable'&&
   document.getElementById('mallCatalog')===null,null,{timeout:1800});
  assert.equal(await blocked.locator('#rnMapDownloadLogo').isVisible(),false);
  assert.equal(await blocked.locator('#rnMapDownloadMall').textContent(),'Aventura Mall');
  console.log('PASS',engine.name(),'broken image is hidden without losing shopping name');
  await failContext.close();
  assert.deepEqual(errors,[]);
  await context.close();
 }finally{await browser.close();}
}
try{
 await checkEngine(chromium);
 if(process.env.RETAILNAV_TEST_WEBKIT==='1')await checkEngine(webkit);
}finally{
 await new Promise(resolve=>server.close(resolve));
}
