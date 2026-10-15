import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {createMallBrandRegistry} from './mall-brands.mjs';

const original=fs.readFileSync('public/branding/aventura-mark.svg');
const sha=crypto.createHash('sha256').update(original).digest('hex');

function fixture(logo=true){
 const dir=fs.mkdtempSync(join(tmpdir(),'retailnav-mall-brands-'));
 fs.mkdirSync(join(dir,'brand-assets'),{recursive:true,mode:0o700});
 if(logo)fs.writeFileSync(join(dir,'brand-assets','aventura-mark.svg'),original);
 return dir;
}
function handler(dir){
 const db=createMallBrandRegistry(dir);
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(!db.handle(req,res,url)){res.writeHead(404);res.end();}
 });
 return {db,server};
}
async function withServer(server,fn){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{return await fn('http://127.0.0.1:'+server.address().port);}
 finally{await new Promise(resolve=>server.close(resolve));}
}
test('official Aventura logo is present with exact checked first-party source',()=>{
 const logo=original.toString('utf8');
 assert.match(logo,/viewBox="0 0 112 69"/);
 assert.match(logo,/#100F0F/);
 assert.match(logo,/^\s*<svg\b/);
 assert.ok(!/<script|<image|javascript:|onload=/i.test(logo));
 assert.equal(sha.length,64);
});

test('starting an isolated server seeds durable JSON mall registry once',()=>{
 const dir=fixture();
 try{
  const one=createMallBrandRegistry(dir);
  const saved=fs.readFileSync(one.dbFile,'utf8');
  const json=JSON.parse(saved);
  assert.equal(json.schema,'retailnav.mall.brands.v1');
  assert.deepEqual(Object.keys(json.records),['aventura']);
  assert.equal(json.records.aventura.logo.sha256,sha);
  assert.equal(json.records.aventura.logo.placement,'left-of-name');
  assert.equal(json.records.aventura.logo.url,'api/mall-brands/aventura/logo.svg');
  assert.equal(json.records.aventura.logo.sourceUrl,
   'https://aventuramall.com/wp-content/uploads/2025/01/logo-2.svg');
  // Redeploy/restart must never erase the database or reassign IDs.
  const two=createMallBrandRegistry(dir);
  assert.equal(fs.readFileSync(two.dbFile,'utf8'),saved);
  assert.ok(two.logo('aventura'));
  assert.equal(two.logo('ap-plaza'),null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('public read-only brand API returns the actual private VPS asset after registration',async()=>{
 const dir=fixture();
 const {server}=handler(dir);
 try{
  await withServer(server,async base=>{
   const response=await fetch(base+'/mall-brands/aventura');
   const data=await response.json();
   assert.equal(response.status,200);
   assert.equal(data.mallId,'aventura');
   assert.equal(data.logo.sha256,sha);
   assert.equal(data.logo.placement,'left-of-name');
   assert.equal(data.logo.assetKind,'symbol');
   const image=await fetch(base+'/mall-brands/aventura/logo.svg');
   const bytes=Buffer.from(await image.arrayBuffer());
   assert.equal(image.status,200);
   assert.equal(image.headers.get('content-type'),'image/svg+xml; charset=utf-8');
   assert.equal(image.headers.get('x-content-type-options'),'nosniff');
   assert.equal(image.headers.get('etag'),'"'+sha+'"');
   assert.deepEqual(bytes,original);
   assert.equal((await fetch(base+'/mall-brands/other')).status,404);
   assert.equal((await fetch(base+'/mall-brands/aventura',{method:'POST'})).status,405);
  });
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('missing, corrupt or modified assets are never published as available',async()=>{
 const dir=fixture(false);
 const {db,server}=handler(dir);
 try{
  assert.equal(fs.existsSync(db.dbFile),false);
  await withServer(server,async base=>{
   assert.equal((await fetch(base+'/mall-brands/aventura')).status,404);
  });
  fs.writeFileSync(join(dir,'brand-assets','aventura-mark.svg'),Buffer.from('<svg>evil</svg>'));
  assert.equal(db.logo('aventura'),null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('an attacker changing the logo bytes cannot spoof the database checksum',async()=>{
 const dir=fixture();
 const {db,server}=handler(dir);
 try{
  const dest=join(dir,'brand-assets','aventura-mark.svg');
  fs.writeFileSync(dest,original.toString('utf8').replace('#100F0F','#201F1F'));
  assert.equal(db.logo('aventura'),null);
  await withServer(server,async base=>{
   assert.equal((await fetch(base+'/mall-brands/aventura/logo.svg')).status,404);
  });
  assert.equal(JSON.parse(fs.readFileSync(db.dbFile,'utf8')).records.aventura.logo.sha256,sha);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
