/* RetailNav roof labels + 3D raised signs.
 * Every sign belongs to one uniquely matched shop roof in world space.
 * Regular code/name is printed on the roof. A selected, searched or featured
 * shop has an illuminated, solid double-sided panel physically attached to
 * that same roof by two posts. Nothing is a screen-facing HTML billboard.
 */
(()=>{
'use strict';
const unitsApi=window.RetailNavUnits;
if(!unitsApi)return;
const entries=unitsApi.getUnits?.()||[];
let resource=null,frames=0,drawnRoof=0,drawnRaised=0,visibleCodes=[],lastError='';
const roofEntries=entries.filter(u=>u.roof&&u.polygonId);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function shader(gl,type,src){
 const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
 if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){
  const message=gl.getShaderInfoLog(s)||'invalid shader';
  gl.deleteShader(s);throw Error(message);
 }
 return s;
}
function program(gl){
 const vertex=shader(gl,gl.VERTEX_SHADER,
  'attribute vec3 aXYZ;attribute vec2 aUV;uniform mat4 uMVP;'+
  'varying vec2 vUV;void main(){vUV=aUV;gl_Position=uMVP*vec4(aXYZ,1.);}');
 const fragment=shader(gl,gl.FRAGMENT_SHADER,
  'precision mediump float;varying vec2 vUV;uniform sampler2D uAtlas;'+
  'uniform int uSolid;uniform vec4 uColour;void main(){'+
  'vec4 c=uSolid==1?uColour:texture2D(uAtlas,vUV);'+
  'if(c.a<0.12)discard;gl_FragColor=c;}');
 const p=gl.createProgram();
 gl.attachShader(p,vertex);gl.attachShader(p,fragment);gl.linkProgram(p);
 if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
 return {p,pos:gl.getAttribLocation(p,'aXYZ'),uv:gl.getAttribLocation(p,'aUV'),
  mvp:gl.getUniformLocation(p,'uMVP'),sampler:gl.getUniformLocation(p,'uAtlas'),
  solid:gl.getUniformLocation(p,'uSolid'),colour:gl.getUniformLocation(p,'uColour')};
}
function create(gl){
 const shaderProgram=program(gl);
 const cw=192,ch=85;
 const maxTexture=gl.getParameter(gl.MAX_TEXTURE_SIZE)||4096;
 const cols=Math.max(1,Math.min(8,Math.floor(maxTexture/cw)));
 const maxRows=Math.max(1,Math.floor(maxTexture/ch));
 // Use every mapped store that fits the actual GPU texture limit; every
 // search match still has a source-linked textual result and DOM badge.
 const items=roofEntries.slice(0,cols*maxRows);
 const rows=Math.max(1,Math.ceil(items.length/cols));
 const atlas=document.createElement('canvas');
 atlas.width=cw*cols;atlas.height=ch*rows;
 const ctx=atlas.getContext('2d');
 if(!ctx)throw Error('Cannot build text atlas');
 const cells=new Map();
 for(let i=0;i<items.length;i++){
  const item=items[i],col=i%cols,row=Math.floor(i/cols);
  const x=col*cw,y=row*ch;
  ctx.clearRect(x,y,cw,ch);
  // Modern slightly glossy blue/graphite sign, white writing and cyan edges.
  const background=ctx.createLinearGradient(x,y,x+cw,y+ch);
  background.addColorStop(0,'#14334e');
  background.addColorStop(.45,'#184966');
  background.addColorStop(1,'#092539');
  ctx.fillStyle=background;
  ctx.beginPath();ctx.roundRect(x+3,y+4,cw-6,ch-8,14);ctx.fill();
  ctx.lineWidth=3.6;ctx.strokeStyle='#a1f0ff';ctx.stroke();
  ctx.lineWidth=1;ctx.strokeStyle='#e4fbff';
  ctx.beginPath();ctx.roundRect(x+7,y+8,cw-14,ch-16,11);ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,.11)';
  ctx.beginPath();ctx.roundRect(x+12,y+12,cw-24,11,6);ctx.fill();
  const name=(item.name||'').trim();
  const code=item.code;
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#ffffff';
  if(name){
   ctx.font='800 '+(name.length>14?'19':'24')+'px system-ui,sans-serif';
   const parts=name.split(/\s+/).filter(Boolean);
   if(parts.length>1){
    const left=parts[0],right=parts.slice(1).join(' ');
    const total=ctx.measureText(left+' '+right).width;
    const available=Math.min(total,cw-26),start=x+cw/2-available/2;
    ctx.textAlign='left';
    ctx.fillStyle='#f6fbff';
    ctx.fillText(left,start,y+34,cw-35);
    ctx.fillStyle='#ffbd64';
    ctx.fillText(' '+right,start+Math.min(ctx.measureText(left).width,cw*.49),y+34,cw*.51);
    ctx.textAlign='center';
   }else{
    ctx.fillStyle='#f6fbff';
    ctx.fillText(name,x+cw/2,y+34,cw-22);
   }
   ctx.font='700 18px system-ui,sans-serif';
   ctx.fillStyle='#ffcb80';
   ctx.fillText(code,x+cw/2,y+62,cw-24);
  }else{
   ctx.font='800 '+(code.length>9?'27':'34')+'px system-ui,sans-serif';
   ctx.fillText(code,x+cw/2,y+ch/2,cw-22);
  }
  cells.set(item.storeId||(item.floor+':'+item.code),{u0:(x+2)/atlas.width,u1:(x+cw-2)/atlas.width,
   v0:1-(y+2)/atlas.height,v1:1-(y+ch-2)/atlas.height});
 }
 const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas);
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
 return {gl,...shaderProgram,tex,cells,items,
  buffer:gl.createBuffer()};
}
function add(data,p,u=.5,v=.5){data.push(p[0],p[1],p[2],u,v);}
function triangle(data,a,b,c,ua,ub,uc){
 add(data,a,ua?.[0],ua?.[1]);add(data,b,ub?.[0],ub?.[1]);
 add(data,c,uc?.[0],uc?.[1]);
}
function rectangle(data,a,b,c,d,cell){
 const uv=cell||{u0:0,u1:1,v0:1,v1:0};
 triangle(data,a,b,d,[uv.u0,uv.v1],[uv.u1,uv.v1],[uv.u0,uv.v0]);
 triangle(data,b,c,d,[uv.u1,uv.v1],[uv.u1,uv.v0],[uv.u0,uv.v0]);
}
function vec(p,a,b,c){return [p[0]+a[0]*b+c[0],p[1]+a[1]*b+c[1],p[2]+a[2]*b+c[2]];}
function planar(center,axis,side,halfW,halfD){
 const corner=(a,b)=>[
  center[0]+axis[0]*a+side[0]*b,center[1],
  center[2]+axis[2]*a+side[2]*b];
 return [corner(-halfW,-halfD),corner(halfW,-halfD),
         corner(halfW,halfD),corner(-halfW,halfD)];
}
function upright(center,axis,side,halfW,halfH,offset=0){
 const base=[center[0]+side[0]*offset,center[1],center[2]+side[2]*offset];
 const corner=(h,k)=>[base[0]+axis[0]*h,base[1]+k,base[2]+axis[2]*h];
 return [corner(-halfW,-halfH),corner(halfW,-halfH),
         corner(halfW,halfH),corner(-halfW,halfH)];
}
function box(data,center,axis,side,halfW,halfH,halfT){
 const front=upright(center,axis,side,halfW,halfH,halfT);
 const back=upright(center,axis,side,halfW,halfH,-halfT);
 rectangle(data,...front);
 rectangle(data,back[1],back[0],back[3],back[2]);
 for(let i=0;i<4;i++){
  const j=(i+1)%4;
  rectangle(data,front[i],front[j],back[j],back[i]);
 }
}
function spotlight(data,roof,axis,side,width,cell){
 const hw=width/2,hh=width*.26;
 // Panel bottom is always flush with the single, centered support stem.
 // The stem starts at the roof (no floating, unattached sign).
 const panelBottom=1.57;
 const centre=[roof[0],roof[1]+panelBottom+hh,roof[2]];
 const postCenter=[roof[0],roof[1]+panelBottom/2,roof[2]];
 box(data.posts,postCenter,axis,side,.075,panelBottom/2,.092);
 // Solid deep blue rear shell, with bright cyan trim inset under the text.
 box(data.body,centre,axis,side,hw+.12,hh+.13,.20);
 const front=upright(centre,axis,side,hw+.025,hh+.025,.240);
 const back=upright(centre,axis,side,hw+.025,hh+.025,-.240);
 rectangle(data.trim,...front);
 rectangle(data.trim,back[1],back[0],back[3],back[2]);
 const f=upright(centre,axis,side,hw,hh,.256);
 const b=upright(centre,axis,side,hw,hh,-.256);
 rectangle(data.text,...f,cell);
 rectangle(data.text,b[1],b[0],b[3],b[2],cell);
 // Short base plate visually seats the posts on the roof surface.
 const baseCenter=[roof[0],roof[1]+.08,roof[2]];
 box(data.posts,baseCenter,axis,side,hw*.64,.09,.18);
}
function gpuDraw(gl,r,mvp,buffer,vertices,material,colour){
 if(!vertices.length)return;
 gl.useProgram(r.p);
 gl.uniformMatrix4fv(r.mvp,false,mvp);
 gl.uniform1i(r.solid,material);
 gl.uniform4fv(r.colour,new Float32Array(colour));
 gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,r.tex);
 gl.uniform1i(r.sampler,0);
 gl.bindBuffer(gl.ARRAY_BUFFER,r.buffer);
 gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);
 gl.enableVertexAttribArray(r.pos);
 gl.vertexAttribPointer(r.pos,3,gl.FLOAT,false,20,0);
 gl.enableVertexAttribArray(r.uv);
 gl.vertexAttribPointer(r.uv,2,gl.FLOAT,false,20,12);
 gl.drawArrays(gl.TRIANGLES,0,vertices.length/5);
}
function render(gl,mvp){
 const view=window.__RETAILNAV__;
 if(!gl||view?.getState().renderer!=='WebGL')return;
 if(!resource||resource.gl!==gl){
  try{resource=create(gl);lastError='';}catch(e){lastError=String(e?.message||e);return;}
 }
 const state=view.getState();
 const visibleFloors=new Set(state.visible);
 const highlights=new Set(unitsApi.getHighlightedStoreIds?.()||[]);
 const selected=state.selectedCode??unitsApi.getState().selected;
 const regular=[],special={posts:[],body:[],trim:[],text:[]};
 drawnRoof=0;drawnRaised=0;frames++;visibleCodes=[];
 let autoFeatured=0,raisedCount=0;
 for(const u of resource.items){
  if(!visibleFloors.has(u.floor))continue;
  const roof=u.roof;
  const unit=view.floors.find(f=>f.id===u.floor)?.features.find(f=>f.id===u.polygonId);
  if(!unit||!roof)continue;
  const key=u.storeId||(u.floor+':'+u.code);
  const cell=resource.cells.get(key);if(!cell)continue;
  const floorWorld=view.pinWorld(u.floor,roof.x,roof.y);
  if(!floorWorld)continue;
  const roofY={anchor:2.2,unit:1.4,zone:.55,corridor:.08}[unit.k]??1.4;
  const top=[floorWorld[0],floorWorld[1]+roofY+.09,floorWorld[2]];
  const dx=roof.axis[0],dz=roof.axis[1];
  const len=Math.hypot(dx,dz);
  if(len<.2)continue;
  const axis=[dx/len,0,dz/len],side=[-axis[2],0,axis[0]];
  const pxToWorld=window.RETAILNAV_ACTIVE_MALL?.scale||.12;
  const halfW=clamp((roof.widthPixels||10)*pxToWorld*.5,.22,1.35);
  const surface=planar(top,axis,side,halfW,halfW*.43);
  if(state.distance<=230||key===selected||highlights.has(key)){
   rectangle(regular,surface[0],surface[1],surface[2],surface[3],cell);
   drawnRoof++;visibleCodes.push(u.code);
  }
  const requested=highlights.has(key)||key===selected;
  const feature=Boolean(u.featured||(u.name&&u.name.length>0));
  if(requested||feature&&autoFeatured<3){
   if(raisedCount>=7&&!requested)continue;
   const mappedWidth=(roof.widthPixels||10)*pxToWorld;
   const panelWidth=clamp(Math.min(state.distance*.018,mappedWidth*.96),1.35,3.5);
   // Use the same physical roof midpoint as the ordinary lettering.
   spotlight(special,top,axis,side,panelWidth,cell);
   raisedCount++;drawnRaised++;
   if(feature&&!requested)autoFeatured++;
  }
 }
 if(!regular.length&&!raisedCount)return;
 const r=resource;
 gl.enable(gl.DEPTH_TEST);
 gl.disable(gl.CULL_FACE);
 gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
 gpuDraw(gl,r,mvp,r.buffer,special.posts,1,[.21,.46,.62,1]);
 gpuDraw(gl,r,mvp,r.buffer,special.body,1,[.07,.24,.39,1]);
 gpuDraw(gl,r,mvp,r.buffer,special.trim,1,[.40,.82,.97,1]);
 gpuDraw(gl,r,mvp,r.buffer,regular,0,[1,1,1,1]);
 gpuDraw(gl,r,mvp,r.buffer,special.text,0,[1,1,1,1]);
 gl.disable(gl.BLEND);
}
unitsApi.draw3D=render;
unitsApi.getRoofState=()=>({
 renderMode:resource?'world-space-textured-roof-and-raised-3d':'pending',
 roofLabels:drawnRoof,raised:drawnRaised,
 labelledRoofs:roofEntries.length,
 unmatched:entries.length-roofEntries.length,
 visibleCodes:visibleCodes.slice(),frames,
 raisedHasPhysicalPosts:true,raisedHasExtrudedBody:true,
 followsMapCamera:true,cameraFacing:false,lastError
});
unitsApi.getWallState=unitsApi.getRoofState;
window.__RETAILNAV__?.invalidate?.();
})();