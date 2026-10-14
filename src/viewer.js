'use strict';
/* RetailNav: dependency-free WebGL geometry viewer. All floor outlines come from the supplied raster plans. */
(()=>{
const $=id=>document.getElementById(id), K=['anchor','unit','zone','corridor','void','slab'];
let data, floors=[], gl, ctx2d=null, program, loc, canvas=$('canvas'), frame=0, lastTime=0, mvp, invMvp, toastTimer, ready=false;
let dirty=true;
let active='ALL', wire=false, scan=false, auto=false, panMode=true, labelsOn=true, originalLevel='UL', selected=null, route=null, routeRunning=false, routeT=0;
let spread=26, targetSpread=26, target=[0,26,0], distance=215, q=[0,0,0,1];
let orbitYaw=-.30,orbitPitch=-.70,orbitRoll=0;
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
 button.setAttribute('aria-pressed',String(panMode));
 button.setAttribute('aria-label',panMode?'Activar rotación esférica 3D 360 grados':'Cambiar a desplazamiento de mapa');
 button.title=panMode?'Activar giro 3D 360°: mirar desde cualquier dirección'
  :'Giro esférico activo · tocar para desplazar el mapa';
 button.classList.toggle('active',!panMode);
 $('rnRollControls').hidden=panMode;
 canvas.setAttribute('aria-label',panMode
  ?'Modo mapa: un dedo mueve; dos dedos amplían, giran e inclinan. Pulsá 360° para rotación libre.'
  :'Modo esfera 3D 360°: un dedo gira libremente por los tres ejes, también por debajo. Dos dedos desplazan, amplían y giran.');
}
const selectedMall=window.RETAILNAV_ACTIVE_MALL||{id:'aventura',name:'Aventura Mall',floors:null,origin:[690,405],scale:.15};
const mallId=selectedMall.id||'aventura';
const cfg={origin:selectedMall.origin||[690,405],scale:selectedMall.scale||.15}; const errors=[];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)), vadd=(a,b)=>a.map((v,i)=>v+b[i]), vsub=(a,b)=>a.map((v,i)=>v-b[i]), vmul=(a,s)=>a.map(x=>x*s), dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0), cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]], norm=a=>vmul(a,1/(Math.hypot(...a)||1));
function quat(axis,a){let s=Math.sin(a/2);return [...vmul(axis,s),Math.cos(a/2)];}
function qm(a,b){return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];}
function qr(q,v){let t=vmul(cross(q.slice(0,3),v),2);return vadd(vadd(v,vmul(t,q[3])),cross(q.slice(0,3),t));}
function mm(a,b){let r=new Float32Array(16);for(let c=0;c<4;c++)for(let i=0;i<4;i++)for(let k=0;k<4;k++)r[c*4+i]+=a[k*4+i]*b[c*4+k];return r;}
function mp(m,v){return [0,1,2,3].map(i=>m[i]*v[0]+m[4+i]*v[1]+m[8+i]*v[2]+m[12+i]*v[3]);}
function inverse(m){let a=Array.from({length:4},(_,r)=>[m[r],m[4+r],m[8+r],m[12+r],...Array.from({length:4},(_,c)=>+(c===r))]);for(let c=0;c<4;c++){let r=c;for(let j=c+1;j<4;j++)if(Math.abs(a[j][c])>Math.abs(a[r][c]))r=j;[a[c],a[r]]=[a[r],a[c]];let p=a[c][c];if(Math.abs(p)<1e-10)return null;a[c]=a[c].map(x=>x/p);for(let j=0;j<4;j++)if(j!==c){let f=a[j][c];a[j]=a[j].map((x,k)=>x-f*a[c][k]);}}return new Float32Array(Array.from({length:16},(_,i)=>a[i%4][4+Math.floor(i/4)]));}
function matrices(){let eye=vadd(target,qr(q,[0,0,distance])),z=norm(vsub(eye,target)),x=norm(cross(qr(q,[0,1,0]),z)),y=cross(z,x);let view=new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);let f=1/Math.tan(Math.PI/8),ar=canvas.width/canvas.height,n=.2,far=1800;let p=new Float32Array([f/ar,0,0,0,0,f,0,0,0,0,(far+n)/(n-far),-1,0,0,2*far*n/(n-far),0]);mvp=mm(p,view);invMvp=inverse(mvp);}
function pos(p,y=0){return [(p[0]-cfg.origin[0])*cfg.scale,y,(p[1]-cfg.origin[1])*cfg.scale];}
function height(f){return {anchor:2.2,unit:1.4,zone:.55,corridor:.08,slab:-.12,void:.03}[f.k];}
function unpack(raw){let gid=1;return raw.map((v,i)=>{let features=v[3].map(a=>{let x=0,y=0,p=[];for(let j=0;j<a[3].length;j+=2){x+=a[3][j];y+=a[3][j+1];p.push([x/2,y/2]);}return {id:a[0],k:K[a[1]],n:a[2],p,r:a[4].map(r=>r.map(n=>p[n])),t:a[5],c:a[6],gid:gid++,floor:v[0]};});let w=v[4];w.bytes=Uint8Array.from(atob(w.bits),x=>x.charCodeAt(0));return {id:v[0],name:v[1],source:v[2],features,index:i,walk:w,y:i*spread};});}
function palette(f,i,line){let cols={anchor:[.24,.36,.48],unit:[.24,.40,.48],zone:[.17,.29,.36],corridor:[.10,.43,.47],slab:[.08,.15,.22],void:[.26,.22,.37]};let c=cols[f.k].slice();if(i===1)c=[c[0]*.85,c[1]*.92,c[2]*1.20];if(i===2)c=[c[0]*1.26,c[1]*.92,c[2]*1.16];if(line){c=f.k==='corridor'?[.25,.73,.75]:f.k==='anchor'?[.57,.77,.89]:f.k==='slab'?[.19,.37,.48]:f.k==='void'?[.5,.38,.63]:[.35,.70,.74];if(i===1)c=[c[0],c[1]*.93,Math.min(1,c[2]*1.18)];if(i===2)c=[c[0]*1.5,c[1]*.88,Math.min(1,c[2]*1.17)];}return c;}
function geometry(floor){let faces=[],edges=[],points=[];const emit=(arr,p,n,c,id)=>arr.push(...p,...n,...c,id);for(const f of floor.features){let h=height(f),col=palette(f,floor.index,false),edgeCol=palette(f,floor.index,true);f.flat=[];function tri(a,b,c,n){[a,b,c].forEach(p=>{emit(faces,p,n,col,f.gid);f.flat.push(...p,...n);});}
if(f.k!=='void'){for(let i=0;i<f.t.length;i+=3){let a=pos(f.p[f.t[i]],h),b=pos(f.p[f.t[i+1]],h),c=pos(f.p[f.t[i+2]],h);if(cross(vsub(b,a),vsub(c,a))[1]<0)[b,c]=[c,b];tri(a,b,c,[0,1,0]);}}
for(const ring of f.r){for(let j=0;j<ring.length;j++){let a=pos(ring[j],h),b=pos(ring[(j+1)%ring.length],h);emit(edges,a,[0,0,0],edgeCol,f.gid);emit(edges,b,[0,0,0],edgeCol,f.gid);emit(points,a,[0,0,0],edgeCol,f.gid);if(['anchor','unit','zone','slab'].includes(f.k)){let bottom=f.k==='slab'?-.55:0,aa=[a[0],bottom,a[2]],bb=[b[0],bottom,b[2]],normal=norm([b[2]-a[2],0,a[0]-b[0]]);tri(aa,bb,b,normal);tri(aa,b,a,normal);if(Math.hypot(a[0]-b[0],a[2]-b[2])>1.1){emit(edges,aa,[0,0,0],vmul(edgeCol,.65),f.gid);emit(edges,a,[0,0,0],vmul(edgeCol,.65),f.gid);}}}}
f.flat=new Float32Array(f.flat);}
function buffer(arr){let b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(arr),gl.STATIC_DRAW);return {b,n:arr.length/10};}if(gl)floor.gpu={faces:buffer(faces),edges:buffer(edges),points:buffer(points)};}
function shader(type,src){let s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
function initGL(){gl=canvas.getContext('webgl',{antialias:true,alpha:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});if(!gl){ctx2d=canvas.getContext('2d',{alpha:true});if(!ctx2d)throw new Error('El navegador no permite dibujar el mapa interactivo.');return;}program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,`attribute vec3 aPos;attribute vec3 aNormal;attribute vec3 aColor;attribute float aId;uniform mat4 uMvp;uniform float uY;uniform float uPoint;varying vec3 vNormal;varying vec3 vColor;varying float vId;void main(){vec3 p=aPos;p.y+=uY;gl_Position=uMvp*vec4(p,1.);gl_PointSize=uPoint;vNormal=aNormal;vColor=aColor;vId=aId;}`));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`precision mediump float;varying vec3 vNormal;varying vec3 vColor;varying float vId;uniform float uSelected;uniform float uLine;uniform float uWire;void main(){bool sel=abs(vId-uSelected)<.1;vec3 c=sel?vec3(1.,.68,.29):vColor;float light=.58+.42*abs(dot(normalize(vNormal+vec3(.0001)),normalize(vec3(-.4,.8,.3))));if(uLine>.5)light=1.;if(uWire>.5&&uLine<.5)c*=.32;gl_FragColor=vec4(c*light,1.);}`));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);loc={};['aPos','aNormal','aColor','aId'].forEach(x=>loc[x]=gl.getAttribLocation(program,x));['uMvp','uY','uPoint','uSelected','uLine','uWire'].forEach(x=>loc[x]=gl.getUniformLocation(program,x));gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();fail('El sistema suspendio el renderizador 3D. Recarga la pagina para recuperarlo.');});}
function bind(g){gl.bindBuffer(gl.ARRAY_BUFFER,g.b);let names=['aPos','aNormal','aColor','aId'],sizes=[3,3,3,1],offs=[0,12,24,36];names.forEach((n,i)=>{gl.enableVertexAttribArray(loc[n]);gl.vertexAttribPointer(loc[n],sizes[i],gl.FLOAT,false,40,offs[i]);});}
let grid;
function makeGrid(){if(!gl)return;let a=[];for(let n=-85;n<=85;n+=5){for(let p of [[n,-.9,-70],[n,-.9,70],[-85,-.9,n],[85,-.9,n]])a.push(...p,0,0,0,.065,.13,.19,-2);}let b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(a),gl.STATIC_DRAW);grid={b,n:a.length/10};}
function resize(){let r=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);let w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;if(gl)gl.viewport(0,0,w,h);} }
function visible(){return floors.filter(f=>active==='ALL'||f.id===active);}
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
function updateLabels(){let rect=canvas.getBoundingClientRect();for(let o of labelElems){let p=o.p.slice();p[1]+=o.floor.y;let s=screen(p),show=(active==='ALL'||active===o.floor.id)&&(labelsOn||o.always||selected===o.f)&&s.w>0&&s.z<1&&(o.always||(s.x>25&&s.x<rect.width-20))&&s.y>95&&s.y<rect.height-110;if(!o.always&&active==='ALL'&&selected!==o.f)show=false;o.el.hidden=!show;if(show){o.el.style.left=(o.always?clamp(s.x,48,rect.width-48):s.x)+'px';o.el.style.top=s.y+'px';o.el.classList.toggle('selected',selected===o.f);}}}
let routeBuffer;
function drawRoute(dt){if(!route)return;let floor=floors.find(f=>f.id===route.floor);if(active!=='ALL'&&active!==floor.id)return;if(routeRunning)routeT=(routeT+dt*.14)%1;let arr=[];route.points.forEach(p=>arr.push(...pos(p,.2),0,0,0,1,.65,.23,-3));gl.uniform1f(loc.uY,floor.y);gl.uniform1f(loc.uLine,1);gl.bindBuffer(gl.ARRAY_BUFFER,routeBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(arr),gl.DYNAMIC_DRAW);bind({b:routeBuffer});gl.drawArrays(gl.LINE_STRIP,0,arr.length/10);let lens=[0];for(let i=1;i<route.points.length;i++)lens.push(lens[i-1]+Math.hypot(...vsub(route.points[i],route.points[i-1])));let t=(lens.at(-1)||1)*routeT,i=1;while(i<lens.length-1&&lens[i]<t)i++;let a=route.points[i-1],b=route.points[i]||a,k=(t-lens[i-1])/(lens[i]-lens[i-1]||1);let p=[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k];gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([...pos(p,.8),0,0,0,1,.83,.43,-3]),gl.DYNAMIC_DRAW);gl.uniform1f(loc.uPoint,Math.min(devicePixelRatio,2)*10);gl.drawArrays(gl.POINTS,0,1);}
function render(time){if(!ready)return;if(document.querySelector('dialog[open]')||(!dirty&&!auto&&!routeRunning&&Math.abs(spread-targetSpread)<.01)){lastTime=time;requestAnimationFrame(render);return;}dirty=false;let dt=Math.min(.05,(time-lastTime)/1000||0);lastTime=time;frame++;resize();let diff=targetSpread-spread;spread+=diff*Math.min(1,dt*8);floors.forEach(f=>f.y=f.index*spread);if(auto){if(panMode){orbitYaw+=dt*.18;updateCameraRotation();}
 else rotateCameraLocal([0,1,0],dt*.18);}matrices();if(!gl){renderCanvas(dt);updateLabels();window.RetailNavPins?.draw?.();window.RetailNavPOI?.draw?.();window.RetailNavUnits?.draw?.();window.RetailNavIndoor?.draw?.();window.RetailNavAreaLabels?.draw?.();requestAnimationFrame(render);return;}gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);gl.uniformMatrix4fv(loc.uMvp,false,mvp);gl.uniform1f(loc.uSelected,selected?selected.gid:-1);gl.uniform1f(loc.uWire,wire?1:0);gl.uniform1f(loc.uPoint,Math.min(devicePixelRatio,2)*2.5);gl.uniform1f(loc.uY,0);gl.uniform1f(loc.uLine,1);bind(grid);gl.drawArrays(gl.LINES,0,grid.n);for(let floor of visible()){gl.uniform1f(loc.uY,floor.y);if(!scan){gl.uniform1f(loc.uLine,0);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);bind(floor.gpu.faces);gl.drawArrays(gl.TRIANGLES,0,floor.gpu.faces.n);gl.disable(gl.POLYGON_OFFSET_FILL);gl.uniform1f(loc.uLine,1);bind(floor.gpu.edges);gl.drawArrays(gl.LINES,0,floor.gpu.edges.n);}else{gl.uniform1f(loc.uLine,1);bind(floor.gpu.points);gl.drawArrays(gl.POINTS,0,floor.gpu.points.n);}}
