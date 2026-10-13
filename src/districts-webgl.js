/* District titles transcribed from the photographed AP Plaza floor guide.
 * A district label is not a shop or an invented store polygon. These are
 * textured horizontal WebGL quads in the SAME WORLD COORDINATES as the mall.
 * They move, tilt and rotate with the floor and remain searchable by name.
 */
(()=>{
'use strict';
const mall=window.RETAILNAV_ACTIVE_MALL||{};
const districts=Array.isArray(mall.districts)?mall.districts:[];
let gpu=null,shown=[],drawn=0,frames=0,lastError='',focused=null;
const normal=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const matches=q=>districts.filter(d=>normal(d.name+' '+(d.detail||'')).includes(normal(q)));
function focus(id){
 const d=districts.find(d=>d.id===id);
 if(!d)return false;
 focused=id;
 window.__RETAILNAV__?.focusAt?.(d.floor,[d.x,d.y],100);
 window.__RETAILNAV__?.invalidate?.();
 return true;
}
function shader(gl,type,source){
 const obj=gl.createShader(type);gl.shaderSource(obj,source);gl.compileShader(obj);
 if(!gl.getShaderParameter(obj,gl.COMPILE_STATUS)){
  const msg=gl.getShaderInfoLog(obj)||'unknown shader error';
  gl.deleteShader(obj);throw Error(msg);
 }
 return obj;
}
function init(gl){
 const vertex=shader(gl,gl.VERTEX_SHADER,
 'attribute vec3 aPos;attribute vec2 aUv;uniform mat4 uMVP;'+
 'varying vec2 vUv;void main(){vUv=aUv;gl_Position=uMVP*vec4(aPos,1.);}');
 const fragment=shader(gl,gl.FRAGMENT_SHADER,
 'precision mediump float;uniform sampler2D uTexture;varying vec2 vUv;'+
 'void main(){vec4 c=texture2D(uTexture,vUv);if(c.a<.15)discard;gl_FragColor=c;}');
 const program=gl.createProgram();
 gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
 const cw=344,ch=84,cols=4,rows=Math.max(1,Math.ceil(districts.length/cols));
 const canvas=document.createElement('canvas');
 canvas.width=cw*cols;canvas.height=ch*rows;
 const ctx=canvas.getContext('2d');
 if(!ctx)throw Error('District text canvas unavailable');
 const cells=new Map();
 for(let i=0;i<districts.length;i++){
  const d=districts[i],x=(i%cols)*cw,y=Math.floor(i/cols)*ch;
  // Translucent plaque distinguishes districts from the blue shop name signs.
  ctx.clearRect(x,y,cw,ch);
  const fill=ctx.createLinearGradient(x,y,x,y+ch);
  fill.addColorStop(0,'rgba(11,40,63,.87)');
  fill.addColorStop(1,'rgba(7,29,48,.93)');
  ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x+3,y+4,cw-6,ch-8,12);ctx.fill();
  ctx.strokeStyle='rgba(118,229,240,.78)';ctx.lineWidth=2;ctx.stroke();
  ctx.fillStyle='#eafaff';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font='750 '+(d.name.length>22?20:26)+'px system-ui, sans-serif';
  ctx.fillText(d.name,x+cw/2,y+31,cw-20);
  if(d.detail){
   ctx.font='500 14px system-ui, sans-serif';ctx.fillStyle='#c7d8dd';
   ctx.fillText(d.detail,x+cw/2,y+59,cw-20);
  }
  cells.set(d.id,{u0:(x+2)/canvas.width,u1:(x+cw-2)/canvas.width,
    v0:1-(y+2)/canvas.height,v1:1-(y+ch-2)/canvas.height});
 }
 const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
 return {gl,program,tex,cells,buffer:gl.createBuffer(),
  pos:gl.getAttribLocation(program,'aPos'),uv:gl.getAttribLocation(program,'aUv'),
  mvp:gl.getUniformLocation(program,'uMVP'),
  sampler:gl.getUniformLocation(program,'uTexture')};
}
function add(arr,p,u,v){arr.push(p[0],p[1],p[2],u,v);}
function draw3D(gl,mvp){
 const view=window.__RETAILNAV__;
 if(!gl||!view?.getState().ready||!districts.length)return;
 if(!gpu||gpu.gl!==gl){
  try{gpu=init(gl);lastError='';}catch(e){lastError=String(e?.message||e);return;}
 }
 const state=view.getState(),on=new Set(state.visible);
 drawn=0;frames++;shown=[];
 const vertices=[];
 for(const district of districts){
  if(!on.has(district.floor))continue;
  const world=view.pinWorld(district.floor,district.x,district.y);
  if(!world)continue;
  const cell=gpu.cells.get(district.id);if(!cell)continue;
  const width=(mall.scale||.12)*(district.widthPx||170);
  const height=(mall.scale||.12)*(district.heightPx||35);
  // Above the tallest anchor roof (2.2) so the original printed title is
  // legible over shops, but follows their map-plane orientation (never faces camera).
  const y=world[1]+2.31;
  const hw=width/2,hh=height/2;
  const a=[world[0]-hw,y,world[2]-hh],b=[world[0]+hw,y,world[2]-hh],
    c=[world[0]+hw,y,world[2]+hh],d=[world[0]-hw,y,world[2]+hh];
  add(vertices,a,cell.u0,cell.v1);add(vertices,c,cell.u1,cell.v0);add(vertices,b,cell.u1,cell.v1);
  add(vertices,a,cell.u0,cell.v1);add(vertices,d,cell.u0,cell.v0);add(vertices,c,cell.u1,cell.v0);
  drawn++;shown.push(district.id);
 }
 if(!vertices.length)return;
 const r=gpu;
 gl.useProgram(r.program);gl.uniformMatrix4fv(r.mvp,false,mvp);
 gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,r.tex);
 gl.uniform1i(r.sampler,0);gl.bindBuffer(gl.ARRAY_BUFFER,r.buffer);
 gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);
 gl.enableVertexAttribArray(r.pos);gl.vertexAttribPointer(r.pos,3,gl.FLOAT,false,20,0);
 gl.enableVertexAttribArray(r.uv);gl.vertexAttribPointer(r.uv,2,gl.FLOAT,false,20,12);
 gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);
 gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
 gl.depthMask(false);gl.drawArrays(gl.TRIANGLES,0,vertices.length/5);
 gl.depthMask(true);gl.disable(gl.BLEND);
}
window.RetailNavDistricts={
 draw3D,find:matches,focus,getAll:()=>districts.slice(),
 getState:()=>({count:districts.length,rendered:drawn,visibleIds:shown.slice(),
  mode:gpu?'fixed-to-world-horizontal-3d':'pending',
  cameraFacing:false,frames,focused,lastError})
};
})();