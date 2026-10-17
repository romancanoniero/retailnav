'use strict';
/* RetailNav: dependency-free WebGL geometry viewer. Source geometry and photo references share the original 3D renderer. */
(()=>{
const $=id=>document.getElementById(id), K=['anchor','unit','zone','corridor','void','slab'];
let data, floors=[], gl, ctx2d=null, program, loc, canvas=$('canvas'), frame=0, lastTime=0, mvp, invMvp, toastTimer, ready=false;
let dirty=true;
let active='ALL', searchFloorSet=null,searchCommitted='',selectedSearchTagKey=null,searchMatchedVectors=new Set(),searchMarkerElements=new Map(),lastIndoorReferenceSource=null,searchCommitAction=null,wire=false, scan=false, auto=false, panMode=true, labelsOn=true, originalLevel='UL', selected=null, route=null, routeRunning=false, routeT=0;
let spread=26, targetSpread=26, target=[0,26,0], distance=215, q=[0,0,0,1];
// A store focus is a temporary single-floor view of a multi-floor search.
// Search matches and the visitor's original floor remain stored unchanged.
let focusedStoreVectors=new Set();
let focusedStoreId=null,focusedStoreVector=null,focusFloorId=null,cameraFlight=null,lastStoreFocus=null,pendingStoreFocus=null;
let wayfinding=null,wayfindingOpen=false,wayfindingCompact=false,pendingOriginDestination=null,placingLocalOnly=false;
let orbitYaw=-.30,orbitPitch=-.70,orbitRoll=0;
let lastEarth3DPitch=-.70,earth2D=false;
const MIN_PITCH=-Math.PI/2,MAX_PITCH=-.25;
// World units, not metres: photo maps have no surveyed scale.
// Previous min=24; min=4 yields up to six times more magnification.
const MIN_ZOOM_DISTANCE=4,MAX_ZOOM_DISTANCE=850;
const zoomBounds=n=>clamp(n,MIN_ZOOM_DISTANCE,MAX_ZOOM_DISTANCE);
const wrapAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));
function updateCameraRotation(){
 // Map mode Euler presets only. Spherical free orbit updates q directly.
 q=norm(qm(qm(quat([0,1,0],orbitYaw),quat([1,0,0],orbitPitch)),
   quat([0,0,1],orbitRoll)));
 updateEarthButtons();
}
function rotateCameraLocal(axis,angle){
 q=norm(qm(q,quat(axis,angle)));
 dirty=true;
}
function arcballVector(clientX,clientY){
 const r=canvas.getBoundingClientRect();
 const radius=Math.max(48,Math.min(r.width,r.height)*.47);
 const x=(clientX-r.left-r.width/2)/radius;
 const y=(r.top+r.height/2-clientY)/radius;
 const d=x*x+y*y;
 if(d>1){
  const k=1/Math.sqrt(d);
  return [x*k,y*k,0]; // Rim motion allows rotation around screen Z.
 }
 return [x,y,Math.sqrt(Math.max(0,1-d))];
}
function arcballCameraDelta(start,end){
 // Inverse model trackball rotation, quaternion [-cross,1+dot].
 const axis=cross(start,end),w=1+clamp(dot(start,end),-1,1);
 if(w<1e-6){
  const fallback=Math.abs(start[0])<.8?[1,0,0]:[0,1,0];
  return [...norm(cross(start,fallback)),0];
 }
 return norm([-axis[0],-axis[1],-axis[2],w]);
}
function updateRotationModeUI(){
 const button=$('pan');
 button.setAttribute('aria-pressed',String(!panMode));
 button.setAttribute('aria-label',panMode?'Activar rotación esférica 3D 360 grados':'Cambiar a desplazamiento de mapa');
 button.title=panMode?'Activar giro 3D 360°: mirar desde cualquier dirección'
  :'Giro esférico activo · tocar para desplazar el mapa';
 button.classList.toggle('active',!panMode);
 $('rnRollControls').hidden=panMode;
 updateEarthButtons();
 const precision=inputProfile==='precision';
 canvas.setAttribute('aria-label',panMode
  ?(precision
    ?'Modo mapa para trackpad y mouse: arrastrá para mover, pellizcá para ampliar, girá dos dedos para rotar y usá Mayúsculas más desplazamiento para inclinar.'
    :'Modo mapa táctil: un dedo mueve; dos dedos amplían, giran e inclinan. Pulsá 360° para rotación libre.')
  :(precision
    ?'Modo esfera 3D 360° para trackpad y mouse: arrastrá para girar, pellizcá para ampliar, girá dos dedos para rotar y usá Mayúsculas más desplazamiento para inclinar.'
    :'Modo esfera 3D 360°: un dedo gira libremente por los tres ejes, también por debajo. Dos dedos desplazan, amplían y giran.'));
}
// Google Earth-style reference compass and perspective controls. Without a
// surveyed bearing, 'N' means the image's top edge, NOT verified true north.
function updateEarthButtons(){
 const plan=$('plan'),mode=$('rnViewModeLabel'),north=$('north');
 if(mode)mode.textContent=earth2D?'3D':'2D';
 if(plan){
  plan.setAttribute('aria-pressed',String(earth2D));
  plan.setAttribute('aria-label',earth2D?'Volver a vista 3D':'Pasar a vista 2D');
  plan.title=earth2D?'Inclinar para vista 3D':'Ver planta desde arriba (2D)';
 }
 if(north){
  const dir=[0,0,-1],east=dot(dir,qr(q,[1,0,0])),
       upwards=dot(dir,qr(q,[0,1,0]));
  const angle=Math.atan2(east,upwards);
  const arrow=$('rnCompassNeedle');
  if(arrow)arrow.style.transform='rotate('+(Number.isFinite(angle)?angle:0)+'rad)';
  north.title='Restablecer orientación de referencia (norte real sin calibrar)';
 }
}
function faceMapNorth(){
 stopAuto();
 if(!panMode){
  panMode=true;
  orbitPitch=clamp(orbitPitch,MIN_PITCH,MAX_PITCH);
  updateRotationModeUI();
 }
 orbitYaw=0;orbitRoll=0;
 updateCameraRotation();dirty=true;
}
function switchEarth2D(){
 stopAuto();
 if(!panMode){
  panMode=true;
  orbitPitch=clamp(orbitPitch,MIN_PITCH,MAX_PITCH);
  updateRotationModeUI();
 }
 if(active==='ALL'&&floors.length>1){
  // 2D refers to one selected level; retain focus and zoom throughout.
  const floorId=selected?.floor||floors[Math.min(1,floors.length-1)].id;
  const oldTarget=target.slice(),oldDistance=distance;
  const previousAngles=[orbitYaw,orbitPitch,orbitRoll];
  setFloor(floorId);
  [orbitYaw,orbitPitch,orbitRoll]=previousAngles;
  target=[oldTarget[0],floors.find(f=>f.id===floorId).y,oldTarget[2]];
  distance=oldDistance;
 }
 if(!earth2D){
  if(orbitPitch>MIN_PITCH+.04)lastEarth3DPitch=orbitPitch;
  orbitPitch=MIN_PITCH;earth2D=true;
 }else{
  orbitPitch=clamp(lastEarth3DPitch,MIN_PITCH+.16,MAX_PITCH);
  earth2D=false;
 }
 orbitRoll=0;
 updateCameraRotation();dirty=true;
}
const selectedMall=window.RETAILNAV_ACTIVE_MALL||{id:'aventura',name:'Aventura Mall',floors:null,origin:[690,405],scale:.15};
const mallId=selectedMall.id||'aventura';
const cfg={origin:selectedMall.origin||[690,405],scale:selectedMall.scale||.15}; const errors=[];
const heightConfig=selectedMall.verticalGeometry||{};
const baseFloorMetres=Number(heightConfig.defaultFloorHeightMeters)||4;
const floorHeightMetres=Object.create(null);
const heightStorageKey='retailnav:floor-height-v1:'+mallId;
function validHeight(value){const n=Number(value);return Number.isFinite(n)&&n>=2&&n<=12;}
function initializeFloorHeights(){
 let saved={};
 try{saved=JSON.parse(localStorage.getItem(heightStorageKey)||'{}')||{};}catch{}
 for(const floor of floors){
  const preset=heightConfig.floorHeightsMeters?.[floor.id];
  const chosen=saved[floor.id]??preset??baseFloorMetres;
  floorHeightMetres[floor.id]=validHeight(chosen)?Number(chosen):baseFloorMetres;
 }
 refreshFloorElevations();
}
function refreshFloorElevations(){
 let total=0;
 for(const floor of floors){
  floor.elevationMetres=total;
  floor.floorHeightMetres=floorHeightMetres[floor.id]||baseFloorMetres;
  floor.y=total*spread/baseFloorMetres;
  total+=floor.floorHeightMetres;
 }
}
function floorFocusY(){
 if(!floors.length)return 0;
 return active==='ALL'?(floors[0].y+floors[floors.length-1].y)/2:
  (floors.find(f=>f.id===active)?.y||0);
}
function editFloorHeight(id,value){
 if(!floors.some(f=>f.id===id)||!validHeight(value))return false;
 const before=floorFocusY();
 floorHeightMetres[id]=Math.round(Number(value)*100)/100;
 refreshFloorElevations();
 target[1]+=floorFocusY()-before;
 try{localStorage.setItem(heightStorageKey,JSON.stringify(floorHeightMetres));}catch{}
 const v=$('rnHeightValue');
 if(v&&$('rnHeightLevel')?.value===id)v.value=String(floorHeightMetres[id]);
 updateHeightCaption();dirty=true;return true;
}
function updateHeightCaption(){
 const id=$('rnHeightLevel')?.value||floors[0]?.id;
 const metres=id&&floorHeightMetres[id]||baseFloorMetres;
 const span=$('rnHeightSummary');
 if(span)span.textContent='Altura '+id+' · '+metres.toFixed(1)+' m';
 const label=$('rnHeightStatus');
 if(label)label.textContent='Estimación: '+metres.toFixed(1)+
  ' m. Los pisos superiores y enlaces 3D se recalculan automáticamente.';
}
function bindHeightControls(){
 const box=$('rnHeightsPanel');
 if(!box)return;
 box.hidden=floors.length<=1;
 const picker=$('rnHeightLevel');
 picker.replaceChildren();
 for(const floor of floors){
  const o=document.createElement('option');o.value=floor.id;o.textContent=floor.id;
  picker.append(o);
 }
 picker.value=floors[0].id;
 picker.onchange=()=>{
  $('rnHeightValue').value=String(floorHeightMetres[picker.value]);
  updateHeightCaption();
 };
 const input=$('rnHeightValue');
 input.value=String(floorHeightMetres[picker.value]);
 input.onchange=()=>{if(!editFloorHeight(picker.value,input.value)){
  input.value=String(floorHeightMetres[picker.value]);
  notify('Altura válida entre 2 y 12 metros por planta.');
 }};
 $('rnHeightReset').onclick=()=>{
  for(const floor of floors){
   floorHeightMetres[floor.id]=validHeight(heightConfig.floorHeightsMeters?.[floor.id])
    ?Number(heightConfig.floorHeightsMeters[floor.id]):baseFloorMetres;
  }
  try{localStorage.removeItem(heightStorageKey);}catch{}
  const before=floorFocusY();refreshFloorElevations();
  target[1]+=floorFocusY()-before;
  input.value=String(floorHeightMetres[picker.value]);
  updateHeightCaption();dirty=true;
 };
 updateHeightCaption();
}
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)), vadd=(a,b)=>a.map((v,i)=>v+b[i]), vsub=(a,b)=>a.map((v,i)=>v-b[i]), vmul=(a,s)=>a.map(x=>x*s), dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0), cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]], norm=a=>vmul(a,1/(Math.hypot(...a)||1));
function quat(axis,a){let s=Math.sin(a/2);return [...vmul(axis,s),Math.cos(a/2)];}
function qm(a,b){return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];}
function qr(q,v){let t=vmul(cross(q.slice(0,3),v),2);return vadd(vadd(v,vmul(t,q[3])),cross(q.slice(0,3),t));}
// Shortest-path spherical interpolation prevents a camera spin when restoring an upright view.
function cameraSlerp(from,to,amount){
 let dest=to.slice(),cos=dot(from,dest);
 if(cos<0){dest=dest.map(v=>-v);cos=-cos;}
 if(cos>.9995)return norm(from.map((v,i)=>v+(dest[i]-v)*amount));
 const angle=Math.acos(clamp(cos,-1,1)),scale=Math.sin(angle);
 return norm(from.map((v,i)=>(Math.sin((1-amount)*angle)*v+Math.sin(amount*angle)*dest[i])/scale));
}
function advanceStoreCameraFlight(now){
 if(!cameraFlight)return;
 const flight=cameraFlight;
 const t=clamp((now-flight.since)/flight.duration,0,1);
 const e=t*t*(3-2*t); // smoothstep: no sudden velocity at start/end
 target=flight.fromTarget.map((v,i)=>v+(flight.toTarget[i]-v)*e);
 distance=Math.exp(Math.log(flight.fromDistance)*(1-e)+Math.log(flight.toDistance)*e);
 q=cameraSlerp(flight.fromQ,flight.toQ,e);
 if(t>=1){target=flight.toTarget.slice();distance=flight.toDistance;q=flight.toQ.slice();cameraFlight=null;settleStoreFocus();}
 dirty=true;
}
function storeFocusEvent(type,detail){window.dispatchEvent(new CustomEvent(type,{detail}));}
function settleStoreFocus(){
 const detail=pendingStoreFocus;pendingStoreFocus=null;
 if(detail)storeFocusEvent('retailnav:store-focus-settled',detail);
}
function mm(a,b){let r=new Float32Array(16);for(let c=0;c<4;c++)for(let i=0;i<4;i++)for(let k=0;k<4;k++)r[c*4+i]+=a[k*4+i]*b[c*4+k];return r;}
function mp(m,v){return [0,1,2,3].map(i=>m[i]*v[0]+m[4+i]*v[1]+m[8+i]*v[2]+m[12+i]*v[3]);}
function inverse(m){let a=Array.from({length:4},(_,r)=>[m[r],m[4+r],m[8+r],m[12+r],...Array.from({length:4},(_,c)=>+(c===r))]);for(let c=0;c<4;c++){let r=c;for(let j=c+1;j<4;j++)if(Math.abs(a[j][c])>Math.abs(a[r][c]))r=j;[a[c],a[r]]=[a[r],a[c]];let p=a[c][c];if(Math.abs(p)<1e-10)return null;a[c]=a[c].map(x=>x/p);for(let j=0;j<4;j++)if(j!==c){let f=a[j][c];a[j]=a[j].map((x,k)=>x-f*a[c][k]);}}return new Float32Array(Array.from({length:16},(_,i)=>a[i%4][4+Math.floor(i/4)]));}
function matrices(){let eye=vadd(target,qr(q,[0,0,distance])),z=norm(vsub(eye,target)),x=norm(cross(qr(q,[0,1,0]),z)),y=cross(z,x);let view=new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);let f=1/Math.tan(Math.PI/8),ar=canvas.width/canvas.height,n=.2,far=1800;let p=new Float32Array([f/ar,0,0,0,0,f,0,0,0,0,(far+n)/(n-far),-1,0,0,2*far*n/(n-far),0]);mvp=mm(p,view);invMvp=inverse(mvp);}
function pos(p,y=0){return [(p[0]-cfg.origin[0])*cfg.scale,y,(p[1]-cfg.origin[1])*cfg.scale];}
function height(f){return {anchor:2.2,unit:1.4,amenity:1.08,zone:.55,corridor:.08,slab:-.12,void:.03}[f.k];}
function unpack(raw){let gid=1;return raw.map((v,i)=>{let features=v[3].map(a=>{let x=0,y=0,p=[];for(let j=0;j<a[3].length;j+=2){x+=a[3][j];y+=a[3][j+1];p.push([x/2,y/2]);}return {id:a[0],k:K[a[1]],n:a[2],p,r:a[4].map(r=>r.map(n=>p[n])),t:a[5],c:a[6],gid:gid++,floor:v[0]};});let w=v[4];w.bytes=Uint8Array.from(atob(w.bits),x=>x.charCodeAt(0));return {id:v[0],name:v[1],source:v[2],features,index:i,walk:w,y:i*spread};});}
function mapColor(key,fallback){return window.RetailNavThemes?.color?.(key,fallback)||fallback;}
function mapRgb(key,fallback){return window.RetailNavThemes?.rgb?.(key,fallback)||fallback;}
function rgbHex(v){return '#'+v.map(x=>Math.max(0,Math.min(255,Math.round(x*255))).toString(16).padStart(2,'0')).join('').toUpperCase();}
function blendColors(a,b,k){return a.map((v,i)=>v*(1-k)+b[i]*k);}
function legacyPalette(f,i,line){let cols={anchor:[.24,.36,.48],unit:[.24,.40,.48],amenity:[.05,.73,.81],zone:[.17,.29,.36],corridor:[.10,.43,.47],slab:[.08,.15,.22],void:[.26,.22,.37]};let c=cols[f.k].slice();if(f.k==='amenity')c=f.amenityCategory==='toilet'?[.04,.79,.85]:[.98,.55,.18];if(i===1)c=[c[0]*.85,c[1]*.92,c[2]*1.20];if(i===2)c=[c[0]*1.26,c[1]*.92,c[2]*1.16];if(line){c=f.k==='amenity'?(f.amenityCategory==='toilet'?[.66,.99,.99]:[1,.84,.53]):f.k==='corridor'?[.25,.73,.75]:f.k==='anchor'?[.57,.77,.89]:f.k==='slab'?[.19,.37,.48]:f.k==='void'?[.5,.38,.63]:[.35,.70,.74];if(i===1)c=[c[0],c[1]*.93,Math.min(1,c[2]*1.18)];if(i===2)c=[c[0]*1.5,c[1]*.88,Math.min(1,c[2]*1.17)];}return c;}
function palette(f,i,line){
 const theme=window.RetailNavThemes?.getState?.();
 if(!theme?.enabled)return legacyPalette(f,i,line);
 const type={unit:'mapUnit',anchor:'mapAnchor',amenity:'mapAmenity',
             zone:'mapZone',corridor:'mapCorridor',slab:'mapSlab',
             void:'mapVoid'}[f.k]||'mapZone';
 const fallback=legacyPalette(f,i,line);
 if(line)return mapRgb('mapOutline',fallback);
 const base=mapRgb(type,fallback);
 const floorTone=mapRgb('mapFloor'+(i%3+1),base);
 const influence=f.k==='amenity'||f.k==='void'?.06:
                 f.k==='slab'||f.k==='corridor'?.32:.23;
 return blendColors(base,floorTone,influence).map(x=>Math.max(0,Math.min(1,x)));
}
function geometry(floor){let faces=[],edges=[],points=[],contextEdges=[];const emit=(arr,p,n,c,id)=>arr.push(...p,...n,...c,id);for(const f of floor.features){let h=height(f),col=palette(f,floor.index,false),edgeCol=palette(f,floor.index,true);
 const vectorKey=f.floor+':'+f.id;
 const selectedShop=focusedStoreVectors.has(vectorKey);
 const match=searchMatchedVectors.has(vectorKey);
 if(selectedShop){
  const chosen=mapRgb('mapSelected',[1,.68,.29]);
  col=chosen;edgeCol=blendColors(chosen,[1,1,1],.30);
 }else if(match){
  const chosen=mapRgb('mapSelected',[1,.68,.29]);
  col=blendColors(col,chosen,.30);edgeCol=blendColors(edgeCol,chosen,.52);
 }
 f.flat=[];function tri(a,b,c,n){[a,b,c].forEach(p=>{emit(faces,p,n,col,f.gid);f.flat.push(...p,...n);});}
if(f.k!=='void'){for(let i=0;i<f.t.length;i+=3){let a=pos(f.p[f.t[i]],h),b=pos(f.p[f.t[i+1]],h),c=pos(f.p[f.t[i+2]],h);if(cross(vsub(b,a),vsub(c,a))[1]<0)[b,c]=[c,b];tri(a,b,c,[0,1,0]);}}
for(const ring of f.r){for(let j=0;j<ring.length;j++){let a=pos(ring[j],h),b=pos(ring[(j+1)%ring.length],h);emit(edges,a,[0,0,0],edgeCol,f.gid);emit(edges,b,[0,0,0],edgeCol,f.gid);emit(points,a,[0,0,0],edgeCol,f.gid);if(['anchor','unit','amenity','zone','slab'].includes(f.k)){let bottom=f.k==='slab'?-.55:0,aa=[a[0],bottom,a[2]],bb=[b[0],bottom,b[2]],normal=norm([b[2]-a[2],0,a[0]-b[0]]);tri(aa,bb,b,normal);tri(aa,b,a,normal);if(Math.hypot(a[0]-b[0],a[2]-b[2])>1.1){emit(edges,aa,[0,0,0],vmul(edgeCol,.65),f.gid);emit(edges,a,[0,0,0],vmul(edgeCol,.65),f.gid);}}}}
f.flat=new Float32Array(f.flat);}
function buffer(arr){let b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(arr),gl.STATIC_DRAW);return {b,n:arr.length/10};}if(gl){
 for(const f of floor.features)for(const ring of f.r)for(let i=0;i<ring.length;i++){
  for(const p of [ring[i],ring[(i+1)%ring.length]])contextEdges.push(...pos(p,-.12),0,0,0,.28,.58,.65,f.gid);
 }
 floor.gpu={faces:buffer(faces),edges:buffer(edges),points:buffer(points),context:buffer(contextEdges)};
 // Raised letters share world-space coordinates with the roof's geometry.
 floor.roofGpu={};
 for(const key of ['codes','frontCodes','names','frontNames','services']){
  const verts=floor.roofText?.[key];
  floor.roofGpu[key]=verts?.length?buffer(verts):null;
 }
}}
function shader(type,src){let s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
function initGL(){gl=canvas.getContext('webgl',{antialias:true,alpha:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});if(!gl){ctx2d=canvas.getContext('2d',{alpha:true});if(!ctx2d)throw new Error('El navegador no permite dibujar el mapa interactivo.');return;}program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,`attribute vec3 aPos;attribute vec3 aNormal;attribute vec3 aColor;attribute float aId;uniform mat4 uMvp;uniform float uY;uniform float uPoint;varying vec3 vNormal;varying vec3 vColor;varying float vId;void main(){vec3 p=aPos;p.y+=uY;gl_Position=uMvp*vec4(p,1.);gl_PointSize=uPoint;vNormal=aNormal;vColor=aColor;vId=aId;}`));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`precision mediump float;varying vec3 vNormal;varying vec3 vColor;varying float vId;uniform float uSelected;uniform float uLine;uniform float uWire;uniform float uAlpha;uniform vec3 uSelectedColor;void main(){bool sel=abs(vId-uSelected)<.1;vec3 c=sel?uSelectedColor:vColor;float light=.58+.42*abs(dot(normalize(vNormal+vec3(.0001)),normalize(vec3(-.4,.8,.3))));if(uLine>.5)light=1.;if(uWire>.5&&uLine<.5)c*=.32;gl_FragColor=vec4(c*light,uAlpha);}`));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);loc={};['aPos','aNormal','aColor','aId'].forEach(x=>loc[x]=gl.getAttribLocation(program,x));['uMvp','uY','uPoint','uSelected','uSelectedColor','uLine','uWire','uAlpha'].forEach(x=>loc[x]=gl.getUniformLocation(program,x));gl.uniform3fv(loc.uSelectedColor,new Float32Array(mapRgb('mapSelected',[1,.68,.29])));gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();fail('El sistema suspendio el renderizador 3D. Recarga la pagina para recuperarlo.');});}
function bind(g){gl.bindBuffer(gl.ARRAY_BUFFER,g.b);let names=['aPos','aNormal','aColor','aId'],sizes=[3,3,3,1],offs=[0,12,24,36];names.forEach((n,i)=>{gl.enableVertexAttribArray(loc[n]);gl.vertexAttribPointer(loc[n],sizes[i],gl.FLOAT,false,40,offs[i]);});}
let grid;
function makeGrid(){if(!gl)return;let a=[];const tone=mapRgb('mapGrid',[.065,.13,.19]);for(let n=-85;n<=85;n+=5){for(let p of [[n,-.9,-70],[n,-.9,70],[-85,-.9,n],[85,-.9,n]])a.push(...p,0,0,0,...tone,-2);}if(grid?.b)gl.deleteBuffer(grid.b);let b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(a),gl.STATIC_DRAW);grid={b,n:a.length/10};}
function resize(){let r=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);let w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;if(gl)gl.viewport(0,0,w,h);} }
function referenceContext(floor){return Boolean(focusFloorId&&floor.id!==focusFloorId);}
function visible(){const routeFloors=new Set(wayfindingOpen?(wayfinding?.routeSegments||[]).map(s=>s.floor):[]);return floors.filter(f=>focusFloorId
 ?f.id===focusFloorId||f.id===wayfindingOrigin()?.floor||routeFloors.has(f.id)
 :(searchFloorSet?searchFloorSet.has(f.id):active==='ALL'||f.id===active));}
