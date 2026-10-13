#!/usr/bin/env python3
"""RetailNav image-to-vector import: provisional, reviewable colored floor plans.

pip install opencv-python-headless numpy
python3 scripts/floorplan_vectorizer.py --mall another-mall --name "Another Mall" \
  --floor B1=/path/floor1.jpg --floor B2=/path/floor2.jpg --out data/malls/another-mall
Photographed map boards often need --corners "TLx,TLy;TRx,TRy;BRx,BRy;BLx,BLy".
Optional --labels reviewed-anchors.json assigns names to manually checked points.
After reviewing the preview and manifest, commit mall.json and *.geometry.zlib.b64.
The site's build script automatically registers every new manifest; no code edit.

WARNING: This detects coloured regions, not guaranteed individual shops, doors,
walkable pathways, indoor GPS, accessibility, accurate floor links or scale.
DO NOT enable real navigation until a person validates surveyed geometry.
"""
import argparse
import base64
import json
import math
import re
import zlib
from pathlib import Path

import cv2
import numpy as np


def parse_corners(value):
    if not value:
        return None
    points = [[float(v) for v in pair.split(",")] for pair in value.split(";")]
    if len(points) != 4 or any(len(p) != 2 for p in points):
        raise ValueError("Expected TL;TR;BR;BL using four x,y corner pairs")
    return np.float32(points)


def triangles_from_polygon(points):
    p = [tuple(map(float, q)) for q in points]
    remaining = list(range(len(p)))
    triangles = []
    winding = sum(p[i][0]*p[(i+1)%len(p)][1]-p[(i+1)%len(p)][0]*p[i][1]
                  for i in range(len(p))) > 0
    def cross(a,b,c):
        return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    for _ in range(len(p)*len(p)):
        if len(remaining) <= 3:
            break
        accepted = False
        for i, idx in enumerate(remaining):
            previous,following=remaining[i-1],remaining[(i+1)%len(remaining)]
            a,b,c=p[previous],p[idx],p[following]
            if cross(a,b,c)*(1 if winding else -1)<=.01:
                continue
            def inside(q):
                parts=[cross(a,b,q),cross(b,c,q),cross(c,a,q)]
                return min(parts)>=-.01 if winding else max(parts)<=.01
            if any(inside(p[j]) for j in remaining if j not in (previous,idx,following)):
                continue
            triangles.extend([previous,idx,following])
            del remaining[i]
            accepted=True
            break
        if not accepted:
            return []
    if len(remaining)==3:
        triangles.extend(remaining)
    return triangles


def feature(fid, kind, name, contour, tolerance):
    pts=cv2.approxPolyDP(contour,tolerance*cv2.arcLength(contour,True),True)[:,0,:]
    pts=np.rint(pts.astype(float)*2).astype("int32")
    if len(pts)<3:
        return None
    tris=triangles_from_polygon(pts)
    if not tris:
        pts=cv2.convexHull(pts)[:,0,:]
        tris=triangles_from_polygon(pts)
    if not tris:
        return None
    delta=[]
    x=y=0
    for px,py in pts:
        delta.extend([int(px)-x,int(py)-y])
        x,y=int(px),int(py)
    m=cv2.moments(contour)
    center=[round(m["m10"]/m["m00"],1),round(m["m01"]/m["m00"],1)] if m["m00"] else [0,0]
    return [fid,kind,name,delta,[list(range(len(pts)))],tris,center]


