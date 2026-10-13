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
function draw(){
  if(!ctx||!window.__RETAILNAV__?.getState().ready)return;
  resize();
  const w=viewport.width,h=viewport.height;
  ctx.clearRect(0,0,w,h);
  shown=[];drawn=0;frames++;
  const view=window.__RETAILNAV__,state=view.getState();
  const vis=new Set(state.visible);
  const q=state.q;
  // Camera-facing yaw with an upright-world component prevents flat pins
  // from collapsing when a visitor changes to the top-down view.
  let right=rot(q,[1,0,0]);right=norm([right[0],0,right[2]]);
  let cameraUp=rot(q,[0,1,0]);
  const up=norm([cameraUp[0]*.34,1+cameraUp[1]*.34,cameraUp[2]*.34]);
  const facing=norm(cross(right,up));
  const offset=(o,r,u,d)=>{
    return [o[0]+right[0]*r+up[0]*u+facing[0]*d,
      o[1]+right[1]*r+up[1]*u+facing[1]*d,
      o[2]+right[2]*r+up[2]*u+facing[2]*d];
  };
  const placed=[];
  for(const person of people){
    if(!vis.has(person.position.floor))continue;
    const base=view.pinWorld(person.position.floor,person.position.x,person.position.y);
    if(!base)continue;
    const pinTop=view.projectWorld(offset(base,0,11.6,0));
    const tip=view.projectWorld(offset(base,0,.5,0));
    if(!pinTop||!tip||pinTop.w<=0||tip.w<=0||pinTop.z>=1||tip.z>=1)continue;
    if(Math.min(pinTop.x,tip.x)<-95||Math.max(pinTop.x,tip.x)>w+95||
       Math.min(pinTop.y,tip.y)<-95||Math.max(pinTop.y,tip.y)>h+95)continue;
    placed.push({person,base,depth:tip.z});
  }
  // Painter ordering: far-to-near, with the same world-space vertical levels.
  placed.sort((a,b)=>b.depth-a.depth);
  for(const {person,base} of placed){
    const rgbc=getPalette(person);
    const P=(x,y,z=0)=>view.projectWorld(offset(base,x,y,z));
    const shadow=[];
    for(let i=0;i<32;i++){
      const angle=i*PI/16;
      const world=[base[0]+4.9*Math.cos(angle),base[1]+.13,base[2]+4.1*Math.sin(angle)];
      shadow.push(view.projectWorld(world));
    }
    if(shadow.every(pt=>pt&&pt.w>0&&pt.z<1)){
      const center=view.projectWorld([base[0],base[1]+.13,base[2]]);
      ctx.save();
      ctx.beginPath();
      shadow.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();
      ctx.fillStyle=rgb(rgbc.shadow,.40);ctx.shadowColor=rgb(rgbc.shadow,.85);
      ctx.shadowBlur=11;ctx.fill();ctx.restore();
      if(center){
        ctx.beginPath();shadow.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
        ctx.closePath();ctx.strokeStyle=rgb(rgbc.shadow,.7);ctx.lineWidth=1.2;ctx.stroke();
      }
    }
    // Draw a pseudo-extrusion (same projected world geometry as the foreground).
    function shape(depth){
      const t=P(0,.7,depth),a=P(-2.5,4.6,depth),b=P(-3.5,7.35,depth),
        c=P(-2.2,10.8,depth),top=P(0,11.8,depth),
        d=P(2.2,10.8,depth),e=P(3.5,7.35,depth),
        f=P(2.5,4.6,depth);
      const all=[t,a,b,c,top,d,e,f];
      if(all.some(p=>!p||p.w<=0))return false;
      ctx.beginPath();ctx.moveTo(t.x,t.y);
      ctx.bezierCurveTo(a.x,a.y,b.x,b.y,c.x,c.y);
      ctx.quadraticCurveTo(top.x,top.y,d.x,d.y);
      ctx.bezierCurveTo(e.x,e.y,f.x,f.y,t.x,t.y);
      ctx.closePath();
      return {t,top};
    }
    ctx.save();
    const back=shape(-.75);
    if(back){ctx.fillStyle=darker(rgbc.body,.38);ctx.fill();}
    const front=shape(.75);
    if(!front){ctx.restore();continue;}
    const grad=ctx.createLinearGradient(front.top.x,front.top.y,front.t.x,front.t.y);
    grad.addColorStop(0,col(rgbc.rim,'#f5ffff'));
    grad.addColorStop(.12,rgbc.body);
    grad.addColorStop(.60,rgbc.body);
    grad.addColorStop(1,darker(rgbc.body,.58));
    ctx.fillStyle=grad;ctx.shadowColor=rgb(rgbc.body,.55);ctx.shadowBlur=8;ctx.fill();
    ctx.shadowBlur=0;ctx.lineWidth=1.9;ctx.strokeStyle=rgbc.rim;ctx.stroke();
    // Face image mapped into an actual world-space circular plane. The
    // perspective transform uses the projected 3D basis vectors each frame.
    const head=P(0,8.18,1.0),rx=P(2.35,8.18,1.0),ry=P(0,10.53,1.0);
    if(head&&rx&&ry){
      const X=[rx.x-head.x,rx.y-head.y],Y=[ry.x-head.x,ry.y-head.y];
      const area=Math.abs(X[0]*Y[1]-X[1]*Y[0]);
      if(area>8){
        ctx.save();
        ctx.translate(head.x,head.y);
        // Positive canvas local Y is "down"; world local up points opposite.
        ctx.transform(X[0],X[1],-Y[0],-Y[1],0,0);
        ctx.beginPath();ctx.arc(0,0,1,0,2*PI);ctx.closePath();ctx.clip();
        ctx.fillStyle='#152b42';ctx.fillRect(-1.1,-1.1,2.2,2.2);
        const image=loadPicture(person);
        if(image?.loaded)ctx.drawImage(image.img,-1,-1,2,2);
        else{
          ctx.fillStyle='#f5faff';ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.font='.95px sans-serif';ctx.fillText(person.name.slice(0,1).toUpperCase(),0,.03);
        }
        ctx.restore();
        ctx.beginPath();
        for(let i=0;i<=40;i++){
          const theta=i*PI/20;
          const p=P(2.45*Math.cos(theta),8.18+2.45*Math.sin(theta),1.05);
          if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
        }
        ctx.closePath();ctx.strokeStyle=rgbc.rim;ctx.lineWidth=2.2;
        ctx.shadowColor='#0c1c2c';ctx.shadowBlur=3;ctx.stroke();ctx.shadowBlur=0;
      }
    }
    // A tiny dimensional metallic highlight on the left side of the pin.
    const shine=P(-2.6,9.4,1.25),shine2=P(-2.95,7.5,1.25);
    if(shine&&shine2){ctx.beginPath();ctx.moveTo(shine.x,shine.y);ctx.lineTo(shine2.x,shine2.y);
      ctx.strokeStyle='rgba(255,255,255,.75)';ctx.lineWidth=1.5;ctx.stroke();}
    ctx.restore();
    const tip=P(0,.5,.76);
    if(tip){
      // A readable name-tag below the rendered pin, not a replacement for it.
      const first=person.name.split(' ')[0];
      const label=first+(person.demo?' · DEMO':'');
      ctx.save();ctx.font='600 10px -apple-system,BlinkMacSystemFont,sans-serif';
      const width=Math.min(108,ctx.measureText(label).width+16);
      const ty=Math.min(h-15,tip.y+12),tx=Math.max(width/2+4,Math.min(w-width/2-4,tip.x));
      ctx.fillStyle='rgba(8,22,36,.88)';
      ctx.beginPath();ctx.roundRect(tx-width/2,ty-11,width,18,9);ctx.fill();
      ctx.strokeStyle=rgb(rgbc.body,.9);ctx.lineWidth=1;ctx.stroke();
      ctx.textBaseline='middle';ctx.textAlign='center';ctx.fillStyle='#fff';
      ctx.fillText(label,tx,ty-2,Math.max(15,width-11));ctx.restore();
    }
    drawn++;
    shown.push(person.id);
  }
}
window.RetailNavPins={setPeople:updatePeople,draw,getState:()=>({
  registered:people.length,drawn,visibleIds:shown.slice(),frames,
  canvasWidth:el?.width||0,canvasHeight:el?.height||0,
  floors:people.map(p=>p.position.floor),
  colorPairs:people.map(p=>[p.id,getPalette(p)])
})};
})();