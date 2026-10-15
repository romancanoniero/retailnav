"""Resolve a provisional visitor reference only from ORIGINAL recorded map points.

Never fabricate an entrance coordinate or call an emergency exit an entrance.
For maps with no entrance recorded, a provisional floor is still defined, but
the location dot cannot be placed until a map operator marks a real entrance
or the visitor explicitly chooses their point in the indoor-positioning panel.
"""
def attach_visitor_reference(mall):
    floors=mall.get("floorLabels") or [f[0] for f in mall.get("floors",[])]
    if not floors:
        raise ValueError(mall["id"]+": no digitized floors")
    ground=next((x for x in ("PB","G","GF","P0","L1","1","LL") if x in floors),floors[0])
    candidates=[]
    for p in mall.get("pois", []):
        # Exit signs marked in photos are eligible as *access references*,
        # but only if NOT restricted/emergency, and NEVER as a verified entry.
        if p.get("floor")!=ground:continue
        kind=p.get("category")
        name=p.get("name","").lower()
        if "emergencia" in name or "emergency" in name or "紧急" in name:continue
        if kind not in ("entrance","entry","exit") or p.get("confidence") not in ("cartel","reviewed"):continue
        if not isinstance(p.get("x"),(float,int)) or not isinstance(p.get("y"),(float,int)):continue
        candidates.append({
          "id":p["id"],"name":p.get("name","Acceso indicado en el plano"),
          "floor":ground,"x":p["x"],"y":p["y"],
          "evidence":"photo-exit-sign-not-verified-entrance" if kind=="exit" else "reviewed-entrance",
          "entryVerified":kind!="exit" and p.get("confidence")=="reviewed"
        })
    # Operators can register a surveyed mall entrance under source data;
    # do not infer coordinates from geometric bounding boxes or from GNSS.
    extra=mall.get("recognizedEntrances",[])
    for e in extra:
        if e.get("floor") != ground or e.get("status")!="reviewed" or not e.get("source"):
            raise ValueError(mall["id"]+": entrance record lacks source and review")
        if not all(isinstance(e.get(k),(int,float)) for k in ("x","y")):
            raise ValueError(mall["id"]+": invalid entrance map coordinates")
        candidates.insert(0,{"id":e["id"],"name":e["name"],"floor":ground,
          "x":e["x"],"y":e["y"],"evidence":"reviewed-mall-entrance","entryVerified":True})
    mall["defaultVisitorReference"]={
      "floor":ground,
      "floorStatus":"first-or-ground-digitized-provisional-not-user-location",
      "entry":candidates[0] if candidates else None,
      "entryStatus":"candidate-map-access" if candidates else "not-recorded-do-not-invent"
    }
    return mall["defaultVisitorReference"]
