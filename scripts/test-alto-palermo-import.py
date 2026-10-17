#!/usr/bin/env python3
"""Regression checks for the official Alto Palermo floor/table import."""
import csv
import json
import re
from collections import Counter
from pathlib import Path


repo = Path(__file__).resolve().parents[1]
folder = repo / "data" / "malls" / "alto-palermo"
source = json.loads((folder / "source-records.json").read_text(encoding="utf-8"))
manifest = json.loads((folder / "mall.json").read_text(encoding="utf-8"))
source_rows = source["stores"]

assert source["source_url"] == "https://www.altopalermo.com.ar/maps_ap/index.html"
assert len(source_rows) == manifest["officialDirectoryRecords"] == 158
assert manifest["navigable"] is False and "gps" not in manifest
assert [floor["id"] for floor in manifest["floors"]] == ["SS", "PB", "EP", "P1", "P2", "P3"]
assert manifest["officialCodedRecords"] == 153
assert manifest["officialPositionedRecords"] == 153
assert manifest["officialPositionedAndCodedRecords"] == 152

imported = []
for floor in manifest["floors"]:
    with (folder / (floor["id"] + "-unit-codes.csv")).open(
            encoding="utf-8", newline="") as stream:
        rows = list(csv.DictReader(stream))
    assert len(rows) == floor["directoryRecords"]
    imported.extend(rows)
    reference = manifest["floorReferences"][floor["id"]]
    assert reference["qa"]["status"] == "pending"
    assert reference["quality"] == "full-resolution"
    assert (folder / (floor["id"] + ".official.svg")).is_file()
    assert list(folder.glob(floor["id"] + ".reference.webp.b64.part*"))

source_by_id = {str(row["id"]): row for row in source_rows}
imported_by_id = {row["sourceRecordId"]: row for row in imported}
assert len(imported_by_id) == len(imported) == 158
assert set(imported_by_id) == set(source_by_id)
for source_id, row in imported_by_id.items():
    original = source_by_id[source_id]
    assert row["code"] == (original["local_number"] or "")
    assert row["name"] == original["name"]
    assert row["category"] == original["category"]
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
assert catalog_doc["stats"]["withoutVector"] == 158
assert len({row["storeId"] for row in catalog_doc["records"]}) == 158
assert sum(not row["code"] for row in catalog_doc["records"]) == 5

html = (repo / "public" / "index.html").read_text(encoding="utf-8")
match = re.search(r'<script id="mallCatalog" type="application/json">([\s\S]+?)</script>', html)
assert match
mall = json.loads(match.group(1))["alto-palermo"]
assert mall["floorLabels"] == ["SS", "PB", "EP", "P1", "P2", "P3"]
assert len(mall["units"]) == 158
assert mall["storeCatalog"]["total"] == 158
print("PASS Alto Palermo: 6 floors, 158 official marker records, 152 coded+positioned")