drawRoute(dt);window.RetailNavDistricts?.draw3D?.(gl,mvp);
window.RetailNavAreaLabels?.draw?.();window.RetailNavPins?.draw3D?.(gl,mvp);
window.RetailNavUnits?.draw3D?.(gl,mvp);updateLabels();window.RetailNavPins?.draw?.();window.RetailNavPOI?.draw?.();window.RetailNavUnits?.draw?.();window.RetailNavIndoor?.draw?.();requestAnimationFrame(render);}

// Canvas 3D engine: genuine perspective projection of the same extruded polygon
// geometry. Used when WebGL is blocked by an in-app preview or GPU policy.
// This is not a static SVG, and all camera gestures remain active.
function renderCanvas(dt){
 const c=ctx2d,rect=canvas.getBoundingClientRect();if(!c)return;
 const dpr=canvas.width/Math.max(1,rect.width),w=rect.width,h=rect.height;
 c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
 function xyz(q){const a=screen(q);return a.w>.02?a:null;}
 const colors={slab:'#183044',corridor:'#18747b',anchor:'#355d82',unit:'#355565',zone:'#34516a',void:'#1e283c'};
 const lines={slab:'#4894a4',corridor:'#45d4d6',anchor:'#96c2db',unit:'#70b8c6',zone:'#648fa2',void:'#a488ae'};
 // Grid stays anchored to the model rather than to screen pixels.
 c.lineWidth=.6;c.strokeStyle='rgba(68,142,168,.14)';c.beginPath();
 for(let n=-80;n<=80;n+=8){let a=xyz([n,-.9,-65]),b=xyz([n,-.9,65]),d=xyz([-85,-.9,n]),e=xyz([85,-.9,n]);if(a&&b){c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);}if(d&&e){c.moveTo(d.x,d.y);c.lineTo(e.x,e.y);}}
 c.stroke();
 // Far-to-near ordering, retaining holes and the disconnected L3 islands.
 const candidates=[];
 for(const floor of visible()){
  for(const f of floor.features){
   const cp=xyz(pos(f.c,floor.y+height(f)));
   if(cp)candidates.push({floor,f,z:cp.z});
  }
 }
 candidates.sort((a,b)=>b.z-a.z || ({slab:0,corridor:1,void:2,zone:3,unit:4,anchor:5}[a.f.k]-{slab:0,corridor:1,void:2,zone:3,unit:4,anchor:5}[b.f.k]));
 const pth=(ring,y)=>{let ok=0;for(let j=0;j<ring.length;j++){let p=xyz(pos(ring[j],y));if(!p)continue; if(ok===0)c.moveTo(p.x,p.y);else c.lineTo(p.x,p.y);ok++;}if(ok)c.closePath();return ok>=3;};
 for(const {floor,f} of candidates){
  const fh=height(f),fy=floor.y,top=fy+fh,isSelected=selected&&selected.gid===f.gid;
  if(scan){c.fillStyle=isSelected?'#ffc977':'#6ce2e2';c.globalAlpha=.8;for(const r of f.r)for(let j=0;j<r.length;j+=2){let pt=xyz(pos(r[j],top));if(!pt)continue;c.beginPath();c.arc(pt.x,pt.y,Math.max(.7,1.3*(215/distance)),0,Math.PI*2);c.fill();}c.globalAlpha=1;continue;}
  let color=isSelected?'#ab7133':colors[f.k],line=isSelected?'#ffd17a':lines[f.k];
  if(['anchor','unit','zone','slab'].includes(f.k)){
   c.fillStyle=isSelected?'rgba(165,99,40,.72)':'rgba(25,65,85,.67)';
   for(const r of f.r)for(let i=0;i<r.length;i++){
    const aa=xyz(pos(r[i],fy+(f.k==='slab'?-.45:0))),ab=xyz(pos(r[(i+1)%r.length],fy+(f.k==='slab'?-.45:0))),ba=xyz(pos(r[(i+1)%r.length],top)),bb=xyz(pos(r[i],top));
    if(!aa||!ab||!ba||!bb)continue;
    c.beginPath();c.moveTo(aa.x,aa.y);c.lineTo(ab.x,ab.y);c.lineTo(ba.x,ba.y);c.lineTo(bb.x,bb.y);c.closePath();c.fill();
   }
  }
  c.beginPath();let any=false;for(const r of f.r)any=pth(r,top)||any;
  if(!any)continue;
  c.fillStyle=color;c.globalAlpha=f.k==='slab'?.92:f.k==='corridor'?.60:wire?.16:f.k==='void'?.42:.87;c.fill('evenodd');c.globalAlpha=1;
  c.strokeStyle=line;c.lineWidth=isSelected?2.2:f.k==='corridor'?1.2:f.k==='slab'?1.2:.9;
  if(isSelected){c.shadowColor='#ffc672';c.shadowBlur=13;}else if(f.k==='corridor'){c.shadowColor='#25c6c9';c.shadowBlur=2;}
  c.stroke();c.shadowBlur=0;
 }
 if(route&&visible().some(x=>x.id===route.floor)){
  const floor=floors.find(x=>x.id===route.floor),pts=route.points.map(p=>xyz(pos(p,floor.y+.5))).filter(Boolean);
  if(pts.length>1){c.lineWidth=3;c.strokeStyle='#ffd06c';c.shadowBlur=8;c.shadowColor='#ffc462';c.setLineDash([8,5]);c.beginPath();pts.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.stroke();c.setLineDash([]);c.shadowBlur=0;
   if(routeRunning)routeT=(routeT+dt*.14)%1;
   const s=routeT*(pts.length-1),i=Math.min(pts.length-2,Math.floor(s)),t=s-i;
   const u={x:pts[i].x*(1-t)+pts[i+1].x*t,y:pts[i].y*(1-t)+pts[i+1].y*t};
   c.fillStyle='#ffbf5a';c.beginPath();c.arc(u.x,u.y,5,0,Math.PI*2);c.fill();
  }
 }
}

