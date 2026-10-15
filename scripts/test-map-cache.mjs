import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';

const code=readFileSync('src/map-cache.js','utf8');
const base='https://retailnav.test/retailnav/';
const textBytes=value=>new TextEncoder().encode(JSON.stringify(value));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const oneFloor=(id='LL')=>[[id,'Floor '+id,'reference',[[id+'-1',1,'Shop',[10,10,20,10,20,20],[],[0,1,2],[15,15]]],{w:4,h:4,bits:''}]];
function makeAsset(id,floors,tag='v1'){
 const version=sha(Buffer.from('map:'+id+':'+tag));
 const bundle={schema:'retailnav.map.bundle.v1',mallId:id,version,floors};
 const bytes=textBytes(bundle);
 return {mall:{id,name:'Mall '+id,floorLabels:floors.map(f=>f[0]),mapAsset:{
   url:'maps/malls/'+id+'-'+version+'.json',version,sha256:sha(bytes),bytes:bytes.byteLength,floorCount:floors.length}},
   bytes,version,url:base+'maps/malls/'+id+'-'+version+'.json'};
}
function fakeCache(){
 const entries=new Map;
 return {entries,async match(url){
  const body=entries.get(url);
  return body?new Response(body.slice(0),{status:200,headers:{'Content-Type':'application/json'}}):undefined;
 },async put(url,response){entries.set(url,new Uint8Array(await response.arrayBuffer()));},
 async delete(url){return entries.delete(url);},
 async keys(){return [...entries.keys()].map(url=>({url}));}};
}
function contextFor(asset,{cache=fakeCache(),network=true,mutateFetch,allowCache=true}={}){
 const nodes=new Map();
 for(const id of ['rnMapDownloadScreen','rnMapDownloadMall','rnMapDownloadMessage',
    'rnMapDownloadDetail','rnMapDownloadProgress','rnMapDownloadRetry']){
  nodes.set(id,{hidden:id==='rnMapDownloadRetry',textContent:'',value:0,
    attributes:{},setAttribute(name,value){this.attributes[name]=value;},
    addEventListener(name,handler){this['on'+name]=handler;}});
 }
 const calls=[];
 const fetch=async(url,opts)=>{
  calls.push(url);
  if(mutateFetch)return mutateFetch(url,opts);
  if(!network)throw Error('No connection');
  if(url!==asset.url)throw Error('Unexpected URL '+url);
  return new Response(asset.bytes.slice(0),{status:200,headers:{'Content-Type':'application/json','Content-Length':String(asset.bytes.length)}});
 };
 const window={RETAILNAV_ACTIVE_MALL:asset.mall,RETAILNAV_ACTIVE_MALL_ID:asset.mall.id,
  crypto:webcrypto, ...(allowCache?{caches:{open:async()=>cache}}:{})};
 const document={baseURI:base,getElementById:id=>nodes.get(id)};
 const location={origin:new URL(base).origin,reload(){},href:base+'index.html?mall='+asset.mall.id};
 const errors=[];
 const console={warn(...x){errors.push(['warn',...x]);},error(...x){errors.push(['error',...x]);}};
 vm.runInNewContext(code,{window,document,location,caches:window.caches,crypto:webcrypto,
  console,fetch,URL,Response,TextDecoder,Uint8Array,ArrayBuffer,AbortController,setTimeout,clearTimeout},
  {filename:'map-cache.js',timeout:3000});
 return {controller:window.RetailNavMapCache,cache,nodes,calls,errors};
}

test('cold start loads only selected mall, validates integrity and caches atomically',async()=>{
 const asset=makeAsset('aventura',oneFloor('LL'));
 const v=contextFor(asset);
 const floors=await v.controller.load();
 assert.deepEqual(JSON.parse(JSON.stringify(floors)),asset.bytes&&JSON.parse(Buffer.from(asset.bytes).toString()).floors);
 assert.equal(v.calls.length,1);
 assert.equal(v.cache.entries.has(asset.url),true);
 assert.equal(v.controller.getState().origin,'network');
 assert.equal(v.nodes.get('rnMapDownloadScreen').hidden,false,'overlay must cover incomplete map');
 assert.ok(v.nodes.get('rnMapDownloadProgress').value>=70);
 v.controller.ready();
 assert.equal(v.nodes.get('rnMapDownloadScreen').hidden,true);
 assert.equal(v.controller.getState().phase,'ready');
});