function groundReferenceFloor(){
 const preferred=selectedMall.defaultVisitorReference?.floor;
 return floors.some(f=>f.id===preferred)?preferred:
  (floors.find(f=>['PB','G','GF','P0','L1','1','LL'].includes(f.id))?.id||floors[0]?.id);
}
function visitorFloorReference(){
 const positioning=window.RetailNavIndoor?.getState?.();
 const floor=positioning?.referenceFloor||positioning?.anchor?.floor;
 return floors.some(f=>f.id===floor)?floor:groundReferenceFloor();
}
function showFloorReference(){
 const label=$('rnFloorReference');
 if(!label)return;
 const pos=window.RetailNavIndoor?.getState?.();
 const floor=visitorFloorReference();
 const actual=Boolean(pos?.anchor&&pos?.referenceSource!=='fallback-entry'&&pos?.referenceSource!=='fallback-floor');
 label.textContent=(actual?'Planta indicada ':'Referencia provisional ')+floor+
  (focusFloorId?' · Destino '+focusFloorId+(floor!==focusFloorId?' · Tu planta en contornos':''):(searchFloorSet?' · '+searchFloorSet.size+' plantas abiertas':''));
 label.title=actual?'Referencia del usuario; la precisión depende de su fuente':
  'Sin piso interior verificado: planta baja/1 o primera planta disponible. No equivale a posición GPS.';
}
function applySearchFloors(query){
 clearWayfinding();
 focusFloorId=null;cameraFlight=null;focusedStoreId=null;focusedStoreVector=null;focusedStoreVectors.clear();
 const term=String(query||'').trim();
 if(!term){clearSearchFloors();return {floors:[],matches:0};}
 window.RetailNavUnits?.setQuery?.(term);
 searchCommitted=term;
 const matches=window.RetailNavUnits?.find?.(term)||[];
 const services=window.RetailNavPOI?.find?.(term)||[];
 const districts=window.RetailNavDistricts?.find?.(term)||[];
 const total=matches.length+services.length+districts.length;
 const lang=window.RetailNavI18n;
 const ref=visitorFloorReference();
 if(ref)active=ref;
 searchFloorSet=new Set([ref,...matches.flatMap(u=>{
  const mapped=window.RetailNavUnits?.getMappedFloors?.(u)||[];
  return mapped.length?mapped:u.documentedFloors?.length?u.documentedFloors:[u.floor];
 }),...services.map(p=>p.floor),
  ...districts.map(d=>d.floor)].filter(id=>floors.some(f=>f.id===id)));
 // Frame the vertical range of the open shop floors without moving any
 // actual slabs, recalculating their height or altering escalator landings.
 const openedY=floors.filter(f=>searchFloorSet.has(f.id)).map(f=>f.y);
 if(openedY.length)target[1]=(Math.min(...openedY)+Math.max(...openedY))/2;
 searchMatchedVectors=new Set((window.RetailNavUnits?.getMatchedVectors?.()||[])
  .map(v=>v.floor+':'+v.polygonId));
 rebuildSearchGeometry();
 const picker=$('floorSelect');
 if(picker){
  let group=picker.querySelector('option[value="MATCHES"]');
  if(!group){
   group=document.createElement('option');group.value='MATCHES';
   picker.prepend(group);
  }
  group.textContent=(lang?.ui('myFloor')||'Mi planta')+' + '+total+' '+
   (lang?.ui('results')||'coincidencias')+' ('+searchFloorSet.size+' '+(lang?.ui('floors')||'pisos')+')';
  picker.value='MATCHES';
 }
 $('showAllFloors').hidden=floors.length<2;
 $('showAllFloors').textContent='← Todas las plantas';
 $('floorSpacing').hidden=floors.length<2;
 $('spread').disabled=floors.length<2;
 $('mapTitle').textContent=(lang?.ui('myFloor')||'Mi planta')+' '+ref+' · '+total+' '+
  (lang?.ui('results')||'coincidencias');
 $('mapSubtitle').textContent=(lang?.ui('floors')||'Plantas')+': '+[...searchFloorSet].join(', ')+
  '. '+(lang?.ui('mapWarning')||'Información provisional.');
 showFloorReference();dirty=true;
 return {floors:[...searchFloorSet],userFloor:ref,matches:total,
  vectors:searchMatchedVectors.size,stores:matches.length,services:services.length};
}
function clearSearchFloors(){
 clearWayfinding();
 cameraFlight=null;focusFloorId=null;focusedStoreId=null;focusedStoreVector=null;focusedStoreVectors.clear();
 searchFloorSet=null;searchCommitted='';searchMatchedVectors.clear();
 window.RetailNavUnits?.clearQuery?.();
 const picker=$('floorSelect');
 picker?.querySelector('option[value="MATCHES"]')?.remove();
 if(picker&&[...picker.options].some(o=>o.value===active))picker.value=active;
 target[1]=floorFocusY();
 rebuildSearchGeometry();showFloorReference();dirty=true;
}
function drawSearchMarkers(){
 const host=$('rnSearchMarkers');
 if(!host)return;
 if(!searchFloorSet||!searchCommitted){
  for(const button of searchMarkerElements.values())button.hidden=true;
  return;
 }
 const normalizeName=value=>String(value||'').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
 const queryName=normalizeName(searchCommitted);
 const namePriority=store=>{
  const name=normalizeName(store.name);
  return !queryName||!name?0:name===queryName?3:name.startsWith(queryName)?2:name.includes(queryName)?1:0;
 };
 const matching=(window.RetailNavUnits?.find?.(searchCommitted)||[])
  .sort((a,b)=>namePriority(b)-namePriority(a));
 const showing=new Set(),occupied=[];
 for(const store of matching){
  const id=store.storeId||(mallId+':'+store.floor+':'+store.code);
  if(focusFloorId&&id!==focusedStoreId)continue;
  const bindings=window.RetailNavUnits?.getMapBindings?.(store)||[];
  const placements=new Map();
  for(const binding of bindings){
   const floor=floors.find(f=>f.id===binding.floor),feature=floor?.features.find(f=>f.id===binding.polygonId);
   if(feature&&!placements.has(floor.id))placements.set(floor.id,{floor,centre:feature.c,source:true});
  }
  if(!bindings.length&&!store.sourceGeometry&&Number.isFinite(store.x)&&Number.isFinite(store.y)){
   const floor=floors.find(f=>f.id===store.floor);
   if(floor)placements.set(floor.id,{floor,centre:[store.x,store.y],source:false});
  }
  for(const {floor,centre,source} of placements.values()){
  if(!searchFloorSet.has(floor.id)||(focusFloorId&&floor.id!==focusFloorId))continue;
  const key=id+'@'+floor.id;
  const point=screen(pos(centre,floor.y+3));
  if(!point||point.w<=0||point.z<=-1||point.z>=1||
   point.x<8||point.y<8||point.x>host.clientWidth-8||
   point.y>host.clientHeight-8)continue;
  let marker=searchMarkerElements.get(key);
  if(!marker){
   marker=document.createElement('button');
   marker.type='button';marker.className='rnSearchMarker';
   marker.dataset.storeId=id;
   marker.dataset.floor=floor.id;
   marker.setAttribute('aria-label','Ver '+(store.name||store.code)+
    ' en planta '+floor.id+(source?' · vinculado al mapa':' · referencia provisional'));
   marker.addEventListener('click',event=>{
    event.stopPropagation();
    // Every user-visible store marker enters the same selection contract. An
    // unlinked marker still gets invite/info actions; orientation stays
    // disabled because no shop geometry or verified destination was invented.
    if(window.RetailNavMeetups?.selectStore)window.RetailNavMeetups.selectStore(id,false,floor.id);
    else window.RetailNavUnits?.focusStore?.(id,floor.id);
   });
   host.append(marker);searchMarkerElements.set(key,marker);
  }
  marker.textContent=(source?store.name:(store.code||store.name))+(placements.size>1?' · '+floor.id:'');
  marker.title=floor.id+' · '+(store.name||store.code)+
   (source?' · geometría de fuente oficial':store.vectorVerified?' · vector validado':' · posición aproximada, vector provisional');
  marker.hidden=false;
  marker.classList.toggle('rnSearchMarkerChosen',focusedStoreId===id&&focusFloorId===floor.id);
  marker.style.left=point.x.toFixed(1)+'px';
  marker.style.top=point.y.toFixed(1)+'px';
  const rect=marker.getBoundingClientRect();
  // Keep labels at their real polygon anchors. A nearby merchant named in a
  // location description must not cover the merchant the visitor searched for.
  const collides=occupied.some(other=>other.storeId!==id&&
   rect.left<other.rect.right+4&&rect.right>other.rect.left-4&&
   rect.top<other.rect.bottom+4&&rect.bottom>other.rect.top-4);
  if(collides){marker.hidden=true;continue;}
  occupied.push({storeId:id,rect});
  showing.add(key);
  }
 }
 for(const [id,marker] of searchMarkerElements)if(!showing.has(id))marker.hidden=true;
}
function rebuildSearchGeometry(floorIds=null){
 if(!ready||!gl)return;
 for(const floor of floors){
  if(floorIds&&!floorIds.has(floor.id))continue;
  for(const item of Object.values(floor.gpu||{}))if(item?.b)gl.deleteBuffer(item.b);
  for(const item of Object.values(floor.roofGpu||{}))if(item?.b)gl.deleteBuffer(item.b);
  geometry(floor);
 }
}
// The selected source polygon is highlighted using this mall's configured
// mapSelected color; other tag matches stay visible in a weaker accent.
function setFocusedStoreVector(storeId,floorId,polygonIds){
 const floor=floors.find(f=>f.id===floorId);
 const ids=Array.isArray(polygonIds)?polygonIds:[polygonIds];
 const next=new Set(ids.filter(id=>id&&floor?.features.some(f=>f.id===id)).map(id=>floorId+':'+id));
 const affected=new Set([...focusedStoreVectors,...next].map(v=>v.split(':')[0]));
 focusedStoreId=storeId||null;focusedStoreVectors=next;focusedStoreVector=[...next][0]||null;
 rebuildSearchGeometry(affected);dirty=true;
}
// Orientation belongs to the existing camera and source mesh. An anchor is
// usable only in this coordinate frame; a default floor is never a location.
function wayfindingOrigin(){
 const s=window.RetailNavIndoor?.getState?.(),p=s?.referencePoint;
 if(!p||['fallback-floor','fallback-entry'].includes(s.referenceSource)||
  p.mallId!==mallId||p.coordinateSpace!==(selectedMall.coordinateSpace||'mall-photo-pixels')||
  ![p.x,p.y].every(Number.isFinite)||!floors.some(f=>f.id===p.floor))return null;
 return {floor:p.floor,x:p.x,y:p.y,source:p.source};
}
function clearWayfinding(){
 pendingOriginDestination=null;placingPosition=false;placingLocalOnly=false;canvas.classList.remove('placing');
 wayfinding=null;wayfindingOpen=false;wayfindingCompact=false;pendingStoreFocus=null;
 storeFocusEvent('retailnav:store-focus-start',{storeId:null,assistanceOpen:false});
 document.querySelector('.stage')?.classList.remove('rnWayfindingActive','rnWayfindingPlacing','rnWayfindingRouteOnly');
 for(const id of ['rnWayfinding','rnWayfindingOverlay'])if($(id))$(id).hidden=true;
}
function updateWayfindingUI(){
 if(!wayfinding||!$('rnWayfinding'))return;
 if(!wayfindingOpen){
  document.querySelector('.stage')?.classList.remove('rnWayfindingActive','rnWayfindingPlacing','rnWayfindingRouteOnly');
  $('rnWayfinding').hidden=true;$('rnWayfindingOverlay').hidden=true;return;
 }
 const w=wayfinding,en=window.RetailNavI18n?.locale?.().startsWith('en');
 document.querySelector('.stage')?.classList.add('rnWayfindingActive');
 document.querySelector('.stage')?.classList.toggle('rnWayfindingRouteOnly',wayfindingCompact);
 document.querySelector('.stage')?.classList.toggle('rnWayfindingPlacing',Boolean(w.placing));
 $('rnWayfinding').hidden=wayfindingCompact;$('rnWayfindingOverlay').hidden=false;
 $('rnWayfindingOverlay').classList.toggle('is-flowing',wayfindingCompact&&w.status==='provisional');
 $('rnWayfindingDestination').textContent=w.name;
 $('rnWayfindingTargetName').textContent=w.name;
 $('rnWayfindingOriginLabel').textContent=(en?'You':'Vos')+' · '+(w.origin?.floor||'');
 const d=w.floorDelta;
 $('rnWayfindingRelation').textContent=w.placing?(en?'Choose your starting point':'Elegí tu punto de partida'):
  w.mode==='unplaced'?(en?'Location pending':'Ubicación pendiente'):
  w.mode==='no-origin'?(en?'Where are you starting?':'¿Desde dónde salís?'):
  d===0?(en?'Same floor':'Misma planta'):
  Math.abs(d)+' '+(en?(Math.abs(d)===1?'floor':'floors'):(Math.abs(d)===1?'planta':'plantas'))+' '+
   (d>0?(en?'above':'arriba'):(en?'below':'abajo'));
 $('rnWayfindingDetail').textContent=w.placing?(en?'Tap your location on '+active+' · stays on this device':'Tocá dónde estás en '+active+' · queda en este dispositivo'):
  w.origin?(en?'You: ':'Vos: ')+w.origin.floor+' · '+(en?'Destination: ':'Destino: ')+(w.floor||'—'):
  (w.floor?(en?'Destination on ':'Destino en ')+w.floor+'. ':'')+(en?'Mark your location to see both points.':'Marcá tu ubicación para ver ambos puntos.');
 const levelHost=$('rnWayfindingLevels');levelHost.replaceChildren();
 if(w.mode==='different-floor'&&!w.placing){
  const start=floors.findIndex(f=>f.id===w.origin.floor),end=floors.findIndex(f=>f.id===w.floor);
  for(let i=Math.max(start,end);i>=Math.min(start,end);i--){
   const el=document.createElement('span'),id=floors[i].id;
   el.textContent=id+(i===start?(en?' · You':' · Vos'):i===end?(en?' · Destination':' · Destino'):'');
   if(i===start)el.dataset.role='origin';else if(i===end)el.dataset.role='destination';
   levelHost.append(el);
  }
 }
 levelHost.hidden=!levelHost.children.length;
 const status=w.placing?(en?'Tap a blue corridor point if you are there, or mark your location on the floor.':'Tocá un punto celeste del pasillo si estás allí, o marcá tu ubicación en la planta.'):
  w.mode==='unplaced'?(en?'This store has no confirmed position on this map.':'Este comercio aún no tiene una posición vinculada en este plano.'):
  w.mode==='different-floor'?(en?'Floor separation is illustrative. Connection between floors is unverified.':'Separación ilustrativa. Conexión entre plantas sin verificar.'):
  w.status==='provisional'?(en?'Hollow circles: provisional path to the storefront. Walking access is unverified.':'Círculos huecos: trazado provisional hasta el frente del local. Paso peatonal sin verificar.'):
  w.origin?(en?'No continuous path confirmed from this point.':'Sin recorrido continuo confirmado desde este punto.'):
  (en?'Your location is not known inside the mall.':'Todavía no conocemos tu ubicación dentro del shopping.');
 $('rnWayfindingStatus').textContent=status;
 $('rnWayfindingStatus').dataset.state=w.status;
 $('rnWayfindingOverlay').dataset.routeStatus=w.status;
 const picker=$('rnWayfindingOriginFloor');
 if(!picker.options.length)for(const f of floors){const option=new Option(f.id,f.id);picker.add(option);}
 if(!w.placing)picker.value=w.origin?.floor||visitorFloorReference();
 $('rnWayfindingLocate').textContent=w.placing?(en?'Cancel':'Cancelar'):(w.origin?(en?'Move my location':'Cambiar mi ubicación'):(en?'Mark my location':'Marcar mi ubicación'));
 $('rnWayfindingReframe').hidden=w.placing||w.mode==='unplaced';
 $('rnWayfindingReframe').textContent=w.origin?(en?'Frame both':'Ver ambos'):(en?'View store':'Ver local');
 $('rnWayfindingClose').setAttribute('aria-label',en?'Explore map':'Explorar mapa');
 $('rnWayfindingOriginFloorLabel').textContent=en?'Starting floor':'Planta de partida';
}
function updateWayfindingRoute(){
 if(!wayfinding)return;
 const w=wayfinding;
 const result=w.origin&&w.destination?window.RetailNavWayfindingRoute?.plan?.({mallId,
  coordinateSpace:selectedMall.coordinateSpace,floor:w.floor,origin:w.origin,
  destinationPolygonIds:w.polygonIds}):null;
 w.status=result?.status||'unavailable';w.points=result?.points||[];
 w.routeSegments=result?.routeSegments||[];w.connectorsUsed=result?.connectorsUsed||[];
 w.routeReason=result?.reason||'no-continuous-route';
 updateWayfindingUI();
}
let wayfindingEvidenceStarted=false;
async function loadWayfindingEvidence(){
 if(wayfindingEvidenceStarted)return;
 wayfindingEvidenceStarted=true;
 const asset=selectedMall.routingPreviewAsset;
 if(!asset||asset.sourceSnapshotSha256!==selectedMall.sourceMapSha256)return;
 try{
  const response=await fetch(asset.url,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)return;
  const bytes=await response.arrayBuffer();
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==asset.sha256)return;
  const evidence=JSON.parse(new TextDecoder().decode(bytes));
  if(evidence.source?.sha256!==asset.sourceSha256||evidence.coordinateSpace!==selectedMall.coordinateSpace)return;
  if(window.RetailNavWayfindingRoute?.configure(evidence)){
   dirty=true;
   if(wayfindingOpen&&wayfinding&&!wayfinding.placing)focusCatalogStore(wayfinding.storeId,wayfinding.floor);
  }
 }catch{ /* Evidence unavailable: keep endpoints, never invent a route. */ }
}
function makeWayfinding(unit,floor,point,features,open=wayfindingOpen){
 wayfindingOpen=Boolean(open);
 const origin=wayfindingOrigin(),floorId=floor?.id||null;
 const delta=origin&&floor?floors.indexOf(floor)-floors.findIndex(f=>f.id===origin.floor):null;
 wayfinding={storeId:unit?.storeId||focusedStoreId,name:unit?.name||unit?.code||'',floor:floorId,
  origin,destination:point?{x:point[0],y:point[1],floor:floorId}:null,
  floorDelta:delta,mode:!point?'unplaced':!origin?'no-origin':delta===0?'same-floor':'different-floor',
  polygonIds:features.map(f=>f.id),status:'unavailable',points:[],routeSegments:[],connectorsUsed:[],placing:false};
 updateWayfindingRoute();
}
// Fit actual world geometry into the free area below the orientation card.
// This includes both anchors and every route vertex, not just the shop centre.
function wayfindingCamera(features,floor,point){
 const w=wayfinding,topDown=w?.mode==='same-floor';
 const yaw=topDown?0:-.30,pitch=topDown?MIN_PITCH:-.96;
 const rotation=norm(qm(quat([0,1,0],yaw),quat([1,0,0],pitch)));
 const frame=features.flatMap(f=>f.p.map(p=>pos(p,floor.y+height(f))));
 frame.push(pos(point,floor.y+2));
 if(w?.origin){const originFloor=floors.find(f=>f.id===w.origin.floor);frame.push(pos([w.origin.x,w.origin.y],originFloor.y+2));}
 for(const segment of w?.routeSegments||[]){const segmentFloor=floors.find(f=>f.id===segment.floor);
  if(segmentFloor)for(const p of segment.points)frame.push(pos(p,segmentFloor.y+.5));}
 const centre=[0,1,2].map(k=>(Math.min(...frame.map(p=>p[k]))+Math.max(...frame.map(p=>p[k])))/2);
 const inverseQ=[-rotation[0],-rotation[1],-rotation[2],rotation[3]];
 const local=frame.map(p=>qr(inverseQ,vsub(p,centre)));
 const rect=canvas.getBoundingClientRect(),panel=wayfindingOpen&&!wayfindingCompact?$('rnWayfinding')?.getBoundingClientRect():null;
 const top=panel?Math.max(110,panel.bottom-rect.top+64):72;
 const bottom=Math.max(top+80,rect.height-96),left=100,right=rect.width-100;
 const focal=rect.height/(2*Math.tan(Math.PI/8));
 const offsetX=(left+right)/2-rect.width/2,offsetY=(top+bottom)/2-rect.height/2;
 // Solve the perspective bounds including depth and the off-centre card.
 // A symmetric sphere fit clips the near endpoint in exploded-floor views.
 const bounds=[left-rect.width/2,right-rect.width/2,top-rect.height/2,bottom-rect.height/2];
 let needed=32;
 for(const [x,y,z] of local){
  needed=Math.max(needed,z+4,
   (focal*x+bounds[0]*z)/(bounds[0]-offsetX),
   (focal*x+bounds[1]*z)/(bounds[1]-offsetX),
   (-focal*y+bounds[2]*z)/(bounds[2]-offsetY),
   (-focal*y+bounds[3]*z)/(bounds[3]-offsetY));
 }
 const aim=clamp(needed*1.08,32,MAX_ZOOM_DISTANCE);
 const shifted=vadd(centre,qr(rotation,[-offsetX*aim/focal,offsetY*aim/focal,0]));
 return {target:shifted,distance:aim,q:rotation,yaw,pitch,topDown};
}
let wayfindingDots=[];
let wayfindingStarts=[];
function drawWayfindingStarts(){
 for(const el of wayfindingStarts)el.hidden=true;
 if(!wayfinding?.placing)return;
 const candidates=window.RetailNavWayfindingRoute?.getOriginCandidates?.({mallId,
  coordinateSpace:selectedMall.coordinateSpace,floor:active,destinationFloor:wayfinding.floor,
  destinationPolygonIds:wayfinding.polygonIds})||[];
 const floor=floors.find(f=>f.id===active),rect=canvas.getBoundingClientRect();
 const panel=$('rnWayfinding').getBoundingClientRect(),placed=[];
 const points=candidates.map(at=>({at,p:screen(pos([at.x,at.y],floor.y))}));
 points.sort((a,b)=>Math.hypot(a.p.x-rect.width/2,a.p.y-rect.height*.7)-Math.hypot(b.p.x-rect.width/2,b.p.y-rect.height*.7));
 for(const {at,p} of points){
  if(placed.length>=36)break;
  if(p.w<=0||p.x<25||p.x>rect.width-25||p.y<panel.bottom-rect.top+28||p.y>rect.height-50||
   placed.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<50))continue;
  const i=placed.length;let button=wayfindingStarts[i];
  if(!button){
   button=document.createElement('button');button.type='button';button.className='rnWayfindingStart';
   button.onclick=event=>{event.stopPropagation();if(placingPosition&&button.sourcePoint)completeManualPosition(button.sourcePoint);};
   $('rnWayfindingOverlay').append(button);wayfindingStarts.push(button);
  }
  button.sourcePoint=at;button.hidden=false;button.style.left=p.x+'px';button.style.top=p.y+'px';
  button.setAttribute('aria-label','Marcar mi punto de partida en este pasillo · '+at.floor);
  placed.push(p);
 }
}
function drawWayfinding(){
 drawWayfindingStarts();
 if(!wayfindingOpen||!wayfinding||!$('rnWayfindingOverlay'))return;
 if(wayfinding.placing){
  $('rnWayfindingOrigin').hidden=true;$('rnWayfindingTarget').hidden=true;
  for(const dot of wayfindingDots)dot.hidden=true;
  return;
 }
 const w=wayfinding,rect=canvas.getBoundingClientRect();
 const place=(el,at)=>{
  const floor=floors.find(f=>f.id===at?.floor),p=floor&&screen(pos([at.x,at.y],floor.y+2));
  el.hidden=!p||p.w<=0||p.z<=-1||p.z>=1||p.x<14||p.x>rect.width-14||p.y<14||p.y>rect.height-14;
  if(!el.hidden){el.style.left=p.x+'px';el.style.top=p.y+'px';}
 };
 place($('rnWayfindingOrigin'),w.origin);place($('rnWayfindingTarget'),w.destination);
 // Fixed screen-size dots follow each projected source segment. Separate floor
 // segments meet only through connectors already accepted by the planner.
 const samples=[];
 if(w.status==='provisional')for(const segment of w.routeSegments||[]){
  const floor=floors.find(f=>f.id===segment.floor);if(!floor)continue;
  let remainder=0;
  for(let i=1;i<segment.points.length;i++){
   const a=screen(pos(segment.points[i-1],floor.y+.5)),b=screen(pos(segment.points[i],floor.y+.5));
   if(a.w<=0||b.w<=0)continue;
   const length=Math.hypot(b.x-a.x,b.y-a.y);
   for(let d=remainder;d<length;d+=17){const t=d/length;samples.push([a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t]);}
   remainder=(remainder-length)%17;if(remainder<0)remainder+=17;
  }
 }
 const host=$('rnWayfindingDots');
 while(wayfindingDots.length<samples.length&&wayfindingDots.length<700){const dot=document.createElement('i');dot.className='rnWayfindingDot';host.append(dot);wayfindingDots.push(dot);}
 for(let i=0;i<wayfindingDots.length;i++){
  const dot=wayfindingDots[i],p=samples[i];dot.hidden=!p||p[0]<8||p[0]>rect.width-8||p[1]<8||p[1]>rect.height-8;
  if(!dot.hidden){dot.style.left=p[0]+'px';dot.style.top=p[1]+'px';dot.style.setProperty('--rn-dot-index',i);}
 }
}
function beginWayfindingLocation(){
 if(!wayfinding)return;
 if(wayfinding.placing){const saved=pendingOriginDestination;pendingOriginDestination=null;placingPosition=false;canvas.classList.remove('placing');if(saved)focusCatalogStore(saved.storeId,saved.floor);return;}
 const saved={storeId:wayfinding.storeId,floor:wayfinding.floor},ui=wayfinding;
 setFloor($('rnWayfindingOriginFloor').value||visitorFloorReference());
 pendingOriginDestination=saved;
 wayfinding=ui;wayfindingOpen=true;wayfinding.placing=true;resetCamera(true);updateWayfindingUI();
 placingPosition=true;placingLocalOnly=true;canvas.classList.add('placing');dirty=true;
}
let wayfindingResizeTimer;
function reframeAfterResize(){
 if(!ready)return;
 resize();dirty=true;clearTimeout(wayfindingResizeTimer);
 wayfindingResizeTimer=setTimeout(()=>{
  if(wayfindingOpen&&wayfinding&&!wayfinding.placing)focusCatalogStore(wayfinding.storeId,wayfinding.floor);
 },100);
}
window.addEventListener('retailnav:header-layout',reframeAfterResize);
function bindWayfinding(){
 $('rnWayfindingLocate').onclick=beginWayfindingLocation;
 $('rnWayfindingOriginFloor').onchange=()=>{
  if(!wayfinding?.placing)return;
  const ui=wayfinding,saved=pendingOriginDestination;setFloor($('rnWayfindingOriginFloor').value);wayfinding=ui;
  wayfindingOpen=true;pendingOriginDestination=saved;placingPosition=true;placingLocalOnly=true;canvas.classList.add('placing');
  resetCamera(true);updateWayfindingUI();dirty=true;
 };
 $('rnWayfindingReframe').onclick=()=>{if(wayfinding)focusCatalogStore(wayfinding.storeId,wayfinding.floor);};
 $('rnWayfindingClose').onclick=()=>{
  pendingOriginDestination=null;placingPosition=false;placingLocalOnly=false;canvas.classList.remove('placing');
  wayfindingOpen=false;wayfindingCompact=false;updateWayfindingUI();dirty=true;
  setFloor(wayfinding?.floor||visitorFloorReference());
 };
}

