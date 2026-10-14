import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';

const fixtureFile='data/malls/new-world-city-shanghai/escalator-fixtures.photo.json';
const doc=JSON.parse(readFileSync(fixtureFile,'utf8'));
const sandbox={window:{}};
runInNewContext(readFileSync('src/escalators3d.js','utf8'),sandbox);
const make=(spacing=4)=>Array.from({length:9},(_,i)=>({
  id:'L'+(i+1),index:i,y:i*spacing
}));
const build=(props={})=>sandbox.window.RetailNavEscalators.build({
  fixtures:doc.fixtures,floors:make(),origin:[688,384],
  scale:.115,spread:4,baseStoreyMetres:4,active:'ALL',
  enabled:true,...props
});
assert.equal(doc.fixtures.length,25);
assert.equal(doc.levelCorrespondenceVerified,false);
assert.equal(doc.entranceExitDetermined,false);
const model=build();
assert.equal(model.stats.banks,25);
assert.equal(model.stats.lanes,49);
assert.equal(model.stats.display,'physical-estimate');
assert.equal(model.stats.navigable,false);
assert.equal(model.stats.landingMappingsVerified,false);
assert.ok(model.stats.triangles>2800);
assert.ok(model.stats.lineSegments>1800);
assert.ok(model.items.every(p=>!p.verified&&!p.entryExitKnown));
assert.ok(model.items.every(p=>p.direction==='unknown'));
assert.ok(model.items.every(p=>p.angleDegrees>=27&&p.angleDegrees<=33));
assert.ok(model.items.every(p=>p.riseMetres===4));
assert.deepEqual([...new Set(model.items.map(p=>p.floor))].sort(),
  ['L1','L2','L3','L4','L5','L6','L7','L8','L9']);
for(const field of [model.faces,model.edges]){
  assert.equal(field.length%10,0);
  assert.ok(field.length>10000);
  assert.ok(field.every(Number.isFinite));
}
const only7=build({active:'L7'});
assert.equal(only7.stats.banks,4);
const off=build({enabled:false});
assert.equal(off.stats.banks,0);
assert.equal(off.faces.length,0);
const heights=[4,4,6,4,4,4,4,4,4],levels=[];
let y=0;
for(let i=0;i<heights.length;i++){
 levels.push({id:'L'+(i+1),index:i,y});
 y+=heights[i];
}
const changed=build({floors:levels});
assert.equal(changed.items.find(x=>x.id==='L3-west').riseMetres,6);
assert.equal(changed.items.find(x=>x.id==='L6-west').riseMetres,4);
const expanded=build({floors:make(26),spread:26});
assert.equal(expanded.stats.display,'exploded-no-cross-floor-stairs');
assert.ok(expanded.items.every(x=>x.riseMetres<=1.2),
  'No cartoonishly long yellow poles between exploded floors');
assert.ok(expanded.stats.triangles>2800);
console.log('PASS: 25 photographed mechanical escalator banks / 49 lanes, 3D treads, bounded physical rise, separate exploded mode');
