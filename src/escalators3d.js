/* RetailNav: prototype 3D escalator geometry from the photographed yellow pictograms.
 * No input axis, arrow direction, real-world scale, or floor connection is certified.
 * Drawing is a VIEW ONLY: it never adds an edge to the indoor route graph. */
(function(){
'use strict';
const M=Math;
const clamp=(v,lo,hi)=>M.min(hi,M.max(lo,v));
const norm=v=>{const k=M.hypot(...v)||1;return v.map(x=>x/k);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const mul=(a,v)=>a.map(x=>x*v);
const COLOR={
 tread:[.71,.80,.84],lip:[.93,.95,.88],riser:[.27,.38,.43],
 skirt:[.31,.44,.51],dark:[.13,.24,.32],
 handrail:[.99,.77,.20],rim:[.97,.91,.56],landing:[.65,.73,.74]
};
function build(options){
 const {fixtures=[],floors=[],origin=[688,384],scale=.115,
        spread=4,baseStoreyMetres=4,active='ALL',enabled=true}=options||{};
 const faces=[],edges=[],items=[],lookup=new Map(floors.map(f=>[f.id,f]));
 const compact=spread>baseStoreyMetres*1.5;
 function vertex(out,p,n,color){out.push(...p,...n,...color,-92);}
 function triangle(a,b,c,color){
  const n=norm(cross(sub(b,a),sub(c,a)));
  vertex(faces,a,n,color);vertex(faces,b,n,color);vertex(faces,c,n,color);
 }
 function quad(a,b,c,d,color){
  triangle(a,b,c,color);triangle(a,c,d,color);
 }
 function line(a,b,color){
  vertex(edges,a,[0,1,0],color);vertex(edges,b,[0,1,0],color);
 }
 function pOffset(center,long,across,at,along,side,y){
  return [center[0]+long[0]*along+across[0]*side,y,
          center[2]+long[2]*along+across[2]*side];
 }
 for(const f of fixtures){
  if(!enabled||(active!=='ALL'&&active!==f.floor))continue;
  const floor=lookup.get(f.floor),other=lookup.get(f.adjacentFloorCandidate);
  if(!floor)continue;
  const dx=f.p1[0]-f.p0[0],dz=f.p1[1]-f.p0[1];
  const sourceRun=M.hypot(dx,dz)*scale;
  if(sourceRun<3)continue;
  const long=norm([dx,0,dz]),across=[-long[2],0,long[0]];
  const centre=[((f.p0[0]+f.p1[0])/2-origin[0])*scale,0,
                ((f.p0[1]+f.p1[1])/2-origin[1])*scale];
  const trueRise=other?M.abs(other.y-floor.y):0;
  // Avoid the previous "yellow ladder through multiple storeys": an exploded
  // display shows a short footprint only, never a false 26-metre stair.
  const rise=compact?1.15:(other?clamp(trueRise,1,12):1.15);
  const run=clamp(rise/M.tan(Math.PI/6),5.6,14.5);
  const pitch=M.atan2(rise,run)*180/M.PI;
  const bottomY=compact?floor.y:M.min(floor.y,other?.y??floor.y);
  const topY=bottomY+rise;
  const rows=clamp(M.round(run/.37),16,38);
  const laneCount=f.lanes===1?1:2;
  const width=.95,gap=.18;
  const tBottom=-run/2,tTop=run/2;
  // Each yellow pictogram can indicate a paired bank; the floor plan does not
  // certify independent up/down direction, so no invented direction arrows.
  for(let lane=0;lane<laneCount;lane++){
   const lateral=(lane-(laneCount-1)/2)*(width+gap);
   const point=(along,side,y)=>pOffset(centre,long,across,0,along,lateral+side,y);
   const stairY=i=>bottomY+.12+rise*i/rows;
   const a=tBottom,b=tTop;
   // A shallow metallic apron below the steps, with raised glass/metal sides.
   const railY=t=>bottomY+.91+rise*t;
   for(const side of [-width/2,width/2]){
    const k=side;
    quad(point(a,k,bottomY-.24),point(b,k,topY-.24),
         point(b,k,topY+.60),point(a,k,bottomY+.60),COLOR.skirt);
    line(point(a-.65,k,bottomY+.95),point(b+.65,k,topY+.95),COLOR.handrail);
    line(point(a-.65,k,bottomY+.92),point(b+.65,k,topY+.92),COLOR.rim);
    // Upper and lower handrail turnaround sections
    line(point(a-.85,k,bottomY+.72),point(a-.65,k,bottomY+.95),COLOR.rim);
    line(point(b+.65,k,topY+.95),point(b+.85,k,topY+.72),COLOR.rim);
   }
   // Step tread surfaces remain HORIZONTAL, with vertical riser faces;
   // a sloped solid board (or a ladder) would not be an escalator.
   for(let i=0;i<rows;i++){
    const v0=i/rows,v1=(i+1)/rows;
    const left=a+run*v0,right=a+run*v1;
    const y=stairY(i);
    quad(point(left,-width*.47,y),point(right,-width*.47,y),
         point(right,width*.47,y),point(left,width*.47,y),
         i%2?COLOR.tread:COLOR.landing);
    const next=stairY(i+1);
    quad(point(right,-width*.47,y),point(right,-width*.47,next),
         point(right,width*.47,next),point(right,width*.47,y),COLOR.riser);
    // Anti-slip leading yellow edge, independent of passenger direction.
    const edge=right-.08;
    line(point(edge,-width*.45,y+.01),point(edge,width*.45,y+.01),COLOR.lip);
   }
   // Level landings/comb-plates where a rider enters or leaves the bank.
   for(const [at,y] of [[a-.55,bottomY+.10],[b+.08,topY+.10]]){
    quad(point(at,-width*.5,y),point(at+.45,-width*.5,y),
         point(at+.45,width*.5,y),point(at,width*.5,y),COLOR.handrail);
    for(let j=0;j<4;j++){
     const x=at+.07+j*.10;
     line(point(x,-width*.42,y+.02),point(x,width*.42,y+.02),COLOR.dark);
    }
   }
  }
  items.push({
   id:f.id,floor:f.floor,pairedFloorCandidate:f.adjacentFloorCandidate,
   lanes:laneCount,entryExitKnown:false,verified:false,
   direction:'unknown',
   stepRows:rows,angleDegrees:M.round(pitch*100)/100,
   riseMetres:M.round(rise*100)/100,
   photoAxisLengthPx:M.round(sourceRun/scale),
   footprintCenter:[+((f.p0[0]+f.p1[0])/2).toFixed(1),
                    +((f.p0[1]+f.p1[1])/2).toFixed(1)],
   bottomWorldY:bottomY,topWorldY:topY,
   display:compact?'short-unconnected-footprint':'provisional-inclined-escalator'
  });
 }
 return {faces:new Float32Array(faces),edges:new Float32Array(edges),
         items,stats:{banks:items.length,lanes:items.reduce((n,x)=>n+x.lanes,0),
          triangles:faces.length/30,lineSegments:edges.length/20,
          display:compact?'exploded-no-cross-floor-stairs':'physical-estimate',
          navigable:false,landingMappingsVerified:false}};
}
window.RetailNavEscalators=Object.freeze({build});
})();
