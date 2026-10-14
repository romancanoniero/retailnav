import {readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {inflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
const base='public/newworld9';
const source=readFileSync(join(base,'data.js'),'utf8');
const found=source.match(/^window\.__NWC9_MODEL_B64="([A-Za-z0-9+/=]+)";\s*$/);
assert.ok(found,'compressed NWC data payload must exist');
const data=JSON.parse(inflateSync(Buffer.from(found[1],'base64')));
assert.equal(data.navigationEnabled,false);
assert.equal(data.levels.length,9);
let count=0,shop=0,labels=0;
const ids=new Set();
for(const [index,floor] of data.levels.entries()){
  assert.equal(floor.floor,'L'+(index+1));
  const image=readFileSync(join(base,floor.photo));
  assert.equal(image.toString('ascii',0,4),'RIFF');
  assert.equal(image.toString('ascii',8,12),'WEBP');
  assert.ok(image.length>20000);
  for(const polygon of floor.regions){
    assert.ok(!ids.has(polygon.id),'duplicate polygon '+polygon.id);
    ids.add(polygon.id);
    assert.ok(polygon.path.length>=3);
    assert.ok(polygon.path.every(p=>p.length===2&&p.every(Number.isFinite)));
    assert.ok(polygon.kind);
    count++;shop+=Number(polygon.kind==='shop');labels+=Number(Boolean(polygon.label));
  }
}
assert.equal(count,737);
assert.equal(shop,627);
assert.ok(labels>=80);
assert.ok(data.verticalConnectionHypotheses.length>20);
assert.ok(data.verticalConnectionHypotheses.every(e=>e.status.includes('NOT VERIFIED')));
assert.ok(statSync(join(base,'index.html')).size>4000);
console.log('PASS nine-floor model',count,'regions',shop,'store candidates',labels,'visible codes');
