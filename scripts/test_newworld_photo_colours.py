#!/usr/bin/env python3
"""Audit & reproduce experimental New World City L1-L7 photo-colour meshes.

Only colour-island boundaries are traced. No tenant wall or real walkway is
certified. All geometry is reproducible from seven cropped photographed maps
embedded in this Git repository. Do NOT claim 195 polygons are 195 stores.

Run: python3 scripts/test_newworld_photo_colours.py
Or test a local extracted candidate tree:
    python3 scripts/test_newworld_photo_colours.py --directory /tmp/candidate-data
"""
from __future__ import annotations
import argparse,base64,csv,hashlib,json,sys,tempfile,zlib
from pathlib import Path
from collections import Counter
import cv2
import numpy as np
from shapely.geometry import Polygon
from shapely import constrained_delaunay_triangles
from shapely.ops import unary_union

ROOT=Path(__file__).resolve().parents[1]
SOURCES={
 'L1':(None,None,(95,-5,30,-9),None),
 'L2':(None,None,(100,-4,25,-10),None),
 'L3':(None,None,(90,-4,15,-8),None),
 'L4':(None,None,(55,-4,20,-9),None),
 'L5':(None,None,(80,-4,20,-10),None),
 'L6':(None,None,(76,-4,15,-8),None),
 'L7':(None,None,(60,-4,30,-8),None),
}

