"""Integration smoke for a reusable, conservative floorplan importer.

Generates a tiny plan from scratch, checks that dark shop dividers are saved
for human review, and ensures no unreviewed line gets a 'verified' flag.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

from floorplan_vectorizer import detect_wall_candidates, apply_reviewed_walls


def run():
    with tempfile.TemporaryDirectory() as dirname:
        temp = Path(dirname)
        source = temp / "sample.png"
        out = temp / "imported"
        image = np.full((180, 340, 3), 240, dtype=np.uint8)
        cv2.rectangle(image, (19, 19), (321, 158), (185, 205, 134), -1)
        cv2.rectangle(image, (19, 19), (321, 158), (15, 35, 30), 2)
        cv2.line(image, (165, 21), (165, 157), (15, 35, 30), 2)
        cv2.line(image, (21, 129), (164, 129), (15, 35, 30), 2)
        cv2.putText(image, "A-01", (45, 95), cv2.FONT_HERSHEY_SIMPLEX,
                    .55, (15, 35, 30), 1)
        cv2.putText(image, "A-02", (205, 95), cv2.FONT_HERSHEY_SIMPLEX,
                    .55, (15, 35, 30), 1)
        cv2.imwrite(str(source), image)

        lines = detect_wall_candidates(image, 14)
        assert len(lines) >= 2, "Shared shop divider must survive"
        assert all(line["verified"] is False for line in lines)
        assert any(abs(l["a"][0]-165) < 5 and abs(l["b"][0]-165) < 5
                   for l in lines), "Vertical dividing wall must be recognized"
        sample = image[:, :, 0].copy()
        segments = apply_reviewed_walls(sample, image, [
            {"a": [165, 22], "b": [165, 155], "verified": True},
            {"a": [20, 30], "b": [318, 30], "verified": False}
        ])
        assert len(segments) == 1, "Only manually approved walls may change geometry"

        names = temp / "zones.json"
        names.write_text(json.dumps({"B1": [
            {"name": "Digital City", "detail": "Electronics",
             "x": 95, "y": 42, "widthPx": 110, "heightPx": 25}]}))
        services = temp / "pois.json"
        services.write_text(json.dumps({"B1": [
            {"id": "B1-toilet", "category": "toilet", "name": "Toilets",
             "x": 24, "y": 149, "confidence": "manual"}
        ]}))
        approved = temp / "walls.json"
        approved.write_text(json.dumps({"B1": [
            {"a": [165, 22], "b": [165, 155], "verified": True}
        ]}))
        cmd = [
            sys.executable,
            str(Path(__file__).with_name("floorplan_vectorizer.py")),
            "--mall", "test-mall", "--name", "Test Mall",
            "--floor", "B1="+str(source), "--out", str(out),
            "--districts", str(names), "--pois", str(services),
            "--reviewed-walls", str(approved), "--disable-ocr"
        ]
        completed = subprocess.run(cmd, capture_output=True, text=True)
        if completed.returncode:
            raise AssertionError("Vectorizer integration failed:\n" +
                                 completed.stdout + "\n" + completed.stderr)
        manifest = json.loads((out / "mall.json").read_text())
        report = json.loads((out / "vectorization-review.json").read_text())
        review = json.loads((out / "B1-wall-candidates.json").read_text())
        assert len(manifest["floors"]) == 1
        assert manifest["floors"][0]["unverifiedLineCount"] >= 2
        assert manifest["floors"][0]["reviewedWallCount"] == 1
        assert manifest["districts"][0]["name"] == "Digital City"
        assert manifest["pois"][0]["category"] == "toilet"
        assert review["status"] == "unreviewed"
        assert all(not line["verified"] for line in review["candidates"])
        assert report["state"] == "needs-human-verification"
        assert report["floors"][0]["exactPerStoreGeometryVerified"] is False
        for name in ["B1-preview.jpg", "B1-wall-review.jpg",
                     "B1-districts-preview.jpg", "B1.geometry.zlib.b64"]:
            assert (out / name).exists(), name
        print("PASS: floor boundaries, services, district names and unverified linework")


if __name__ == "__main__":
    run()
