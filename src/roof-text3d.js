/* RetailNav: roof-anchored, extruded 3D text.
 * Alto Palermo labels are real triangulated Inter glyph outlines, generated
 * from the archived official-map font. They never pass through a canvas,
 * texture, pixel mask or block reconstruction. The legacy raster path remains
 * only for malls whose published writing system is not yet in a licensed
 * vector-font bundle. All labels remain provisional until boundaries are reviewed.
 */
(()=>{
'use strict';
const WHITE=[.94,.98,1],GOLD=[1,.88,.56],SERVICE=[1,1,.96],SIDE=[.20,.32,.39];
const scratch=document.createElement('canvas');
const ctx=scratch.getContext('2d',{willReadFrequently:true});
const glyphs=new Map();
const FONT='800 15px Arial, "PingFang SC", "Noto Sans CJK SC", sans-serif';
function glyph(char){
 const font=window.RetailNavThemes?.canvasFont?.(800,15)||FONT;
 const cacheKey=font+'|'+char;
 if(glyphs.has(cacheKey))return glyphs.get(cacheKey);
 if(!ctx)return {rects:[],advance:9};
 ctx.font=font;
 const advance=Math.max(5,Math.min(23,Math.ceil(ctx.measureText(char).width)));
 const width=advance+3,height=20;
 scratch.width=width;scratch.height=height;
 ctx.clearRect(0,0,width,height);ctx.font=font;
 ctx.fillStyle='#fff';ctx.textBaseline='top';
 ctx.fillText(char,1,0);
 const image=ctx.getImageData(0,0,width,height).data;
 // Rasterize glyphs at half resolution and merge contiguous cells. This
 // substantially reduces triangles and RAM on iPhones while preserving
 // genuinely extruded geometric text, even with Chinese CJK characters.
 const stride=2,w=Math.ceil(width/stride),h=Math.ceil(height/stride);
 function filled(x,y){
  let sum=0,n=0;
  for(let row=y*stride;row<Math.min(height,(y+1)*stride);row++)
   for(let col=x*stride;col<Math.min(width,(x+1)*stride);col++){
    sum+=image[(row*width+col)*4+3];n++;
   }
  return sum>=n*79;
 }
 const complete=[],active=new Map();
 for(let y=0;y<h;y++){
  const segments=[];
  let x=0;
  while(x<w){
   while(x<w&&!filled(x,y))x++;
   if(x>=w)break;
   const a=x;
   while(x<w&&filled(x,y))x++;
   segments.push([a,x]);
  }
  const current=new Map();
  for(const [x0,x1] of segments){
   const key=x0+':'+x1;
   const previous=active.get(key);
   if(previous){previous.y1=Math.min(height,(y+1)*stride);current.set(key,previous);}
   else current.set(key,{x0:x0*stride,x1:Math.min(width,x1*stride),
    y0:y*stride,y1:Math.min(height,(y+1)*stride)});
  }
  for(const [key,rect] of active)if(!current.has(key))complete.push(rect);
  active.clear();
  for(const [key,rect] of current)active.set(key,rect);
 }
 complete.push(...active.values());
 const value={rects:complete,advance:advance+1};
 glyphs.set(cacheKey,value);
 return value;
}
function textWidth(text){
 let w=0;for(const char of text)w+=glyph(char).advance;
 return w;
}
function inside(point,ring){
 let contains=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];
  if((a[1]>point[1])!==(b[1]>point[1])&&
    point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])contains=!contains;
 }
 return contains;
}
function anchorFor(feature){
 const c=feature.c;
 if(inside(c,feature.r[0])&&!feature.r.slice(1).some(r=>inside(c,r)))return c;
 // Concave shop: use the largest original triangulated triangle centroid.
 let winner=c,best=0;
 for(let k=0;k<feature.t.length;k+=3){
  const a=feature.p[feature.t[k]],b=feature.p[feature.t[k+1]],d=feature.p[feature.t[k+2]];
  const area=Math.abs((b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]));
  if(area>best){best=area;winner=[(a[0]+b[0]+d[0])/3,(a[1]+b[1]+d[1])/3];}
 }
 return winner;
}
function toRoofCoords(feature,origin,scale){
 let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
 for(const [x,z] of feature.p){
  minX=Math.min(minX,x);maxX=Math.max(maxX,x);
  minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
 }
 const bounds=[(maxX-minX)*scale,(maxZ-minZ)*scale];
 const rotated=bounds[1]>bounds[0]*1.28;
 const center=anchorFor(feature);
 return {center:[(center[0]-origin[0])*scale,(center[1]-origin[1])*scale],
  long:rotated?bounds[1]:bounds[0],
  short:rotated?bounds[0]:bounds[1],rotated,bounds};
}
function face(out,a,b,c,normal,color){
 for(const p of [a,b,c])out.push(...p,...normal,...color,-89);
}
function quad(out,a,b,c,d,normal,color){
 face(out,a,b,c,normal,color);face(out,a,c,d,normal,color);
}
function raisedRectangle(out,at,size,extrusion,shade,color,axis){
 const {x0,x1,z0,z1}=size;
 const base=at[2],top=base+extrusion;
 const place=(u,v,y)=>{
  const cx=at[0],cz=at[1];
  return axis
   ?[cx-v,y,cz+u]
   :[cx+u,y,cz+v];
 };
 const a=place(x0,z0,base),b=place(x1,z0,base),c=place(x1,z1,base),d=place(x0,z1,base);
 const A=place(x0,z0,top),B=place(x1,z0,top),C=place(x1,z1,top),D=place(x0,z1,top);
 quad(out,A,B,C,D,[0,1,0],color);
 // Every raised text stroke has REAL 3D side walls, visible in side view.
 const sides=[[a,b,B,A],[b,c,C,B],[c,d,D,C],[d,a,A,D]];
 for(const [p,q,Q,P] of sides){
  const vec=[q[2]-p[2],0,p[0]-q[0]];
  const len=Math.hypot(vec[0],vec[2])||1;
  quad(out,p,q,Q,P,[vec[0]/len,0,vec[2]/len],shade);
 }
}
function vectorFont(){
 const font=window.RetailNavVectorFont;
 return window.RETAILNAV_ACTIVE_MALL?.id==='alto-palermo'&&
  font?.schema==='retailnav.vector-font-mesh.v1'?font:null;
}
function vectorTextWidth(text,font){
 let width=0;
 for(const char of text){
  const glyph=font.glyphs[char];
  if(!glyph)throw new Error('Inter vector glyph missing: '+JSON.stringify(char));
  width+=glyph.a;
 }
 return width;
}
function splitVectorLines(text,font,maxLines=2){
 const words=String(text||'').trim().split(/\s+/).filter(Boolean);
 if(words.length<2||maxLines<2)return words.length?[words.join(' ')]:[];
 let best=null;
 for(let cut=1;cut<words.length;cut++){
  const lines=[words.slice(0,cut).join(' '),words.slice(cut).join(' ')];
  const widths=lines.map(line=>vectorTextWidth(line,font));
  const score=Math.max(...widths)+Math.abs(widths[0]-widths[1])*.16;
  if(!best||score<best.score)best={lines,score};
 }
 return best?.lines||[words.join(' ')];
}
function appendVectorGlyph(out,glyph,cursor,longitudinal,vOrigin,factor,at,axis,color){
 const base=at[2],top=base+.068;
 const centerY=(window.RetailNavVectorFont.ascender+window.RetailNavVectorFont.descender)/2;
 const place=(x,y,height)=>{
  const u=longitudinal+(cursor+x)*factor;
  const v=vOrigin+(centerY-y)*factor;
  return axis?[at[0]-v,height,at[1]+u]:[at[0]+u,height,at[1]+v];
 };
 for(let index=0;index<glyph.t.length;index+=3){
  const points=[];
  for(let corner=0;corner<3;corner++){
   const vertex=glyph.t[index+corner]*2;
   points.push(place(glyph.v[vertex],glyph.v[vertex+1],top));
  }
  face(out,points[0],points[1],points[2],[0,1,0],color);
 }
 for(const [start,count] of glyph.c){
  for(let index=0;index<count;index++){
   const a=(start+index)*2,b=(start+(index+1)%count)*2;
   const lowA=place(glyph.v[a],glyph.v[a+1],base);
   const lowB=place(glyph.v[b],glyph.v[b+1],base);
   const highB=place(glyph.v[b],glyph.v[b+1],top);
   const highA=place(glyph.v[a],glyph.v[a+1],top);
   const normal=[lowB[2]-lowA[2],0,lowA[0]-lowB[0]];
   const length=Math.hypot(normal[0],normal[2])||1;
   quad(out,lowA,lowB,highB,highA,[normal[0]/length,0,normal[2]/length],SIDE);
  }
 }
}
function addVectorText(out,text,feature,roof,position,widthFraction,depthFraction,origin,scale,color,font){
 const roofCoords=toRoofCoords(feature,origin,scale);
 const width=vectorTextWidth(text,font),height=font.ascender-font.descender;
 if(!width||!height||!roofCoords.long||!roofCoords.short)return false;
 const maxLong=roofCoords.long*widthFraction,maxShort=roofCoords.short*depthFraction;
 const factor=Math.min(.22,maxLong/width,maxShort/height);
 if(factor<.018)return false;
 const longitudinal=-width*factor/2;
 const vOrigin=(position==='center'?0:position==='code'?-1:1)*
   Math.min(roofCoords.short*.20,height*factor*.55);
 const at=[...roofCoords.center,roof+.018];
 let cursor=0;
 for(const char of text){
  const glyph=font.glyphs[char];
  appendVectorGlyph(out,glyph,cursor,longitudinal,vOrigin,factor,at,roofCoords.rotated,color);
  cursor+=glyph.a;
 }
 return true;
}
function addVectorRoofName(out,text,feature,roof,origin,scale,color,font){
 const roofCoords=toRoofCoords(feature,origin,scale);
 const lines=splitVectorLines(text,font,2);
 const lineHeight=font.ascender-font.descender;
 const widths=lines.map(line=>vectorTextWidth(line,font));
 const blockHeight=lineHeight*lines.length+lineHeight*.18*(lines.length-1);
 if(!lines.length||!Math.max(...widths)||!roofCoords.long||!roofCoords.short)return false;
 // The tenant is the primary roof label. Two lines preserve legibility on
 // narrow rooms without converting the official font into a bitmap.
 const factor=Math.min(1.10,roofCoords.long*.94/Math.max(...widths),
   roofCoords.short*.60/blockHeight);
 if(factor<.013)return false;
 const nameCenter=Math.min(roofCoords.short*.12,blockHeight*factor*.18);
 const at=[...roofCoords.center,roof+.018];
 lines.forEach((line,index)=>{
  const width=widths[index];
  const lineOffset=(index-(lines.length-1)/2)*lineHeight*1.18*factor;
  let cursor=0;
  for(const char of line){
   const glyph=font.glyphs[char];
   appendVectorGlyph(out,glyph,cursor,-width*factor/2,nameCenter+lineOffset,
     factor,at,roofCoords.rotated,color);
   cursor+=glyph.a;
  }
 });
 return true;
}
function explicitAsset(value){
 if(typeof value==='string')return Boolean(value.trim());
 if(!value||typeof value!=='object')return false;
 return ['url','src','path','assetId','sha256'].some(key=>
   typeof value[key]==='string'&&Boolean(value[key].trim()));
}
// A card/logo image is not a roof texture. Suppression is intentionally tied
// to explicit roof-image fields so importing a brand mark cannot erase text.
function hasRoofImage(unit){
 const roof=unit?.roof;
 return [unit?.roofImageURL,unit?.roofImageUrl,unit?.roofTextureURL,
  unit?.roofTextureUrl,unit?.roofImageAsset,unit?.roofTextureAsset,
  roof?.imageURL,roof?.imageUrl,roof?.textureURL,roof?.textureUrl,
  roof?.imageAsset,roof?.textureAsset].some(explicitAsset);
}
function facadeFrame(unit,origin,scale){
 const a=unit?.facade?.a,b=unit?.facade?.b,n=unit?.facade?.normal;
 if(!Array.isArray(a)||!Array.isArray(b)||a.length<2||b.length<2)return null;
 const A=[(a[0]-origin[0])*scale,(a[1]-origin[1])*scale];
 const B=[(b[0]-origin[0])*scale,(b[1]-origin[1])*scale];
 const dx=B[0]-A[0],dz=B[1]-A[1],length=Math.hypot(dx,dz);
 if(length<.12)return null;
 let nx=Array.isArray(n)?Number(n[0]):-dz;
 let nz=Array.isArray(n)?Number(n[1]):dx;
 const normalLength=Math.hypot(nx,nz)||1;
 nx/=normalLength;nz/=normalLength;
 return {center:[(A[0]+B[0])/2,(A[1]+B[1])/2],axis:[dx/length,dz/length],
   normal:[nx,nz],length};
}
function appendFacadeGlyph(out,glyph,cursor,longitudinal,factor,frame,color){
 const font=window.RetailNavVectorFont;
 const centerY=(font.ascender+font.descender)/2;
 const back=.014,front=.060,verticalCenter=.76;
 const place=(x,y,offset)=>[
  frame.center[0]+frame.axis[0]*(longitudinal+(cursor+x)*factor)+frame.normal[0]*offset,
  verticalCenter+(y-centerY)*factor,
  frame.center[1]+frame.axis[1]*(longitudinal+(cursor+x)*factor)+frame.normal[1]*offset
 ];
 const normal=[frame.normal[0],0,frame.normal[1]];
 for(let index=0;index<glyph.t.length;index+=3){
  const points=[];
  for(let corner=0;corner<3;corner++){
   const vertex=glyph.t[index+corner]*2;
   points.push(place(glyph.v[vertex],glyph.v[vertex+1],front));
  }
  face(out,points[0],points[1],points[2],normal,color);
 }
 for(const [start,count] of glyph.c){
  for(let index=0;index<count;index++){
   const a=(start+index)*2,b=(start+(index+1)%count)*2;
   const lowA=place(glyph.v[a],glyph.v[a+1],back);
   const lowB=place(glyph.v[b],glyph.v[b+1],back);
   const highB=place(glyph.v[b],glyph.v[b+1],front);
   const highA=place(glyph.v[a],glyph.v[a+1],front);
   const edge=[lowB[0]-lowA[0],lowB[1]-lowA[1],lowB[2]-lowA[2]];
   const side=[edge[1]*normal[2],edge[2]*normal[0]-edge[0]*normal[2],-edge[1]*normal[0]];
   const sideLength=Math.hypot(...side)||1;
   quad(out,lowA,lowB,highB,highA,side.map(value=>value/sideLength),SIDE);
  }
 }
}
function addVectorFacadeName(out,text,unit,origin,scale,color,font){
 const frame=facadeFrame(unit,origin,scale);
 if(!frame)return false;
 const width=vectorTextWidth(text,font),height=font.ascender-font.descender;
 if(!width||!height)return false;
 // Facade writing is deliberately smaller than the roof identity, but remains
 // a true raised mesh that survives zooming and oblique camera angles.
 const factor=Math.min(.50,frame.length*.82/width,.62/height);
 if(factor<.010)return false;
 let cursor=0;
 for(const char of text){
  const glyph=font.glyphs[char];
  appendFacadeGlyph(out,glyph,cursor,-width*factor/2,factor,frame,color);
  cursor+=glyph.a;
 }
 return true;
}
function addRasterText(out,text,feature,roof,position,widthFraction,depthFraction,origin,scale,color){
 if(!text)return false;
 const roofCoords=toRoofCoords(feature,origin,scale);
 const width=textWidth(text),charHeight=20;
 if(!width||!roofCoords.long||!roofCoords.short)return false;
 const maxLong=roofCoords.long*widthFraction,maxShort=roofCoords.short*depthFraction;
 const factor=Math.min(.093,maxLong/width,maxShort/charHeight);
 if(factor<.003)return false;
 const longitudinal=-width*factor/2;
 const vOrigin=(position==='center'?0:position==='code'?-1:1)*
   Math.min(roofCoords.short*.20,charHeight*factor*.55);
 const base=roof+.018;
 const at=[...roofCoords.center,base];
 let cursor=0;
 for(const char of text){
  const g=glyph(char);
  for(const rect of g.rects){
   const x0=longitudinal+(cursor+rect.x0)*factor;
   const x1=longitudinal+(cursor+rect.x1)*factor;
   // Raster Y increases down the text, and physical Z increases with the
   // photographed plan's image Y. This lies flush on the genuine shop roof.
   const z0=vOrigin+(rect.y0-10)*factor;
   const z1=vOrigin+(rect.y1-10)*factor;
   raisedRectangle(out,at,{x0,x1,z0,z1},.068,SIDE,color,roofCoords.rotated);
  }
  cursor+=g.advance;
 }
 return true;
}
function addText(out,text,feature,roof,position,widthFraction,depthFraction,origin,scale,color){
 if(!text)return '';
 const font=vectorFont();
 if(font)return addVectorText(out,text,feature,roof,position,widthFraction,depthFraction,
   origin,scale,color,font)?'vector':'';
 return addRasterText(out,text,feature,roof,position,widthFraction,depthFraction,
   origin,scale,color)?'raster':'';
}
// Both SVG and 3D meshes are built from the SAME reusable vector paths.
function addServiceSymbol(out,feature,roof,category,origin,scale){
 const coords=toRoofCoords(feature,origin,scale);
 return window.RetailNavServiceIcons?.append?.(out,category,{
  center:coords.center,width:coords.long,height:coords.short,
  roof,rotated:coords.rotated
 })||false;
}
function summarize(floors,units,pois,origin,scale){
 const match=new Map(),ambiguous=new Set();
 for(const unit of units||[]){
  if(!unit.polygonId)continue;
  const key=unit.floor+'/'+unit.polygonId;
  if(match.has(key))ambiguous.add(key);
  else match.set(key,unit);
 }
 for(const key of ambiguous)match.delete(key);
 const amenities=new Map();
 for(const poi of pois||[]){
  if(!poi.geometryId)continue;
  const key=poi.floor+'/'+poi.geometryId;
  if(['toilet','elevator'].includes(poi.category))amenities.set(key,poi);
 }
 const attached=new Set();
 const summary={floors:floors.length,commercialRoofs:0,serviceRoofs:0,
   codeLabels:0,knownNameLabels:0,frontNameLabels:0,roofImageNameSuppressions:0,
   servicePictograms:0,extrudedTriangles:0,
   unmatchedShopNames:0,vectorGlyphLabels:0,rasterGlyphLabels:0,
   textGeometry:vectorFont()?'vector-outline-extruded':'legacy-raster-prisms',
   vectorFontSourceSha256:vectorFont()?.sourceSha256||null,
   vectorCurveSegments:vectorFont()?.curveSegmentsPerQuadratic||null,
   roomLabels:[],services:[]};
 for(const floor of floors){
  const parts={codes:[],names:[],frontNames:[],services:[],stats:{}};
  for(const f of floor.features){
   const key=floor.id+'/'+f.id;
   const service=amenities.get(key);
   if(service){
    f.k='amenity';f.amenityCategory=service.category;f.poiId=service.id;
    f.n=service.category==='toilet'?'Baños · '+floor.id:'Ascensor · '+floor.id;
    attached.add(f.id);summary.serviceRoofs++;
    // No duplicate oversized WC/LIFT lettering: the cabin and restroom
    // pictograms themselves are genuine 3D roof-attached vector symbols.
    const label=service.category==='toilet'?'Baños':'Ascensor';
    const iconAdded=addServiceSymbol(parts.services,f,1.08,service.category,origin,scale);
    if(iconAdded)summary.servicePictograms++;
    summary.services.push({floor:floor.id,id:f.id,category:service.category,
      label,poiId:service.id,roofY:1.08,attached:true,
      extrudedIcon:iconAdded});
    continue;
   }
   if(f.k!=='unit')continue;
   summary.commercialRoofs++;
   const u=match.get(key);
   // Anonymous source regions stay visible as geometry, but an internal
   // polygon ID must never be presented as if it were a published shop code.
   if(!f.n&&!u)continue;
   const code=String(f.n||u?.code||f.id).trim();
   f.storeCode=code;
   // Historical tenant names are displayed only when associated with a
   // particular polygon ID. Missing or ambiguous brands are NEVER guessed.
   const name=u?.name?String(u.name).trim():'';
   f.storeName=name;
   if(!name)summary.unmatchedShopNames++;
   const codeAdded=addText(parts.codes,code,f,1.4,
      name?'code':'center',.80,name?.24:.72,origin,scale,
       window.RetailNavThemes?.rgb?.('mapText',WHITE)||WHITE);
   if(codeAdded){summary.codeLabels++;summary[codeAdded+'GlyphLabels']++;}
   let nameAdded='';
   const font=vectorFont(),roofImageAssigned=hasRoofImage(u);
   if(name&&roofImageAssigned)summary.roofImageNameSuppressions++;
   else if(name)nameAdded=font
    ?(addVectorRoofName(parts.names,name,f,1.4,origin,scale,
      window.RetailNavThemes?.rgb?.('mapNameText',GOLD)||GOLD,font)?'vector':'')
    :addText(parts.names,name,f,1.4,'name',.92,.58,origin,scale,
      window.RetailNavThemes?.rgb?.('mapNameText',GOLD)||GOLD);
   if(nameAdded){summary.knownNameLabels++;summary[nameAdded+'GlyphLabels']++;}
   let frontNameAdded='';
   if(name&&font)frontNameAdded=addVectorFacadeName(parts.frontNames,name,u,origin,scale,
     window.RetailNavThemes?.rgb?.('mapNameText',GOLD)||GOLD,font)?'vector':'';
   if(frontNameAdded){summary.frontNameLabels++;summary[frontNameAdded+'GlyphLabels']++;}
   summary.roomLabels.push({floor:floor.id,id:f.id,code,name,
     verified:false,roofY:1.4,
     geometryAttached:true,codeRaised:codeAdded,nameRaised:nameAdded,
     frontNameRaised:frontNameAdded,roofImageAssigned,anchor:anchorFor(f)});
  }
  floor.roofText={
   codes:new Float32Array(parts.codes),
   names:new Float32Array(parts.names),
   frontNames:new Float32Array(parts.frontNames),
   services:new Float32Array(parts.services)
  };
  summary.extrudedTriangles+=
    (parts.codes.length+parts.names.length+parts.frontNames.length+parts.services.length)/30;
 }
 window.RETAILNAV_ROOF_ATTACHMENTS=attached;
 return summary;
}
window.RetailNavRoofText=Object.freeze({prepare:summarize,hasRoofImage});
})();
