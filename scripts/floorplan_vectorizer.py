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
import csv
from unit_index import inside
from unit_ocr import scan as scan_unit_codes
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



def grayscale_evidence(image):
    """Fuse three independent readings of walls without calling any verified.

    CLAHE restores *local* contrast; adaptive Gaussian threshold handles shadows
    and unequal lighting; a blurred-image subtraction finds genuinely dark
    strokes against the local background. No upscaling is invented.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    enhanced = cv2.createCLAHE(clipLimit=2.2,
                              tileGridSize=(8, 8)).apply(gray)
    blurred = cv2.GaussianBlur(enhanced, (3, 3), 0)
    binary = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 25, 7)
    background = cv2.GaussianBlur(gray, (0, 0), 5)
    locally_dark = np.uint8(cv2.subtract(background, gray) > 16) * 255
    support = cv2.bitwise_and(
        binary, cv2.dilate(locally_dark, np.ones((3, 3), np.uint8)))
    # Long, consistent strokes survive morphology; isolated printed letters
    # are less likely to erase shop interiors.
    horizontal = cv2.morphologyEx(
        support, cv2.MORPH_OPEN, np.ones((1, 8), np.uint8))
    vertical = cv2.morphologyEx(
        support, cv2.MORPH_OPEN, np.ones((8, 1), np.uint8))
    orthogonal = cv2.bitwise_or(horizontal, vertical)
    return {"gray":gray, "enhanced":enhanced, "binary":binary,
            "locallyDark":locally_dark, "supported":support,
            "orthogonal":orthogonal}


def detect_wall_candidates(image, min_length=14, evidence=None):
    """Rank black divider candidates using grayscale + B/W + color evidence.

    Thin shop walls can be straight, angled or in a colored area. Identified
    glyphs and logos can also be dark. Every candidate remains UNVERIFIED.
    Scores rank review priority only; they are never a proof of a real wall.
    """
    layers = evidence or grayscale_evidence(image)
    stroke = layers["supported"]
    dominant = layers["orthogonal"]
    # Hough finds straight segments including diagonals; the second pass
    # finds longer horizontal/vertical dividers under perspective correction.
    raw_a = cv2.HoughLinesP(
        stroke, 1, np.pi/180, threshold=12,
        minLineLength=max(min_length, 14), maxLineGap=3)
    raw_b = cv2.HoughLinesP(
        dominant, 1, np.pi/180, threshold=10,
        minLineLength=min_length, maxLineGap=4)
    raw = [r.reshape(-1,4) for r in (raw_a,raw_b) if r is not None]
    if not raw:
        return []
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    colour = (hsv[:,:,1] > 24) & (hsv[:,:,2] > 65)
    height,width=image.shape[:2]
    candidates={}
    for x1,y1,x2,y2 in np.concatenate(raw,axis=0):
        dx,dy=int(x2)-int(x1),int(y2)-int(y1)
        length=float(np.hypot(dx,dy))
        if length < min_length:continue
        a=(int(x1),int(y1));b=(int(x2),int(y2))
        if a>b:a,b=b,a
        steps=max(4,int(length))
        u=np.linspace(a[0],b[0],steps).astype(np.int32)
        v=np.linspace(a[1],b[1],steps).astype(np.int32)
        core=float(np.mean(layers["supported"][v,u]>0))
        adaptive=float(np.mean(layers["binary"][v,u]>0))
        orientation=("horizontal" if abs(dx)>abs(dy)*3 else
                     "vertical" if abs(dy)>abs(dx)*3 else "diagonal")
        # Evidence of colored regions on opposite sides is useful, not
        # mandatory (monochrome plans contain no chromatic signal).
        nx,ny=-dy/length,dx/length
        px1=np.clip(np.rint(u+nx*4).astype(int),0,width-1)
        py1=np.clip(np.rint(v+ny*4).astype(int),0,height-1)
        px2=np.clip(np.rint(u-nx*4).astype(int),0,width-1)
        py2=np.clip(np.rint(v-ny*4).astype(int),0,height-1)
        color_sides=float(min(np.mean(colour[py1,px1]),
                              np.mean(colour[py2,px2])))
        score=round(min(1., .38*core+.30*adaptive+
                         .20*min(1.,length/(min_length*3))+
                         .12*color_sides),3)
        key=(orientation,*[round(n/3) for n in (*a,*b)])
        item={
            "a":list(a),"b":list(b),"lengthPx":round(length,1),
            "orientation":orientation,
            "evidence":{"adaptiveBW":round(adaptive,3),
                        "grayscaleLocalContrast":round(core,3),
                        "colorOnBothSides":round(color_sides,3)},
            "confidence":score,
            "source":"adaptive-grayscale+color",
            "verified":False, "kind":"wall-or-lettering-candidate",
            "status":"needs-photo-review"
        }
        if key not in candidates or score>candidates[key]["confidence"]:
            candidates[key]=item
    return sorted(candidates.values(),
                  key=lambda line:(-line["confidence"],
                                   -line["lengthPx"],*line["a"]))[:3000]


def apply_reviewed_walls(mask, image, walls):
    """Split regions ONLY at operator-reviewed architectural dividers."""
    height, width = image.shape[:2]
    applied = []
    for item in walls:
        if not item.get("verified"):
            continue
        a, b = item.get("a"), item.get("b")
        if not isinstance(a, list) or not isinstance(b, list):
            continue
        if len(a) != 2 or len(b) != 2:
            continue
        if any(not np.isfinite(v) for v in (*a, *b)):
            continue
        if not all(0 <= a[i] < (width, height)[i] and
                   0 <= b[i] < (width, height)[i] for i in range(2)):
            continue
        if np.hypot(a[0]-b[0], a[1]-b[1]) < 3:
            continue
        cv2.line(mask, tuple(map(round, a)), tuple(map(round, b)),
                 0, thickness=2, lineType=cv2.LINE_8)
        applied.append({"a": a, "b": b, "verified": True})
    return applied


def extract(image, level, area=28, tolerance=.031, reviewed_walls=(),
            mode="hybrid", evidence=None):
    """Color regions split by dark dividers confirmed across gray and B/W.

    Automatic separations are PROVISIONAL. Never promote candidates to
    'verified': a sign or word may still create a line.
    """
    hsv=cv2.cvtColor(image,cv2.COLOR_BGR2HSV)
    layers=evidence or grayscale_evidence(image)
    colour=np.uint8((hsv[:,:,1]>25)&(hsv[:,:,2]>65))*255
    old_dark=np.uint8(cv2.subtract(
        cv2.GaussianBlur(layers["gray"],(0,0),5),layers["gray"])>20)*255
    horizontal=cv2.morphologyEx(
        old_dark,cv2.MORPH_OPEN,np.ones((1,9),np.uint8))
    vertical=cv2.morphologyEx(
        old_dark,cv2.MORPH_OPEN,np.ones((9,1),np.uint8))
    border=cv2.bitwise_or(horizontal,vertical)
    if mode=="hybrid":
        border=cv2.bitwise_or(border,layers["orthogonal"])
    border=cv2.dilate(border,np.ones((2,2),np.uint8),iterations=1)
    mask=cv2.bitwise_and(colour,cv2.bitwise_not(border))
    if np.mean(colour>0)<.018:
        # A floor plan with pastel/gray areas still has closed black walls.
        # We keep light interiors of closed walls but never call them routes.
        gray_interior=cv2.bitwise_not(
            layers["supported"] if mode=="hybrid"
            else cv2.Canny(layers["gray"],60,150))
        mask=cv2.bitwise_and(gray_interior,cv2.bitwise_not(border))
    apply_reviewed_walls(mask,image,reviewed_walls)
    mask[:5]=0;mask[-5:]=0;mask[:,:5]=0;mask[:,-5:]=0
    count,labels,stats,_=cv2.connectedComponentsWithStats(mask,8)
    candidates=[]
    limit=image.shape[0]*image.shape[1]*.90
    for code in range(1,count):
        x,y,w,h,size=map(int,stats[code])
        if size<area or size>limit or w<3 or h<3:continue
        region=np.uint8(labels[y:y+h,x:x+w]==code)*255
        outlines,_=cv2.findContours(
            region,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
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



def audit_boundary_alignment(image, features, evidence=None, max_distance=2.6):
    """Flag polygon walls not supported by grayscale/BW/color image edges.

    This is a *heuristic*, not a ground-truth IoU score. Printed labels,
    perspective blur, nonblack boundaries and over-simplified polygons can
    mislead it. A high score NEVER verifies a store's ownership or shape.
    """
    layers = evidence or grayscale_evidence(image)
    hsv = cv2.cvtColor(image,cv2.COLOR_BGR2HSV)
    gray_edges=cv2.Canny(layers["enhanced"],55,125)
    chromatic_edges=cv2.Canny(
        cv2.GaussianBlur(hsv[:,:,1],(3,3),0),42,110)
    ink=cv2.bitwise_or(gray_edges,chromatic_edges)
    ink=cv2.bitwise_or(ink,cv2.Canny(layers["supported"],40,110))
    distances=cv2.distanceTransform(255-ink,cv2.DIST_L2,3)
    h,w=image.shape[:2]
    results=[]
    for item in features:
        x=y=0
        pts=[]
        for dx,dy in zip(item[3][::2],item[3][1::2]):
            x+=dx;y+=dy;pts.append((x/2,y/2))
        outer=item[4][0] if item[4] else list(range(len(pts)))
        polygon=[pts[i] for i in outer if 0<=i<len(pts)]
        if len(polygon)<3:continue
        samples=[]
        for a,b in zip(polygon,polygon[1:]+polygon[:1]):
            length=float(np.hypot(b[0]-a[0],b[1]-a[1]))
            for t in np.linspace(0,1,max(2,int(length/1.7)),endpoint=False):
                px=int(round(a[0]+(b[0]-a[0])*t))
                py=int(round(a[1]+(b[1]-a[1])*t))
                if 1<=px<w-1 and 1<=py<h-1:
                    samples.append(float(distances[py,px]))
        if not samples:continue
        coverage=round(float(np.mean(np.array(samples)<=max_distance)),3)
        # Large unsupported borders are actionable, but not automatically
        # proof of errors because some plans use empty boundaries.
        concern=("low-visual-support" if coverage<.38 else
                 "partial-visual-support" if coverage<.63 else
                 "appears-aligned-needs-review")
        results.append({
            "polygonId":item[0],
            "label":item[2],
            "center":item[6],
            "boundarySupport":coverage,
            "samples":len(samples),
            "status":concern,
            "verified":False
        })
    results.sort(key=lambda row:(row["boundarySupport"],row["polygonId"]))
    needs=sum(x["status"]=="low-visual-support" for x in results)
    return {
        "schema":"retailnav.vector-boundary-audit.v1",
        "method":"CLAHE + adaptive ink + original color edge-distance",
        "reviewRequired":True, "verified":False,
        "maxEdgeDistancePx":max_distance,
        "sampledPolygonCount":len(results),
        "lowSupportCount":needs,
        "mediumSupportCount":sum(x["status"]=="partial-visual-support"
                                 for x in results),
        "averageBoundarySupport":round(
            float(np.mean([row["boundarySupport"] for row in results])),3)
            if results else 0,
        "assumption":"High edge agreement does not prove real-world store divisions.",
        "results":results
    }



def anchors(features, labels):
    for item in labels:
        point=(float(item["x"]),float(item["y"]))
        candidates=[feature for feature in features if inside(point,feature)]
        if len(candidates)==1:
            candidates[0][1]=0
            candidates[0][2]=str(item["name"])
        else:
            print("Anchor",item["name"],"needs manual polygon review; matches:",len(candidates))


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
    p.add_argument("--unit-codes",help="Optional reviewed identifiers JSON by floor, with code/x/y/name")
    p.add_argument("--districts",help="JSON containing reviewed names of commercial zones, with floor,x,y and widthPx,heightPx")
    p.add_argument("--pois",help="JSON keyed by floor of photo-reviewed bathrooms, lifts, stairs, metro, exits, information etc")
    p.add_argument("--reviewed-walls",help="JSON keyed by floor, containing only checked architectural line segments with verified=true")
    p.add_argument("--wall-min-length",type=int,default=14,help="Minimum image-pixel length of independent unreviewed wall candidates")
    p.add_argument("--segmentation",choices=["hybrid","color"],default="hybrid",help="Combine local grayscale/BW and original color (or older color-only borders)")
    p.add_argument("--disable-ocr",action="store_true",help="Skip automatic optional OCR suggestions")
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
    code_labels=json.loads(Path(args.unit_codes).read_text(encoding="utf-8")) if args.unit_codes else {}
    district_labels=json.loads(Path(args.districts).read_text(encoding="utf-8")) if args.districts else {}
    poi_labels=json.loads(Path(args.pois).read_text(encoding="utf-8")) if args.pois else {}
    reviewed_walls=json.loads(Path(args.reviewed_walls).read_text(encoding="utf-8")) if args.reviewed_walls else {}
    if args.wall_min_length < 8 or args.wall_min_length > 150:
        p.error("--wall-min-length must be between 8 and 150 pixels")
    manifest={
        "id":args.mall,"name":args.name or args.mall.replace("-"," ").title(),
        "city":args.city,"source":"Operator-supplied floor photos",
        "status":"vectorizado-provisional","origin":[width/2,height/2],
        "scale":round(140/width,5),"navigable":False,
        "warning":"Automatic regions, not independently verified stores, printed district names or routes.",
        "districts":[],"pois":[],"floors":[]
    }
    if args.gps:
        lat,lon=map(float,args.gps.split(","))
        if abs(lat)>90 or abs(lon)>180: p.error("Invalid coordinates")
        manifest["gps"]={"lat":lat,"lon":lon,"radiusM":600}
    reports=[]
    for entry in args.floor:
        level,separator,filename=entry.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9-]{0,10}",level):
            p.error("Each --floor must be e.g. B1=/path/photo.jpg")
        image=cv2.imread(str(Path(filename)))
        if image is None: p.error("Cannot open "+filename)
        if quad is not None:
            q=np.float32([[0,0],[width-1,0],[width-1,height-1],[0,height-1]])
            image=cv2.warpPerspective(image,cv2.getPerspectiveTransform(quad,q),(width,height))

        detected,message=([], "OCR disabled") if args.disable_ocr else scan_unit_codes(image)
        codes={row["code"]:row for row in detected}
        for reviewed in code_labels.get(level,[]):
            token=str(reviewed["code"]).strip().upper()
            codes[token]={"code":token,"x":float(reviewed["x"]),
                "y":float(reviewed["y"]),"name":str(reviewed.get("name","")),
                "source":"manual-from-photograph"}
        if codes:
            out_csv=output/(level+"-unit-codes.csv")
            with out_csv.open("w",encoding="utf-8",newline="") as stream:
                writer=csv.DictWriter(stream,fieldnames=["code","x","y","name","source"])
                writer.writeheader()
                for token in sorted(codes):
                    data=codes[token]
                    writer.writerow({name:data.get(name,"") for name in writer.fieldnames})
        print(level+":",len(codes),"visible candidate store IDs.",message,
              "Check labels against the source photo before trusting their polygons.")

        # Named districts are independent map entities. They are NOT a store
        # and should never replace black dividing walls between small units.
        for index, record in enumerate(district_labels.get(level, [])):
            name=str(record["name"]).strip()
            x,y=float(record["x"]),float(record["y"])
            if not name or not (0<=x<=image.shape[1] and 0<=y<=image.shape[0]):
                p.error("Commercial district label outside floor "+level)
            length=min(len(name)*13+70,300)
            manifest["districts"].append({
                "id":re.sub("[^a-z0-9]+","-",name.lower()).strip("-")+"-"+level.lower(),
                "name":name,"detail":str(record.get("detail","")),"floor":level,
                "x":x,"y":y,
                "widthPx":float(record.get("widthPx",length)),
                "heightPx":float(record.get("heightPx",35)),
                "source":"reviewed-source-map-print",
                "confidence":"manual-transcription"
            })

        # Protect amenities and circulation as their own searchable map layer.
        # Do not infer exits or accessibility from pixels without inspection.
        for record in poi_labels.get(level, []):
            item = dict(record)
            if not item.get("id") or not item.get("category") or not item.get("name"):
                p.error("POI requires id, category and name on "+level)
            px, py = item.get("x"), item.get("y")
            if px is not None or py is not None:
                if px is None or py is None or not (
                    0 <= float(px) <= image.shape[1] and
                    0 <= float(py) <= image.shape[0]):
                    p.error("POI coordinates are invalid on "+level)
            item["floor"] = level
            item.setdefault("confidence", "por-revisar")
            item.setdefault("source", "operator-photo-transcription")
            manifest["pois"].append(item)

        # Save the linework separately, even where two colour regions merged.
        # Candidates are not automatically walls: signs and logos contain
        # similar dark strokes. The review JPG makes this uncertainty visible.
        evidence=grayscale_evidence(image)
        cv2.imwrite(str(output/(level+"-grayscale-contrast.jpg")),evidence["enhanced"])
        cv2.imwrite(str(output/(level+"-adaptive-bw.png")),evidence["binary"])
        cv2.imwrite(str(output/(level+"-confirmed-strokes.png")),evidence["supported"])
        candidates = detect_wall_candidates(image, args.wall_min_length, evidence)
        inspected = reviewed_walls.get(level, [])
        accepted = [w for w in inspected if w.get("verified")]
        (output/(level+"-wall-candidates.json")).write_text(
            json.dumps({"schema":"retailnav.linework-review.v2",
                "floor":level,"status":"unreviewed",
                "method":"original-colour+CLAHE-grayscale+adaptive-BW",
                "candidates":candidates},separators=(",",":"))+"\n",
            encoding="utf-8"
        )
        line_preview = image.copy()
        for stroke in candidates:
            cv2.line(line_preview, tuple(stroke["a"]), tuple(stroke["b"]),
                     (0, 218, 255), 1, lineType=cv2.LINE_AA)
        for stroke in accepted:
            try:
                cv2.line(line_preview, tuple(map(int,stroke["a"])),
                         tuple(map(int,stroke["b"])), (255, 0, 225), 2,
                         lineType=cv2.LINE_AA)
            except (KeyError, TypeError, ValueError):
                pass
        cv2.imwrite(str(output/(level+"-wall-review.jpg")),line_preview)
        print(level+":",len(candidates),"independent dark-line candidates;",
              len(accepted),"reviewed dividers. Unreviewed lines never become walls.")


        feats=extract(image,level,args.min_area,args.simplify,inspected,
                      args.segmentation,evidence)
        anchors(feats,labels.get(level,[]))
        alignment=audit_boundary_alignment(image,feats,evidence)
        (output/(level+"-alignment-review.json")).write_text(
            json.dumps(alignment,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        image_audit=image.copy()
        for row in alignment["results"]:
            if row["status"]!="low-visual-support":continue
            cx,cy=map(int,row["center"])
            cv2.drawMarker(image_audit,(cx,cy),(0,0,230),
                           cv2.MARKER_TILTED_CROSS,12,2)
        cv2.imwrite(str(output/(level+"-alignment-review.jpg")),image_audit)

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
        if args.districts:
            preview=make_preview(image,feats)
            for item in manifest["districts"]:
                if item["floor"] == level:
                    cv2.putText(preview,item["name"],(int(item["x"]),int(item["y"])),
                                cv2.FONT_HERSHEY_SIMPLEX,.55,(8,85,174),2)
            cv2.imwrite(str(output/(level+"-districts-preview.jpg")),preview)
        manifest["floors"].append({
            "id":level,"name":level,"geometry":filename_out,
            "imageSize":pixels,"source":Path(filename).name,
            "lineworkReview":level+"-wall-candidates.json",
            "unverifiedLineCount":len(candidates),
            "reviewedWallCount":len(accepted)
        })
        reports.append({"floor":level,"status":"provisional",
            "polygonCount":len(feats),
            "wallCandidates":len(candidates),
            "segmentationMethod":args.segmentation,
            "grayscaleAnalysis":True,
            "adaptiveBinarization":True,
            "approvedWallCount":len(accepted),
            "printedStoreCodes":len(codes),
            "printedZoneNames":len(district_labels.get(level, [])),
            "mappedServices":len(poi_labels.get(level, [])),
            "alignmentAudit":level+"-alignment-review.json",
            "lowBoundarySupport":alignment["lowSupportCount"],
            "meanBoundarySupport":alignment["averageBoundarySupport"],
            "automaticChecksPassed":False,
            "exactPerStoreGeometryVerified":False,
            "navigable":False})
        print(level+": "+str(len(feats))+" provisional polygons, "+
              str(sum(f[1]==0 for f in feats))+" manually labeled anchors")
    (output/"mall.json").write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+"\n")
    (output/"vectorization-review.json").write_text(json.dumps(
        {"mallId":args.mall,"state":"needs-human-verification","floors":reports},
        indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print("New mall manifest:",output/"mall.json")
    print("Not for public navigation until a physical survey validates the map.")

if __name__=="__main__":
    run()
