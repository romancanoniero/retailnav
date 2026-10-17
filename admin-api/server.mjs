// RetailNav administrative control plane. Separate from anonymous visitor identities.
// Node 22, no third-party dependencies. All writes stay in a private persistent directory.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const uid=()=>crypto.randomUUID();
const sha=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const safeId=s=>typeof s==='string' && /^[a-z0-9][a-z0-9-]{1,79}$/.test(s);
const validEmail=s=>typeof s==='string'&&s.length<=200&&/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(s);
const eq=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const hashPassword=(password,salt=crypto.randomBytes(16).toString('hex'))=>
  salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
const verifyPassword=(password,record)=>{
  if(typeof record!=='string'||!record.includes(':'))return false;
  const salt=record.split(':')[0];
  return eq(hashPassword(password,salt),record);
};
function totp(secret,now=Date.now()){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits=0,value=0,bytes=[];
  for(const ch of secret.toUpperCase().replace(/=+$/,'')){
    const v=alphabet.indexOf(ch);if(v<0)throw Error('Invalid TOTP secret');
    value=(value<<5)|v;bits+=5;
    if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}
  }
  const key=Buffer.from(bytes);
  if(key.length<10)throw Error('TOTP seed too short');
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(now/30000)));
  const digest=crypto.createHmac('sha1',key).update(counter).digest();
  const offset=digest[digest.length-1]&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