def extract(image, level, area=28, tolerance=.031):
    hsv=cv2.cvtColor(image,cv2.COLOR_BGR2HSV)
    gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)
    background=cv2.GaussianBlur(gray,(0,0),5)
    colour=np.uint8((hsv[:,:,1]>25)&(hsv[:,:,2]>65))*255
    local_dark=np.uint8(cv2.subtract(background,gray)>20)*255
    horizontal=cv2.morphologyEx(local_dark,cv2.MORPH_OPEN,np.ones((1,9),np.uint8))
    vertical=cv2.morphologyEx(local_dark,cv2.MORPH_OPEN,np.ones((9,1),np.uint8))
    border=cv2.dilate(cv2.bitwise_or(horizontal,vertical),np.ones((2,2),np.uint8))
    mask=cv2.bitwise_and(colour,cv2.bitwise_not(border))
    if np.mean(colour>0)<.018:
        mask=cv2.bitwise_and(255-cv2.Canny(gray,60,150),cv2.bitwise_not(border))
    mask[:5]=0;mask[-5:]=0;mask[:,:5]=0;mask[:,-5:]=0
    count,labels,stats,_=cv2.connectedComponentsWithStats(mask,8)
    candidates=[]
    limit=image.shape[0]*image.shape[1]*.20
    for code in range(1,count):
        x,y,w,h,size=map(int,stats[code])
        if size<area or size>limit or w<3 or h<3:continue
        region=np.uint8(labels[y:y+h,x:x+w]==code)*255
        outlines,_=cv2.findContours(region,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        if not outlines:continue
        curve=max(outlines,key=cv2.contourArea)
        if cv2.contourArea(curve)<area*.65:continue
        curve[:,:,0]+=x;curve[:,:,1]+=y
        candidates.append((size,curve))
    candidates.sort(key=lambda item:-item[0])
    features=[]
    for _,contour in candidates[:600]:
        identifier="{}-{:04d}".format(level,len(features)+1)
        entry=feature(identifier,1,"",contour,tolerance)
        if entry:features.append(entry)
    return features


def anchors(features, labels):
    for item in labels:
        target=(float(item["x"]),float(item["y"]))
        nearest=min(features,key=lambda f:math.dist(f[6],target),default=None)
        if nearest and math.dist(nearest[6],target)<float(item.get("maxDistance",80)):
            nearest[1]=0
            nearest[2]=str(item["name"])


def make_preview(image, regions):
    out=image.copy()
    for feature_item in regions:
        values=feature_item[3]
        x=y=0
        points=[]
        for dx,dy in zip(values[::2],values[1::2]):
            x+=dx;y+=dy
            points.append((x//2,y//2))
        cv2.polylines(out,[np.array(points,np.int32)],True,(0,0,255),2)
    return out


def run():
    p=argparse.ArgumentParser(description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--mall",required=True)
    p.add_argument("--name",help="Mall's display name (defaults to ID)")
    p.add_argument("--city",default="")
    p.add_argument("--floor",required=True,action="append",help="LEVEL=/path/to/photo.png")
    p.add_argument("--out",required=True)
    p.add_argument("--corners",help="Original image TL;TR;BR;BL points")
    p.add_argument("--size",default="1440x620",help="Perspective-corrected width x height")
    p.add_argument("--labels",help="JSON by level: {\"B1\":[{\"name\":\"KFC\",\"x\":1,\"y\":2}]}")
    p.add_argument("--min-area",type=int,default=28)
    p.add_argument("--simplify",type=float,default=.031)
    p.add_argument("--gps",help="Optional mall-level geographic anchor: latitude,longitude")
    args=p.parse_args()
    if not re.fullmatch(r"[a-z][a-z0-9-]{1,48}",args.mall):
        p.error("Mall ID must be a lowercase slug")
    width,height=map(int,args.size.lower().split("x"))
    if min(width,height)<100 or max(width,height)>4096:
        p.error("Invalid --size")
    quad=parse_corners(args.corners)
    output=Path(args.out)
    output.mkdir(parents=True,exist_ok=True)
    labels=json.loads(Path(args.labels).read_text(encoding="utf-8")) if args.labels else {}
    manifest={
        "id":args.mall,"name":args.name or args.mall.replace("-"," ").title(),
        "city":args.city,"source":"Operator-supplied floor photos",
        "status":"vectorizado-provisional","origin":[width/2,height/2],
        "scale":round(140/width,5),"navigable":False,
        "warning":"Automatic regions, not independently verified stores or routes.",
        "floors":[]
    }
    if args.gps:
        lat,lon=map(float,args.gps.split(","))
        if abs(lat)>90 or abs(lon)>180: p.error("Invalid coordinates")
        manifest["gps"]={"lat":lat,"lon":lon,"radiusM":600}
    for entry in args.floor:
        level,separator,filename=entry.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9-]{0,10}",level):
            p.error("Each --floor must be e.g. B1=/path/photo.jpg")
        image=cv2.imread(str(Path(filename)))
        if image is None: p.error("Cannot open "+filename)
        if quad is not None:
            q=np.float32([[0,0],[width-1,0],[width-1,height-1],[0,height-1]])
            image=cv2.warpPerspective(image,cv2.getPerspectiveTransform(quad,q),(width,height))
        feats=extract(image,level,args.min_area,args.simplify)
        anchors(feats,labels.get(level,[]))
        if len(feats)<3: p.error("Insufficient regions in "+level)
        pixels=[image.shape[1],image.shape[0]]
        filename_out=level+".geometry.zlib.b64"
        payload=json.dumps(feats,ensure_ascii=False,separators=(",",":")).encode("utf-8")
        (output/filename_out).write_text(base64.b64encode(zlib.compress(payload,9)).decode("ascii")+"\n")
        (output/(level+".json")).write_text(json.dumps({
            "schema":"retailnav.floor.compact.v1","id":level,
            "name":level,"source":Path(filename).name,
            "geometry":feats,"status":"provisional-not-navigable"
        },ensure_ascii=False,separators=(",",":")),encoding="utf-8")
        cv2.imwrite(str(output/(level+"-preview.jpg")),make_preview(image,feats))
        manifest["floors"].append({
            "id":level,"name":level,"geometry":filename_out,
            "imageSize":pixels,"source":Path(filename).name
        })
        print(level+": "+str(len(feats))+" provisional polygons, "+
              str(sum(f[1]==0 for f in feats))+" manually labeled anchors")
    (output/"mall.json").write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+"\n")
    print("New mall manifest:",output/"mall.json")
    print("Not for public navigation until a physical survey validates the map.")

if __name__=="__main__":
    run()