function stopAuto(){auto=false;$('auto').setAttribute('aria-pressed','false');}
function resetCamera(plan=false){
 stopAuto();orbitYaw=plan?0:-.30;orbitPitch=plan?MIN_PITCH:-.70;orbitRoll=0;updateCameraRotation();
 let fs=visible();target=[0,active==='ALL'?(floors.length===1?0:(floors.length-1)*spread/2):fs[0].y,0];distance=200;
 resize();matrices();let mx=0,my=0;
 for(const f of fs)for(const o of f.features)for(const v of o.p){
  const p=mp(mvp,[...pos(v,f.y),1]);if(p[3]<=0)continue;
  mx=Math.max(mx,Math.abs(p[0]/p[3]));my=Math.max(my,Math.abs(p[1]/p[3]));
 }
 distance=clamp(distance*Math.max(mx/.86,my/.65),90,550);
 $('plan').setAttribute('aria-pressed',String(plan));dirty=true;
}
function setFloor(id){
 if(!ready)return;
 if(floors.length===1)id=floors[0].id;
 if(id!=='ALL'&&!floors.some(f=>f.id===id))return;
 active=id;
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
  :(id==='L3'?'Sectores discontinuos conservados del tercer plano.':
    'Contornos y pasillos trazados sobre tus imágenes.');
 resetCamera();results();
}
function contains(p,ring){let v=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){let a=ring[i],b=ring[j];if(((a[1]>p[1])!==(b[1]>p[1]))&&(p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]))v=!v;}return v;}
function pick(x,y){if(!invMvp)return;let r=canvas.getBoundingClientRect(),nx=(x-r.left)/r.width*2-1,ny=1-(y-r.top)/r.height*2;let un=z=>{let v=mp(invMvp,[nx,ny,z,1]);return v.slice(0,3).map(x=>x/v[3]);};let a=un(-1),b=un(1),dir=norm(vsub(b,a)),best=null,dist=Infinity;for(let floor of visible()){for(let f of floor.features.filter(f=>['unit','anchor','zone'].includes(f.k))){let t=(floor.y+height(f)-a[1])/dir[1];if(!Number.isFinite(t)||t<0||t>dist)continue;let pt=vadd(a,vmul(dir,t)),p=[pt[0]/cfg.scale+cfg.origin[0],pt[2]/cfg.scale+cfg.origin[1]];if(contains(p,f.r[0])&&!f.r.slice(1).some(h=>contains(p,h))){best=f;dist=t;}}}if(best)select(best);}
function select(f){selected=f;route=null;routeRunning=false;$('rnMapSearch').classList.remove('finding');$('search').blur();$('detail').hidden=false;$('detailLevel').textContent=f.floor+' / '+({'anchor':'Ancla identificada en el plano','unit':'Unidad sin nombre verificado','zone':'Area por identificar'}[f.k]||'Poligono trazado');$('detailName').textContent=f.n||f.id;$('detailId').textContent='ID '+f.id+' - geometria provisional; altura simulada';$('routeInfo').textContent='';results();}
function clearSelection(){selected=null;route=null;routeRunning=false;$('detail').hidden=true;results();}
function results(){if(!ready)return;let q=$('search').value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();window.RetailNavUnits?.setQuery?.(q);let list=floors.flatMap(fl=>fl.features).filter(f=>['anchor','unit','zone'].includes(f.k)&&(active==='ALL'||f.floor===active));if(q)list=list.filter(f=>(f.n+' '+f.id).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(q));else list=list.filter(f=>f.k==='anchor');let host=$('results');host.replaceChildren();list.slice(0,35).forEach(f=>{let b=document.createElement('button');b.className='result'+(selected===f?' active':'');let badge=document.createElement('span');badge.className='levelbadge';badge.textContent=f.floor;let text=document.createElement('span');text.textContent=f.n||f.id;let sub=document.createElement('span');sub.className='small';sub.textContent=f.k==='anchor'?'Referencia del plano':'Nombre no identificado';text.append(sub);b.append(badge,text);b.onclick=()=>select(f);host.append(b);});let pois=(selectedMall.pois||[]).filter(p=>active==='ALL'||p.floor===active);
if(q){const matcher=window.RetailNavPOI?.find;pois=matcher?matcher(q).filter(p=>active==='ALL'||p.floor===active):[];}
else pois=pois.filter(p=>['toilet','elevator','information','metro','exit'].includes(p.category));
for(const p of pois.slice(0,22)){
  const b=document.createElement('button');b.className='result rnPoiResult';
  const badge=document.createElement('span');badge.className='levelbadge';badge.textContent=p.floor;
  const info=document.createElement('span');info.textContent=p.name;
  const sub=document.createElement('span');sub.className='small';
  sub.textContent=p.confidence==='cartel'?'Servicio indicado en el cartel':'Posición o tipo sin verificar';
  info.append(sub);b.append(badge,info);b.onclick=()=>window.RetailNavPOI?.show?.(p.id);
  host.append(b);
}
const districtMatches=q?window.RetailNavDistricts?.find?.(q).filter(d=>active==='ALL'||d.floor===active)||[]:[];
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
const shopIds=q?window.RetailNavUnits?.find?.(q).filter(u=>active==='ALL'||u.floor===active)||[]:[];
for(const unit of shopIds.slice(0,36)){
  const b=document.createElement('button');b.className='result rnUnitResult';
  const badge=document.createElement('span');badge.className='levelbadge';badge.textContent=unit.floor;
  const info=document.createElement('span');info.textContent=unit.code+(unit.name?' · '+unit.name:'');
  const note=document.createElement('span');note.className='small';
  note.textContent=[unit.category||'Categoría pendiente',
   unit.polygonId?'Región provisional':'Ubicación por verificar'
  ].join(' · ');
  b.title=[unit.code,unit.name,unit.category,unit.tags].filter(Boolean).join(' · ');
  info.append(note);b.append(badge,info);
  b.onclick=()=>window.RetailNavUnits?.focus?.(unit.code);
  host.append(b);
}
if(!host.children.length){let p=document.createElement('p');p.textContent='Sin coincidencias en esta planta. Proba "Todos".';host.append(p);}
$('resultCount').textContent=q?(list.length+pois.length+shopIds.length+districtMatches.length)+' coincidencias':
  (mallId==='ap-plaza'||mallId==='new-world-city-shanghai'
    ?'Directorio fotográfico y sectores provisionales: ubicación de cada tienda pendiente de validación'
    :'Tiendas ancla legibles en las imágenes');}
