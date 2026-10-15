// Tenant floor editor -> RetailNav compact map format. NO invented navigation grids.
import crypto from 'node:crypto';
const validId=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/.test(s);
export const validSlug=s=>typeof s==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)&&s.length<=72;
export const isHex=s=>typeof s==='string'&&/^#[a-fA-F0-9]{6}$/.test(s);
export const defaults=Object.freeze({
 background:'#f3efe6',surface:'#ffffff',text:'#17150f',muted:'#706e6e',
 accent:'#17150f',accentText:'#ffffff',border:'#e1d9c9',
 mapUnit:'#847b6b',mapAnchor:'#3a352c',mapCorridor:'#e1d9c9',mapZone:'#c7beac',
 mapSlab:'#e7dfd1',mapOutline:'#17150f',font:'editorial',corners:'soft'
});
const themeKeys=Object.keys(defaults);
export function validateTheme(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Paleta inválida.');
 const out={...defaults};
 for(const [key,value] of Object.entries(raw)){
  if(!themeKeys.includes(key))throw Error('Campo de apariencia desconocido: '+key);
  if(key==='font'){if(!['editorial','modern','rounded'].includes(value))throw Error('Tipografía desconocida');}
  else if(key==='corners'){if(!['soft','square'].includes(value))throw Error('Estilo de bordes desconocido');}
  else if(!isHex(value))throw Error('Color hexadecimal no válido: '+key);
  out[key]=value;
 }
 return out;
}
const safeText=(v,max=150)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u001f\u007f<>]/.test(v);
export function validateDraft(d){
 if(!d||typeof d!=='object'||Array.isArray(d)||!validSlug(d.id))throw Error('Identificador del shopping inválido');
 if(!safeText(d.name,100)||!d.name.trim()||!safeText(d.city,130))throw Error('Nombre o ciudad inválidos');
 if(d.website&&(!safeText(d.website,350)||!/^https:\/\//.test(d.website)))throw Error('La web oficial debe ser HTTPS');
 validateTheme(d.theme||{});
 if(!Array.isArray(d.floors)||d.floors.length>25)throw Error('Máximo 25 plantas');
 if(!Array.isArray(d.units)||d.units.length>5000)throw Error('Máximo 5000 locales');
 if(!Array.isArray(d.pois)||d.pois.length>1000)throw Error('Demasiados servicios');
 const ids=new Set();
 for(const f of d.floors){
  if(!f||!validId(f.id)||!safeText(f.name,100)||!Number.isInteger(f.width)||!Number.isInteger(f.height)||
    f.width<120||f.height<120||f.width>12000||f.height>12000||ids.has(f.id))
   throw Error('Planta incorrecta o repetida');
  ids.add(f.id);
  if(!Array.isArray(f.polygons)||f.polygons.length>1800)throw Error('Demasiados polígonos en '+f.id);
  let used=new Set();
  for(const p of f.polygons){
   if(!p||!validId(p.id)||used.has(p.id)||!['unit','anchor','zone','corridor','slab','void'].includes(p.kind)||
      !safeText(p.name||'',130)||!Array.isArray(p.points)||p.points.length<3||p.points.length>350)
    throw Error('Polígono inválido de '+f.id);
   used.add(p.id);
   for(const point of p.points)if(!Array.isArray(point)||point.length!==2||
     point.some(z=>!Number.isFinite(z)||z<0||z>12000))
     throw Error('Coordenadas fuera del plano: '+p.id);
   const x=p.points.map(pt=>pt[0]),y=p.points.map(pt=>pt[1]);
   if(Math.max(...x)>f.width||Math.max(...y)>f.height)throw Error('Polígono fuera de la imagen');
   triangulate(p.points); // Reject degenerate/crossing polygons before saving.
  }
 }
 for(const u of d.units)if(!u||!ids.has(u.floor)||!safeText(u.code,80)||!u.code||
   !safeText(u.name||'',130)||!safeText(u.category||'',90)||!safeText(u.tags||'',350))
   throw Error('Local con datos incompletos');
 for(const p of d.pois)if(!p||!ids.has(p.floor)||!validId(p.id)||
   !safeText(p.name||'',90)||!safeText(p.category||'',90)||
   !Number.isFinite(p.x)||!Number.isFinite(p.y))throw Error('Servicio o referencia inválida');
 return true;
}
function cross(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function segmentsIntersect(a,b,c,d){
 const p=cross(a,b,c),q=cross(a,b,d),r=cross(c,d,a),s=cross(c,d,b);
 return (p*q<0&&r*s<0);
}
export function triangulate(points){
 let pts=points.map(p=>[Number(p[0]),Number(p[1])]);
 const n=pts.length;
 if(n<3||n>350)throw Error('Polígono demasiado pequeño o grande');
 for(let i=0;i<n;i++){
  if(Math.hypot(pts[i][0]-pts[(i+1)%n][0],pts[i][1]-pts[(i+1)%n][1])<.01)
   throw Error('Vértices repetidos o demasiado juntos');
  for(let j=i+2;j<n;j++){
   if(i===0&&j===n-1)continue;
   if(segmentsIntersect(pts[i],pts[(i+1)%n],pts[j],pts[(j+1)%n]))
    throw Error('El polígono se cruza a sí mismo');
  }
 }
 let area=0;for(let i=0;i<n;i++){const a=pts[i],b=pts[(i+1)%n];area+=a[0]*b[1]-a[1]*b[0];}
 if(Math.abs(area)<1)throw Error('Polígono sin superficie');
 const winding=Math.sign(area);
 const available=[...Array(n).keys()],triangles=[];
 let attempts=0;
 while(available.length>3){
  if(attempts++>n*n)throw Error('No se pudo triangular el polígono');
  let found=false;
  for(let i=0;i<available.length;i++){
   const a=available[(i-1+available.length)%available.length],b=available[i],
     c=available[(i+1)%available.length];
   if(cross(pts[a],pts[b],pts[c])*winding<=.00001)continue;
   let occupied=false;
   for(const t of available){
    if(t===a||t===b||t===c)continue;
    const x=cross(pts[a],pts[b],pts[t])*winding,y=cross(pts[b],pts[c],pts[t])*winding,
      z=cross(pts[c],pts[a],pts[t])*winding;
    if(x>=-1e-7&&y>=-1e-7&&z>=-1e-7){occupied=true;break;}
   }
   if(occupied)continue;
   triangles.push(a,b,c);available.splice(i,1);found=true;break;
  }
  if(!found)throw Error('Polígono no triangulable; revisá las aristas.');
 }
 triangles.push(...available);
 return triangles;
}
const codes={anchor:0,unit:1,zone:2,corridor:3,void:4,slab:5};
function compactPolygon(p){
 const pts=p.points.map(([x,y])=>[Math.round(x*2),Math.round(y*2)]);
 let dx=0,dy=0,deltas=[];
 for(const [x,y] of pts){deltas.push(x-dx,y-dy);dx=x;dy=y;}
 let mx=p.points.reduce((v,p)=>v+p[0],0)/pts.length;
 let my=p.points.reduce((v,p)=>v+p[1],0)/pts.length;
 return [p.id,codes[p.kind],p.name||'',deltas,[[...Array(pts.length).keys()]],triangulate(p.points),[mx,my]];
}
export function compile(d){
 validateDraft(d);
 if(!d.floors.length||d.floors.some(f=>!f.polygons.length))
  throw Error('Todas las plantas deben contener al menos un polígono revisable');
 const floors=d.floors.map(f=>{
  const w=Math.ceil(f.width/8),h=Math.ceil(f.height/8);
  return [f.id,f.name,f.source||'Plano suministrado por el shopping, pendiente de validación',
   f.polygons.map(compactPolygon),
   {x:0,y:0,step:8,w,h,bits:Buffer.alloc(Math.ceil(w*h/8)).toString('base64')}];
 });
 const references={};
 for(const f of d.floors)if(f.imageUrl)references[f.id]={
  url:f.imageUrl,imageSize:[f.width,f.height],viewBox:'0 0 '+f.width+' '+f.height,
  qa:{status:'pending',checks:{sourceApproved:false,dimensionsApproved:false,polygonReviewApproved:false}}
 };
 const publicMall={
  id:d.id,name:d.name,city:d.city,website:d.website||'',source:'Administración del shopping',
  status:'vectorizado-provisional',navigable:false,indoorPositionCalibrated:false,
  floors,origin:[d.floors[0].width/2,d.floors[0].height/2],scale:Number(d.scale)||.15,
  floorLabels:d.floors.map(f=>f.id),floorReferences:references,
  units:d.units,pois:d.pois.map(p=>({...p,verified:false,confidence:'posición-pendiente'})),
  theme:validateTheme(d.theme||{}),logoUrl:d.logoUrl||null
 };
 return publicMall;
}
export function bundle(publicMall){
 const version=crypto.createHash('sha256').update(JSON.stringify(publicMall)).digest('hex');
 const floors=publicMall.floors;
 const payload=Buffer.from(JSON.stringify({schema:'retailnav.map.bundle.v1',mallId:publicMall.id,version,floors}));
 const meta={...publicMall,mapAsset:{
  url:'api/public/maps/'+publicMall.id+'/'+version+'.json',version,
  sha256:crypto.createHash('sha256').update(payload).digest('hex'),
  bytes:payload.length,floorCount:floors.length}};
 delete meta.floors;
 return {version,payload,meta};
}
