import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, mkdirSync, copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const dir=mkdtempSync(path.join(tmpdir(),'retailnav-presence-'));
process.env.NODE_ENV='test';
process.env.RETAILNAV_DATA_DIR=dir;
process.env.RETAILNAV_ALLOWED_ORIGINS='https://improvingyourreality.com';
mkdirSync(path.join(dir,'brand-assets'),{recursive:true});
copyFileSync('public/branding/aventura-mark.svg',path.join(dir,'brand-assets','aventura-mark.svg'));
const {app}=await import('./server.mjs');
await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+app.address().port;
const origin='https://improvingyourreality.com';

async function req(method,url,body,session,customOrigin=origin){
  const headers={};
  if(method==='POST'){headers['Origin']=customOrigin;headers['Content-Type']='application/json';}
  if(session)headers.Cookie=session;
  const res=await fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  let data=await res.json();
  return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0]};
}
test('registered first-party Aventura mark survives visitor session creation',async()=>{
 const initial=await req('GET','/mall-brands/aventura');
 assert.equal(initial.status,200);
 assert.equal(initial.data.available,true);
 assert.equal(initial.data.logo.placement,'left-of-name');
 assert.equal(initial.data.logo.url,'api/mall-brands/aventura/logo.svg');
 const file=JSON.parse(readFileSync(path.join(dir,'mall-brands.json'),'utf8'));
 assert.equal(file.records.aventura.logo.sha256,initial.data.logo.sha256);
 const logo=await fetch(base+'/mall-brands/aventura/logo.svg');
 assert.equal(logo.status,200);
 assert.equal(logo.headers.get('content-type'),'image/svg+xml; charset=utf-8');
 assert.match(await logo.text(),/#100F0F/);
 const user=await req('POST','/session',{});
 assert.equal(user.status,201);
 assert.equal((await req('GET','/mall-brands/aventura')).status,200);
 assert.equal((await req('GET','/mall-brands/another')).status,404);
});
test('anonymous people survive browser sessions; QR linking requires mutual acceptance',async()=>{
  const a=await req('POST','/session',{});
  const b=await req('POST','/session',{});
  assert.equal(a.status,201);assert.equal(b.status,201);
  assert.notEqual(a.data.me.id,b.data.me.id);
  assert.match(a.cookie,/rn_session=/);
  assert.equal((await req('GET','/state',undefined,a.cookie)).data.me.id,a.data.me.id);
  const rename=await req('POST','/me',{name:'Ana'},a.cookie);
  assert.equal(rename.data.me.name,'Ana');
  const invite=await req('POST','/invite',{},a.cookie);
  assert.equal(invite.status,201);
  assert.equal(invite.data.code.length,43);
  const preview=await req('POST','/invite/preview',{code:invite.data.code},b.cookie);
  assert.equal(preview.status,200);
  assert.equal(preview.data.name,'Ana');
  const invalid=await req('POST','/invite/claim',{code:invite.data.code},a.cookie);
  assert.equal(invalid.status,400);
  const claim=await req('POST','/invite/claim',{code:invite.data.code},b.cookie);
  assert.equal(claim.status,201);
  assert.equal(claim.data.pending,true);
  assert.equal((await req('GET','/state',undefined,b.cookie)).data.friends.length,0);
  assert.equal((await req('POST','/invite/claim',{code:invite.data.code},b.cookie)).status,410);
  const incoming=(await req('GET','/state',undefined,a.cookie)).data.incoming;
  assert.equal(incoming.length,1);
  assert.equal((await req('POST','/request/decide',{id:incoming[0].id,action:'accept'},b.cookie)).status,404);
  const accept=await req('POST','/request/decide',{id:incoming[0].id,action:'accept'},a.cookie);
  assert.equal(accept.status,200);assert.equal(accept.data.friends.length,1);
  const friend=(await req('GET','/state',undefined,b.cookie)).data.friends[0];
  assert.equal(friend.name,'Ana');
  assert.equal(friend.position,undefined);
  const invalidShare=await req('POST','/location',{sharing:true,floor:'LL',x:-2,y:300},a.cookie);
  assert.equal(invalidShare.status,400);
  const share=await req('POST','/location',{sharing:true,floor:'UL',x:650,y:380},a.cookie);
  assert.equal(share.status,200);assert.equal(share.data.myPosition.floor,'UL');
  const visible=(await req('GET','/state',undefined,b.cookie)).data.friends[0];
  assert.equal(visible.sharing,true);assert.deepEqual([visible.position.x,visible.position.y],[650,380]);
  assert.equal(visible.position.source,'manual');
  const stop=await req('POST','/location',{sharing:false},a.cookie);
  assert.equal(stop.data.myPosition,null);
  assert.equal((await req('GET','/state',undefined,b.cookie)).data.friends[0].position,undefined);
  const rec=await req('POST','/recovery/create',{},a.cookie);
  assert.equal(rec.status,201);assert.ok(rec.data.recoveryCode.length>=55);
  const c=await req('POST','/session',{});
  const restore=await req('POST','/recovery/restore',{code:rec.data.recoveryCode},c.cookie);
  assert.equal(restore.status,200);assert.equal(restore.data.me.id,a.data.me.id);
  assert.equal((await req('POST','/recovery/restore',{code:rec.data.recoveryCode},b.cookie)).status,404);
  const unlink=await req('POST','/contact/remove',{id:b.data.me.id},restore.cookie);
  assert.equal(unlink.status,200);assert.equal(unlink.data.friends.length,0);
  assert.equal((await req('GET','/state',undefined,b.cookie)).data.friends.length,0);
  // Sharing a chat invitation is consent by its creator; opening it still
  // requires explicit acceptance by the recipient. The link is one-use.
  const direct=await req('POST','/invite/link',{},restore.cookie);
  assert.equal(direct.status,201);
  assert.equal(direct.data.mode,'link');
  const peek=await req('POST','/invite/preview',{code:direct.data.code},b.cookie);
  assert.equal(peek.data.mode,'link');
  assert.equal((await req('GET','/state',undefined,b.cookie)).data.friends.length,0);
  const linked=await req('POST','/invite/claim',{code:direct.data.code},b.cookie);
  assert.equal(linked.status,200);
  assert.equal(linked.data.linked,true);
  assert.equal((await req('GET','/state',undefined,restore.cookie)).data.friends.length,1);
  assert.equal((await req('GET','/state',undefined,b.cookie)).data.friends.length,1);
  assert.equal((await req('POST','/invite/claim',{code:direct.data.code},b.cookie)).status,410);
  // Only the creator and accepted contacts may read the profile photograph.
  const stranger=await req('POST','/session',{});
  assert.equal((await req('GET','/avatar/'+a.data.me.id,undefined,stranger.cookie)).status,404);
  assert.equal((await req('POST','/avatar',{image:'data:image/jpeg;base64,Zm9v'},restore.cookie)).status,400);
  const unlinkAgain=await req('POST','/contact/remove',{id:b.data.me.id},restore.cookie);
  assert.equal(unlinkAgain.status,200);
  assert.equal((await req('GET','/state',undefined,b.cookie)).data.friends.length,0);
  const persistent=JSON.parse(readFileSync(path.join(dir,'presence.json'),'utf8'));
  assert.equal(persistent.version,1);
  assert.ok(persistent.users[a.data.me.id]);
  assert.ok(!JSON.stringify(persistent).includes(rec.data.recoveryCode));
  const erased=await req('POST','/account/delete',{},restore.cookie);
  assert.equal(erased.status,200);
  assert.equal(erased.data.deleted,true);
  assert.equal((await req('GET','/state',undefined,restore.cookie)).status,401);
  const afterErase=JSON.parse(readFileSync(path.join(dir,'presence.json'),'utf8'));
  assert.equal(afterErase.users[a.data.me.id],undefined);

});
test('request provenance, session and API protection',async()=>{
  const untrusted=await req('POST','/session',{},null,'https://evil.example');
  assert.equal(untrusted.status,403);
  const protectedGet=await req('GET','/state');
  assert.equal(protectedGet.status,401);
  const method=await req('GET','/invite/preview?code=guess');
  assert.equal(method.status,401);
});
test('adaptive positioning: anonymous transient QR reference, consent and replay defense',async()=>{
 const sender=await req('POST','/session',{});
 const receiver=await req('POST','/session',{});
 const stranger=await req('POST','/session',{});
 const anchor={mallId:'new-world-city-shanghai',floor:'L4',
  x:511.23,y:235.4,source:'manual-anchor',
  observedAtMs:Date.now(),explicitConsent:true};
 assert.equal((await req('POST','/positioning/offer',anchor,null)).status,401);
 assert.equal((await req('POST','/positioning/offer',{
  ...anchor,explicitConsent:false},sender.cookie)).status,400);
 assert.equal((await req('POST','/positioning/offer',{
  ...anchor,source:'peer-qr-colocation-asserted'},sender.cookie)).status,400);
 assert.equal((await req('POST','/positioning/offer',{
  ...anchor,observedAtMs:Date.now()-500000},sender.cookie)).status,400);
 assert.equal((await req('POST','/positioning/offer',{
  ...anchor,floor:'L4',x:2001},sender.cookie)).status,400);
 const created=await req('POST','/positioning/offer',anchor,sender.cookie);
 assert.equal(created.status,201);
 assert.ok(created.data.code.length>=40);
 assert.equal(created.data.oneUse,true);
 assert.equal(created.data.metricAccuracyKnown,false);
 assert.equal(created.data.physicalProximityVerified,false);
 assert.ok(created.data.expiresAt>Date.now());
 const payload={code:created.data.code,mallId:anchor.mallId,
  explicitConsent:true,confirmColocated:true};
 assert.equal((await req('POST','/positioning/claim',{
  ...payload,explicitConsent:false},receiver.cookie)).status,400);
 assert.equal((await req('POST','/positioning/claim',payload,sender.cookie)).status,400);
 assert.equal((await req('POST','/positioning/claim',{
  ...payload,mallId:'aventura'},stranger.cookie)).status,409);
 const used=await req('POST','/positioning/claim',payload,receiver.cookie);
 assert.equal(used.status,200);
 assert.deepEqual([used.data.floor,used.data.x,used.data.y],['L4',511.2,235.4]);
 assert.equal(used.data.mallId,anchor.mallId);
 assert.equal(used.data.coordinateSpace,'mall-photo-pixels');
 assert.equal(used.data.rangeMeters,null);
 assert.equal(used.data.horizontalAccuracyM,null);
 assert.equal(used.data.altitudeM,null);
 assert.equal(used.data.physicalProximityVerified,false);
 assert.equal(used.data.floorConfidence,'unverified');
 assert.equal((await req('POST','/positioning/claim',payload,stranger.cookie)).status,410);
 // No peer location or travel history is persisted to the existing social DB.
 const saved=readFileSync(path.join(dir,'presence.json'),'utf8');
 assert.ok(!saved.includes(created.data.code));
 assert.ok(!saved.includes('511.2'));
 assert.ok(!saved.includes('positioningOffers'));
 const second=await req('POST','/positioning/offer',{
  ...anchor,observedAtMs:Date.now()},sender.cookie);
 assert.equal(second.status,201);
 assert.equal((await req('POST','/positioning/revoke',{},sender.cookie)).status,200);
 assert.equal((await req('POST','/positioning/claim',{
  ...payload,code:second.data.code},receiver.cookie)).status,410);
 assert.equal((await req('POST','/positioning/offer',anchor,sender.cookie,
  'https://evil.example')).status,403);
});
test.after(async()=>{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});});
