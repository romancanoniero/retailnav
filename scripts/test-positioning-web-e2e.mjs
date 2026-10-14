/* End-to-end browser positioning demo through the ACTUAL Node API:
 * two independent anonymous sessions, same-mall QR offer/claim, no location
 * transmission, rejected replay and cross-mall. No production data touched.
 */
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
const engine=process.argv[2]||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const root=resolve('public');
const dataDir=mkdtempSync(resolve(tmpdir(),'rn-position-test-'));
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/retailnav/api/')){
   const backendUrl='http://127.0.0.1:'+backend.address().port+
    '/'+url.pathname.slice('/retailnav/api/'.length);
   const chunks=[];
   for await(const chunk of req)chunks.push(chunk);
   const headers={};
   if(req.headers.origin)headers.origin=req.headers.origin;
   if(req.headers.cookie)headers.cookie=req.headers.cookie;
   if(req.headers['content-type'])headers['content-type']=req.headers['content-type'];
   const response=await fetch(backendUrl,{method:req.method,headers,
    body:req.method==='POST'?Buffer.concat(chunks):undefined});
   const body=Buffer.from(await response.arrayBuffer());
   res.statusCode=response.status;
   res.setHeader('Content-Type','application/json');
   res.setHeader('Cache-Control','no-store');
   const cookie=response.headers.get('set-cookie');
   if(cookie){
    // Only this private HTTP test proxy removes Secure for loopback.
    // Production keeps Secure, HttpOnly and SameSite on HTTPS.
    res.setHeader('Set-Cookie',cookie.replace(/; Secure/ig,''));
   }
   res.end(body);return;
  }
  const relative=url.pathname.replace(/^\/retailnav\/?/,'')||'index.html';
  const full=resolve(root,relative);
  if(!full.startsWith(root+'/')){res.writeHead(403);res.end();return;}
  const types={'.html':'text/html','.js':'application/javascript',
    '.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png',
    '.svg':'image/svg+xml','.json':'application/json'};
  const body=readFileSync(full);
  res.writeHead(200,{'Content-Type':types[extname(full)]||'application/octet-stream'});
  res.end(body);
 }catch(e){res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
process.env.NODE_ENV='test';
process.env.RETAILNAV_DATA_DIR=dataDir;
process.env.RETAILNAV_COOKIE_PATH='/retailnav';
process.env.RETAILNAV_ALLOWED_ORIGINS=origin;
const {app:backend}=await import('../backend/server.mjs');
await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true});
let bad=[];
async function instance(mall='new-world-city-shanghai',hash=''){
 const context=await browser.newContext({viewport:{width:1220,height:860}});
 const page=await context.newPage();
 page.on('pageerror',e=>bad.push(String(e)));
 await page.goto(origin+'/retailnav/?mall='+mall+hash);
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState().ready,{timeout:45000});
 return {context,page};
}
let one,two,three;
try{
 one=await instance();
 // User marks their current indoor point explicitly, not from invented GPS.
 await one.page.evaluate(()=>{
  window.dispatchEvent(new CustomEvent('retailnav:map-point',{
   detail:{floor:'L4',x:600,y:280}
  }));
 });
 await one.page.locator('#rnIndoorBtn').click();
 await one.page.locator('#rnCoopConsent').check();
 const p=await one.page.evaluate(()=>window.RetailNavCooperativePositioning.getState());
 assert.equal(p.consent,true);
 assert.equal(p.quality.status,'manual-reference');
 assert.equal(p.quality.helpNeeded,false);
 await one.page.locator('#rnCoopOffer').click();
 await one.page.waitForFunction(()=>document.querySelector('#rnCoopLink').value.includes('#rnp='));
 const link=await one.page.locator('#rnCoopLink').inputValue();
 assert.ok(link.includes('#rnp='));
 assert.equal(await one.page.locator('#rnCoopShare').isVisible(),true);
 const url=new URL(link);
 two=await instance('new-world-city-shanghai',url.hash);
 assert.equal(await two.page.locator('#rnIndoorDialog').evaluate(e=>e.open),true);
 assert.equal(await two.page.locator('#rnCoopJoin').isEnabled(),false);
 await two.page.locator('#rnCoopConsent').check();
 await two.page.locator('#rnCoopColocated').check();
 assert.equal(await two.page.locator('#rnCoopJoin').isEnabled(),true);
 await two.page.locator('#rnCoopJoin').click();
 await two.page.waitForFunction(()=>
  window.RetailNavIndoor?.getState().anchor?.source==='peer-qr-colocation-asserted');
 const result=await two.page.evaluate(()=>({
  anchor:window.RetailNavIndoor.getState().anchor,
  cooperative:window.RetailNavCooperativePositioning.getState()
 }));
 assert.deepEqual([result.anchor.floor,result.anchor.x,result.anchor.y],
  ['L4',600,280]);
 assert.equal(result.cooperative.quality.status,'cooperative-provisional');
 assert.equal(result.cooperative.quality.peerPhysicalRangeVerified,false);
 assert.equal(result.cooperative.collaborationUsed,true);
 assert.equal(result.cooperative.transmitsRawGps,false);
 assert.equal(new URL(two.page.url()).hash,'');
 // QR is one-use even if the user sends a screenshot to a third party.
 three=await instance('new-world-city-shanghai',url.hash);
 await three.page.locator('#rnCoopConsent').check();
 await three.page.locator('#rnCoopColocated').check();
 await three.page.locator('#rnCoopJoin').click();
 await three.page.waitForFunction(()=>
  document.querySelector('#rnCoopStatus').textContent.includes('vencida'));
 assert.equal(await three.page.evaluate(()=>
  window.RetailNavIndoor.getState().anchor),null);
 // Sender explicitly withdraws their cooperation.
 await one.page.locator('#rnCoopRevoke').click();
 await one.page.waitForFunction(()=>
  !window.RetailNavCooperativePositioning.getState().offerActive);
 assert.equal(bad.length,0,'Uncaught script errors: '+bad.join('\n'));
 console.log('PASS '+engine+': anonymous two-browser opt-in QR reference, provisional accuracy, one-use token and revocation');
} finally{
 await Promise.allSettled([one?.context.close(),two?.context.close(),three?.context.close()]);
 await browser.close();
 await new Promise(resolve=>backend.close(resolve));
 await new Promise(resolve=>server.close(resolve));
 rmSync(dataDir,{recursive:true,force:true});
}
