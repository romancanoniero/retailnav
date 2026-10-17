import {readFileSync,writeFileSync} from 'node:fs';
import earcut from 'earcut';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('usage: node triangulate-vector-font.mjs contours.json output.js');
const source=JSON.parse(readFileSync(input,'utf8'));
const area=ring=>ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1]},0)/2;
function inside(point,ring){
 let hit=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];
  if((a[1]>point[1])!==(b[1]>point[1])&&
    point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;
 }
 return hit;
}
const glyphs={};
for(const [character,glyph] of Object.entries(source.glyphs)){
 const rings=glyph.contours.filter(r=>r.length>=3);
 const parents=rings.map((ring,index)=>{
  const choices=rings.map((candidate,parent)=>({parent,size:Math.abs(area(candidate))}))
   .filter(x=>x.parent!==index&&x.size>Math.abs(area(ring))&&inside(ring[0],rings[x.parent]))
   .sort((a,b)=>a.size-b.size);
  return choices[0]?.parent??-1;
 });
 const depth=index=>{let n=0,p=parents[index],guard=0;while(p>=0&&guard++<rings.length){n++;p=parents[p]}return n};
 const vertices=[],triangles=[],contours=[];
 for(let outer=0;outer<rings.length;outer++){
  if(depth(outer)%2)continue;
  const members=[outer,...rings.map((_,i)=>i).filter(i=>parents[i]===outer&&depth(i)%2===1)];
  const flat=[],holes=[];
  for(const [memberIndex,ringIndex] of members.entries()){
   if(memberIndex)holes.push(flat.length/2);
   for(const [x,y] of rings[ringIndex])flat.push(x,y);
  }
  const offset=vertices.length/2;
  vertices.push(...flat);
  triangles.push(...earcut(flat,holes,2).map(index=>index+offset));
  let cursor=offset;
  for(const ringIndex of members){contours.push([cursor,rings[ringIndex].length]);cursor+=rings[ringIndex].length}
 }
 glyphs[character]={a:glyph.a,v:vertices.map(v=>+v.toFixed(6)),t:triangles,c:contours};
}
const result={schema:'retailnav.vector-font-mesh.v1',family:source.family,weight:source.weight,
 sourceSha256:source.sourceSha256,ascender:source.ascender,descender:source.descender,
 curveSegmentsPerQuadratic:source.curveSegmentsPerQuadratic,glyphs};
writeFileSync(output,'window.RetailNavVectorFont=Object.freeze('+JSON.stringify(result)+');\n');
