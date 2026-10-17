import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,join,extname,sep} from 'node:path';
import {chromium} from 'playwright';

const root=resolve('public');
const mimes={'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8',
 '.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.css':'text/css'};
const server=createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 const name=u.pathname.replace(/^\/retailnav\/?/,'')||'index.html';
 const file=resolve(root,name);
 if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{
  const raw=readFileSync(file);
  res.writeHead(200,{'Content-Type':mimes[extname(file)]||'application/octet-stream',
   'Content-Length':raw.length,'Cache-Control':'no-store'});
  res.end(raw);
 }catch(e){res.writeHead(404);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const url='http://127.0.0.1:'+server.address().port+'/retailnav/index.html';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
 const page=await ctx.newPage();
 let pageErrors=[];
 page.on('pageerror',e=>pageErrors.push(e.message));
 async function waitReady(slug){
  await page.waitForFunction(()=>window.__RETAILNAV__?.getState()?.ready===true&&
   window.RetailNavMapCache?.getState().phase==='ready',null,{timeout:70000});
  const state=await page.evaluate(()=>window.__RETAILNAV__.getState());
  assert.equal(state.mallId,slug);
  assert.equal(state.errors.length,0);
  return state;
 }
 await page.goto(url+'?mall=aventura',{waitUntil:'domcontentloaded',timeout:30000});
 const s=await waitReady('aventura');
 assert.equal(s.features.length,3,'all original Aventura floors remain');
 assert.equal(s.mapTheme.origin,'published');
 assert.equal(s.mapTheme.theme.mapUnit,'#CDB99E');
 assert.equal(await page.evaluate(()=>document.body.classList.contains('rnThemeEnabled')),true);
 const logo=await page.locator('#mallHeaderLogo').evaluate(el=>({
  src:el.getAttribute('src'),hidden:el.hidden,loaded:el.complete&&el.naturalWidth>0}));
 assert.equal(logo.hidden,false);
 assert.equal(logo.loaded,true);
 assert.ok(logo.src.endsWith('/branding/aventura-mark.svg'),
  'the compact header uses the configured symbol to the left of the mall name');
 const bg=await page.locator('.stage').evaluate(el=>getComputedStyle(el).backgroundImage);
 assert.ok(bg.includes('radial-gradient'));
 const before=await page.evaluate(()=>({
  flat:window.__RETAILNAV__.floors.map(f=>f.features.map(a=>[a.id,a.p.length])),
  gl:window.__RETAILNAV__.getState().renderer,
  color:window.RetailNavThemes.color('mapUnit'),
  floors:window.__RETAILNAV__.floors.map(f=>f.id)
 }));
 assert.equal(before.color,'#CDB99E');
 console.log('PASS Aventura source logo and three-floor branded map');

 await page.locator('#mallSettingsBtn').click();
 await page.locator('#rnPaletteOptions summary').click();
 await page.locator('#rnPaletteColor-mapUnit').fill('#273645');
 await page.waitForFunction(()=>window.RetailNavThemes.getState().theme.mapUnit==='#273645');
 await page.waitForTimeout(700);
 const changed=await page.evaluate(()=>({
  flat:window.__RETAILNAV__.floors.map(f=>f.features.map(a=>[a.id,a.p.length])),
  state:window.RetailNavThemes.getState(),
  gl:window.__RETAILNAV__.getState().renderer
 }));
 assert.equal(changed.state.mode,'custom');
 assert.equal(JSON.stringify(changed.flat),JSON.stringify(before.flat),'color changes cannot deform polygons');
 assert.equal(changed.gl,before.gl,'renderer mode must survive');
 await page.locator('#rnPaletteSave').click();
 assert.equal(await page.evaluate(()=>window.RetailNavThemes.getState().origin),'preview');
 await page.locator('#mallSettingsClose').click();
 await page.reload({waitUntil:'domcontentloaded',timeout:30000});
 const updated=await waitReady('aventura');
 assert.equal(updated.mapTheme.theme.mapUnit,'#273645','preview persisted locally');
 assert.equal(updated.features.length,3);
 console.log('PASS per-device color editing, on-map redraw and preservation after reload');

 await page.goto(url+'?mall=ap-plaza',{waitUntil:'domcontentloaded',timeout:30000});
 const ap=await waitReady('ap-plaza');
 assert.equal(ap.features.length,1);
 assert.equal(ap.mapTheme.enabled,false,'other shopping must keep its original dark UI');
 assert.equal(ap.mapTheme.origin,'classic');
 assert.equal(await page.evaluate(()=>document.body.classList.contains('rnThemeEnabled')),false);
 console.log('PASS per-mall tenant isolation and unchanged AP Plaza palette');

 await page.goto(url+'?mall=aventura',{waitUntil:'domcontentloaded',timeout:30000});
 await waitReady('aventura');
 await page.locator('#mallSettingsBtn').click();
 await page.locator('#rnPaletteOptions summary').click();
 await page.locator('#rnPaletteReset').click();
 assert.equal(await page.evaluate(()=>window.RetailNavThemes.getState().theme.mapUnit),'#CDB99E');
 assert.equal(await page.evaluate(()=>window.RetailNavThemes.getState().origin),'published');
 console.log('PASS restore official default Aventura palette');

 assert.deepEqual(pageErrors,[]);
}finally{
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