function focusCatalogStore(storeId,requestedFloor){
 if(!ready)return {located:false,reason:'map-not-ready'};
 const keepAssistance=Boolean(wayfindingOpen&&wayfinding?.storeId===storeId);
 wayfindingOpen=keepAssistance;if(!keepAssistance)wayfindingCompact=false;pendingStoreFocus=null;
 storeFocusEvent('retailnav:store-focus-start',{storeId,assistanceOpen:keepAssistance});
 const unit=window.RetailNavUnits?.getUnits?.().find(u=>u.storeId===storeId&&u.mallId===mallId);
 const allowed=window.RetailNavUnits?.getMapBindings?.(unit)||[];
 const source=allowed.length>0;
 const floorId=requestedFloor||allowed[0]?.floor||unit?.floor;
 const floor=floors.find(f=>f.id===floorId);
 const ids=source?allowed.filter(p=>p.floor===floorId).map(p=>p.polygonId):
  (!selectedMall.coordinateSpace&&unit?.vectorRelation==='one-photo-region-unverified'?[unit.polygonId]:[]);
 const features=(floor?.features||[]).filter(f=>ids.includes(f.id));
 const p=source?features[0]?.c:(!selectedMall.coordinateSpace&&unit?.floor===floorId&&Number.isFinite(unit.x)&&Number.isFinite(unit.y)?[unit.x,unit.y]:null);
 pendingOriginDestination=null;placingPosition=false;placingLocalOnly=false;canvas.classList.remove('placing');
 selected=null;route=null;routeRunning=false;cameraFlight=null;
 setFocusedStoreVector(storeId,floorId,features.map(f=>f.id));
 makeWayfinding(unit,floor,p,features,keepAssistance);
 loadWayfindingEvidence();
 const en=window.RetailNavI18n?.locale?.().startsWith('en');
 $('mapTitle').textContent=unit?(unit.name||unit.code)+' · '+(floorId||''):(en?'Select a store':'Seleccioná un comercio');
 $('mapSubtitle').textContent=(en?'Your floor: ':'Tu planta: ')+visitorFloorReference()+' · '+(en?'No verified walking route':'Sin ruta peatonal verificada');
 if(!floor||!p){
  focusFloorId=unit&&floor?floorId:null;
  if(focusFloorId){active=floorId;searchFloorSet?.add(floorId);}
  resetCamera();showFloorReference();
  lastStoreFocus={storeId,located:false,source:false,floor:focusFloorId,reason:'unplaced-directory',
   originKnown:Boolean(wayfinding?.origin),routeStatus:wayfinding?.status,assistanceOpen:wayfindingOpen};
  pendingStoreFocus={...lastStoreFocus};queueMicrotask(settleStoreFocus);
  dirty=true;return lastStoreFocus;
 }
 focusFloorId=floorId;
 searchFloorSet?.add(floorId);
 if(!searchFloorSet){active=floorId;if($('floorSelect'))$('floorSelect').value=floorId;}
 $('showAllFloors').hidden=false;
 $('showAllFloors').textContent='← Ver todas las plantas';
 stopAuto();
 const camera=wayfindingCamera(features,floor,p);
 const aimDistance=camera.distance,finalTarget=camera.target,endQ=camera.q;
 const needsRotate=Math.abs(dot(q,endQ))<.9999;
 const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
 const moving=Math.hypot(...vsub(target,finalTarget))>.3||Math.abs(distance-aimDistance)>1||needsRotate;
 lastStoreFocus={storeId,located:true,source,floor:floorId,referenceFloor:visitorFloorReference(),vectorHighlighted:focusedStoreVectors.size>0,
  originKnown:Boolean(wayfinding?.origin),routeStatus:wayfinding?.status,
  rotated:needsRotate,animated:Boolean(moving&&!reduced),durationMs:moving&&!reduced?860:0,assistanceOpen:wayfindingOpen};
 pendingStoreFocus={...lastStoreFocus};
 if(!moving||reduced){target=finalTarget;distance=aimDistance;q=endQ;cameraFlight=null;queueMicrotask(settleStoreFocus);}
 else cameraFlight={since:performance.now(),duration:860,fromTarget:target.slice(),
  toTarget:finalTarget,fromDistance:distance,toDistance:aimDistance,fromQ:q.slice(),toQ:endQ};
 earth2D=camera.topDown;orbitYaw=camera.yaw;orbitPitch=camera.pitch;orbitRoll=0;
 showFloorReference();dirty=true;return lastStoreFocus;
}
function openStoreAssistance(storeId,requestedFloor){
 if(!ready)return{opened:false,reason:'map-not-ready'};
 const id=storeId||focusedStoreId;if(!id)return{opened:false,reason:'no-store'};
 if(!wayfinding||wayfinding.storeId!==id)return{opened:false,reason:'store-not-focused'};
 if(!wayfinding.origin)return{opened:false,reason:'origin-unavailable'};
 wayfindingOpen=true;wayfindingCompact=true;updateWayfindingRoute();dirty=true;
 if(wayfinding.status!=='provisional')notify(wayfinding.routeReason==='vertical-connection-unavailable'
  ?'La ruta entre plantas se activará cuando estén verificados los desembarcos de escaleras mecánicas o ascensores.'
  :'No hay continuidad confirmada desde esta ubicación hasta el local; no se dibuja un atajo.');
 storeFocusEvent('retailnav:store-route-state',{storeId:id,open:true,status:wayfinding.status,
  reason:wayfinding.routeReason,connectorsUsed:wayfinding.connectorsUsed.length});
 return{opened:true,located:Boolean(wayfinding.destination),originKnown:true,status:wayfinding.status,
  reason:wayfinding.routeReason,connectorsUsed:wayfinding.connectorsUsed.length};
}
function closeStoreAssistance(){
 if(!wayfindingOpen)return false;
 const id=wayfinding?.storeId;wayfindingOpen=false;wayfindingCompact=false;updateWayfindingUI();dirty=true;
 storeFocusEvent('retailnav:store-route-state',{storeId:id,open:false,status:wayfinding?.status});return true;
}

function screen(p){let v=mp(mvp,[...p,1]);let r=canvas.getBoundingClientRect();return {x:(v[0]/v[3]*.5+.5)*r.width,y:(.5-v[1]/v[3]*.5)*r.height,z:v[2]/v[3],w:v[3]};}
let labelElems=[];let placingPosition=false;
function makeLabels(){
 let host=$('labels');host.replaceChildren();labelElems=[];
 // Store labels remain available on demand. A giant duplicate floor badge
 // inside the map is redundant with the compact floor picker and obscures
 // shops, especially in single-floor malls.
 for(const floor of floors){
  for(const feature of floor.features.filter(f=>f.k==='anchor')){
   let el=document.createElement('div');el.className='label';
   el.textContent=feature.n;
   host.append(el);
   labelElems.push({el,floor,p:pos(feature.c,height(feature)+1.5),f:feature,always:false});
  }
 }
}
function updateLabels(){let rect=canvas.getBoundingClientRect();for(let o of labelElems){let p=o.p.slice();p[1]+=o.floor.y;let s=screen(p),show=(searchFloorSet?.has(o.floor.id)||active==='ALL'||active===o.floor.id)&&(labelsOn||o.always||selected===o.f)&&s.w>0&&s.z<1&&(o.always||(s.x>25&&s.x<rect.width-20))&&s.y>95&&s.y<rect.height-110;if(!o.always&&active==='ALL'&&selected!==o.f)show=false;o.el.hidden=!show;if(show){o.el.style.left=(o.always?clamp(s.x,48,rect.width-48):s.x)+'px';o.el.style.top=s.y+'px';o.el.classList.toggle('selected',selected===o.f);}}}
let routeBuffer;
function drawRoute(dt){if(!route)return;let floor=floors.find(f=>f.id===route.floor);if(active!=='ALL'&&active!==floor.id)return;if(routeRunning)routeT=(routeT+dt*.14)%1;let arr=[];const routeColor=mapRgb('mapRoute',[1,.65,.23]);route.points.forEach(p=>arr.push(...pos(p,.2),0,0,0,...routeColor,-3));gl.uniform1f(loc.uY,floor.y);gl.uniform1f(loc.uLine,1);gl.bindBuffer(gl.ARRAY_BUFFER,routeBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(arr),gl.DYNAMIC_DRAW);bind({b:routeBuffer});gl.drawArrays(gl.LINE_STRIP,0,arr.length/10);let lens=[0];for(let i=1;i<route.points.length;i++)lens.push(lens[i-1]+Math.hypot(...vsub(route.points[i],route.points[i-1])));let t=(lens.at(-1)||1)*routeT,i=1;while(i<lens.length-1&&lens[i]<t)i++;let a=route.points[i-1],b=route.points[i]||a,k=(t-lens[i-1])/(lens[i]-lens[i-1]||1);let p=[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k];gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([...pos(p,.8),0,0,0,...routeColor,-3]),gl.DYNAMIC_DRAW);gl.uniform1f(loc.uPoint,Math.min(devicePixelRatio,2)*10);gl.drawArrays(gl.POINTS,0,1);}
// Yellow escalator side rails and turquoise vertical lift shafts represent
// photo-based ALIGNMENT HYPOTHESES, not physical routing or surveyed landings.
const verticalHypotheses=Array.isArray(selectedMall.verticalConnectionHypotheses)
 ?selectedMall.verticalConnectionHypotheses:[];
let verticalConnectionsOn=verticalHypotheses.length>0;
let verticalBuffer=null;
const escalatorColor=[.98,.73,.18],elevatorColor=[.28,.76,.95];
function verticalSegments(){
 // Never display inferred long yellow 'ladders'. Stairs are now actual
 // isolated escalator meshes based on their yellow footprint axes.
 if(!verticalConnectionsOn||active!=='ALL'||!verticalHypotheses.length
    ||spread>baseFloorMetres*1.4||
    (selectedMall.verticalShaftCandidates||[]).length)return [];
 const byId=new Map();
 for(const floor of floors)for(const feature of floor.features)
  byId.set(feature.id,{floor,feature});
 const lines=[];
 function line(a,b,color){lines.push({a,b,color});}
 for(const link of verticalHypotheses){
  if(link.type!=='elevator')continue;
  const lo=byId.get(link.from),hi=byId.get(link.to);
  if(!lo||!hi||hi.floor.index-lo.floor.index!==1)continue;
  const a=pos(lo.feature.c,lo.floor.y+.5);
  const b=pos(hi.feature.c,hi.floor.y+.5);
  const dx=b[0]-a[0],dz=b[2]-a[2];
  const horiz=Math.hypot(dx,dz);
  // Unaligned elevator symbols cannot be interpreted as a continuous shaft.
  if(horiz>3.5)continue;
  // Draw only shafts whose photo centres align in adjacent floors.
  const center=[(a[0]+b[0])/2,0,(a[2]+b[2])/2];
  const w=1.8,fromY=a[1],toY=b[1];
  const corners=[[-w,-w],[w,-w],[w,w],[-w,w]];
  const low=corners.map(([x,z])=>[center[0]+x,fromY,center[2]+z]);
  const top=corners.map(([x,z])=>[center[0]+x,toY,center[2]+z]);
  for(let i=0;i<4;i++){
   const next=(i+1)%4;
   line(low[i],top[i],elevatorColor);
   line(low[i],low[next],[.18,.49,.68]);
   line(top[i],top[next],[.58,.85,.96]);
  }
 }
 return lines;
}
// Per-photo mechanical escalators are independent WebGL meshes, not a segment
// connecting two unverified symbols. Cache once for each floor-height setting.
let escalatorCache=null,escalatorKey='',escalatorGpu=null;
function escalatorModel(){
 const fixtures=selectedMall.escalatorFixtures||[];
 const key=[active,spread.toFixed(3),verticalConnectionsOn,
  ...floors.map(f=>f.y.toFixed(3))].join('|');
 if(escalatorCache&&escalatorKey===key)return escalatorCache;
 escalatorKey=key;
 escalatorCache=window.RetailNavEscalators?.build?.({
  fixtures,floors,origin:cfg.origin,scale:cfg.scale,spread,
  baseStoreyMetres:baseFloorMetres,active,enabled:verticalConnectionsOn
 })||{faces:new Float32Array(0),edges:new Float32Array(0),
  items:[],stats:{banks:0,lanes:0,triangles:0,display:'not-configured',
  navigable:false,landingMappingsVerified:false}};
 return escalatorCache;
}
function drawMechanicalEscalatorsWebGL(){
 const model=escalatorModel();
 if(!gl||!model.faces.length)return;
 if(!escalatorGpu){
  escalatorGpu={faces:gl.createBuffer(),edges:gl.createBuffer(),key:null};
 }
 if(escalatorGpu.key!==escalatorKey){
  gl.bindBuffer(gl.ARRAY_BUFFER,escalatorGpu.faces);
  gl.bufferData(gl.ARRAY_BUFFER,model.faces,gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER,escalatorGpu.edges);
  gl.bufferData(gl.ARRAY_BUFFER,model.edges,gl.DYNAMIC_DRAW);
  escalatorGpu.key=escalatorKey;
 }
 gl.uniform1f(loc.uY,0);gl.uniform1f(loc.uSelected,-1);
 gl.uniform1f(loc.uWire,0);gl.uniform1f(loc.uLine,0);
 bind({b:escalatorGpu.faces});gl.drawArrays(gl.TRIANGLES,0,model.faces.length/10);
 gl.uniform1f(loc.uLine,1);
 bind({b:escalatorGpu.edges});gl.drawArrays(gl.LINES,0,model.edges.length/10);
 gl.uniform1f(loc.uSelected,selected?.gid||-1);
 gl.uniform1f(loc.uWire,wire?1:0);
}
function drawMechanicalEscalatorsCanvas(){
 if(!ctx2d)return;
 const m=escalatorModel();if(!m.faces.length)return;
 const c=ctx2d;
 // Simple perspective fallback; in WebGL the exact same physical model is lit
 // and correctly depth-tested against shops and each adjacent floor.
 for(let i=0;i<m.faces.length;i+=30){
  const a=screen(Array.from(m.faces.slice(i,i+3)));
  const b=screen(Array.from(m.faces.slice(i+10,i+13)));
  const d=screen(Array.from(m.faces.slice(i+20,i+23)));
  if(a.w<=.02||b.w<=.02||d.w<=.02)continue;
  c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);
  c.lineTo(d.x,d.y);c.closePath();
  const color=Array.from(m.faces.slice(i+6,i+9)).map(x=>Math.round(x*255));
  c.fillStyle='rgb('+color.join(',')+')';c.fill();
 }
 c.lineWidth=1.7;
 for(let i=0;i<m.edges.length;i+=20){
  const a=screen(Array.from(m.edges.slice(i,i+3)));
  const b=screen(Array.from(m.edges.slice(i+10,i+13)));
  if(a.w<=.02||b.w<=.02)continue;
  const rgb=Array.from(m.edges.slice(i+6,i+9)).map(x=>Math.round(x*255));
  c.strokeStyle='rgb('+rgb.join(',')+')';
  c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
 }
}
// One continuous lift core (L1-L9) is shown by default. Additional,
 // independently evidenced partial shafts become visible at close zoom.
 // They are explicitly provisional photo-based illustrations, not paths.
