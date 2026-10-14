#!/usr/bin/env python3
"""Render 3 precise high-res, shared-coordinate reference floor maps from the public RoveIQ GeoJSON."""
import json, math, csv, html, urllib.request
from pathlib import Path
from PIL import Image
import cairosvg

OUT=Path("research-output/aventura"); OUT.mkdir(parents=True,exist_ok=True)
URL="https://s3.us-east-2.amazonaws.com/settings.roveiq.com/venue-107/map.json"
request=urllib.request.Request(URL,headers={"User-Agent":"RetailNav-research/1.0"})
with urllib.request.urlopen(request,timeout=75) as conn: data=json.load(conn)
floors=sorted(data["floors"],key=lambda f:f.get("index",0))
transitions=data.get("floor_transitions",[])
colors={"Lower Level":"#D5A900","Upper Level":"#DA4156","Third Level":"#356FB6"}
short={"Lower Level":"LL","Upper Level":"UL","Third Level":"L3"}
names={"Lower Level":"aventura-lower-level","Upper Level":"aventura-upper-level","Third Level":"aventura-third-level"}
W,H=6200,7400
def feats(d):
    x=(d or {}).get("data") or {}
    if isinstance(x,str):
        try:x=json.loads(x)
        except Exception:x={}
    return x.get("features",[]) if isinstance(x,dict) else []
def polys(ft):
    geom=(ft or {}).get("geometry") or {}
    if geom.get("type")=="Polygon":return [geom.get("coordinates") or []]
    if geom.get("type")=="MultiPolygon":return geom.get("coordinates") or []
    return []
def points(ft):
    for polygon in polys(ft):
        for ring in polygon:
            for pt in ring:
                if len(pt)>=2:yield float(pt[0]),float(pt[1])
byfloor={f["id"]:feats(f["structures_dataset"]) for f in floors}
positions=[pt for seq in byfloor.values() for ft in seq for pt in points(ft)]
assert len(positions)>100, "Missing native building polygons"
lat0=sum(y for x,y in positions)/len(positions)
cos=math.cos(math.radians(lat0))
def projected(lon,lat):return lon*111320*cos,lat*111320
earth=[projected(*pt) for pt in positions]
for t in transitions:earth.append(projected(float(t["longitude"]),float(t["latitude"])))
x0=min(x for x,y in earth);x1=max(x for x,y in earth)
y0=min(y for x,y in earth);y1=max(y for x,y in earth)
dx=x1-x0;dy=y1-y0
x0-=dx*.04;x1+=dx*.04;y0-=dy*.04;y1+=dy*.04
dx=x1-x0;dy=y1-y0
scale=min(5000/dx,6250/dy)
left=255+(5000-dx*scale)*.5
top=500+(6250-dy*scale)*.5
def xy(lon,lat):
    x,y=projected(lon,lat)
    return left+(x-x0)*scale,top+(y1-y)*scale
def path(ft):
    s=[]
    for poly in polys(ft):
        for ring in poly:
            p=[xy(float(c[0]),float(c[1])) for c in ring if len(c)>=2]
            if len(p)>=3:s.append("M "+" L ".join(f"{x:.2f},{y:.2f}" for x,y in p)+" Z")
    return " ".join(s)
def paths(fs,stroke,fill="none",width=3,opacity=1):
    out=[]
    for f in fs:
        p=path(f)
        if p:out.append(f'<path d="{p}" stroke="{stroke}" stroke-width="{width}" fill="{fill}" fill-rule="evenodd" stroke-linejoin="round" opacity="{opacity}"/>')
    return "\n".join(out)
def styles(f,term):
    return [feat for ds in f.get("style_dataset",[]) if term in ds.get("title","").lower() for feat in feats(ds)]
def ty(t):
    name=t["name"].lower()
    if "elevat" in name:return ("Ascensor","#126A8F")
    if "escalat" in name:return ("Escalera mec.","#BB6028")
    return ("Escalera","#7C58AC")
def tf(ids):
    return "/".join(short[f["name"]] for f in floors if f["id"] in ids)
def text(x,y,s,size=32,color="#304256",weight="normal",extra=""):
    return f'<text x="{x:.1f}" y="{y:.1f}" font-family="DejaVu Sans, Arial, sans-serif" font-size="{size}" fill="{color}" font-weight="{weight}" {extra}>{html.escape(str(s))}</text>'
