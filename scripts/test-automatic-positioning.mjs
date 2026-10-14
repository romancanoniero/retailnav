/* Automatic GPS startup, permission, no-survey floor confidence and opt-out.
 * Reproduces live Chromium/WebKit geolocation without physical GPS hardware.
 */
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {once} from 'node:events';
const engine=process.argv[2]||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true});
const root=resolve('public');
const server=createServer((req,res)=>{
 try{
  const p=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  const full=resolve(root,p);
  if(!full.startsWith(root+'/')){res.writeHead(403);res.end();return;}
  const body=readFileSync(full);
  const types={'.html':'text/html','.js':'application/javascript','.webp':'image/webp'};
  res.writeHead(200,{'Content-Type':types[extname(full)]||'application/octet-stream'});
  res.end(body);
 }catch{res.writeHead(404);res.end();}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
const errors=[];
let ctx=null,denied=null,absent=null;
try{
 ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,
  hasTouch:true,permissions:['geolocation'],
  geolocation:{latitude:25.957060,longitude:-80.142750,accuracy:11}});
 const page=await ctx.newPage();
 page.on('pageerror',e=>errors.push('granted: '+String(e)));
 await page.goto(base+'/index.html?mall=aventura');
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState().ready&&
  window.RetailNavIndoor?.getState().gpsStatus==='active',{timeout:30000});
 const first=await page.evaluate(()=>({
  indoor:window.RetailNavIndoor.getState(),
  badge:document.querySelector('#rnAutoLocationStatus')?.textContent,
  badgeState:document.querySelector('#rnAutoLocationStatus')?.dataset.state,
  dialogOpen:document.querySelector('#rnIndoorDialog')?.open,
  indoorPinHidden:document.querySelector('#rnMyPositionMarker')?.hidden
 }));
 assert.equal(first.indoor.gpsStartedAutomatically,true);
 assert.equal(first.indoor.gpsLatitude,25.957060);
 assert.equal(first.indoor.gpsLongitude,-80.142750);
 assert.equal(first.indoor.gpsAccuracyM,11);
 assert.equal(first.indoor.anchor,null,
  'Do not invent photo-mall pixel position from approximate outdoor GPS');
 assert.equal(first.indoorPinHidden,true);
 assert.ok(first.badge.includes('Piso sin determinar'),first.badge);
 assert.equal(first.dialogOpen,false,'Autolocation must not open modal UI');
 assert.equal(first.badgeState,'located');
 await page.locator('#rnIndoorBtn').click();
 const detail=await page.locator('#rnIndoorStatus').innerText();
 assert.ok(detail.includes('25.957060')&&detail.includes('-80.142750'));
 assert.ok(detail.includes('±11 m'));
 await page.locator('#rnIndoorResetBtn').click();
 const stopped=await page.evaluate(()=>window.RetailNavIndoor.getState());
 assert.equal(stopped.gpsManuallyStopped,true);
 assert.equal(stopped.gpsStatus,'stopped');
 assert.equal(stopped.gpsLatitude,null);
 assert.equal(await page.locator('#rnAutoLocationStatus').innerText(),'Ubicación detenida');
 await ctx.setGeolocation({latitude:25.965,longitude:-80.151,accuracy:7});
 await page.waitForTimeout(150);
 assert.equal((await page.evaluate(()=>window.RetailNavIndoor.getState())).gpsLatitude,null,
  'The stop control must not restart GPS automatically');
 await page.locator('#rnGPSBtn').click();
 await page.waitForFunction(()=>window.RetailNavIndoor.getState().gpsStatus==='active');
 assert.equal((await page.evaluate(()=>window.RetailNavIndoor.getState())).gpsLatitude,25.965);
 await page.close();

 // Simulated browser denial: a denial must not crash or force a bogus dot.
 denied=await browser.newContext();
 await denied.addInitScript(()=>{
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
   watchPosition(success,error){error({code:1,message:'Permission denied'});return 1;},
   clearWatch(){}
  }});
 });
 const deniedPage=await denied.newPage();
 deniedPage.on('pageerror',e=>errors.push('denied: '+String(e)));
 await deniedPage.goto(base+'/index.html?mall=aventura');
 await deniedPage.waitForFunction(()=>window.RetailNavIndoor?.getState().gpsStatus==='denied');
 const noPermission=await deniedPage.evaluate(()=>({
  state:window.RetailNavIndoor.getState(),status:
  document.getElementById('rnAutoLocationStatus').textContent
 }));
 assert.equal(noPermission.state.anchor,null);
 assert.ok(noPermission.status.includes('no autorizada'));
 assert.equal(noPermission.state.gpsStartedAutomatically,true);
 await deniedPage.close();

 // No hardware/browser geolocation: manual map placement is still usable.
 absent=await browser.newContext();
 await absent.addInitScript(()=>{
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:undefined});
 });
 const missingPage=await absent.newPage();
 missingPage.on('pageerror',e=>errors.push('absent: '+String(e)));
 await missingPage.goto(base+'/index.html?mall=aventura');
 await missingPage.waitForFunction(()=>window.RetailNavIndoor?.getState().gpsStatus==='unavailable');
 assert.equal((await missingPage.evaluate(()=>window.RetailNavIndoor.getState())).anchor,null);
 assert.ok(await missingPage.locator('#rnAutoLocationStatus').innerText().then(x=>
  x.includes('GPS no disponible')));
 await missingPage.close();
 assert.deepEqual(errors,[]);
 console.log('PASS '+engine+': automatic GPS without button, live map status, no fake indoor floor, denied/no-hardware fallback and explicit stop/retry');
}finally{
 await Promise.allSettled([ctx?.close(),denied?.close(),absent?.close()]);
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