let shaftCache=null,shaftKey='',shaftGpu=null;
function liftShaftModel(){
 const candidates=selectedMall.verticalShaftCandidates||[];
 const detailed=distance<105;
 const key=[active,verticalConnectionsOn,detailed,
  ...floors.map(f=>f.y.toFixed(3))].join('|');
 if(shaftCache&&key===shaftKey)return shaftCache;
 shaftKey=key;
 shaftCache=window.RetailNavVerticalShafts?.build?.({
  candidates,floors,origin:cfg.origin,scale:cfg.scale,active,
  enabled:verticalConnectionsOn,includeSecondary:detailed
 })||{solid:new Float32Array(0),glass:new Float32Array(0),
  edges:new Float32Array(0),shafts:[],
  stats:{count:0,continuousCount:0,verified:false,navigationApproved:false}};
 return shaftCache;
}
function drawLiftShaftsWebGL(){
 if(!gl||active!=='ALL'||!verticalConnectionsOn)return;
 const model=liftShaftModel();
 if(!model.solid.length)return;
 if(!shaftGpu){
  shaftGpu={solid:gl.createBuffer(),glass:gl.createBuffer(),
   edges:gl.createBuffer(),key:null};
 }
 if(shaftGpu.key!==shaftKey){
  for(const name of ['solid','glass','edges']){
   gl.bindBuffer(gl.ARRAY_BUFFER,shaftGpu[name]);
   gl.bufferData(gl.ARRAY_BUFFER,model[name],gl.DYNAMIC_DRAW);
  }
  shaftGpu.key=shaftKey;
 }
 gl.uniform1f(loc.uY,0);
 gl.uniform1f(loc.uSelected,-4000);
 gl.uniform1f(loc.uWire,0);
 gl.uniform1f(loc.uLine,0);
 gl.uniform1f(loc.uAlpha,1);
 bind({b:shaftGpu.solid});
 gl.drawArrays(gl.TRIANGLES,0,model.solid.length/10);
 // Transparent vertical panes are depth-tested against shops and floors.
 gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
 gl.depthMask(false);
 gl.uniform1f(loc.uAlpha,model.stats.glassOpacity||.19);
 bind({b:shaftGpu.glass});
 gl.drawArrays(gl.TRIANGLES,0,model.glass.length/10);
 gl.depthMask(true);gl.disable(gl.BLEND);
 gl.uniform1f(loc.uAlpha,1);
 gl.uniform1f(loc.uLine,1);
 bind({b:shaftGpu.edges});
 gl.drawArrays(gl.LINES,0,model.edges.length/10);
 gl.uniform1f(loc.uSelected,selected?selected.gid:-1);
 gl.uniform1f(loc.uWire,wire?1:0);
}
function drawLiftShaftsCanvas(){
 if(!ctx2d||active!=='ALL'||!verticalConnectionsOn)return;
 const model=liftShaftModel(),c=ctx2d;
 const triangle=(data,alpha)=>{
  c.globalAlpha=alpha;
  for(let i=0;i<data.length;i+=30){
   const a=screen([data[i],data[i+1],data[i+2]]);
   const b=screen([data[i+10],data[i+11],data[i+12]]);
   const d=screen([data[i+20],data[i+21],data[i+22]]);
   if(a.w<=.02||b.w<=.02||d.w<=.02)continue;
   c.fillStyle='rgb('+[6,7,8].map(k=>Math.round(data[i+k]*255)).join(',')+')';
   c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);
   c.lineTo(d.x,d.y);c.closePath();c.fill();
  }
 };
 triangle(model.glass,.19);triangle(model.solid,1);
 c.globalAlpha=.83;c.lineWidth=1.9;
 for(let i=0;i<model.edges.length;i+=20){
  const a=screen([model.edges[i],model.edges[i+1],model.edges[i+2]]);
  const b=screen([model.edges[i+10],model.edges[i+11],model.edges[i+12]]);
  if(a.w<=.02||b.w<=.02)continue;
  const data=model.edges;
  c.strokeStyle='rgb('+[6,7,8].map(k=>Math.round(data[i+k]*255)).join(',')+')';
  c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
 }
 c.globalAlpha=1;
}
function drawVerticalWebGL(){
 if(!gl||!verticalConnectionsOn||active!=='ALL')return;
 const segments=verticalSegments();if(!segments.length)return;
 const data=[];
 for(const seg of segments){
  for(const p of [seg.a,seg.b]){
   data.push(...p,0,1,0,...seg.color,-72);
  }
 }
 if(!verticalBuffer)verticalBuffer=gl.createBuffer();
 gl.uniform1f(loc.uY,0);gl.uniform1f(loc.uSelected,-1);
 gl.uniform1f(loc.uLine,1);gl.uniform1f(loc.uWire,0);
 gl.bindBuffer(gl.ARRAY_BUFFER,verticalBuffer);
 gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);
 bind({b:verticalBuffer});
 gl.drawArrays(gl.LINES,0,data.length/10);
 gl.uniform1f(loc.uSelected,selected?selected.gid:-1);
 gl.uniform1f(loc.uWire,wire?1:0);
}
function drawVerticalCanvas(){
 if(!ctx2d||!verticalConnectionsOn||active!=='ALL')return;
 const c=ctx2d;
 for(const seg of verticalSegments()){
  const a=screen(seg.a),b=screen(seg.b);
  if(a.w<=0||b.w<=0)continue;
  c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);
  c.strokeStyle='rgb('+seg.color.map(x=>Math.round(x*255)).join(',')+')';
  c.lineWidth=seg.color===escalatorColor?2.1:1.4;
  c.globalAlpha=.84;c.stroke();
 }
 c.globalAlpha=1;
}
function verticalConnectionInfo(){
 const byId=new Map();
 for(const f of floors)for(const feature of f.features)byId.set(feature.id,{floor:f,feature});
 return verticalHypotheses.map(link=>{
  const a=byId.get(link.from),b=byId.get(link.to);
  if(!a||!b)return null;
  return {type:link.type,from:link.fromFloor,to:link.toFloor,
   fromY:a.floor.y,toY:b.floor.y,
   riseMetres:b.floor.elevationMetres-a.floor.elevationMetres,
   verified:false};
 }).filter(Boolean);
}
// Roof text is real prism geometry, subject to the same camera,
 // depth buffer, tilt and 360° rotations as the corresponding shop roof.
function drawRoofTextWebGL(){
 if(!gl||scan||!labelsOn||wayfindingOpen)return;
 const showCode=distance<340||active!=='ALL';
 const showName=showCode; // Show known tenant names whenever their 3D roof ID is visible.
 gl.uniform1f(loc.uSelected,-999);
 gl.uniform1f(loc.uWire,0);
 gl.uniform1f(loc.uLine,0);
 for(const floor of visible()){
  if(referenceContext(floor))continue;
  gl.uniform1f(loc.uY,floor.y);
  const groups=floor.roofGpu||{};
  for(const key of ['services',...(showCode?['codes','frontCodes']:[]),
    ...(showName?['names','frontNames']:[])]){
   if(!groups[key])continue;
   bind(groups[key]);gl.drawArrays(gl.TRIANGLES,0,groups[key].n);
  }
 }
 gl.uniform1f(loc.uY,0);
 gl.uniform1f(loc.uSelected,selected?selected.gid:-1);
 gl.uniform1f(loc.uWire,wire?1:0);
}
function drawRoofTextCanvas(){
 if(!ctx2d||!labelsOn||scan||distance>180||wayfindingOpen)return;
 const ctx=ctx2d,limit=active==='ALL'?24000:90000;
 for(const floor of visible()){
  if(referenceContext(floor))continue;
  for(const key of ['services','codes','frontCodes',...(active==='ALL'?[]:['names','frontNames'])]){
   const vertices=floor.roofText?.[key];
   if(!vertices)continue;
   const step=30,count=Math.min(vertices.length,limit);
   for(let i=0;i+step<=count;i+=step){
    const a=screen([vertices[i],vertices[i+1]+floor.y,vertices[i+2]]);
    const b=screen([vertices[i+10],vertices[i+11]+floor.y,vertices[i+12]]);
    const c=screen([vertices[i+20],vertices[i+21]+floor.y,vertices[i+22]]);
    if(a.w<=.02||b.w<=.02||c.w<=.02)continue;
    ctx.fillStyle='rgb('+[6,7,8].map(k=>Math.round(vertices[i+k]*255)).join(',')+')';
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
    ctx.lineTo(c.x,c.y);ctx.closePath();ctx.fill();
   }
  }
 }
}
function render(time){if(!ready)return;if(document.querySelector('dialog[open]')||(!dirty&&!cameraFlight&&!auto&&!routeRunning&&Math.abs(spread-targetSpread)<.01)){lastTime=time;requestAnimationFrame(render);return;}dirty=false;let dt=Math.min(.05,(time-lastTime)/1000||0);lastTime=time;frame++;resize();advanceStoreCameraFlight(time);let diff=targetSpread-spread;const oldPivot=floorFocusY();spread+=diff*Math.min(1,dt*8);
 refreshFloorElevations();target[1]+=floorFocusY()-oldPivot;if(auto){if(panMode){orbitYaw+=dt*.18;updateCameraRotation();}
 else rotateCameraLocal([0,1,0],dt*.18);}matrices();updateEarthButtons();if(!gl){renderCanvas(dt);updateLabels();window.RetailNavPins?.draw?.();window.RetailNavPOI?.draw?.();window.RetailNavUnits?.draw?.();window.RetailNavIndoor?.draw?.();window.RetailNavAreaLabels?.draw?.();drawSearchMarkers();drawWayfinding();requestAnimationFrame(render);return;}gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);gl.uniformMatrix4fv(loc.uMvp,false,mvp);gl.uniform1f(loc.uSelected,selected?selected.gid:-1);gl.uniform1f(loc.uWire,wire?1:0);gl.uniform1f(loc.uPoint,Math.min(devicePixelRatio,2)*2.5);gl.uniform1f(loc.uY,0);gl.uniform1f(loc.uAlpha,1);gl.uniform1f(loc.uLine,1);bind(grid);gl.drawArrays(gl.LINES,0,grid.n);for(let floor of visible()){gl.uniform1f(loc.uY,floor.y);if(!scan){gl.uniform1f(loc.uLine,0);if(!referenceContext(floor)){gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);bind(floor.gpu.faces);gl.drawArrays(gl.TRIANGLES,0,floor.gpu.faces.n);gl.disable(gl.POLYGON_OFFSET_FILL);}gl.uniform1f(loc.uLine,1);const outlines=referenceContext(floor)?floor.gpu.context:floor.gpu.edges;bind(outlines);gl.drawArrays(gl.LINES,0,outlines.n);}else{gl.uniform1f(loc.uLine,1);bind(floor.gpu.points);gl.drawArrays(gl.POINTS,0,floor.gpu.points.n);}}
drawVerticalWebGL();drawMechanicalEscalatorsWebGL();drawLiftShaftsWebGL();drawRoofTextWebGL();drawRoute(dt);window.RetailNavDistricts?.draw3D?.(gl,mvp);
window.RetailNavAreaLabels?.draw?.();if(!wayfindingOpen)window.RetailNavPins?.draw3D?.(gl,mvp);
if(!wayfindingOpen)window.RetailNavUnits?.draw3D?.(gl,mvp);updateLabels();window.RetailNavPins?.draw?.();window.RetailNavPOI?.draw?.();window.RetailNavUnits?.draw?.();window.RetailNavIndoor?.draw?.();drawSearchMarkers();drawWayfinding();requestAnimationFrame(render);}

// Canvas 3D engine: genuine perspective projection of the same extruded polygon
// geometry. Used when WebGL is blocked by an in-app preview or GPU policy.
// This is not a static SVG, and all camera gestures remain active.
function renderCanvas(dt){
 const c=ctx2d,rect=canvas.getBoundingClientRect();if(!c)return;
 const dpr=canvas.width/Math.max(1,rect.width),w=rect.width,h=rect.height;
 c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
 function xyz(q){const a=screen(q);return a.w>.02?a:null;}
 const colors={slab:'#183044',corridor:'#18747b',anchor:'#355d82',unit:'#355565',amenity:'#09bed3',zone:'#34516a',void:'#1e283c'};
 const lines={slab:'#4894a4',corridor:'#45d4d6',anchor:'#96c2db',unit:'#70b8c6',amenity:'#cefbfd',zone:'#648fa2',void:'#a488ae'};
 const themed=Boolean(window.RetailNavThemes?.getState?.().enabled);
 // Grid stays anchored to the model rather than to screen pixels.
 c.lineWidth=.6;c.strokeStyle=mapColor('mapGrid','rgba(68,142,168,.14)');c.globalAlpha=themed?.24:1;c.beginPath();
 for(let n=-80;n<=80;n+=8){let a=xyz([n,-.9,-65]),b=xyz([n,-.9,65]),d=xyz([-85,-.9,n]),e=xyz([85,-.9,n]);if(a&&b){c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);}if(d&&e){c.moveTo(d.x,d.y);c.lineTo(e.x,e.y);}}
 c.stroke();c.globalAlpha=1;
 // Far-to-near ordering, retaining holes and the disconnected L3 islands.
 const candidates=[];
 for(const floor of visible()){
  for(const f of floor.features){
   // Context floor keeps its shop outlines so the origin is legible in 3D.
   const cp=xyz(pos(f.c,floor.y+height(f)));
   if(cp)candidates.push({floor,f,z:cp.z});
  }
 }
 candidates.sort((a,b)=>b.z-a.z || ({slab:0,corridor:1,void:2,zone:3,unit:4,anchor:5}[a.f.k]-{slab:0,corridor:1,void:2,zone:3,unit:4,anchor:5}[b.f.k]));
 const pth=(ring,y)=>{let ok=0;for(let j=0;j<ring.length;j++){let p=xyz(pos(ring[j],y));if(!p)continue; if(ok===0)c.moveTo(p.x,p.y);else c.lineTo(p.x,p.y);ok++;}if(ok)c.closePath();return ok>=3;};
 for(const {floor,f} of candidates){
  const fh=height(f),fy=floor.y,top=fy+fh,isSelected=selected&&selected.gid===f.gid;
  if(scan){c.fillStyle=isSelected?'#ffc977':'#6ce2e2';c.globalAlpha=.8;for(const r of f.r)for(let j=0;j<r.length;j+=2){let pt=xyz(pos(r[j],top));if(!pt)continue;c.beginPath();c.arc(pt.x,pt.y,Math.max(.7,1.3*(215/distance)),0,Math.PI*2);c.fill();}c.globalAlpha=1;continue;}
  const selectedShop=focusedStoreVectors.has(f.floor+':'+f.id);
  const searchMatch=searchMatchedVectors.has(f.floor+':'+f.id);
  const selectTone=mapRgb('mapSelected',[1,.68,.29]);
  const underlying=themed?palette(f,floor.index,false):legacyPalette(f,floor.index,false);
  let color=isSelected||selectedShop?mapColor('mapSelected','#ffae4a'):
   searchMatch?rgbHex(blendColors(underlying,selectTone,.30)):
   (themed?rgbHex(underlying):colors[f.k]);
  let line=isSelected||selectedShop?mapColor('mapSelected','#ffae4a'):
   searchMatch?rgbHex(blendColors(palette(f,floor.index,true),selectTone,.52)):
   (themed?rgbHex(palette(f,floor.index,true)):lines[f.k]);
  if(!referenceContext(floor)&&['anchor','unit','amenity','zone','slab'].includes(f.k)){
   c.fillStyle=isSelected||selectedShop?mapColor('mapSelected','#ffae4a'):
    themed?rgbHex(blendColors(palette(f,floor.index,false),mapRgb('mapOutline',[.25,.3,.35]),.22)):'rgba(25,65,85,.67)';
   for(const r of f.r)for(let i=0;i<r.length;i++){
    const aa=xyz(pos(r[i],fy+(f.k==='slab'?-.45:0))),ab=xyz(pos(r[(i+1)%r.length],fy+(f.k==='slab'?-.45:0))),ba=xyz(pos(r[(i+1)%r.length],top)),bb=xyz(pos(r[i],top));
    if(!aa||!ab||!ba||!bb)continue;
    c.beginPath();c.moveTo(aa.x,aa.y);c.lineTo(ab.x,ab.y);c.lineTo(ba.x,ba.y);c.lineTo(bb.x,bb.y);c.closePath();c.fill();
   }
  }
  c.beginPath();let any=false;for(const r of f.r)any=pth(r,top)||any;
  if(!any)continue;
  c.fillStyle=color;c.globalAlpha=f.k==='slab'?.92:f.k==='corridor'?.60:wire?.16:f.k==='void'?.42:.87;if(!referenceContext(floor))c.fill('evenodd');c.globalAlpha=1;
  c.strokeStyle=referenceContext(floor)?'#478f9f':line;c.lineWidth=isSelected||selectedShop?2.8:searchMatch?1.8:f.k==='corridor'?1.2:f.k==='slab'?1.2:.9;
  if(isSelected||selectedShop){c.shadowColor=mapColor('mapSelected','#ffae4a');c.shadowBlur=14;}
  else if(searchMatch){c.shadowColor=mapColor('mapSelected','#ffae4a');c.shadowBlur=4;}
  else if(f.k==='corridor'){c.shadowColor='#25c6c9';c.shadowBlur=2;}
  c.stroke();c.shadowBlur=0;
 }
 if(route&&visible().some(x=>x.id===route.floor)){
  const floor=floors.find(x=>x.id===route.floor),pts=route.points.map(p=>xyz(pos(p,floor.y+.5))).filter(Boolean);
  if(pts.length>1){c.lineWidth=3;c.strokeStyle=mapColor('mapRoute','#ffd06c');c.shadowBlur=8;c.shadowColor=mapColor('mapRoute','#ffc462');c.setLineDash([8,5]);c.beginPath();pts.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.stroke();c.setLineDash([]);c.shadowBlur=0;
   if(routeRunning)routeT=(routeT+dt*.14)%1;
   const s=routeT*(pts.length-1),i=Math.min(pts.length-2,Math.floor(s)),t=s-i;
   const u={x:pts[i].x*(1-t)+pts[i+1].x*t,y:pts[i].y*(1-t)+pts[i+1].y*t};
   c.fillStyle=mapColor('mapRoute','#ffbf5a');c.beginPath();c.arc(u.x,u.y,5,0,Math.PI*2);c.fill();
  }
 }
 drawVerticalCanvas();
 drawMechanicalEscalatorsCanvas();
 drawLiftShaftsCanvas();
 drawRoofTextCanvas();
}

