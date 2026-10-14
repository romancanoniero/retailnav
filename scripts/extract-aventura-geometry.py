#!/usr/bin/env python3
"""Project the public RoveIQ venue-107 GLB geometry into aligned 2D references.

This tool does NOT treat screen pixels or store labels as measured shaft coordinates.
It does not publish the raw third-party models. It preserves the common geometry
coordinate frame and reports uncertainty if source transforms are ambiguous.
"""
from __future__ import annotations
import json, re, io, collections
from pathlib import Path
import urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import trimesh
import cv2

ROOT=Path("research-output/aventura")
ROOT.mkdir(parents=True,exist_ok=True)
VENUE="https://s3.us-east-2.amazonaws.com/settings.roveiq.com/venue-107/"
MODELS=[
 "https://cdn.roveiq.com/489a2da7-7388-4fbd-98ff-7af38fe51a2f.glb",
 "https://cdn.roveiq.com/ceb7287a-2cf4-41bf-807f-4eb159f25464.glb",
 "https://cdn.roveiq.com/e7607a1c-fa7f-4ece-ad4e-2a8ce815b11b.glb"
]
# Do not infer GLB-to-floor association solely from discovery order.
FLOORS=[{"id":361,"name":"Lower Level"},{"id":362,"name":"Upper Level"},{"id":363,"name":"Third Level"}]
MAX_TRIANGLES=800000
def grab(url):
    req=urllib.request.Request(url,headers={"User-Agent":"RetailNav-research/1.0 (reference screenshot)"})
    with urllib.request.urlopen(req,timeout=50) as r:return r.read()
def nested_paths(obj,path="",limit=180):
    result=[]
    if isinstance(obj,dict):
        for k,v in obj.items():
            p=f"{path}.{k}" if path else k
            if isinstance(v,str) and (".glb" in v.lower() or any(w in k.lower() for w in ["model","floor","scale","offset","rotation","transform"])):
                result.append([p,v[:230]])
            if isinstance(v,(dict,list)) and len(result)<limit:
                result+=nested_paths(v,p,limit-len(result))
    elif isinstance(obj,list):
        for i,v in enumerate(obj[:65]):
            if isinstance(v,(dict,list)) and len(result)<limit:result+=nested_paths(v,f"{path}[{i}]",limit-len(result))
    return result[:limit]
def connectors(obj,path="",found=None,depth=0):
    if found is None:found=[]
    if depth>20 or len(found)>500:return found
    if isinstance(obj,dict):
        name=" | ".join(str(v) for k,v in obj.items() if isinstance(v,(str,int,float)) and re.search("name|type|category|amenity|label|description",k,re.I))
        if re.search(r"elevat|escalat|lift|stairs|staircase|ascensor|escalera",name,re.I):
            excerpt={k:v for k,v in obj.items() if isinstance(v,(str,int,float,bool)) or (isinstance(v,(dict,list)) and re.search("coord|pos|floor|level|lat|lon|geometry|location|point",k,re.I))}
            found.append({"path":path,"fields":excerpt})
        for k,v in obj.items():
            if isinstance(v,(dict,list)):connectors(v,f"{path}.{k}",found,depth+1)
    elif isinstance(obj,list):
        for i,v in enumerate(obj):
            if isinstance(v,(dict,list)):connectors(v,f"{path}[{i}]",found,depth+1)
    return found
source={}
for f in ["map.json","venue.json","locations.json"]:
    try:
        raw=grab(VENUE+f)
        data=json.loads(raw)
        source[f]=data
        print("SOURCE",f,len(raw),"type",type(data).__name__,"keys",list(data.keys())[:32] if isinstance(data,dict) else "list")
    except Exception as e:print("SOURCE ERROR",f,str(e))
vertical=connectors(source.get("locations.json",{}))+connectors(source.get("map.json",{}))+connectors(source.get("venue.json",{}))
(ROOT/"vertical-connector-candidates.json").write_text(json.dumps(vertical,ensure_ascii=False,indent=2,default=str))
(ROOT/"source-structure.json").write_text(json.dumps({
 "metadata":{name:{"keys":list(v.keys()) if isinstance(v,dict) else [],"type":type(v).__name__,
                  "floorModelPaths":nested_paths(v)} for name,v in source.items()},
 "modelUrls":MODELS,"floorList":FLOORS,"verticalCandidateCount":len(vertical)
},ensure_ascii=False,indent=2))
meshes=[]
for i,u in enumerate(MODELS):
    try:
        data=grab(u)
        print("MODEL",i,"SIZE",len(data),"bytes")
        scene=trimesh.load(io.BytesIO(data),file_type="glb",force="scene",process=False)
        geo=scene.dump(concatenate=True)
        if not isinstance(geo,trimesh.Trimesh):raise RuntimeError("No triangle mesh in model")
        # Retain world transforms from GLB scene.
        stats={"url":u,"bytes":len(data),"vertices":len(geo.vertices),"triangles":len(geo.faces),"bounds":geo.bounds.round(5).tolist(),
               "dimension":(geo.bounds[1]-geo.bounds[0]).round(5).tolist(),"sceneGeometryCount":len(scene.geometry)}
        print("MESH",json.dumps(stats))
        meshes.append({"index":i,"url":u,"mesh":geo,"stats":stats})
    except Exception as e:
        print("MODEL ERROR",i,repr(e))
        meshes.append({"index":i,"url":u,"mesh":None,"error":repr(e)})
