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
assert 'id="rnCoopConsent"' in html
assert 'id="rnCoopOffer"' in html
assert 'id="rnCoopJoin"' in html
assert 'id="rnCoopQr"' in html
assert 'window.RetailNavPositioningCore' in html
assert 'window.RetailNavCooperativePositioning' in html
assert 'peer-qr-colocation-asserted' in html
assert 'gpsVerticalAccuracyM' in html
assert 'id="rnAutoLocationStatus"' in html
assert 'gpsStartedAutomatically' in html
assert 'startGeolocation(true)' in html

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
assert 'id="compareViewport"' in html and 'id="compareResetView"' in html
assert 'touchGesturesEnabled:true' in html and 'panPinchSynchronized:true' in html
assert 'touch-action:none' in html
assert html.count('id="compareSvg"') == 1

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
assert len(ap_geometry) == 197, "Provisional AP Plaza AI2D v2 contains 197 candidates"
source_manifest=json.loads(Path("data/malls/ap-plaza/mall.json").read_text(encoding="utf8"))
floor_manifest=source_manifest["floors"][0]
assert floor_manifest["geometry"] == "B1.geometry.ai2d.v2.zlib.b64"
assert source_manifest["navigable"] is False
assert source_manifest["status"]=="vectorizado-provisional"
assert source_manifest["vectorRegionCount"]==197
assert source_manifest["indoorPositionCalibrated"] is False
method=source_manifest["ai2dRefinement"]
assert method["version"]==2 and method["candidateRegions"]==197
assert method["polygonVertices"]==2119 and method["renderTriangles"]==1725
assert method["requiresHumanReview"] is True
assert method["scanVerified"] is False and method["isNavigationSafe"] is False
assert method["photoSHA256"]==reference["sha256"]
assert method["geometrySHA256"]=="31bd607ba2953183cd50eb1af15bf7e1530b2d8616a87ca378ff9d78579acda1"
assert source_manifest["curveRefinement"]["active"] is False, "Preserve v3 as historical comparison"
import zlib,base64
new_file=Path("data/malls/ap-plaza/B1.geometry.ai2d.v2.zlib.b64")
new_bytes=zlib.decompress(base64.b64decode(new_file.read_text(encoding="ascii").strip()))
assert hashlib.sha256(new_bytes).hexdigest()==method["geometrySHA256"]
assert json.loads(new_bytes)==ap_geometry
report=json.loads(Path("data/malls/ap-plaza/B1.ai2d.render-report.json").read_text(encoding="utf8"))
assert report["features"]==197 and report["vertices"]==2119
assert report["triangles"]==1725 and report["codes"]==31
assert report["navigationApproved"] is False
assert report["referenceSHA256"]==reference["sha256"]
assert len({f[0] for f in ap_geometry})==197
assert all(f[0].startswith("AI2D-B1-") for f in ap_geometry)
assert sum(len(f[3])//2 for f in ap_geometry)==2119
assert sum(len(f[5])//3 for f in ap_geometry)==1725
assert len({f[2] for f in ap_geometry if f[2]})>=25
assert "<script>" in html and "RetailNavAreaLabels" in html
assert html.count('id="search"') == 1, "Only ONE shared search field may exist"
assert html.count('id="results"') == 1
assert html.count('id="mallHeaderName"') == 1
assert html.count('id="mallHeaderLogo"') == 1
assert 'RetailNav<small>SPATIAL EXPERIENCE</small>' not in html
assert html.index('id="rnMapSearch"') > html.index('class="stage"')
assert html.index('id="rnMapSearch"') < html.index('id="canvas"')
assert 'class="rnMallBrand"' in html
assert "searchPlacement:'map-top'" in html

assert 'id="rnAreasButton"' in html and 'id="rnDistrictOverlay"' in html

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

# The primary RetailNav catalog must load the same nine photo-derived floors
# exposed by /newworld9/. Never mistake candidate regions for certified stores.
nw = catalog["new-world-city-shanghai"]
assert nw["id"] == "new-world-city-shanghai"
assert nw["name"].startswith("新世界城")
assert nw["navigable"] is False and nw["floorAlignmentApproved"] is False
assert nw["commercialDirectoryRecords"] == 380
assert nw["legacyPhotoVectorRegionCount"] == 195
assert nw["vectorRegionCount"] == 737
assert nw["vectorMethod"] == "photo-segmentation-nine-floors-2026-10-14"
assert len(nw["floors"]) == 9
assert [fl[0] for fl in nw["floors"]] == [
    "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9"]
assert len(nw["districts"]) == 7  # Historical L1-L7 directory headings.
assert len(nw["floorReferences"]) == 9
nw_units = nw["units"]
old_units = [u for u in nw_units if
    u["source"].startswith("user-photo-directory-")]
assert len(old_units) == 380
assert len(nw_units) >= 380
assert len({(u["floor"], u["code"]) for u in nw_units}) == len(nw_units)
assert all(u["category"] and u["tags"] for u in old_units)
assert sum(bool(u["name"]) for u in old_units) >= 360
assert 0 < sum(u["x"] is None for u in nw_units) < len(nw_units)
assert {("L1","1B01"),("L3","3B30"),("L6","6A01"),
    ("L6","6C01"),("L7","7C01")}.issubset(
    {(u["floor"],u["code"]) for u in nw_units})
assert any("zapatillas" in u["tags"] for u in nw_units)
assert any("护肤" in u["tags"] for u in nw_units)
assert any("anime" in u["tags"] for u in nw_units)
assert nw["photoDigitizationExperiment"]["onlineNameVerification"][
    "onlineCorroboratedExamples"] == 6
assert nw["photoDigitizationExperiment"]["onlineNameVerification"]["perStoreOnlineCrawlDone"] is False
assert len(nw["pois"]) == 110
assert {p["category"] for p in nw["pois"]} == {
    "toilet", "elevator", "vertical-uncertain", "exit"}
assert all(p["verticalConnectionVerified"] is False for p in nw["pois"])
assert len(nw["demoCorridorAnchors"]) == 18
assert len({p["floor"] for p in nw["demoCorridorAnchors"]}) == 9
assert all(p["verified"] is False and p["source"] == "mock-photo-corridor-candidate"
    for p in nw["demoCorridorAnchors"])
assert nw["verticalGeometry"]["defaultFloorHeightMeters"] == 4.0
assert nw["verticalGeometry"]["floorHeightsMeters"] == {
    "L1": 4.0, "L2": 4.0, "L3": 4.0, "L4": 4.0,
    "L5": 4.0, "L6": 4.0, "L7": 4.0, "L8": 4.0, "L9": 4.0}
assert nw["verticalGeometry"]["metresVerified"] is False
assert nw["verticalGeometry"]["connectionMappingsVerified"] is False
assert "id=\"rnHeightsPanel\"" in html
assert "id=\"rnConnectorsToggle\"" in html
assert 'function arcballCameraDelta' in html
assert len(nw["escalatorFixtures"]) == 25
assert len({f["floor"] for f in nw["escalatorFixtures"]}) == 9
assert all(f["verified"] is False and f["floorPairVerified"] is False
           and f["entranceExitVerified"] is False
           and f["direction"] == "unknown"
           for f in nw["escalatorFixtures"])
assert nw["escalatorFootprintsMeasured"] is False
assert "RetailNavEscalators" in html
assert "mechanical escalators" in html.lower() or "mechanical escalator" in html.lower()
assert len(nw["verticalShaftCandidates"]) == 3
assert nw["verticalShaftMappingsVerified"] is False
assert len(nw["verticalShaftCandidates"][0]["observations"]) == 9
assert [o["floor"] for o in nw["verticalShaftCandidates"][0]["observations"]] == [
    "L"+str(n) for n in range(1,10)]
assert all(not shaft["verified"] and not shaft["correspondenceVerified"]
           for shaft in nw["verticalShaftCandidates"])
assert "RetailNavServiceIcons" in html
assert "RetailNavVerticalShafts" in html
assert "framed-transparent-shaft" in html
assert "window.RETAILNAV_ROOF_ATTACHMENTS" in html
assert len(nw["verticalConnectionHypotheses"]) == 39
assert all("NOT VERIFIED" in edge["status"]
    for edge in nw["verticalConnectionHypotheses"])
shops = 0
for record in nw["floors"]:
    level = record[0]
    source = nw["floorReferences"][level]
    photo = root/source["url"]
    assert photo.exists()
    assert hashlib.sha256(photo.read_bytes()).hexdigest() == source["sha256"]
    assert source["qa"]["status"] == "pending"
    assert source["quality"] == "compressed-preview"
    assert all(not approval for approval in source["qa"]["checks"].values())
    assert source["imageSize"] == [1376,768]
    assert len(record[3]) >= 15, level
    assert all(f[1] in (1,3) and len(f) == 7 for f in record[3])
    assert all(f[5] and len(f[5])%3 == 0 for f in record[3])
    assert all(max(f[5]) < len(f[3])//2 for f in record[3])
    shops += sum(f[1] == 1 for f in record[3])
assert sum(len(f[3]) for f in nw["floors"]) == 737
assert shops == 627
assert nw["photoDigitizationExperiment"]["unmappedFloorsFromDirectorySign"] == [
    "B1", "L10", "L11", "L12"]

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