function stopAuto(){auto=false;$('auto').setAttribute('aria-pressed','false');}
function resetCamera(plan=false){
 cameraFlight=null;stopAuto();orbitYaw=plan?0:-.30;orbitPitch=plan?MIN_PITCH:-.70;orbitRoll=0;
 earth2D=Boolean(plan);if(!plan)lastEarth3DPitch=orbitPitch;
 updateCameraRotation();
 let fs=visible();target=[0,floorFocusY(),0];distance=200;
 resize();matrices();let mx=0,my=0;
 for(const f of fs)for(const o of f.features)for(const v of o.p){
  const p=mp(mvp,[...pos(v,f.y),1]);if(p[3]<=0)continue;
  mx=Math.max(mx,Math.abs(p[0]/p[3]));my=Math.max(my,Math.abs(p[1]/p[3]));
 }
 distance=clamp(distance*Math.max(mx/.86,my/.65),90,550);
 updateEarthButtons();dirty=true;
}
function setFloor(id){
 if(!ready)return;
 clearWayfinding();
 const hadFocus=focusedStoreVectors.size>0;
 cameraFlight=null;focusFloorId=null;focusedStoreId=null;focusedStoreVector=null;focusedStoreVectors.clear();
 if(floors.length===1)id=floors[0].id;
 if(id!=='ALL'&&!floors.some(f=>f.id===id))return;
 if(searchFloorSet){
  searchFloorSet=null;searchCommitted='';searchMatchedVectors.clear();
  $('floorSelect')?.querySelector('option[value="MATCHES"]')?.remove();
  window.RetailNavUnits?.clearQuery?.();rebuildSearchGeometry();
 }
 if(hadFocus)rebuildSearchGeometry();
 active=id;showFloorReference();
 $('showAllFloors').hidden=floors.length<=1||id==='ALL';
 document.querySelector('.stage')?.classList.toggle('focused',id!=='ALL');
 route=null;routeRunning=false;$('routeInfo').textContent='';
 const picker=$('floorSelect');
 if(picker&&[...picker.options].some(opt=>opt.value===id))picker.value=id;
 $('floorSpacing').hidden=floors.length<=1||id!=='ALL';
 if(id!=='ALL')$('floorSpacing').open=false;
 $('spread').disabled=id!=='ALL'||floors.length<=1;
 $('mapTitle').textContent=id==='ALL'
  ?'Las '+floors.length+' plantas, en su posición relativa'
  :floors.find(f=>f.id===id).name+' / '+id;
 $('mapSubtitle').textContent=mallId==='new-world-city-shanghai'
  ?'Geometría provisional L1–L9: tiendas candidatas individualizadas y servicios por tipo, sin rutas verificadas.'
  :mallId==='ap-plaza'?'Sectorización automática de una foto; sin rutas verificadas.'
  :mallId==='alto-palermo'?'Contornos extraídos de los SVG oficiales; asociaciones comerciales, entradas y rutas aún provisionales.'
  :selectedMall.coordinateSpace?'Geometría de fuente oficial. Alturas provisionales; sin ruta peatonal verificada.'
  :(id==='L3'?'Sectores discontinuos conservados del tercer plano.':
    'Contornos y pasillos trazados sobre tus imágenes.');
 resetCamera();results();
}
function contains(p,ring){let v=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){let a=ring[i],b=ring[j];if(((a[1]>p[1])!==(b[1]>p[1]))&&(p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]))v=!v;}return v;}
function pick(x,y){if(!invMvp)return;let r=canvas.getBoundingClientRect(),nx=(x-r.left)/r.width*2-1,ny=1-(y-r.top)/r.height*2;let un=z=>{let v=mp(invMvp,[nx,ny,z,1]);return v.slice(0,3).map(x=>x/v[3]);};let a=un(-1),b=un(1),dir=norm(vsub(b,a)),best=null,dist=Infinity;for(let floor of visible()){if(referenceContext(floor))continue;for(let f of floor.features.filter(f=>['unit','anchor','zone','amenity'].includes(f.k))){let t=(floor.y+height(f)-a[1])/dir[1];if(!Number.isFinite(t)||t<0||t>dist)continue;let pt=vadd(a,vmul(dir,t)),p=[pt[0]/cfg.scale+cfg.origin[0],pt[2]/cfg.scale+cfg.origin[1]];if(contains(p,f.r[0])&&!f.r.slice(1).some(h=>contains(p,h))){best=f;dist=t;}}}if(best)select(best);}
function select(f){
 if(f.k==='unit'){
  const matches=(window.RetailNavUnits?.getUnits?.()||[]).filter(unit=>(window.RetailNavUnits?.getMapBindings?.(unit)||[])
   .some(binding=>binding.floor===f.floor&&binding.polygonId===f.id));
  if(matches.length===1&&window.RetailNavMeetups?.selectStore?.(matches[0].storeId,false,f.floor))return;
  // A traced polygon can be shared by several directory records or have no
  // verified store binding. It must never reopen the obsolete rectangular
  // action card: radial actions belong only to one identified catalog store.
  window.RetailNavMeetups?.clearSelection?.();
  storeFocusEvent('retailnav:store-focus-start',{storeId:null});
  clearWayfinding();setFocusedStoreVector(null,null,[]);focusFloorId=null;cameraFlight=null;
  selected=f;route=null;routeRunning=false;selectedSearchTagKey=null;
  $('rnMapSearch').classList.remove('finding');document.body.classList.remove('rnTagResultsOpen');
  $('rnTagResultPanel').hidden=true;$('search').blur();$('detail').hidden=true;
  notify(matches.length>1
   ?'Este volumen corresponde a varios comercios. Elegí uno en la lista para ver sus acciones.'
   :'Este contorno todavía no está vinculado de forma unívoca con un comercio.');
  results();dirty=true;return;
 }
 storeFocusEvent('retailnav:store-focus-start',{storeId:null});
 clearWayfinding();setFocusedStoreVector(null,null,[]);focusFloorId=null;cameraFlight=null;selected=f;route=null;routeRunning=false;selectedSearchTagKey=null;$('rnMapSearch').classList.remove('finding');document.body.classList.remove('rnTagResultsOpen');$('rnTagResultPanel').hidden=true;$('search').blur();$('detail').hidden=false;$('detailLevel').textContent=f.floor+' / '+({'anchor':'Ancla identificada en el plano','unit':'Local comercial provisional','amenity':'Servicio dibujado según plano','zone':'Area por identificar'}[f.k]||'Poligono trazado');$('detailName').textContent=f.storeName?(f.storeCode+' · '+f.storeName):(f.n||f.id);$('detailId').textContent='ID '+f.id+' - geometria provisional; altura simulada';$('routeInfo').textContent='';results();
}
function clearSelection(){selected=null;route=null;routeRunning=false;$('detail').hidden=true;results();}
function matchTypeLabel(type){const key={name:'nameMatch',product:'productMatch',service:'serviceMatch',category:'categoryMatch'}[type];return window.RetailNavI18n?.ui(key)||type;}
function appendUnitResult(host,record,matchTypes,{horizontal=false}={}){
 const unit=record.unit,lang=window.RetailNavI18n;
 const b=document.createElement('button');b.type='button';b.className='result rnUnitResult'+(horizontal?' rnStoreCard':'');
 b.dataset.storeId=record.storeId;b.dataset.matchTypes=matchTypes.join(',');
 const logo=unit.logoURL||unit.logoUrl||unit.logo||unit.brandLogoURL||unit.brandLogoUrl;
 {
  const media=document.createElement('span');media.className=horizontal?'rnStoreCardLogo':'rnStoreResultLogo';
  const initials=(unit.name||unit.code||'?').trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  const fallback=document.createElement('span');fallback.textContent=initials;media.append(fallback);
  if(typeof logo==='string')try{
   const url=new URL(logo,location.href);
   if(url.protocol==='https:'||url.origin===location.origin){
    const img=document.createElement('img');img.src=url.href;img.alt='';img.loading='lazy';
    img.onerror=()=>media.replaceChildren(fallback);media.replaceChildren(img);
   }
  }catch{}
  b.append(media);
 }
 const badge=document.createElement('span');badge.className='levelbadge';
 const mappedFloors=window.RetailNavUnits?.getMappedFloors?.(unit)||[];
 const publishedFloors=[...new Set(unit.documentedFloors||[])];
 const displayFloors=mappedFloors.length?mappedFloors:publishedFloors.length?publishedFloors:record.floors||[];
 const en=lang?.locale?.().startsWith('en');
 const mapped=mappedFloors.length>0;
 b.dataset.mapState=mapped?'mapped':displayFloors.length?'published-floor':'unplaced';
 badge.textContent=displayFloors.join('/')||unit.floor||lang?.ui('floorUnknown')||'?';
 badge.title=mapped?(en?'Floors linked to map polygons':'Plantas vinculadas a polígonos del mapa'):
  (en?'Published floor; exact map location pending':'Planta publicada; ubicación exacta en el mapa pendiente');
 const info=document.createElement('span');
 info.textContent=unit.nameStatus==='official-directory'?unit.name:
  (unit.code?(unit.code+(unit.name?' · '+unit.name:'')):unit.name);
 const notes=[...new Set(matchTypes)].map(matchTypeLabel);
 if(horizontal){
  const specialties=lang?.summary(unit,4)||unit.category||'';
  if(specialties)notes.push(specialties);
 }
 if(unit.conceptIds?.length)notes.push(lang?.ui('provisional')||'Clasificación provisional');
 const differentPublishedFloors=mapped&&publishedFloors.length&&
  (publishedFloors.some(f=>!mappedFloors.includes(f))||mappedFloors.some(f=>!publishedFloors.includes(f)));
 if(unit.locationLabel&&(!mapped||!publishedFloors.length||differentPublishedFloors))
  notes.push((lang?.ui('publishedLocation')||'Ubicación del directorio')+': '+unit.locationLabel);
 if(unit.source==='aventura-official-directory'){
  const mapState=document.createElement('span');mapState.className='rnStoreMapState';
  mapState.textContent=mapped?(en?'Linked to map':'Vinculado al mapa'):displayFloors.length?
   (en?'Published floor · map location pending':'Planta publicada · ubicación en mapa pendiente'):
   (en?'Map location pending':'Ubicación en mapa pendiente');
  info.append(mapState);
 }else notes.push(unit.polygonId?(lang?.ui('region')||'Región provisional'):(lang?.ui('unplaced')||'Ubicación por verificar'));
 const note=document.createElement('span');note.className='small';note.textContent=notes.join(' · ');
 info.append(note);b.title=[unit.code,unit.name,unit.category,unit.locationLabel,unit.tags].filter(Boolean).join(' · ');
 b.append(badge,info);b.onclick=()=>{
  const focused=window.RetailNavMeetups?.selectStore?.(record.storeId,false)||window.RetailNavUnits?.focusStore?.(record.storeId);
  if(focused&&horizontal){
   selectedSearchTagKey=null;document.body.classList.remove('rnTagResultsOpen');
   $('rnTagResultPanel').hidden=true;results();
  }
 };host.append(b);
}
function renderGroupedShopResults(host,query){
 if(!query)return{storeIds:new Set(),options:[]};
 const lang=window.RetailNavI18n,records=window.RetailNavUnits?.findDetailed?.(query)||[];
 const byStore=new Map(records.map(record=>[record.storeId,record]));
 const options=window.RetailNavUnits?.suggestions?.(query,15)||[];
 const panel=$('rnTagResultPanel'),panelTitle=$('rnTagResultTitle'),panelCards=$('rnTagResultCards');
 panelCards.replaceChildren();panelCards.dataset.conceptId='';panelCards.dataset.tagKey='';
 const selectedOption=options.find(option=>{
  const key=option.conceptId?'concept:'+option.conceptId:'legacy:'+lang.normalize(option.term);
  return key===selectedSearchTagKey;
 });
 document.body.classList.toggle('rnTagResultsOpen',Boolean(selectedOption));
 panel.hidden=!selectedOption;
 if(selectedOption){
  const key=selectedOption.conceptId?'concept:'+selectedOption.conceptId:'legacy:'+lang.normalize(selectedOption.term);
  panelCards.dataset.conceptId=selectedOption.conceptId||'';panelCards.dataset.tagKey=key;
  panelTitle.textContent=selectedOption.term+' · '+selectedOption.count+' '+(lang?.ui('stores')||'locales');
 }
 if(options.length){
  const title=document.createElement('h4');title.className='rnResultHeading';
  title.textContent=lang?.ui('tagsFound')||'Etiquetas coincidentes';host.append(title);
  const tags=document.createElement('div');tags.className='rnResultTags';
  for(const option of options){
   const button=document.createElement('button');button.type='button';button.className='rnResultTag';
   const tagKey=option.conceptId?'concept:'+option.conceptId:'legacy:'+lang.normalize(option.term);
   button.dataset.conceptId=option.conceptId||'';button.dataset.tagKey=tagKey;button.dataset.tag=option.term;
   button.setAttribute('aria-pressed',String(tagKey===selectedSearchTagKey));
   const label=document.createElement('span');label.textContent=option.term;
   const count=document.createElement('small');count.textContent=option.count+' '+(lang?.ui('stores')||'locales')+' '+(lang?.ui('inMall')||'en este mall');
   button.append(label,count);button.onclick=()=>searchCommitAction?.(option.term,tagKey===selectedSearchTagKey?null:tagKey);tags.append(button);
  }
  host.append(tags);
 }
 const grouped=new Set();
 for(const option of options){
  const tagKey=option.conceptId?'concept:'+option.conceptId:'legacy:'+lang.normalize(option.term);
  if(selectedSearchTagKey&&selectedSearchTagKey!==tagKey)continue;
  const members=new Map();
  for(const store of option.stores||[]){
   const record=byStore.get(store.storeId);if(!record)continue;
   // A store can match several synonymous tags. The autocomplete is a store
   // result list, so render that identity once under its highest-ranked tag.
   if(!selectedSearchTagKey&&grouped.has(record.storeId))continue;
   members.set(record.storeId,record);
  }
  if(!members.size)continue;
  const group=document.createElement('section');group.className='rnResultGroup';
  group.dataset.conceptId=option.conceptId||'';group.dataset.tagKey=tagKey;
  const heading=document.createElement('h5');heading.textContent=option.term+' · '+(lang?.ui('storesWithTag')||'Comercios con esta etiqueta');group.append(heading);
  const storeList=selectedSearchTagKey?panelCards:group;
  for(const record of members.values()){
   appendUnitResult(storeList,record,record.matchTypes,{horizontal:Boolean(selectedSearchTagKey)});grouped.add(record.storeId);
  }
  if(!selectedSearchTagKey)host.append(group);
 }
 // Direct commercial-name matches and matches without a suggested tag remain
 // discoverable and are explicitly separated by the field that matched.
 for(const type of selectedSearchTagKey?[]:['name','product','service','category']){
  const members=records.filter(record=>record.matchTypes.includes(type)&&!grouped.has(record.storeId));
  if(!members.length)continue;
  const group=document.createElement('section');group.className='rnResultGroup rnResultTypeGroup';
  const heading=document.createElement('h5');heading.textContent=matchTypeLabel(type);group.append(heading);
  for(const record of members){appendUnitResult(group,record,[type]);grouped.add(record.storeId);}
  host.append(group);
 }
 return{storeIds:new Set(records.map(record=>record.storeId)),options};
}
function results(){if(!ready)return;let q=$('search').value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();if(!q)window.RetailNavUnits?.clearQuery?.();let host=$('results');host.replaceChildren();const shopSearch=renderGroupedShopResults(host,$('search').value.trim());let list=floors.flatMap(fl=>fl.features).filter(f=>['anchor','unit','zone'].includes(f.k)&&(q||active==='ALL'||f.floor===active));if(q)list=list.filter(f=>(f.n+' '+f.id).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(q));else list=list.filter(f=>f.k==='anchor');list.slice(0,35).forEach(f=>{let b=document.createElement('button');b.className='result'+(selected===f?' active':'');let badge=document.createElement('span');badge.className='levelbadge';badge.textContent=f.floor;let text=document.createElement('span');text.textContent=f.n||f.id;let sub=document.createElement('span');sub.className='small';sub.textContent=f.k==='anchor'?'Referencia del plano':'Nombre no identificado';text.append(sub);b.append(badge,text);b.onclick=()=>select(f);host.append(b);});let pois=(selectedMall.pois||[]).filter(p=>active==='ALL'||p.floor===active);
if(q){const matcher=window.RetailNavPOI?.find;pois=matcher?matcher(q):[];}
else pois=pois.filter(p=>['toilet','elevator','information','metro','exit'].includes(p.category));
for(const p of pois.slice(0,22)){
  const b=document.createElement('button');b.className='result rnPoiResult';
  const badge=document.createElement('span');badge.className='levelbadge';badge.textContent=p.floor;
  const info=document.createElement('span');
  const serviceCode={toilet:'service.restroom',elevator:'service.elevator',exit:'service.exit',information:'service.information',parking:'service.parking'}[p.category];
  info.textContent=serviceCode&&window.RetailNavI18n?.label(serviceCode)||p.name;
  const sub=document.createElement('span');sub.className='small';
  sub.textContent=p.confidence==='cartel'?'Servicio indicado en el cartel':'Posición o tipo sin verificar';
  info.append(sub);b.append(badge,info);b.onclick=()=>window.RetailNavPOI?.show?.(p.id);
  host.append(b);
}
const districtMatches=q?window.RetailNavDistricts?.find?.(q)||[]:[];
for(const district of districtMatches.slice(0,12)){
 const b=document.createElement('button');b.className='result rnDistrictResult';
 const badge=document.createElement('span');badge.className='levelbadge';badge.textContent=district.floor;
 const t=document.createElement('span');t.textContent=district.name;
 const caption=document.createElement('span');caption.className='small';
 caption.textContent='Zona comercial · '+(district.detail||'identificada en el plano');
 t.append(caption);b.append(badge,t);
 b.onclick=()=>window.RetailNavDistricts?.focus?.(district.id);
 host.append(b);
}
if(!host.children.length){let p=document.createElement('p');p.textContent=window.RetailNavI18n?.ui('none')||'Sin coincidencias en el shopping para esta búsqueda.';host.append(p);}
$('resultCount').textContent=q?(list.length+pois.length+shopSearch.storeIds.size+districtMatches.length)+' '+(window.RetailNavI18n?.ui('results')||'coincidencias'):
  (['ap-plaza','new-world-city-shanghai','alto-palermo'].includes(mallId)
    ?'Directorio fotográfico y sectores provisionales: ubicación de cada tienda pendiente de validación'
    :'Tiendas ancla legibles en las imágenes');}
function notify(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5200);}
function fail(message){errors.push(message);$('fallback').hidden=false;$('fallbackMessage').textContent=message;$('loading').hidden=true;$('status').textContent='Vista de respaldo';$('badge').classList.remove('ready');ready=false;window.RetailNavMapCache?.showError?.(message);document.querySelectorAll('[data-runtime]').forEach(b=>b.disabled=true);}
function progress(n,message){$('loading').hidden=true;window.RetailNavMapCache?.prepare?.(message,Math.min(99,Math.round(78+Math.max(0,n)*.2)));}
// Map-first touch controls: one finger pans; two fingers zoom, twist and tilt.
// Movement is anchored to the world point beneath the gesture, avoiding jumps.
function pan(dx,dy){
 const u=2*distance*Math.tan(Math.PI/8)/Math.max(1,canvas.clientHeight);
 target=vadd(target,qr(q,[-dx*u,dy*u,0]));dirty=true;
}
function worldPointAt(cx,cy,y=target[1]){
 if(!invMvp)return null;
 const rect=canvas.getBoundingClientRect();
 if(!rect.width||!rect.height)return null;
 const nx=(cx-rect.left)/rect.width*2-1,ny=1-(cy-rect.top)/rect.height*2;
 const un=z=>{const a=mp(invMvp,[nx,ny,z,1]);return a.slice(0,3).map(n=>n/a[3]);};
 const a=un(-1),b=un(1),dir=norm(vsub(b,a));
 if(Math.abs(dir[1])<.0001)return null;
 const length=(y-a[1])/dir[1];
 return Number.isFinite(length)&&length>0?vadd(a,vmul(dir,length)):null;
}
function manualMapPoint(cx,cy){
 const floor=floors.find(f=>f.id===active);
 if(!floor)return null;
 const world=worldPointAt(cx,cy,floor.y);
 if(!world)return null;
 const p=[world[0]/cfg.scale+cfg.origin[0],world[2]/cfg.scale+cfg.origin[1]];
 // Ray/plane inverse uses the currently shown floor; another floor or a
 // blank area outside the building cannot become a plausible indoor fix.
 const surfaces=floor.features.filter(f=>f.k==='slab');
 const inFeature=f=>f.r.reduce((inside,ring)=>contains(p,ring)?!inside:inside,false);
 if(!(surfaces.length?surfaces:floor.features).some(inFeature))return null;
 return {floor:floor.id,x:p[0],y:p[1]};
}
function completeManualPosition(at){
 const restore=pendingOriginDestination,localOnly=placingLocalOnly;
 placingPosition=false;canvas.classList.remove('placing');
 window.dispatchEvent(new CustomEvent('retailnav:map-point',{detail:{floor:at.floor,x:at.x,y:at.y,
  mallId,coordinateSpace:selectedMall.coordinateSpace||'mall-photo-pixels',localOnly}}));
 pendingOriginDestination=null;placingLocalOnly=false;
 if(restore)focusCatalogStore(restore.storeId,restore.floor);
 notify('Posición aproximada marcada en '+at.floor+'.');dirty=true;
}
function anchorCamera(cx,cy,originalTarget,originalPoint){
 if(!originalPoint)return;
 matrices();
 const after=worldPointAt(cx,cy,originalPoint[1]);
 if(after)target=vadd(originalTarget,vsub(originalPoint,after));
}
function zoomAt(next,clientX,clientY){
 matrices();const anchor=worldPointAt(clientX,clientY,target[1]),origin=target.slice();
 distance=zoomBounds(next);
 anchorCamera(clientX,clientY,origin,anchor);dirty=true;
}
// iOS Safari may promote a two-finger gesture into PAGE ZOOM even though the
// WebGL canvas uses touch-action:none, especially when the gesture crosses a
// clickable store label or another layer over the map. Cancel that browser
// gesture ONLY while it originated in the mall-render viewport. The search,
// toolbar, dialogs and other page content remain normally zoomable.
const mapGestureViewport=canvas.closest('.viewport');
const mapTouchIdentifiers=new Set();
const coarseInputQuery=matchMedia('(any-pointer: coarse)');
const fineInputQuery=matchMedia('(any-pointer: fine)');
let inputProfile='precision';
function applyInputProfile(){
 const coarse=coarseInputQuery.matches||navigator.maxTouchPoints>0;
 const fine=fineInputQuery.matches;
 inputProfile=coarse&&fine?'hybrid':coarse?'touch':'precision';
 document.documentElement.dataset.inputProfile=inputProfile;
 const help=$('rnGestureHelp');
 if(inputProfile==='touch'){
  help.textContent='1 dedo mueve · 2 dedos amplían, giran e inclinan';
  canvas.setAttribute('aria-label','Mapa 3D. Desplazá con un dedo; dos dedos hacen zoom, rotan e inclinan. Doble toque y arrastre vertical para zoom.');
 }else if(inputProfile==='hybrid'){
  help.textContent='Pantalla táctil o trackpad · pellizcar amplía · girar rota · Mayúsculas + desplazar inclina';
  canvas.setAttribute('aria-label','Mapa 3D compatible con pantalla táctil, trackpad y mouse. Pellizcá para ampliar, girá dos dedos para rotar y usá Mayúsculas más desplazamiento para inclinar.');
 }else{
  help.textContent='Trackpad/mouse · pellizcar amplía · girar rota · Mayúsculas + desplazar inclina';
  canvas.setAttribute('aria-label','Mapa 3D para trackpad y mouse. Pellizcá para ampliar, girá dos dedos para rotar y usá Mayúsculas más desplazamiento para inclinar.');
 }
}
applyInputProfile();
for(const query of [coarseInputQuery,fineInputQuery])
 query.addEventListener?.('change',applyInputProfile);
