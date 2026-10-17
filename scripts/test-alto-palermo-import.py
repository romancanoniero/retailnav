#!/usr/bin/env python3
"""Regression checks for the official Alto Palermo floor/table import."""
import csv
import base64
import json
import re
import zlib
from collections import Counter
from pathlib import Path


repo = Path(__file__).resolve().parents[1]
folder = repo / "data" / "malls" / "alto-palermo"
source = json.loads((folder / "source-records.json").read_text(encoding="utf-8"))
manifest = json.loads((folder / "mall.json").read_text(encoding="utf-8"))
source_rows = source["stores"]
brand_assets = json.loads((folder / "brand-assets.json").read_text(encoding="utf-8"))

assert source["source_url"] == "https://www.altopalermo.com.ar/maps_ap/index.html"
assert len(source_rows) == manifest["officialDirectoryRecords"] == 158
assert manifest["navigable"] is False and "gps" not in manifest
assert [floor["id"] for floor in manifest["floors"]] == ["SS", "PB", "EP", "P1", "P2", "P3"]
assert manifest["officialCodedRecords"] == 153
assert manifest["officialPositionedRecords"] == 153
assert manifest["officialPositionedAndCodedRecords"] == 152
assert manifest["brandAssetsManifest"] == "brand-assets.json"
assert brand_assets["stats"] == {
    "directoryRecords": 158, "recordsWithArchivedLogo": 153,
    "recordsWithUnavailablePublishedLogo": 5,
    "uniqueArchivedStoreLogoFiles": 145, "uniqueUnavailableStoreLogoFiles": 5,
}
assert len(brand_assets["storeBindings"]) == 158
assert sum(bool(row["publicUrl"]) for row in brand_assets["storeBindings"]) == 153
assert all(row["status"] == "published-reference-unavailable" or
           row["status"] == "published-reference-invalid-png"
           for row in brand_assets["unavailableAssets"])

imported = []
geometry_counts = {}
commercial_counts = {}
for floor in manifest["floors"]:
    with (folder / (floor["id"] + "-unit-codes.csv")).open(
            encoding="utf-8", newline="") as stream:
        rows = list(csv.DictReader(stream))
    assert len(rows) == floor["directoryRecords"]
    imported.extend(rows)
    reference = manifest["floorReferences"][floor["id"]]
    assert reference["qa"]["status"] == "pending"
    assert reference["qa"]["checks"]["individualStoreWalls"] is True
    assert reference["quality"] == "full-resolution"
    assert (folder / (floor["id"] + ".official.svg")).is_file()
    assert list(folder.glob(floor["id"] + ".reference.webp.b64.part*"))
    geometry = json.loads(zlib.decompress(base64.b64decode(
        (folder / floor["geometry"]).read_text(encoding="ascii"))))
    geometry_counts[floor["id"]] = len(geometry)
    commercial_counts[floor["id"]] = sum(feature[1] == 1 for feature in geometry)
    assert len(geometry) == floor["regionCount"] > 3
    assert commercial_counts[floor["id"]] == floor["commercialRegionCount"]
    assert all("-SLAB-" not in feature[0] for feature in geometry)
    assert all(len(feature[5]) >= 3 and len(feature[5]) % 3 == 0 for feature in geometry)
    assert floor["vectorizationStatus"] == "OFFICIAL-SVG-REGIONS-MARKER-LINKED-PROVISIONAL"

assert geometry_counts == {"SS": 137, "PB": 73, "EP": 14, "P1": 47, "P2": 44, "P3": 16}
assert commercial_counts == {"SS": 4, "PB": 72, "EP": 12, "P1": 46, "P2": 43, "P3": 15}
assert manifest["officialSvgGeometryRegions"] == 331
assert manifest["officialSvgCommercialRegions"] == 192
assert manifest["provisionallyLinkedOfficialCodes"] == 55
assert "floor_slabs" not in (repo / "scripts" / "import_alto_palermo.py").read_text(encoding="utf-8")

