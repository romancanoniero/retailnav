#!/usr/bin/env python3
"""Create georeferenced 2D PNG/SVG plans from the official Aventura Mall map GeoJSON."""
import json, math, urllib.request
from pathlib import Path
from html import escape
import numpy as np
import cairosvg

OUT=Path("research-output/aventura")
OUT.mkdir(parents=True,exist_ok=True)
URL="https://s3.us-east-2.amazonaws.com/settings.roveiq.com/venue-107/map.json"
rq=urllib.request.Request(URL,headers={"User-Agent":"RetailNav-research/1.0"})
with urllib.request.urlopen(rq,timeout=65) as f: data=json.load(f)
floors=sorted(data["floors"],key=lambda f:f["index"])
transitions=data["floor_transitions"]
W,H=5400,3400
TITLE_BOTTOM=170
names={361:"LOWER LEVEL — PLANTA INFERIOR",362:"UPPER LEVEL — PLANTA SUPERIOR",363:"THIRD LEVEL — TERCERA PLANTA"}
palette={361:"#E8C122",362:"#DA394A",363:"#367CC9"}
def features(dataset):
    if not isinstance(dataset,dict):return []
    contents=dataset.get("data",{})
    if isinstance(contents,str):contents=json.loads(contents)
    return contents.get("features",[]) if isinstance(contents,dict) else []
def polygons(g):
    if not isinstance(g,dict):return []
    t=g.get("type");co=g.get("coordinates",[])
    return [co] if t=="Polygon" else co if t=="MultiPolygon" else []
def positions(feat):
    for poly in polygons(feat.get("geometry",{})):
        for ring in poly:
            for p in ring:
                if len(p)>=2:yield p[:2]
ref_lat=float(np.mean([c["latitude"] for c in transitions]))
ref_lon=float(np.mean([c["longitude"] for c in transitions]))
METERS_LON=111320*math.cos(math.radians(ref_lat));METERS_LAT=111132
def metric(lon,lat):return np.array([(float(lon)-ref_lon)*METERS_LON,(float(lat)-ref_lat)*METERS_LAT])
cloud=[]
for floor in floors:
    for feat in features(floor.get("structures_dataset")):cloud.extend(metric(*p) for p in positions(feat))
    for style in floor["style_dataset"]:
        if style.get("style_id")==633:
            for feat in features(style):cloud.extend(metric(*p) for p in positions(feat))
cloud=np.array(cloud)
vals,vec=np.linalg.eigh(np.cov(cloud.T))
major=vec[:,np.argmax(vals)]
if major[0]<0:major=-major
minor=np.array([-major[1],major[0]])
frame=np.column_stack([major,minor])
rot=cloud@frame
pins=np.array([metric(c["longitude"],c["latitude"]) for c in transitions])@frame
allrot=np.vstack((rot,pins))
xmin,ymin=allrot.min(axis=0);xmax,ymax=allrot.max(axis=0)
mid=(allrot.min(axis=0)+allrot.max(axis=0))/2
scale=min((W-550)/(xmax-xmin),(H-560)/(ymax-ymin))
def xy(lon,lat):
    a,b=metric(lon,lat)@frame
    return W/2+(a-mid[0])*scale,(H+TITLE_BOTTOM-120)/2-(b-mid[1])*scale
def shape(f):
    paths=[]
    for poly in polygons(f.get("geometry")):
        for ring in poly:
            if len(ring)<3:continue
            paths.append("M "+" L ".join(f"{xy(*p)[0]:.2f} {xy(*p)[1]:.2f}" for p in ring)+" Z")
    return " ".join(paths)
def draw(featureset,fill,stroke,width=1.5,alpha=1):
    return "\n".join(f'<path d="{shape(f)}" fill="{fill}" stroke="{stroke}" stroke-width="{width}" opacity="{alpha}" fill-rule="evenodd" stroke-linejoin="round"/>' for f in featureset if polygons(f.get("geometry")))
def header(label,subtitle):
    return f'<rect width="{W}" height="166" fill="white"/><text x="70" y="76" font-family="sans-serif" font-weight="bold" font-size="66" fill="#22364A">{escape(label)}</text><text x="74" y="134" font-family="sans-serif" font-size="33" fill="#516578">{escape(subtitle)}</text>'
def footer():
    return f'<rect x="0" y="{H-115}" width="{W}" height="115" fill="#F7FAFC"/><text x="70" y="{H-52}" font-size="29" font-family="sans-serif" fill="#61768A">Fuente: mapa interactivo oficial Aventura Mall / RoveIQ · Referencia, no plano de obra.</text>'
def opening():return f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><rect width="{W}" height="{H}" fill="#FFFFFF"/>'
def pin(p):
    text=p["name"].lower()
    typ="A" if "elevat" in text else "M" if "escal" in text else "E"
    col="#1361B2" if typ=="A" else "#D26921" if typ=="M" else "#766C81"
    x,y=xy(p["longitude"],p["latitude"])
    return f'<circle cx="{x:.2f}" cy="{y:.2f}" r="27" fill="white" stroke="{col}" stroke-width="6"/><circle cx="{x:.2f}" cy="{y:.2f}" r="21" fill="{col}"/><text x="{x:.2f}" y="{y+9:.2f}" font-family="sans-serif" font-size="25" font-weight="bold" text-anchor="middle" fill="white">{typ}</text><text x="{x+34:.2f}" y="{y-15:.2f}" font-family="sans-serif" font-size="24" font-weight="bold" fill="#203447">{p["id"]}</text>'