def head(title,desc,accent):
    return "\n".join([f'<rect x="0" y="0" width="{W}" height="{H}" fill="white"/>',
        f'<rect x="0" y="0" width="{W}" height="18" fill="{accent}"/>',
        text(235,156,title,94,"#1C2D3E","bold"),text(240,236,desc,41,"#596A7C"),
        '<path d="M235,285 H5950" stroke="#E3E7EC" stroke-width="4"/>',
        '<rect x="5400" y="382" width="575" height="6600" fill="#F6F8FA" rx="28"/>'])
def legend(floor=None):
    out=[text(5450,485,"CONEXIONES",35,"#203449","bold"),
         text(5450,534,"VERTICALES",35,"#203449","bold"),
         text(5450,599,"ID de RoveIQ",26,"#667788")]
    yy=677
    for t in transitions:
        if floor is not None and floor["id"] not in t["floor_ids"]:continue
        label,color=ty(t)
        out.extend([f'<circle cx="5462" cy="{yy-11}" r="12" fill="{color}"/>',
            text(5493,yy,t["id"],31,"#26384B","bold"),
            text(5580,yy,"Asc." if label=="Ascensor" else "Mec." if label=="Escalera mec." else "Esc.",25,"#647487"),
            text(5445,yy+32,tf(t["floor_ids"]),22,"#8795A3")])
        yy+=110
    return "\n".join(out)
def marks(level=None):
    els=[]
    for t in transitions:
        if level is not None and level["id"] not in t["floor_ids"]:continue
        x,y=xy(float(t["longitude"]),float(t["latitude"]))
        color=ty(t)[1]
        els.extend([f'<circle cx="{x:.2f}" cy="{y:.2f}" r="43" fill="white" stroke="white" stroke-width="9"/>',
          f'<circle cx="{x:.2f}" cy="{y:.2f}" r="36" fill="{color}" stroke="white" stroke-width="4"/>',
          text(x,y+10,t["id"],28,"white","bold",'text-anchor="middle"')])
    return "\n".join(els)
def north():
    return '<path d="M375 465 L340 545 L375 523 L410 545 Z" fill="#344C65"/>'+text(375,437,"N",42,"#344C65","bold",'text-anchor="middle"')
def save(name,body):
    xml=f'<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><title>{html.escape(name)}</title>\n{body}\n</svg>'
    svg=OUT/(name+".svg");png=OUT/(name+".png")
    svg.write_text(xml,encoding="utf-8")
    cairosvg.svg2png(bytestring=xml.encode("utf-8"),write_to=str(png))
    with Image.open(png) as im:im.verify()
    print("RENDER",name,svg.stat().st_size,png.stat().st_size,flush=True)
    return {"name":name,"svg":svg.name,"png":png.name,"pngBytes":png.stat().st_size}

# Store labels are sourced from the same official RoveIQ directory that powers the
# interactive map. This creates NEW files, leaving earlier unlabeled maps intact.
from collections import Counter
from shapely.geometry import Polygon, MultiPolygon, box
from shapely.ops import polylabel
from textwrap import wrap
from functools import lru_cache
from unicodedata import normalize

LOCATIONS_URL="https://s3.us-east-2.amazonaws.com/settings.roveiq.com/venue-107/locations.json"
rq=urllib.request.Request(LOCATIONS_URL,headers={"User-Agent":"RetailNav-research/1.0"})
with urllib.request.urlopen(rq,timeout=75) as con:
    raw_locations=json.load(con)
locations=raw_locations.get("locations",raw_locations if isinstance(raw_locations,list) else [])
byid={str(v.get("id")):v for v in locations if isinstance(v,dict) and v.get("id") is not None}
assert len(byid)>=300, "Official store directory missing"
def ref_id(feat):
    p=feat.get("properties") or {}
    return str(p.get("loc_id") or p.get("location_id") or "").strip()
def is_poi(loc):
    types={str(t.get("name","")).casefold() for t in loc.get("location_types",[]) if isinstance(t,dict)}
    name=(loc.get("name") or "").casefold().strip()
    if loc.get("disabled") is True:return True
    if name in ("parking lot","parking garage","vacant","coming soon"):return True
    # Focus map labels on tenant names. Amenity icons remain independently available.
    if any(k in name for k in ("elevator near","escalator near","stairway","restrooms","atm near","parking garage")):return True
    if "elevators" in types or "escalators" in types or "restrooms" in types:return True
    return False

