/* Suspended, solid 3D district signs for RetailNav.
 *
 * Commercial district names are separate from individual shop roof labels.
 * Each is a real horizontal sign, floating ABOVE its own floor with visible
 * air between the tallest shop roof and the bottom of the sign.
 *
 * The sign has a physical bottom, four sides, a lit upper rim, a text texture,
 * and a translucent ground shadow. It lives in the mall's world coordinate
 * system and uses the EXACT SAME camera matrix as the floor meshes.
 * It does not billboard toward the screen.
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
let shown=[],positions=[],geometryTriangles=0;
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
  ctx.font='800 '+(d.name.length>22?23:30)+'px system-ui,sans-serif';
  ctx.fillText(d.name,x+cw/2,y+(d.detail?40:ch/2),cw-28);
  if(d.detail){
   ctx.fillStyle='#c8ebf7';ctx.font='500 16px system-ui,sans-serif';
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
   console.error('District floating 3D signs failed:',e);
   return;
  }
 }
 const state=view.getState();
 const visibleFloors=new Set(state.visible);
 const shadow=[],sidesData=[],undersides=[],rims=[],lettering=[];
 shown=[];positions=[];rendered=0;geometryTriangles=0;frames++;
 for(const district of districts){
  if(!visibleFloors.has(district.floor))continue;
  const point=view.pinWorld(district.floor,district.x,district.y);
  if(!point)continue;
  const uv=gpu.cells.get(district.id);
  if(!uv)continue;
  const width=Math.max(4,(mall.scale||.12)*(district.widthPx||170));
  const depth=Math.max(1.5,(mall.scale||.12)*(district.heightPx||35));
  const x=point[0],z=point[2],halfW=width/2,halfH=depth/2;
  // This is FLOOR-RELATIVE, never a global fixed y. When the visitor
  // separates/stacks levels each label travels with its own floor index.
  const bottomY=point[1]+BASE_ROOF_HEIGHT+FLOAT_GAP;
  const topY=bottomY+SIGN_THICKNESS;
  const bottom=rectCorners(x,z,halfW,halfH,bottomY);
  const top=rectCorners(x,z,halfW,halfH,topY);
  bottomFace(undersides,bottom);
  sides(sidesData,bottom,top);
  // A 3D luminous bezel is a larger, thin raised slab around the face.
  const trimY=topY+.035;
  const trim=rectCorners(x,z,halfW,halfH,trimY);
  topFace(rims,trim,{u0:0,u1:1,v0:0,v1:1});
  // Slightly inset texture leaves a bright blue rim visible from above.
  const face=rectCorners(x,z,
   Math.max(.3,halfW-SIDE_BORDER),Math.max(.3,halfH-SIDE_BORDER),
   trimY+.018);
  topFace(lettering,face,uv);
  // Soft translucent shadow on the roof beneath the floating sign. Not a
  // connecting post: the visible gap is physically empty.
  const shadowPlane=rectCorners(x,z,halfW*.86,halfH*.83,
   point[1]+SHADOW_Y);
  topFace(shadow,shadowPlane,{u0:0,u1:1,v0:0,v1:1});
  positions.push({
   id:district.id,floor:district.floor,
   floorY:point[1],bottomY,topY,airGap:FLOAT_GAP,
   heightAboveFloor:topY-point[1],
   center:[x,(bottomY+topY)/2,z]
  });
  rendered++;shown.push(district.id);
 }
 if(!rendered)return;
 const r=gpu;
 gl.enable(gl.DEPTH_TEST);
 gl.disable(gl.CULL_FACE);
 gl.enable(gl.BLEND);
 gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
 // The shadow never writes depth, so the mall floor still occludes it.
 gl.depthMask(false);
 geometryTriangles+=uploadAndDraw(gl,r,mvp,shadow,true,[.02,.18,.29,.17]);
 gl.depthMask(true);
 geometryTriangles+=uploadAndDraw(gl,r,mvp,undersides,true,[.035,.12,.26,1]);
 geometryTriangles+=uploadAndDraw(gl,r,mvp,sidesData,true,[.10,.31,.62,1]);
 geometryTriangles+=uploadAndDraw(gl,r,mvp,rims,true,[.38,.80,.95,1]);
 geometryTriangles+=uploadAndDraw(gl,r,mvp,lettering,false,[1,1,1,1]);
 gl.disable(gl.BLEND);
}
// Screen-space envelopes are calculated from the ACTUAL 3D plaque corners,
// not an approximate label font size. Pins query these every camera frame.
// Use a conservative inset (2 px) so 3D friends can never puncture the text.
function getProjectedBoxes(){
 const view=window.__RETAILNAV__;
 if(!view?.getState().ready)return [];
 const on=new Set(view.getState().visible),boxes=[];
 for(const area of districts){
  if(!on.has(area.floor))continue;
  const p=view.pinWorld(area.floor,area.x,area.y);
  if(!p)continue;
  const w=Math.max(4,(mall.scale||.12)*(area.widthPx||170))/2;
  const d=Math.max(1.5,(mall.scale||.12)*(area.heightPx||35))/2;
  const low=p[1]+BASE_ROOF_HEIGHT+FLOAT_GAP;
  const high=low+SIGN_THICKNESS+.08;
  const corners=[];
  for(const y of [low,high])for(const dx of [-w,w])for(const dz of [-d,d]){
    const screen=view.projectWorld([p[0]+dx,y,p[2]+dz]);
    if(!screen||screen.w<=0||screen.z<=-1||screen.z>=1){
      corners.length=0;break;
    }
    corners.push(screen);
  }
  if(corners.length!==8)continue;
  const x0=Math.min(...corners.map(q=>q.x));
  const x1=Math.max(...corners.map(q=>q.x));
  const y0=Math.min(...corners.map(q=>q.y));
  const y1=Math.max(...corners.map(q=>q.y));
  if(!Number.isFinite(x0+y0+x1+y1))continue;
  boxes.push({id:area.id,floor:area.floor,x0,y0,x1,y1,
    bottomY:low,topY:high});
 }
 return boxes.concat(window.RetailNavAreaLabels?.getProjectedBoxes?.()||[]);
}
window.RetailNavDistricts={
 draw3D,find,focus,getProjectedBoxes,getAll:()=>districts.slice(),
 getState:()=>({
  count:districts.length,rendered,visibleIds:shown.slice(),
  mode:gpu?'floating-solid-district-3d':'pending',
  cameraFacing:false,screenUprightLabels:window.RetailNavAreaLabels?.getState?.().textUpright===true,
  tiedToFloor:true,
  floorClearance:FLOAT_GAP,
  panelThickness:SIGN_THICKNESS,
  hasPhysicalSides:true,hasBottomFace:true,
  triangles:geometryTriangles,
  positions:positions.map(x=>({...x,center:x.center.slice()})),
  frames,focused,lastError
 })
};
window.__RETAILNAV__?.invalidate?.();
})();
