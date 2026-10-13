/* Real, one-sided shopfront signs in the same WebGL view/projection matrix as
 * the floor meshes. Signs are textured wall QUADS; NEVER camera-facing DOM labels.
 * A unit without an unambiguous facade remains searchable, but is not silently
 * placed on an invented storefront.
 */
(()=>{
'use strict';
const parent=window.RetailNavUnits;
if(!parent)return;
const entries=parent.getUnits?.()||[];
let glState=null,drawn=0,frames=0,visibleCodes=[],lastError='';
const math={};
function shader(gl,kind,source){
 const obj=gl.createShader(kind);gl.shaderSource(obj,source);gl.compileShader(obj);
 if(!gl.getShaderParameter(obj,gl.COMPILE_STATUS)){
  const msg=gl.getShaderInfoLog(obj)||'unknown shader error';
  gl.deleteShader(obj);throw Error(msg);
 }
 return obj;
}
function create(gl){
 const vs=shader(gl,gl.VERTEX_SHADER,
  'attribute vec3 aXYZ;attribute vec2 aUV;uniform mat4 uMVP;'+
  'varying vec2 vUV;void main(){vUV=aUV;gl_Position=uMVP*vec4(aXYZ,1.);}');
 const fs=shader(gl,gl.FRAGMENT_SHADER,
  'precision mediump float;varying vec2 vUV;uniform sampler2D uAtlas;'+
  'void main(){vec4 p=texture2D(uAtlas,vUV);if(p.a<0.18)discard;gl_FragColor=p;}');
 const program=gl.createProgram();
 gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))
  throw Error(gl.getProgramInfoLog(program)||'sign program link failure');
 const usable=entries.filter(u=>u.facade?.a&&u.facade?.b).slice(0,300);
 const cols=8,rows=Math.max(1,Math.ceil(usable.length/cols)),cw=160,ch=70;
 const atlas=document.createElement('canvas');
 atlas.width=cols*cw;atlas.height=rows*ch;
 const ctx=atlas.getContext('2d');
 if(!ctx)throw Error('Canvas unavailable for shopfront signs');
 const cells=new Map();
 for(let i=0;i<usable.length;i++){
  const u=usable[i],col=i%cols,row=Math.floor(i/cols);
  const x=col*cw,y=row*ch,lab=u.code;
  ctx.clearRect(x,y,cw,ch);
  ctx.fillStyle='rgba(4,31,56,.97)';ctx.fillRect(x+4,y+5,cw-8,ch-11);
  ctx.lineWidth=3;ctx.strokeStyle=u.frontStatus==='reviewed-manual'?'#e3f7ff':'#61b1e0';
  ctx.strokeRect(x+5,y+6,cw-10,ch-13);
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#ffffff';ctx.font='800 '+(lab.length>9?'20':'28')+'px system-ui,sans-serif';
  ctx.fillText(lab,x+cw/2,y+(u.name?29:ch/2),cw-14);
  if(u.name){ctx.font='500 12px system-ui,sans-serif';ctx.fillStyle='#d2f0ff';
   ctx.fillText(u.name,x+cw/2,y+51,cw-17);}
  cells.set(u.code,{u0:(x+5)/atlas.width,u1:(x+cw-5)/atlas.width,
    v0:1-(y+5)/atlas.height,v1:1-(y+ch-6)/atlas.height});
 }
 const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas);
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
 const buffer=gl.createBuffer();
 return {gl,program,tex,buffer,cells,usable,attribX:gl.getAttribLocation(program,'aXYZ'),
  attribU:gl.getAttribLocation(program,'aUV'),mvp:gl.getUniformLocation(program,'uMVP'),
  sampler:gl.getUniformLocation(program,'uAtlas'),triangles:0};
}
function quad(data,first,second,top,bottom,uv){
 const a0=[first[0],bottom,first[2]];
 const a1=[first[0],top,first[2]];
 const b0=[second[0],bottom,second[2]];
 const b1=[second[0],top,second[2]];
 // Counterclockwise outward-facing wall quad, with text always upright.
 function push(p,u,v){data.push(...p,u,v);}
 push(a0,uv.u0,uv.v1);push(a1,uv.u0,uv.v0);push(b0,uv.u1,uv.v1);
 push(b0,uv.u1,uv.v1);push(a1,uv.u0,uv.v0);push(b1,uv.u1,uv.v0);
}
function draw3D(gl,mvp){
 const view=window.__RETAILNAV__;
 if(!gl||view?.getState().renderer!=='WebGL')return;
 if(!glState||glState.gl!==gl){
  try{glState=create(gl);lastError='';}catch(e){lastError=String(e?.message||e);return;}
 }
 const state=view.getState(),on=new Set(state.visible);
 const selected=parent.getState().selected;
 const vertices=[];
 drawn=0;frames++;visibleCodes=[];
 for(const u of glState.usable){
  if(!on.has(u.floor)||(!u.facade?.a||!u.facade?.b))continue;
  if(state.distance>240&&u.code!==selected)continue;
  const first=view.pinWorld(u.floor,u.facade.a[0],u.facade.a[1]);
  const second=view.pinWorld(u.floor,u.facade.b[0],u.facade.b[1]);
  if(!first||!second)continue;
  let a=first,b=second;
  const dx=b[0]-a[0],dz=b[2]-a[2];
  if(Math.hypot(dx,dz)<.25)continue;
  // Orient winding so only the facade facing the corridor is visible.
  const normal=u.facade.normal;
  if(normal&&Number.isFinite(normal[0])&&Number.isFinite(normal[1])&&
    dz*normal[0]-dx*normal[1]<0){a=second;b=first;}
  const f=view.floors.find(x=>x.id===u.floor)?.features.find(x=>x.id===u.polygonId);
  const h={anchor:2.2,unit:1.4,zone:.55,corridor:.08}[f?.k]||1.0;
  const bottom=a[1]+Math.max(.11,h*.38);
  const top=bottom+Math.max(.20,Math.min(.55,h*.39));
  const uv=glState.cells.get(u.code);
  if(!uv)continue;
  // Offset outward from the shop wall to avoid depth-buffer Z-fighting.
  const nx=normal?.[0]||dz/Math.hypot(dx,dz);
  const nz=normal?.[1]||-dx/Math.hypot(dx,dz);
  const offset=.14;
  a=[a[0]+nx*offset,a[1],a[2]+nz*offset];
  b=[b[0]+nx*offset,b[1],b[2]+nz*offset];
  quad(vertices,a,b,top,bottom,uv);
  drawn++;visibleCodes.push(u.code);
 }
 if(!vertices.length)return;
 const r=glState;
 gl.useProgram(r.program);gl.uniformMatrix4fv(r.mvp,false,mvp);
 gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,r.tex);
 gl.uniform1i(r.sampler,0);
 gl.bindBuffer(gl.ARRAY_BUFFER,r.buffer);
 gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);
 gl.enableVertexAttribArray(r.attribX);
 gl.vertexAttribPointer(r.attribX,3,gl.FLOAT,false,20,0);
 gl.enableVertexAttribArray(r.attribU);
 gl.vertexAttribPointer(r.attribU,2,gl.FLOAT,false,20,12);
 gl.enable(gl.DEPTH_TEST);
 gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);
 gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
 gl.depthMask(false);
 gl.drawArrays(gl.TRIANGLES,0,vertices.length/5);
 gl.depthMask(true);
 gl.disable(gl.BLEND);
 gl.disable(gl.CULL_FACE);
}
parent.draw3D=draw3D;
parent.getWallState=()=>({renderMode:glState?'world-space-wall-quads':'pending',
 availableFacades:entries.filter(u=>u.facade).length,
 unresolved:entries.filter(u=>!u.facade).length,
 drawn,visibleCodes:visibleCodes.slice(),frames,
 geometryVertices:drawn*6,
 cameraFacing:false,
 backfaceCulled:true,
 lastError});
})();