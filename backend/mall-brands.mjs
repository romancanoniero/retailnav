// Mall identity register for the present RetailNav JSON-backed prototype.
// Stored outside web releases at RETAILNAV_DATA_DIR/mall-brands.json.
// Public endpoint never exposes disk paths, secrets, or source data from other tenants.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const NAME='mall-brands.json';
const AV_MALL='aventura';
const AV_FILE='aventura-mark.svg';
const ORIGINAL='https://aventuramall.com/wp-content/uploads/2025/01/logo-2.svg';
const HEX=/^[a-f0-9]{64}$/;
function digest(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function verifyOfficialSvg(bytes){
 if(bytes.length<200||bytes.length>100000)return false;
 const text=bytes.toString('utf8');
 return /^\s*<svg\b/i.test(text)&&/viewBox="0 0 112 69"/.test(text)&&
  /#100F0F/i.test(text)&&!/<\s*(?:script|foreignObject|iframe|image)\b/i.test(text)&&
  !/\b(?:onload|onerror|javascript:|data:text\/html)/i.test(text);
}
function safelyRead(file){
 try{return fs.readFileSync(file);}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function atomic(file,value){
 const tmp=file+'.'+process.pid+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
 fs.renameSync(tmp,file);
}
export function createMallBrandRegistry(dataDir){
 if(typeof dataDir!=='string'||!path.isAbsolute(dataDir))throw Error('The mall brand database must have an absolute data root');
 const file=path.join(dataDir,NAME);
 const assets=path.join(dataDir,'brand-assets');
 fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
 const existing=safelyRead(file);
 let database=existing?JSON.parse(existing.toString('utf8')):{schema:'retailnav.mall.brands.v1',records:{}};
 if(database.schema!=='retailnav.mall.brands.v1'||!database.records||
     typeof database.records!=='object'||Array.isArray(database.records))
  throw Error('Unexpected mall brand database schema');
 const source=path.join(assets,AV_FILE);
 const src=safelyRead(source);
 // The installation brings the first-party source SVG into this persistent
 // volume. Never seed an entry until the actual local file is valid.
 if(src&&verifyOfficialSvg(src)&&!database.records[AV_MALL]){
  database.records[AV_MALL]={
   mallId:AV_MALL,mallName:'Aventura Mall',logo:{
    file:AV_FILE,sourceUrl:ORIGINAL,sha256:digest(src),
    mime:'image/svg+xml',width:112,height:69,
    url:'api/mall-brands/aventura/logo.svg',
    placement:'left-of-name',assetKind:'symbol'
   },
   registeredAt:new Date().toISOString()
  };
  atomic(file,database);
 }
 function logo(mallId){
  if(mallId!==AV_MALL)return null;
  const record=database.records[mallId];
  if(!record?.logo||record.logo.file!==AV_FILE||record.logo.sourceUrl!==ORIGINAL||
     !HEX.test(record.logo.sha256)||record.logo.mime!=='image/svg+xml')return null;
  const bytes=safelyRead(source);
  if(!bytes||!verifyOfficialSvg(bytes)||digest(bytes)!==record.logo.sha256)return null;
  return {record,bytes};
 }
 function send(res,code,message){
  const body=JSON.stringify(message);
  res.writeHead(code,{
   'Content-Type':'application/json; charset=utf-8',
   'Content-Length':Buffer.byteLength(body),
   'Cache-Control':'public,max-age=60',
   'X-Content-Type-Options':'nosniff',
   'Referrer-Policy':'no-referrer'
  });
  res.end(body);
 }
 function handle(req,res,url){
  const m=/^\/mall-brands\/([a-z0-9-]+)(\/logo\.svg)?$/.exec(url.pathname);
  if(!m)return false;
  if(req.method!=='GET'){send(res,405,{error:'Método no permitido'});return true;}
  const data=logo(m[1]);
  if(!data){send(res,404,{error:'Logo todavía no disponible'});return true;}
  if(m[2]){
   res.writeHead(200,{
    'Content-Type':'image/svg+xml; charset=utf-8',
    'Content-Length':data.bytes.length,
    'Cache-Control':'public, max-age=300',
    'ETag':'"'+data.record.logo.sha256+'"',
    'X-Content-Type-Options':'nosniff',
    'Cross-Origin-Resource-Policy':'same-origin',
    'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Referrer-Policy':'no-referrer'
   });
   res.end(data.bytes);
   return true;
  }
  send(res,200,{
   mallId:data.record.mallId,mallName:data.record.mallName,
   logo:{url:data.record.logo.url,sha256:data.record.logo.sha256,
    mime:data.record.logo.mime,sourceUrl:data.record.logo.sourceUrl,
    placement:data.record.logo.placement,assetKind:data.record.logo.assetKind},
   available:true
  });
  return true;
 }
 return {handle,logo,dbFile:file};
}
