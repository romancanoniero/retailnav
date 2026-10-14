import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1320,height:820}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try{
  await page.goto('file://'+resolve('public/newworld9/index.html'));
  await page.waitForFunction(()=>window.__NWC9__?.getState().ready);
  let s=await page.evaluate(()=>window.__NWC9__.getState());
  assert.equal(s.floors,9);assert.equal(s.regions,737);
  await page.getByRole('button',{name:'L7',exact:true}).click();
  await page.getByRole('button',{name:'2D',exact:true}).click();
  await page.getByRole('button',{name:'Ver fotografía original'}).click();
  s=await page.evaluate(()=>window.__NWC9__.getState());
  assert.equal(s.currentFloor,'L7');assert.equal(s.mode,'2D');
  await page.screenshot({path:'/tmp/nwc9-L7-2d.png'});
  await page.getByRole('button',{name:'9 plantas'}).click();
  s=await page.evaluate(()=>window.__NWC9__.getState());
  assert.equal(s.currentFloor,'ALL');assert.equal(s.mode,'3D');
  await page.screenshot({path:'/tmp/nwc9-nine-3d.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS New World City nine-floor browser interactive controls');
}finally{await browser.close()}
