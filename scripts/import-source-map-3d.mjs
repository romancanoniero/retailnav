// Reproducible offline mesh compilation: npm install --no-save earcut@3.0.2
// No vendor viewer, runtime triangulator, or registration onto photo pixels.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import earcut,{deviation} from 'earcut';
const path='data/official-maps/aventura.json',raw=readFileSync(path),source=JSON.parse(raw);
const origin=[-80.14275,25.95706];
const project=([lon,lat])=>[(lon-origin[0])*111320*Math.cos(origin[1]*Math.PI/180)*10,
 (origin[1]-lat)*111320*10].map(n=>Math.round(n*2)/2);
const names=new Map(source.locations.map(l=>[l.id,l]));
function mesh(feature,kind){
 assert.equal(feature.geometry.type,'Polygon');
 const rings=feature.geometry.coordinates.map(r=>{
  const out=r.map(project).filter((p,i,a)=>!i||p.some((v,k)=>v!==a[i-1][k]));
  if(out[0].every((v,k)=>v===out.at(-1)[k]))out.pop();
  assert.ok(out.length>=3,feature.id);return out;
 });
 const points=rings.flat(),holes=[],indices=[];let offset=0;
 for(const ring of rings){if(offset)holes.push(offset);indices.push(ring.map((_,i)=>offset+i));offset+=ring.length;}
 const flat=points.flat(),triangles=earcut(flat,holes);
 assert.ok(triangles.length>0&&deviation(flat,holes,2,triangles)<.00001,'Invalid triangulation '+feature.id);
 let x=0,y=0;const deltas=points.flatMap(p=>{const out=[p[0]*2-x,p[1]*2-y];[x,y]=p.map(n=>n*2);return out;});
 // Centre of the largest interior triangle is always on the actual footprint,
 // including concave stores and rings with holes.
 let area=-1,center;
 for(let i=0;i<triangles.length;i+=3){const [a,b,c]=triangles.slice(i,i+3).map(i=>points[i]);
  const size=Math.abs((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]));
  if(size>area){area=size;center=[0,1].map(k=>(a[k]+b[k]+c[k])/3);}}
 return [kind===5?'surface:'+feature.id:feature.id,kind,kind===5?'':(names.get(feature.locationId)?.suiteIds.includes(feature.id)?names.get(feature.locationId).name:''),deltas,indices,triangles,center];
}
const floors=source.floors.map(f=>[f.id,f.name,'Geometría del mapa oficial · '+f.sourceFloorId,
 [...f.surfaces.map(s=>mesh(s,5)),...f.features.map(s=>mesh(s,1))],
 {x:0,y:0,step:1,w:1,h:1,bits:'AA=='}]);
const circulation=Object.fromEntries(source.floors.map(f=>[f.id,f.circulation.map(g=>g.coordinates.map(project))]));
const connectors=source.connectors.flatMap(c=>c.floors.map(floor=>({id:'source-connector:'+c.id+':'+floor,
 sourceConnectorId:c.id,floor,name:c.name==='Escalator'?'Escalera mecánica':c.name==='Elevator'?'Ascensor':c.name,
 category:c.name==='Elevator'?'elevator':'vertical-uncertain',
 x:project([c.longitude,c.latitude])[0],y:project([c.longitude,c.latitude])[1],
 source:'official-map-connector',confidence:'por-revisar',routingVerified:false})));
const result={schema:'retailnav.source-mesh.v1',mallId:'aventura',sourceSha256:createHash('sha256').update(raw).digest('hex'),
 coordinateSpace:'roveiq:107:local-decimeters-v1',projection:{origin,metersPerDegree:111320,unitsPerMeter:10},
 origin:[0,0],scale:.025,floors,circulation,connectors};
writeFileSync('data/official-maps/aventura-3d.json',JSON.stringify(result)+'\n');
console.log('Compiled',floors.reduce((n,f)=>n+f[3].length,0),'native 3D meshes; no walkable grid or route');