function notify(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5200);}
function fail(message){errors.push(message);$('fallback').hidden=false;$('fallbackMessage').textContent=message;$('loading').hidden=true;$('status').textContent='Vista de respaldo';$('badge').classList.remove('ready');ready=false;document.querySelectorAll('[data-runtime]').forEach(b=>b.disabled=true);}
function progress(n,message){$('loading').hidden=false;$('progress').value=n;$('loadText').textContent=message;}
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
const pointers=new Map();
let gesture=null,lastTap=null;
function beginGesture(){
 const p=[...pointers.values()];
 const center=p.length>=2?[(p[0].x+p[1].x)/2,(p[0].y+p[1].y)/2]:
  p.length?[p[0].x,p[0].y]:null;
 matrices();
 gesture={target:target.slice(),distance,yaw:orbitYaw,pitch:orbitPitch,roll:orbitRoll,
  orientation:q.slice(),p:p.map(point=>({...point})),
  anchor:center?worldPointAt(center[0],center[1],target[1]):null};
}
canvas.addEventListener('pointerdown',e=>{
 if(!ready)return;stopAuto();canvas.focus();
 try{canvas.setPointerCapture(e.pointerId);}catch{}
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
  button:e.button,shift:e.shiftKey,moved:false,
  hadMultitouch:pointers.size>0});
 beginGesture();
 if(gesture)gesture.doubleTapHold=Boolean(doubleTapCandidate);
 canvas.classList.add('dragging');dirty=true;
});
canvas.addEventListener('pointermove',e=>{
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
   const tilting=Math.abs(dy)>9&&Math.abs(dy)>Math.abs(dx)*1.25
    &&Math.abs(d/dd-1)<.13&&Math.abs(angle)<.10;
   // iPhone Maps: two fingers up increases the incline without inversion.
   orbitPitch=clamp(gesture.pitch-(tilting?dy*.0045:0),MIN_PITCH,MAX_PITCH);
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
 if(p&&!p.hadMultitouch&&pointers.size===1&&!p.moved
  &&Math.hypot(p.x-p.startX,p.y-p.startY)<7&&p.button===0){
  const now=performance.now();
  const doubleTap=lastTap&&now-lastTap.at<320&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<32;
  if(doubleTap){
   zoomAt(distance*.70,e.clientX,e.clientY);lastTap=null;
  }else{
   lastTap={x:e.clientX,y:e.clientY,at:now};
   if(placingPosition){
    const at=manualMapPoint(e.clientX,e.clientY);
    if(at){placingPosition=false;canvas.classList.remove('placing');
     window.dispatchEvent(new CustomEvent('retailnav:map-point',{detail:at}));
     notify('Posición aproximada marcada en '+at.floor+'.');
    }else notify('Tocá un punto dentro de la planta para indicar tu ubicación.');
   }else pick(e.clientX,e.clientY);
  }
 }
 pointers.delete(e.pointerId);beginGesture();
 if(!pointers.size)canvas.classList.remove('dragging');
 dirty=true;
}
canvas.addEventListener('pointerup',endPointer);
canvas.addEventListener('pointercancel',e=>{
 pointers.delete(e.pointerId);beginGesture();
 if(!pointers.size)canvas.classList.remove('dragging');dirty=true;
});
canvas.addEventListener('lostpointercapture',e=>{
 if(pointers.has(e.pointerId)){pointers.delete(e.pointerId);beginGesture();dirty=true;}
});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('wheel',e=>{
 if(!ready)return;e.preventDefault();stopAuto();
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
 if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','+','=','-','0','[',']','q','e','PageUp','PageDown'].includes(key))e.preventDefault();
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
 if(key==='0')resetCamera();
 dirty=true;
});
// Same-floor demo pathfinding. Gray corridors only; no unverified vertical connectors or shop entrances.
function findRoute(){if(!selected)return;if(mallId!=='aventura'){notify('Rutas deshabilitadas: los pasillos de este plano fotográfico no están verificados.');return;}let f=floors.find(f=>f.id===selected.floor),w=f.walk,N=w.w*w.h;const open=i=>i>=0&&i<N&&((w.bytes[i>>3]>>(i&7))&1),coord=i=>[w.x+(i%w.w)*w.step,w.y+Math.floor(i/w.w)*w.step];let cells=[];for(let i=0;i<N;i++)if(open(i))cells.push(i);if(!cells.length)return notify('Este sector no contiene un pasillo legible para trazar una ruta.');let origin=[624,401],goal=selected.c;let nearest=p=>cells.reduce((a,b)=>Math.hypot(...vsub(coord(b),p))<Math.hypot(...vsub(coord(a),p))?b:a,cells[0]);let start=nearest(origin),end=nearest(goal),queue=[start],prev=new Int32Array(N).fill(-1);prev[start]=start;for(let h=0;h<queue.length&&prev[end]<0;h++){let i=queue[h];for(let j of [i-1,i+1,i-w.w,i+w.w])if(open(j)&&prev[j]<0&&(Math.abs(j-i)!==1||Math.floor(j/w.w)===Math.floor(i/w.w))){prev[j]=i;queue.push(j);}}if(prev[end]<0){$('routeInfo').textContent='No hay continuidad demostrable entre estos sectores en el trazado. No se dibuja una ruta a traves de locales.';return;}let path=[end];while(path.at(-1)!==start)path.push(prev[path.at(-1)]);path.reverse();if(path.length<2){$('routeInfo').textContent='El punto de demostracion ya esta junto a este sector.';return;}let pts=path.map(coord).filter((p,i,a)=>i===0||i===a.length-1||(a[i-1][0]!==a[i+1][0]&&a[i-1][1]!==a[i+1][1]));if(active!==selected.floor){let saved=selected;setFloor(saved.floor);selected=saved;}route={floor:f.id,points:pts};routeRunning=true;routeT=0;$('routeInfo').textContent='Recorrido de prueba sobre pasillos trazados. Origen ficticio; termina cerca del local, no en una puerta verificada. Sin instrucciones para uso real.';notify('La animacion recorre exclusivamente la circulacion del plano.');}
// Per-floor source-photo QA: do not treat the traced SVG as the original image.
let referenceObjectUrl=null;
function referenceFor(level){
 const entry=selectedMall.floorReferences?.[level];
 return entry?.url||(mallId==='aventura'?(window.RETAILNAV_REFERENCES||{})[level]:null);
}
function comparison(){
 stopAuto();
 originalLevel=active==='ALL'?(mallId==='aventura'?'UL':floors[0].id):active;
 const combo=$('compareLevel');
 combo.replaceChildren();
 for(const floor of floors){
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
 const f=floors.find(f=>f.id===level);
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
 const records=(selectedMall.units||[]).filter(u=>u.floor===level);
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
 const floor=floors.find(f=>f.id===$('compareLevel').value);
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
  geometryFingerprint:geometryIdentity(floors.find(f=>f.id===level)),
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
 const floor=floors.find(f=>f.id===level);
 if(!floor)return;
 const entry=selectedMall.floorReferences?.[level];
 const size=entry?.imageSize||
   (mallId==='aventura'?[1320,941]:(selectedMall.floors.find(f=>f[0]===level)?.[5]||[1440,620]));
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
function exportSVG(){let fs=visible(),f=fs.length===1?fs[0]:floors[Math.min(1,floors.length-1)];let reference=selectedMall.floorReferences?.[f.id],isAP=mallId==='ap-plaza',box=reference?.viewBox||(isAP?'0 0 1440 620':'290 110 800 600'),size=reference?.imageSize||(isAP?[1440,620]:[800,600]);let s='<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+box+'"><rect x="0" y="0" width="'+size[0]+'" height="'+size[1]+'" fill="#f3f7f9"/>'+svgPaths(f)+'</svg>';download('RetailNav-'+mallId+'-'+f.id+'.svg',s,'image/svg+xml');}
function exportJSON(){let out={schema:'retailnav.vector.v1',product:'RetailNav',source:selectedMall.source||'Planos aportados',mallId,calibration:'Escala no medida. Coordenadas originales en pixeles registrados.',levels:visible().map(f=>({id:f.id,source:f.source,elevation:f.index*4.5,elevationStatus:'simulada',features:f.features.map(o=>({id:o.id,kind:o.k,label:o.n,geometry:{outer:o.r[0],holes:o.r.slice(1)},status:'trazado-provisional'}))}))};download('RetailNav-'+mallId+'-'+active+'.json',JSON.stringify(out,null,2),'application/json');}
// GLB 2.0: real triangle meshes with normals, one group per floor, Y up.
function exportGLB(){let parts=[],views=[],accessors=[],meshes=[],nodes=[],materials=[],len=0;let mat={};for(let floor of visible()){let children=[];for(let f of floor.features){if(!f.flat.length)continue;let bytes=new Uint8Array(f.flat.buffer);parts.push(bytes);let view=views.length;views.push({buffer:0,byteOffset:len,byteLength:bytes.length,byteStride:24,target:34962});let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<f.flat.length;i+=6)for(let j=0;j<3;j++){min[j]=Math.min(min[j],f.flat[i+j]);max[j]=Math.max(max[j],f.flat[i+j]);}let a=accessors.length;accessors.push({bufferView:view,byteOffset:0,componentType:5126,count:f.flat.length/6,type:'VEC3',min,max},{bufferView:view,byteOffset:12,componentType:5126,count:f.flat.length/6,type:'VEC3'});let key=f.k+'-'+floor.index;if(mat[key]===undefined){mat[key]=materials.length;materials.push({name:key,pbrMetallicRoughness:{baseColorFactor:[...palette(f,floor.index,false),1],metallicFactor:.1,roughnessFactor:.8},doubleSided:true});}let m=meshes.length;meshes.push({name:f.id,primitives:[{attributes:{POSITION:a,NORMAL:a+1},material:mat[key],mode:4}]});children.push(nodes.length);nodes.push({name:f.n||f.id,mesh:m,extras:{id:f.id,level:floor.id,status:'trazado-provisional'}});len+=bytes.length;}let group=nodes.length;nodes.push({name:floor.id,children,translation:[0,floor.index*4.5,0],extras:{source:floor.source,elevationStatus:'simulada'}});floor.exportGroup=group;}let doc={asset:{version:'2.0',generator:'RetailNav vector-to-mesh',extras:{realSurvey:false,scale:'unidades de modelo, no metros medidos'}},scene:0,scenes:[{nodes:visible().map(f=>f.exportGroup)}],nodes,meshes,materials,buffers:[{byteLength:len}],bufferViews:views,accessors};let text=new TextEncoder().encode(JSON.stringify(doc));let jlen=(text.length+3)&~3,total=12+8+jlen+8+len,buff=new ArrayBuffer(total),v=new DataView(buff),u=new Uint8Array(buff);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,total,true);v.setUint32(12,jlen,true);v.setUint32(16,0x4e4f534a,true);u.fill(32,20,20+jlen);u.set(text,20);v.setUint32(20+jlen,len,true);v.setUint32(24+jlen,0x004e4942,true);let off=28+jlen;parts.forEach(p=>{u.set(p,off);off+=p.length;});download('RetailNav-'+mallId+'-'+active+'.glb',buff,'model/gltf-binary');return buff;}
function bindUI(){$('showAllFloors').onclick=()=>setFloor('ALL');['pointerdown','pointermove','pointerup','wheel','input','change','click','keydown'].forEach(e=>document.addEventListener(e,()=>{dirty=true;},{passive:true,capture:true}));document.querySelectorAll('[data-floor]').forEach(b=>b.onclick=()=>setFloor(b.dataset.floor));$('zoomIn').onclick=()=>{stopAuto();const r=canvas.getBoundingClientRect();
 zoomAt(distance*.8,r.left+r.width/2,r.top+r.height/2);};
$('zoomOut').onclick=()=>{stopAuto();const r=canvas.getBoundingClientRect();
 zoomAt(distance*1.25,r.left+r.width/2,r.top+r.height/2);};$('reset').onclick=()=>resetCamera();$('plan').onclick=()=>{const next=$('plan').getAttribute('aria-pressed')!=='true';if(active==='ALL')setFloor(floors[Math.min(1,floors.length-1)].id);resetCamera(next);};$('pan').onclick=()=>{
 panMode=!panMode;
 if(panMode){orbitRoll=0;orbitPitch=clamp(orbitPitch,MIN_PITCH,MAX_PITCH);updateCameraRotation();}
 $('pan').setAttribute('aria-pressed',String(panMode));
 $('pan').setAttribute('aria-label',panMode?'Entrar en rotación libre 3D':'Volver al modo mapa');
 $('rnRollControls').hidden=panMode;
 notify(panMode
  ?'Mapa: un dedo mueve · dos dedos acercan, giran e inclinan.'
  :'3D libre: un dedo gira X/Y sin límites, dos dedos giran sobre Z, acercan e inclinan. ↶ ↷ para alabeo.');
 dirty=true;
};
$('rollLeft').onclick=()=>{stopAuto();orbitRoll=wrapAngle(orbitRoll+.18);updateCameraRotation();dirty=true;};
$('rollRight').onclick=()=>{stopAuto();orbitRoll=wrapAngle(orbitRoll-.18);updateCameraRotation();dirty=true;};$('auto').onclick=()=>{auto=!auto;$('auto').setAttribute('aria-pressed',String(auto));};$('wire').onclick=()=>{wire=!wire;$('wire').setAttribute('aria-pressed',String(wire));};$('points').onclick=()=>{scan=!scan;$('points').setAttribute('aria-pressed',String(scan));if(scan)notify('Puntos muestreados de estos vectores. No son datos LiDAR.');};$('labelsToggle').onclick=()=>{labelsOn=!labelsOn;$('labelsToggle').setAttribute('aria-pressed',String(labelsOn));};$('spread').oninput=()=>{targetSpread=Number($('spread').value);$('spreadValue').textContent=targetSpread>5?'Separadas':'Apiladas';target[1]=targetSpread;};const updateSearchPanel=()=>{
 // Closing a populated search restores map controls. Never leave a default
 // suggestions sheet covering WC, zoom or friends after the query is cleared.
 $('rnMapSearch').classList.toggle('finding',Boolean($('search').value.trim()));
 $('detail').hidden=true;results();
};
$('search').oninput=updateSearchPanel;
$('search').onfocus=updateSearchPanel;
$('search').addEventListener('keydown',event=>{
 if(event.key==='Escape'){
  $('rnMapSearch').classList.remove('finding');$('search').blur();
  event.stopPropagation();return;
 }
 if($('search').value.trim()&&(event.key==='ArrowDown'||event.key==='Enter')){
  const first=$('results').querySelector('button:not([disabled])');
  if(first){
   event.preventDefault();
   if(event.key==='Enter')first.click();else first.focus();
  }
 }
});
$('results').addEventListener('click',()=>$('rnMapSearch').classList.remove('finding'));
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
$('compareLocalPhoto').onchange=changeComparePhoto;$('downloadBtn').onclick=()=>$('exportDialog').showModal();$('jsonBtn').onclick=exportJSON;$('svgBtn').onclick=exportSVG;$('glbBtn').onclick=exportGLB;$('helpBtn').onclick=()=>$('helpDialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());window.addEventListener('resize',()=>{if(ready){resize();dirty=true;}});
 window.addEventListener('orientationchange',()=>{resize();dirty=true;});
 window.visualViewport?.addEventListener('resize',()=>{resize();dirty=true;});}
async function fetchJSON(url){let c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);try{let res=await fetch(url,{signal:c.signal});if(!res.ok)throw new Error('HTTP '+res.status+' al descargar '+url);let total=Number(res.headers.get('content-length'))||0,got=0,chunks=[],reader=res.body.getReader();while(true){let {done,value}=await reader.read();if(done)break;chunks.push(value);got+=value.byteLength;progress(total?Math.min(25,got/total*25):10,'Descargando vectores: '+Math.ceil(got/1024)+' KB'+(total?' / '+Math.ceil(total/1024)+' KB':''));}let bytes=new Uint8Array(got),off=0;chunks.forEach(x=>{bytes.set(x,off);off+=x.length;});return JSON.parse(new TextDecoder().decode(bytes));}finally{clearTimeout(timer);}}
function applyMallUi(){
  document.title='RetailNav | '+selectedMall.name+' · visor 3D';
  $('mallHeaderName').textContent=selectedMall.name;
  $('mallSidebarTitle').textContent=selectedMall.name;
  $('mallMobileTitle').textContent=selectedMall.name;
  $('mallMobileMeta').textContent=floors.length+' planta(s) · '+
    (mallId==='aventura'?'MOCK':'TRAZADO PROVISIONAL');
  $('mallSourceMessage').textContent=mallId==='new-world-city-shanghai'
    ?'九个楼层 L1–L9: '+(selectedMall.vectorRegionCount||0)+' regiones fotográficas candidatas y '+
       (selectedMall.commercialDirectoryRecords||0)+' registros históricos del directorio L1–L7. '+
       'Contornos y comunicaciones verticales sin validar; rutas desactivadas.'
    :mallId==='ap-plaza'
     ?'Mapa experimental AI2D v2: 197 regiones candidatas del calco visual, contrastadas parcialmente con la fotografía. Sin navegación real.'
     :'Reconstrucción vectorial a partir de los tres planos de Aventura Mall.';
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
  select.onchange=()=>setFloor(select.value);
  $('spread').disabled=single;
  $('showAllFloors').hidden=true;
  $('showAllFloors').textContent='← Todas las plantas';
  $('original').disabled=false;
  $('original').title='Comparar foto y vectorizado de cada planta';
  $('routeBtn').disabled=mallId!=='aventura';
  const footer=document.querySelector('.sidebarfooter');
  if(footer&&mallId==='ap-plaza'){
    footer.textContent='AP Plaza: 1 fotografía de B1; 197 polígonos candidatos trazados a partir de un calco visual IA y revisión fotográfica. Tiendas, rutas y escala sin validación física: NO APTO PARA NAVEGACIÓN REAL.';
  }else if(footer&&mallId==='new-world-city-shanghai'){
    footer.textContent='新世界城: nueve fotografías L1–L9, regiones individualizadas de manera provisional; '+
     'servicios de circulación separados y directorio histórico L1–L7 conservado. '+
     'No hay verificación de fachadas, escala ni conexión entre plantas. '+
     'NO APTO PARA NAVEGACIÓN REAL.';
  }
  $('mapSubtitle').textContent=mallId==='new-world-city-shanghai'
    ?''+(selectedMall.vectorRegionCount||0)+' regiones candidatas entre L1–L9 · límites pendientes de revisión. NO NAVEGABLE.'
    :mallId==='ap-plaza'
     ?''+(selectedMall.vectorRegionCount||0)+' recintos vectoriales candidatos · calco IA 2D experimental · NO APTO PARA NAVEGACIÓN.'
     :'Contornos y pasillos trazados sobre tus imágenes.';
  $('mapTitle').textContent=mallId==='new-world-city-shanghai'
    ?'L1–L9 · geometrías provisionales sin escala calibrada'
    :mallId==='ap-plaza'?'B1 · calco IA v2':'Las tres plantas, en su posición relativa';
}
async function init(){try{bindUI();progress(5,'Preparando los vectores de '+selectedMall.name+'...');let embedded=$('modelData');data=selectedMall.floors||(embedded?JSON.parse(embedded.textContent):await fetchJSON('maps/compact.json'));floors=unpack(data);applyMallUi();initGL();makeGrid();if(gl)routeBuffer=gl.createBuffer();for(let i=0;i<floors.length;i++){geometry(floors[i]);progress(25+(i+1)*22,'Geometría '+floors[i].id+' preparada - '+(i+1)+' de '+floors.length+' plantas');await new Promise(requestAnimationFrame);}ready=true;makeLabels();resetCamera();results();$('unitCount').textContent=floors.flatMap(f=>f.features).filter(f=>['unit','anchor'].includes(f.k)).length;$('polygonCount').textContent=floors.reduce((n,f)=>n+f.features.length,0);document.querySelectorAll('[data-runtime]').forEach(b=>b.disabled=false);
$('spread').disabled=floors.length<=1||active!=='ALL';$('fallback').hidden=true;$('loading').hidden=true;$('badge').classList.add('ready');$('status').textContent=gl?'WebGL listo':'3D compatible listo';$('renderStatus').textContent=floors.length+' plantas cargadas ('+selectedMall.name+') - render '+(gl?'WebGL':'Canvas 3D')+' - sin CDN';requestAnimationFrame(render);window.__RETAILNAV__={getState:()=>({ready,mallId,renderer:gl?'WebGL':'Canvas 3D',active,visible:visible().map(f=>f.id),target:target.slice(),distance,q:q.slice(),spread,wire,scan,auto,placingPosition,selected:selected?.id,route:route?.points.length||0,frames:frame,errors:errors.slice(),features:floors.map(f=>[f.id,f.features.length]),searchPlacement:'map-top',headerMallName:$('mallHeaderName').textContent,zoomMin:MIN_ZOOM_DISTANCE,zoomMax:MAX_ZOOM_DISTANCE,nativeGestureDirections:true,gestureMode:panMode?'map-pan':'orbit-3d',orbitYaw,orbitPitch,orbitRoll,rotationAxes:panMode?2:3}),floors,project:(f,p)=>{let floor=floors.find(x=>x.id===f);return floor?screen(pos(p,floor.y+2)):null;},viewportWidth:()=>canvas.clientWidth,pinWorld:(floorId,x,y)=>{const f=floors.find(f=>f.id===floorId);return f?pos([x,y],f.y):null;},projectWorld:p=>screen(p),setFloor,select,exportGLB,invalidate:()=>{dirty=true;},focusAt:(id,p,desiredDistance=110)=>{setFloor(id);let floor=floors.find(f=>f.id===id);if(floor){target=pos(p,floor.y);distance=clamp(desiredDistance,30,550);dirty=true;}},beginManualLocation:()=>{placingPosition=true;canvas.classList.add('placing');notify('Elegí la planta y tocá el lugar donde estás. Es una ubicación manual, no GPS.');}};window.dispatchEvent(new Event('retailnav:ready'));}catch(e){fail('No se pudo abrir el visor 3D: '+e.message);}}
init();
})();
