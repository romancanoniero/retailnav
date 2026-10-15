// RetailNav tenant-scoped mall administration. Separate from anonymous visitor identity.
// Credentials are provisioned only by a trusted server operator (or platform admin).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {compile,bundle,validateDraft,validateTheme,validSlug,defaults} from './mall-geometry.mjs';

const ROOT=path.join(process.env.RETAILNAV_DATA_DIR||'/data','mall-admin');
const USERS=path.join(ROOT,'accounts.json');
const ORIGINS=new Set((process.env.RETAILNAV_ALLOWED_ORIGINS||
 'https://improvingyourreality.com,https://www.improvingyourreality.com').split(',').filter(Boolean));
const TTL=12*3600*1000;
const sessions=new Map();
const attempts=new Map();
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const issued=()=>crypto.randomBytes(32).toString('base64url');
const usernameOk=s=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._@+-]{2,79}$/.test(s);
function ensureRoot(){fs.mkdirSync(ROOT,{recursive:true,mode:0o700});}
function read(file,otherwise=null){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return otherwise;throw e;}}
function atomic(file,obj){
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const temp=file+'.'+process.pid+'.'+crypto.randomBytes(4).toString('hex');
 fs.writeFileSync(temp,JSON.stringify(obj),{mode:0o600,flag:'wx'});
 fs.renameSync(temp,file);
}
function accounts(){ensureRoot();const result=read(USERS,{version:1,users:{}});if(result.version!==1)throw Error('Invalid admin database');return result;}
function hashed(password,salt){return crypto.scryptSync(password,salt,64,{N:16384,r:8,p:1}).toString('hex');}
function addAdmin({username,password,role,mallId}){
 if(!usernameOk(username)||typeof password!=='string'||password.length<16||password.length>128||
  !['platform','tenant'].includes(role)||(role==='tenant'&&!validSlug(mallId)))
  throw Error('Invalid account provisioning arguments');
 const all=accounts();const key=username.toLowerCase();
 if(all.users[key])throw Error('Administrative username already exists');
 const salt=crypto.randomBytes(24).toString('hex');
 all.users[key]={username:key,role,mallId:role==='tenant'?mallId:null,
  salt,passwordHash:hashed(password,salt),createdAt:new Date().toISOString(),disabled:false};
 atomic(USERS,all);
 return {username:key,role,mallId:role==='tenant'?mallId:null};
}
export function provisionAdmin({username,password,role='platform',mallId=null}){
 return addAdmin({username,password,role,mallId});
}
function out(res,code,obj,headers={}){
 const raw=JSON.stringify(obj);
 res.writeHead(code,{'Content-Type':'application/json; charset=utf-8',
  'Content-Length':Buffer.byteLength(raw),'Cache-Control':'private, no-store',
  'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
  'Cross-Origin-Resource-Policy':'same-origin',...headers});
 res.end(raw);
}
const error=(res,status,message)=>out(res,status,{error:message});
const cookie=(session)=>'rn_admin='+session+'; Path=/retailnav/api/admin; Secure; HttpOnly; SameSite=Strict; Max-Age=43200';
const clearCookie='rn_admin=; Path=/retailnav/api/admin; Secure; HttpOnly; SameSite=Strict; Max-Age=0';
function auth(req){
 const m=/(?:^|;\s*)rn_admin=([A-Za-z0-9_-]{42,70})(?:;|$)/.exec(req.headers.cookie||'');
 const key=m&&sha(m[1]),session=key&&sessions.get(key);
 if(!session||session.expiresAt<Date.now())return null;
 const user=accounts().users[session.username];
 return user&&!user.disabled?user:null;
}
async function body(req,max=8*1024*1024){
 let parts=[],size=0;
 for await(const chunk of req){size+=chunk.length;
  if(size>max)throw Object.assign(Error('Archivo demasiado grande'),{status:413});parts.push(chunk);}
 try{
  const data=JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error();
  return data;
 }catch{throw Object.assign(Error('JSON de administración inválido'),{status:400});}
}
const tenantDir=id=>path.join(ROOT,'tenants',id);
const draftFile=id=>path.join(tenantDir(id),'draft.json');
const publicationFile=id=>path.join(tenantDir(id),'published.json');
const historyFile=id=>path.join(tenantDir(id),'history.json');
function requires(user,id){return user.role==='platform'||user.mallId===id;}
const slugOrReject=id=>{if(!validSlug(id))throw Object.assign(Error('Mall inválido'),{status:400});};
function publicCatalog(){
 ensureRoot();const dir=path.join(ROOT,'tenants');
 const malls={};
 try{
  for(const slug of fs.readdirSync(dir)){
   if(!validSlug(slug))continue;
   const published=read(publicationFile(slug));
   if(published?.meta?.id===slug&&published?.meta?.mapAsset)
    malls[slug]=published.meta;
  }
 }catch(e){if(e.code!=='ENOENT')throw e;}
 return malls;
}
function validFile(buffer,mime){
 // Logo/floor references are raster images. Untrusted SVG uploads are forbidden:
 // the official Aventura logo is a static, reviewed first-party resource.
 if(buffer.length<64||buffer.length>5*1024*1024)throw Error('Archivo vacío o demasiado grande (máximo 5 MB)');
 if(mime==='image/png'){
  if(buffer.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('PNG inválido');
  const w=buffer.readUInt32BE(16),h=buffer.readUInt32BE(20);
  if(w<1||h<1||w>12000||h>12000)throw Error('Resolución de PNG fuera de rango');
  return {ext:'png',width:w,height:h};
 }
 if(mime==='image/webp'){
  if(buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WEBP')
   throw Error('WebP inválido');
  // Dimensions in WebP are optional to infer here; browser provides them and
  // the operator sets the registered floor size separately.
  return {ext:'webp'};
 }
 if(mime==='image/jpeg'){
  if(buffer[0]!==255||buffer[1]!==216||buffer[buffer.length-2]!==255||buffer[buffer.length-1]!==217)
   throw Error('JPEG inválido');
  return {ext:'jpg'};
 }
 throw Error('Solo se permiten imágenes PNG, JPEG y WebP');
}
function fileResponse(res,bytes,mime){
 res.writeHead(200,{'Content-Type':mime,'Content-Length':bytes.length,
  'Cache-Control':'public, max-age=31536000, immutable',
  'X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
 res.end(bytes);
}
function assetPath(id,hash,ext){
 return path.join(tenantDir(id),'assets',hash+'.'+ext);
}
function publicGetAsset(req,res,url){
 const m=/^\/public\/assets\/([a-z0-9-]+)\/([a-f0-9]{64})\.(png|jpg|webp)$/.exec(url.pathname);
 if(!m)return error(res,404,'Recurso no encontrado');
 const [,id,hash,ext]=m;
 if(!publicCatalog()[id])return error(res,404,'Shopping todavía no publicado');
 let bytes;
 try{bytes=fs.readFileSync(assetPath(id,hash,ext));}catch{return error(res,404,'Imagen no disponible');}
 if(sha(bytes)!==hash)return error(res,409,'Archivo modificado o corrupto');
 fileResponse(res,bytes,{png:'image/png',jpg:'image/jpeg',webp:'image/webp'}[ext]);
}
function publicGetMap(req,res,url){
 const m=/^\/public\/maps\/([a-z0-9-]+)\/([a-f0-9]{64})\.json$/.exec(url.pathname);
 if(!m)return error(res,404,'Mapa no encontrado');
 const [,id,version]=m;
 if(!publicCatalog()[id])return error(res,404,'Shopping no publicado');
 const file=path.join(tenantDir(id),'versions',version+'.json');
 let bytes;try{bytes=fs.readFileSync(file);}catch{return error(res,404,'Versión no disponible');}
 const meta=read(publicationFile(id))?.meta;
 if(meta?.mapAsset?.version!==version)return error(res,404,'Versión retirada');
 fileResponse(res,bytes,'application/json; charset=utf-8');
}
function listMalls(user){
 if(user.role==='tenant'){
  const d=read(draftFile(user.mallId)),published=read(publicationFile(user.mallId));
  return d||published?[{id:user.mallId,name:d?.name||published?.meta?.name||user.mallId,
   revision:d?.revision||0,publishedVersion:published?.version||null}]:[];
 }
 const root=path.join(ROOT,'tenants');
 try{return fs.readdirSync(root).filter(validSlug).map(id=>{
  const d=read(draftFile(id)),published=read(publicationFile(id));
  return {id,name:d?.name||published?.meta?.name||id,revision:d?.revision||0,
   publishedVersion:published?.version||null};
 });}catch(e){if(e.code==='ENOENT')return[];throw e;}
}
export async function handleMallAdmin(req,res,url){
 try{
  if(req.method==='GET'&&url.pathname==='/catalog')return out(res,200,{schema:'retailnav.catalog.admin.v1',malls:publicCatalog()});
  if(req.method==='GET'&&url.pathname.startsWith('/public/assets/'))
   return publicGetAsset(req,res,url);
  if(req.method==='GET'&&url.pathname.startsWith('/public/maps/'))
   return publicGetMap(req,res,url);
  if(!url.pathname.startsWith('/admin/'))return false;
  if(!['GET','POST'].includes(req.method))return error(res,405,'Método no permitido');
  if(req.method==='POST'&&(!ORIGINS.has(req.headers.origin)||
      req.headers['x-retailnav-admin']!=='1'))
   return error(res,403,'Solicitud administrativa no autorizada');
  if(req.method==='POST'&&url.pathname==='/admin/login'){
   const p=await body(req,4096),username=String(p.username||'').toLowerCase();
   if(!usernameOk(username)||typeof p.password!=='string')return error(res,401,'Credenciales incorrectas');
   let retry=attempts.get(username);
   if(retry&&retry.count>=8&&retry.until>Date.now())return error(res,429,'Demasiados intentos. Probá más tarde.');
   if(!retry||retry.until<Date.now())retry={count:0,until:Date.now()+600000};
   const user=accounts().users[username],dummy='0'.repeat(128);
   const calculated=hashed(p.password.slice(0,128),user?.salt||'0'.repeat(48));
   const good=user&&!user.disabled&&crypto.timingSafeEqual(Buffer.from(calculated,'hex'),
      Buffer.from(user.passwordHash||dummy,'hex'))&&p.password.length<=128;
   if(!good){
    retry.count++;attempts.set(username,retry);
    return error(res,401,'Credenciales incorrectas');
   }
   attempts.delete(username);
   const ticket=issued(),key=sha(ticket);
   sessions.set(key,{username,expiresAt:Date.now()+TTL});
   if(sessions.size>10000)for(const [key,s] of sessions)if(s.expiresAt<Date.now())sessions.delete(key);
   return out(res,200,{username,role:user.role,mallId:user.mallId}, {'Set-Cookie':cookie(ticket)});
  }
  const user=auth(req);
  if(!user)return error(res,401,'Ingresá con tu cuenta administrativa.');
  if(req.method==='GET'&&url.pathname==='/admin/session')
   return out(res,200,{username:user.username,role:user.role,mallId:user.mallId});
  if(req.method==='POST'&&url.pathname==='/admin/logout'){
   const m=/(?:^|;\s*)rn_admin=([A-Za-z0-9_-]{42,70})(?:;|$)/.exec(req.headers.cookie||'');
   if(m)sessions.delete(sha(m[1]));
   return out(res,200,{ok:true},{'Set-Cookie':clearCookie});
  }
  if(req.method==='GET'&&url.pathname==='/admin/malls')return out(res,200,{malls:listMalls(user)});
  const preview=/^\/admin\/malls\/([a-z0-9-]+)\/asset\/([a-f0-9]{64})\.(png|jpg|webp)$/.exec(url.pathname);
  if(req.method==='GET'&&preview){
   const [,slug,hash,ext]=preview;
   if(!requires(user,slug))return error(res,403,'Archivo de otro shopping');
   try{
    const bytes=fs.readFileSync(assetPath(slug,hash,ext));
    if(sha(bytes)!==hash)return error(res,409,'Archivo modificado');
    return fileResponse(res,bytes,{png:'image/png',jpg:'image/jpeg',webp:'image/webp'}[ext]);
   }catch{return error(res,404,'Archivo no disponible');}
  }
  if(req.method==='POST'&&url.pathname==='/admin/accounts'){
   if(user.role!=='platform')return error(res,403,'Solo administradores de RetailNav.');
   const p=await body(req,2048);
   if(!validSlug(p.mallId)||!read(draftFile(p.mallId)))
    return error(res,404,'Primero creá el shopping.');
   const password=issued()+crypto.randomBytes(12).toString('base64url');
   const account=addAdmin({username:p.username,password,role:'tenant',mallId:p.mallId});
   return out(res,201,{account,password,warning:'Contraseña mostrada solo una vez: compartir por canal seguro.'});
  }
  if(req.method==='POST'&&url.pathname==='/admin/malls'){
   if(user.role!=='platform')return error(res,403,'Solo administradores de RetailNav.');
   const p=await body(req,4096);
   slugOrReject(p.id);
   if(read(draftFile(p.id))||read(publicationFile(p.id)))return error(res,409,'Ya existe este shopping');
   const draft={id:p.id,name:String(p.name||'').trim(),city:String(p.city||'').trim(),
    website:String(p.website||'').trim(),theme:{...defaults},logoUrl:null,
    floors:[],units:[],pois:[],revision:1,updatedBy:user.username,
    updatedAt:new Date().toISOString()};
   validateDraft(draft);
   atomic(draftFile(p.id),draft);
   return out(res,201,{draft});
  }
  const match=/^\/admin\/malls\/([a-z0-9-]+)(?:\/([a-z-]+))?$/.exec(url.pathname);
  if(!match)return error(res,404,'Ruta administrativa no encontrada');
  const [,id,command]=match;slugOrReject(id);
  if(!requires(user,id))return error(res,403,'No tenés permisos sobre este shopping.');
  const existing=read(draftFile(id));
  if(!existing)return error(res,404,'No existe un borrador de este shopping.');
  if(req.method==='GET'&&!command)
   return out(res,200,{draft:existing,published:read(publicationFile(id))?.version||null,
    history:read(historyFile(id),[])});
  if(req.method==='POST'&&command==='draft'){
   const p=await body(req);
   if(p.revision!==existing.revision)return error(res,409,'Otro operador modificó el shopping. Actualizá la página antes de guardar.');
   const input=p.draft;
   if(!input||input.id!==id)return error(res,400,'Identidad del shopping no coincide');
   const candidate={
    id,name:input.name,city:input.city,website:input.website||'',
    logoUrl:input.logoUrl||null,theme:validateTheme(input.theme||{}),
    floors:input.floors,units:input.units,pois:input.pois,
    preservedCatalog:input.preservedCatalog||existing.preservedCatalog||null,
    scale:input.scale??.15,revision:existing.revision+1,updatedBy:user.username,
    updatedAt:new Date().toISOString()
   };
   const officialSourceLogo=id==='aventura'&&candidate.logoUrl==='branding/aventura-logo.svg';
   if(candidate.logoUrl&&!officialSourceLogo&&!/^api\/public\/assets\/[a-z0-9-]+\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(candidate.logoUrl))
    return error(res,400,'El logo debe provenir de los archivos del shopping');
   if(candidate.logoUrl&&!officialSourceLogo&&!candidate.logoUrl.startsWith('api/public/assets/'+id+'/'))
    return error(res,403,'No podés usar recursos de otro shopping');
   for(const f of candidate.floors||[]){
    const isOriginal=Boolean(f.compactFloor)&&candidate.preservedCatalog?.floorReferences?.[f.id]?.url===f.imageUrl;
    if(f.imageUrl&&!isOriginal&&(!/^api\/public\/assets\/[a-z0-9-]+\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(f.imageUrl)||
      !f.imageUrl.startsWith('api/public/assets/'+id+'/')))
     return error(res,403,'Imagen de planta de otro shopping');
   }
   validateDraft(candidate);
   atomic(draftFile(id),candidate);
   return out(res,200,{draft:candidate});
  }
  if(req.method==='POST'&&command==='asset'){
   const p=await body(req,8*1024*1024);
   if(!['logo','floor'].includes(p.kind)||typeof p.base64!=='string'||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(p.base64))return error(res,400,'Imagen incorrecta');
   const bytes=Buffer.from(p.base64,'base64');
   let info;
   try{info=validFile(bytes,p.mime);}catch(e){return error(res,400,e.message);}
   const checksum=sha(bytes);
   const target=assetPath(id,checksum,info.ext);
   fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
   if(!fs.existsSync(target))fs.writeFileSync(target,bytes,{mode:0o600,flag:'wx'});
   return out(res,201,{url:'api/public/assets/'+id+'/'+checksum+'.'+info.ext,
     sha256:checksum,bytes:bytes.length,...info});
  }
  if(req.method==='POST'&&command==='publish'){
   const p=await body(req,1024);
   if(p.revision!==existing.revision)return error(res,409,'Publicación bloqueada: el borrador cambió.');
   const built=compile(existing);
   const {version,payload,meta}=bundle(built);
   const versions=path.join(tenantDir(id),'versions');
   fs.mkdirSync(versions,{recursive:true,mode:0o700});
   const target=path.join(versions,version+'.json');
   if(!fs.existsSync(target))fs.writeFileSync(target,payload,{mode:0o600,flag:'wx'});
   atomic(path.join(versions,version+'.meta.json'),meta);
   atomic(publicationFile(id),{version,meta,publishedAt:new Date().toISOString(),by:user.username});
   const history=read(historyFile(id),[]);
   history.unshift({version,publishedAt:new Date().toISOString(),by:user.username,
    revision:existing.revision,floors:built.floorLabels.length});
   atomic(historyFile(id),history.slice(0,60));
   return out(res,200,{version,meta,notice:'Publicación provisional; no habilita navegación física.'});
  }
  if(req.method==='POST'&&command==='rollback'){
   const p=await body(req,1024);
   if(typeof p.version!=='string'||!/^[a-f0-9]{64}$/.test(p.version))
    return error(res,400,'Versión incorrecta');
   const log=read(historyFile(id),[]);
   if(!log.some(item=>item.version===p.version))return error(res,404,'Versión no registrada');
   const file=path.join(tenantDir(id),'versions',p.version+'.json');
   const payload=read(file);
   if(!payload||payload.mallId!==id)return error(res,404,'Archivo de la versión no disponible');
   // The historical metadata is preserved alongside the versioned map in history.
   const meta=read(path.join(tenantDir(id),'versions',p.version+'.meta.json'));
   if(!meta)return error(res,409,'Esta versión no tiene metadatos completos para revertir');
   atomic(publicationFile(id),{version:p.version,meta,publishedAt:new Date().toISOString(),by:user.username,rollback:true});
   return out(res,200,{version:p.version,meta});
  }
  return error(res,404,'Acción no disponible');
 }catch(e){
  if(e?.status)return error(res,e.status,e.message);
  if(/polígono|planta|shopping|imagen|paleta|color|coordenada|triangular|vértice|identificador|fuera|local|servicio|máximo|demasiados|inválid|contraseña|publica/i.test(e.message))
   return error(res,400,e.message);
  console.error('Mall-admin error:',e.message);
  return error(res,500,'No se pudo completar la operación administrativa');
 }
}
export {ROOT};