source_by_id = {str(row["id"]): row for row in source_rows}
imported_by_id = {row["sourceRecordId"]: row for row in imported}
assert len(imported_by_id) == len(imported) == 158
assert set(imported_by_id) == set(source_by_id)
for source_id, row in imported_by_id.items():
    original = source_by_id[source_id]
    assert row["code"] == (original["local_number"] or "")
    assert row["name"] == original["name"]
    assert row["category"] == original["category"]
    assert row["tags"] and row["tagEvidence"] == "official-directory-category-normalization"
    assert original["tags"] and row["tags"].split(",") == original["tags"]
    assert row["logoSourceURL"] == original["logo_source_url"]
    assert row["logoURL"] == original["logo_local_url"]
    if original["position_valid"]:
        assert row["x"] and row["y"]
    else:
        assert not row["x"] and not row["y"]

duplicates = Counter((row["floor"], row["code"]) for row in imported if row["code"])
assert {key: count for key, count in duplicates.items() if count > 1} == {
    ("P2", "L29"): 2,
    ("P2", "G2"): 3,
    ("P3", "L01"): 2,
}

catalog_doc = json.loads((repo / "public" / "catalog" / "malls" /
                          "alto-palermo" / "stores.json").read_text(encoding="utf-8"))
assert catalog_doc["stats"]["total"] == 158
assert catalog_doc["stats"]["linkedProvisional"] == 55
assert catalog_doc["stats"]["withoutVector"] == 103
assert catalog_doc["stats"]["sharedVectors"] == 0
assert len({row["storeId"] for row in catalog_doc["records"]}) == 158
assert sum(not row["code"] for row in catalog_doc["records"]) == 5
linked = [row for row in catalog_doc["records"] if row["polygonId"]]
assert len(linked) == len({(row["floor"], row["polygonId"]) for row in linked}) == 55
assert all(row["polygonMatchStatus"] ==
           "official-marker-inside-svg-region-provisional" for row in linked)
assert not any("nearest" in str(row) for row in catalog_doc["records"])
assert all(row["tags"] and row["tagEvidence"] ==
           "official-directory-category-normalization" for row in catalog_doc["records"])
assert sum(bool(row["logoURL"]) for row in catalog_doc["records"]) == 153
assert catalog_doc["stats"]["withConceptSuggestions"] == 124

vector_font = (repo / "src/inter-vector-font.js").read_text(encoding="utf-8")
assert "retailnav.vector-font-mesh.v1" in vector_font
assert "8c883f63b2c4157d997319f2c8bc6995ed4357ef371940d31ca159004a4aae63" in vector_font
assert '"curveSegmentsPerQuadratic":24' in vector_font
assert "getImageData" not in vector_font and '"rects"' not in vector_font

html = (repo / "public" / "index.html").read_text(encoding="utf-8")
match = re.search(r'<script id="mallCatalog" type="application/json">([\s\S]+?)</script>', html)
assert match
mall = json.loads(match.group(1))["alto-palermo"]
assert mall["floorLabels"] == ["SS", "PB", "EP", "P1", "P2", "P3"]
assert len(mall["units"]) == 158
assert mall["storeCatalog"]["total"] == 158
assert mall["theme"]["font"] == "alto-inter"
assert mall["logoSymbolUrl"] == "branding/malls/alto-palermo/mall-mark.png"
assert mall["brandAssets"]["recordsWithArchivedLogo"] == 153
bundle = json.loads((repo / "public" / mall["mapAsset"]["url"]).read_text(encoding="utf-8"))
assert sum(len(floor[3]) for floor in bundle["floors"]) == 331
assert sum(feature[1] == 1 for floor in bundle["floors"] for feature in floor[3]) == 192
print("PASS Alto Palermo: 6 official SVG floors, 331 regions, 192 commercial contours, 55 unambiguous marker links")
