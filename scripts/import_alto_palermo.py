#!/usr/bin/env python3
"""Import the official Alto Palermo maps and marker table into RetailNav.

The source table keeps the marker ID, printed local code and published marker
coordinates separate. Missing codes/positions remain empty. The SVG floor plan
is preserved as provenance and its 3x rasterization is used as the registered
reference image. Native 3D geometry is deliberately limited to floor slabs
until individual shop boundaries are reviewed.
"""
import argparse
import base64
import csv
import hashlib
import json
import shutil
import zlib
from collections import Counter
from pathlib import Path

from PIL import Image


FLOORS = (
    ("subsuelo", "SS", "Subsuelo", "subsuelo.svg", "subsuelo.png"),
    ("planta-baja", "PB", "Planta Baja", "planta_baja.svg", "planta_baja.png"),
    ("entrepiso", "EP", "Entrepiso", "entrepiso.svg", "entrepiso.png"),
    ("primer-piso", "P1", "Piso 1", "piso_1.svg", "piso_1.png"),
    ("segundo-piso", "P2", "Piso 2", "piso_2.svg", "piso_2.png"),
    ("tercer-piso", "P3", "Piso 3", "piso_3.svg", "piso_3.png"),
)
SOURCE_URL = "https://www.altopalermo.com.ar/maps_ap/index.html"
WIDTH, HEIGHT = 3537, 2352


def rectangle(identifier, x1, y1, x2, y2):
    return [identifier, 5, "", [
        2 * x1, 2 * y1,
        2 * (x2 - x1), 0,
        0, 2 * (y2 - y1),
        2 * (x1 - x2), 0,
    ], [[0, 1, 2, 3]], [0, 1, 2, 0, 2, 3],
        [(x1 + x2) / 2, (y1 + y2) / 2]]


def floor_slabs(floor_id):
    # Three disjoint slab polygons satisfy the native renderer contract without
    # claiming any unreviewed shop boundary or corridor.
    split1, split2 = WIDTH // 3, WIDTH * 2 // 3
    return [
        rectangle(f"{floor_id}-SLAB-1", 0, 0, split1, HEIGHT),
        rectangle(f"{floor_id}-SLAB-2", split1, 0, split2, HEIGHT),
        rectangle(f"{floor_id}-SLAB-3", split2, 0, WIDTH, HEIGHT),
    ]


def write_b64_parts(path, raw, chunk=500_000):
    for old in path.parent.glob(path.name + ".part*"):
        old.unlink()
    encoded = base64.b64encode(raw).decode("ascii")
    for index, start in enumerate(range(0, len(encoded), chunk)):
        (path.parent / f"{path.name}.part{index:02d}").write_text(
            encoded[start:start + chunk] + "\n", encoding="ascii")