test('same-version cache hit opens without any map network request, including offline',async()=>{
 const asset=makeAsset('aventura',oneFloor('LL'));
 const shared=fakeCache();shared.entries.set(asset.url,asset.bytes);
 const v=contextFor(asset,{cache:shared,network:false});
 await v.controller.load();
 assert.equal(v.controller.getState().origin,'cache');
 assert.equal(v.controller.getState().cacheStatus,'hit');
 assert.equal(v.calls.length,0);
 v.controller.ready();
 assert.equal(v.nodes.get('rnMapDownloadScreen').hidden,true);
});

test('new mall version never opens stale geometry and deletes old version only after successful update',async()=>{
 const old=makeAsset('aventura',oneFloor('LL'),'old');
 const fresh=makeAsset('aventura',oneFloor('LL'),'new');
 const other=makeAsset('ap-plaza',oneFloor('B1'));
 const shared=fakeCache();
 shared.entries.set(old.url,old.bytes);
 shared.entries.set(other.url,other.bytes);
 const v=contextFor(fresh,{cache:shared});
 await v.controller.load();
 assert.equal(v.controller.getState().origin,'network');
 assert.equal(shared.entries.has(old.url),false);
 assert.equal(shared.entries.has(fresh.url),true);
 assert.equal(shared.entries.has(other.url),true,'another mall cache must survive update');
 assert.equal(v.nodes.get('rnMapDownloadScreen').hidden,false,'must hide only after render');
});

test('outdated-version offline does not pretend stale map is the current version',async()=>{
 const old=makeAsset('aventura',oneFloor('LL'),'old');
 const latest=makeAsset('aventura',oneFloor('LL'),'latest');
 const shared=fakeCache();shared.entries.set(old.url,old.bytes);
 const v=contextFor(latest,{cache:shared,network:false});
 await assert.rejects(v.controller.load(),/No connection/);
 assert.equal(v.controller.getState().phase,'error');
 assert.equal(v.nodes.get('rnMapDownloadScreen').hidden,false);
 assert.equal(v.nodes.get('rnMapDownloadRetry').hidden,false);
 assert.equal(shared.entries.has(old.url),true,'do not destroy last valid map on failed download');
});

test('corrupt cached payload triggers download and repairs selected cache',async()=>{
 const asset=makeAsset('aventura',oneFloor('LL'));
 const shared=fakeCache();
 shared.entries.set(asset.url,textBytes({schema:'retailnav.map.bundle.v1',mallId:'evil',version:asset.version,floors:[]}));
 const v=contextFor(asset,{cache:shared});
 await v.controller.load();
 assert.equal(v.controller.getState().origin,'network');
 assert.equal(v.calls.length,1);
 assert.equal(shared.entries.get(asset.url).byteLength,asset.bytes.byteLength);
 assert.equal(v.nodes.get('rnMapDownloadScreen').hidden,false);
});

test('a map from a different shopping is rejected even with syntactically valid geometry',async()=>{
 const actual=makeAsset('aventura',oneFloor('LL'));
 const wrong=makeAsset('ap-plaza',oneFloor('LL'));
 // Bad signature and identity must both be rejected.
 const v=contextFor(actual,{mutateFetch:()=>new Response(wrong.bytes,{status:200})});
 await assert.rejects(v.controller.load(),/descarga no coincide|no corresponde/i);
 assert.equal(v.controller.getState().phase,'error');
 assert.equal(v.cache.entries.size,0);
});

test('invalid floors, interrupted download and unavailable Cache API remain safe',async()=>{
 const bad=makeAsset('aventura',[],'bad');
 const v=contextFor(bad);
 await assert.rejects(v.controller.load(),/plantas incompletas|no corresponde/i);
 assert.equal(v.cache.entries.size,0);
 const a=makeAsset('aventura',oneFloor('LL'));
 const q=contextFor(a,{allowCache:false});
 await q.controller.load();
 assert.equal(q.controller.getState().origin,'network');
 assert.equal(q.controller.getState().cacheStatus,'unknown');
});

test('retry button provides a real navigation retry action',async()=>{
 const a=makeAsset('aventura',oneFloor('LL'));
 const v=contextFor(a,{network:false});
 await assert.rejects(v.controller.load());
 assert.equal(typeof v.nodes.get('rnMapDownloadRetry').onclick,'function');
 assert.equal(v.nodes.get('rnMapDownloadScreen').hidden,false);
});