created=[]
def save(basename,svg):
    out=OUT/(basename+".svg")
    out.write_text(svg,encoding="utf-8")
    png=OUT/(basename+".png")
    cairosvg.svg2png(bytestring=svg.encode("utf-8"),write_to=str(png))
    created.append({"svg":out.name,"png":png.name,"pixels":[W,H],"bytes":png.stat().st_size})
    print("CREATED",out,png.stat().st_size,flush=True)
def geometry(f):
    items=[]
    for style in f.get("style_dataset",[]):
        if style["style_id"]==633:items.append(draw(features(style),"#F0F7FA","#CEE1ED",2))
    items.append(draw(features(f.get("structures_dataset")),"#D7E4EC","#8FA6B4",2.6))
    for style in f.get("style_dataset",[]):
        id=style["style_id"]
        if id==632:items.append(draw(features(style),"#85939E","#6B7C86",1.4))
        elif id==631:items.append(draw(features(style),"#2F4050","#2F4050",1.4))
        elif id==650:items.append(draw(features(style),"#CEB9E5","#B095D2",1))
        elif id==628:items.append(draw(features(style),"#B5DAC3","#90C7A7",1))
        elif id==1611:items.append(draw(features(style),"#929BA2","#7C868F",1))
        elif id==634:items.append(draw(features(style),"#EFF2F3","#CED5D9",1))
    return "\n".join(items)
report={"source":URL,"floors":[],"connectors":[],"imageFiles":created,
        "coordinateSystem":"shared metric projection with one global PCA angle",
        "metresPerPixel":1/scale,"rotationAxis":major.tolist(),
        "limitations":["Connections are registered point locations, not architectural shaft polygons.",
                       "Escalators can have different entry/exit offsets between floors.",
                       "Map is not a measured architectural blueprint.","Third-party map reuse rights not evaluated."]}
for f in floors:
    fid=f["id"]
    pins=[p for p in transitions if fid in p["floor_ids"]]
    base=opening()+geometry(f)+"\n".join(pin(p) for p in pins)
    base+=header("AVENTURA MALL | "+names.get(fid,str(fid)),f"Plano original vectorizado · Misma escala y orientación en todas las plantas · ID {fid}")
    base+=footer()+"</svg>"
    save(f"aventura-planta-{fid}",base)
    report["floors"].append({"floorId":fid,"name":f["name"],"structures":len(features(f["structures_dataset"])),
                             "verticalConnections":len(pins),"connectorIds":[p["id"] for p in pins]})
    print("FLOOR",fid,"vertices",len(list(features(f["structures_dataset"]))),flush=True)
def overlays(fids,outname,title):
    svg=opening()
    for fid in fids:
        f=next(x for x in floors if x["id"]==fid)
        col=palette[fid]
        allstruct=features(f["structures_dataset"])
        floor=[z for style in f["style_dataset"] if style["style_id"]==633 for z in features(style)]
        svg+=draw(floor,col,col,5.5,.26)
        svg+=draw(allstruct,"none",col,4,.79)
    shared=[p for p in transitions if len(set(fids)&set(p["floor_ids"]))>=2]
    for p in shared:
        x,y=xy(p["longitude"],p["latitude"])
        svg+=f'<circle cx="{x:.2f}" cy="{y:.2f}" r="19" stroke="#203245" stroke-width="5" fill="white"/><circle cx="{x:.2f}" cy="{y:.2f}" r="7" fill="#203245"/><text x="{x+30:.2f}" y="{y-9:.2f}" font-size="24" font-family="sans-serif" fill="#203245">{p["id"]}</text>'
    subtitle=" · ".join(f"{names[fid]} ({fid})" for fid in fids)
    svg+=header(title,subtitle)+footer()+"</svg>"
    save(outname,svg)
    return [{"id":p["id"],"name":p["name"],"floor_ids":p["floor_ids"]} for p in shared]
report["comparisons"]={
 "lowerUpper":overlays([361,362],"aventura-superposicion-ll-ul","ALINEACIÓN | AMARILLO + ROJO"),
 "upperThird":overlays([362,363],"aventura-superposicion-ul-l3","ALINEACIÓN | ROJO + AZUL"),
 "all":overlays([361,362,363],"aventura-superposicion-tres-plantas","ALINEACIÓN | TRES PLANTAS")
}
report["connectors"]=[{"id":p["id"],"type":p["name"],"lat":p["latitude"],"lon":p["longitude"],"floor_ids":p["floor_ids"],"pixel":list(xy(p["longitude"],p["latitude"]))} for p in transitions]
(OUT/"map-alignment-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
(OUT/"README-vectores.md").write_text("# Aventura Mall — planos georreferenciados\n\nFuente: "+URL+"\n\nLas imágenes PNG y SVG tienen escala, orientación y centro compartidos, tomando polígonos GeoJSON de la fuente oficial.\n\nLos puntos numerados representan conexiones oficiales comunes entre plantas, no una medición arquitectónica del hueco de ascensor. No deben deformarse los planos para hacerlos coincidir.\n")
print("RESULT",json.dumps({"images":len(created),"connections":len(transitions),"floors":report["floors"]}))
