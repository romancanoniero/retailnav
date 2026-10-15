/* One label per shopping zone: preserve the original illuminated, solid 3D
 * plaque and its textured type, but orient the entire plaque to the camera.
 * Quaternions supply the basis for ANY camera yaw/pitch/roll, so the name is
 * never mirrored, upside-down or edge-on as the user explores the mall.
 * Geometry is anchored to its original 3D floor; no second DOM badge in WebGL.
 */
(()=>{
'use strict';
const mall=window.RETAILNAV_ACTIVE_MALL||{};
const districts=Array.isArray(mall.districts)?mall.districts:[];
const BASE_ROOF_HEIGHT=2.2;       // tallest existing anchor roof in viewer.js
const FLOAT_GAP=6.0;             // visible empty space above every floor's roofs
const SIGN_THICKNESS=.58;       // actual 3D side and bottom geometry
const SHADOW_Y=BASE_ROOF_HEIGHT+.10;
const SIDE_BORDER=.16;
let gpu=null,rendered=0,frames=0,focused=null,lastError='';
let shown=[],positions=[],geometryTriangles=0,projectedBoxes=[];
const normalizeText=s=>String(s||'').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase();
const find=q=>districts.filter(d=>normalizeText(d.name+' '+(d.detail||''))
  .includes(normalizeText(q)));
function focus(id){
 const district=districts.find(item=>item.id===id);
 if(!district)return false;
 focused=id;
 window.__RETAILNAV__?.focusAt?.(district.floor,[district.x,district.y],100);
 window.__RETAILNAV__?.invalidate?.();
 return true;
}
function compile(gl,type,source){
 const obj=gl.createShader(type);
 gl.shaderSource(obj,source);gl.compileShader(obj);
 if(!gl.getShaderParameter(obj,gl.COMPILE_STATUS)){
  const reason=gl.getShaderInfoLog(obj)||'unknown shader failure';
  gl.deleteShader(obj);throw Error(reason);
 }
 return obj;
}
function init(gl){
 const vertex=compile(gl,gl.VERTEX_SHADER,
  'attribute vec3 aPos;attribute vec2 aUV;uniform mat4 uMVP;'+
  'varying vec2 vUV;void main(){vUV=aUV;gl_Position=uMVP*vec4(aPos,1.);}');
 const fragment=compile(gl,gl.FRAGMENT_SHADER,
  'precision mediump float;varying vec2 vUV;'+
  'uniform sampler2D uAtlas;uniform int uSolid;uniform vec4 uTint;'+
  'void main(){vec4 c=uSolid==1?uTint:texture2D(uAtlas,vUV);'+
  'if(c.a<.10)discard;gl_FragColor=c;}');
 const program=gl.createProgram();
 gl.attachShader(program,vertex);gl.attachShader(program,fragment);
 gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))
  throw Error(gl.getProgramInfoLog(program)||'district shader link failure');

 // Each district owns its texture cell; names are transcribed from the map,
 // never inferred from color blobs or fictitious storefronts.
 const cw=384,ch=102,cols=4,rows=Math.max(1,Math.ceil(districts.length/cols));
 const canvas=document.createElement('canvas');
 canvas.width=cw*cols;canvas.height=ch*rows;
 const ctx=canvas.getContext('2d');
 if(!ctx)throw Error('Canvas 2D is required for district sign lettering');
 const cells=new Map();
 for(let i=0;i<districts.length;i++){
  const d=districts[i],x=(i%cols)*cw,y=Math.floor(i/cols)*ch;
  ctx.clearRect(x,y,cw,ch);
  const fill=ctx.createLinearGradient(x,y,x+cw,y+ch);
  fill.addColorStop(0,'#0a2546');fill.addColorStop(.47,'#194b76');
  fill.addColorStop(1,'#071a37');
  ctx.fillStyle=fill;
  ctx.beginPath();ctx.roundRect(x+5,y+6,cw-10,ch-12,15);ctx.fill();
  ctx.lineWidth=4;ctx.strokeStyle='#90eaff';ctx.stroke();
  ctx.lineWidth=1.4;ctx.strokeStyle='rgba(234,251,255,.74)';
  ctx.beginPath();ctx.roundRect(x+12,y+12,cw-24,ch-24,11);ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,.10)';
  ctx.beginPath();ctx.roundRect(x+18,y+16,cw-36,12,5);ctx.fill();
  ctx.fillStyle='#ffffff';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font=window.RetailNavThemes?.canvasFont?.(800,d.name.length>22?23:30)||('800 '+(d.name.length>22?23:30)+'px system-ui,sans-serif');
  ctx.fillText(d.name,x+cw/2,y+(d.detail?40:ch/2),cw-28);
  if(d.detail){
   ctx.fillStyle='#c8ebf7';ctx.font=window.RetailNavThemes?.canvasFont?.(500,16)||'500 16px system-ui,sans-serif';
   ctx.fillText(d.detail,x+cw/2,y+73,cw-32);
  }
  cells.set(d.id,{
   u0:(x+4)/canvas.width,u1:(x+cw-4)/canvas.width,
   v0:1-(y+5)/canvas.height,v1:1-(y+ch-5)/canvas.height
  });
 }
 const atlas=gl.createTexture();
 gl.bindTexture(gl.TEXTURE_2D,atlas);
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
 return {
  gl,program,atlas,buffer:gl.createBuffer(),cells,
  pos:gl.getAttribLocation(program,'aPos'),
  uv:gl.getAttribLocation(program,'aUV'),
  mvp:gl.getUniformLocation(program,'uMVP'),
  sampler:gl.getUniformLocation(program,'uAtlas'),
  solid:gl.getUniformLocation(program,'uSolid'),
  tint:gl.getUniformLocation(program,'uTint')
 };
}
function v(list,p,u=0,v=0){list.push(p[0],p[1],p[2],u,v);}
function triangle(list,a,b,c,ua=[0,0],ub=[0,0],uc=[0,0]){
 v(list,a,...ua);v(list,b,...ub);v(list,c,...uc);
}
function rectCorners(x,z,halfW,halfH,y){
 return [
  [x-halfW,y,z-halfH],[x+halfW,y,z-halfH],
  [x+halfW,y,z+halfH],[x-halfW,y,z+halfH]
 ];
}
function topFace(list,r,uv){
 // World +Y facing: a -> c -> b and a -> d -> c
 const [a,b,c,d]=r;
 // Preserve the map's established canvas-atlas orientation: the positive
 // Z edge corresponds to the first printed line in the floor-plan texture.
 triangle(list,a,c,b,
  [uv.u0,uv.v1],[uv.u1,uv.v0],[uv.u1,uv.v1]);
 triangle(list,a,d,c,
  [uv.u0,uv.v1],[uv.u0,uv.v0],[uv.u1,uv.v0]);
}
function bottomFace(list,r){
 const [a,b,c,d]=r;
 triangle(list,a,b,c);triangle(list,a,c,d);
}
function sides(list,bottom,top){
 for(let i=0;i<4;i++){
  const next=(i+1)%4;
  triangle(list,bottom[i],bottom[next],top[next]);
  triangle(list,bottom[i],top[next],top[i]);
 }
}

