import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {chromium,webkit} from 'playwright';

const root=resolve('public');
const types={'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8',
 '.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.js':'application/javascript'};
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 if(!path.startsWith('/retailnav/')){res.writeHead(404);res.end();return;}
 const file=resolve(root,path.slice('/retailnav/'.length)||'index.html');
 if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{const bytes=readFileSync(file);res.writeHead(200,{'content-type':types[extname(file)]||
  'application/octet-stream','cache-control':'no-store'});res.end(bytes);}
 catch{res.writeHead(404);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const engine=process.env.BROWSER==='webkit'?'webkit':'chromium';
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,
 args:engine==='webkit'?[]:['--use-gl=angle','--use-angle=swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},hasTouch:false});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/retailnav/api/**',route=>route.fulfill({status:200,
  contentType:'application/json',body:JSON.stringify({me:null,friends:[],incoming:[],outgoing:[]})}));
 const url='http://127.0.0.1:'+server.address().port+'/retailnav/index.html?mall=aventura';
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__RETAILNAV__?.getState().ready,null,{timeout:85000});
 const profile=await page.evaluate(()=>({
  state:window.__RETAILNAV__.getState(),
  dataset:document.documentElement.dataset.inputProfile,
  help:document.querySelector('#rnGestureHelp').textContent,
  aria:document.querySelector('#canvas').getAttribute('aria-label')
 }));
 assert.equal(profile.state.inputProfile,'precision');
 assert.equal(profile.dataset,'precision');
 assert.equal(profile.state.safariTrackpadGestures,true);
 assert.match(profile.help,/Trackpad\/mouse/);
 assert.match(profile.help,/Mayúsculas/);
 assert.match(profile.aria,/trackpad/i);

 const gesture=await page.evaluate(()=>{
  const canvas=document.querySelector('#canvas'),r=canvas.getBoundingClientRect();
  const fire=(target,type,values={})=>{
   const event=new Event(type,{bubbles:true,cancelable:true});
   Object.defineProperties(event,{
    scale:{value:values.scale??1},rotation:{value:values.rotation??0},
    clientX:{value:values.clientX??r.left+r.width/2},
    clientY:{value:values.clientY??r.top+r.height/2}
   });
   const accepted=target.dispatchEvent(event);
   return {accepted,defaultPrevented:event.defaultPrevented};
  };
  const before=window.__RETAILNAV__.getState();
  const start=fire(canvas,'gesturestart');
  const change=fire(canvas,'gesturechange',{scale:1.65,rotation:34});
  const after=window.__RETAILNAV__.getState();
  const end=fire(canvas,'gestureend',{scale:1.65,rotation:34});
  const outside=fire(document.querySelector('.topbar'),'gesturestart');
  return {before,after,start,change,end,outside};
 });
 assert.ok(gesture.after.distance<gesture.before.distance*.75,
  'Mac Safari trackpad pinch must zoom the mall, not the page');
 assert.ok(gesture.after.q.some((value,index)=>Math.abs(value-gesture.before.q[index])>.02),
  'Mac Safari trackpad twist must rotate the 3D camera');
 for(const event of [gesture.start,gesture.change,gesture.end])
  assert.equal(event.defaultPrevented,true,'map GestureEvents remain inside the map');
 assert.equal(gesture.outside.defaultPrevented,false,
  'trackpad gestures outside the map retain normal browser accessibility');

 const shifted=await page.evaluate(()=>{
  const canvas=document.querySelector('#canvas'),r=canvas.getBoundingClientRect();
  const before=window.__RETAILNAV__.getState().orbitPitch;
  canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,shiftKey:true,
   deltaY:180,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));
  return {before,after:window.__RETAILNAV__.getState().orbitPitch};
 });
 assert.ok(Math.abs(shifted.after-shifted.before)>.1,
  'Shift plus two-finger trackpad scroll must provide desktop tilt');
 assert.deepEqual(errors,[]);
 console.log('PASS '+engine+': adaptive Mac trackpad pinch, twist, tilt and precision UI');
}finally{
 await browser.close();
 await new Promise(ok=>server.close(ok));
}
