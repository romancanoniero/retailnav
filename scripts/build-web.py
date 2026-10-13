#!/usr/bin/env python3
"""Rebuild self-contained RetailNav HTML using editable source and vector maps."""
import json
import zlib
import base64
import csv
import hashlib
from pathlib import Path
from unit_index import attach as attach_unit_codes

repo = Path(__file__).resolve().parents[1]
template = (repo / "src/page.template.html").read_text(encoding="utf-8")
floors = []
for level in ("LL", "UL", "L3"):
    d = json.loads((repo / "public/maps" / (level + ".json")).read_text(encoding="utf-8"))
    assert d["id"] == level and len(d["geometry"]) > 0
    floors.append([d["id"], d["name"], d["source"], d["geometry"], d["walkGrid"]])
# Registry: any data/malls/<slug>/mall.json is automatically added to the
# website. The image-to-vector tool writes this file and its compact geometry.
# Unreviewed maps never publish an automatic pathfinding grid.
catalog = {
    "aventura": {
        "id": "aventura", "name": "Aventura Mall", "city": "Aventura, Florida",
        "source": "Tres planos originales aportados", "status": "mock",
        "floors": floors, "floorLabels": ["LL", "UL", "L3"],
        "origin": [690, 405], "scale": 0.15, "navigable": False,
        "gps": {"lat": 25.95706, "lon": -80.14275, "radiusM": 600},
    },
}
for mall_path in sorted((repo / "data/malls").glob("*/mall.json")):
    info = json.loads(mall_path.read_text(encoding="utf-8"))
    slug = mall_path.parent.name
    assert info["id"] == slug and slug not in catalog
    assert info.get("navigable") is False, "Only provisional mock photo maps are supported"
    floor_data = []
    units = []
    photo_references = info.get("floorReferences", {})
    if set(photo_references) != {f["id"] for f in info["floors"]}:
        raise ValueError(slug+": all imported floors MUST have an original-photo reference")

    for item in info["floors"]:
        floor_id = item["id"]
        assert floor_id.replace("-", "").isalnum()
        photo_width, photo_height = item["imageSize"]
        encoded = (mall_path.parent / item["geometry"]).read_text(encoding="ascii").strip()
        geometry = json.loads(zlib.decompress(base64.b64decode(encoded)))
        assert len(geometry) > 2
        assert all(len(f) == 7 and len(f[3]) >= 6 for f in geometry)
        units.extend(attach_unit_codes(mall_path.parent, floor_id, geometry))

        reference = photo_references[floor_id]
        target_url = "reference/"+slug+"/"+floor_id+".webp"
        if reference.get("url") != target_url:
            raise ValueError(slug+"/"+floor_id+": invalid reference asset URL")
        parts = sorted(mall_path.parent.glob(floor_id+".reference.webp.b64.part*"))
        if not parts:
            if reference.get("qa",{}).get("status")=="approved" or info.get("navigable",False):
                raise ValueError(slug+"/"+floor_id+": an approved/released floor requires a stored photo")
            # In the non-navigable preview, show an explicit missing-reference
            # control instead of pretending a vector trace is the source photo.
            reference["url"]=None
            step = 8
            width, height = (photo_width + step-1)//step, (photo_height + step-1)//step
            walk = {"x":0,"y":0,"step":step,"w":width,"h":height,
                    "bits":base64.b64encode(bytes((width*height+7)//8)).decode("ascii")}
            floor_data.append([floor_id,item["name"],item["source"],geometry,walk])
            continue
        raw = base64.b64decode("".join(p.read_text(encoding="ascii").strip()
                                         for p in parts),validate=True)
        sha = hashlib.sha256(raw).hexdigest()
        if sha != reference.get("sha256"):
            raise ValueError(slug+"/"+floor_id+": photo changed without updating approved reference hash")
        # WebP VP8 lossy frame's start code contains the natural image size.
        marker = raw.find(b"\x9d\x01\x2a",12,100)
        if raw[:4] != b"RIFF" or raw[8:12] != b"WEBP" or marker == -1:
            raise ValueError(slug+"/"+floor_id+": source must be a valid VP8 WebP photo")
        registered_size = [int.from_bytes(raw[marker+3:marker+5],"little")&0x3fff,
                           int.from_bytes(raw[marker+5:marker+7],"little")&0x3fff]
        if registered_size != [photo_width,photo_height] or registered_size != reference.get("imageSize"):
            raise ValueError(slug+"/"+floor_id+": source image and vector coordinate sizes do not match")
        qa = reference.get("qa",{})
        if qa.get("status") not in ("pending","approved"):
            raise ValueError(slug+"/"+floor_id+": all floor comparisons require a QA status")
        if qa.get("status") == "approved":
            expected_hash = hashlib.sha256(json.dumps(geometry,separators=(",",":"),
                ensure_ascii=False).encode("utf-8")).hexdigest()
            if qa.get("geometrySha256") != expected_hash or not qa.get("reviewer") or not qa.get("reviewedAt") or not all(qa.get("checks",{}).values()):
                raise ValueError(slug+"/"+floor_id+": approved geometry requires current signed review, all checks, and matching geometry SHA")
        elif info.get("navigable",False) or info.get("status") not in ("provisional","mock"):
            raise ValueError(slug+"/"+floor_id+": pending review may ONLY publish as non-navigable provisional/mock")
        asset = repo/"public"/"reference"/slug/(floor_id+".webp")
        asset.parent.mkdir(parents=True,exist_ok=True)
        asset.write_bytes(raw)

        step = 8
        width, height = (photo_width + step-1)//step, (photo_height + step-1)//step
        walk = {"x": 0, "y": 0, "step": step, "w": width, "h": height,
                "bits": base64.b64encode(bytes((width*height+7)//8)).decode("ascii")}
        floor_data.append([floor_id, item["name"], item["source"], geometry, walk])
    catalog[slug] = {**info, "floors": floor_data, "units": units,
                     "floorLabels": [f[0] for f in floor_data]}
components = {
    "__MALL_CATALOG__": json.dumps(catalog, ensure_ascii=False, separators=(",", ":")),
    "__MALL_SELECTOR__": (repo / "src/mall-selector.js").read_text(encoding="utf-8"),
    "__CSS__": (repo / "src/style.css").read_text(encoding="utf-8"),
    "__MODEL__": json.dumps(floors, ensure_ascii=False, separators=(",", ":")),
    "__REFERENCES__": (repo / "src/references.js").read_text(encoding="utf-8"),
    "__DEMO_FRIENDS__": (repo / "src/demo-friends.js").read_text(encoding="utf-8"),
    "__JS__": (repo / "src/viewer.js").read_text(encoding="utf-8"),
    "__PIN_RENDERER__": (repo / "src/pins3d.js").read_text(encoding="utf-8"),
    "__PIN_WEBGL_RENDERER__": (repo / "src/pins-webgl.js").read_text(encoding="utf-8"),
    "__POI_RENDERER__": (repo / "src/poi-layer.js").read_text(encoding="utf-8"),
    "__UNITS_RENDERER__": (repo / "src/units.js").read_text(encoding="utf-8"),
    "__DISTRICTS_RENDERER__": (repo / "src/districts-webgl.js").read_text(encoding="utf-8"),
    "__UNIT_SIGNS_WEBGL__": (repo / "src/unit-signs-webgl.js").read_text(encoding="utf-8"),
    "__INDOOR_RENDERER__": (repo / "src/indoor-location.js").read_text(encoding="utf-8"),
    "__QRCODE__": (repo / "src/qrcode.min.js").read_text(encoding="utf-8"),
    "__SOCIAL__": (repo / "src/social.js").read_text(encoding="utf-8"),
    "__QRSCANNER__": (repo / "src/jsqr.js").read_text(encoding="utf-8"),
    "__FALLBACK__": (repo / "src/fallback.svg").read_text(encoding="utf-8"),
}
for placeholder, value in components.items():
    assert template.count(placeholder) == 1, placeholder
    template = template.replace(placeholder, value)
assert all(p not in template for p in components), "Unresolved component"
assert "<canvas" in template and '"modelData"' in template
out = repo / "public/index.html"
out.write_text(template, encoding="utf-8")
print("Built", out, out.stat().st_size, "bytes; 3 levels")