def marker_to_reference(store):
    if not store.get("position_valid"):
        return None, None
    # Official markers use the site's 1250x540 background coordinate space.
    # The source SVG is 1179x784 and the registered reference is rasterized 3x.
    return (round(store["x"] * 1179 / 1250 * 3, 3),
            round(store["y"] * 784 / 540 * 3, 3))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-json", type=Path, required=True)
    parser.add_argument("--svg-dir", type=Path, required=True)
    parser.add_argument("--png-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    payload = json.loads(args.source_json.read_text(encoding="utf-8"))
    stores = payload["stores"]
    if payload.get("source_url") != SOURCE_URL or len(stores) != 158:
        raise ValueError("Unexpected Alto Palermo source table")
    source_ids = [str(row["id"]) for row in stores]
    if len(set(source_ids)) != len(source_ids):
        raise ValueError("Official marker IDs must be unique")

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "source-records.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    floors_manifest = []
    references = {}
    fieldnames = [
        "sourceRecordId", "code", "codeKind", "name", "category", "tags",
        "aliases", "floor", "x", "y", "positionStatus", "source",
        "nameStatus", "enrichmentURL",
    ]
    by_slug = {slug: [row for row in stores if row["floor"] == slug]
               for slug, *_ in FLOORS}

    for slug, floor_id, floor_name, svg_name, png_name in FLOORS:
        rows = by_slug[slug]
        svg_source = args.svg_dir / svg_name
        png_source = args.png_dir / png_name
        if not svg_source.is_file() or not png_source.is_file():
            raise FileNotFoundError(f"Missing official floor source: {floor_name}")
        source_svg = svg_source.read_bytes()
        (args.out / (floor_id + ".official.svg")).write_bytes(source_svg)

        with Image.open(png_source) as image:
            if image.size != (WIDTH, HEIGHT):
                raise ValueError(f"{floor_id}: expected {(WIDTH, HEIGHT)}, got {image.size}")
            converted = image.convert("RGB")
            webp_path = args.out / (floor_id + ".reference.webp")
            converted.save(webp_path, "WEBP", quality=92, method=6)
        webp = webp_path.read_bytes()
        write_b64_parts(args.out / (floor_id + ".reference.webp.b64"), webp)
        webp_path.unlink()

        geometry = floor_slabs(floor_id)
        geometry_raw = json.dumps(geometry, ensure_ascii=False,
                                  separators=(",", ":")).encode("utf-8")
        geometry_file = floor_id + ".geometry.zlib.b64"
        (args.out / geometry_file).write_text(
            base64.b64encode(zlib.compress(geometry_raw, 9)).decode("ascii") + "\n",
            encoding="ascii")

        csv_path = args.out / (floor_id + "-unit-codes.csv")
        with csv_path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fieldnames)
            writer.writeheader()
            for row in rows:
                x, y = marker_to_reference(row)
                code = row.get("local_number") or ""
                writer.writerow({
                    "sourceRecordId": row["id"],
                    "code": code,
                    "codeKind": "official-local-code" if code else "missing-in-source",
                    "name": row["name"],
                    "category": row.get("category") or "",
                    "tags": "",
                    "aliases": "",
                    "floor": floor_id,
                    "x": "" if x is None else x,
                    "y": "" if y is None else y,
                    "positionStatus": ("official-interactive-marker-centre-not-entrance"
                                       if x is not None else "missing-in-source"),
                    "source": SOURCE_URL,
                    "nameStatus": "official-interactive-map",
                    "enrichmentURL": "",
                })

        counts = {
            "directoryRecords": len(rows),
            "codedRecords": sum(bool(row.get("local_number")) for row in rows),
            "positionedRecords": sum(bool(row.get("position_valid")) for row in rows),
        }
        floors_manifest.append({
            "id": floor_id,
            "name": floor_name,
            "geometry": geometry_file,
            "imageSize": [WIDTH, HEIGHT],
            "source": f"Plano SVG oficial de Alto Palermo · {floor_name}",
            "regionCount": 3,
            "vectorizationStatus": "OFFICIAL-RASTER-REFERENCE-SLAB-ONLY",
            "geometryReviewApproved": False,
            **counts,
        })
        references[floor_id] = {
            "url": f"reference/alto-palermo/{floor_id}.webp",
            "sha256": hashlib.sha256(webp).hexdigest(),
            "imageSize": [WIDTH, HEIGHT],
            "rasterSize": [WIDTH, HEIGHT],
            "quality": "full-resolution",
            "source": f"SVG oficial {svg_name}, rasterizado a 3x sin etiquetas añadidas",
            "sourceUrl": SOURCE_URL,
            "sourceSha256": hashlib.sha256(source_svg).hexdigest(),
            "viewBox": "0 0 1179 784",
            "qa": {
                "status": "pending",
                "reviewer": None,
                "reviewedAt": None,
                "geometrySha256": None,
                "issues": [
                    "Los límites individuales de los locales no están vinculados a polígonos nativos.",
                    "Las coordenadas corresponden al centro del marcador del mapa oficial, no a una entrada.",
                    "La escala métrica, accesibilidad y rutas interiores no fueron verificadas.",
                ],
                "checks": {
                    "officialRasterPreserved": True,
                    "markerTableImported": True,
                    "individualStoreWalls": False,
                    "entrances": False,
                    "accessibility": False,
                    "metricScale": False,
                },
            },
        }

    counts = Counter(row["floor_name"] for row in stores)
    manifest = {
        "id": "alto-palermo",
        "name": "Alto Palermo",
        "city": "Buenos Aires, Argentina",
        "source": SOURCE_URL,
        "status": "vectorizado-provisional",
        "origin": [WIDTH // 2, HEIGHT // 2],
        "scale": 0.04,
        "navigable": False,
        "warning": "Mapas oficiales y directorio cargados. Las posiciones son centros de marcadores; límites de locales, entradas, escala métrica y rutas siguen pendientes de validación.",
        "floors": floors_manifest,
        "floorReferences": references,
        "floorReferencePolicy": "Los SVG oficiales se conservan como fuente. La geometría nativa contiene sólo losas hasta revisar límites de locales.",
        "officialDirectoryRecords": len(stores),
        "officialCodedRecords": sum(bool(row.get("local_number")) for row in stores),
        "officialPositionedRecords": sum(bool(row.get("position_valid")) for row in stores),
        "officialPositionedAndCodedRecords": sum(
            bool(row.get("local_number")) and bool(row.get("position_valid")) for row in stores),
        "sourceFloorCounts": dict(counts),
        "indoorPositionCalibrated": False,
        "floorPlanMetricScaleVerified": False,
        "individualStoreGeometryVerified": False,
        "numberOfPhysicalStoresVerified": False,
    }
    (args.out / "mall.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "records": len(stores),
        "floors": len(floors_manifest),
        "coded": manifest["officialCodedRecords"],
        "positioned": manifest["officialPositionedRecords"],
        "positionedAndCoded": manifest["officialPositionedAndCodedRecords"],
        "out": str(args.out),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