report={"source":"RoveIQ Aventura Mall venue 107 GLB","capturedFrom":"publicly loaded RoveIQ scene URLs",
        "floorNames":FLOORS,"modelToFloorAssociation":"pending metadata validation","models":[m.get("stats",{"url":m["url"],"error":m.get("error")}) for m in meshes],
        "manualVerificationRequired":["GLB floor ID matching","spatial shaft correspondences","3D model licenses"],"candidateVerticalCount":len(vertical)}
available=[m for m in meshes if m["mesh"] is not None]
if not available:
    (ROOT/"geometry-report.json").write_text(json.dumps(report,indent=2))
    raise SystemExit("No GLB sources loaded")
# Choose shared horizontal axes from total aggregate footprint (largest 2 axes).
dims=np.array([m["mesh"].bounds[1]-m["mesh"].bounds[0] for m in available])
total_extent=np.max(np.array([m["mesh"].bounds[1] for m in available]),axis=0)-np.min(np.array([m["mesh"].bounds[0] for m in available]),axis=0)
vertical_axis=int(np.argmin(total_extent))
horizontal=tuple(i for i in range(3) if i!=vertical_axis)
minh=np.min([m["mesh"].bounds[0,list(horizontal)] for m in available],axis=0)
maxh=np.max([m["mesh"].bounds[1,list(horizontal)] for m in available],axis=0)
extent=np.maximum(maxh-minh,0.001)
print("GLOBAL AXES",horizontal,"vertical",vertical_axis,"mins",minh,"maxs",maxh)
W,H=4096,2600
PADDING=200
scale=min((W-PADDING*2)/extent[0],(H-PADDING*2)/extent[1])
xs=PADDING+(np.arange(1)*0)
def orient(xy):
    # Correct the vertical canvas direction consistently for all floors.
    return np.column_stack([PADDING+(xy[:,0]-minh[0])*scale, H-PADDING-(xy[:,1]-minh[1])*scale])
try:
 font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",46)
 small=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",23)
except Exception:font=ImageFont.load_default();small=font
def render(m):
    mesh=m["mesh"]
    image=np.full((H,W,3),255,np.uint8)
    faces=np.asarray(mesh.faces)
    verts=np.asarray(mesh.vertices)
    normal=np.asarray(mesh.face_normals)[:,vertical_axis]
    chosen=np.where((np.abs(normal)>0.35))[0]
    if len(chosen)>MAX_TRIANGLES:
        chosen=chosen[np.linspace(0,len(chosen)-1,MAX_TRIANGLES).astype(int)]
    centers=verts[faces[chosen]].mean(axis=1)[:,vertical_axis]
    # Painter: top-most triangles come later (assuming vertical grows upwards).
    ordered=chosen[np.argsort(centers)]
    fc=mesh.visual.to_color().face_colors
    color_count=len(fc)
    for j in ordered:
        tri=verts[faces[j]][:,list(horizontal)]
        pixels=orient(tri)
        if np.max(np.ptp(pixels,axis=0))<0.6:continue
        pixels=np.clip(np.round(pixels),-32700,32700).astype("int32")
        raw=fc[j] if j<color_count else [210,219,226,255]
        rgb=tuple(int(k) for k in raw[:3])
        # Very dark roofs remain readable against a white background.
        if np.mean(rgb)<40:rgb=(85,94,101)
        cv2.fillConvexPoly(image,pixels,rgb,lineType=cv2.LINE_AA)
    # Header annotations are drawn outside geometry content region.
    img=Image.fromarray(image)
    pen=ImageDraw.Draw(img)
    pen.rectangle((0,0,W,125),fill=(250,252,253))
    pen.text((40,17),f"Aventura Mall — modelo GLB {m['index']+1}",font=font,fill=(26,43,58))
    pen.text((43,82),"Proyección cenital, escala y origen compartidos | planta por confirmar",font=small,fill=(80,92,103))
    out=ROOT/f"glb-modelo-{m['index']+1}.png"
    img.save(out,optimize=True)
    print("RENDERED",out,out.stat().st_size,"faces",len(chosen))
    return out
rendered=[]
for m in available:
    try:rendered.append(render(m))
    except Exception as e:print("RENDER ERROR",m["index"],repr(e));report.setdefault("renderErrors",[]).append(str(e))
report.update({"horizontalAxes":horizontal,"verticalAxis":vertical_axis,"globalBounds":[minh.tolist(),maxh.tolist()],"imageSize":[W,H],"scale":scale,"images":[str(x.name) for x in rendered]})
# Align by shared GLB coordinates, no per-level independent re-fit.
for a,b in zip(rendered,rendered[1:]):
    I=np.array(Image.open(a).convert("RGB"))
    J=np.array(Image.open(b).convert("RGB"))
    c1=cv2.Canny(cv2.GaussianBlur(cv2.cvtColor(I,cv2.COLOR_RGB2GRAY),(5,5),0),60,130)>0
    c2=cv2.Canny(cv2.GaussianBlur(cv2.cvtColor(J,cv2.COLOR_RGB2GRAY),(5,5),0),60,130)>0
    output=np.full((H,W,3),255,np.uint8)
    output[c1]=(255,214,0)
    output[c2]=(217,40,56)
    out=ROOT/f"glb-comparacion-{a.stem.split('-')[-1]}-{b.stem.split('-')[-1]}.png"
    Image.fromarray(output).save(out,optimize=True)
    print("COMPARE",out)
(ROOT/"geometry-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2,default=str))
print("FINISHED",json.dumps(report,ensure_ascii=False)[:2000])
