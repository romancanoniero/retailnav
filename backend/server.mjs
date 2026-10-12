// RetailNav: private anonymous identities and consent-based manual indoor presence.
// No IP tracking, browser fingerprinting, or geolocation collection.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 3181);
const DATA_DIR = process.env.RETAILNAV_DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'presence.json');
const ALLOWED_ORIGINS = new Set((process.env.RETAILNAV_ALLOWED_ORIGINS ||
  'https://improvingyourreality.com,https://www.improvingyourreality.com').split(',').filter(Boolean));
const SESSION_AGE=180*86400000, INVITE_AGE=5*60000, REQUEST_AGE=20*60000, LOCATION_AGE=10*60000;
const token=()=>crypto.randomBytes(32).toString('base64url');
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const validName=name=>typeof name==='string'&&name.trim().length>=1&&name.trim().length<=36&&!/[\u0000-\u001f\u007f]/.test(name);
const allowedFloor=floor=>['LL','UL','L3'].includes(floor);
fs.mkdirSync(DATA_DIR,{recursive:true,mode:0o700});
let db;
try {
  db=JSON.parse(fs.readFileSync(FILE,'utf8'));
  if(db.version!==1||!db.users||!db.sessions||!db.invites||!db.requests)throw Error('Unknown schema');
} catch(e) {
  if(e.code!=='ENOENT')throw e;
  db={version:1,users:{},sessions:{},invites:{},requests:{}};
}
function save(){
  const temp=FILE+'.'+process.pid+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(db),{mode:0o600});
  fs.renameSync(temp,FILE);
}
function prune(){
  let changed=false,t=Date.now();
  for(const [id,r] of Object.entries(db.sessions))if(r.lastSeen+SESSION_AGE<t||!db.users[r.userId]){delete db.sessions[id];changed=true;}
  for(const [id,r] of Object.entries(db.invites))if(r.expires<t||!db.users[r.ownerId]){delete db.invites[id];changed=true;}
  for(const [id,r] of Object.entries(db.requests))if(r.expires<t||!db.users[r.ownerId]||!db.users[r.guestId]){delete db.requests[id];changed=true;}
  if(changed)save();
}
prune();
const rates=new Map();
function limited(key){
  const t=Date.now(),r=rates.get(key)||{until:t+60000,count:0};
  if(t>r.until){r.until=t+60000;r.count=0;}
  r.count++;rates.set(key,r);
  if(rates.size>12000)for(const [k,v] of rates)if(v.until<t)rates.delete(k);
  return r.count>90;
}
function send(res,code,body,cookie){
  const data=JSON.stringify(body);
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8',
    'Content-Length':Buffer.byteLength(data),'Cache-Control':'no-store, private',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'Cross-Origin-Resource-Policy':'same-origin',
    ...(cookie?{'Set-Cookie':cookie}:{})});
  res.end(data);
}
const reject=(res,code,reason)=>send(res,code,{error:reason});
function getSession(req){
  const m=/(?:^|;\s*)rn_session=([A-Za-z0-9_-]{30,90})(?:;|$)/.exec(req.headers.cookie||'');
  if(!m)return null;
  const entry=db.sessions[hash(m[1])];
  return entry&&entry.lastSeen+SESSION_AGE>Date.now()&&db.users[entry.userId]
    ?{user:db.users[entry.userId],credential:m[1],entry}:null;
}
function cookie(value){
  return 'rn_session='+value+'; Path=/retailnav; Max-Age='+Math.floor(SESSION_AGE/1000)+
    '; HttpOnly; Secure; SameSite=Lax';
}
function newSession(user){
  const credential=token();
  db.sessions[hash(credential)]={userId:user.id,created:Date.now(),lastSeen:Date.now()};
  save();
  return cookie(credential);
}
function newUser(){
  if(Object.keys(db.users).length>=100000)throw Error('Capacity limit');
  const id=crypto.randomUUID();
  const user={id,name:'Visitante '+id.replace(/-/g,'').slice(0,5).toUpperCase(),
    created:Date.now(),friends:[],location:null,recovery:null};
  db.users[id]=user;
  return user;
}
async function parse(req){
  let raw='',size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>8192)throw Object.assign(Error('Solicitud demasiado grande'),{status:413});
    raw+=chunk.toString('utf8');
  }
  let p;
  try{p=JSON.parse(raw||'{}');}catch{throw Object.assign(Error('JSON inválido'),{status:400});}
  if(!p||typeof p!=='object'||Array.isArray(p))
    throw Object.assign(Error('Datos inválidos'),{status:400});
  return p;
}
function publicFriend(user){
  const loc=user.location,visible=loc?.sharing===true&&loc.updated+LOCATION_AGE>Date.now();
  return {id:user.id,name:user.name,sharing:Boolean(visible),
    ...(visible?{position:{floor:loc.floor,x:loc.x,y:loc.y,updated:loc.updated,source:'manual'}}:{})};
}
function state(me){
  return {me:{id:me.id,name:me.name,anonymous:true,hasRecovery:Boolean(me.recovery)},
    friends:me.friends.map(id=>db.users[id]).filter(Boolean).map(publicFriend),
    incoming:Object.values(db.requests).filter(r=>r.ownerId===me.id&&r.expires>Date.now())
      .map(r=>({id:r.id,name:db.users[r.guestId]?.name||'Visitante',created:r.created})),
    outgoing:Object.values(db.requests).filter(r=>r.guestId===me.id&&r.expires>Date.now())
      .map(r=>({id:r.id,name:db.users[r.ownerId]?.name||'Visitante',created:r.created})),
    myPosition:me.location?.sharing&&me.location.updated+LOCATION_AGE>Date.now()
      ?{floor:me.location.floor,x:me.location.x,y:me.location.y,
        updated:me.location.updated,source:'manual'}:null,
    locationExpiresAfterMs:LOCATION_AGE};
}
const app=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/','http://localhost');
    if(req.method==='GET'&&url.pathname==='/health')
      return send(res,200,{ok:true,service:'retailnav-anonymous-presence'});
    if(req.method==='POST'&&!ALLOWED_ORIGINS.has(req.headers.origin))
      return reject(res,403,'Origen de solicitud no autorizado');
    if(!['GET','POST'].includes(req.method))return reject(res,405,'Método no permitido');
    const auth=getSession(req);
    if(limited(auth?auth.user.id:'boot-'+req.socket.remoteAddress))
      return reject(res,429,'Demasiadas solicitudes');
    if(req.method==='POST'&&url.pathname==='/session'){
      if(auth){
        auth.entry.lastSeen=Date.now();save();
        return send(res,200,state(auth.user),cookie(auth.credential));
      }
      const user=newUser();
      return send(res,201,state(user),newSession(user));
    }
    if(!auth)return reject(res,401,'Sesión anónima no disponible. Recargá la página.');
    const me=auth.user;
    if(req.method==='GET'&&url.pathname==='/state')return send(res,200,state(me));
    if(req.method==='POST'&&url.pathname==='/invite/preview'){
      const payload=await parse(req);
      const code=payload.code||'';
      if(code.length>110)return reject(res,400,'Código inválido');
      const invite=db.invites[hash(code)];
      if(!invite||invite.expires<=Date.now())return reject(res,404,'Invitación vencida');
      if(invite.ownerId===me.id)return reject(res,400,'Esta invitación es tuya');
      const owner=db.users[invite.ownerId];
      if(!owner)return reject(res,404,'Invitación vencida');
      return send(res,200,{name:owner.name,expires:invite.expires});
    }
    if(req.method==='POST'&&url.pathname==='/me'){
      const p=await parse(req);
      if(!validName(p.name))return reject(res,400,'Ingresá un nombre de 1 a 36 caracteres');
      me.name=p.name.trim();save();return send(res,200,state(me));
    }
    if(req.method==='POST'&&url.pathname==='/invite'){
      for(const [key,invite] of Object.entries(db.invites))
        if(invite.ownerId===me.id)delete db.invites[key];
      const code=token(),expires=Date.now()+INVITE_AGE;
      db.invites[hash(code)]={ownerId:me.id,created:Date.now(),expires};
      save();return send(res,201,{code,expires});
    }
    if(req.method==='POST'&&url.pathname==='/invite/claim'){
      const p=await parse(req);
      if(typeof p.code!=='string'||!/^[A-Za-z0-9_-]{40,80}$/.test(p.code))
        return reject(res,400,'Código inválido');
      const key=hash(p.code),invite=db.invites[key];
      if(!invite||invite.expires<=Date.now())return reject(res,410,'Invitación vencida. Solicitá otro QR.');
      if(invite.ownerId===me.id)return reject(res,400,'No podés vincularte con vos mismo');
      const host=db.users[invite.ownerId];
      if(!host)return reject(res,410,'Invitación vencida');
      if(host.friends.includes(me.id))return reject(res,409,'Ya están vinculados');
      delete db.invites[key];
      const id=crypto.randomUUID();
      db.requests[id]={id,ownerId:host.id,guestId:me.id,created:Date.now(),
        expires:Date.now()+REQUEST_AGE};
      save();return send(res,201,{pending:true,name:host.name});
    }
    if(req.method==='POST'&&url.pathname==='/request/decide'){
      const p=await parse(req);
      if(!validId(p.id)||!['accept','reject'].includes(p.action))
        return reject(res,400,'Solicitud inválida');
      const request=db.requests[p.id];
      if(!request||request.ownerId!==me.id||request.expires<=Date.now())
        return reject(res,404,'Solicitud no disponible');
      const friend=db.users[request.guestId];
      delete db.requests[p.id];
      if(p.action==='accept'&&friend){
        if(!me.friends.includes(friend.id))me.friends.push(friend.id);
        if(!friend.friends.includes(me.id))friend.friends.push(me.id);
      }
      save();return send(res,200,state(me));
    }
    if(req.method==='POST'&&url.pathname==='/request/cancel'){
      const p=await parse(req);
      if(!validId(p.id)||db.requests[p.id]?.guestId!==me.id)
        return reject(res,404,'Solicitud no disponible');
      delete db.requests[p.id];save();return send(res,200,state(me));
    }
    if(req.method==='POST'&&url.pathname==='/contact/remove'){
      const p=await parse(req);
      if(!validId(p.id)||!me.friends.includes(p.id))
        return reject(res,404,'Contacto no encontrado');
      me.friends=me.friends.filter(id=>id!==p.id);
      const other=db.users[p.id];
      if(other)other.friends=other.friends.filter(id=>id!==me.id);
      save();return send(res,200,state(me));
    }
    if(req.method==='POST'&&url.pathname==='/location'){
      const p=await parse(req);
      if(p.sharing===false){me.location=null;save();return send(res,200,state(me));}
      if(p.sharing!==true||!allowedFloor(p.floor)||!Number.isFinite(p.x)||
        !Number.isFinite(p.y)||p.x<0||p.x>2000||p.y<0||p.y>2000)
        return reject(res,400,'Marcá una posición válida en el plano');
      me.location={floor:p.floor,x:Math.round(p.x*10)/10,y:Math.round(p.y*10)/10,
        sharing:true,updated:Date.now(),source:'manual'};
      save();return send(res,200,state(me));
    }
    if(req.method==='POST'&&url.pathname==='/recovery/create'){
      const code=token()+'-'+token().slice(0,11);
      me.recovery=hash(code);save();
      return send(res,201,{recoveryCode:code,warning:'Guardá esta clave fuera del navegador. Solo se muestra una vez.'});
    }
    if(req.method==='POST'&&url.pathname==='/recovery/restore'){
      const p=await parse(req);
      if(typeof p.code!=='string'||p.code.length<55||p.code.length>100)
        return reject(res,400,'Clave inválida');
      const owner=Object.values(db.users).find(user=>user.recovery===hash(p.code));
      if(!owner)return reject(res,404,'Clave incorrecta o ya utilizada');
      if(me.friends.length&&me.id!==owner.id)
        return reject(res,409,'Este navegador ya tiene contactos. No se sobrescribieron.');
      if(owner.id!==me.id){
        for(const [key,s] of Object.entries(db.sessions))
          if(s.userId===me.id)delete db.sessions[key];
        delete db.users[me.id];
      }
      owner.recovery=null;
      const newCookie=newSession(owner);
      return send(res,200,state(owner),newCookie);
    }
    return reject(res,404,'Ruta no disponible');
  }catch(e){
    if(e.status)return reject(res,e.status,e.message);
    console.error('Presence API error',e.message);
    return reject(res,500,'No se pudo completar la operación');
  }
});
app.requestTimeout=10000;
app.headersTimeout=11000;
if(process.env.NODE_ENV!=='test')
  app.listen(PORT,'0.0.0.0',()=>console.log('RetailNav presence API ready'));
export {app};