function add(a,b,scalar=1){return [a[0]+b[0]*scalar,a[1]+b[1]*scalar,a[2]+b[2]*scalar];}
function rotate(q,v){
 const u=q.slice(0,3);
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const t=cross(u,v).map(n=>n*2);
 return add(add(v,t,q[3]),cross(u,t));
}
// Corners are bottom-left, bottom-right, top-right, top-left as seen by camera.
function facingCorners(center,right,up,front,width,height,forward){
 return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sy])=>
  add(add(add(center,right,sx*width),up,sy*height),front,forward));
}
function facingFace(list,quad,uv){
 const [a,b,c,d]=quad;
 // Atlas's v0 is the TOP, v1 is the BOTTOM, with UNPACK_FLIP_Y_WEBGL=true.
 triangle(list,a,b,c,[uv.u0,uv.v1],[uv.u1,uv.v1],[uv.u1,uv.v0]);
 triangle(list,a,c,d,[uv.u0,uv.v1],[uv.u1,uv.v0],[uv.u0,uv.v0]);
}
function projectedEnvelope(view,corners,id,floor,low,high){
 const points=corners.map(p=>view.projectWorld(p));
 if(points.some(p=>!p||!Number.isFinite(p.x+p.y)||p.w<=0||p.z<=-1||p.z>=1))
  return null;
 const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
 return {id,floor,x0:Math.min(...xs),x1:Math.max(...xs),
  y0:Math.min(...ys),y1:Math.max(...ys),bottomY:low,topY:high};
}

