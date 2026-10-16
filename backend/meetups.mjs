/* Consent-based meetup proposals. A destination is a DIRECTORY RECORD, never
 * a surveyed route/doorway. No location or movement histories are stored.
 * Works with the existing v1 persistence file; optional meetups field only.
 */
import crypto from 'node:crypto';
const LIFETIME=24*60*60*1000;
const KEEP=48*60*60*1000;
const MAX_PENDING=12;
export function createMeetupService({db,save,send,reject,parse,validId,validMallId,validFloorLabel}){
 if(!db.meetups)db.meetups={};
 const mutual=(a,b)=>Boolean(db.users[a]?.friends?.includes(b)&&db.users[b]?.friends?.includes(a));
 const attendees=m=>[m.ownerId,...m.inviteeIds];
 function destination(value,mall){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const {storeId,name,floor}=value;
  if(typeof storeId!=='string'||!storeId.startsWith(mall+':')||
     !/^[a-zA-Z0-9:_-]{5,180}$/.test(storeId)||
     typeof name!=='string'||name.trim().length<1||name.trim().length>90||
     /[\u0000-\u001f\u007f]/.test(name)||
     !(floor===null||floor===undefined||validFloorLabel(floor)))return null;
  return {storeId,name:name.trim(),floor:floor||null,positionVerified:false};
 }
 function purge(){
  const now=Date.now();let changed=false;
  for(const [key,m] of Object.entries(db.meetups)){
   if(!m||m.created+KEEP<now||m.expires<=now||
      !attendees(m).every(id=>db.users[id])||
      !m.inviteeIds.every(id=>mutual(m.ownerId,id))){
     delete db.meetups[key];changed=true;
   }
  }
  if(changed)save();
 }
 function forget(userId){
  let changed=false;
  for(const [key,m] of Object.entries(db.meetups)){
   if(attendees(m).includes(userId)){delete db.meetups[key];changed=true;}
  }
  if(changed)save();
 }
 function unlink(a,b){
  let changed=false;
  for(const [key,m] of Object.entries(db.meetups)){
   if(attendees(m).includes(a)&&attendees(m).includes(b)){
    delete db.meetups[key];changed=true;
   }
  }
  if(changed)save();
 }
 function publicly(m,meId){
  const mine=m.ownerId===meId;
  const related=mine?m.inviteeIds:[meId];
  return {
   id:m.id,mallId:m.mallId,ownerId:m.ownerId,
   ownerName:db.users[m.ownerId]?.name||'Visitante',
   isOrganizer:mine,
   destination:m.destination,
   status:m.status,revision:m.revision,
   created:m.created,expires:m.expires,
   inviteeCount:m.inviteeIds.length,
   acceptedCount:m.inviteeIds.filter(id=>m.responses[id]==='accepted').length,
   myResponse:mine?'organizer':m.responses[meId],
   invitees:related.map(id=>({id,name:db.users[id]?.name||'Visitante',
     response:m.responses[id]})),
   counter:m.counter?{byName:db.users[m.counter.by]?.name||'Visitante',
     byMe:m.counter.by===meId,destination:m.counter.destination}:null,
   navigationApproved:false // geometry and AR pose are NOT certified by meetups.
  };
 }
 async function handle(req,res,path,me){
  if(!path.startsWith('/meetups'))return false;
  purge();
  if(req.method==='GET'&&path==='/meetups'){
   const list=Object.values(db.meetups)
     .filter(m=>attendees(m).includes(me.id))
     .sort((a,b)=>b.created-a.created).slice(0,40)
     .map(m=>publicly(m,me.id));
   send(res,200,{meetings:list,pending:list.filter(m=>!m.isOrganizer&&
     (m.status==='pending'&&m.myResponse==='pending')).length});
   return true;
  }
  if(req.method==='POST'&&path==='/meetups/create'){
   const p=await parse(req);
   if(!validMallId(p.mallId)||!Array.isArray(p.inviteeIds)||
     !p.inviteeIds.length||p.inviteeIds.length>8||
     new Set(p.inviteeIds).size!==p.inviteeIds.length||
     !p.inviteeIds.every(id=>validId(id)&&id!==me.id&&mutual(me.id,id)))
     {reject(res,400,'Seleccioná hasta ocho amigos reales vinculados');return true;}
   const dest=destination(p.destination,p.mallId);
   if(!dest){reject(res,400,'Elegí un comercio existente del shopping');return true;}
   if(Object.values(db.meetups).filter(m=>m.ownerId===me.id&&
     ['pending','counter'].includes(m.status)).length>=MAX_PENDING)
     {reject(res,429,'Demasiados encuentros pendientes');return true;}
   if(Object.keys(db.meetups).length>=1500)
     {reject(res,503,'Capacidad de encuentros agotada');return true;}
   const now=Date.now(),id=crypto.randomUUID();
   const m={id,mallId:p.mallId,ownerId:me.id,inviteeIds:p.inviteeIds,
     destination:dest,responses:Object.fromEntries(p.inviteeIds.map(id=>[id,'pending'])),
     counter:null,status:'pending',revision:1,created:now,expires:now+LIFETIME};
   db.meetups[id]=m;save();
   send(res,201,{meeting:publicly(m,me.id)});return true;
  }
  if(req.method==='POST'&&path==='/meetups/decision'){
   const p=await parse(req);
   const m=validId(p.id)?db.meetups[p.id]:null;
   if(!m||!attendees(m).includes(me.id))
     {reject(res,404,'Encuentro no disponible');return true;}
   if(!['accept','counter','approve','reject','decline','cancel'].includes(p.action))
     {reject(res,400,'Acción inválida');return true;}
   if(['cancelled','declined','confirmed'].includes(m.status)&&p.action!=='cancel')
     {reject(res,409,'El encuentro ya se resolvió');return true;}
   const organizer=me.id===m.ownerId;
   if(p.action==='cancel'){m.status='cancelled';m.counter=null;}
   else if(p.action==='accept'){
    if(organizer||m.counter||m.status!=='pending')
     {reject(res,409,'Hay que resolver primero la propuesta alternativa');return true;}
    m.responses[me.id]='accepted';
    if(m.inviteeIds.every(id=>m.responses[id]==='accepted'))m.status='confirmed';
   }else if(p.action==='counter'){
    if(organizer||m.counter||m.status!=='pending')
     {reject(res,409,'La alternativa anterior sigue pendiente');return true;}
    const dest=destination(p.destination,m.mallId);
    if(!dest||dest.storeId===m.destination.storeId)
     {reject(res,400,'Elegí otro comercio del mismo shopping');return true;}
    m.counter={by:me.id,destination:dest};m.status='counter';
   }else if(p.action==='approve'){
    if(!organizer||!m.counter)
     {reject(res,403,'La alternativa debe confirmarla quien invita');return true;}
    const proposer=m.counter.by;
    m.destination=m.counter.destination;
    m.responses=Object.fromEntries(m.inviteeIds.map(id=>[id,id===proposer?'accepted':'pending']));
    m.counter=null;m.status='pending';
    if(m.inviteeIds.every(id=>m.responses[id]==='accepted'))m.status='confirmed';
   }else if(p.action==='reject'){
    if(!organizer||!m.counter)
     {reject(res,403,'No hay alternativa para rechazar');return true;}
    m.counter=null;m.status='pending';
   }else if(p.action==='decline'){
    if(organizer){reject(res,403,'Usá cancelar como organizador');return true;}
    m.status='declined';m.counter=null;m.responses[me.id]='declined';
   }
   m.revision++;save();send(res,200,{meeting:publicly(m,me.id)});return true;
  }
  reject(res,404,'Ruta de encuentros no disponible');return true;
 }
 purge();
 return {handle,forget,unlink,purge};
}
