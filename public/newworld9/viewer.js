(()=>{'use strict';
const $=id=>document.getElementById(id), canvas=$('map'),ctx=canvas.getContext('2d',{alpha:false}),paint={shop:'#8dd3ec',escalator:'#ffda38',elevator:'#ff9e3d',toilet:'#25e2ea',exit:'#57e17a'};
let model=null,choice='ALL',mode='3D',zoom=.95,yaw=-.45,pitch=.72,panX=0,panY=0,photoMode=false,selected=null,query='',size={w:800,h:700},rendered=[],images={},activePointers=new Map(),gesture=null,hadMove=false,dirty=true;
const FRICTION=.05;const lookup=new Map();
function clamp(x,lo,hi){return Math.max(lo,Math.min(hi,x));}
function normalize(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function floorNum(level){return Number(level.replace('L',''));}
function rgba(hex,alpha){const q=hex.replace('#','');return `rgba(${parseInt(q.substring(0,2),16)},${parseInt(q.substring(2,4),16)},${parseInt(q.substring(4,6),16)},${alpha})`;}
function floorRect(l){const b=l.bounds;return [[b[0],b[2]],[b[1],b[2]],[b[1],b[3]],[b[0],b[3]]];}
function setCanvasSize(){const b=canvas.getBoundingClientRect();size.w=b.width;size.h=b.height;const d=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(size.w*d);canvas.height=Math.round(size.h*d);ctx.setTransform(d,0,0,d,0,0);dirty=true;}
function proj(p,floor,offsetY=0){
 const cx=(p[0]-680)*.107,cz=(p[1]-355)*.107,y=(floorNum(floor)-1)*9.8+offsetY;
 const rx=Math.cos(yaw)*cx+Math.sin(yaw)*cz;
 const rz=-Math.sin(yaw)*cx+Math.cos(yaw)*cz;
 const scale=Math.min(size.w/148,size.h/(choice==='ALL'?120:85))*zoom;
 return [size.w*.51+panX+rx*scale,size.h*.61+panY+(rz*Math.sin(pitch)-y*Math.cos(pitch))*scale];
}
function projFlat(p){const scale=Math.min(size.w/1510,size.h/860)*zoom*1.55;return [size.w/2+panX+(p[0]-690)*scale,size.h/2+panY+(p[1]-365)*scale]}
function project(p,floor,z=0){return mode==='3D'?proj(p,floor,z):projFlat(p)}
function shape(pts,f,z=0){const screen=pts.map(p=>project(p,f,z));ctx.beginPath();screen.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();return screen;}
function fillShape(pts,f,z,fill,stroke,strokeWidth=1){const pixels=shape(pts,f,z);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.lineWidth=strokeWidth;ctx.strokeStyle=stroke;ctx.stroke()}return pixels;}
function polygonHit(p,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function label(x,y,s,color='#d5faff',px=10){ctx.font=`600 ${px}px system-ui,sans-serif`;ctx.lineWidth=2.8;ctx.strokeStyle='#06121c';ctx.strokeText(s,x,y);ctx.fillStyle=color;ctx.fillText(s,x,y)}
function drawGrid(){ctx.save();ctx.strokeStyle='rgba(62,115,135,.16)';ctx.lineWidth=1;const sp=55;for(let x=(size.w/2+panX)%sp;x<size.w;x+=sp){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,size.h);ctx.stroke()};for(let y=(size.h/2+panY)%sp;y<size.h;y+=sp){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(size.w,y);ctx.stroke()}ctx.restore()}
function chooseVisible(){const fs=model.levels.filter(l=>choice==='ALL'||l.floor===choice);return fs;}
function draw(){if(!model)return;dirty=false;rendered=[];
 ctx.fillStyle='#0a1525';ctx.fillRect(0,0,size.w,size.h);drawGrid();
 let levels=chooseVisible();
 // Older levels first; higher levels are visually layered above, not collapsed into one map.
 for(let idx=0;idx<levels.length;idx++){
  const l=levels[idx],f=l.floor,isSelected=choice!=='ALL',single=levels.length===1;
  if(single&&mode==='2D'&&photoMode&&images[f]?.complete){const img=images[f];const tl=projFlat([0,0]),br=projFlat(l.imageSize);ctx.save();ctx.globalAlpha=.78;ctx.drawImage(img,tl[0],tl[1],br[0]-tl[0],br[1]-tl[1]);ctx.restore();}
  if(mode==='3D'){
   const rect=floorRect(l);
   const shade=fillShape(rect,f,-1.25,'rgba(17,42,61,.42)','rgba(84,131,157,.52)',1.2);
   // Slabs are approximations for visualization; photo-derived shops retain their own outlines.
   ctx.save();ctx.setLineDash([3,7]);shape(rect,f,0);ctx.strokeStyle='rgba(79,130,156,.46)';ctx.lineWidth=1.4;ctx.stroke();ctx.restore();
  }
  let shopDrawn=0;
  for(const r of l.regions){
   const p=r.path,k=r.kind,id=r.id,match=query&&normalize([id,r.label,r.kind].join(' ')).includes(normalize(query)),highlight=selected===id,nonmatching=query&&!match;
   const roofAlpha=mode==='2D'&&photoMode?.29:(choice==='ALL'?.63:.84);
   const alpha=nonmatching?.12:roofAlpha;
   const color=paint[k]||paint.shop;
   if(mode==='3D'){
    ctx.fillStyle=rgba('#081b2c',choice==='ALL'?.34:.72);
    for(let j=0;j<p.length;j++){
     const q=p[(j+1)%p.length],a=project(p[j],f,.95),b=project(q,f,.95),c=project(q,f,-1.5),d=project(p[j],f,-1.5);
     ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.lineTo(...c);ctx.lineTo(...d);ctx.closePath();ctx.fill();
    }
   }
   const screen=fillShape(p,f,mode==='3D'?.95:0,rgba(highlight?'#ffc66e':color,highlight?.97:alpha),highlight?'#fffcdf':rgba('#123b4c',single?.95:.85),highlight?2.8:(single?1.5:.9));
   rendered.push({id,polygon:screen,floor:f,kind:k});
   if(k==='shop')shopDrawn++;
   if(single&&(mode==='2D'||zoom>1.55)&&r.label){
    const mid=project(r.xy,f,mode==='3D'?.95:0),font=mode==='2D'?9:8;
    if(mid[0]>0&&mid[0]<size.w&&mid[1]>0&&mid[1]<size.h){ctx.textAlign='center';label(mid[0],mid[1]+3,r.label,mode==='2D'?'#051727':'#e6ffff',font)}
   }
  }
  if(mode==='3D'){
   const b=l.bounds,at=project([b[0]-30,(b[2]+b[3])/2],f,2);
   ctx.save();ctx.textAlign='center';ctx.font='800 17px system-ui';ctx.strokeStyle='#071625';ctx.lineWidth=5;ctx.strokeText(f,at[0],at[1]);ctx.fillStyle='#7bece2';ctx.fillText(f,at[0],at[1]);ctx.restore();
  }
 }
 // Only shown for adjacent floors; not a real movement path.
 if(choice==='ALL'&&mode==='3D'){
  ctx.save();ctx.setLineDash([5,7]);ctx.lineWidth=1;
  for(const c of model.verticalConnectionHypotheses){
   const a=lookup.get(c.from)?.item,b=lookup.get(c.to)?.item;
   if(!a||!b)continue;
   const pa=project(a.xy,c.from,0),pb=project(b.xy,c.to,0);
   ctx.strokeStyle=c.type==='escalator'?'rgba(255,222,114,.24)':'rgba(255,156,67,.19)';
   ctx.beginPath();ctx.moveTo(...pa);ctx.lineTo(...pb);ctx.stroke();
  }
  ctx.restore();
 }
 ctx.save();ctx.textAlign='left';ctx.fillStyle='#b4c9df';ctx.font='600 11px system-ui';ctx.fillText(choice==='ALL'?'Nueve niveles fotográficos · separaciones visuales':choice+' · '+levels[0].name,15,25);
 ctx.fillStyle='#829ab3';ctx.font='11px system-ui';ctx.fillText(mode==='3D'?'Mapa 3D orientativo (alturas no medidas)':`Plano 2D ${photoMode?'+ fotografía original':'vectorial puro'}`,15,42);ctx.restore();
}
let raf=false;function requestDraw(){if(raf)return;raf=true;requestAnimationFrame(()=>{raf=false;draw()});}
function stats(){let regs=model.levels.flatMap(f=>f.regions);$('totalShops').textContent=regs.filter(p=>p.kind==='shop').length;$('totalRegions').textContent=regs.length;$('message').textContent='Un dedo mueve · dos dedos: zoom y giro · datos fotográficos NO aptos para navegar';}
function showPicked(id){selected=id;const result=lookup.get(id);const box=$('selection');if(!result){box.classList.remove('visible');requestDraw();return}
 const {item,floor}=result;box.classList.add('visible');$('selectedTitle').textContent=(item.label||item.id)+' · '+floor;
 $('selectedText').textContent=(item.kind==='shop'?'Local candidato':'Servicio '+item.kind)+' · geometría individual · sin medición oficial. Área en píxeles²: '+Math.round(item.areaPx2).toLocaleString('es-AR');
 if(innerWidth<=790)$('sidebar').classList.remove('open');requestDraw();}
function chooseFloor(id){choice=id;$('floorbuttons').querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b.dataset.level===id));$('allToggle').classList.toggle('active',id==='ALL');if(id==='ALL'&&mode==='2D')mode='3D';if(id==='ALL')photoMode=false;setButtons();panX=panY=0;zoom=id==='ALL'?.95:1.20;requestDraw()}
function setButtons(){$('mode3D').classList.toggle('active',mode==='3D');$('mode2D').classList.toggle('active',mode==='2D');$('photoToggle').disabled=choice==='ALL'||mode!=='2D';$('photoToggle').classList.toggle('selected',photoMode);$('allToggle').classList.toggle('active',choice==='ALL')}
function zoomBy(scale){zoom=clamp(zoom*scale,.2,5.7);requestDraw()}
function reset(){yaw=-.45;pitch=.72;panX=0;panY=0;zoom=choice==='ALL'?.95:1.2;requestDraw()}
function pointerDown(e){canvas.setPointerCapture(e.pointerId);activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});hadMove=false;if(activePointers.size===2){const a=[...activePointers.values()];gesture={mid:[(a[0].x+a[1].x)/2,(a[0].y+a[1].y)/2],distance:Math.hypot(a[1].x-a[0].x,a[1].y-a[0].y),angle:Math.atan2(a[1].y-a[0].y,a[1].x-a[0].x)};}}
function pointerMove(e){const last=activePointers.get(e.pointerId);if(!last)return;const dx=e.clientX-last.x,dy=e.clientY-last.y;if(Math.hypot(dx,dy)>.15)hadMove=true;activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(activePointers.size===1){panX+=dx;panY+=dy;requestDraw();return}const a=[...activePointers.values()],next={mid:[(a[0].x+a[1].x)/2,(a[0].y+a[1].y)/2],distance:Math.hypot(a[1].x-a[0].x,a[1].y-a[0].y),angle:Math.atan2(a[1].y-a[0].y,a[1].x-a[0].x)};if(gesture){panX+=next.mid[0]-gesture.mid[0];panY+=next.mid[1]-gesture.mid[1];zoom=clamp(zoom*(next.distance/Math.max(5,gesture.distance)),.2,5.7);if(mode==='3D'){let delta=next.angle-gesture.angle;while(delta>Math.PI)delta-=2*Math.PI;while(delta< -Math.PI)delta+=2*Math.PI;yaw+=delta;}}gesture=next;requestDraw()}
function pointerUp(e){const record=activePointers.get(e.pointerId);activePointers.delete(e.pointerId);if(activePointers.size<2)gesture=null;if(!hadMove&&activePointers.size===0){const p=[e.clientX-canvas.getBoundingClientRect().left,e.clientY-canvas.getBoundingClientRect().top];let match=null;for(let j=rendered.length-1;j>=0;j--)if(polygonHit(p,rendered[j].polygon)){match=rendered[j];break;}showPicked(match?.id||null);}}
async function init(){try{if(window.__NWC9_MODEL_B64){const bytes=Uint8Array.from(atob(window.__NWC9_MODEL_B64),c=>c.charCodeAt(0));model=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).json();}else{const resp=await fetch('data.json',{cache:'no-store'});if(!resp.ok)throw Error('HTTP '+resp.status);model=await resp.json();}if(model.levels.length!==9)throw Error('Se requieren nueve niveles');
 for(const l of model.levels){for(const r of l.regions)lookup.set(r.id,{item:r,floor:l.floor});const img=new Image();img.src=l.photo;images[l.floor]=img;}
 const nav=$('floorbuttons');for(const value of ['ALL',...model.levels.map(x=>x.floor)]){const b=document.createElement('button');b.textContent=value==='ALL'?'TODAS':value;b.dataset.level=value;b.onclick=()=>chooseFloor(value);nav.append(b)}
 $('zoomIn').onclick=()=>zoomBy(1.3);$('zoomOut').onclick=()=>zoomBy(1/1.3);$('yawLeft').onclick=()=>{yaw-=.2;requestDraw()};$('yawRight').onclick=()=>{yaw+=.2;requestDraw()};$('reset').onclick=reset;
 $('mode3D').onclick=()=>{mode='3D';photoMode=false;setButtons();requestDraw()};$('mode2D').onclick=()=>{mode='2D';if(choice==='ALL')chooseFloor('L7');setButtons();requestDraw()};$('allToggle').onclick=()=>chooseFloor('ALL');
 $('photoToggle').onclick=()=>{photoMode=!photoMode;setButtons();requestDraw()};
 $('downloadSvg').onclick=()=>{const f=choice==='ALL'?'L7':choice;const lev=model.levels.find(l=>l.floor===f);let xml='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1376 768">';for(const r of lev.regions){xml+='<polygon id="'+r.id+'" data-kind="'+r.kind+'" points="'+r.path.map(p=>p.join(',')).join(' ')+'" fill="'+paint[r.kind]+'" stroke="#113a34" stroke-width="1.3" />'}xml+='</svg>';const a=document.createElement('a'),url=URL.createObjectURL(new Blob([xml],{type:'image/svg+xml'}));a.href=url;a.download='newworldcity-'+f+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 $('search').addEventListener('input',e=>{query=e.target.value.trim();if(query&&/^L\d-[0-9]{3}$/i.test(query)&&lookup.has(query.toUpperCase()))chooseFloor(query.toUpperCase().split('-')[0]);requestDraw()});
 $('menuToggle').onclick=()=>$('sidebar').classList.toggle('open');
 canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);
 canvas.addEventListener('wheel',e=>{e.preventDefault();zoomBy(e.deltaY>0?.92:1.08)},{passive:false});canvas.addEventListener('dblclick',e=>{e.preventDefault();zoomBy(1.5)});
 window.addEventListener('resize',()=>{setCanvasSize();requestDraw()});
 window.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA'].includes(document.activeElement.tagName))return;if(e.key==='+')zoomBy(1.2);if(e.key==='-')zoomBy(1/1.2);if(e.key==='ArrowLeft'){yaw-=.1;requestDraw()}if(e.key==='ArrowRight'){yaw+=.1;requestDraw()}});
 setCanvasSize();chooseFloor('ALL');stats();setButtons();$('loading').remove();
 window.__NWC9__={getState:()=>({ready:true,floors:model.levels.length,regions:model.levels.reduce((n,l)=>n+l.regions.length,0),currentFloor:choice,mode,zoom,selected,images:Object.keys(images).length,verticalHypotheses:model.verticalConnectionHypotheses.length}),setFloor:chooseFloor,setMode:value=>{mode=value;setButtons();requestDraw()},project,getData:()=>model};requestDraw();
 }catch(err){$('loading').textContent='No se pudo cargar el plano: '+err.message;console.error(err);}}
init();
})();