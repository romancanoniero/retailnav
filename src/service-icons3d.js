/* Shared, source-aligned amenity pictograms used by EVERY RetailNav mall.
 * Same polygon paths drive real extruded 3D roof symbols and reusable SVG.
 * Lift: orange-space black cabin with riders and UP/DOWN arrows.
 * WC: cyan-space white man/woman silhouettes. No HTML/emoji markers.
 */
(()=>{
'use strict';
const rect=(a,b,c,d)=>[[a,c],[b,c],[b,d],[a,d]];
const circle=(x,y,r,n=20)=>Array.from({length:n},(_,i)=>{
 const a=2*Math.PI*i/n;return [x+r*Math.cos(a),y+r*Math.sin(a)];
});
const polygon=points=>({points});
const people=(cx,gender)=>{
 const parts=[];
 parts.push(polygon(circle(cx,-.15,.13)));
 if(gender==='female'){
  parts.push(polygon(rect(cx-.14,cx+.14,.03,.32)));
  parts.push(polygon([[cx-.15,.24],[cx+.15,.24],[cx+.30,.57],[cx-.30,.57]]));
  parts.push(polygon(rect(cx-.23,cx-.11,.54,.93)));
  parts.push(polygon(rect(cx+.11,cx+.23,.54,.93)));
  parts.push(polygon(rect(cx-.30,cx-.18,.07,.40)));
  parts.push(polygon(rect(cx+.18,cx+.30,.07,.40)));
 }else{
  parts.push(polygon(rect(cx-.16,cx+.16,.03,.57)));
  parts.push(polygon(rect(cx-.29,cx-.18,.07,.48)));
  parts.push(polygon(rect(cx+.18,cx+.29,.07,.48)));
  parts.push(polygon(rect(cx-.15,cx-.035,.54,.94)));
  parts.push(polygon(rect(cx+.035,cx+.15,.54,.94)));
 }
 return parts;
};
const SYMBOLS={
 toilet:[
  ...people(-.49,'male'),...people(.49,'female')
 ],
 elevator:[
  // The two arrows above the passenger cabin reproduce the supplied
  // mall-directory symbol rather than a generic accessibility badge.
  polygon(rect(-.51,-.38,-.95,-.44)),
  polygon([[-.72,-.71],[-.445,-.995],[-.17,-.71]]),
  polygon(rect(.38,.51,-.99,-.47)),
  polygon([[.17,-.69],[.445,-.40],[.72,-.69]]),
  // Cabin outline including central sliding-door seam.
  polygon(rect(-.97,-.85,-.36,.93)),
  polygon(rect(.85,.97,-.36,.93)),
  polygon(rect(-.96,.96,-.36,-.25)),
  polygon(rect(-.96,.96,.84,.95)),
  polygon(rect(-.055,.055,-.22,.83)),
  ...people(-.51,'male'),
  ...people(.52,'female')
 ]
};
const colours={toilet:[.97,.995,1],elevator:[.12,.14,.15]};
const sideColours={toilet:[.38,.66,.73],elevator:[.24,.27,.25]};
const cssColours={toilet:'#F8FEFF',elevator:'#202426'};
function svg(category,{background=false}={}){
 const shapes=SYMBOLS[category];if(!shapes)return '';
 const bg=background?'<rect x="-1.1" y="-1.1" width="2.2" height="2.2" rx=".11" fill="'+
  (category==='toilet'?'#06BDD5':'#E99B21')+'"/>':'';
 const shapesSvg=shapes.map(({points})=>
  '<polygon points="'+points.map(p=>p.map(v=>v.toFixed(4)).join(',')).join(' ')+
  '" fill="'+cssColours[category]+'"/>').join('');
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.1 -1.1 2.2 2.2"'+
  ' role="img" aria-label="'+(category==='toilet'?'Baños':'Ascensor')+'">'+bg+shapesSvg+'</svg>';
}
function append(out,category,{center,width,height,roof,rotated=false}={}){
 const shapes=SYMBOLS[category];
 if(!shapes||!center||!Number.isFinite(roof))return false;
 const unit=Math.min(1.08,width*.37,height*.37);
 if(!(unit>.055))return false;
 const colour=colours[category],side=sideColours[category];
 const place=(p,y)=>rotated
  ?[center[0]-p[1]*unit,y,center[1]+p[0]*unit]
  :[center[0]+p[0]*unit,y,center[1]+p[1]*unit];
 const emit=(a,b,c,normal,color)=>{
  for(const p of [a,b,c])out.push(...p,...normal,...color,-89);
 };
 const base=roof+.025,top=base+.085;
 let shapesAdded=0;
 for(const shape of shapes){
  const ring=shape.points;
  if(ring.length<3)continue;
  const points=ring.map(p=>place(p,top));
  // Every pictogram polygon here is convex, so a fan triangulation is exact.
  for(let i=1;i<points.length-1;i++)
   emit(points[0],points[i],points[i+1],[0,1,0],colour);
  for(let i=0;i<ring.length;i++){
   const j=(i+1)%ring.length;
   const a=place(ring[i],base),b=place(ring[j],base);
   const A=points[i],B=points[j],dx=B[0]-A[0],dz=B[2]-A[2];
   const length=Math.hypot(dx,dz)||1;
   const n=[dz/length,0,-dx/length];
   emit(a,b,B,n,side);
   emit(a,B,A,n,side);
  }
  shapesAdded++;
 }
 return shapesAdded>0;
}
window.RetailNavServiceIcons=Object.freeze({
  version:'vector-amenities-3d-v1',
  categories:Object.freeze(['toilet','elevator']),
  shapes:SYMBOLS,
  svg,
  append
});
})();
