#!/usr/bin/env python3
"""Build 3D GLB meshes from RetailNav floor JSON. No third-party dependencies."""
from __future__ import annotations
import argparse
import json
import math
import struct
from pathlib import Path

LEVELS = ("LL", "UL", "L3")
HEIGHTS = {"LL": 0.0, "UL": 4.5, "L3": 9.0}
ELEVATION = {0: 1.05, 1: 0.78, 2: 0.58, 3: 0.05, 4: 0.0, 5: -0.08}
DEPTH = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0, 5: -0.24}
COLORS = {
    0: (0.16, 0.43, 0.75, 0.92),
    1: (0.28, 0.73, 0.79, 0.78),
    2: (0.23, 0.40, 0.55, 0.63),
    3: (0.07, 0.77, 0.70, 0.79),
    4: (0.02, 0.08, 0.16, 0.10),
    5: (0.09, 0.22, 0.31, 0.93),
}

def unpack_vertices(deltas):
    assert len(deltas) % 2 == 0
    out = []
    x = y = 0
    for i in range(0, len(deltas), 2):
        x += deltas[i]
        y += deltas[i + 1]
        out.append(((x / 2.0 - 690.0) * 0.15,
                    (405.0 - y / 2.0) * 0.15))
    return out


def padded(buf: bytearray):
    while len(buf) % 4:
        buf.append(0)


def build(site: Path, chosen: tuple[str, ...], output: Path) -> dict:
    gltf = {
        "asset": {"version": "2.0", "generator": "RetailNav compact vector GLB builder (mock data)"},
        "scene": 0,
        "scenes": [{"nodes": []}],
        "nodes": [], "meshes": [], "accessors": [], "bufferViews": [],
        "buffers": [{"byteLength": 0}], "materials": [],
    }
    for k in range(6):
        gltf["materials"].append({
            "name": ("anchor", "unit", "zone", "corridor", "void", "slab")[k],
            "pbrMetallicRoughness": {
                "baseColorFactor": COLORS[k],
                "metallicFactor": 0.12,
                "roughnessFactor": 0.72,
            },
            "doubleSided": True,
            "alphaMode": "BLEND" if COLORS[k][3] < 1.0 else "OPAQUE",
        })

    binary = bytearray()
    feature_count = 0
    triangle_count = 0
    for level in chosen:
        source = site / "maps" / (level + ".json")
        f = json.loads(source.read_text(encoding="utf-8"))
        assert f["id"] == level and f["schema"] == "retailnav.floor.compact.v1"
        floor_id = len(gltf["nodes"])
        floor_node = {"name": level, "translation": [0.0, HEIGHTS[level], 0.0],
                      "children": [], "extras": {"mock": True, "level": level}}
        gltf["nodes"].append(floor_node)
        gltf["scenes"][0]["nodes"].append(floor_id)
        for item in f["geometry"]:
            fid, kind, name, deltas, rings, face_indices, centroid = item
            if kind == 4 or not face_indices:
                continue
            coords = unpack_vertices(deltas)
            if not coords:
                continue
            vertex_count = len(coords)
            if any(i < 0 or i >= vertex_count for i in face_indices):
                raise ValueError("Invalid triangle index in " + fid)
            low = DEPTH[kind]
            high = ELEVATION[kind]
            positions = [(x, low, z) for x, z in coords]
            positions.extend((x, high, z) for x, z in coords)
            indices = []
            for i in range(0, len(face_indices), 3):
                a, b, c = face_indices[i:i + 3]
                if len((a, b, c)) != 3:
                    raise ValueError("Incomplete triangle: " + fid)
                indices.extend((vertex_count + a, vertex_count + b, vertex_count + c))
            if high != low:
                for ring in rings:
                    if len(ring) < 3:
                        continue
                    for j, a in enumerate(ring):
                        b = ring[(j + 1) % len(ring)]
                        if a == b:
                            continue
                        indices.extend((a, b, vertex_count + b,
                                        a, vertex_count + b, vertex_count + a))
            if not indices:
                continue
            pos_offset = len(binary)
            for x, y, z in positions:
                if not all(math.isfinite(v) for v in (x, y, z)):
                    raise ValueError("Invalid vertex: " + fid)
                binary.extend(struct.pack("<fff", x, y, z))
            padded(binary)
            gltf["bufferViews"].append({"buffer": 0, "byteOffset": pos_offset,
                                         "byteLength": len(positions) * 12,
                                         "target": 34962})
            pos_view = len(gltf["bufferViews"]) - 1
            gltf["accessors"].append({"bufferView": pos_view, "componentType": 5126,
                                      "count": len(positions), "type": "VEC3",
                                      "min": [min(v[i] for v in positions) for i in range(3)],
                                      "max": [max(v[i] for v in positions) for i in range(3)]})
            pos_access = len(gltf["accessors"]) - 1
            idx_offset = len(binary)
            for i in indices:
                binary.extend(struct.pack("<I", i))
            padded(binary)
            gltf["bufferViews"].append({"buffer": 0, "byteOffset": idx_offset,
                                         "byteLength": len(indices) * 4,
                                         "target": 34963})
            idx_view = len(gltf["bufferViews"]) - 1
            gltf["accessors"].append({"bufferView": idx_view, "componentType": 5125,
                                      "count": len(indices), "type": "SCALAR",
                                      "min": [min(indices)], "max": [max(indices)]})
            idx_access = len(gltf["accessors"]) - 1
            gltf["meshes"].append({"name": fid,
                                   "primitives": [{"attributes": {"POSITION": pos_access},
                                                   "indices": idx_access,
                                                   "mode": 4, "material": kind}]})
            mesh_id = len(gltf["meshes"]) - 1
            gltf["nodes"].append({"name": name or fid,
                                  "mesh": mesh_id,
                                  "extras": {"feature_id": fid, "level": level,
                                             "kind": kind, "provisional": True}})
            floor_node["children"].append(len(gltf["nodes"]) - 1)
            feature_count += 1
            triangle_count += len(indices) // 3

    gltf["buffers"][0]["byteLength"] = len(binary)
    jsonbuf = bytearray(json.dumps(gltf, ensure_ascii=False,
                                   separators=(",", ":")).encode("utf-8"))
    while len(jsonbuf) % 4:
        jsonbuf.append(32)
    padded(binary)
    total = 12 + 8 + len(jsonbuf) + 8 + len(binary)
    out = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    out.extend(struct.pack("<I4s", len(jsonbuf), b"JSON"))
    out.extend(jsonbuf)
    out.extend(struct.pack("<I4s", len(binary), b"BIN\x00"))
    out.extend(binary)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(out)
    return {"file": output.name, "bytes": len(out), "features": feature_count,
            "triangles": triangle_count}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("public", type=Path, nargs="?", default=Path("public"))
    args = p.parse_args()
    site = args.public
    outputs = [(x, (x,)) for x in LEVELS] + [("ALL", LEVELS)]
    for name, chosen in outputs:
        result = build(site, chosen, site / "maps" / ("Aventura-" + name + ".glb"))
        print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