def area_shape(feat):
    parts=[]
    for pol in polys(feat):
        if not pol:continue
        outer=[xy(float(p[0]),float(p[1])) for p in pol[0] if len(p)>=2]
        holes=[[xy(float(p[0]),float(p[1])) for p in ring if len(p)>=2] for ring in pol[1:]]
        if len(outer)<3:continue
        try:
            g=Polygon(outer, holes=holes)
            if not g.is_valid:g=g.buffer(0)
            if g.is_empty:continue
            if isinstance(g,MultiPolygon):parts.extend(list(g.geoms))
            else:parts.append(g)
        except Exception:pass
    return max(parts,key=lambda x:x.area) if parts else None

def candidates(f):
    results=[]
    stats=Counter()
    unresolved=[]
    for idx,feat in enumerate(byfloor[f["id"]]):
        key=ref_id(feat)
        if not key:
            stats["no_location_id"]+=1;unresolved.append({"polygonIndex":idx,"status":"no-location-id"});continue
        loc=byid.get(key)
        if loc is None:
            stats["id_not_in_official_directory"]+=1;unresolved.append({"polygonIndex":idx,"id":key,"status":"missing-from-directory"});continue
        name=str(loc.get("name") or "").strip()
        if not name:
            stats["empty_official_name"]+=1;unresolved.append({"polygonIndex":idx,"id":key,"status":"empty-official-name"});continue
        stats["matched_ids"]+=1
        geom=area_shape(feat)
        if geom is None or geom.area<3:
            stats["no_usable_polygon"]+=1;unresolved.append({"polygonIndex":idx,"id":key,"name":name,"status":"bad-polygon"});continue
        if is_poi(loc):
            stats["mapped_facility_not_a_shop"]+=1
            continue
        types=[str(t.get("name","")) for t in (loc.get("location_types") or []) if isinstance(t,dict)]
        results.append({"locationId":key,"name":name,"types":types,"category":types[0] if types else "",
                        "shape":geom,"area":float(geom.area),"polygonIndex":idx,
                        "latitude":loc.get("lat"),"longitude":loc.get("lng"),
                        "officialLocation":loc})
    return results,stats,unresolved

def multiline(s,max_chars=24,max_lines=3):
    s=" ".join(s.split()).replace(" - ","\n")
    lines=[]
    for segment in s.split("\n"):
        words=segment.split()
        line=""
        for w in words:
            if line and len(line+" "+w)>max_chars:
                lines.append(line);line=w
            else:
                line=(line+" "+w).strip()
        if line:lines.append(line)
    if len(lines)>max_lines:
        lines=lines[:max_lines]
        if len(lines[-1])>max_chars-1:lines[-1]=lines[-1][:max_chars-1]
        if not lines[-1].endswith("…"):lines[-1]=lines[-1].rstrip(" .")+"…"
    return lines or [s]

def esc(x):return html.escape(str(x),quote=True)
def annotate(f):
    entries,counts,unresolved=candidates(f)
    entries.sort(key=lambda x:-x["area"])
    labels=[]
    rendered=[]
    used=[]
    for item in entries:
        poly=item["shape"];bounds=poly.bounds; width=bounds[2]-bounds[0];height=bounds[3]-bounds[1]
        name=item["name"]
        anchor=polylabel(poly,tolerance=2.5)
        cx,cy=anchor.x,anchor.y
        # Native labels are limited to 3 lines and never positioned from invented
        # coordinates: every marker is inside its official mapped store polygon.
        max_chars=max(9,min(32,int(width/12)))
        lines=multiline(name,max_chars=max_chars,max_lines=3)
        longest=max(map(len,lines))
        size=min(34, max(15,min((width-10)/(0.60*max(1,longest)), (height-8)/(1.25*len(lines)))))
        size=float(round(size,1))
        needed_w=longest*size*0.59
        needed_h=len(lines)*size*1.22
        safe=box(cx-needed_w/2,cy-needed_h/2,cx+needed_w/2,cy+needed_h/2)
        is_readable = size>=16 and poly.buffer(5).contains(safe) and width>48 and height>24
        # Full labels take precedence, then compact numbered marks for cases
        # too narrow to show the official store name without overlap.
        if is_readable:
            label_text=[]
            y0=cy-(len(lines)-1)*size*.62
            for i,line in enumerate(lines):
                y=y0+i*size*1.24
                label_text.append(f'<text x="{cx:.2f}" y="{y:.2f}" font-family="DejaVu Sans,Arial,sans-serif" font-size="{size:.1f}" text-anchor="middle" dominant-baseline="central" font-weight="600" stroke="white" stroke-width="{max(1.1,size*.11):.1f}" paint-order="stroke" fill="#203246">{esc(line)}</text>')
            labels.append('<g class="shop-label" data-location-id="'+esc(item["locationId"])+'"><title>'+esc(name)+'</title>'+"".join(label_text)+'</g>')
            status="full-name"
        else:
            # Small unit: location ID visibly references downloadable official
            # directory, SVG tooltip still includes exact store name.
            radius=11
            labels.append(f'<g class="shop-compact" data-location-id="{esc(item["locationId"])}"><title>{esc(name)}</title><circle cx="{cx:.2f}" cy="{cy:.2f}" r="{radius}" fill="#355C76" stroke="white" stroke-width="2"/><text x="{cx:.2f}" y="{cy+3.5:.2f}" font-family="sans-serif" text-anchor="middle" font-size="9" font-weight="bold" fill="white">i</text></g>')
            status="compact-marker"
        counts[status]+=1
        rendered.append({"locationId":item["locationId"],"name":name,"category":item["category"],
                         "types":item["types"],"polygonIndex":item["polygonIndex"],
                         "labelMode":status,"anchorPixels":[round(cx,1),round(cy,1)],"floorId":f["id"],
                         "source":"RoveIQ locations.json + structures_dataset.properties.loc_id"})
    return "\n".join(labels),counts,rendered,unresolved

