import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const window={};
const script=readFileSync(new URL('../src/demo-friends.js',import.meta.url),'utf8');
runInNewContext(script,{window});
const friends=window.RETAILNAV_DEMO_CONTACTS;

test('all nine seed contacts use the production-compatible indoor position model',()=>{
  assert.equal(friends.length,9);
  assert.equal(new Set(friends.map(f=>f.id)).size,9);
  assert.equal(new Set(friends.map(f=>f.name)).size,9);
  assert.deepEqual(
    ['LL','UL','L3'].map(floor=>friends.filter(f=>f.position.floor===floor).length),
    [3,3,3]
  );
  for(const friend of friends){
    assert.equal(friend.demo,true);
    assert.equal(friend.position.mallId,'aventura-mall-reference');
    assert.equal(friend.position.source,'mock');
    assert.equal(friend.position.coordinateSpace,'provisional-plan-pixels');
    assert.equal(friend.position.verified,false);
    assert.ok(Number.isFinite(friend.position.x)&&Number.isFinite(friend.position.y));
    assert.match(friend.avatarUrl,/^demo-avatars\/[a-z]+\.jpg$/);
    const jpeg=readFileSync(new URL('../public/'+friend.avatarUrl,import.meta.url));
    assert.equal(jpeg.subarray(0,3).toString('hex'),'ffd8ff','Bundled demo photo is JPEG');
    assert.ok(jpeg.length>8000,'Bundled photo is not a vector drawing');
    assert.match(friend.visual.bodyColor,/^#[0-9a-f]{6}$/i);
    assert.match(friend.visual.shadowColor,/^#[0-9a-f]{6}$/i);
    assert.notEqual(friend.visual.bodyColor,friend.visual.shadowColor);
    assert.match(friend.visual.rimColor,/^#[0-9a-f]{6}$/i);
  }
});
test('each mock friend is placed on an actual corridor from the corresponding Aventura floor map',()=>{
  for(const floorId of ['LL','UL','L3']){
    const floor=JSON.parse(readFileSync(
      new URL('../public/maps/'+floorId+'.json',import.meta.url),'utf8'));
    const corridors=floor.geometry.filter(f=>f[1]===3&&Array.isArray(f[6]));
    assert.ok(corridors.length>=3);
    for(const person of friends.filter(f=>f.position.floor===floorId)){
      assert.ok(corridors.some(f=>
        Math.abs(f[6][0]-person.position.x)<=.051&&
        Math.abs(f[6][1]-person.position.y)<=.051),
        'Corridor-center coordinates missing: '+person.name+' ('+floorId+')');
    }
  }
});
test('mock records remain client-only fixtures with no fabricated GPS',()=>{
  assert.ok(friends.every(f=>!('latitude' in f)&&!('longitude' in f)));
  assert.ok(friends.every(f=>!('session' in f)&&!('cookie' in f)));
  assert.ok(friends.every(f=>Object.isFrozen(f.position)));
});

test('AP Plaza generates six completely independent demo contacts on B1 only',()=>{
  const context={window:{RETAILNAV_ACTIVE_MALL_ID:'ap-plaza'}};
  runInNewContext(script,context);
  const ap=context.window.RETAILNAV_DEMO_CONTACTS;
  assert.equal(ap.length,6);
  assert.ok(ap.every(p=>p.id.startsWith('ap-demo-')));
  assert.ok(ap.every(p=>p.demo===true && p.position.mallId==='ap-plaza-reference'));
  assert.ok(ap.every(p=>p.position.floor==='B1' && p.position.source==='mock'));
  assert.ok(ap.every(p=>!friends.some(a=>a.id===p.id)));
  assert.ok(ap.every(p=>p.avatarUrl.startsWith('demo-avatars/')));
});


test('Aventura source geometry uses only explicit anchors in its own frame',()=>{
 const coordinateSpace='roveiq:107:local-decimeters-v1';
 const anchors=friends.map((p,i)=>({floor:p.position.floor,x:-500+i*250,y:2400+i*125}));
 const context={window:{RETAILNAV_ACTIVE_MALL_ID:'aventura',RETAILNAV_ACTIVE_MALL:{
  id:'aventura',coordinateSpace,demoCorridorAnchors:anchors}}};
 runInNewContext(script,context);
 const source=context.window.RETAILNAV_DEMO_CONTACTS;
 assert.equal(source.length,9);
 source.forEach((p,i)=>{
  assert.equal(p.position.mallId,'aventura');
  assert.equal(p.position.coordinateSpace,coordinateSpace);
  assert.deepEqual([p.position.floor,p.position.x,p.position.y],
   [anchors[i].floor,anchors[i].x,anchors[i].y]);
  assert.equal(p.position.source,'mock');
  assert.equal(p.position.verified,false);
 });
 const empty={window:{RETAILNAV_ACTIVE_MALL_ID:'aventura',RETAILNAV_ACTIVE_MALL:{
  id:'aventura',coordinateSpace}}};
 runInNewContext(script,empty);
 assert.equal(empty.window.RETAILNAV_DEMO_CONTACTS.length,0,
  'Photo fixtures are never silently reused in the source frame');
});
