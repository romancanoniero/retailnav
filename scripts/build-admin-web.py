#!/usr/bin/env python3
"""Generate isolated administrative static assets and source-only 2D demo data.

Never modifies public visitor maps. The demo is local, cannot submit/publicly publish
changes and intentionally preserves the source's provisional verification status.
"""
import argparse
import base64
import json
import shutil
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build(destination):
    destination = Path(destination).resolve()
    if destination == ROOT / "public":
        raise ValueError("Admin site must not replace the visitor public directory")
    destination.mkdir(parents=True, exist_ok=True)
    for module in ("control", "mall-manager", "merchant", "map-studio"):
        folder = destination / module
        folder.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / "admin" / module / "index.html", folder / "index.html")
    demo_dir = destination / "map-studio" / "demo"
    demo_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / "admin" / "map-studio" / "demo" / "index.html", demo_dir / "index.html")
    data_dir = destination / "demo"
    data_dir.mkdir(exist_ok=True)
    catalog = []
    for mall_folder in sorted((ROOT / "data" / "malls").iterdir()):
        if not mall_folder.is_dir() or not (mall_folder / "mall.json").is_file():
            continue
        mall = json.loads((mall_folder / "mall.json").read_text(encoding="utf8"))
        mall_id = mall_folder.name
        assert mall["id"] == mall_id and not mall.get("navigable", False), mall_id
        floors = []
        for floor in mall["floors"]:
            source_file = mall_folder / floor["geometry"]
            geometry = json.loads(zlib.decompress(base64.b64decode(source_file.read_text().strip())))
            features = []
            for raw in geometry:
                assert len(raw) == 7
                x = y = 0
                points = []
                for i in range(0, len(raw[3]), 2):
                    x += raw[3][i]
                    y += raw[3][i + 1]
                    points.append([x / 2, y / 2])
                features.append({"id": str(raw[0]), "kind": int(raw[1]),
                                 "vertices": points, "source": "imported-provisional"})
            floor_dir = data_dir / "malls" / mall_id
            floor_dir.mkdir(parents=True, exist_ok=True)
            (floor_dir / (floor["id"] + ".json")).write_text(
                json.dumps({"mallId": mall_id, "floor": floor["id"],
                            "imageSize": floor["imageSize"], "features": features},
                           ensure_ascii=False, separators=(",", ":")), encoding="utf8")
            reference_parts = sorted(mall_folder.glob(floor["id"] + ".reference.webp.b64.part*"))
            if reference_parts:
                image = base64.b64decode("".join(p.read_text(encoding="ascii").strip() for p in reference_parts))
                image_dest = destination / "reference" / mall_id
                image_dest.mkdir(parents=True, exist_ok=True)
                (image_dest / (floor["id"] + ".webp")).write_bytes(image)
            floors.append({"id": floor["id"], "name": floor["name"],
                           "imageSize": floor["imageSize"],
                           "referenceUrl": "reference/" + mall_id + "/" + floor["id"] + ".webp"})
        catalog.append({"id": mall_id, "name": mall["name"], "city": mall.get("city", ""),
                        "status": mall["status"], "navigable": False, "floors": floors,
                        "warning": mall.get("warning", ""), "sourceQuality": "provisional"})
    (data_dir / "malls.json").write_text(
        json.dumps({"items": catalog}, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    print("ADMIN_STATIC_BUILD_OK: ", len(catalog), "shopping(s)",
          sum(len(x["floors"]) for x in catalog), "floor(s), output", destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    build(parser.parse_args().out)
