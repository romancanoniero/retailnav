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
outputs=[]
for idx,f in enumerate(floors):
    name=f["name"];out=names[name]
    els=[head("Aventura Mall - "+name,f"Planta {idx+1} de 3  |  Plano original vectorial  |  Norte arriba",colors[name]),
      paths(styles(f,"style floors"),"none","#F4F6F8",0),
      paths(byfloor[f["id"]],"#708193","#E8EDF2",2.5),
      paths(styles(f,"grass"),"none","#D7E6D7",0),
      paths(styles(f,"purple"),"#7D71A7","#D6D0E9",1.7),
      paths(styles(f,"walls"),"#435465","#495B6C",1.1,.85),
      north(),legend(f),marks(f),
      text(240,7300,f"RoveIQ | {len(byfloor[f['id']])} locales | {sum(f['id'] in t['floor_ids'] for t in transitions)} conexiones verticales | Escala y origen comunes",29,"#738394")]
    outputs.append({"floor_id":f["id"],"floor":name,**save(out,"\n".join(els))})
for basename,levels in [("aventura-superposicion-ll-ul",floors[:2]),
                        ("aventura-superposicion-tres-plantas",floors)]:
    desc="Amarillo: Lower | Rojo: Upper"+(" | Azul: Third" if len(levels)>2 else "")
    els=[head("Aventura Mall - Superposicion",desc,"#35495E")]
    for f in levels:els.append(paths(byfloor[f["id"]],colors[f["name"]],"none",4.5,.89))
    els.extend([north(),legend(),marks(),
        text(235,7285,"Trazos y marcadores usan las MISMAS coordenadas geograficas para todas las plantas.",30,"#6E7E8E")])
    outputs.append(save(basename,"\n".join(els)))
with (OUT/"aventura-anclajes.csv").open("w",newline="",encoding="utf-8") as file:
    w=csv.writer(file);w.writerow(["id","tipo","latitud","longitud","plantas","px","py"])
    for t in transitions:
        x,y=xy(float(t["longitude"]),float(t["latitude"]))
        w.writerow([t["id"],ty(t)[0],t["latitude"],t["longitude"],tf(t["floor_ids"]),round(x,2),round(y,2)])
report={"source":URL,"originalFloorIDs":[(f["id"],f["name"]) for f in floors],
    "verticalTransitions":len(transitions),"scalePixelPerMeter":scale,
    "resolution":[W,H],"coordinateSystem":"lon/lat -> common local projected plane, north up",
    "outputs":outputs,"caveat":"Research reference, based on RoveIQ GeoJSON; shaft alignment not independently surveyed"}
(OUT/"vector-floor-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
(OUT/"PLANOS-AVENTURA-LEEME.md").write_text(
    "# Aventura Mall - 3 plantas\n\nFuente: https://aventuramall.com/aventura-mall-map/\n\n"
    "Tres planos de 6200x7400 px PNG + SVG vectorial. Todos utilizan exactamente la misma escala y sistema de coordenadas.\n\n"
    "Los IDs de ascensores y escaleras mecanicas son los de floor_transitions del mapa RoveIQ y permiten comprobar conexiones entre niveles.\n\n"
    "En aventura-superposicion-ll-ul.png el Lower Level aparece en amarillo y Upper Level en rojo: el rojo tapa al amarillo sobre coincidencias exactas de contorno.\n"
    "La version de tres plantas agrega azul para Third Level.\n\n"
    "Material cartografico de referencia, no planos arquitectonicos certificados. Verificar permisos para redistribucion comercial.\n")
print("COMPLETE",json.dumps({"outputs":len(outputs),"anchors":len(transitions),"scale":scale}),flush=True)
