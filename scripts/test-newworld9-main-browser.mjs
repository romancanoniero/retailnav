import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:840}});
const exceptions=[];
page.on('pageerror',e=>exceptions.push(String(e)));
try {
  await page.goto('file://'+resolve('public/index.html')+'?mall=new-world-city-shanghai');
  await page.waitForFunction(()=>window.__RETAILNAV__?.getState().ready, {timeout:45000});
  let state=await page.evaluate(()=>window.__RETAILNAV__.getState());
  assert.equal(state.mallId,'new-world-city-shanghai');
  assert.equal(state.features.length,9,'RetailNav must display NINE floors, not seven');
  assert.deepEqual(state.features.map(f=>f[0]),['L1','L2','L3','L4','L5','L6','L7','L8','L9']);
  assert.equal(state.features.reduce((sum,f)=>sum+f[1],0),737);
  assert.ok(await page.locator('#mallHeaderName').innerText().then(t=>t.includes('新世界城')));
  assert.equal(await page.locator('#floorSelect option').count(),10);
  assert.equal(await page.evaluate(()=>window.RetailNavPOI.getState().count),110);
  assert.ok(await page.evaluate(()=>window.RetailNavUnits.getState().count)>=380);
  const mall=await page.evaluate(()=>window.RETAILNAV_ACTIVE_MALL);
  assert.equal(mall.navigable,false);
  assert.equal(mall.floorAlignmentApproved,false);
  assert.equal(mall.floorReferences.L8.imageSize[0],1376);
  await page.locator('#floorSelect').selectOption('L8');
  await page.waitForFunction(()=>window.__RETAILNAV__?.getState().active==='L8');
  await page.locator('#original').click();
  await page.waitForFunction(()=>document.getElementById('compareDialog').open);
  await page.locator('#compareLevel').selectOption('L9');
  await page.waitForFunction(()=>document.getElementById('referenceImage').getAttribute('href')?.includes('L9.webp'));
  await page.screenshot({path:'/tmp/retailnav-newworld9-main.png'});
  assert.deepEqual(exceptions,[],exceptions.join('\n'));
  console.log('PASS main RetailNav New World City L1–L9 map / photo comparison / POIs');
}finally {
  await browser.close();
}
