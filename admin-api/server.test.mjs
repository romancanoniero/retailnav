import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createAdminApp} from './server.mjs';

const dir=mkdtempSync(path.join(tmpdir(),'retailnav-admin-'));
const state=path.join(dir,'state'),catalog=path.join(dir,'catalog');
mkdirSync(path.join(catalog,'demo-mall'),{recursive:true});
writeFileSync(path.join(catalog,'demo-mall','mall.json'),JSON.stringify({id:'demo-mall',name:'Demo Mall',status:'vectorizado-provisional',navigable:false,
 floors:[{id:'PB',name:'Baja',imageSize:[400,400],geometry:'PB.geometry.zlib.b64'},{id:'P1',name:'Uno',imageSize:[400,400],geometry:'P1.geometry.zlib.b64'}]}));
const seed='JBSWY3DPEHPK3PXP';
const origin='https://improvingyourreality.com';
const app=createAdminApp({dataDir:state,catalogDir:catalog,origins:origin,
 bootstrap:{email:'owner@example.test',password:'test-password-123456!',totp:seed}});
await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+app.address().port;
function totp(now=Date.now()){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let val=0,bits=0,out=[];
 for(const c of seed){val=(val<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){out.push((val>>>(bits-8))&255);bits-=8}}
 const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(Math.floor(now/30000)));
 const h=crypto.createHmac('sha1',Buffer.from(out)).update(b).digest(),i=h.at(-1)&15;
 return String((h.readUInt32BE(i)&0x7fffffff)%1000000).padStart(6,'0');}
let csrf='',cookie='',ownerId='',tenant='';
async function api(p,method='GET',body,auth=true,extra={}){
 const headers={Origin:origin,...extra};if(method!=='GET')headers['Content-Type']='application/json';
 if(auth&&csrf)headers['X-Retailnav-Csrf']=csrf;
 if(auth&&cookie)headers.Cookie=cookie;
 const r=await fetch(base+p,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 let d=await r.json();return {status:r.status,body:d,setCookie:r.headers.get('set-cookie')};}
test('admin remains isolated and unauthenticated is rejected',async()=>{
 assert.equal((await api('/health')).status,200);
 assert.equal((await api('/v1/malls')).status,401);
 assert.equal((await api('/v1/auth/login','POST',{email:'owner@example.test',password:'wrong',totp:totp()})).status,401);
 assert.equal((await api('/v1/auth/login','POST',{email:'owner@example.test',password:'test-password-123456!',totp:'999999'})).status,401);
});
test('MFA login, tenant assignment and revision isolation',async()=>{
 let r=await api('/v1/auth/login','POST',{email:'owner@example.test',password:'test-password-123456!',totp:totp()});
 assert.equal(r.status,200);csrf=r.body.csrf;cookie=r.setCookie.split(';')[0];ownerId=r.body.user.id;
 assert.equal((await api('/v1/tenants','POST',{name:'Test Mall'},true,{'X-Retailnav-Csrf':'invalid'})).status,403);
 r=await api('/v1/tenants','POST',{name:'Test Mall'});assert.equal(r.status,201);tenant=r.body.id;
 r=await api('/v1/malls/demo-mall/assign','POST',{tenantId:tenant});assert.equal(r.status,200);
 r=await api('/v1/malls/demo-mall/revisions','POST',{});assert.equal(r.status,201);
 const revision=r.body.id;
 const draft={features:[{id:'unit-2',floor:'PB',kind:'unit',source:'manual',evidence:'Measured from original image',vertices:[[10,10],[200,10],[200,200],[10,200]]}],
 connectors:[{id:'lift-1',kind:'lift',verification:'unverified',evidence:'Candidate on scan',landings:[{floor:'PB',x:30,y:30},{floor:'P1',x:33,y:34}]}],transforms:[],occupancies:[]};
 assert.equal((await api('/v1/malls/demo-mall/revisions/'+revision,'PUT',draft,true,{'If-Match':'"0"'})).status,409);
 r=await api('/v1/malls/demo-mall/revisions/'+revision,'PUT',draft,true,{'If-Match':'"1"'});assert.equal(r.status,200);
 assert.equal((await api('/v1/malls/demo-mall/revisions/'+revision+'/submit','POST',{})).status,200);
 assert.equal((await api('/v1/malls/demo-mall/revisions/'+revision+'/approve','POST',{})).status,403);
 assert.equal((await api('/v1/malls/demo-mall/published')).status,404);
 assert.equal((await api('/v1/malls/demo-mall/map')).status,200);
});
test('reject cross-origin updates and invalid geometric revisions',async()=>{
 const r=await api('/v1/tenants','POST',{name:'Hacked'},true,{Origin:'https://evil.example'});
 assert.equal(r.status,403);
 const d=await api('/v1/malls/demo-mall/revisions');assert.equal(d.status,200);
});
test.after(async()=>{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true})});
