/* WebGL SOLID pin mesh. This is not a camera-facing Canvas sprite:
 * shell has front, back and thickness, glazed inset ring is a torus, face is
 * a texture-mapped disc. Model is fixed in the mall world coordinate system.
 * Map camera rotates around it and reveals the real sides and back.
 * The existing Canvas renderer remains only as a fallback without WebGL.
 */
(()=>{
'use strict';
const pins=window.RetailNavPins;
if(!pins)return;
let resources=null,visibleCount=0,frames3d=0,photoLoaded=0,photoErrors=0;
const photos=new Map();
const PI=Math.PI;
function compile(gl,type,src){
 const sh=gl.createShader(type);
 gl.shaderSource(sh,src);gl.compileShader(sh);
 if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))
   throw Error('3D pin shader: '+gl.getShaderInfoLog(sh));
 return sh;
}
function init(gl){
 const program=gl.createProgram();
 gl.attachShader(program,compile(gl,gl.VERTEX_SHADER,
  'attribute vec3 aPos;attribute vec3 aNormal;attribute vec2 aUV;'+
  'uniform mat4 uMvp;uniform vec3 uOrigin;uniform float uScale;'+
  'varying vec3 vNormal;varying vec2 vUV;varying float vHeight;'+
  'void main(){vec3 p=aPos*uScale+uOrigin;gl_Position=uMvp*vec4(p,1.);'+
  'vNormal=aNormal;vUV=aUV;vHeight=aPos.y;}'));
 gl.attachShader(program,compile(gl,gl.FRAGMENT_SHADER,
  'precision mediump float;varying vec3 vNormal;varying vec2 vUV;'+
  'varying float vHeight;uniform sampler2D uPhoto;uniform int uMaterial;'+
  'uniform float uSelected;'+
  'void main(){vec3 n=normalize(vNormal);'+
  'vec3 l=normalize(vec3(-0.32,0.62,0.85));'+
  'float lum=0.62+max(0.,dot(n,l))*.38;'+
  'float shine=pow(max(0.,dot(reflect(-l,n),vec3(0.,0.,1.))),22.)*.22;'+
  'vec3 c=vec3(.32,.61,.91);'+
  'if(uMaterial==0){float upper=clamp(vHeight/149.,0.,1.);'+
  'c=mix(vec3(.13,.39,.78),vec3(.48,.74,.97),upper*.50+max(0.,n.z)*.26);'+
  'c=(c*lum)+vec3(shine*.55,shine*.65,shine);'+
  'if(uSelected>.5)c+=vec3(.06,.13,.10);'+
  '}else if(uMaterial==1){c=vec3(.92,.95,.98)*lum+vec3(shine);'+
  '}else{c=texture2D(uPhoto,vUV).rgb*(.82+.18*max(0.,n.z));}'+
  'gl_FragColor=vec4(clamp(c,0.,1.),1.);}'));
 gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))
   throw Error('3D pin shader link: '+gl.getProgramInfoLog(program));
 const attr={p:gl.getAttribLocation(program,'aPos'),
   n:gl.getAttribLocation(program,'aNormal'),uv:gl.getAttribLocation(program,'aUV')};
 const uniforms={mvp:gl.getUniformLocation(program,'uMvp'),
   origin:gl.getUniformLocation(program,'uOrigin'),scale:gl.getUniformLocation(program,'uScale'),
   material:gl.getUniformLocation(program,'uMaterial'),
   photo:gl.getUniformLocation(program,'uPhoto'),
   selected:gl.getUniformLocation(program,'uSelected')};
 function push(v,point,normal,uv=[.5,.5]){
   v.push(...point,...normal,...uv);
 }
 function tri(v,a,b,c,na,nb,nc,ua,ub,uc){
   push(v,a,na,ua);push(v,b,nb,ub);push(v,c,nc,uc);
 }
 function cubic(a,b,c,d,t){
   const s=1-t;return [0,1].map(i=>a[i]*s*s*s+3*b[i]*s*s*t+
     3*c[i]*s*t*t+d[i]*t*t*t);
 }
 const outlines=[];
 const curves=[
  [[0,0],[-9,-17],[-39,-59],[-47,-83]],
  [[-47,-83],[-60,-122],[-34,-149],[0,-149]],
  [[0,-149],[34,-149],[60,-122],[47,-83]],
  [[47,-83],[39,-59],[9,-17],[0,0]]
 ];
 for(const segment of curves)for(let i=0;i<20;i++){
   const xy=cubic(...segment,i/20);
   outlines.push([xy[0],-xy[1]]);
 }
 // Extrusion made from independent rings along z: back, sides, bevel and front.
 const shell=[];
 const rings=[
  {z:-3.6,k:.88},{z:-3.2,k:.96},{z:-2.0,k:1},
  {z:2.0,k:1},{z:3.0,k:.97},{z:3.25,k:.94}
 ];
 const normal=(p,z,base)=>{
   const r=Math.hypot(p[0],p[1]-89)||1;
   return [p[0]/r,(p[1]-89)/r,z+base];
 };
 // Front and back are real filled polygon faces; rotating the map reveals them.
 const center=[0,91];
 for(const side of [0,rings.length-1]){
   const ring=rings[side],norm=[0,0,side===0?-1:1];
   for(let i=0;i<outlines.length;i++){
     const p=outlines[i],q=outlines[(i+1)%outlines.length];
     const c=[center[0],center[1],ring.z],a=[p[0]*ring.k,p[1]*ring.k,ring.z],
       b=[q[0]*ring.k,q[1]*ring.k,ring.z];
     if(side===0)tri(shell,c,b,a,norm,norm,norm);
     else tri(shell,c,a,b,norm,norm,norm);
   }
 }
 for(let layer=0;layer<rings.length-1;layer++){
   const a=rings[layer],b=rings[layer+1];
   for(let i=0;i<outlines.length;i++){
     const p=outlines[i],q=outlines[(i+1)%outlines.length];
     const p1=[p[0]*a.k,p[1]*a.k,a.z],p2=[q[0]*a.k,q[1]*a.k,a.z];
     const p3=[p[0]*b.k,p[1]*b.k,b.z],p4=[q[0]*b.k,q[1]*b.k,b.z];
     const tilt=layer===0?-.32:layer===rings.length-2?.30:0;
     const n1=normal(p,tilt,0),n2=normal(q,tilt,0);
     tri(shell,p1,p2,p3,n1,n2,n1);
     tri(shell,p3,p2,p4,n1,n2,n2);
   }
 }
 // White porcelain inset ring, circular extrusion in THREE dimensions.
 const rim=[];
 const major=29.8,minor=5.0,cy=99,cz=3.4;
 const aR=52,bR=12;
 function ringVertex(theta,phi){
   const ct=Math.cos(theta),st=Math.sin(theta),cp=Math.cos(phi),sp=Math.sin(phi);
   return {p:[(major+minor*cp)*ct,cy+(major+minor*cp)*st,cz+minor*sp],
     n:[ct*cp,st*cp,sp]};
 }
 for(let i=0;i<aR;i++)for(let j=0;j<bR;j++){
   const a=ringVertex(i*2*PI/aR,j*2*PI/bR),
    b=ringVertex((i+1)*2*PI/aR,j*2*PI/bR),
    c=ringVertex(i*2*PI/aR,(j+1)*2*PI/bR),
    d=ringVertex((i+1)*2*PI/aR,(j+1)*2*PI/bR);
   tri(rim,a.p,b.p,c.p,a.n,b.n,c.n);
   tri(rim,c.p,b.p,d.p,c.n,b.n,d.n);
 }
 const disc=[];
 const radius=25.3,z=6.8;
 for(let i=0;i<64;i++){
  const angle=i*2*PI/64,next=(i+1)*2*PI/64;
  const p=[radius*Math.cos(angle),cy+radius*Math.sin(angle),z],
    q=[radius*Math.cos(next),cy+radius*Math.sin(next),z],
    n=[0,0,1];
  tri(disc,[0,cy,z],p,q,n,n,n,[.5,.5],
    [.5+.5*Math.cos(angle),.5+.5*Math.sin(angle)],
    [.5+.5*Math.cos(next),.5+.5*Math.sin(next)]);
 }
 function mesh(vertices){
  const b=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,b);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
  return {buffer:b,triangles:vertices.length/24,count:vertices.length/8};
 }
 return {gl,program,attr,uniforms,body:mesh(shell),rim:mesh(rim),disc:mesh(disc)};
}
function drawMesh(gl,r,mesh,material){
 gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
 const stride=32;
 for(const [index,size,offset] of [[r.attr.p,3,0],[r.attr.n,3,12],[r.attr.uv,2,24]]){
  gl.enableVertexAttribArray(index);
  gl.vertexAttribPointer(index,size,gl.FLOAT,false,stride,offset);
 }
 gl.uniform1i(r.uniforms.material,material);
 gl.drawArrays(gl.TRIANGLES,0,mesh.count);
}
function imageFor(person,gl){
 const key=person.id+'@'+person.avatarUrl;
 let cache=photos.get(key);
 if(cache)return cache;
 cache={loaded:false,error:false,image:null,tex:null};
 photos.set(key,cache);
 const image=new Image();
 image.decoding='async';
 image.onload=()=>{cache.image=image;cache.loaded=image.naturalWidth>0;
   window.__RETAILNAV__?.invalidate?.();};
 image.onerror=()=>{cache.error=true;window.__RETAILNAV__?.invalidate?.();};
 image.src=person.avatarUrl||'';
 return cache;
}
function bindPhoto(gl,person){
 const item=imageFor(person,gl);
 if(item.loaded&&!item.tex){
  const tex=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,item.image);
  item.tex=tex;
 }
 if(item.tex)gl.bindTexture(gl.TEXTURE_2D,item.tex);
 return Boolean(item.tex);
}
function draw3D(gl,mvp){
 const view=window.__RETAILNAV__;
 if(!view?.getState().ready||!gl)return;
 if(!resources||resources.gl!==gl){
  try{resources=init(gl);}catch(e){console.error('3D pin mesh failed',e);return;}
 }
 const keep=new Set();
 const allowed=new Set(view.getState().visible);
 const records=pins.getPeople?.()||[];
 visibleCount=0;frames3d++;
 photoLoaded=0;photoErrors=0;
 const r=resources;
 gl.useProgram(r.program);
 gl.uniformMatrix4fv(r.uniforms.mvp,false,mvp);
 gl.activeTexture(gl.TEXTURE0);
 gl.uniform1i(r.uniforms.photo,0);
 gl.enable(gl.DEPTH_TEST);
 gl.disable(gl.CULL_FACE);
 for(const p of records){
  if(!allowed.has(p.position.floor))continue;
  const world=view.pinWorld(p.position.floor,p.position.x,p.position.y);
  if(!world)continue;
  const projected=view.projectWorld([world[0],world[1]+8,world[2]]);
  if(!projected||projected.w<=0||projected.z>=1||projected.z<=-1)continue;
  // Geometry remains world-fixed; never rotate it toward the camera.
  gl.uniform3f(r.uniforms.origin,world[0],world[1]+.26,world[2]);
  gl.uniform1f(r.uniforms.scale,.119);
  gl.uniform1f(r.uniforms.selected,p.id===window.RetailNavFocusedFriendId?1:0);
  drawMesh(gl,r,r.body,0);
  drawMesh(gl,r,r.rim,1);
  const key=p.id+'@'+p.avatarUrl;
  keep.add(key);
  const item=imageFor(p,gl);
  if(item.error)photoErrors++;
  if(bindPhoto(gl,p)) {
   photoLoaded++;
   drawMesh(gl,r,r.disc,2);
  }
  visibleCount++;
 }
 // Immediately release GPU image textures for revoked or deleted people.
 for(const [key,item] of photos)if(!keep.has(key)){
  if(item.tex)gl.deleteTexture(item.tex);
  photos.delete(key);
 }
 pins.webGLActive=true;
}
const baseDraw=pins.draw;
pins.draw=()=>{
 const view=window.__RETAILNAV__;
 if(view?.getState().renderer!=='WebGL'||!resources)return baseDraw();
 const canvas=document.getElementById('peoplePinCanvas'),ctx=canvas?.getContext('2d');
 if(ctx)ctx.clearRect(0,0,canvas.width,canvas.height);
};
pins.getPeople=()=>pins.getPeople?.__original?.()||[]; // replaced below
pins.draw3D=draw3D;
pins.getSolidState=()=>({
  mode:resources?'solid-webgl-mesh':'pending',
  rendered:visibleCount,frames:frames3d,
  triangles:resources?(resources.body.triangles+resources.rim.triangles+resources.disc.triangles):0,
  photoLoaded,photoErrors,
  fixedWorldRotation:true,
  ringThicknessWorld:5*.119,
  bodyThicknessWorld:7.1*.119
});
})();
