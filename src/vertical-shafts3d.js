/* RetailNav reusable structural lift cores. A shaft is a continuous
 * photo-based VISUAL CANDIDATE, NEVER a verified transport or routing edge.
 * The glass wall, posts and floor collars are genuine WebGL world geometry.
 * The entire core stays vertical even when the nine floors differ in height.
 */
(()=>{
'use strict';
const FRAME=[.20,.69,.78],EDGE=[.55,.94,.99],GLASS=[.13,.50,.65];
const norm=v=>{const d=Math.hypot(...v)||1;return v.map(x=>x/d);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2]];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
function push(out,p,n,c){out.push(...p,...n,...c,-73);}
function triangle(out,a,b,c,color){
 const n=norm(cross(sub(b,a),sub(c,a)));
 push(out,a,n,color);push(out,b,n,color);push(out,c,n,color);
}
function quad(out,a,b,c,d,color){
 triangle(out,a,b,c,color);triangle(out,a,c,d,color);
}
function line(out,a,b,color){
 push(out,a,[0,1,0],color);push(out,b,[0,1,0],color);
}
function cube(out,min,max,color){
 const [x0,y0,z0]=min,[x1,y1,z1]=max;
 const corners=[
  [x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],
  [x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]
 ];
 for(const [a,b,c,d] of [[0,1,2,3],[4,5,6,7],[0,1,5,4],
  [1,2,6,5],[2,3,7,6],[3,0,4,7]]){
  quad(out,corners[a],corners[b],corners[c],corners[d],color);
 }
}
function build({candidates=[],floors=[],origin=[688,384],scale=.115,
 active='ALL',enabled=true,includeSecondary=false}={}){
 const solid=[],glass=[],edges=[],shafts=[];
 if(!enabled||active!=='ALL'||floors.length<2)
  return {solid:new Float32Array(0),glass:new Float32Array(0),
   edges:new Float32Array(0),shafts,stats:{count:0,continuousCount:0,
    shape:'framed-transparent-shaft',verified:false,navigationApproved:false}};
 const byId=new Map(floors.map(f=>[f.id,f]));
 for(const candidate of candidates){
  if(!candidate.primary&&!includeSecondary)continue;
  const levels=(candidate.observations||[]).map(x=>({
   ...x,info:byId.get(x.floor)
  })).filter(x=>x.info).sort((a,b)=>a.info.index-b.info.index);
  if(levels.length<2||levels.some((x,i)=>i&&x.info.index-levels[i-1].info.index!==1))
   continue;
  // Single shared physical X/Z axis. Do not draw a zigzag between different
  // photographed symbol positions, which previously looked like noisy ladders.
  const center=candidate.coreCenterPx;
  if(!center||!center.every(Number.isFinite))continue;
  const x=(center[0]-origin[0])*scale,z=(center[1]-origin[1])*scale;
  const width=Number(candidate.widthEstimateM)||3.4;
  const depth=Number(candidate.depthEstimateM)||3.6;
  const hw=width/2,hd=depth/2;
  const y0=levels[0].info.y-.06,yn=levels[levels.length-1].info.y+3.0;
  if(!(yn>y0+3))continue;
  const post=.12,cornerPositions=[[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]];
  for(const [dx,dz] of cornerPositions){
   cube(solid,[x+dx-post/2,y0,z+dz-post/2],
    [x+dx+post/2,yn,z+dz+post/2],FRAME);
  }
  // Glass panels show the volume without obscuring shops and their rooftop
  // codes. The viewport depth-tests the translucent mesh and floors.
  const perimeter=cornerPositions.map(([dx,dz])=>[x+dx,z+dz]);
  for(let k=0;k<4;k++){
   const a=perimeter[k],b=perimeter[(k+1)%4];
   quad(glass,[a[0],y0,a[1]],[b[0],y0,b[1]],
    [b[0],yn,b[1]],[a[0],yn,a[1]],GLASS);
   line(edges,[a[0],y0,a[1]],[a[0],yn,a[1]],EDGE);
  }
  // Structural rings at each physical floor elevation: the shaft is a
  // single connected volume visible from SIDE or in 360-degree orbit mode.
  const elevations=[];
  for(const floor of levels){
   const y=floor.info.y+1.15;elevations.push(+y.toFixed(2));
   for(let k=0;k<4;k++){
    const a=perimeter[k],b=perimeter[(k+1)%4];
    line(edges,[a[0],y,a[1]],[b[0],y,b[1]],EDGE);
   }
  }
  line(edges,[x-hw,y0,z],[x+hw,y0,z],FRAME);
  line(edges,[x-hw,yn,z],[x+hw,yn,z],FRAME);
  const observationDeviations=levels.map(p=>Math.round(
   Math.hypot(p.xy[0]-center[0],p.xy[1]-center[1])*10)/10);
  shafts.push({
   id:candidate.id,
   from:levels[0].floor,to:levels[levels.length-1].floor,
   floors:levels.map(x=>x.floor),levels:levels.length,
   centerPx:center.slice(),elevationMetres:elevations,
   heightWorld:+(yn-y0).toFixed(2),continuous:true,
   isProvisional:true,landingMatchVerified:false,
   maxPhotoDeviationPx:Math.max(...observationDeviations),
   geometryTriangles:(solid.length+glass.length)/30,
   renderSource:'photo-axis-uncalibrated-no-routing',
   trafficRoutingApproved:false
  });
 }
 return {
  solid:new Float32Array(solid),glass:new Float32Array(glass),
  edges:new Float32Array(edges),shafts,
  stats:{count:shafts.length,continuousCount:shafts.filter(s=>s.continuous).length,
   triangleCount:(solid.length+glass.length)/30,
   glassOpacity:.19,shape:'framed-transparent-shaft',
   verified:false,navigationApproved:false}
 };
}
window.RetailNavVerticalShafts=Object.freeze({build});
})();