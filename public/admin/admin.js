// RetailNav — self-service mall onboarding for authorized staff, no front-end secrets.
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const API=new URL('../api/admin/',document.baseURI);
const root=new URL('../',document.baseURI);
const THEME={
 background:'Fondo de la aplicación',surface:'Paneles y tarjetas',
 text:'Texto principal',muted:'Texto secundario',accent:'Accento y botones',
 accentText:'Texto de botones',border:'Bordes y divisores',
 mapUnit:'Locales 3D',mapAnchor:'Tiendas ancla 3D',
 mapCorridor:'Pasillos 3D',mapZone:'Zonas del edificio',
 mapSlab:'Losas / suelos 3D',mapOutline:'Contornos 3D'
};
const DEFAULTS={
 background:'#f3efe6',surface:'#ffffff',text:'#17150f',muted:'#706e6e',
 accent:'#17150f',accentText:'#ffffff',border:'#e1d9c9',
 mapUnit:'#847b6b',mapAnchor:'#3a352c',mapCorridor:'#e1d9c9',
 mapZone:'#c7beac',mapSlab:'#f7f3ea',mapOutline:'#17150f',
 font:'editorial',corners:'soft'
};
let session=null,allMalls=[],draft=null,published=null,history=[],dirty=false,activeFloor='',vertices=[],activeTab='identity';
const notice=(message,bad=false)=>{
 const el=$('feedback');el.hidden=false;el.textContent=message;el.classList.toggle('error',bad);
 el.scrollIntoView({behavior:'smooth',block:'nearest'});
};
const clear=(id)=>$(id).replaceChildren();
const node=(tag,text,cls)=>{
 const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);
 if(cls)n.className=cls;return n;
};
async function call(method,route,payload){
 const url=new URL(route,API);
 const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',
  headers:method==='POST'?{'Content-Type':'application/json','X-RetailNav-Admin':'1'}:{},
  body:payload===undefined?undefined:JSON.stringify(payload)});
 let out;try{out=await response.json();}catch{throw Error('Respuesta inesperada del servidor');}
 if(!response.ok)throw Error(out.error||'Error HTTP '+response.status);
 return out;
}
const safe=(fn)=>async e=>{try{await fn(e);}catch(ex){console.error(ex);notice(ex.message,true);}};
function setScreen(isAuthenticated){
 $('signin').hidden=isAuthenticated;$('workspace').hidden=!isAuthenticated;
 $('signout').hidden=!isAuthenticated;
 $('sessionName').textContent=isAuthenticated?session.username+' · '+(session.role==='platform'?'RetailNav':'Shopping '+session.mallId):'';
 $('platformTools').hidden=!isAuthenticated||session.role!=='platform';
}
async function login(){
 const data=await call('POST','login',{username:$('loginUser').value.trim(),password:$('loginPassword').value});
 $('loginPassword').value='';
 session=data;setScreen(true);await list();notice('Sesión administrativa iniciada.');
}
async function list(){
 const data=await call('GET','malls');
 allMalls=data.malls;
 clear('mallButtons');clear('accountMall');
 for(const m of allMalls){
  const b=node('button',m.name+(m.publishedVersion?' ✓':' · borrador'));
  b.type='button';b.classList.toggle('current',draft?.id===m.id);
  b.addEventListener('click',safe(()=>openMall(m.id)));
  $('mallButtons').append(b);
  const option=node('option',m.name);option.value=m.id;$('accountMall').append(option);
 }
 const seeded=new Set(allMalls.map(m=>m.id));
 clear('seedMall');
 if(session.role==='platform'){
  try{
   const text=await (await fetch(new URL('index.html',root),{cache:'no-cache'})).text();
   const original=new DOMParser().parseFromString(text,'text/html');
   const entries=JSON.parse(original.querySelector('#mallCatalog')?.textContent||'{}');
   for(const [id,m] of Object.entries(entries)){
    if(seeded.has(id))continue;
    const opt=node('option',m.name||id);opt.value=id;$('seedMall').append(opt);
   }
  }catch(e){console.warn('No se pudo listar el catálogo inicial',e);}
 }
}
async function openMall(id){
 if(dirty&&!confirm('Hay cambios sin guardar. ¿Descartarlos y cambiar de shopping?'))return;
 const loaded=await call('GET','malls/'+encodeURIComponent(id));
 draft=loaded.draft;published=loaded.published;history=loaded.history||[];
 dirty=false;vertices=[];activeFloor=draft.floors[0]?.id||'';
 $('emptyMall').hidden=true;$('editor').hidden=false;
 $('editorTitle').textContent=draft.name;
 $('openPublicMall').href=new URL('?mall='+encodeURIComponent(id),root);
 renderAll();await list();
}
function touched(){
 if(!draft)return;
 dirty=true;
 $('revisionInfo').textContent='Borrador sin guardar · revisión '+draft.revision+
   (published?' · publicado: '+published.slice(0,12):' · todavía sin publicar');
}
function syncFields(){
 if(!draft)return;
 draft.name=$('nameInput').value.trim();draft.city=$('cityInput').value.trim();
 draft.website=$('websiteInput').value.trim();
 draft.theme.font=$('fontPreset').value;
 draft.theme.corners=$('cornersPreset').value;
}
function setTab(id){
 activeTab=id;
 document.querySelectorAll('[data-view]').forEach(el=>{el.hidden=el.dataset.view!==id;});
 document.querySelectorAll('button[data-tab]').forEach(b=>{
  b.classList.toggle('selected',b.dataset.tab===id);
 });
 if(id==='floors')renderFloor();
 if(id==='publication')review();
}
function renderAll(){
 $('nameInput').value=draft.name;$('cityInput').value=draft.city||'';
 $('websiteInput').value=draft.website||'';
 draft.theme={...DEFAULTS,...(draft.theme||{})};
 $('fontPreset').value=draft.theme.font;
 $('cornersPreset').value=draft.theme.corners;
 clear('palette');
 for(const [key,title] of Object.entries(THEME)){
  const block=node('div',undefined,'coloritem');
  const box=node('input');box.type='color';box.value=draft.theme[key]||DEFAULTS[key];box.id='color-'+key;
  const label=node('label',title);label.htmlFor=box.id;
  box.addEventListener('input',()=>{
   draft.theme[key]=box.value;
   touched();previewBrand();
  });
  block.append(box,label);$('palette').append(block);
 }
 previewBrand();renderFloors();renderUnits();renderPois();review();setTab(activeTab);
 $('revisionInfo').textContent='Revisión '+draft.revision+(published?' · publicada: '+published.slice(0,12):' · sin publicar');
}
function displayImageUrl(url){
 if(!url)return '';
 if(!/^(?:api\/public\/assets\/|branding\/|reference\/)/.test(url))return '';
 if(url.startsWith('api/public/assets/')&&draft){
  const match=/^api\/public\/assets\/([a-z0-9-]+)\/([a-f0-9]{64})\.(png|jpg|webp)$/.exec(url);
  if(match)return new URL('api/admin/malls/'+match[1]+'/asset/'+match[2]+'.'+match[3],root).href;
 }
 return new URL(url,root).href;
}
function previewBrand(){
 const p=$('brandPreview'),t=draft.theme;
 p.style.background=t.surface;p.style.color=t.text;
 p.style.border='1px solid '+t.border;
 p.style.fontFamily=t.font==='editorial'?'"Helvetica Neue",Arial,sans-serif':
  t.font==='rounded'?'"Trebuchet MS",Arial,sans-serif':'system-ui,sans-serif';
 p.style.borderRadius=t.corners==='square'?'0':'14px';
 const b=p.querySelector('button');b.style.background=t.accent;
 b.style.color=t.accentText;b.style.borderRadius=t.corners==='square'?'0':'9px';
 $('previewName').textContent=draft.name||'Shopping';
 const img=$('previewLogo'),url=displayImageUrl(draft.logoUrl);
 img.hidden=!url;
 if(url)img.src=url;else img.removeAttribute('src');
}
function renderFloors(){
 clear('floorSelectAdmin');clear('storeFloor');clear('poiFloor');
 for(const f of draft.floors){
  for(const select of ['floorSelectAdmin','storeFloor','poiFloor']){
   const op=node('option',f.id+' · '+f.name);op.value=f.id;$(select).append(op);
  }
 }
 if(!draft.floors.some(f=>f.id===activeFloor))activeFloor=draft.floors[0]?.id||'';
 $('floorSelectAdmin').value=activeFloor;
 if(draft.floors.length)renderFloor();
 else{$('floorSvg').replaceChildren();clear('polygonRows');$('polygonHint').textContent='Agregá una planta primero.';}
}
function getFloor(){return draft.floors.find(f=>f.id===activeFloor);}
const svgNS='http://www.w3.org/2000/svg';
const shape=(tag,attrs)=>{
 const el=document.createElementNS(svgNS,tag);
 for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));
 return el;
};
function originalOutlines(f){
 if(!f.compactFloor)return[];
 const K=['anchor','unit','zone','corridor','void','slab'];
 return f.compactFloor[3].map(a=>{
  let x=0,y=0,points=[];
  for(let j=0;j<a[3].length;j+=2){
   x+=a[3][j];y+=a[3][j+1];points.push([x/2,y/2]);
  }
  const ring=a[4]?.[0]||[];
  return {id:a[0],name:a[2],kind:K[a[1]]||'zone',points:ring.map(k=>points[k])};
 });
}
function renderFloor(){
 const f=getFloor();if(!f)return;
 $('floorName').value=f.name;
 $('floorEditTools').hidden=Boolean(f.compactFloor);
 $('floorSvg').setAttribute('viewBox','0 0 '+f.width+' '+f.height);
 const svg=$('floorSvg');svg.replaceChildren();
 svg.append(shape('rect',{x:0,y:0,width:f.width,height:f.height,fill:'#fffdf8'}));
 const url=displayImageUrl(f.imageUrl);
 if(url)svg.append(shape('image',{x:0,y:0,width:f.width,height:f.height,href:url,preserveAspectRatio:'none'}));
 const polys=f.compactFloor?originalOutlines(f):f.polygons||[];
 for(const p of polys){
  const poly=shape('polygon',{points:p.points.map(q=>q.join(',')).join(' ')});
  if(f.compactFloor){poly.style.fill='rgba(26,63,70,.08)';poly.style.stroke='rgba(28,105,122,.35)';}
  svg.append(poly);
  if(p.points.length){
   const avg=p.points.reduce((o,v)=>[o[0]+v[0],o[1]+v[1]],[0,0]).map(v=>v/p.points.length);
   const label=shape('text',{x:avg[0],y:avg[1],'text-anchor':'middle'});
   label.textContent=p.name||p.id;svg.append(label);
  }
 }
 if(vertices.length){
  svg.append(shape('polyline',{points:vertices.map(q=>q.join(',')).join(' ')}));
  for(const [x,y] of vertices)svg.append(shape('circle',{cx:x,cy:y,r:Math.max(4,f.width*.004)}));
 }
 const rows=$('polygonRows');rows.replaceChildren();
 for(const p of polys){
  const tr=node('tr');
  [p.name||p.id,p.kind,String(p.points.length)].forEach(t=>tr.append(node('td',t)));
  const cell=node('td');
  if(!f.compactFloor){
   const b=node('button','Eliminar','danger');b.addEventListener('click',()=>{
    if(!confirm('¿Eliminar el sector '+p.id+'?'))return;
    f.polygons=f.polygons.filter(x=>x.id!==p.id);
    touched();renderFloor();
   });cell.append(b);
  }else cell.textContent='Plano histórico protegido';
  tr.append(cell);rows.append(tr);
 }
 $('polygonHint').textContent=f.compactFloor
  ?'Geometría original protegida: importación sin modificar los polígonos.'
  :vertices.length+' vértices · tocá para agregar; cerrá con el botón.';
}
function svgPoint(event){
 const svg=$('floorSvg');
 const pt=svg.createSVGPoint();pt.x=event.clientX;pt.y=event.clientY;
 const ctm=svg.getScreenCTM();
 return ctm?pt.matrixTransform(ctm.inverse()):null;
}
function addVertex(e){
 const f=getFloor();if(!f||f.compactFloor)return;
 const p=svgPoint(e);if(!p)return;
 if(p.x<0||p.x>f.width||p.y<0||p.y>f.height)return;
 vertices.push([Math.round(p.x*10)/10,Math.round(p.y*10)/10]);
 renderFloor();
}
async function uploadAsset(file,kind){
 if(!file)throw Error('Elegí una imagen.');
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)
  throw Error('Se aceptan JPG, PNG y WebP de hasta 5 MB.');
 const base64=await new Promise((resolve,reject)=>{
  const fr=new FileReader();
  fr.onload=()=>resolve(String(fr.result).split(',')[1]);fr.onerror=reject;fr.readAsDataURL(file);
 });
 return await call('POST','malls/'+draft.id+'/asset',{kind,mime:file.type,base64});
}
async function measure(file){
 const url=URL.createObjectURL(file);
 try{
  const img=new Image();img.src=url;await img.decode();
  return {width:img.naturalWidth,height:img.naturalHeight};
 }finally{URL.revokeObjectURL(url);}
}
function renderUnits(){
 const body=$('storeRows');body.replaceChildren();
 $('storeCount').textContent=draft.units.length+' locales en el directorio de este shopping.';
 for(const [index,u] of draft.units.entries()){
  const tr=node('tr');
  for(const t of [u.floor,u.code,u.name||'Pendiente de nombre',u.category||''])tr.append(node('td',t));
  const action=node('td');
  const edit=node('button','Editar','secondary');edit.type='button';
  edit.addEventListener('click',()=>{
   setTab('stores');
   const f=$('storeForm');for(const key of ['floor','code','name','category','tags','polygonId'])
    f.elements[key].value=u[key]||'';
   f.scrollIntoView({behavior:'smooth',block:'center'});
  });
  const del=node('button','Quitar','danger');del.type='button';
  del.addEventListener('click',()=>{
   if(!confirm('¿Quitar el local '+u.code+'?'))return;
   draft.units.splice(index,1);touched();renderUnits();
  });
  action.append(edit,del);tr.append(action);body.append(tr);
 }
}
function renderPois(){
 const body=$('poiRows');body.replaceChildren();
 for(const [index,p] of draft.pois.entries()){
  const tr=node('tr');
  [p.floor,p.name||p.category||p.id,
    (Number.isFinite(p.x)?p.x:'?')+' / '+(Number.isFinite(p.y)?p.y:'?')].forEach(t=>tr.append(node('td',t)));
  const cell=node('td');const b=node('button','Eliminar','danger');
  b.addEventListener('click',()=>{
   if(!confirm('¿Eliminar la referencia '+p.id+'?'))return;
   draft.pois.splice(index,1);touched();renderPois();
  });cell.append(b);tr.append(cell);body.append(tr);
 }
}
function review(){
 if(!draft)return;
 const areas=draft.floors.reduce((sum,f)=>sum+(f.compactFloor?.[3]?.length||f.polygons?.length||0),0);
 const pending=draft.units.filter(u=>!u.polygonId).length;
 $('reviewSummary').textContent=draft.floors.length+' plantas · '+areas+' polígonos · '+
   draft.units.length+' locales ('+pending+' sin sector asignado) · '+
   draft.pois.length+' servicios. El plano será PROVISIONAL hasta verificar las referencias.';
 const list=$('historyList');list.replaceChildren();
 if(!history.length){list.textContent='No hay publicaciones anteriores.';return;}
 for(const h of history){
  const item=node('div',undefined,'mini flex');
  item.append(node('span',new Date(h.publishedAt).toLocaleString('es')+' · '+h.version.slice(0,14)));
  const b=node('button','Restaurar versión','secondary');b.type='button';
  b.addEventListener('click',safe(async()=>{
   if(!confirm('¿Restaurar la versión '+h.version.slice(0,12)+'? La versión de visitantes cambiará.'))return;
   const result=await call('POST','malls/'+draft.id+'/rollback',{version:h.version});
   published=result.version;notice('Versión anterior recuperada.');renderAll();
  }));
  item.append(b);list.append(item);
 }
}
async function save(){
 syncFields();
 const data=await call('POST','malls/'+draft.id+'/draft',{revision:draft.revision,draft});
 draft=data.draft;dirty=false;
 renderAll();notice('Borrador guardado. La página pública no cambió.');
}
function csvRows(text){
 const delimiter=(text.split(/\r?\n/,1)[0].match(/;/g)||[]).length>
  (text.split(/\r?\n/,1)[0].match(/,/g)||[]).length?';':',';
 const out=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){
   if(quoted&&text[i+1]==='"'){field+='"';i++;}
   else quoted=!quoted;
  }else if(c===delimiter&&!quoted){row.push(field);field='';}
  else if((c==='\n'||c==='\r')&&!quoted){
   if(c==='\r'&&text[i+1]==='\n')i++;
   row.push(field);if(row.some(x=>x.trim()))out.push(row);row=[];field='';
  }else field+=c;
 }
 if(quoted)throw Error('CSV: comillas sin cerrar');
 row.push(field);if(row.some(x=>x.trim()))out.push(row);
 const header=(out.shift()||[]).map(x=>x.trim().replace(/^\uFEFF/,''));
 const required=['floor','code','name','category','tags','polygonId'];
 for(const col of required)if(!header.includes(col))throw Error('Falta columna CSV: '+col);
 return out.map(v=>Object.fromEntries(required.map(c=>[c,(v[header.indexOf(c)]||'').trim()])));
}
function downloadFile(name,content,mime){
 const blob=new Blob([content],{type:mime});
 const url=URL.createObjectURL(blob);
 const a=node('a');a.href=url;a.download=name;a.click();
 setTimeout(()=>URL.revokeObjectURL(url),15000);
}
async function createNewMall(e){
 e.preventDefault();
 const p=Object.fromEntries(new FormData($('createMall')).entries());
 await call('POST','malls',{id:p.id.trim(),name:p.name.trim(),city:p.city.trim()});
 await list();await openMall(p.id.trim());notice('Shopping creado. Todavía no está publicado.');
}
async function importExisting(){
 const id=$('seedMall').value;if(!id)throw Error('Seleccioná un centro existente');
 const html=await (await fetch(new URL('index.html',root),{cache:'no-cache'})).text();
 const doc=new DOMParser().parseFromString(html,'text/html');
 const c=JSON.parse(doc.querySelector('#mallCatalog').textContent);
 const m=c[id];if(!m?.mapAsset)throw Error('El shopping no está en el catálogo actual');
 const bundle=await (await fetch(new URL(m.mapAsset.url,root))).json();
 if(bundle.mallId!==id)throw Error('El mapa publicado no coincide con la selección');
 const preserved={...m};delete preserved.mapAsset;
 const floors=bundle.floors.map(f=>{
  const reference=m.floorReferences?.[f[0]];
  const size=reference?.imageSize||(id==='aventura'?[1320,941]:[1400,800]);
  return {id:f[0],name:f[1],source:f[2],width:size[0],height:size[1],
   imageUrl:reference?.url||null,polygons:[],compactFloor:f};
 });
 await call('POST','malls',{id,name:m.name,city:m.city||''});
 const initial=await call('GET','malls/'+id);
 const input={...initial.draft,theme:{...DEFAULTS,...(m.theme||{})},
  website:m.website||'',logoUrl:m.logoUrl||null,floors,units:m.units||[],
  pois:m.pois||[],preservedCatalog:preserved,scale:m.scale||.15};
 await call('POST','malls/'+id+'/draft',{revision:initial.draft.revision,draft:input});
 await openMall(id);notice('Mapa original importado sin redibujar ni perder sus polígonos. Editá el estilo o directorio.');
}
function handleEvents(){
 $('signinForm').addEventListener('submit',safe(async e=>{e.preventDefault();await login();}));
 $('signout').addEventListener('click',safe(async()=>{
  await call('POST','logout',{});session=null;draft=null;setScreen(false);notice('Sesión cerrada.');
 }));
 $('createMall').addEventListener('submit',safe(createNewMall));
 $('seedBtn').addEventListener('click',safe(importExisting));
 $('createAccount').addEventListener('submit',safe(async e=>{
  e.preventDefault();
  const p=Object.fromEntries(new FormData($('createAccount')).entries());
  const data=await call('POST','accounts',p);
  $('newPassword').hidden=false;
  $('newPassword').textContent='Usuario: '+data.account.username+
    ' · contraseña inicial (copiar ahora; no volverá a mostrarse): '+data.password;
  notice('Acceso creado. Compartí la contraseña por un canal seguro.');
 }));
 document.querySelectorAll('button[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
 for(const id of ['nameInput','cityInput','websiteInput','fontPreset','cornersPreset']){
  $(id).addEventListener('input',()=>{syncFields();touched();previewBrand();});
 }
 $('saveDraft').addEventListener('click',safe(save));
 $('uploadLogo').addEventListener('click',safe(async()=>{
  const result=await uploadAsset($('logoFile').files[0],'logo');
  draft.logoUrl=result.url;touched();previewBrand();notice('Logo guardado como recurso del shopping; publicalo para hacerlo visible.');
 }));
 $('floorSelectAdmin').addEventListener('change',()=>{activeFloor=$('floorSelectAdmin').value;vertices=[];renderFloor();});
 $('floorName').addEventListener('input',()=>{
  const f=getFloor();if(!f)return;
  f.name=$('floorName').value;touched();renderFloors();
 });
 $('addFloor').addEventListener('click',safe(async()=>{
  const id=(prompt('Código de planta (por ejemplo PB, L1, B1):')||'').trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/.test(id))return;
  if(draft.floors.some(f=>f.id===id))throw Error('Esta planta ya existe.');
  const title=(prompt('Nombre de la planta:','Planta '+id)||'Planta '+id).trim();
  const width=Number(prompt('Ancho del plano en píxeles:','1400'));
  const height=Number(prompt('Alto del plano en píxeles:','800'));
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<120||height<120||
     width>12000||height>12000)throw Error('Tamaño inválido');
  draft.floors.push({id,name:title,width,height,polygons:[],imageUrl:null});
  activeFloor=id;vertices=[];touched();renderFloors();
 }));
 $('deleteFloor').addEventListener('click',()=>{
  const f=getFloor();if(!f||!confirm('¿Eliminar planta '+f.id+' y sus referencias del borrador?'))return;
  draft.floors=draft.floors.filter(x=>x!==f);
  draft.units=draft.units.filter(u=>u.floor!==f.id);
  draft.pois=draft.pois.filter(p=>p.floor!==f.id);
  activeFloor=draft.floors[0]?.id||'';vertices=[];touched();renderFloors();renderUnits();renderPois();
 });
 $('uploadFloorPhoto').addEventListener('click',safe(async()=>{
  const f=getFloor();if(!f)throw Error('Primero agregá una planta');
  const file=$('floorImageFile').files[0];if(!file)throw Error('Elegí una imagen');
  const dimensions=await measure(file);
  if(f.compactFloor&&((dimensions.width!==f.width)||(dimensions.height!==f.height)))
   throw Error('No se puede cambiar la escala de un mapa histórico: la nueva imagen debe tener exactamente las mismas dimensiones.');
  if(f.polygons?.length&&(dimensions.width!==f.width||dimensions.height!==f.height))
   throw Error('La nueva foto cambió de tamaño. Debés mantener las dimensiones originales para conservar la alineación.');
  const result=await uploadAsset(file,'floor');
  f.imageUrl=result.url;f.width=dimensions.width;f.height=dimensions.height;
  touched();renderFloor();notice('Plano de planta subido sin modificar los polígonos.');
 }));
 $('floorSvg').addEventListener('click',addVertex);
 $('undoVertex').addEventListener('click',()=>{vertices.pop();renderFloor();});
 $('clearVertices').addEventListener('click',()=>{vertices=[];renderFloor();});
 $('finishPolygon').addEventListener('click',safe(async()=>{
  const f=getFloor();if(!f||f.compactFloor)throw Error('No se puede dibujar sobre una geometría histórica protegida');
  const id=$('polygonId').value.trim(),name=$('polygonName').value.trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/.test(id))throw Error('Usá un ID de sector válido');
  if(vertices.length<3)throw Error('Necesitás al menos tres vértices');
  if(f.polygons.some(p=>p.id===id))throw Error('ID de sector repetido en la planta');
  f.polygons.push({id,kind:$('polygonKind').value,name,points:vertices.map(x=>x.slice())});
  vertices=[];touched();renderFloor();
 }));
 $('storeForm').addEventListener('submit',safe(async e=>{
  e.preventDefault();
  const data=Object.fromEntries(new FormData($('storeForm')).entries());
  if(!data.floor||!data.code)throw Error('Planta y código obligatorios');
  const index=draft.units.findIndex(u=>u.floor===data.floor&&u.code===data.code);
  if(index<0)draft.units.push(data);else draft.units[index]={...draft.units[index],...data};
  $('storeForm').reset();touched();renderUnits();
 }));
 $('importCsv').addEventListener('click',safe(async()=>{
  const file=$('csvInput').files[0];if(!file)throw Error('Elegí un archivo CSV');
  const incoming=csvRows(await file.text());
  if(!incoming.length)throw Error('No hay filas en el CSV');
  if(incoming.some(row=>!draft.floors.some(f=>f.id===row.floor)))
   throw Error('Hay códigos de planta que todavía no existen. Agregá esas plantas primero.');
  let newCount=0;
  for(const row of incoming){
   const i=draft.units.findIndex(x=>x.floor===row.floor&&x.code===row.code);
   if(i<0){draft.units.push(row);newCount++;}
   else draft.units[i]={...draft.units[i],...row};
  }
  touched();renderUnits();notice('Importados '+incoming.length+' locales ('+newCount+' nuevos). Guardá el borrador.');
 }));
 $('csvTemplate').addEventListener('click',()=>downloadFile('retailnav-locales-plantilla.csv',
  'floor,code,name,category,tags,polygonId\nPB,101,Ejemplo de local,Ropa,"camperas; pantalones",PB-101\n','text/csv;charset=utf-8'));
 $('poiForm').addEventListener('submit',safe(async e=>{
  e.preventDefault();
  const data=Object.fromEntries(new FormData($('poiForm')).entries());
  data.x=Number(data.x);data.y=Number(data.y);
  const f=draft.floors.find(f=>f.id===data.floor);
  if(!f||!Number.isFinite(data.x)||!Number.isFinite(data.y)||data.x<0||data.y<0||
     data.x>f.width||data.y>f.height)throw Error('Coordenadas fuera de la planta');
  data.verified=false;data.confidence='posición-pendiente';
  const index=draft.pois.findIndex(p=>p.id===data.id&&p.floor===data.floor);
  if(index<0)draft.pois.push(data);else draft.pois[index]={...draft.pois[index],...data};
  $('poiForm').reset();touched();renderPois();
 }));
 $('publishBtn').addEventListener('click',safe(async()=>{
  if(!$('publishCheck').checked)throw Error('Confirmá la revisión antes de publicar.');
  if(dirty)await save();
  const r=await call('POST','malls/'+draft.id+'/publish',{revision:draft.revision});
  published=r.version;history.unshift({version:r.version,publishedAt:new Date().toISOString(),by:session.username});
  $('publishCheck').checked=false;renderAll();await list();
  notice('Versión '+r.version.slice(0,12)+' publicada. Los teléfonos descargarán este mapa si cambió la versión.');
 }));
 $('exportDraft').addEventListener('click',()=>{
  if(!draft)return;
  syncFields();
  downloadFile('retailnav-'+draft.id+'-borrador.json',
   JSON.stringify({schema:'retailnav.admin.draft.v1',draft},null,2),'application/json');
 });
 $('importDraft').addEventListener('click',safe(async()=>{
  const file=$('draftFileInput').files[0];if(!file)throw Error('Elegí el JSON de respaldo');
  const data=JSON.parse(await file.text());
  if(data.schema!=='retailnav.admin.draft.v1'||data.draft.id!==draft.id)
   throw Error('El respaldo corresponde a otro shopping o un formato desconocido.');
  if(!confirm('¿Reemplazar los datos del borrador actual?'))return;
  const keep=draft.revision;
  draft={...data.draft,id:draft.id,revision:keep};
  touched();activeFloor=draft.floors[0]?.id||'';vertices=[];renderAll();
 }));
}
async function boot(){
 handleEvents();
 try{
  session=await call('GET','session');
  setScreen(true);await list();
  if(allMalls.length===1)await openMall(allMalls[0].id);
 }catch{session=null;setScreen(false);}
}
boot();
})();
