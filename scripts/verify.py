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