mapGestureViewport.addEventListener('touchstart',e=>{
 for(const touch of e.changedTouches)mapTouchIdentifiers.add(touch.identifier);
},{passive:true});
function removeEndedMapTouches(e){
 for(const touch of e.changedTouches)mapTouchIdentifiers.delete(touch.identifier);
}
document.addEventListener('touchend',removeEndedMapTouches,
 {passive:true,capture:true});
document.addEventListener('touchcancel',removeEndedMapTouches,
 {passive:true,capture:true});
document.addEventListener('touchmove',e=>{
 // iOS 13–16 fallback for browsers that ignore touch-action on descendants.
 // One-finger taps, text inputs and gestures begun outside the MAP are exempt.
 if(e.cancelable&&e.touches.length>=2&&
    [...e.touches].every(t=>mapTouchIdentifiers.has(t.identifier)))
  e.preventDefault();
},{passive:false,capture:true});
const pointers=new Map();
let gesture=null,lastTap=null;
let safariTrackpadGesture=null;
function safariGesturePoint(e){
 const r=canvas.getBoundingClientRect();
 return [Number.isFinite(e.clientX)&&e.clientX?r.left+clamp(e.clientX-r.left,0,r.width):r.left+r.width/2,
  Number.isFinite(e.clientY)&&e.clientY?r.top+clamp(e.clientY-r.top,0,r.height):r.top+r.height/2];
}
function handleSafariTrackpadGesture(e){
 const insideMap=mapGestureViewport.contains(e.target);
 if(!insideMap&&!safariTrackpadGesture&&mapTouchIdentifiers.size<2)return;
 if(e.cancelable)e.preventDefault();
 // iPhone/iPad also emit WebKit GestureEvents. Their real contacts are
 // already handled by Pointer Events; this branch is only for a Mac trackpad,
 // which supplies no touch identifiers or pointer contacts to the web page.
 if(e.type==='gesturestart'){
  if(!ready||mapTouchIdentifiers.size||pointers.size)return;
  cameraFlight=null;stopAuto();canvas.focus();matrices();
  const [x,y]=safariGesturePoint(e);
  safariTrackpadGesture={distance,target:target.slice(),orientation:q.slice(),
   yaw:orbitYaw,pitch:orbitPitch,roll:orbitRoll,x,y,
   anchor:worldPointAt(x,y,target[1])};
  canvas.classList.add('dragging');dirty=true;
  return;
 }
 if(e.type==='gestureend'){
  safariTrackpadGesture=null;
  if(!pointers.size)canvas.classList.remove('dragging');
  dirty=true;return;
 }
 if(e.type!=='gesturechange'||!safariTrackpadGesture)return;
 const start=safariTrackpadGesture;
 const scale=clamp(Number.isFinite(e.scale)?e.scale:1,.08,12);
 const angle=(Number.isFinite(e.rotation)?e.rotation:0)*Math.PI/180;
 distance=zoomBounds(start.distance/scale);
 target=start.target.slice();
 if(panMode){
  orbitYaw=start.yaw+angle;orbitPitch=start.pitch;orbitRoll=0;
  updateCameraRotation();
 }else{
  q=norm(qm(start.orientation,quat([0,0,1],angle)));
  orbitYaw=start.yaw;orbitPitch=start.pitch;orbitRoll=wrapAngle(start.roll+angle);
 }
 anchorCamera(start.x,start.y,start.target,start.anchor);
 $('plan').setAttribute('aria-pressed','false');dirty=true;
}
for(const kind of ['gesturestart','gesturechange','gestureend'])
 document.addEventListener(kind,handleSafariTrackpadGesture,{passive:false,capture:true});
function beginGesture(){
 const p=[...pointers.values()];
 const center=p.length>=2?[(p[0].x+p[1].x)/2,(p[0].y+p[1].y)/2]:
  p.length?[p[0].x,p[0].y]:null;
 matrices();
 gesture={target:target.slice(),distance,yaw:orbitYaw,pitch:orbitPitch,roll:orbitRoll,
  orientation:q.slice(),p:p.map(point=>({...point})),
  anchor:center?worldPointAt(center[0],center[1],target[1]):null};
}
mapGestureViewport.addEventListener('pointerdown',e=>{cameraFlight=null;
 if(!ready)return;
 stopAuto();
 // A single tap on a clickable shop number or POI must retain its own click.
 // A second finger, however, turns the whole map (including overlays) into
 // a pinch surface, not a browser zoom or accidental store selection.
 const startedOnOverlay=e.target!==canvas;
 if(!startedOnOverlay)canvas.focus();
 if(!startedOnOverlay||pointers.size){
  try{mapGestureViewport.setPointerCapture(e.pointerId);}catch{}
 }
 if(pointers.size){
  for(const id of pointers.keys()){
   try{mapGestureViewport.setPointerCapture(id);}catch{}
  }
 }
 // All participants in a two-finger gesture must be ineligible for tap
 // recognition, including the stationary finger lifted last.
 if(pointers.size){
  for(const previous of pointers.values())previous.hadMultitouch=true;
  lastTap=null;
 }
 const doubleTapCandidate=pointers.size===0&&e.pointerType==='touch'
  &&lastTap&&performance.now()-lastTap.at<320
  &&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<35;
 pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,
  button:e.button,shift:e.shiftKey,moved:false,startedOnOverlay,
  hadMultitouch:pointers.size>0});
 beginGesture();
 if(gesture)gesture.doubleTapHold=Boolean(doubleTapCandidate);
 canvas.classList.add('dragging');dirty=true;
});
mapGestureViewport.addEventListener('pointermove',e=>{
 if(!ready||!pointers.has(e.pointerId))return;
 const ptr=pointers.get(e.pointerId);
 ptr.x=e.clientX;ptr.y=e.clientY;
 if(Math.hypot(ptr.x-ptr.startX,ptr.y-ptr.startY)>7)ptr.moved=true;
 if(!gesture)return;
 const p=[...pointers.values()];
 if(p.length===1){
  const dx=p[0].x-gesture.p[0].x,dy=p[0].y-gesture.p[0].y;
  target=gesture.target.slice();distance=gesture.distance;
  // Native iOS: double-tap, HOLD the second tap and drag upwards to
  // zoom in, downwards to zoom out (with the touched point anchored).
  if(gesture.doubleTapHold){
   if(Math.abs(dy)>6){
    const moved=dy-Math.sign(dy)*6;
    distance=zoomBounds(gesture.distance*Math.exp(moved*.015));
    anchorCamera(gesture.p[0].x,gesture.p[0].y,gesture.target,gesture.anchor);
    lastTap=null;dirty=true;
   }
   return;
  }
  if(panMode||p[0].button===2||p[0].shift){
   if(gesture.anchor)anchorCamera(p[0].x,p[0].y,gesture.target,gesture.anchor);
   else{
    // At edge-on/underside views the ray never intersects the floor plane.
    // Fall back to panning in the camera's screen axes, without freezing.
    const unit=2*distance*Math.tan(Math.PI/8)/Math.max(1,canvas.clientHeight);
    target=vadd(gesture.target,qr(q,[-dx*unit,dy*unit,0]));
   }
  }else{
   // Map the gesture to the virtual sphere. Preserve a quaternion even
   // across upside-down/polar views, so a full rotation never freezes.
   const begin=arcballVector(gesture.p[0].x,gesture.p[0].y);
   const end=arcballVector(p[0].x,p[0].y);
   q=norm(qm(gesture.orientation,arcballCameraDelta(begin,end)));
   // Public diagnostics / keyboard increments retain their angle counters.
   // They are NOT used to rebuild the camera orientation in spherical mode.
   orbitYaw=gesture.yaw-dx*.006;
   orbitPitch=gesture.pitch-dy*.006;
   orbitRoll=gesture.roll;
   $('plan').setAttribute('aria-pressed','false');
  }
 }else if(p.length>=2){
  const [a,b]=p,[aa,bb]=gesture.p;
  const d=Math.hypot(a.x-b.x,a.y-b.y),dd=Math.max(5,Math.hypot(aa.x-bb.x,aa.y-bb.y));
  const delta=Math.atan2(b.y-a.y,b.x-a.x)-Math.atan2(bb.y-aa.y,bb.x-aa.x);
  const angle=Math.atan2(Math.sin(delta),Math.cos(delta));
  const dx=(a.x+b.x-aa.x-bb.x)/2,dy=(a.y+b.y-aa.y-bb.y)/2;
  distance=zoomBounds(gesture.distance*dd/Math.max(5,d));
  if(panMode){
   orbitYaw=gesture.yaw+angle;
   orbitRoll=0;
   // Google Earth: parallel vertical motion of both fingers tilts, without
   // disabling simultaneous pinch, twist, or movement of the two-finger centre.
   const da=a.y-aa.y,db=b.y-bb.y;
   const sameDirection=da*db>0&&Math.abs(da-db)<Math.max(34,Math.abs(dy)*.9);
   const tilting=Math.abs(dy)>8&&sameDirection
    &&Math.abs(dy)>Math.abs(dx)*.65;
   orbitPitch=clamp(gesture.pitch-(tilting?dy*.0045:0),MIN_PITCH,MAX_PITCH);
   earth2D=Math.abs(orbitPitch-MIN_PITCH)<.025;
   if(!earth2D)lastEarth3DPitch=orbitPitch;
   updateCameraRotation();
  }else{
   // Pinch changes distance, centre translation pans, twist rotates around
   // local Z. No world-up reset, limits or Euler decomposition.
   q=norm(qm(gesture.orientation,quat([0,0,1],angle)));
   orbitYaw=gesture.yaw;
   orbitPitch=gesture.pitch;
   orbitRoll=wrapAngle(gesture.roll+angle);
  }
  target=gesture.target.slice();
  if(gesture.anchor){
   anchorCamera((a.x+b.x)/2,(a.y+b.y)/2,gesture.target,gesture.anchor);
  }else{
   const unit=2*distance*Math.tan(Math.PI/8)/Math.max(1,canvas.clientHeight);
   target=vadd(gesture.target,qr(q,[-dx*unit,dy*unit,0]));
  }
  $('plan').setAttribute('aria-pressed','false');
 }
 dirty=true;
});
function endPointer(e){
 const p=pointers.get(e.pointerId);
 if(p&&!p.startedOnOverlay&&!p.hadMultitouch&&pointers.size===1&&!p.moved
  &&Math.hypot(p.x-p.startX,p.y-p.startY)<7&&p.button===0){
  const now=performance.now();
  const doubleTap=lastTap&&now-lastTap.at<320&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<32;
  if(doubleTap&&!placingPosition){
   zoomAt(distance*.70,e.clientX,e.clientY);lastTap=null;
  }else{
   lastTap={x:e.clientX,y:e.clientY,at:now};
   if(placingPosition){
    const at=manualMapPoint(e.clientX,e.clientY);
    if(at)completeManualPosition(at);
    else notify('Tocá un punto dentro de la planta para indicar tu ubicación.');
   }else pick(e.clientX,e.clientY);
  }
 }
 pointers.delete(e.pointerId);beginGesture();
 if(!pointers.size)canvas.classList.remove('dragging');
 dirty=true;
}
mapGestureViewport.addEventListener('pointerup',endPointer);
mapGestureViewport.addEventListener('pointercancel',e=>{
 pointers.delete(e.pointerId);beginGesture();
 if(!pointers.size)canvas.classList.remove('dragging');dirty=true;
});
mapGestureViewport.addEventListener('lostpointercapture',e=>{
 if(pointers.has(e.pointerId)){pointers.delete(e.pointerId);beginGesture();dirty=true;}
});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('wheel',e=>{
 cameraFlight=null;
 if(!ready)return;e.preventDefault();stopAuto();
 // WebKit may accompany its native GestureEvent with a ctrl-wheel event.
 // Avoid applying the same MacBook pinch twice.
 if(safariTrackpadGesture&&e.ctrlKey)return;
 if(e.altKey&&!panMode){
  orbitRoll=wrapAngle(orbitRoll+e.deltaY*.002);
  rotateCameraLocal([0,0,1],e.deltaY*.002);
 }else if(e.shiftKey){
  if(panMode){
   orbitPitch=clamp(orbitPitch+e.deltaY*.0015,MIN_PITCH,MAX_PITCH);
   updateCameraRotation();
  }else{
   orbitPitch+=e.deltaY*.0015;
   rotateCameraLocal([1,0,0],e.deltaY*.0015);
  }
  dirty=true;
 }else zoomAt(distance*Math.exp(e.deltaY*(e.ctrlKey?.0025:.0012)),e.clientX,e.clientY);
},{passive:false});
canvas.addEventListener('keydown',e=>{
 if(!ready)return;
 const key=e.key;
 if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','+','=','-','0','[',']','q','e','PageUp','PageDown','n','N','u','U','r','R'].includes(key))e.preventDefault();
 if(key==='ArrowLeft')pan(30,0);
 if(key==='ArrowRight')pan(-30,0);
 if(key==='ArrowUp')pan(0,30);
 if(key==='ArrowDown')pan(0,-30);
 if(key==='+'||key==='=')distance=zoomBounds(distance*.86);
 if(key==='-')distance=zoomBounds(distance*1.16);
 if(key==='['||key===']'){
  const angle=key==='['?-.12:.12;
  orbitYaw+=angle;
  if(panMode)updateCameraRotation();
  else rotateCameraLocal([0,1,0],angle);
 }
 if(!panMode&&(key.toLowerCase()==='q'||key.toLowerCase()==='e')){
  const angle=key.toLowerCase()==='q'?.12:-.12;
  orbitRoll=wrapAngle(orbitRoll+angle);
  rotateCameraLocal([0,0,1],angle);
 }
 if(key==='PageUp'||key==='PageDown'){
  const angle=key==='PageUp'?-.14:.14;
  orbitPitch=panMode?clamp(orbitPitch+angle,MIN_PITCH,MAX_PITCH)
   :orbitPitch+angle;
  if(panMode)updateCameraRotation();
  else rotateCameraLocal([1,0,0],angle);
 }
 if(key==='0'||key.toLowerCase()==='r')resetCamera();
 if(key.toLowerCase()==='n')faceMapNorth();
 if(key.toLowerCase()==='u')switchEarth2D();
 dirty=true;
});
// Same-floor demo pathfinding. Gray corridors only; no unverified vertical connectors or shop entrances.
function findRoute(){if(!selected)return;if(!selectedMall.navigable){notify('Rutas deshabilitadas: los pasillos de este plano fotográfico no están verificados.');return;}let f=floors.find(f=>f.id===selected.floor),w=f.walk,N=w.w*w.h;const open=i=>i>=0&&i<N&&((w.bytes[i>>3]>>(i&7))&1),coord=i=>[w.x+(i%w.w)*w.step,w.y+Math.floor(i/w.w)*w.step];let cells=[];for(let i=0;i<N;i++)if(open(i))cells.push(i);if(!cells.length)return notify('Este sector no contiene un pasillo legible para trazar una ruta.');let origin=[624,401],goal=selected.c;let nearest=p=>cells.reduce((a,b)=>Math.hypot(...vsub(coord(b),p))<Math.hypot(...vsub(coord(a),p))?b:a,cells[0]);let start=nearest(origin),end=nearest(goal),queue=[start],prev=new Int32Array(N).fill(-1);prev[start]=start;for(let h=0;h<queue.length&&prev[end]<0;h++){let i=queue[h];for(let j of [i-1,i+1,i-w.w,i+w.w])if(open(j)&&prev[j]<0&&(Math.abs(j-i)!==1||Math.floor(j/w.w)===Math.floor(i/w.w))){prev[j]=i;queue.push(j);}}if(prev[end]<0){$('routeInfo').textContent='No hay continuidad demostrable entre estos sectores en el trazado. No se dibuja una ruta a traves de locales.';return;}let path=[end];while(path.at(-1)!==start)path.push(prev[path.at(-1)]);path.reverse();if(path.length<2){$('routeInfo').textContent='El punto de demostracion ya esta junto a este sector.';return;}let pts=path.map(coord).filter((p,i,a)=>i===0||i===a.length-1||(a[i-1][0]!==a[i+1][0]&&a[i-1][1]!==a[i+1][1]));if(active!==selected.floor){let saved=selected;setFloor(saved.floor);selected=saved;}route={floor:f.id,points:pts};routeRunning=true;routeT=0;$('routeInfo').textContent='Recorrido de prueba sobre pasillos trazados. Origen ficticio; termina cerca del local, no en una puerta verificada. Sin instrucciones para uso real.';notify('La animacion recorre exclusivamente la circulacion del plano.');}
// Per-floor source-photo QA: do not treat the traced SVG as the original image.
let referenceObjectUrl=null;
function referenceFor(level){
 const entry=selectedMall.floorReferences?.[level];
 return entry?.url||(mallId==='aventura'?(window.RETAILNAV_REFERENCES||{})[level]:null);
}
let photoFloors=null;
function comparisonFloors(){return photoFloors||floors;}
async function comparison(){
 if(selectedMall.photoMapAsset&&!photoFloors){
  try{const res=await fetch(selectedMall.photoMapAsset.url+'?v='+selectedMall.photoMapAsset.sha256);if(!res.ok)throw Error("HTTP "+res.status);
   const bytes=await res.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");
   if(hash!==selectedMall.photoMapAsset.sha256)throw Error("Referencia desactualizada");
   photoFloors=unpack(JSON.parse(new TextDecoder().decode(bytes)));
  }catch(e){notify("No se pudo cargar el plano original: "+e.message);return;}
 }
 stopAuto();
 originalLevel=active==='ALL'?(mallId==='aventura'?'UL':comparisonFloors()[0].id):active;
 const combo=$('compareLevel');
 combo.replaceChildren();
 for(const floor of comparisonFloors()){
  const option=document.createElement('option');
  option.value=floor.id;option.textContent=floor.id+' · '+floor.name;
  combo.append(option);
 }
 combo.value=originalLevel;
 $('showReference').checked=true;$('showVectors').checked=true;
 $('overlayOpacity').value='.40';$('compareZoom').value='100';
 resetCompareViewport();
 $('compareMode').value='filled';$('showUnitCodes').checked=true;
 $('compareMarkMode').checked=false;auditPoint=null;
 $('compareSaveIssue').disabled=true;
 if(referenceObjectUrl){URL.revokeObjectURL(referenceObjectUrl);referenceObjectUrl=null;}
 drawComparison();
 $('compareDialog').showModal();
 requestAnimationFrame(compareRenderView);
}
const RN_SVG='http://www.w3.org/2000/svg';
let auditPoint=null;
const issueMemory=new Map();
const issueTypes={
 'division-missing':'División faltante','merged-stores':'Locales fusionados',
 'shifted-boundary':'Contorno desplazado','wrong-store-id':'Código incorrecto',
 'missing-amenity':'Servicio omitido','other':'Otra anomalía'
};
function geometryIdentity(floor){
 let h=2166136261;
 // Fingerprint every vertex, not only the feature count. Old annotations
 // should NOT silently land on newly generated, different polygons.
 for(const f of floor.features){
  const str=f.id+':'+f.p.map(p=>p.join(',')).join('|')+';';
  for(let i=0;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),16777619)>>>0;
 }
 return h.toString(16).padStart(8,'0');
}
function issueKey(level){
 const f=comparisonFloors().find(f=>f.id===level);
 const photo=selectedMall.floorReferences?.[level]?.sha256||'unregistered';
 return 'retailnav:photo-audit:v1:'+mallId+':'+level+':'+photo+':'+geometryIdentity(f);
}
function getAuditIssues(level){
 const key=issueKey(level);
 if(issueMemory.has(key))return issueMemory.get(key).slice();
 try{
  const items=JSON.parse(localStorage.getItem(key)||'[]');
  if(Array.isArray(items)){
   const safe=items.filter(item=>item&&item.floor===level
     &&Number.isFinite(item.x)&&Number.isFinite(item.y)
     &&Object.hasOwn(issueTypes,item.type)).slice(0,250);
   issueMemory.set(key,safe);
   return safe.slice();
  }
 }catch{}
 return [];
}
function putAuditIssues(level,items){
 const key=issueKey(level);
 issueMemory.set(key,items.slice(0,250));
 try{localStorage.setItem(key,JSON.stringify(items.slice(0,250)));}catch{}
}
function svgPaths(floor){
 return floor.features.filter(f=>f.k!=='slab').map(f=>{
  const d=f.r.map(r=>'M'+r.map(p=>p.join(',')).join(' L')+'Z').join(' ');
  return '<path data-polygon="'+f.id+'" class="rnCompareFeature" d="'+d+
   '" fill="#000000" fill-opacity="0.40" stroke="#ffffff" stroke-width="2"'+
   ' stroke-linejoin="round" vector-effect="non-scaling-stroke" fill-rule="evenodd"/>';
 }).join('');
}
function drawUnitComparison(level){
 const group=$('compareUnitLabels');
 group.replaceChildren();
 group.style.display=$('showUnitCodes').checked?'':'none';
 const records=(selectedMall.units||[]).filter(u=>!selectedMall.photoMapAsset||u.photoReference).map(u=>u.photoReference?{...u,...u.photoReference}:u).filter(u=>u.floor===level);
 for(const u of records){
  if(!Number.isFinite(u.x)||!Number.isFinite(u.y))continue;
  const t=document.createElementNS(RN_SVG,'text');
  t.setAttribute('x',String(u.x));t.setAttribute('y',String(u.y));
  t.setAttribute('class','rnCompareUnitCode');
  t.textContent=u.code;
  group.append(t);
 }
}
function drawAuditPins(level){
 const group=$('compareIssueMarkers');
 group.replaceChildren();
 const items=getAuditIssues(level);
 $('compareIssueCount').textContent=String(items.length);
 for(let i=0;i<items.length;i++){
  const item=items[i];
  const circle=document.createElementNS(RN_SVG,'circle');
  circle.setAttribute('cx',String(item.x));circle.setAttribute('cy',String(item.y));
  circle.setAttribute('r','7');
  circle.setAttribute('class','rnCompareIssueMarker');
  group.append(circle);
  const n=document.createElementNS(RN_SVG,'text');
  n.setAttribute('x',String(item.x));n.setAttribute('y',String(item.y));
  n.setAttribute('class','rnCompareIssueNumber');
  n.textContent=String(i+1);
  group.append(n);
 }
 const marker=$('compareClickMarker');marker.replaceChildren();
 if(auditPoint?.floor===level){
  const c=document.createElementNS(RN_SVG,'circle');
  c.setAttribute('cx',String(auditPoint.x));c.setAttribute('cy',String(auditPoint.y));
  c.setAttribute('r','10');c.setAttribute('class','rnCompareTarget');
  marker.append(c);
 }
 const list=$('compareIssues');list.replaceChildren();
 for(let i=0;i<items.length;i++){
  const item=items[i];
  const row=document.createElement('div');row.className='rnIssueRow';
  const name=document.createElement('span');
  name.textContent=(i+1)+'. '+issueTypes[item.type]+
   ' · ('+Math.round(item.x)+','+Math.round(item.y)+')'+
   (item.polygonId?' · '+item.polygonId:'')+
   (item.note?' — '+item.note:'');
  const remove=document.createElement('button');
  remove.type='button';remove.textContent='Eliminar';
  remove.setAttribute('aria-label','Eliminar anomalía '+(i+1));
  remove.onclick=()=>{
   const updated=getAuditIssues(level).filter(x=>x.id!==item.id);
   putAuditIssues(level,updated);drawComparison();
  };
  row.append(name,remove);list.append(row);
 }
}
function compareMapClick(event){
 if(performance.now()-compareLastMovement<180)return;
 if(!$('compareMarkMode').checked)return;
 const svg=$('compareSvg');
 const ctm=svg.getScreenCTM();
 if(!ctm)return;
 const local=svg.createSVGPoint();
 local.x=event.clientX;local.y=event.clientY;
 const p=local.matrixTransform(ctm.inverse());
 const bounds=svg.viewBox.baseVal;
 if(p.x<bounds.x||p.y<bounds.y||
    p.x>bounds.x+bounds.width||p.y>bounds.y+bounds.height)return;
 const floor=comparisonFloors().find(f=>f.id===$('compareLevel').value);
 if(!floor)return;
 const candidates=floor.features.filter(f=>f.k!=='slab'&&f.r.length&&
  contains([p.x,p.y],f.r[0])&&
  !f.r.slice(1).some(r=>contains([p.x,p.y],r)));
 // A click on the photograph may correspond to a missing divider rather
 // than an existing polygon. Preserve both the point and optional polygon.
 const chosen=candidates.sort((a,b)=>a.p.length-b.p.length)[0];
 auditPoint={floor:floor.id,x:Math.round(p.x*10)/10,
  y:Math.round(p.y*10)/10,polygonId:chosen?.id||null};
 $('compareSelectedPoint').textContent='Punto '+auditPoint.x+', '+auditPoint.y+
  (auditPoint.polygonId?' · '+auditPoint.polygonId:' · sin contorno identificado');
 $('compareSaveIssue').disabled=false;
 drawAuditPins(floor.id);
}
function saveAuditIssue(){
 if(!auditPoint)return;
 const floor=$('compareLevel').value;
 if(auditPoint.floor!==floor)return;
 const items=getAuditIssues(floor);
 if(items.length>=250){
  $('compareSelectedPoint').textContent='Límite de observaciones: exportá las existentes.';
  return;
 }
 items.push({...auditPoint,
  id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),
  type:$('compareIssueType').value,
  note:$('compareIssueNote').value.trim().slice(0,500),
  createdAt:new Date().toISOString(),status:'open'});
 putAuditIssues(floor,items);
 auditPoint=null;
 $('compareSelectedPoint').textContent='Anomalía guardada; podés marcar otra.';
 $('compareSaveIssue').disabled=true;$('compareIssueNote').value='';
 drawComparison();
}
function exportAuditIssues(){
 const level=$('compareLevel').value;
 const payload={schema:'retailnav.floor-anomalies.v1',
  mallId,level,referenceSha256:selectedMall.floorReferences?.[level]?.sha256||null,
  geometryFingerprint:geometryIdentity(comparisonFloors().find(f=>f.id===level)),
  generatedAt:new Date().toISOString(),
  reviewStatus:'open-needs-manual-validation',
  automaticCertification:false,
  issues:getAuditIssues(level)};
 download('RetailNav-'+mallId+'-'+level+'-anomalies.json',
  JSON.stringify(payload,null,2),'application/json');
}
// Photo, polygon contours, unit IDs and QA pins live in one SVG viewBox.
// Moving/scaling the WHOLE SVG retains pixel-perfect photo-to-vector alignment.
const comparePointers=new Map();
let comparePan={x:0,y:0},compareAppliedZoom=100,compareGesture=null;
let compareLastMovement=-Infinity;
const COMPARE_MIN_ZOOM=50,COMPARE_MAX_ZOOM=1200;
const compareViewport=$('compareViewport'),compareImage=$('compareSvg');
function compareClampPan(){
 const frame=compareViewport.getBoundingClientRect();
 const content=compareImage.getBoundingClientRect();
 const gap=Math.min(28,frame.width*.08,frame.height*.08);
 comparePan.x=clamp(comparePan.x,
  Math.min(gap,frame.width-content.width-gap),gap);
 comparePan.y=clamp(comparePan.y,
  Math.min(gap,frame.height-content.height-gap),gap);
}
function compareRenderView(){
 compareImage.style.width=compareAppliedZoom+'%';
 compareImage.style.height='auto';
 compareImage.style.maxHeight='none';
 compareImage.style.minHeight='0';
 compareClampPan();
 compareImage.style.transform='translate3d('+comparePan.x.toFixed(2)+'px,'+
  comparePan.y.toFixed(2)+'px,0)';
 $('compareZoomValue').textContent=Math.round(compareAppliedZoom)+' %';
 $('compareZoom').value=String(Math.round(compareAppliedZoom));
}
function compareSetZoom(value,clientX,clientY){
 const r=compareViewport.getBoundingClientRect();
 const x=Number.isFinite(clientX)?clientX-r.left:r.width/2;
 const y=Number.isFinite(clientY)?clientY-r.top:r.height/2;
 const zoom=clamp(value,COMPARE_MIN_ZOOM,COMPARE_MAX_ZOOM);
 const k=zoom/compareAppliedZoom;
 comparePan={x:x-(x-comparePan.x)*k,y:y-(y-comparePan.y)*k};
 compareAppliedZoom=zoom;compareRenderView();
}
function resetCompareViewport(){
 comparePointers.clear();compareGesture=null;
 comparePan={x:0,y:0};compareAppliedZoom=100;
 compareRenderView();
}
function compareStartGesture(){
 const a=[...comparePointers.values()];
 const r=compareViewport.getBoundingClientRect();
 const center=a.length===2
  ?{x:(a[0].x+a[1].x)/2-r.left,y:(a[0].y+a[1].y)/2-r.top}
  :a.length?{x:a[0].x-r.left,y:a[0].y-r.top}:null;
 compareGesture=a.length?{pan:{...comparePan},zoom:compareAppliedZoom,
  points:a.map(p=>({...p})),center,
  distance:a.length===2?Math.max(4,Math.hypot(
   a[1].x-a[0].x,a[1].y-a[0].y)):null}:null;
}
compareImage.addEventListener('pointerdown',e=>{
 if(e.pointerType==='mouse'&&e.button!==0)return;
 comparePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 try{compareImage.setPointerCapture(e.pointerId);}catch{}
 compareStartGesture();
 compareViewport.classList.add('rnCompareDragging');
 e.preventDefault();
});
compareImage.addEventListener('pointermove',e=>{
 const p=comparePointers.get(e.pointerId);
 if(!p||!compareGesture)return;
 p.x=e.clientX;p.y=e.clientY;
 const points=[...comparePointers.values()],g=compareGesture;
 if(points.length===1){
  const dx=points[0].x-g.points[0].x,dy=points[0].y-g.points[0].y;
  if(Math.hypot(dx,dy)<3)return;
  comparePan={x:g.pan.x+dx,y:g.pan.y+dy};
 }else if(points.length===2&&g.points.length===2){
  const r=compareViewport.getBoundingClientRect();
  const mid={x:(points[0].x+points[1].x)/2-r.left,
   y:(points[0].y+points[1].y)/2-r.top};
  const next=clamp(g.zoom*Math.hypot(
   points[1].x-points[0].x,points[1].y-points[0].y)/g.distance,
   COMPARE_MIN_ZOOM,COMPARE_MAX_ZOOM);
  const k=next/g.zoom;
  compareAppliedZoom=next;
  comparePan={x:mid.x-(g.center.x-g.pan.x)*k,
   y:mid.y-(g.center.y-g.pan.y)*k};
 }else return;
 compareLastMovement=performance.now();
 compareRenderView();
 e.preventDefault();
});
const compareEndPointer=e=>{
 if(!comparePointers.has(e.pointerId))return;
 comparePointers.delete(e.pointerId);compareStartGesture();
 if(!comparePointers.size)compareViewport.classList.remove('rnCompareDragging');
};
compareImage.addEventListener('pointerup',compareEndPointer);
compareImage.addEventListener('pointercancel',compareEndPointer);
compareImage.addEventListener('lostpointercapture',compareEndPointer);
compareImage.addEventListener('wheel',e=>{
 e.preventDefault();
 compareSetZoom(compareAppliedZoom*Math.exp(-e.deltaY*.0015),
  e.clientX,e.clientY);
},{passive:false});
compareImage.addEventListener('dblclick',e=>{
 e.preventDefault();
 compareSetZoom(compareAppliedZoom*1.6,e.clientX,e.clientY);
});
for(const type of ['gesturestart','gesturechange','gestureend'])
 compareViewport.addEventListener(type,e=>e.preventDefault(),{passive:false});