def index_svg():
    return text(235,7200,"Etiquetas: nombre dentro del local si hay espacio; puntos 'i' para espacios compactos (consultar listado).",28,"#758596")
outs=[]
summary=[]
allrecords=[]
unresolved_records=[]
for idx,f in enumerate(floors):
    shop_svg,stats,records,unresolved=annotate(f)
    name=f["name"];basename=names[name]+"-con-comercios"
    print("MATCH",name,json.dumps(dict(stats)),flush=True)
    els=[head("Aventura Mall - "+name+" | CON COMERCIOS",f"Planta {idx+1} de 3  |  Datos oficiales RoveIQ  |  Norte arriba",colors[name]),
      paths(styles(f,"style floors"),"none","#F4F6F8",0),
      paths(byfloor[f["id"]],"#708193","#E8EDF2",2.5),
      paths(styles(f,"grass"),"none","#D7E6D7",0),
      paths(styles(f,"purple"),"#7D71A7","#D6D0E9",1.7),
      paths(styles(f,"walls"),"#435465","#495B6C",1.1,.85),
      shop_svg,
      north(),legend(f),marks(f),index_svg(),
      text(240,7300,f"RoveIQ | {len(byfloor[f['id']])} unidades | {len(records)} etiquetas verificadas contra el directorio | conservar escala y origen",29,"#738394")]
    output=save(basename,"\n".join(els))
    outs.append({"floorId":f["id"],"floorName":name,**output})
    summary.append({"floorId":f["id"],"floorName":name,"totalPolygons":len(byfloor[f["id"]]),"linkedShops":len(records),
                    **dict(stats),"unmatched":len(unresolved)})
    allrecords.extend(records)
    unresolved_records.extend([{**x,"floorId":f["id"]} for x in unresolved])
assert len(summary)==3 and sum(x["matched_ids"] for x in summary)>=400
assert sum(x["linkedShops"] for x in summary)>200
with (OUT/"aventura-comercios-mapeados.csv").open("w",newline="",encoding="utf-8") as out:
    w=csv.writer(out)
    w.writerow(["floor_id","location_id","official_name","category","types","polygon_index","label_mode","anchor_px","anchor_py","source"])
    for item in allrecords:
        w.writerow([item["floorId"],item["locationId"],item["name"],item["category"],
                    " | ".join(item["types"]),item["polygonIndex"],item["labelMode"],*item["anchorPixels"],item["source"]])
report={
 "sourceMap":URL,"sourceDirectory":LOCATIONS_URL,"validation":"exact loc_id -> id join, without inventing names",
 "totalDirectoryLocations":len(byid),"floorSummaries":summary,"images":outs,
 "recordCount":len(allrecords),"records":allrecords,"unmatchedPolygons":unresolved_records,
 "warnings":["Original floor images unchanged; these are NEW labeled versions.",
 "Names and categories are from the official RoveIQ public locations directory.",
 "No name is assigned to a polygon without an exact official ID match.",
 "Parking and elevator geometry is not assigned fictitious shop names.",
 "Compact venues have an information dot; the exact official names are in the CSV and SVG tooltip.",
 "The mall's own map is not a certified architectural floor survey."]
}
(OUT/"aventura-label-validation.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
print("COMPLETED LABELED FLOOR EXPORT",json.dumps({"records":len(allrecords),"floors":summary,"images":len(outs)},ensure_ascii=False),flush=True)
