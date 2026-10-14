import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {extname,resolve} from 'node:path';

// A same-origin fixture reproduces the iPhone/Safari app surface rather than
// using file://, which blocks avatar textures in WebGL.
const engine=process.argv[2]||'chromium';
assert.ok(['webkit','chromium'].includes(engine));
const root=resolve('public');
const server=createServer((req,res)=>{
  try {
    const path=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    const file=resolve(root,decodeURIComponent(path));
    if(!file.startsWith(root+'/')){res.writeHead(403);res.end();return;}
    const bytes=readFileSync(file);
    const mime={'.js':'text/javascript','.html':'text/html','.json':'application/json',
      '.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});
    res.end(bytes);
  }catch{
    if(!res.headersSent)res.writeHead(404);
    res.end();
  }
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true});
const context=await browser.newContext({
  viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2,
  locale:'es-AR'
});
const page=await context.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:'+server.address().port+
    '/index.html?mall=new-world-city-shanghai',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__RETAILNAV__?.getState().ready,
    null,{timeout:45000});
  const summary=await page.evaluate(()=>{
    const viewport=document.querySelector('.stage .viewport');
    const canvas=document.querySelector('#canvas');
    const label=document.querySelector('.stage .rnUnitOverlay');
    const outside=document.querySelector('.topbar');
    const search=document.querySelector('.stage .rnMapSearch');
    const meta=document.querySelector('meta[name=viewport]').content;
    const getStyle=el=>getComputedStyle(el).touchAction;

    const event=(target,type)=> {
      const gesture=new Event(type,{bubbles:true,cancelable:true});
      target.dispatchEvent(gesture);
      return gesture.defaultPrevented;
    };
    const nativeGuard={
      start:event(viewport,'gesturestart'),
      change:event(label,'gesturechange'),
      end:event(canvas,'gestureend'),
      outside:event(outside,'gesturestart'),
      inSearch:event(search,'gesturestart')
    };

    // Use synthetic native touch events to exercise iOS 13-16 fallback logic:
    // cancel two map touches but never cancel a pinch from the masthead.
    function touch(type,target,ids){
      const e=new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperty(e,'changedTouches',{value:ids.map(identifier=>({identifier}))});
      Object.defineProperty(e,'touches',{value:ids.map(identifier=>({identifier}))});
      target.dispatchEvent(e);return e.defaultPrevented;
    }
    touch('touchstart',viewport,[7,8]);
    const mapMoveCancelled=touch('touchmove',viewport,[7,8]);
    touch('touchend',viewport,[7,8]);
    const elsewhere=touch('touchmove',outside,[11,12]);

    const barBefore=outside.getBoundingClientRect(),searchBefore=search.getBoundingClientRect();
    const viewBefore=window.visualViewport?.scale??1;
    const mapBefore=window.__RETAILNAV__.getState().distance;
    const r=canvas.getBoundingClientRect();
    const x=r.left+r.width/2,y=r.top+r.height/2;
    const pointer=(type,id,dx,dy)=>{
      canvas.dispatchEvent(new PointerEvent(type,{
        bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,button:0,
        buttons:type==='pointerup'?0:1,clientX:x+dx,clientY:y+dy
      }));
    };
    pointer('pointerdown',91,-40,0);
    pointer('pointerdown',92,40,0);
    pointer('pointermove',91,-100,0);
    pointer('pointermove',92,100,0);
    const mapAfter=window.__RETAILNAV__.getState().distance;
    pointer('pointerup',92,100,0);
    pointer('pointerup',91,-100,0);
    const viewAfter=window.visualViewport?.scale??1;
    const barAfter=outside.getBoundingClientRect(),searchAfter=search.getBoundingClientRect();

    return {nativeGuard,mapMoveCancelled,elsewhere,meta,
      styles:{viewport:getStyle(viewport),canvas:getStyle(canvas),
        labels:getStyle(label),pin:getStyle(document.querySelector('.rnPinCanvas')),
        search:getStyle(search)},
      mapBefore,mapAfter,viewBefore,viewAfter,
      topbarWidthDelta:barAfter.width-barBefore.width,
      searchWidthDelta:searchAfter.width-searchBefore.width};
  });
  assert.equal(summary.nativeGuard.start,true,'Suppress native Safari pinch in map');
  assert.equal(summary.nativeGuard.change,true,'Overlay pinch must stay inside map');
  assert.equal(summary.nativeGuard.end,true,'Suppress native gesture end');
  assert.equal(summary.nativeGuard.outside,false,'Allow normal page zoom outside map');
  assert.equal(summary.nativeGuard.inSearch,false,'Search stays editable/accessible');
  assert.equal(summary.mapMoveCancelled,true,'Cancel two-finger native touch move');
  assert.equal(summary.elsewhere,false,'Do not cancel unrelated two-finger touch');
  assert.ok(summary.styles.viewport==='none','Viewport touch-action none');
  assert.ok(summary.styles.canvas==='none','WebGL canvas touch-action none');
  assert.ok(summary.styles.labels==='none','Overlay touch-action none');
  assert.ok(summary.styles.pin==='none','Avatar overlay cannot leak page pinch');
  assert.notEqual(summary.styles.search,'none','Search remains native accessible input');
  assert.ok(!/user-scalable\s*=\s*no|max(?:imum)?-scale\s*=\s*1\b/i.test(summary.meta),
    'Never disable user page zoom globally');
  assert.ok(summary.mapAfter<summary.mapBefore*.75,
    'Two-finger pinch-out zooms ONLY the 3D map');
  assert.ok(Math.abs(summary.viewBefore-summary.viewAfter)<.00001,
    'Browser visual viewport scale must not change');
  assert.ok(Math.abs(summary.topbarWidthDelta)<.01,'Page header must not resize');
  assert.ok(Math.abs(summary.searchWidthDelta)<.01,'Search bar must not resize');
  assert.deepEqual(errors,[],errors.join('\n'));
  console.log('PASS',engine,'native Safari gesture guard and isolated 3D pinch zoom',summary);
}finally{
  await context.close();
  await browser.close();
  await new Promise(done=>server.close(done));
}