window.addEventListener('resize',()=>{
 if($('compareDialog').open)compareRenderView();
});
window.visualViewport?.addEventListener('resize',()=>{
 if($('compareDialog').open)compareRenderView();
});

function drawComparison(){
 const level=$('compareLevel').value;
 const floor=comparisonFloors().find(f=>f.id===level);
 if(!floor)return;
 const entry=selectedMall.floorReferences?.[level];
 const size=entry?.imageSize||
   (mallId==='aventura'?[1320,941]:(data?.find?.(f=>f[0]===level)?.[5]||[1440,620]));
 const box=entry?.viewBox||(mallId==='aventura'?'290 100 800 620':
   '0 0 '+size[0]+' '+size[1]);
 $('compareSvg').setAttribute('viewBox',box);
 $('referenceBackground').setAttribute('width',String(size[0]));
 $('referenceBackground').setAttribute('height',String(size[1]));
 const img=$('referenceImage');
 img.setAttribute('x','0');img.setAttribute('y','0');
 img.setAttribute('width',String(size[0]));
 img.setAttribute('height',String(size[1]));
 const src=referenceObjectUrl||referenceFor(level);
 img.removeAttribute('href');
 if(src)img.setAttribute('href',src);
 const present=Boolean(src);
 $('compareMissing').hidden=present;
 $('compareSource').textContent=floor.name+' · '+floor.source;
 const approved=entry?.qa?.status==='approved';
 const openCount=getAuditIssues(level).length;
 $('compareReviewStatus').textContent=present
  ?(approved&&openCount===0?'Referencia verificada para esta geometría.'
    :'Mapa provisional · '+openCount+' anomalía(s) registrada(s). Verificar divisiones, rótulos y servicios.')
  :'Falta la foto de referencia: esta vectorización no puede aprobarse.';
 $('traceOverlay').innerHTML=svgPaths(floor);
 $('referenceImage').style.display=$('showReference').checked&&present?'':'none';
 $('traceOverlay').style.display=$('showVectors').checked?'':'none';
 const opaque=$('compareMode').value==='outline'?0:Number($('overlayOpacity').value);
 // Apply transparency ONLY to black fill. White outlines stay fully opaque.
 $('traceOverlay').style.opacity='1';
 for(const node of $('traceOverlay').children)
  node.style.fillOpacity=String(opaque);
 $('overlayOpacity').disabled=$('compareMode').value==='outline';
 $('opacityValue').textContent=Math.round(opaque*100)+' %';
 drawUnitComparison(level);
 drawAuditPins(level);
 const zoom=Number($('compareZoom').value)||100;
 if(zoom!==Math.round(compareAppliedZoom))compareSetZoom(zoom);
 else compareRenderView();
}
function changeComparePhoto(event){
 const file=event?.target?.files?.[0];
 if(!file)return;
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||
    file.size>12*1024*1024){
  $('compareMissing').hidden=false;
  $('compareMissing').textContent='Usá una imagen JPG, PNG o WebP de hasta 12 MB.';
  return;
 }
 if(referenceObjectUrl)URL.revokeObjectURL(referenceObjectUrl);
 referenceObjectUrl=URL.createObjectURL(file);
 $('showReference').checked=true;
 drawComparison();
}
window.RetailNavComparison={
 open:comparison,refresh:drawComparison,
 getState:()=>({
  level:$('compareLevel')?.value,
  hasReference:Boolean(referenceObjectUrl||referenceFor($('compareLevel')?.value)),
  originalVisible:Boolean($('showReference')?.checked),
  vectorsVisible:Boolean($('showVectors')?.checked),
  opacity:Number($('overlayOpacity')?.value),
  appliedFillOpacity:$('compareMode').value==='outline'?0:Number($('overlayOpacity').value),
  outlineColor:'#ffffff',fillColor:'#000000',outlineWidthPx:2,
  compareMode:$('compareMode')?.value,
  codeLabelsVisible:Boolean($('showUnitCodes')?.checked),
  zoomPercent:Math.round(compareAppliedZoom),panX:comparePan.x,panY:comparePan.y,
  pointerCount:comparePointers.size,touchGesturesEnabled:true,
  panPinchSynchronized:true,
  issueCount:getAuditIssues($('compareLevel')?.value).length,
  geometricValidation:selectedMall.floorReferences?.[$('compareLevel')?.value]?.qa?.status||'unverified',
  floorCount:floors.length
 })
};
function download(name,bytes,type){let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),30000);}
function exportSVG(){
 const fs=visible(),f=fs.find(f=>f.id===focusFloorId)|| (fs.length===1?fs[0]:floors[Math.min(1,floors.length-1)]);
 const points=f.features.flatMap(p=>p.p),min=[0,1].map(k=>Math.min(...points.map(p=>p[k]))-5),max=[0,1].map(k=>Math.max(...points.map(p=>p[k]))+5);
 const bounds=[...min,max[0]-min[0],max[1]-min[1]];
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+bounds.join(' ')+'"><rect x="'+min[0]+'" y="'+min[1]+'" width="'+bounds[2]+'" height="'+bounds[3]+'" fill="#f3f7f9"/>'+svgPaths(f)+'</svg>';
 download('RetailNav-'+mallId+'-'+f.id+'.svg',svg,'image/svg+xml');
}
function exportJSON(){let out={schema:'retailnav.vector.v1',product:'RetailNav',source:selectedMall.source||'Planos aportados',mallId,coordinateSpace:selectedMall.coordinateSpace||'mall-photo-pixels',calibration:selectedMall.coordinateSpace?'Proyección local de fuente WGS84 en decímetros; no calibrada para navegación interior.':'Escala no medida. Coordenadas originales en pixeles registrados.',levels:visible().map(f=>({id:f.id,source:f.source,elevation:f.elevationMetres,elevationStatus:'simulada',features:f.features.map(o=>({id:o.id,kind:o.k,label:o.n,geometry:{outer:o.r[0],holes:o.r.slice(1)},status:'trazado-provisional'}))}))};download('RetailNav-'+mallId+'-'+active+'.json',JSON.stringify(out,null,2),'application/json');}
// GLB 2.0: real triangle meshes with normals, one group per floor, Y up.
function exportGLB(){let parts=[],views=[],accessors=[],meshes=[],nodes=[],materials=[],len=0;let mat={};for(let floor of visible()){let children=[];for(let f of floor.features){if(!f.flat.length)continue;let bytes=new Uint8Array(f.flat.buffer);parts.push(bytes);let view=views.length;views.push({buffer:0,byteOffset:len,byteLength:bytes.length,byteStride:24,target:34962});let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<f.flat.length;i+=6)for(let j=0;j<3;j++){min[j]=Math.min(min[j],f.flat[i+j]);max[j]=Math.max(max[j],f.flat[i+j]);}let a=accessors.length;accessors.push({bufferView:view,byteOffset:0,componentType:5126,count:f.flat.length/6,type:'VEC3',min,max},{bufferView:view,byteOffset:12,componentType:5126,count:f.flat.length/6,type:'VEC3'});let key=f.k+'-'+floor.index;if(mat[key]===undefined){mat[key]=materials.length;materials.push({name:key,pbrMetallicRoughness:{baseColorFactor:[...palette(f,floor.index,false),1],metallicFactor:.1,roughnessFactor:.8},doubleSided:true});}let m=meshes.length;meshes.push({name:f.id,primitives:[{attributes:{POSITION:a,NORMAL:a+1},material:mat[key],mode:4}]});children.push(nodes.length);nodes.push({name:f.n||f.id,mesh:m,extras:{id:f.id,level:floor.id,status:'trazado-provisional'}});len+=bytes.length;}let group=nodes.length;nodes.push({name:floor.id,children,translation:[0,floor.index*4.5,0],extras:{source:floor.source,elevationStatus:'simulada'}});floor.exportGroup=group;}let doc={asset:{version:'2.0',generator:'RetailNav vector-to-mesh',extras:{realSurvey:false,scale:'unidades de modelo, no metros medidos'}},scene:0,scenes:[{nodes:visible().map(f=>f.exportGroup)}],nodes,meshes,materials,buffers:[{byteLength:len}],bufferViews:views,accessors};let text=new TextEncoder().encode(JSON.stringify(doc));let jlen=(text.length+3)&~3,total=12+8+jlen+8+len,buff=new ArrayBuffer(total),v=new DataView(buff),u=new Uint8Array(buff);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,total,true);v.setUint32(12,jlen,true);v.setUint32(16,0x4e4f534a,true);u.fill(32,20,20+jlen);u.set(text,20);v.setUint32(20+jlen,len,true);v.setUint32(24+jlen,0x004e4942,true);let off=28+jlen;parts.forEach(p=>{u.set(p,off);off+=p.length;});download('RetailNav-'+mallId+'-'+active+'.glb',buff,'model/gltf-binary');return buff;}
function bindUI(){$('showAllFloors').onclick=()=>{
 if(focusFloorId&&searchFloorSet){
  focusFloorId=null;cameraFlight=null;
  $('showAllFloors').textContent='← Todas las plantas';
  resetCamera();dirty=true;
 }else setFloor('ALL');
};['pointerdown','pointermove','pointerup','wheel','input','change','click','keydown'].forEach(e=>document.addEventListener(e,()=>{dirty=true;},{passive:true,capture:true}));document.querySelectorAll('[data-floor]').forEach(b=>b.onclick=()=>setFloor(b.dataset.floor));$('zoomIn').onclick=()=>{stopAuto();const r=canvas.getBoundingClientRect();
 zoomAt(distance*.8,r.left+r.width/2,r.top+r.height/2);};
$('zoomOut').onclick=()=>{stopAuto();const r=canvas.getBoundingClientRect();
 zoomAt(distance*1.25,r.left+r.width/2,r.top+r.height/2);};$('reset').onclick=()=>resetCamera();
 $('north').onclick=faceMapNorth;
 $('plan').onclick=switchEarth2D;
 $('pan').onclick=()=>{
 panMode=!panMode;
 if(!panMode)earth2D=false;
 if(panMode){
  // Explicit map-mode switch returns to a stable screen-up camera.
  orbitRoll=0;orbitPitch=clamp(orbitPitch,MIN_PITCH,MAX_PITCH);
  updateCameraRotation();
 }
 updateRotationModeUI();
 notify(panMode
  ?'Modo mapa: un dedo desplaza · dos dedos acercan, giran e inclinan.'
  :'Modo esfera 360°: arrastrá con un dedo en cualquier dirección, incluso por debajo. Dos dedos amplían, mueven y giran.');
 dirty=true;
};
$('rollLeft').onclick=()=>{stopAuto();orbitRoll=wrapAngle(orbitRoll+.18);rotateCameraLocal([0,0,1],.18);};
$('rollRight').onclick=()=>{stopAuto();orbitRoll=wrapAngle(orbitRoll-.18);rotateCameraLocal([0,0,1],-.18);};
$('rnConnectorsToggle').onclick=()=>{
 verticalConnectionsOn=!verticalConnectionsOn;
 $('rnConnectorsToggle').setAttribute('aria-pressed',String(verticalConnectionsOn));
 notify(verticalConnectionsOn
  ?'Enlaces 3D dibujados como hipótesis; no son conexiones verificadas.'
  :'Conexiones verticales ocultas.');
 dirty=true;
};$('auto').onclick=()=>{auto=!auto;$('auto').setAttribute('aria-pressed',String(auto));};$('wire').onclick=()=>{wire=!wire;$('wire').setAttribute('aria-pressed',String(wire));};$('points').onclick=()=>{scan=!scan;$('points').setAttribute('aria-pressed',String(scan));if(scan)notify('Puntos muestreados de estos vectores. No son datos LiDAR.');};$('labelsToggle').onclick=()=>{labelsOn=!labelsOn;$('labelsToggle').setAttribute('aria-pressed',String(labelsOn));};$('spread').oninput=()=>{targetSpread=Number($('spread').value);
 $('spreadValue').textContent=targetSpread>5?'Separadas':'Apiladas';};const renderSuggestions=()=>{
 // Tags, counts and grouped establishments share the main incremental list.
 const host=$('rnSearchSuggestions');if(host){host.replaceChildren();host.hidden=true;}
};
const confirmSearch=(value,tagKey=null)=>{
 const query=String(value||$('search').value).trim();
 if(!query)return;
 selectedSearchTagKey=tagKey;
 $('search').value=query;
 const report=applySearchFloors(query);
 // A selected semantic tag gets a dedicated map-adjacent carousel. Keep the
 // dropdown for ordinary incremental results and close the left information rail.
 $('rnMapSearch').classList.toggle('finding',!tagKey);
 $('rnSearchSuggestions').hidden=true;
 $('search').blur();results();drawSearchMarkers();
 notify(report.matches+' '+(window.RetailNavI18n?.ui('results')||'coincidencias')+
  ' · '+query+' · '+report.floors.join(', ')+'. '+
  (window.RetailNavI18n?.ui('mapWarning')||'Datos provisionales.'));
};
searchCommitAction=confirmSearch;
const setExpandedView=expanded=>{
 document.body.classList.toggle('rnExpandedView',expanded);
 $('rnExpandView').hidden=expanded;$('rnExitExpandedView').hidden=!expanded;
 $('rnExpandView').setAttribute('aria-expanded',String(expanded));
 requestAnimationFrame(()=>{resize();matrices();dirty=true;});
};
$('rnExpandView').onclick=()=>setExpandedView(true);
$('rnExitExpandedView').onclick=()=>setExpandedView(false);
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('rnExpandedView'))setExpandedView(false);});
const updateSearchPanel=()=>{
 const query=$('search').value.trim();
 if(wayfinding)clearSearchFloors();
 selectedSearchTagKey=null;
 document.body.classList.remove('rnTagResultsOpen');$('rnTagResultPanel').hidden=true;
 $('rnMapSearch').classList.toggle('finding',Boolean(query));
 $('detail').hidden=true;
 if(searchFloorSet&&query!==searchCommitted)clearSearchFloors();
 results();renderSuggestions();
};
$('search').oninput=updateSearchPanel;
$('search').onfocus=updateSearchPanel;
$('rnTagResultClose').onclick=()=>{
 selectedSearchTagKey=null;document.body.classList.remove('rnTagResultsOpen');
 $('rnTagResultPanel').hidden=true;results();
};
$('search').addEventListener('keydown',event=>{
 if(event.key==='Escape'){
  if(selectedSearchTagKey){selectedSearchTagKey=null;document.body.classList.remove('rnTagResultsOpen');$('rnTagResultPanel').hidden=true;results();}
  $('rnMapSearch').classList.remove('finding');
  $('rnSearchSuggestions').hidden=true;$('search').blur();
  event.stopPropagation();return;
 }
 if(event.key==='Enter'&&$('search').value.trim()){
  event.preventDefault();confirmSearch($('search').value);return;
 }
 if(event.key==='ArrowDown'){
  const first=$('rnSearchSuggestions').querySelector('button:not([disabled])')||
   $('results').querySelector('button:not([disabled])');
  if(first){event.preventDefault();first.focus();}
 }
});
window.addEventListener('retailnav:localechange',()=>{
 if(!ready)return;
 if(wayfindingOpen&&wayfinding){
  if(wayfinding.placing)updateWayfindingUI();
  else focusCatalogStore(wayfinding.storeId,wayfinding.floor);
 }else if(searchFloorSet&&searchCommitted)applySearchFloors(searchCommitted);
 results();renderSuggestions();dirty=true;
});
document.addEventListener('pointerdown',event=>{
 if(!event.target.closest('#rnMapSearch'))
  $('rnMapSearch').classList.remove('finding');
},{capture:true});$('closeDetail').onclick=clearSelection;$('focusShop').onclick=()=>{if(!selected)return;let f=selected;setFloor(f.floor);selected=f;target=pos(f.c,floors.find(fl=>fl.id===f.floor).y);distance=95;};$('routeBtn').onclick=findRoute;$('original').onclick=comparison;
$('compareLevel').onchange=()=>{if(referenceObjectUrl){URL.revokeObjectURL(referenceObjectUrl);referenceObjectUrl=null;}$('compareLocalPhoto').value='';auditPoint=null;$('compareSaveIssue').disabled=true;resetCompareViewport();drawComparison();};
$('showReference').onchange=drawComparison;
$('showVectors').onchange=drawComparison;
$('overlayOpacity').oninput=drawComparison;
$('compareZoom').oninput=()=>compareSetZoom(Number($('compareZoom').value));
$('compareResetView').onclick=resetCompareViewport;
$('compareMode').onchange=drawComparison;
$('showUnitCodes').onchange=drawComparison;
$('compareMarkMode').onchange=()=>{
 if(!$('compareMarkMode').checked){auditPoint=null;$('compareSaveIssue').disabled=true;drawComparison();}
};
$('compareSvg').addEventListener('click',compareMapClick);
$('compareSaveIssue').onclick=saveAuditIssue;
$('compareExportIssues').onclick=exportAuditIssues;
$('compareLocalPhoto').onchange=changeComparePhoto;$('downloadBtn').onclick=()=>$('exportDialog').showModal();$('jsonBtn').onclick=exportJSON;$('svgBtn').onclick=exportSVG;$('glbBtn').onclick=exportGLB;$('helpBtn').onclick=()=>$('helpDialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());window.addEventListener('resize',reframeAfterResize);
 window.addEventListener('retailnav:indoor-observation',()=>{
 if(!ready||placingPosition||pendingOriginDestination)return;
 const source=window.RetailNavIndoor?.getState?.()?.referenceSource||'fallback-floor';
 const last=lastIndoorReferenceSource;
 lastIndoorReferenceSource=source;
 const nextFloor=visitorFloorReference();
 if(focusFloorId&&focusedStoreId){
  const id=focusedStoreId,dest=focusFloorId;
  if(JSON.stringify(wayfinding?.origin)!==JSON.stringify(wayfindingOrigin()))focusCatalogStore(id,dest);
 }else if(searchFloorSet&&searchCommitted){
  const before=JSON.stringify([...searchFloorSet]);
  if(!searchFloorSet.has(nextFloor)||active!==nextFloor){
   const report=applySearchFloors(searchCommitted);
   if(JSON.stringify(report.floors)!==before)results();
  }
 }else if(nextFloor&&active!==nextFloor&&
  (source!=='fallback-entry'&&source!=='fallback-floor'||
   last&&last!=='fallback-entry'&&last!=='fallback-floor')){
  // Follow an independently selected/manual or surveyed floor and return to
  // provisional ground only when a previous anchor was invalidated.
  setFloor(nextFloor);
 }
 showFloorReference();dirty=true;
});
 window.addEventListener('orientationchange',reframeAfterResize);
 window.visualViewport?.addEventListener('resize',reframeAfterResize);}
