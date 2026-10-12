#!/usr/bin/env python3
"""Offline structural verification of RetailNav vector data and generated GLBs."""
import argparse
import json
import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAPS = ROOT / "public" / "maps"
FLOOR_IDS = ("LL", "UL", "L3")


def check_glb(path):
    data = path.read_bytes()
    assert len(data) >= 28, f"{path}: too short"
    magic, version, total = struct.unpack_from("<III", data)
    assert magic == 0x46546c67 and version == 2 and total == len(data), path
    length, chunk_type = struct.unpack_from("<II", data, 12)
    assert chunk_type == 0x4e4f534a, path
    doc = json.loads(data[20:20 + length])
    assert doc["asset"]["version"] == "2.0"
    assert doc["meshes"] and doc["accessors"]
    offset = 20 + length
    bin_len, bin_kind = struct.unpack_from("<II", data, offset)
    assert bin_kind == 0x004e4942 and offset + 8 + bin_len == len(data), path
    for view in doc["bufferViews"]:
        assert 0 <= view["byteOffset"] and view["byteOffset"] + view["byteLength"] <= bin_len
    assert doc["buffers"][0]["byteLength"] <= bin_len
    return len(doc["meshes"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-glb", action="store_true")
    args = parser.parse_args()
    html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
    assert "RetailNav" in html and "<canvas" in html and "modelData" in html
    match = re.search(
        r'<script\s+id="modelData"\s+type="application/json">([\s\S]*?)</script>',
        html)
    assert match, "Standalone viewer has no embedded geometry"
    embedded = json.loads(match.group(1))
    assert len(embedded) == 3
    manifest = json.loads((MAPS / "manifest.json").read_text("utf-8"))
    assert manifest["schema"] == "retailnav.manifest.v1"
    assert [f["id"] for f in manifest["floors"]] == list(FLOOR_IDS)
    total = 0
    for i, floor_id in enumerate(FLOOR_IDS):
        data = json.loads((MAPS / f"{floor_id}.json").read_text("utf-8"))
        assert data["id"] == floor_id and embedded[i][0] == floor_id
        assert data["geometry"] == embedded[i][3], f"{floor_id} mismatch"
        total += len(data["geometry"])
        seen = set()
        for feature in data["geometry"]:
            feature_id, kind, label, xy, rings, triangles, center = feature
            assert feature_id not in seen and kind in range(6), feature_id
            seen.add(feature_id)
            assert isinstance(label, str) and len(xy) >= 6 and len(xy) % 2 == 0
            assert len(triangles) % 3 == 0
            count = len(xy) // 2
            assert all(0 <= v < count for v in triangles), feature_id
            assert all(all(0 <= v < count for v in ring) for ring in rings), feature_id
            assert len(center) == 2
        assert len(data["geometry"]) == manifest["floors"][i]["featureCount"]
        if args.require_glb:
            assert check_glb(MAPS / f"Aventura-{floor_id}.glb") > 0
        print(f"{floor_id}: {len(data['geometry'])} vector elements consistent")
    assert total == 235, f"Unexpected feature count {total}"
    if args.require_glb:
        print("Aventura-ALL.glb:",
              check_glb(MAPS / "Aventura-ALL.glb"), "grouped meshes")
    print(f"PASS: {total} elements, 3 aligned image-space floors, 1 manifest")


if __name__ == "__main__":
    main()
