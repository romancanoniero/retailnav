import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,join,extname,sep} from 'node:path';
import {chromium} from 'playwright';

const root=resolve('public');
const svg=readFileSync(join(root,'branding/aventura-mark.svg'));
const sha=crypto.createHash('sha256').update(svg).digest('hex');
const types={'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8',
 '.svg':'image/svg+xml;charset=utf-8','.webp':'image/webp','.png':'image/png'};
let serveDb=true;
const server=createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 if(!u.pathname.startsWith('/retailnav/')){res.writeHead(404);return res.end();}
 const pathname=u.pathname.slice('/retailnav/'.length);
 if(pathname==='api/mall-brands/aventura'&&serveDb){
  const obj={mallId:'aventura',mallName:'Aventura Mall',available:true,
   logo:{url:'api/mall-brands/aventura/logo.svg',mime:'image/svg+xml',
    sha256:sha,assetKind:'symbol',placement:'left-of-name',
    sourceUrl:'https://aventuramall.com/wp-content/uploads/2025/01/logo-2.svg'}};
  const raw=Buffer.from(JSON.stringify(obj));
  res.writeHead(200,{'content-type':'application/json','content-length':raw.length});return res.end(raw);
 }
 if(pathname==='api/mall-brands/aventura/logo.svg'&&serveDb){
  res.writeHead(200,{'content-type':'image/svg+xml','content-length':svg.length});return res.end(svg);
 }
 const file=resolve(root,pathname||'index.html');
 if(!file.startsWith(root+sep)){res.writeHead(403);return res.end();}
 try{
  const raw=readFileSync(file);
  res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream',
   'content-length':raw.length,'cache-control':'no-store'});
  return res.end(raw);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port+'/retailnav/index.html';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},
  deviceScaleFactor:1,isMobile:true,hasTouch:true});
 const page=await ctx.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'?mall=aventura',{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>window.RETAILNAV_BRAND_STATUS?.databaseRegistered===true,
  null,{timeout:30000});
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState().ready===true,null,{timeout:70000});
 const state=await page.evaluate(()=>{
  const image=document.getElementById('mallHeaderLogo');
  const name=document.getElementById('mallHeaderName');
  const a=image.getBoundingClientRect(),b=name.getBoundingClientRect();
  return {
   name:name.textContent,
   nameHidden:getComputedStyle(name).display==='none',
   logoVisible:!image.hidden&&image.complete&&image.naturalWidth>0,
   logoSrc:image.getAttribute('src'),
   imageLeft:a.left,imageRight:a.right,titleLeft:b.left,titleRight:b.right,
   parentChildren:[...name.parentElement.children].map(x=>x.id),
   status:window.RETAILNAV_BRAND_STATUS,
   floorCount:window.__RETAILNAV__.floors.length,
   mallNameComputedColor:getComputedStyle(name).color,
   mallNameTheme:window.RetailNavThemes.getState()
  };
 });
 assert.equal(state.name,'Aventura Mall');
 assert.equal(state.nameHidden,false);
 assert.equal(state.logoVisible,true);
 assert.equal(state.status.source,'database');
 assert.equal(state.status.databaseRegistered,true);
 assert.equal(state.floorCount,3);
 assert.equal(state.mallNameComputedColor,'rgb(16, 15, 15)',
  'Aventura name must be a dark, strong brand accent on its ivory header');
 assert.equal(state.mallNameTheme.mallNameColor,'#100F0F');
 assert.ok(state.mallNameTheme.mallNameContrast>=4.5);
 assert.deepEqual(state.parentChildren,['mallHeaderLogo','mallHeaderName']);
 assert.ok(state.imageRight<=state.titleLeft+2,'logo must be on LEFT of name');
 assert.match(state.logoSrc,/api\/mall-brands\/aventura\/logo\.svg$/);
 const loadingLogo=await page.locator('#rnMapDownloadLogo').evaluate(el=>({
  url:el.getAttribute('src'),loaded:el.complete&&el.naturalWidth>0,hidden:el.hidden
 }));
 assert.equal(loadingLogo.hidden,false);
 assert.equal(loadingLogo.loaded,true);
 assert.match(loadingLogo.url,/api\/mall-brands\/aventura\/logo\.svg$/);
 const loaderFont=await page.locator('#rnMapDownloadMall').evaluate(el=>getComputedStyle(el).fontFamily);
 assert.match(loaderFont,/Helvetica Neue/,'Aventura default typography should apply even to white loading screen');
 console.log('PASS registered logo from persistent JSON database to left of Aventura Mall');

 await page.locator('#mallSettingsBtn').click();
 await page.locator('#rnPaletteOptions summary').click();
 await page.locator('#rnPaletteColor-accent').fill('#ffffff');
 await page.waitForFunction(()=>getComputedStyle(document.getElementById('mallHeaderName')).color==='rgb(23, 21, 15)');
 assert.ok((await page.evaluate(()=>window.RetailNavThemes.getState().mallNameContrast))>=4.5);
 await page.locator('#rnPaletteReset').click();
 await page.waitForFunction(()=>getComputedStyle(document.getElementById('mallHeaderName')).color==='rgb(16, 15, 15)');
 await page.locator('#mallSettingsClose').click();
 console.log('PASS title follows branded swatches and remains readable after local preview changes');
 await page.locator('#mallSettingsBtn').click();
 if(!await page.locator('#rnPaletteOptions').evaluate(el=>el.open))
  await page.locator('#rnPaletteOptions summary').click();
 await page.locator('#rnTypographyPreset').selectOption('rounded');
 await page.waitForFunction(()=>{
  const font=window.RetailNavThemes?.getState()?.theme?.font;
  return font==='rounded'&&
   ['mallHeaderName','rnMapDownloadMall','search','mallSettingsTitle'].every(id=>
    getComputedStyle(document.getElementById(id)).fontFamily.includes('Trebuchet MS'));
 });
 await page.locator('#rnPaletteSave').click();
 await page.locator('#mallSettingsClose').click();
 const fontAfter=await page.evaluate(()=>window.RetailNavThemes.getState().theme.font);
 assert.equal(fontAfter,'rounded');
 const stateAfterFont=await page.evaluate(()=>window.__RETAILNAV__.getState());
 assert.equal(stateAfterFont.ready,true);
 assert.equal(stateAfterFont.features.length,3);
 console.log('PASS selected shopping typography affects header, loader, search and dialogs without altering map');

 // API failure must NOT prevent maps or hide the mall name.
 serveDb=false;
 const other=await browser.newContext({viewport:{width:390,height:844},
  deviceScaleFactor:1,isMobile:true,hasTouch:true});
 const fallback=await other.newPage();
 await fallback.goto(origin+'?mall=aventura',{waitUntil:'domcontentloaded',timeout:45000});
 await fallback.waitForFunction(()=>window.RETAILNAV_BRAND_STATUS?.visible===true,null,{timeout:20000});
 assert.equal(await fallback.evaluate(()=>window.RETAILNAV_BRAND_STATUS.source),'static');
 const logo=await fallback.locator('#mallHeaderLogo').evaluate(el=>({
  hidden:el.hidden,complete:el.complete,src:el.getAttribute('src')
 }));
 assert.equal(logo.hidden,false);
 assert.equal(logo.complete,true);
 assert.match(logo.src,/branding\/aventura-mark\.svg$/);
 const fallbackLoading=await fallback.locator('#rnMapDownloadLogo').evaluate(el=>({
  hidden:el.hidden,src:el.getAttribute('src'),loaded:el.complete&&el.naturalWidth>0
 }));
 assert.equal(fallbackLoading.hidden,false);
 assert.equal(fallbackLoading.loaded,true);
 assert.match(fallbackLoading.src,/branding\/aventura-mark\.svg$/);
 console.log('PASS approved static logo fallback while API is unavailable');

 await page.goto(origin+'?mall=ap-plaza',{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState().ready===true,null,{timeout:70000});
 const alternate=await page.evaluate(()=>({
  logo:document.getElementById('mallHeaderLogo').hidden,
  name:document.getElementById('mallHeaderName').textContent,
  nameColor:getComputedStyle(document.getElementById('mallHeaderName')).color,
  theme:window.RetailNavThemes.getState()
 }));
 assert.equal(alternate.name,'AP Plaza');
 assert.equal(alternate.logo,true);
 assert.equal(alternate.nameColor,'rgb(101, 230, 224)');
 assert.equal(alternate.theme.mallNameColor,'#65E6E0');
 assert.equal(alternate.theme.theme.font,'modern');
 assert.match(await page.locator('#mallHeaderName').evaluate(el=>getComputedStyle(el).fontFamily),
  /Segoe UI/);
 assert.equal(await page.locator('#rnMapDownloadLogo').isVisible(),false);
 assert.ok(alternate.theme.mallNameContrast>=4.5);
 assert.deepEqual(errors,[]);
 console.log('PASS mall isolation (other shops unchanged)');
 await other.close();
}finally{
 await browser.close();
 await new Promise(ok=>server.close(ok));
}
