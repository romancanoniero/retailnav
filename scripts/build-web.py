#!/usr/bin/env python3
"""Rebuild self-contained RetailNav HTML using editable source and vector maps."""
import json
import zlib
import base64
from pathlib import Path

repo = Path(__file__).resolve().parents[1]
template = (repo / "src/page.template.html").read_text(encoding="utf-8")
floors = []
for level in ("LL", "UL", "L3"):
    d = json.loads((repo / "public/maps" / (level + ".json")).read_text(encoding="utf-8"))
    assert d["id"] == level and len(d["geometry"]) > 0
    floors.append([d["id"], d["name"], d["source"], d["geometry"], d["walkGrid"]])
# The Mall Catalog contains independently versionable compact vector maps.
# AP Plaza is a photo-traced provisional floor; DO NOT treat white space as
# a validated navigable walkway. Additional malls can be added to this dict.
ap_geometry = json.loads(zlib.decompress(base64.b64decode(
    (repo / "data/malls/ap-plaza/B1.geometry.zlib.b64").read_text(encoding="ascii").strip()
)))
assert len(ap_geometry) >= 40 and any(f[2] == "KFC" for f in ap_geometry)
walk_width, walk_height, walk_step = 180, 78, 8
ap_walk = {
    "x": 0, "y": 0, "step": walk_step, "w": walk_width, "h": walk_height,
    "bits": base64.b64encode(bytes((walk_width * walk_height + 7) // 8)).decode("ascii"),
}
catalog = {
    "aventura": {
        "id": "aventura", "name": "Aventura Mall", "city": "Aventura, Florida",
        "source": "Tres planos originales aportados", "status": "mock",
        "floors": floors, "floorLabels": ["LL", "UL", "L3"],
        "origin": [690, 405], "scale": 0.15, "navigable": False,
        "gps": {"lat": 25.95706, "lon": -80.14275, "radiusM": 600},
    },
    "ap-plaza": {
        "id": "ap-plaza", "name": "AP Plaza", "city": "Pudong, Shanghái",
        "source": "Foto del plano AP Plaza aportada el 13/10/2026",
        "status": "vectorizado-provisional", "floors": [
            ["B1", "Planta del plano AP Plaza (B1, sin confirmar)",
             "Foto AP Plaza - rectificada manualmente", ap_geometry, ap_walk]
        ],
        "floorLabels": ["B1"], "origin": [720, 310], "scale": 0.12,
        "navigable": False,
        "gps": {"lat": 31.22189, "lon": 121.53866, "radiusM": 650},
        "photoRedDot": {"floor": "B1", "x": 366, "y": 320, "status": "cartel-fijo"},
        "warning": "Regiones coloreadas detectadas automáticamente. No son "
                   "polígonos de locales certificados ni pasillos medidos.",
    },
}
components = {
    "__MALL_CATALOG__": json.dumps(catalog, ensure_ascii=False, separators=(",", ":")),
    "__MALL_SELECTOR__": (repo / "src/mall-selector.js").read_text(encoding="utf-8"),
    "__CSS__": (repo / "src/style.css").read_text(encoding="utf-8"),
    "__MODEL__": json.dumps(floors, ensure_ascii=False, separators=(",", ":")),
    "__REFERENCES__": (repo / "src/references.js").read_text(encoding="utf-8"),
    "__DEMO_FRIENDS__": (repo / "src/demo-friends.js").read_text(encoding="utf-8"),
    "__JS__": (repo / "src/viewer.js").read_text(encoding="utf-8"),
    "__PIN_RENDERER__": (repo / "src/pins3d.js").read_text(encoding="utf-8"),
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