function validTotp(seed,code,now=Date.now()){
  return typeof code==='string'&&/^\\d{6}$/.test(code)&&[-30000,0,30000].some(delta=>eq(code,totp(seed,now+delta)));
}
function response(res,status,payload,cookie){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
    'Content-Length':Buffer.byteLength(body),...(cookie?{'Set-Cookie':cookie}:{})});
  res.end(body);
}
function err(res,status,message){response(res,status,{error:message});}
async function json(req){
  let size=0,data='';
  for await(const c of req){size+=c.length;if(size>512000)throw Object.assign(Error('Body too large'),{code:413});data+=c;}
  let parsed;try{parsed=JSON.parse(data||'{}');}catch{throw Object.assign(Error('Invalid JSON'),{code:400});}
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')
    throw Object.assign(Error('Expected object'),{code:400});
  return parsed;
}
function polygonArea(pts){return Math.abs(pts.reduce((a,p,i)=>{const q=pts[(i+1)%pts.length];return a+p[0]*q[1]-q[0]*p[1];},0))/2;}
function segmentsIntersect(a,b,c,d){
  const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  const s=[cross(a,b,c),cross(a,b,d),cross(c,d,a),cross(c,d,b)];
  return s[0]*s[1]<0&&s[2]*s[3]<0;
}
function validateDraft(doc,source){
  const problems=[];
  const floors=new Map((source?.floors||[]).map(f=>[f.id,f]));
  if(!doc||!Array.isArray(doc.features)||!Array.isArray(doc.connectors)||!Array.isArray(doc.transforms)||!Array.isArray(doc.occupancies))
    return ['Missing features, connectors, transforms or occupancies arrays'];
  if(doc.features.length>1500||doc.connectors.length>300||doc.transforms.length>100||doc.occupancies.length>5000)
    return ['Draft exceeds limits'];
  const seen=new Set();
  for(const f of doc.features){
    if(!f||typeof f.id!=='string'||f.id.length>90||seen.has(f.id)){problems.push('Duplicate/invalid feature id');continue;}
    seen.add(f.id);
    const floor=floors.get(f.floor);
    if(!floor){problems.push('Unknown floor for '+f.id);continue;}
    if(!['unit','anchor','corridor','poi'].includes(f.kind)||!['manual','survey','official'].includes(f.source))
      problems.push('Unknown feature type/source: '+f.id);
    const pts=f.vertices;
    if(!Array.isArray(pts)||pts.length<3||pts.length>100||
      pts.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||n<0)||
        p[0]>floor.imageSize[0]||p[1]>floor.imageSize[1])){
      problems.push('Out of bounds/invalid polygon: '+f.id);continue;
    }
    if(polygonArea(pts)<5)problems.push('Degenerate polygon: '+f.id);
    for(let i=0;i<pts.length;i++)for(let j=i+2;j<pts.length;j++){
      if(i===0&&j===pts.length-1)continue;
      if(segmentsIntersect(pts[i],pts[(i+1)%pts.length],pts[j],pts[(j+1)%pts.length]))
        problems.push('Self crossing polygon: '+f.id);
    }
    if(typeof f.evidence!=='string'||f.evidence.trim().length<5||f.evidence.length>1000)
      problems.push('Missing trace evidence: '+f.id);
    if(f.replacesSourceId!=null&&!String(f.replacesSourceId).trim())
      problems.push('Invalid source reference: '+f.id);
  }
  for(const c of doc.connectors){
    if(!c||!['lift','escalator','stair','ramp'].includes(c.kind)||!Array.isArray(c.landings)||c.landings.length<2||
      c.landings.some(l=>!floors.has(l.floor)||!Number.isFinite(l.x)||!Number.isFinite(l.y)||
        l.x<0||l.y<0||l.x>floors.get(l.floor).imageSize[0]||l.y>floors.get(l.floor).imageSize[1]))
      problems.push('Invalid connector/landing: '+(c?.id||'?'));
    if(typeof c?.evidence!=='string'||c.evidence.trim().length<5)
      problems.push('Connector lacks source evidence: '+(c?.id||'?'));
    if(!['unverified','field-checked'].includes(c?.verification))
      problems.push('Connector verification must be explicit: '+(c?.id||'?'));
  }
  for(const t of doc.transforms){
    if(!t||!floors.has(t.floor)||!Array.isArray(t.matrix)||t.matrix.length!==9||
      t.matrix.some(n=>!Number.isFinite(n)||Math.abs(n)>100000)||
      Math.abs(t.matrix[0]*t.matrix[4]-t.matrix[1]*t.matrix[3])<1e-7)
      problems.push('Invalid floor alignment transform');
    if(!Array.isArray(t?.controlPoints)||t.controlPoints.length<2)
      problems.push('Alignment lacks two reference points');
  }
  for(const o of doc.occupancies){
    if(!o||typeof o.spaceId!=='string'||!o.spaceId||
      (o.merchantId!=null&&typeof o.merchantId!=='string')||
      (o.code!=null&&(typeof o.code!=='string'||o.code.length>80)))
      problems.push('Invalid physical space/occupancy');
  }
  return [...new Set(problems)].slice(0,80);
}
const emptyDoc=()=>({features:[],connectors:[],transforms:[],occupancies:[]});
export function createAdminApp(options={}){
  const dataDir=options.dataDir||process.env.RETAILNAV_ADMIN_DATA_DIR||'/data/admin';
  const catalogDir=options.catalogDir||process.env.RETAILNAV_MALLS_DIR||'/catalog/malls';
  const apiPath=options.apiPath||process.env.RETAILNAV_ADMIN_COOKIE_PATH||'/retailnav';
  const origins=new Set((options.origins||process.env.RETAILNAV_ADMIN_ALLOWED_ORIGINS||
    'https://improvingyourreality.com,https://www.improvingyourreality.com').split(',').filter(Boolean));
  const bootstrap=options.bootstrap||{email:process.env.RETAILNAV_ADMIN_OWNER_EMAIL,
    password:process.env.RETAILNAV_ADMIN_OWNER_PASSWORD,totp:process.env.RETAILNAV_ADMIN_OWNER_TOTP};
  if(!/^\\/[a-zA-Z0-9/_-]*$/.test(apiPath))throw Error('Unsafe cookie path');
  fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
  const file=path.join(dataDir,'admin-state.json');
  let db;
  if(fs.existsSync(file))db=JSON.parse(fs.readFileSync(file,'utf8'));
  else db={schema:1,users:{},sessions:{},tenants:{},mallTenants:{},revisions:{},published:{},audit:[]};
  if(db.schema!==1)throw Error('Unsupported administrative state; migration required');
  function save(){
    const temporary=file+'.'+process.pid+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify(db),{mode:0o600});
    fs.renameSync(temporary,file);
  }
  if(!Object.keys(db.users).length&&bootstrap.email&&bootstrap.password&&bootstrap.totp){
    if(!validEmail(bootstrap.email)||bootstrap.password.length<14||!/^[A-Z2-7]{16,}$/i.test(bootstrap.totp))
      throw Error('Invalid bootstrap owner credentials / TOTP seed');
    const id=uid();
    db.users[id]={id,email:bootstrap.email.toLowerCase(),passwordHash:hashPassword(bootstrap.password),
      totpSeed:bootstrap.totp,roles:[{role:'platform_owner',tenantId:null,merchantId:null}],active:true};
    save();
  }
  const publicMalls=()=>{
    if(!fs.existsSync(catalogDir))return [];
    return fs.readdirSync(catalogDir,{withFileTypes:true}).filter(d=>d.isDirectory()&&safeId(d.name)&&
      fs.existsSync(path.join(catalogDir,d.name,'mall.json'))).map(d=>{
        try{const m=JSON.parse(fs.readFileSync(path.join(catalogDir,d.name,'mall.json'),'utf8'));
          return {id:d.name,name:m.name,city:m.city,status:m.status,tenantId:db.mallTenants[d.name]||null,
            floorCount:(m.floors||[]).length,navigable:m.navigable===true};}
        catch{return {id:d.name,name:d.name,corrupt:true,tenantId:db.mallTenants[d.name]||null};}
      });
  };
  function source(mall){
    if(!safeId(mall))return null;
    const f=path.join(catalogDir,mall,'mall.json');
    if(!fs.existsSync(f))return null;
    const x=JSON.parse(fs.readFileSync(f,'utf8'));
    if(x.id!==mall)throw Error('Source ID mismatch');
    return x;
  }
  function has(user,role,tenantId,merchantId){
    if(!user||!user.active)return false;
    return user.roles.some(r=>{
      if(r.role==='platform_owner')return true;
      if(role==='platform'&&r.role==='platform_admin')return true;
      if(role==='read'&&['platform_admin','platform_auditor'].includes(r.role))return true;
      if(!tenantId||r.tenantId!==tenantId)return false;
      if(role==='read')return ['mall_owner','mall_admin','mall_cartographer','mall_content_editor','mall_analyst'].includes(r.role);
      if(role==='edit')return ['mall_owner','mall_admin','mall_cartographer'].includes(r.role);
      if(role==='publish')return ['mall_owner','mall_admin'].includes(r.role);
      if(role==='merchant')return ['merchant_owner','merchant_editor'].includes(r.role)&&r.merchantId===merchantId;
      return false;
    });
  }
  function log(actor,action,mallId,detail){
    db.audit.push({id:uid(),timestamp:new Date().toISOString(),actor:actor.id,action,mallId,detail});
    if(db.audit.length>10000)db.audit.splice(0,db.audit.length-10000);
  }
  const cookie=(v,age)=>'rn_admin_session='+v+'; Path='+apiPath+'; HttpOnly; Secure; SameSite=Strict; Max-Age='+age;
  const sessions=()=>{let changed=false;for(const [key,value] of Object.entries(db.sessions))
    if(value.expires<Date.now()||!db.users[value.userId]?.active){delete db.sessions[key];changed=true;}
    if(changed)save();};
  function current(req){
    const c=/(?:^|;\\s*)rn_admin_session=([A-Za-z0-9_-]{30,100})(?:;|$)/.exec(req.headers.cookie||'');
    const s=c&&db.sessions[sha(c[1])];
    return s&&s.expires>Date.now()?{user:db.users[s.userId],session:s,token:c[1]}:null;
  }
  const tries=new Map();
  const app=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost'),p=url.pathname,method=req.method;
      if(method==='GET'&&p==='/health')
        return response(res,200,{ok:true,service:'retailnav-admin',initialized:Object.keys(db.users).length>0});
      if(!['GET','POST','PUT','DELETE'].includes(method))return err(res,405,'Method not allowed');
      if(method!=='GET'){
        if(!origins.has(req.headers.origin))return err(res,403,'Origin not allowed');
        if(req.headers['content-type']?.split(';')[0]!=='application/json')return err(res,415,'JSON required');
      }
      const auth=current(req);
      if(method==='POST'&&p==='/v1/auth/login'){
        const key=sha(req.socket.remoteAddress||'unknown');
        const rate=tries.get(key)||{count:0,until:Date.now()+60000};
        if(rate.until<Date.now()){rate.count=0;rate.until=Date.now()+60000;}
        rate.count++;tries.set(key,rate);
        if(tries.size>4000)tries.clear();
        if(rate.count>8)return err(res,429,'Too many attempts');
        const body=await json(req);
        const user=Object.values(db.users).find(u=>u.email===String(body.email||'').toLowerCase()&&u.active);
        if(!user||typeof body.password!=='string'||!verifyPassword(body.password,user.passwordHash)||
          !validTotp(user.totpSeed,body.totp))return err(res,401,'Invalid credentials or MFA');
        const secret=crypto.randomBytes(32).toString('base64url'),csrf=crypto.randomBytes(24).toString('base64url');
        db.sessions[sha(secret)]={userId:user.id,csrf,expires:Date.now()+8*3600000};
        log(user,'auth.login',null,'mfa');save();rate.count=0;
        return response(res,200,{user:{id:user.id,email:user.email,roles:user.roles},csrf},cookie(secret,28800));
      }
      if(!auth)return err(res,401,'Administrative login required');
      const user=auth.user;
      if(!user?.active)return err(res,401,'Account revoked');
      if(method!=='GET'&&!eq(req.headers['x-retailnav-csrf']||'',auth.session.csrf))
        return err(res,403,'CSRF token missing');
      if(method==='GET'&&p==='/v1/auth/me')
        return response(res,200,{user:{id:user.id,email:user.email,roles:user.roles},csrf:auth.session.csrf});
      if(method==='POST'&&p==='/v1/auth/logout'){
        delete db.sessions[sha(auth.token)];save();
        return response(res,200,{ok:true},cookie('',0));
      }
      if(method==='GET'&&p==='/v1/tenants'){
        const list=Object.values(db.tenants).filter(t=>has(user,'read',t.id));
        return response(res,200,{items:list});
      }
      if(method==='POST'&&p==='/v1/tenants'){
        if(!has(user,'platform'))return err(res,403,'Platform role required');
        const d=await json(req);
        if(typeof d.name!=='string'||d.name.trim().length<3||d.name.length>120)return err(res,422,'Name required');
        const t={id:uid(),name:d.name.trim(),status:'active',createdAt:new Date().toISOString()};
        db.tenants[t.id]=t;log(user,'tenant.created',null,t.id);save();return response(res,201,t);
      }
      if(method==='GET'&&p==='/v1/malls'){
        return response(res,200,{items:publicMalls().filter(m=>has(user,'read',m.tenantId))});
      }
      if(method==='POST'&&p==='/v1/users'){
        if(!has(user,'platform'))return err(res,403,'Platform role required');
        const d=await json(req),role=d.role,tenantId=d.tenantId||null,merchantId=d.merchantId||null;
        const allowed=['platform_admin','platform_auditor','mall_owner','mall_admin','mall_cartographer',
          'mall_content_editor','mall_analyst','merchant_owner','merchant_editor'];
        if(!validEmail(d.email)||!allowed.includes(role)||typeof d.password!=='string'||
          d.password.length<14||typeof d.totpSeed!=='string'||!/^[A-Z2-7]{16,}$/i.test(d.totpSeed)||
          (role.startsWith('mall_')&&!db.tenants[tenantId])||
          (role.startsWith('merchant_')&&(!db.tenants[tenantId]||!safeId(merchantId)))||
          Object.values(db.users).some(u=>u.email===d.email.toLowerCase()))
          return err(res,422,'Invalid user, scopes or MFA seed');
        const id=uid();
        db.users[id]={id,email:d.email.toLowerCase(),passwordHash:hashPassword(d.password),
          totpSeed:d.totpSeed,roles:[{role,tenantId,merchantId}],active:true};
        log(user,'iam.user.created',null,id);save();return response(res,201,{id,email:d.email,role,tenantId,merchantId});
      }
      const userMatch=/^\\/v1\\/users\\/([0-9a-f-]{36})$/.exec(p);
      if(userMatch&&method==='DELETE'){
        if(!has(user,'platform')||userMatch[1]===user.id)return err(res,403,'Forbidden');
        const target=db.users[userMatch[1]];if(!target)return err(res,404,'Not found');
        target.active=false;
        for(const [sid,s] of Object.entries(db.sessions))if(s.userId===target.id)delete db.sessions[sid];
        log(user,'iam.user.revoked',null,target.id);save();return response(res,200,{ok:true});
      }
      const mallMatch=/^\\/v1\\/malls\\/([a-z0-9-]{2,80})(?:\\/(.*))?$/.exec(p);
      if(!mallMatch)return err(res,404,'Unknown endpoint');
      const mallId=mallMatch[1],suffix=mallMatch[2]||'';
      const mall=source(mallId);
      if(!mall)return err(res,404,'Mall not found in source registry');
      if(method==='POST'&&suffix==='assign'){
        if(!has(user,'platform'))return err(res,403,'Platform role required');
        const d=await json(req);
        if(!db.tenants[d.tenantId])return err(res,422,'Unknown tenant');
        db.mallTenants[mallId]=d.tenantId;
        log(user,'mall.tenant.assigned',mallId,d.tenantId);save();
        return response(res,200,{mallId,tenantId:d.tenantId});
      }
      const tenantId=db.mallTenants[mallId]||null;
      if(!has(user,'read',tenantId))return err(res,404,'Mall unavailable');
      if(method==='GET'&&suffix==='map'){
        return response(res,200,{mallId,tenantId,name:mall.name,status:mall.status,
          navigable:mall.navigable===true,warning:mall.warning||'',
          floors:(mall.floors||[]).map(f=>({id:f.id,name:f.name,imageSize:f.imageSize,
            referenceUrl:'reference/'+mallId+'/'+f.id+'.webp'})),
          current:db.published[mallId]||null,
          revisions:(db.revisions[mallId]||[]).map(r=>({id:r.id,version:r.version,status:r.status,
            createdBy:r.createdBy,approvedBy:r.approvedBy||null,updatedAt:r.updatedAt}))});
      }
      const sourceMatch=/^source\\/([a-zA-Z0-9-]{1,12})$/.exec(suffix);
      if(method==='GET'&&sourceMatch){
        const f=mall.floors.find(x=>x.id===sourceMatch[1]);
        if(!f||!/^[a-zA-Z0-9.-]+\\.geometry\\.zlib\\.b64$/.test(f.geometry))return err(res,404,'Floor unavailable');
        const raw=fs.readFileSync(path.join(catalogDir,mallId,f.geometry),'utf8').trim();
        const geometry=JSON.parse(zlib.inflateSync(Buffer.from(raw,'base64')).toString('utf8'));
        const features=geometry.map(item=>{
          let x=0,y=0,vertices=[];
          for(let i=0;i<item[3].length;i+=2){x+=item[3][i];y+=item[3][i+1];vertices.push([x/2,y/2]);}
          return {id:String(item[0]),kind:Number(item[1]),vertices,source:'imported-provisional'};
        });
        return response(res,200,{mallId,floor:f.id,imageSize:f.imageSize,features});
      }
      if(method==='GET'&&suffix==='revisions'){
        return response(res,200,{items:(db.revisions[mallId]||[]).map(r=>({id:r.id,status:r.status,version:r.version,
          updatedAt:r.updatedAt,createdBy:r.createdBy,approvedBy:r.approvedBy||null}))});
      }
      if(method==='POST'&&suffix==='revisions'){
        if(!has(user,'edit',tenantId))return err(res,403,'Map editor role required');
        const rows=db.revisions[mallId]||[];
        const latest=rows.filter(r=>r.status==='draft').at(-1);
        if(latest)return response(res,409,{error:'Existing draft must be completed before another is opened',revisionId:latest.id});
        const r={id:uid(),mallId,status:'draft',version:1,createdBy:user.id,
          updatedAt:new Date().toISOString(),document:emptyDoc()};
        rows.push(r);db.revisions[mallId]=rows;log(user,'map.draft.created',mallId,r.id);save();
        return response(res,201,r);
      }
      const revMatch=/^revisions\\/([0-9a-f-]{36})(?:\\/(validate|submit|approve|publish|reject))?$/.exec(suffix);
      if(revMatch){
        const r=(db.revisions[mallId]||[]).find(x=>x.id===revMatch[1]);
        if(!r)return err(res,404,'Revision not found');
        const action=revMatch[2]||'';
        if(method==='GET'&&!action)return response(res,200,r);
        if(method==='PUT'&&!action){
          if(!has(user,'edit',tenantId)||r.status!=='draft')return err(res,403,'Draft not editable');
          if(req.headers['if-match']!=='"'+r.version+'"')return err(res,409,'Draft changed: reload and retry');
          const d=await json(req),problems=validateDraft(d,mall);
          if(problems.length)return response(res,422,{errors:problems});
          r.document={features:d.features,connectors:d.connectors,transforms:d.transforms,occupancies:d.occupancies};
          r.version++;r.updatedAt=new Date().toISOString();
          log(user,'map.draft.updated',mallId,r.id+':'+r.version);save();
          return response(res,200,r);
        }
        if(method==='POST'&&action==='validate'){
          return response(res,200,{ok:validateDraft(r.document,mall).length===0,issues:validateDraft(r.document,mall),
            navigationVerified:false,sourceQuality:mall.status,publicMapUnchanged:true});
        }
        if(method==='POST'&&action==='submit'){
          if(!has(user,'edit',tenantId)||r.status!=='draft')return err(res,403,'Cannot submit');
          const issues=validateDraft(r.document,mall);
          if(issues.length)return response(res,422,{errors:issues});
          if(!r.document.features.length&&!r.document.connectors.length&&!r.document.transforms.length)
            return err(res,422,'Empty revision');
          r.status='in_review';r.submittedAt=new Date().toISOString();
          log(user,'map.review.requested',mallId,r.id);save();return response(res,200,r);
        }
        if(method==='POST'&&action==='reject'){
          if(!has(user,'publish',tenantId)||r.status!=='in_review')return err(res,403,'Cannot reject');
          r.status='draft';r.approvedBy=null;
          log(user,'map.review.rejected',mallId,r.id);save();return response(res,200,r);
        }
        if(method==='POST'&&action==='approve'){
          if(!has(user,'publish',tenantId)||r.status!=='in_review'||r.createdBy===user.id)
            return err(res,403,'Independent approver required');
          r.status='approved';r.approvedBy=user.id;r.approvedAt=new Date().toISOString();
          log(user,'map.review.approved',mallId,r.id);save();return response(res,200,r);
        }
        if(method==='POST'&&action==='publish'){
          if(!has(user,'publish',tenantId)||r.status!=='approved'||r.approvedBy!==user.id)
            return err(res,403,'Approved release requires authorized approver');
          // A release snapshot is immutable, but deliberately is NOT applied to unverified visitor geometry.
          const payload={schema:'retailnav.editor.overlay.v1',mallId,revisionId:r.id,
            sourceStatus:mall.status,document:r.document,navigable:false};
          const digest=sha(JSON.stringify(payload));
          const release={revisionId:r.id,hash:digest,publishedAt:new Date().toISOString(),
            publishedBy:user.id,navigable:false,visitorIntegration:'pending-verified-build'};
          db.published[mallId]=release;r.status='published';
          log(user,'map.overlay.published',mallId,digest);save();
          return response(res,200,{release,warning:'Published to admin overlay registry only; visitor map remains unchanged until verified build'});
        }
      }
      if(method==='GET'&&suffix==='published'){
        const release=db.published[mallId];
        if(!release)return err(res,404,'No editorial release');
        const rev=(db.revisions[mallId]||[]).find(r=>r.id===release.revisionId);
        return response(res,200,{release,document:rev.document});
      }
      if(method==='POST'&&suffix==='rollback'){
        if(!has(user,'publish',tenantId))return err(res,403,'Permission denied');
        const d=await json(req);
        const old=(db.revisions[mallId]||[]).find(r=>r.id===d.revisionId&&r.status==='published');
        if(!old)return err(res,422,'Choose a previously published revision');
        db.published[mallId]={revisionId:old.id,hash:sha(JSON.stringify(old.document)),
          publishedAt:new Date().toISOString(),publishedBy:user.id,navigable:false,
          visitorIntegration:'pending-verified-build'};
        log(user,'map.overlay.rollback',mallId,old.id);save();
        return response(res,200,{release:db.published[mallId]});
      }
      if(method==='GET'&&suffix==='audit'){
        if(!has(user,'publish',tenantId))return err(res,403,'Permission denied');
        return response(res,200,{items:db.audit.filter(x=>x.mallId===mallId).slice(-200)});
      }
      return err(res,404,'Unknown endpoint');
    }catch(e){
      if(e.code&&Number.isInteger(e.code))return err(res,e.code,e.message);
      console.error('Admin API error',e.message);
      return err(res,500,'Administrative operation failed');
    }
  });
  app.requestTimeout=15000;app.headersTimeout=16000;
  return app;
}
const app=createAdminApp();
if(process.env.NODE_ENV!=='test')
  app.listen(Number(process.env.RETAILNAV_ADMIN_PORT||3182),'0.0.0.0',
    ()=>console.log('RetailNav admin control plane ready'));
export {app};
