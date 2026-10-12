#!/usr/bin/env python3
"""Build mobile-friendly glTF 2.0 binary meshes from RetailNav vector floors.

Uses only Python's standard library. Shapes originate in user-submitted plan
traces, not LiDAR measurements. Scale and store divisions are provisional.
"""
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAPS = ROOT / "public" / "maps"
FLOOR_IDS = ("LL", "UL", "L3")
KINDS = ("anchor", "unit", "zone", "corridor", "void", "slab")
COLORS = {
    "anchor": (0.14, 0.43, 0.65, 0.93),
    "unit": (0.41, 0.78, 0.82, 0.78),
    "zone": (0.31, 0.52, 0.67, 0.72),
    "corridor": (0.26, 0.91, 0.86, 0.79),
    "slab": (0.12, 0.34, 0.45, 0.56),
}
HEIGHTS = {"anchor": 1.6, "unit": 0.9, "zone": 0.65,
           "corridor": 0.09, "slab": 0.08}
SCALE = 0.15
ORIGIN = (690.0, 405.0)


def read_floors():
    floors = []
    for index, floor_id in enumerate(FLOOR_IDS):
        path = MAPS / (floor_id + ".json")
        floor = json.loads(path.read_text(encoding="utf-8"))
        assert floor["id"] == floor_id and floor["geometry"], path
        floors.append((index, floor))
    return floors


def points_from_deltas(encoded):
    out = []
    x = y = 0
    assert len(encoded) % 2 == 0
    for pos in range(0, len(encoded), 2):
        x += encoded[pos]
        y += encoded[pos + 1]
        out.append(((x / 2 - ORIGIN[0]) * SCALE,
                    -(y / 2 - ORIGIN[1]) * SCALE))
    return out


def vertex(target, xyz, normal):
    target.extend((*xyz, *normal))


def triangle(target, a, b, c, normal):
    for p in (a, b, c):
        vertex(target, p, normal)


def add_feature(target, data, level):
    fid, ki, _label, xy, rings, triangles, _center = data
    if not 0 <= ki < len(KINDS):
        raise ValueError(f"{fid}: invalid kind {ki}")
    kind = KINDS[ki]
    if kind == "void":
        return
    points = points_from_deltas(xy)
    if not points:
        return
    base = level * 4.5
    height = HEIGHTS[kind]
    top = base + height
    if len(triangles) % 3:
        raise ValueError(f"{fid}: non-triangular index array")
    for i in range(0, len(triangles), 3):
        a, b, c = [points[v] for v in triangles[i:i+3]]
        triangle(target, (a[0], top, a[1]), (b[0], top, b[1]),
                 (c[0], top, c[1]), (0, 1, 0))
    if kind in ("corridor", "slab"):
        return
    for ring in rings:
        if len(ring) < 3:
            continue
        for i, ai in enumerate(ring):
            bi = ring[(i + 1) % len(ring)]
            a, b = points[ai], points[bi]
            dx, dz = b[0] - a[0], b[1] - a[1]
            length = math.hypot(dx, dz)
            if length < 1e-8:
                continue
            normal = (dz / length, 0, -dx / length)
            lo_a = (a[0], base, a[1])
            lo_b = (b[0], base, b[1])
            hi_a = (a[0], top, a[1])
            hi_b = (b[0], top, b[1])
            triangle(target, lo_a, lo_b, hi_b, normal)
            triangle(target, lo_a, hi_b, hi_a, normal)


def make_glb(floors, output):
    materials, material_index = [], {}
    buffer_views, accessors, meshes, nodes = [], [], [], []
    binary = bytearray()
    root_nodes = []
    for index, floor in floors:
        floor_children = []
        batches = {kind: [] for kind in COLORS}
        for feat in floor["geometry"]:
            kind = KINDS[feat[1]]
            if kind in batches:
                add_feature(batches[kind], feat, index)
        for kind, floats in batches.items():
            if not floats:
                continue
            if kind not in material_index:
                material_index[kind] = len(materials)
                materials.append({
                    "name": kind,
                    "pbrMetallicRoughness": {
                        "baseColorFactor": list(COLORS[kind]),
                        "metallicFactor": 0.04, "roughnessFactor": 0.86,
                    },
                    "alphaMode": "BLEND", "doubleSided": True,
                })
            offset = len(binary)
            binary.extend(struct.pack("<" + "f" * len(floats), *floats))
            view_id = len(buffer_views)
            buffer_views.append({"buffer": 0, "byteOffset": offset,
                                 "byteLength": len(floats) * 4,
                                 "byteStride": 24, "target": 34962})
            positions = [floats[i:i+3] for i in range(0, len(floats), 6)]
            minimum = [min(p[a] for p in positions) for a in range(3)]
            maximum = [max(p[a] for p in positions) for a in range(3)]
            a_id = len(accessors)
            accessors += [
                {"bufferView": view_id, "byteOffset": 0, "componentType": 5126,
                 "count": len(positions), "type": "VEC3", "min": minimum,
                 "max": maximum},
                {"bufferView": view_id, "byteOffset": 12, "componentType": 5126,
                 "count": len(positions), "type": "VEC3"},
            ]
            mesh_id = len(meshes)
            meshes.append({"name": f'{floor["id"]}/{kind}',
                           "primitives": [{"attributes": {"POSITION": a_id,
                                                         "NORMAL": a_id + 1},
                                           "material": material_index[kind],
                                           "mode": 4}]})
            floor_children.append(len(nodes))
            nodes.append({"name": f'{floor["id"]}/{kind}', "mesh": mesh_id})
        root_nodes.append(len(nodes))
        nodes.append({"name": floor["id"], "children": floor_children,
                      "extras": {"source": floor["source"], "surveyed": False,
                                 "floorHeightMetersVerified": False}})
    doc = {
        "asset": {"version": "2.0", "generator": "RetailNav polygon extrusion",
                  "extras": {"survey": False,
                             "physicalNavigationApproved": False}},
        "scene": 0, "scenes": [{"nodes": root_nodes}],
        "nodes": nodes, "meshes": meshes, "materials": materials,
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": buffer_views, "accessors": accessors,
    }
    js = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    js += b" " * ((-len(js)) % 4)
    binary += b"\x00" * ((-len(binary)) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    payload = (struct.pack("<III", 0x46546c67, 2, total) +
               struct.pack("<II", len(js), 0x4e4f534a) + js +
               struct.pack("<II", len(binary), 0x004e4942) + binary)
    output.write_bytes(payload)
    print(f"{output.name}: {len(payload):,} bytes, {len(meshes)} grouped meshes")


def main():
    floors = read_floors()
    for index, floor in floors:
        make_glb([(index, floor)], MAPS / f'Aventura-{floor["id"]}.glb')
    make_glb(floors, MAPS / "Aventura-ALL.glb")


if __name__ == "__main__":
    main()
