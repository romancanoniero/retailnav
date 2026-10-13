#!/usr/bin/env python3
"""Validate checked-in RetailNav map data and its generated 3D artifacts."""
import json
import re
import struct
import sys
from pathlib import Path

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("public")
assert root.is_dir()
html = (root / "index.html").read_text(encoding="utf-8")
assert "<canvas" in html and "RetailNav" in html and "modelData" in html
script = re.search(r'<script id="modelData" type="application/json">([\s\S]+?)</script>', html)
assert script, "Standalone HTML missing embedded 3-floor data"
inline = json.loads(script.group(1))
assert [f[0] for f in inline] == ["LL", "UL", "L3"]

catalog_match = re.search(r'<script id="mallCatalog" type="application/json">([\s\S]+?)</script>', html)
assert catalog_match, "Standalone HTML must embed mall selector data"
catalog = json.loads(catalog_match.group(1))
assert {"aventura", "ap-plaza"}.issubset(catalog)
assert len(catalog["aventura"]["floors"]) == 3
ap = catalog["ap-plaza"]
assert ap["id"] == "ap-plaza" and ap["navigable"] is False
assert "id=\"floorPicker\"" in html and "id=\"floorSpacing\"" in html
assert "id=\"floorSelect\"" in html and "id=\"compareDialog\"" in html
assert "id=\"showReference\"" in html and "id=\"showVectors\"" in html
assert "id=\"overlayOpacity\"" in html and "id=\"compareZoom\"" in html
assert "RetailNavComparison" in html
reference=ap["floorReferences"]["B1"]
assert reference["imageSize"]==[1440,620]
assert reference["qa"]["status"]=="pending"
assert reference["qa"]["geometrySha256"] is None
assert not any(reference["qa"]["checks"].values())
assert reference["quality"] in {"full-resolution","compressed-preview"}
assert reference["url"].startswith("reference/ap-plaza/")
asset=root/reference["url"]
assert asset.is_file() and asset.stat().st_size>1200
import hashlib
assert hashlib.sha256(asset.read_bytes()).hexdigest()==reference["sha256"]

assert len(ap["floors"]) == 1 and ap["floors"][0][0] == "B1"
ap_geometry = ap["floors"][0][3]
assert len(ap_geometry) >= 40
assert len(ap_geometry) == 190, "Detailed map should retain 190 separated colour components"
units = ap["units"]
assert len(units) >= 80, "Read all legible printed store identifiers as indexed labels"
assert {"A-01", "A-12", "K1-31", "K2-19"}.issubset({u["code"] for u in units})
assert {"KFC", "Starbucks", "7-Eleven"}.issubset({u["name"] for u in units})
assert len({u["code"] for u in units}) == len(units)
assert 0 < sum(bool(u["polygonId"]) for u in units) < len(units), "Retain unmatched provisional code labels"
districts = ap.get("districts", [])
assert len(districts) == 8, "Printed major shopping-zone titles must remain in the map"
district_names = {d["name"] for d in districts}
assert {
    "ACG Zone", "Optical City", "Jewelry Street", "Gift Zone",
    "Electronic Digital City", "Food Zone", "Old Shanghai Tailor Street",
    "Astro Xplore"
}.issubset(district_names)
assert len({d["id"] for d in districts}) == len(districts)
for d in districts:
    assert d["floor"] == "B1" and d["source"] == "printed-map-label"
    assert 0 <= d["x"] <= 1440 and 0 <= d["y"] <= 620
    assert d["widthPx"] >= 50 and d["heightPx"] >= 20
assert "RetailNavDistricts" in html
assert len({p[0] for p in ap_geometry}) == len(ap_geometry)
poi = catalog["ap-plaza"]["pois"]
assert len(poi) >= 10
assert {"toilet","elevator","metro","information","exit","vertical-uncertain"}.issubset(
    {p["category"] for p in poi})
assert len({p["id"] for p in poi}) == len(poi)
for p in poi:
    assert p["floor"] == "B1" and p["confidence"] in {"cartel","por-revisar","posición-pendiente"}
    if p["x"] is not None:
        assert 0 <= p["x"] <= 1440 and 0 <= p["y"] <= 620
    else:
        assert p["confidence"] == "posición-pendiente"
assert catalog["ap-plaza"].get("indoorPositionCalibrated") is False

for feature in ap_geometry:
    fid, kind, name, deltas, rings, triangles, center = feature
    n = len(deltas) // 2
    assert kind in range(6) and n >= 3
    assert len(triangles) % 3 == 0 and len(triangles) >= 3
    assert max(triangles) < n

manifest = json.loads((root / "maps/manifest.json").read_text(encoding="utf-8"))
assert [f["id"] for f in manifest["floors"]] == ["LL", "UL", "L3"]
totals = {"features": 0, "commercial": 0, "triangles": 0}
for floor in manifest["floors"]:
    path = root / "maps" / (floor["id"] + ".json")
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["schema"] == "retailnav.floor.compact.v1"
    assert data["id"] == floor["id"]
    assert data["geometry"], floor["id"]
    assert len(data["geometry"]) == floor["featureCount"]
    ids = set()
    for entry in data["geometry"]:
        fid, kind, name, deltas, rings, indices, centroid = entry
        assert fid not in ids, fid
        ids.add(fid)
        assert isinstance(kind, int) and 0 <= kind <= 5
        assert len(deltas) >= 6 and len(deltas) % 2 == 0
        n = len(deltas) // 2
        assert len(indices) % 3 == 0 and all(0 <= i < n for i in indices)
        assert all(all(0 <= i < n for i in ring) for ring in rings)
        totals["triangles"] += len(indices) // 3
        totals["commercial"] += int(kind in (0, 1))
    totals["features"] += len(data["geometry"])

assert totals["features"] == 235, totals
assert totals["commercial"] == 131, totals
for label in ("LL", "UL", "L3", "ALL"):
    glb = root / "maps" / ("Aventura-" + label + ".glb")
    if glb.exists():
        raw = glb.read_bytes()
        magic, ver, length = struct.unpack("<4sII", raw[:12])
        assert magic == b"glTF" and ver == 2 and length == len(raw), glb
        jl, jt = struct.unpack("<I4s", raw[12:20])
        assert jt == b"JSON"
        j = json.loads(raw[20:20 + jl])
        assert j["asset"]["version"] == "2.0"
        assert len(j["meshes"]) > 20
        assert j["scene"] == 0
print("PASS RetailNav", json.dumps(totals))