async function fetchJSON(url){let c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);try{let res=await fetch(url,{signal:c.signal});if(!res.ok)throw new Error('HTTP '+res.status+' al descargar '+url);let total=Number(res.headers.get('content-length'))||0,got=0,chunks=[],reader=res.body.getReader();while(true){let {done,value}=await reader.read();if(done)break;chunks.push(value);got+=value.byteLength;progress(total?Math.min(25,got/total*25):10,'Descargando vectores: '+Math.ceil(got/1024)+' KB'+(total?' / '+Math.ceil(total/1024)+' KB':''));}let bytes=new Uint8Array(got),off=0;chunks.forEach(x=>{bytes.set(x,off);off+=x.length;});return JSON.parse(new TextDecoder().decode(bytes));}finally{clearTimeout(timer);}}
function applyMallUi(){
  document.title='RetailNav | '+selectedMall.name+' · visor 3D';
  $('mallHeaderName').textContent=selectedMall.name;
  $('mallSidebarTitle').textContent=selectedMall.name;
  $('mallMobileTitle').textContent=selectedMall.name;
  $('mallMobileMeta').textContent=floors.length+' planta(s) · '+
    (selectedMall.coordinateSpace?'FUENTE OFICIAL · SIN RUTAS':'TRAZADO PROVISIONAL');
  $('mallSourceMessage').textContent=mallId==='new-world-city-shanghai'
    ?'九个楼层 L1–L9: '+(selectedMall.vectorRegionCount||0)+' regiones fotográficas candidatas y '+
       (selectedMall.commercialDirectoryRecords||0)+' registros históricos del directorio L1–L7. '+
       'Contornos y comunicaciones verticales sin validar; rutas desactivadas.'
    :mallId==='ap-plaza'
     ?'Mapa experimental AI2D v2: 197 regiones candidatas del calco visual, contrastadas parcialmente con la fotografía. Sin navegación real.'
    :mallId==='alto-palermo'
     ?'Seis planos SVG oficiales: 331 regiones extraídas, 192 contornos comerciales y 158 registros del mapa interactivo. Sólo 55 relaciones marcador-contorno son unívocas.'
     :'Geometría del mapa oficial en el visor 3D. Alturas estimadas; sin ruta peatonal verificada.';
  $('mallFloorCountLabel').textContent=floors.length===1?'planta importada':'plantas diferentes';
  document.querySelector('.intro .metric b').textContent=String(floors.length);
  const single=floors.length<=1;
  document.querySelector('.stage')?.classList.toggle('stage-single',single);
  const picker=$('floorPicker'),select=$('floorSelect'),spacing=$('floorSpacing');
  picker.hidden=single;spacing.hidden=single;
  spacing.open=false;
  select.replaceChildren();
  const options=single?floors.map(f=>({id:f.id,title:f.id})):
    [{id:'ALL',title:'Todas'},...floors.map(f=>({id:f.id,title:f.id}))];
  for(const item of options){
    const option=document.createElement('option');
    option.value=item.id;option.textContent=item.title;
    select.append(option);
  }
  select.value=single?floors[0].id:'ALL';
  select.onchange=()=>{if(select.value!=='MATCHES')setFloor(select.value);};
  $('spread').disabled=single;
  $('showAllFloors').hidden=true;
  $('showAllFloors').textContent='← Todas las plantas';
  $('original').disabled=false;
  $('original').title='Comparar foto y vectorizado de cada planta';
  $('routeBtn').disabled=!selectedMall.navigable;
  const connectorButton=$('rnConnectorsToggle');
  connectorButton.hidden=!verticalHypotheses.length;
  connectorButton.setAttribute('aria-pressed',String(verticalConnectionsOn));
  const footer=document.querySelector('.sidebarfooter');
  if(footer&&mallId==='ap-plaza'){
    footer.textContent='AP Plaza: 1 fotografía de B1; 197 polígonos candidatos trazados a partir de un calco visual IA y revisión fotográfica. Tiendas, rutas y escala sin validación física: NO APTO PARA NAVEGACIÓN REAL.';
  }else if(footer&&mallId==='new-world-city-shanghai'){
    footer.textContent='新世界城: nueve fotografías L1–L9, regiones individualizadas de manera provisional; '+
     'servicios de circulación separados y directorio histórico L1–L7 conservado. '+
     'No hay verificación de fachadas, escala ni conexión entre plantas. '+
     'NO APTO PARA NAVEGACIÓN REAL.';
  }else if(footer&&mallId==='alto-palermo'){
    footer.textContent='Alto Palermo: seis planos SVG oficiales y 158 registros del mapa interactivo. '+
     'Se muestran 331 regiones nativas y 192 contornos comerciales. Los códigos y centros de marcador se conservan tal como fueron publicados; '+
     '55 enlaces caen de forma unívoca dentro de un contorno. Las demás asociaciones, entradas, escala y rutas permanecen sin verificar. '+
     'NO APTO PARA NAVEGACIÓN REAL.';
  }
  $('mapSubtitle').textContent=mallId==='new-world-city-shanghai'
    ?''+(selectedMall.vectorRegionCount||0)+' regiones candidatas entre L1–L9 · límites pendientes de revisión. NO NAVEGABLE.'
    :mallId==='ap-plaza'
     ?''+(selectedMall.vectorRegionCount||0)+' recintos vectoriales candidatos · calco IA 2D experimental · NO APTO PARA NAVEGACIÓN.'
    :mallId==='alto-palermo'
     ?'192 contornos comerciales del SVG oficial · 55 códigos vinculados por contención única · sin rutas verificadas.'
     :'Contornos y pasillos trazados sobre tus imágenes.';
  $('mapTitle').textContent=mallId==='new-world-city-shanghai'
    ?'L1–L9 · geometrías provisionales sin escala calibrada'
    :mallId==='ap-plaza'?'B1 · calco IA v2'
    :mallId==='alto-palermo'?'Las '+floors.length+' plantas oficiales':'Las tres plantas, en su posición relativa';
}
async function init(){try{
 // Full 360-degree spherical rotation is the default (including underside).
 // Touch 360° to return to Earth-like map-pan gestures when needed.
 panMode=false;
 if(mallId==='new-world-city-shanghai'){
  // Reuse four-metre editable floor separation; the prior 26-unit gap
  // was an exploded view and made escalator rails look like ladders.
  spread=targetSpread=baseFloorMetres;
  const control=$('spread');
  control.min=String(baseFloorMetres);
  control.value=String(baseFloorMetres);
  $('spreadValue').textContent='Altura estimada';
 }
 bindUI();updateRotationModeUI();let embedded=$('modelData');data=window.RetailNavMapCache?await window.RetailNavMapCache.load():(selectedMall.floors||(embedded?JSON.parse(embedded.textContent):await fetchJSON('maps/compact.json')));floors=unpack(data);
 const roofSummary=window.RetailNavRoofText?.prepare?.(floors,selectedMall.units||[],selectedMall.pois||[],cfg.origin,cfg.scale)||null;
 initializeFloorHeights();applyMallUi();bindHeightControls();initGL();makeGrid();if(gl)routeBuffer=gl.createBuffer();for(let i=0;i<floors.length;i++){geometry(floors[i]);progress(25+(i+1)*22,'Geometría '+floors[i].id+' preparada - '+(i+1)+' de '+floors.length+' plantas');await new Promise(requestAnimationFrame);}ready=true;makeLabels();bindWayfinding();active=groundReferenceFloor();showFloorReference();
 // Keep the compact floor UI consistent with the new default user-level view.
 $('floorSpacing').hidden=floors.length<=1||active!=='ALL';
 $('showAllFloors').hidden=floors.length<=1;
 document.querySelector('.stage')?.classList.toggle('focused',active!=='ALL');
 if($('floorSelect'))$('floorSelect').value=active;
 resetCamera();results();$('unitCount').textContent=mallId==='alto-palermo'?(selectedMall.officialDirectoryRecords||0):floors.flatMap(f=>f.features).filter(f=>['unit','anchor'].includes(f.k)).length;$('mallUnitCountLabel').textContent=mallId==='alto-palermo'?'registros oficiales*':'polígonos comerciales*';$('polygonCount').textContent=floors.reduce((n,f)=>n+f.features.length,0);document.querySelectorAll('[data-runtime]').forEach(b=>b.disabled=false);
$('spread').disabled=floors.length<=1||active!=='ALL';$('fallback').hidden=true;$('loading').hidden=true;$('badge').classList.add('ready');$('status').textContent=gl?'WebGL listo':'3D compatible listo';$('renderStatus').textContent=floors.length+' plantas cargadas ('+selectedMall.name+') - render '+(gl?'WebGL':'Canvas 3D')+' - sin CDN';requestAnimationFrame((time)=>{try{render(time);requestAnimationFrame(()=>window.RetailNavMapCache?.ready?.());}catch(e){fail('Error al dibujar el mapa: '+e.message);}});window.__RETAILNAV__={getState:()=>({ready,mallId,mapCache:window.RetailNavMapCache?.getState?.(),mapTheme:window.RetailNavThemes?.getState?.(),renderer:gl?'WebGL':'Canvas 3D',active,visible:visible().map(f=>f.id),target:target.slice(),distance,q:q.slice(),spread,wire,scan,auto,placingPosition,selected:selected?.id,route:route?.points.length||0,frames:frame,errors:errors.slice(),features:floors.map(f=>[f.id,f.features.length]),
 floorHeightsMetres:{...floorHeightMetres},
 floorElevationsMetres:Object.fromEntries(floors.map(f=>[f.id,f.elevationMetres])),
 heightEstimatesVerified:Boolean(heightConfig.metresVerified),
 verticalDisplayExaggeration:spread/baseFloorMetres,
 verticalConnectorCount:verticalHypotheses.length,
 verticalConnectionsVisible:verticalConnectionsOn,
 escalatorRenderStats:escalatorModel().stats,
 escalatorFixtureCount:(selectedMall.escalatorFixtures||[]).length,
 roofTextSummary:roofSummary,
 liftShaftStats:liftShaftModel().stats,
 liftShaftCandidateCount:(selectedMall.verticalShaftCandidates||[]).length,
 searchFloorIDs:searchFloorSet?[...searchFloorSet]:null,
  committedSearch:searchCommitted,highlightedVectorCount:searchMatchedVectors.size,
  focusedStoreId,focusedStoreVector,focusedStoreVectors:[...focusedStoreVectors],focusFloorId,coordinateSpace:selectedMall.coordinateSpace||'mall-photo-pixels',
  wayfinding:wayfinding&&JSON.parse(JSON.stringify(wayfinding)),wayfindingOpen,wayfindingCompact,
  cameraFlying:Boolean(cameraFlight),lastStoreFocus:lastStoreFocus&&{...lastStoreFocus},
  referenceFloor:visitorFloorReference(),
  searchPlacement:$('rnMapSearch')?.closest('.topbar')?'topbar':'map-top',headerMallName:$('mallHeaderName').textContent,zoomMin:MIN_ZOOM_DISTANCE,zoomMax:MAX_ZOOM_DISTANCE,nativeGestureDirections:true,gestureMode:panMode?'map-pan':'orbit-3d',gestureProfile:'adaptive-google-earth-v2',inputProfile,safariTrackpadGestures:true,earth2D,compassReference:'photo-top-only-not-calibrated-true-north',trackball360:!panMode,
 cameraQuaternion:q.slice(),cameraUp:qr(q,[0,1,0]),
 orbitYaw,orbitPitch,orbitRoll,rotationAxes:panMode?2:3}),floors,project:(f,p)=>{let floor=floors.find(x=>x.id===f);return floor?screen(pos(p,floor.y+2)):null;},viewportWidth:()=>canvas.clientWidth,pinWorld:(floorId,x,y)=>{const f=floors.find(f=>f.id===floorId);return f?pos([x,y],f.y):null;},projectWorld:p=>screen(p),setFloor,select,editFloorHeight,
  showSearchMatches:applySearchFloors,clearSearchMatches:clearSearchFloors,
  focusCatalogStore,openStoreAssistance,closeStoreAssistance,
 getVerticalConnections:verticalConnectionInfo,
 getEscalatorModels:()=>escalatorModel().items.slice(),
 getLiftShaftModels:()=>liftShaftModel().shafts.slice(),
 exportGLB,invalidate:()=>{dirty=true;},focusAt:(id,p,desiredDistance=110)=>{if(!searchFloorSet||!searchFloorSet.has(id))setFloor(id);let floor=floors.find(f=>f.id===id);if(floor){target=pos(p,floor.y);distance=clamp(desiredDistance,30,550);dirty=true;}},beginManualLocation:(localOnly=false)=>{if(wayfindingOpen&&wayfinding&&!wayfindingCompact){beginWayfindingLocation();return;}placingLocalOnly=Boolean(localOnly);placingPosition=true;canvas.classList.add('placing');notify('Elegí la planta y tocá el lugar donde estás. Es una ubicación manual, no GPS.');}};window.dispatchEvent(new Event('retailnav:ready'));}catch(e){fail('No se pudo abrir el visor 3D: '+e.message);}}
// Theme preview re-colors loaded mesh buffers without redownloading geometry.
let pendingThemeRefresh=false;
let lastRoofFont=window.RetailNavThemes?.getState?.().theme.font||'modern';
function recolorRoofText(){
 const ink=mapRgb('mapText',[.94,.98,1]);
 const titles=mapRgb('mapNameText',[1,.88,.56]);
 const edge=[.20,.32,.39];
 for(const floor of floors){
  for(const [kind,target] of [['codes',ink],['frontCodes',ink],['names',titles],['frontNames',titles]]){
   const verts=floor.roofText?.[kind];
   if(!verts)continue;
   for(let i=0;i<verts.length;i+=10){
    // Extruded top face and lateral prisms already have reliable normals.
    const color=verts[i+4]>.9?target:edge;
    verts[i+6]=color[0];verts[i+7]=color[1];verts[i+8]=color[2];
   }
  }
 }
}
function onThemeChange(){
 if(!ready||pendingThemeRefresh)return;
 pendingThemeRefresh=true;
 requestAnimationFrame(()=>{
  pendingThemeRefresh=false;
  try{
   if(gl){
    for(const floor of floors){
     for(const item of Object.values(floor.gpu||{}))if(item?.b)gl.deleteBuffer(item.b);
     for(const item of Object.values(floor.roofGpu||{}))if(item?.b)gl.deleteBuffer(item.b);
    }
    const currentRoofFont=window.RetailNavThemes?.getState?.().theme.font||'modern';
    if(currentRoofFont!==lastRoofFont){
     // Rebuild roof lettering when its preview preset changes. Alto Palermo
     // always keeps its licensed vector-outline mesh; it never rasterizes.
     window.RetailNavRoofText?.prepare?.(floors,selectedMall.units||[],
      selectedMall.pois||[],cfg.origin,cfg.scale);
     lastRoofFont=currentRoofFont;
    }
    recolorRoofText();
    makeGrid();
    gl.useProgram(program);
    gl.uniform3fv(loc.uSelectedColor,new Float32Array(mapRgb('mapSelected',[1,.68,.29])));
    for(const floor of floors)geometry(floor);
   }
   dirty=true;
  }catch(e){console.warn('RetailNav map recoloring:',e);}
 });
}
window.addEventListener('retailnav:themechange',onThemeChange);
init();
})();
