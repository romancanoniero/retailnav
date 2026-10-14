from pathlib import Path
import json,urllib.request,collections
root=Path("research-output/aventura")
root.mkdir(parents=True,exist_ok=True)
api="https://s3.us-east-2.amazonaws.com/settings.roveiq.com/venue-107/"
def req(name):
    r=urllib.request.Request(api+name,headers={"User-Agent":"RetailNav-research/1.0"})
    with urllib.request.urlopen(r,timeout=40) as o:return json.load(o)
def safe(obj,depth=3,length=260):
    if depth<1:return "<nested>" if isinstance(obj,(list,dict)) else obj
    if isinstance(obj,list):
        return {"count":len(obj),"items":[safe(v,depth-1,length) for v in obj[:3]]}
    if isinstance(obj,dict):
        return {k:safe(v,depth-1,length) for k,v in list(obj.items())[:55]}
    if isinstance(obj,str) and len(obj)>length:return obj[:length]+"..."
    return obj
doc=req("map.json")
venue=req("venue.json")
structure={}
for key,v in doc.items():
    structure[key]={"type":type(v).__name__,"sample":safe(v,4)}
    if isinstance(v,list):
        structure[key]["count"]=len(v)
        structure[key]["id_samples"]=[{k:x.get(k) for k in ["id","name","floor_id","geometry","location_id","level","type","settings","properties"] if k in x} for x in v[:4] if isinstance(x,dict)]
        floors=collections.Counter(str(x.get("floor_id",x.get("floorId",x.get("floor")))) for x in v if isinstance(x,dict))
        structure[key]["floor_id_histogram"]=dict(floors)
extra={"venueMapSettings":safe(venue.get("venue",{}).get("settings",{}).get("mapboxSettings",{}),5),"firstVerticalTransitions":safe(doc.get("floor_transitions",[]),5),
       "firstSuites":safe(doc.get("map_suites",[]),5),"firstMapBackground":safe(doc.get("map_backgrounds",[]),5)}
for i,fl in enumerate(doc.get("floors",[])):
    print("floor",i,[(k,type(v).__name__) for k,v in fl.items()])
    if "routing_dataset" in fl:
        extra[f"floor{i}routingDataset"]=safe(fl["routing_dataset"],6)
        extra[f"floor{i}routingFeatureCount"]=len(fl.get("routing_dataset",{}).get("data",{}).get("features",[]))
data={"structure":structure,"extra":extra}
out=root/"map-json-inspection.json"
out.write_text(json.dumps(data,ensure_ascii=False,indent=2,default=str))
print("INSPECTED",out,len(json.dumps(data)),"keys",[k+" ("+str(v.get("count",""))+")" for k,v in structure.items()])
