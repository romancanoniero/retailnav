#!/usr/bin/env python3
"""Inspect commercial labels in the publicly served RoveIQ venue-107 map data."""
from pathlib import Path
import json,urllib.request,collections
out=Path("research-output/aventura")
out.mkdir(parents=True,exist_ok=True)
root="https://s3.us-east-2.amazonaws.com/settings.roveiq.com/venue-107/"
def get(name):
    req=urllib.request.Request(root+name,headers={"User-Agent":"RetailNav-research/1.0"})
    with urllib.request.urlopen(req,timeout=65) as r: return json.load(r)
data=get("map.json"); ls=get("locations.json");venue=get("venue.json")
locations=ls.get("locations",ls if isinstance(ls,list) else [])
def summarize(v,depth=2):
    if depth<=0:
        if isinstance(v,list):return {"type":"list","length":len(v)}
        if isinstance(v,dict):return {"type":"dict","keys":list(v)[:30]}
        return (v[:250] if isinstance(v,str) else v)
    if isinstance(v,dict):return {k:summarize(val,depth-1) for k,val in list(v.items())[:45]}
    if isinstance(v,list):return [summarize(a,depth-1) for a in v[:4]]
    return v[:250] if isinstance(v,str) else v
def feats(ds):
    j=ds.get("data") or {}
    if isinstance(j,str):j=json.loads(j)
    return j.get("features",[])
def mid(f):
    p=f.get("properties",{})
    return str(p.get("loc_id") or p.get("location_id") or "")
index={str(l.get("id")):l for l in locations if isinstance(l,dict)}
linked=collections.Counter(mid(f) for fl in data["floors"] for f in feats(fl["structures_dataset"]))
counter=collections.Counter()
summary=[]
for fl in data["floors"]:
    fs=feats(fl["structures_dataset"])
    ids=[mid(f) for f in fs]
    resolved=[index[i] for i in ids if i in index]
    bycats=collections.Counter(tuple((v.get("location_types")or[{}])[0].get("name","") for v in resolved))
    summary.append({
        "floor":fl["name"],"floorId":fl["id"],"features":len(fs),"linkedToLocationId":len(resolved),
        "noLocId":sum(not x for x in ids),"notMatchingLocation":sum(bool(x) and x not in index for x in ids),
        "nonemptyIdsSample":[x for x in ids if x][:18],
        "locationNamesSample":[{"id":z.get("id"),"name":z.get("name"),"address1":z.get("address1"),"types":[v.get("name") for v in z.get("location_types",[])],"keys":list(z.keys())} for z in resolved[:20]],
        "locationsWithCoordinatesSample":[summarize(z,1) for z in resolved[:2]],
    })
distinct=collections.Counter()
for l in locations:
    for tp in l.get("location_types",[]):distinct[tp.get("name","")]+=1
landmarknames=("Macy","Bloomingdale","Apple","Zara","H&M","Nike","Nordstrom","Food","Starbucks","Sephora","Chanel","Cartier")
special=[{"id":l.get("id"),"name":l.get("name"),"address1":l.get("address1"),"settings":summarize(l.get("settings"),3),"types":[v.get("name") for v in l.get("location_types",[])]} for l in locations if any(s.casefold() in (l.get("name")or"").casefold() for s in landmarknames)]
report={
 "locationsTotal":len(locations),
 "locationFirstRecords":[summarize(l,3) for l in locations[:4]],
 "locationKeys":dict(collections.Counter(k for l in locations for k in l)),
 "locationTypes":dict(distinct),
 "linkedPolygonIds":sum(v for k,v in linked.items() if k),
 "linkedDistinctIds":len([k for k in linked if k]),
 "geoFloorMatches":summary,
 "brandExamples":special[:40],
 "mapSuitesSample":[summarize(s,2) for s in data.get("map_suites",[])[:3]],
 "venueAmenitiesSample":[summarize(a,2) for a in venue.get("amenities",[])[:3]]
}
(out/"label-source-analysis.json").write_text(json.dumps(report,indent=2,ensure_ascii=False,default=str))
print("FINISHED",json.dumps({"locations":len(locations),"counts":summary[0]["linkedToLocationId"],"floors":[{"id":s["floorId"],"found":s["linkedToLocationId"],"unmatched":s["notMatchingLocation"]} for s in summary],"brandExamples":len(special)},ensure_ascii=False),flush=True)
