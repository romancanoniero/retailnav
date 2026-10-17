"""Attach codes read from a mall's floor guide to provisional polygons.

A code is linked to geometry only when its text position is contained in exactly
one polygon. Ambiguous labels are preserved for search without fictitious tenancy.
"""
import csv
from pathlib import Path

def inside(point, feature):
    x = y = 0
    points = []
    for dx, dy in zip(feature[3][::2], feature[3][1::2]):
        x += dx
        y += dy
        points.append((x / 2, y / 2))
    px, py = point
    flag = False
    for i, a in enumerate(points):
        b = points[(i + 1) % len(points)]
        if (a[1] > py) != (b[1] > py):
            if px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0]:
                flag = not flag
    return flag

def candidate_front(feature, point, manual=None):
    """Select an existing exterior wall segment, NEVER an arbitrary screen badge.

    With a surveyed/manual facade supplied, use the explicit endpoints. Without
    a verified corridor map, the nearest polygon boundary is only a *candidate*
    front and must remain labelled estimated, not surveyed.
    """
    if manual is not None:
        values = [manual.get(k) for k in ("front_ax", "front_ay", "front_bx", "front_by")]
        if all(v is not None and str(v).strip() for v in values):
            try:
                ax, ay, bx, by = map(float, values)
                if 3 <= ((ax-bx)**2+(ay-by)**2)**.5 <= 160:
                    return {"a": [ax, ay], "b": [bx, by],
                            "status": "reviewed-manual",
                            "normal": None}
            except (ValueError, TypeError):
                pass
    x = y = 0
    points = []
    for dx, dy in zip(feature[3][::2], feature[3][1::2]):
        x += dx
        y += dy
        points.append((x / 2, y / 2))
    if len(points) < 3:
        return None
    rings = feature[4] or [list(range(len(points)))]
    largest = max(rings, key=len)
    boundary = [points[i] for i in largest if 0 <= i < len(points)]
    if len(boundary) < 3:
        return None
    area = sum(a[0]*b[1]-b[0]*a[1]
               for a, b in zip(boundary, boundary[1:]+boundary[:1]))
    options = []
    for a, b in zip(boundary, boundary[1:]+boundary[:1]):
        dx, dy = b[0]-a[0], b[1]-a[1]
        length = (dx*dx+dy*dy)**.5
        if length < 3.8: continue
        t = max(0, min(1, ((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(length**2)))
        cx,cy = a[0]+t*dx,a[1]+t*dy
        distance = ((cx-point[0])**2+(cy-point[1])**2)**.5
        options.append((distance-0.07*min(35, length),length,t,a,b))
    if not options: return None
    _,length,t,a,b = min(options,key=lambda z:z[0])
    # A wide fused polygon can produce a long perimeter. Bound this sign to
    # an individual section near the printed code (max 22 photo pixels).
    span=min(22.,length*.84)
    mid=max(span/(2*length),min(1-span/(2*length),t))
    def at(v):
        return [round(a[k]+(b[k]-a[k])*v,2) for k in (0,1)]
    first=at(mid-span/(2*length))
    last=at(mid+span/(2*length))
    nx, ny=(b[1]-a[1])/length,-(b[0]-a[0])/length
    midpoint=((first[0]+last[0])/2,(first[1]+last[1])/2)
    centre=feature[6]
    if nx*(midpoint[0]-centre[0])+ny*(midpoint[1]-centre[1]) < 0:
        nx,ny=-nx,-ny
    return {"a":first,"b":last,"normal":[round(nx,5),round(ny,5)],
            "status":"estimated-boundary"}

def _explicit_front(row):
    try:
        ax,ay,bx,by=(float(row[k]) for k in
                     ("front_ax","front_ay","front_bx","front_by"))
    except (ValueError, TypeError, KeyError):
        return None
    if not 3 <= ((ax-bx)**2+(ay-by)**2)**.5 <= 160:
        return None
    return {"a":[ax,ay],"b":[bx,by],
            "normal":None,"status":"manual-unverified"}


def attach(folder, level, geometry):
    file = Path(folder) / (level + "-unit-codes.csv")
    if not file.exists():
        return []
    labels = []
    owners = {}
    manual_by_code = {}
    with file.open(encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            code = row["code"].strip()
            source_record_id = row.get("sourceRecordId", "").strip()
            # Directory-only brand names have NO defensible floor coordinates.
            # Keep them searchable without silently placing every shop at 0,0.
            try:
                x_str,y_str=row.get("x","").strip(),row.get("y","").strip()
                at=(float(x_str),float(y_str)) if x_str and y_str else None
            except (ValueError, TypeError):
                at=None
            # Floor slabs, corridors and amenity zones are not shop tenancy
            # polygons. Only anchors/units may receive a provisional code link.
            matches = [f[0] for f in geometry if f[1] in (0, 1) and inside(at, f)] if at else []
            explicit = row.get("polygonId", "").strip()
            explicit_status = row.get("polygonMatchStatus", "").strip()
            reviewed_binding = "polygonId" in row and "polygonMatchStatus" in row
            eligible = {f[0] for f in geometry if f[1] in (0, 1)}
            if explicit:
                if explicit not in eligible or explicit_status not in (
                        "official-marker-inside-svg-region-provisional",):
                    raise ValueError(f"{level}: invalid source SVG polygon binding {explicit}")
                polygon_id = explicit
            elif reviewed_binding:
                polygon_id = None
            else:
                polygon_id = matches[0] if len(matches) == 1 else None
            relation = (explicit_status if polygon_id and explicit_status else
                        "inside-one-colour-cluster" if polygon_id else
                        "unplaced-directory" if not at else "pending")
            label = {"code": code, "name": row.get("name", "").strip(),
                "sourceRecordId": source_record_id or None,
                "codeKind": row.get("codeKind", "").strip() or
                    ("official-local-code" if code else "missing-in-source"),
                "floor": level, "x": at[0] if at else None,
                "y": at[1] if at else None,
                "polygonId": polygon_id,
                "source": row.get("source", "unknown"),
                "positionStatus": row.get("positionStatus", "").strip() or
                     ("photo-approximation" if at else "directory-only"),
                "nameStatus": row.get("nameStatus", "").strip(),
                "category": row.get("category", "").strip(),
                "tags": row.get("tags", "").strip(),
                "aliases": row.get("aliases", "").strip(),
                "enrichmentURL": row.get("enrichmentURL", "").strip(),
                "polygonMatchStatus": explicit_status or None,
                "polygonDistanceSvgPx": (float(row["polygonDistanceSvgPx"])
                                          if row.get("polygonDistanceSvgPx", "").strip() else None),
                "relation": relation}
            manual_by_code[code] = row
            labels.append(label)
            if polygon_id:
                owners.setdefault(polygon_id, []).append(label)
    polygons = {f[0]: f for f in geometry}
    for label in labels:
        polygon_id = label["polygonId"]
        manual = manual_by_code.get(label["code"])
        if manual and all(str(manual.get(k,"")).strip() for k in ("front_ax","front_ay","front_bx","front_by")):
            # Front geometry may be manually established, but it does not imply
            # that the *roof polygon* is uniquely identified. Do not skip the
            # independent roof qualification below.
            front = candidate_front(polygons[polygon_id],(label["x"],label["y"]),manual) if polygon_id else _explicit_front(manual)
            if front:
                label["facade"]=front
                label["frontStatus"]=front["status"]
        if not polygon_id:
            label["frontStatus"] = "unmatched-region"
            label["roofStatus"] = "unmatched-region"
            continue
        # A fused zone with multiple IDs has no provable per-shop storefront.
        if len(owners[polygon_id]) != 1:
            label["frontStatus"] = "mixed-polygon-requires-splitting"
            label["roofStatus"] = "mixed-polygon-requires-splitting"
            continue
        # Only a single identified store with a uniquely matching polygon is
        # allowed to own the *roof* label. Do not assign a fused roof to two stores.
        feature = polygons[polygon_id]
        ring = max(feature[4], key=len) if feature[4] else []
        points=[]
        x=y=0
        for dx,dy in zip(feature[3][::2],feature[3][1::2]):
            x+=dx;y+=dy;points.append((x/2,y/2))
        edges=[(points[ring[i]],points[ring[(i+1)%len(ring)]])
               for i in range(len(ring))] if len(ring)>=3 else []
        if edges:
            best=max(edges,key=lambda pair:(pair[1][0]-pair[0][0])**2+
                                    (pair[1][1]-pair[0][1])**2)
            vx,vy=best[1][0]-best[0][0],best[1][1]-best[0][1]
            length=(vx*vx+vy*vy)**.5
            label["roof"]={"x":label["x"],"y":label["y"],
                           "axis":[round(vx/length,5),round(vy/length,5)],
                           "widthPixels":round(max(4.,min(length*.48,18.)),2),
                           "status":"estimated-plan-polygon"}
            label["roofStatus"]="estimated-plan-polygon"
        front = candidate_front(polygons[polygon_id],(label["x"],label["y"]))
        if front:
            label["facade"] = front
            label["frontStatus"] = front["status"]
    for feature in geometry:
        matches = owners.get(feature[0], [])
        if len(matches) == 1 and not feature[2]:
            feature[2] = matches[0]["name"] or matches[0]["code"]
    return labels
