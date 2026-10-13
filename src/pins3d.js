/* RetailNav 3D avatar pins: world-anchored projected vector geometry.
 * One transparent 2D overlay canvas (no PNG sprites, no per-pin DOM loops).
 * Body and ground shadow are projected from the same 3D indoor frame as
 * the mall: one source of position data works for mock and real contacts.
 * Headshots are separate images in texture cache; base/shadow/rim colors
 * are independently configurable for each person and shopping palette.
 */
(()=>{
'use strict';
const el=document.getElementById('peoplePinCanvas');
const ctx=el?.getContext('2d',{alpha:true,desynchronized:true})||null;
const PI=Math.PI;
let people=[],shown=[],drawn=0,frames=0,viewport={width:0,height:0,dpr:1};
const pictures=new Map();
const colorsDefault=()=>window.RETAILNAV_MARKER_PALETTE||{};
const validHex=v=>typeof v==='string'&&/^#[0-9a-fA-F]{6}$/.test(v);
const col=(v,fallback)=>validHex(v)?v:fallback;
const norm=v=>{const mag=Math.hypot(...v)||1;return v.map(x=>x/mag);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function rot(q,v){
  const qv=q.slice(0,3);
  const t=cross(qv,v).map(n=>2*n);
  const w=cross(qv,t);
  return v.map((n,i)=>n+t[i]*q[3]+w[i]);
}
function getPalette(person){
  const base=colorsDefault();
  const p={...(person.visual||{}),...(base.byPerson?.[person.id]||{})};
  return {body:col(p.bodyColor,base.defaultBodyColor||'#65e6e0'),
    shadow:col(p.shadowColor,base.defaultShadowColor||'#25627c'),
    rim:col(p.rimColor,base.defaultRimColor||'#e8ffff')};
}
function darker(color,factor=.53){
  return '#'+[1,3,5].map(i=>
    Math.round(parseInt(color.slice(i,i+2),16)*factor).toString(16).padStart(2,'0')).join('');
}
function rgb(color,alpha){const n=parseInt(color.slice(1),16);return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+alpha+')';}
function loadPicture(person){
  if(!person.avatarUrl)return null;
  const key=person.id+'@'+person.avatarUrl;
  if(pictures.has(key))return pictures.get(key);
  const img=new Image();
  const v={img,loaded:false,error:false};
  pictures.set(key,v);
  img.onload=()=>{
    v.loaded=img.naturalWidth>0;
    window.__RETAILNAV__?.invalidate?.();
  };
  img.onerror=()=>{
    v.error=true;
    window.__RETAILNAV__?.invalidate?.();
  };
  img.decoding='async';
  img.src=person.avatarUrl;
  return v;
}
function updatePeople(records){
  people=records.filter(p=>
    p&&p.position&&['LL','UL','L3'].includes(p.position.floor)&&
    Number.isFinite(p.position.x)&&Number.isFinite(p.position.y));
  // Do not hold on to images of revoked contacts; release their cache entries.
  const keep=new Set(people.map(p=>p.id+'@'+(p.avatarUrl||'')));
  for(const key of pictures.keys())if(!keep.has(key))pictures.delete(key);
  for(const person of people)loadPicture(person);
  window.__RETAILNAV__?.invalidate?.();
}
function resize(){
  if(!el||!ctx)return;
  const rect=el.getBoundingClientRect();
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const width=Math.max(1,Math.round(rect.width*dpr));
  const height=Math.max(1,Math.round(rect.height*dpr));
  if(width!==el.width||height!==el.height){el.width=width;el.height=height;}
  viewport={width:rect.width,height:rect.height,dpr};
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
// Proportions reproduced from the blue reference pin: rounded 3D shell,
// porcelain-white inset rim, centred photographic portrait and soft cyan halo.
// Canvas geometry is camera-facing and has a predictable CSS-pixel footprint;
// the sharp point always coincides with the projected floor location.
const DESIGN='blue-reference-photographic-v1';
function blueSilhouette(){
  ctx.beginPath();
  ctx.moveTo(0,0);
  ctx.bezierCurveTo(-9,-17,-39,-59,-47,-83);
  ctx.bezierCurveTo(-60,-122,-34,-149,0,-149);
  ctx.bezierCurveTo(34,-149,60,-122,47,-83);
  ctx.bezierCurveTo(39,-59,9,-17,0,0);
  ctx.closePath();
}
function paintPin(person,x,y,selected){
  const scale=viewport.width<520?.61:.73;
  ctx.save();
  ctx.translate(x,y);
  // A subdued, neutral ground shadow under the exact position anchor.
  ctx.beginPath();
  ctx.ellipse(0,0,29*scale,5*scale,0,0,2*PI);
  ctx.fillStyle='rgba(6,20,37,.25)';
  ctx.shadowColor='rgba(3,17,31,.45)';
  ctx.shadowBlur=8*scale;
  ctx.fill();
  ctx.shadowBlur=0;
  ctx.scale(scale,scale);

  // Rounded metallic-blue teardrop with a soft cyan glow.
  const shell=ctx.createLinearGradient(-50,-114,49,-32);
  shell.addColorStop(0,'#3b80c6');
  shell.addColorStop(.17,'#76b7f7');
  shell.addColorStop(.41,'#65aaf0');
  shell.addColorStop(.72,'#5096e2');
  shell.addColorStop(1,'#2872bf');
  blueSilhouette();
  ctx.save();
  ctx.shadowColor=selected?'rgba(107,241,255,.80)':'rgba(115,218,254,.52)';
  ctx.shadowBlur=selected?25:15;
  ctx.fillStyle=shell;
  ctx.fill();
  ctx.restore();
  blueSilhouette();
  ctx.strokeStyle='rgba(193,226,255,.50)';
  ctx.lineWidth=1.4;
  ctx.stroke();

  // Soft diffuse upper lighting and lower body shading, clipped to the shell.
  ctx.save();
  blueSilhouette();
  ctx.clip();
  const topLight=ctx.createRadialGradient(-18,-139,5,-6,-112,88);
  topLight.addColorStop(0,'rgba(240,250,255,.30)');
  topLight.addColorStop(.60,'rgba(175,214,254,.07)');
  topLight.addColorStop(1,'rgba(19,75,152,0)');
  ctx.fillStyle=topLight;
  ctx.fillRect(-58,-151,116,154);
  const edgeLight=ctx.createLinearGradient(-51,-98,49,-94);
  edgeLight.addColorStop(0,'rgba(20,70,138,.30)');
  edgeLight.addColorStop(.14,'rgba(235,248,255,.10)');
  edgeLight.addColorStop(.65,'rgba(255,255,255,0)');
  edgeLight.addColorStop(1,'rgba(15,68,135,.18)');
  ctx.fillStyle=edgeLight;
  ctx.fillRect(-54,-149,108,153);
  ctx.restore();

  // Three-dimensional recessed white bezel. Reference ring is deliberately
  // substantially thicker than the narrow outline of the old map pin.
  const cy=-99;
  ctx.save();
  ctx.shadowColor='rgba(20,59,110,.46)';
  ctx.shadowBlur=8;
  ctx.shadowOffsetY=3;
  const outer=ctx.createLinearGradient(-32,cy-35,36,cy+37);
  outer.addColorStop(0,'#f9faf7');
  outer.addColorStop(.25,'#e5e9e9');
  outer.addColorStop(.52,'#ffffff');
  outer.addColorStop(.84,'#d1d7d9');
  outer.addColorStop(1,'#f6f9fb');
  ctx.beginPath();
  ctx.arc(0,cy,34.5,0,PI*2);
  ctx.fillStyle=outer;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0,cy,32.2,0,PI*2);
  ctx.strokeStyle='rgba(103,128,148,.25)';
  ctx.lineWidth=1.1;
  ctx.stroke();
  const inner=ctx.createLinearGradient(0,cy-30,0,cy+30);
  inner.addColorStop(0,'#ffffff');
  inner.addColorStop(.60,'#f4f7f7');
  inner.addColorStop(1,'#c7cfd3');
  ctx.beginPath();
  ctx.arc(0,cy,30.5,0,PI*2);
  ctx.fillStyle=inner;
  ctx.fill();

  // Replace the picture with each user's actual avatar texture.
  const radius=25.1, asset=loadPicture(person);
  ctx.save();
  ctx.beginPath();
  ctx.arc(0,cy,radius,0,2*PI);
  ctx.clip();
  ctx.fillStyle='#edf1f5';
  ctx.fillRect(-radius,cy-radius,radius*2,radius*2);
  if(asset?.loaded){
    const img=asset.img;
    const side=Math.min(img.naturalWidth,img.naturalHeight);
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality='high';
    ctx.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,
      side,side,-radius,cy-radius,radius*2,radius*2);
  }else{
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillStyle='#385c7d';
    ctx.font='700 24px sans-serif';
    ctx.fillText((person.name||'?').slice(0,1).toUpperCase(),0,cy);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0,cy,radius+.8,0,2*PI);
  ctx.strokeStyle='rgba(255,255,255,.97)';
  ctx.lineWidth=1.45;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0,cy,34.5,PI*1.07,PI*1.70);
  ctx.strokeStyle='rgba(255,255,255,.54)';
  ctx.lineWidth=1.7;
  ctx.stroke();
  ctx.restore();
}
function draw(){
  const view=window.__RETAILNAV__;
  if(!ctx||!view?.getState().ready)return;
  resize();
  const w=viewport.width,h=viewport.height;
  ctx.clearRect(0,0,w,h);
  shown=[];drawn=0;frames++;
  const vis=new Set(view.getState().visible);
  const placements=[];
  for(const person of people){
    if(!vis.has(person.position.floor))continue;
    const world=view.pinWorld(person.position.floor,person.position.x,person.position.y);
    if(!world)continue;
    const tip=view.projectWorld([world[0],world[1]+.35,world[2]]);
    if(!tip||tip.w<=0||tip.z>=1||tip.z<=-1)continue;
    if(tip.x<-52||tip.x>w+52||tip.y<-8||tip.y>h+12)continue;
    placements.push({person,x:tip.x,y:tip.y,depth:tip.z});
  }
  placements.sort((a,b)=>b.depth-a.depth);
  const focused=window.RetailNavFocusedFriendId;
  for(const pin of placements){
    paintPin(pin.person,pin.x,pin.y,pin.person.id===focused);
    drawn++;
    shown.push(pin.person.id);
  }
}

window.RetailNavPins={setPeople:updatePeople,draw,getState:()=>({
  registered:people.length,drawn,visibleIds:shown.slice(),frames,
  canvasWidth:el?.width||0,canvasHeight:el?.height||0,
  floors:people.map(p=>p.position.floor),
  colorPairs:people.map(p=>[p.id,getPalette(p)]),
  photoLoaded:people.filter(p=>pictures.get(p.id+'@'+p.avatarUrl)?.loaded).length,
  photoErrors:people.filter(p=>pictures.get(p.id+'@'+p.avatarUrl)?.error).length,
  design:DESIGN
})};
})();