function uploadAndDraw(gl,r,mvp,vertexData,solid,tint){
 if(!vertexData.length)return 0;
 gl.useProgram(r.program);
 gl.uniformMatrix4fv(r.mvp,false,mvp);
 gl.uniform1i(r.solid,solid?1:0);
 gl.uniform4fv(r.tint,new Float32Array(tint));
 gl.activeTexture(gl.TEXTURE0);
 gl.bindTexture(gl.TEXTURE_2D,r.atlas);
 gl.uniform1i(r.sampler,0);
 gl.bindBuffer(gl.ARRAY_BUFFER,r.buffer);
 gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertexData),gl.DYNAMIC_DRAW);
 gl.enableVertexAttribArray(r.pos);
 gl.vertexAttribPointer(r.pos,3,gl.FLOAT,false,20,0);
 gl.enableVertexAttribArray(r.uv);
 gl.vertexAttribPointer(r.uv,2,gl.FLOAT,false,20,12);
 gl.drawArrays(gl.TRIANGLES,0,vertexData.length/5);
 return vertexData.length/15;
}
function draw3D(gl,mvp){
 const view=window.__RETAILNAV__;
 if(!gl||!view?.getState().ready||!districts.length)return;
 if(!gpu||gpu.gl!==gl){
  try{gpu=init(gl);lastError='';}catch(e){
   lastError=String(e?.message||e);
   console.error('District floating 3D signs failed:',e);return;
  }
 }
 const state=view.getState(),on=new Set(state.visible);
 // These three quaternion-rotated axes remain orthogonal even upside-down.
 const right=rotate(state.q,[1,0,0]);
 const up=rotate(state.q,[0,1,0]);
 const towardCamera=rotate(state.q,[0,0,1]);
 const backs=[],walls=[],rims=[],lettering=[],shadows=[];
 shown=[];positions=[];projectedBoxes=[];rendered=0;geometryTriangles=0;frames++;
 const worldPerPixel=2*state.distance*Math.tan(Math.PI/8)/
  Math.max(300,document.getElementById('canvas')?.clientHeight||600);
 for(const district of districts){
  if(!on.has(district.floor))continue;
  const point=view.pinWorld(district.floor,district.x,district.y);
  if(!point)continue;
  const uv=gpu.cells.get(district.id);
  if(!uv)continue;
  const nominalWidth=Math.max(4,(mall.scale||.12)*(district.widthPx||170));
  // Extra map zoom should not leave all typography microscopic. Limit how
  // much the sign can enlarge, so it never masks an entire mall floor.
  const width=Math.min(Math.max(44,nominalWidth),Math.max(nominalWidth,worldPerPixel*110));
  const height=Math.max(3.5,(mall.scale||.12)*(district.heightPx||35),width*102/384);
  const halfW=width/2,halfH=height/2;
  const x=point[0],z=point[2],floorY=point[1];
  const low=floorY+BASE_ROOF_HEIGHT+FLOAT_GAP;
  // The sign stays physically clear of shop roofs even after arbitrary roll:
  // account for the maximum world-Y span of its rotated 3D volume.
  const verticalExtent=Math.abs(right[1])*halfW+
   Math.abs(up[1])*halfH+Math.abs(towardCamera[1])*SIGN_THICKNESS/2;
  const center=[x,low+verticalExtent,z];
  const high=low+verticalExtent*2;
  const back=facingCorners(center,right,up,towardCamera,halfW,halfH,-SIGN_THICKNESS/2);
  const front=facingCorners(center,right,up,towardCamera,halfW,halfH,SIGN_THICKNESS/2);
  bottomFace(backs,back);
  sides(walls,back,front);
  const trim=facingCorners(center,right,up,towardCamera,halfW,halfH,
   SIGN_THICKNESS/2+.035);
  facingFace(rims,trim,{u0:0,u1:1,v0:0,v1:1});
  const inset=Math.min(SIDE_BORDER,halfH*.25);
  const face=facingCorners(center,right,up,towardCamera,
   Math.max(.4,halfW-inset),Math.max(.4,halfH-inset),
   SIGN_THICKNESS/2+.053);
  facingFace(lettering,face,uv);
  const shadowPlane=rectCorners(x,z,halfW*.76,halfH*.82,
   floorY+SHADOW_Y);
  topFace(shadows,shadowPlane,{u0:0,u1:1,v0:0,v1:1});
  const box=projectedEnvelope(view,back.concat(front),district.id,
   district.floor,low,high);
  if(box)projectedBoxes.push(box);
  positions.push({
   id:district.id,floor:district.floor,floorY,bottomY:low,topY:high,
   airGap:FLOAT_GAP,heightAboveFloor:high-floorY,center: center.slice(),
   // Unit normal points toward viewer for EVERY camera orientation.
   forward:towardCamera.slice()
  });
  rendered++;shown.push(district.id);
 }
 if(!rendered)return;
 const r=gpu;
 gl.enable(gl.DEPTH_TEST);
 gl.disable(gl.CULL_FACE);
 gl.enable(gl.BLEND);
 gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
 gl.depthMask(false);
 geometryTriangles+=uploadAndDraw(gl,r,mvp,shadows,true,[.02,.18,.29,.17]);
 gl.depthMask(true);
 geometryTriangles+=uploadAndDraw(gl,r,mvp,backs,true,[.035,.12,.26,1]);
 geometryTriangles+=uploadAndDraw(gl,r,mvp,walls,true,[.10,.31,.62,1]);
 geometryTriangles+=uploadAndDraw(gl,r,mvp,rims,true,[.38,.80,.95,1]);
 geometryTriangles+=uploadAndDraw(gl,r,mvp,lettering,false,[1,1,1,1]);
 gl.disable(gl.BLEND);
}
// These are EXACT projections of billboarded 3D sign corners. The pin renderer
// uses the same occupied footprint so friends never pierce sign lettering.
function getProjectedBoxes(){
 return projectedBoxes.map(b=>({...b}));
}
window.RetailNavDistricts={
 draw3D,find,focus,getProjectedBoxes,getAll:()=>districts.slice(),
 getState:()=>({
  count:districts.length,rendered,visibleIds:shown.slice(),
  mode:gpu?'camera-facing-solid-district-3d':'pending',
  cameraFacing:true,screenUprightLabels:true,singleLabelPerZone:true,
  tiedToFloor:true,
  floorClearance:FLOAT_GAP,
  panelThickness:SIGN_THICKNESS,
  hasPhysicalSides:true,hasBottomFace:true,
  triangles:geometryTriangles,
  positions:positions.map(x=>({...x,center:x.center.slice()})),
  frames,focused,lastError
 })
};
// Rebuild only the texture atlas (and its context resources) when the shopping
// font changes; source names, anchors, floor coordinates and geometry remain
// unchanged. Every district sign continues to use the selected font preset.
let previousFont=window.RetailNavThemes?.getState?.().theme.font||'modern';
window.addEventListener('retailnav:themechange',()=>{
 const currentFont=window.RetailNavThemes?.getState?.().theme.font||'modern';
 if(previousFont===currentFont)return;
 previousFont=currentFont;
 if(gpu){
  gpu.gl.deleteTexture(gpu.atlas);
  gpu.gl.deleteBuffer(gpu.buffer);
  gpu.gl.deleteProgram(gpu.program);
  gpu=null;
 }
 window.__RETAILNAV__?.invalidate?.();
});
window.__RETAILNAV__?.invalidate?.();
})();