def segment(photo_path, floor):
 # Read the transcoded map reference, not a different source image.
 a=cv2.imread(str(photo_path)); hsv=cv2.cvtColor(a,cv2.COLOR_BGR2HSV)
 h,w=a.shape[:2]
 pix=np.uint8((hsv[:,:,1]>21)&(hsv[:,:,2]>137)&(hsv[:,:,2]<244))*255
 y0,ye,x0,xe=SOURCES[floor][2];y1=ye if ye>0 else h+ye;x1=xe if xe>0 else w+xe
 pix[:y0]=0;pix[y1:]=0;pix[:,:x0]=0;pix[:,x1:]=0
 # A 1-pixel erosion separates visibly white corridors from pastel shop ink.
 pix=cv2.erode(pix,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(3,3)),iterations=1)
 num,labels,stats,cent=cv2.connectedComponentsWithStats(pix,8)
 candidates=[]
 for k in range(1,num):
  x,y,bw,bh,area=(int(z) for z in stats[k]);
  if area < 53 or bw<7 or bh<6:continue
  region=np.uint8(labels[y:y+bh,x:x+bw]==k)*255
  contours,hierarchy=cv2.findContours(region,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE)
  if not contours:continue
  contour=max(contours,key=cv2.contourArea)
  if cv2.contourArea(contour)<38:continue
  simplified=cv2.approxPolyDP(contour,1.4,True).reshape(-1,2)
  if len(simplified)<3:continue
  pts=np.asarray(simplified,dtype=float)+[x,y]
  # Contour trees preserve genuine white internal corridors. Text-sized holes
  # are excluded, while larger photograph-white spaces remain empty.
  holes=[]
  if hierarchy is not None:
   largest=max(range(len(contours)),key=lambda i:cv2.contourArea(contours[i]))
   for index,child in enumerate(contours):
    if int(hierarchy[0][index][3])!=largest:continue
    if cv2.contourArea(child)<65:continue
    hp=cv2.approxPolyDP(child,1.3,True).reshape(-1,2)
    if len(hp)>2:
     holes.append((np.asarray(hp,dtype=float)+[x,y]).tolist())
  polygon=Polygon(pts,holes=holes)
  if not polygon.is_valid:polygon=polygon.buffer(0)
  if polygon.geom_type!='Polygon' or polygon.area<42:continue
  polygon=polygon.simplify(.7,preserve_topology=True)
  outer=list(polygon.exterior.coords)[:-1]
  holes=[list(ring.coords)[:-1] for ring in polygon.interiors]
  def halfpix(ring):return [(round(xx*2)/2,round(yy*2)/2) for xx,yy in ring]
  outer=halfpix(outer);holes=[halfpix(r) for r in holes]
  polygon=Polygon(outer,holes=holes)
  if not polygon.is_valid or polygon.area<42:continue
  # Because polygons are derived from disjoint connected components, avoid
  # silently fabricating an interior retail wall or splitting an identified shop.
  candidates.append((polygon,(x,y,bw,bh),area))
 # Stable, visually meaningful order, from top to bottom, then left to right.
 candidates.sort(key=lambda r:(int(r[0].centroid.y)//12,r[0].centroid.x))
 features=[]; polygons=[];triangles_count=0;pixel_coverage=0
 for n,(poly,bbox,area) in enumerate(candidates,1):
  polygon_rings=[list(poly.exterior.coords)[:-1]]+[list(inner.coords)[:-1] for inner in poly.interiors]
  points=[point for ring in polygon_rings for point in ring]
  rings=[];offset=0
  for ring in polygon_rings:
   rings.append(list(range(offset,offset+len(ring))))
   offset+=len(ring)
  # Constrained Delaunay respects concave, curved and HOLED pixel polygons.
  tris=list(constrained_delaunay_triangles(poly).geoms)
  if not tris:continue
  index={tuple(p):i for i,p in enumerate(points)}
  triangles=[]
  for tri in tris:
   tri_points=list(tri.exterior.coords)[:-1]
   try:ids=[index[tuple(p)] for p in tri_points]
   except KeyError:continue
   triangles.extend(ids)
  if not triangles:continue
  coverage=sum(t.area for t in tris)
  if abs(coverage-poly.area)> max(.05,poly.area*.003):
   print('SKIP poorly triangulated',floor,n,poly.area,coverage);continue
  absolute=[(int(x*2),int(y*2)) for x,y in points];prev=[0,0];deltas=[]
  for x,y in absolute:
   deltas.extend([x-prev[0],y-prev[1]]);prev=[x,y]
  cid=f'NWC-{floor}-{n:04d}'
  # COLOUR CLUSTER, not an independently verified tenancy.
  kind='zone' if area>2700 else 'unit'
  f=[cid,kind,'',deltas,rings,triangles,
    [round(poly.representative_point().x,2),round(poly.representative_point().y,2)]]
  features.append(f);polygons.append(poly);triangles_count+=len(triangles)//3;pixel_coverage+=area
 out={'floor':floor,'status':'PHOTO-COLOUR-CONTOURS-PROVISIONAL-NOT-APPROVED',
  'method':'direct-on-photograph pastel connected components; no invented subdivisions',
  'photoSegments':len(features),'vertices':sum(len(f[3])//2 for f in features),
  'triangles':triangles_count,'pixelArea':pixel_coverage,'candidatesAreStores':False,
  'unresolvedJoinedAreas':sum(f[1]=='zone' for f in features),
  'geometryValid':True,'overlapPixelArea':round(sum(p.area for p in polygons)-unary_union(polygons).area,6),
  'photoImageSize':[w,h],'rejectedSmallShapes':num-1-len(features)}
 return features,out



def decode(data):
 return json.loads(zlib.decompress(base64.b64decode(data.strip())))

def verify(data_dir):
 manifest=json.loads((data_dir/'mall.json').read_text(encoding='utf8'))
 report=json.loads((data_dir/'photo-vectorization.report.json').read_text(encoding='utf8'))
 assert manifest['id']=='new-world-city-shanghai'
 assert manifest['navigable'] is False
 assert [fl['id'] for fl in manifest['floors']]==list(SOURCES)
 assert not manifest['floorAlignmentApproved']
 assert len(report)==7
 names=set();total=0;shapes=0;anchors=0
 with tempfile.TemporaryDirectory() as tmp:
  for floor in SOURCES:
   meta=report[floor]
   chunks=sorted(data_dir.glob(floor+'.reference.webp.b64.part*'))
   assert len(chunks)==1,(floor,'reference missing / duplicate')
   raw=base64.b64decode(''.join(c.read_text().strip() for c in chunks))
   sha=hashlib.sha256(raw).hexdigest()
   assert sha==meta['photoSHA256']==manifest['floorReferences'][floor]['sha256']
   path=Path(tmp)/(floor+'.webp');path.write_bytes(raw)
   actual,summary=segment(path,floor)
   stored=decode((data_dir/(floor+'.geometry.zlib.b64')).read_text())
   assert actual==stored,(floor,'mesh does not reproduce from photo')
   assert summary['photoSegments']==meta['photoSegments']
   assert summary['overlapPixelArea']==0
   assert summary['triangles']==meta['triangles']
   assert summary['vertices']==meta['vertices']
   assert all(len(f)==7 and len(f[3])>=6 and len(f[5])%3==0 for f in stored)
   for f in stored:
    assert f[0] not in names,(floor,'duplicate feature ID')
    names.add(f[0])
   with (data_dir/(floor+'-unit-codes.csv')).open(newline='',encoding='utf8') as handle:
    rows=list(csv.DictReader(handle))
   assert rows and len(rows)==meta['directoryBrandRecords']
   assert len(set(r['code'] for r in rows))==len(rows)
   assert all(r['floor']==floor and r['tags'] and r['category'] for r in rows)
   for row in rows:
    if row['x'] or row['y']:
     assert row['x'] and row['y'],(floor,row['code'])
     x,y=float(row['x']),float(row['y'])
     assert 0<=x<=meta['photoImageSize'][0] and 0<=y<=meta['photoImageSize'][1]
     anchors+=1
   assert manifest['floorReferences'][floor]['qa']['status']=='pending'
   total+=len(rows);shapes+=len(stored)
   print(f'{floor}: {len(stored)} colour regions, {len(rows)} directory records, original photo hash OK')
 assert total==380 and shapes==195 and len(names)==195
 assert manifest['commercialDirectoryRecords']==380
 assert manifest['vectorRegionCount']==195
 assert len(manifest['districts'])==7
 print(f'PASS: 7 distinct floors, {shapes} reproducible photo-derived colour regions, {total} searchable records, {anchors} provisional text anchors; NOT certified navigation')

if __name__=='__main__':
 parser=argparse.ArgumentParser()
 parser.add_argument('--directory',type=Path,default=ROOT/'data/malls/new-world-city-shanghai')
 args=parser.parse_args()
 verify(args.directory)