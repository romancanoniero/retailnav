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

from floorplan_vectorizer import (detect_wall_candidates, apply_reviewed_walls,
                                  grayscale_evidence, extract,
                                  audit_boundary_alignment)


def run():
    with tempfile.TemporaryDirectory() as dirname:
        temp = Path(dirname)
        source = temp / "sample.png"
        out = temp / "imported"
        image = np.full((180, 340, 3), 240, dtype=np.uint8)
        cv2.rectangle(image, (19, 19), (321, 158), (185, 205, 134), -1)
        cv2.rectangle(image, (19, 19), (321, 158), (15, 35, 30), 2)
        cv2.line(image, (165, 18), (165, 159), (15, 35, 30), 4)
        cv2.line(image, (19, 129), (166, 129), (15, 35, 30), 4)
        cv2.putText(image, "A-01", (45, 95), cv2.FONT_HERSHEY_SIMPLEX,
                    .55, (15, 35, 30), 1)
        cv2.putText(image, "A-02", (205, 95), cv2.FONT_HERSHEY_SIMPLEX,
                    .55, (15, 35, 30), 1)
        cv2.imwrite(str(source), image)

        evidence=grayscale_evidence(image)
        assert evidence["gray"].shape == (180,340)
        assert evidence["enhanced"].shape == (180,340)
        assert evidence["binary"].shape == (180,340)
        assert evidence["binary"].dtype == np.uint8
        assert np.count_nonzero(evidence["supported"]) > 100
        lines = detect_wall_candidates(image, 14, evidence)
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

        hybrid=extract(image,"B1",reviewed_walls=[
            {"a":[165,22],"b":[165,155],"verified":True}
        ],mode="hybrid",evidence=evidence)
        assert len(hybrid)>=3, "Segmentation must recognize at least three cells"
        audit=audit_boundary_alignment(image,hybrid,evidence)
        assert audit["sampledPolygonCount"]>=3
        assert audit["reviewRequired"] and not audit["verified"]
        assert 0<=audit["averageBoundarySupport"]<=1
        # Simulate a shadow gradient over a faded, grayscale-only map.
        mono=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)
        illumination=np.linspace(5,57,340,dtype=np.uint8)
        dark=np.clip(mono.astype(np.int16)-illumination[None,:],0,255).astype("uint8")
        uneven=cv2.cvtColor(dark,cv2.COLOR_GRAY2BGR)
        grayEvidence=grayscale_evidence(uneven)
        monochrome=detect_wall_candidates(uneven,14,grayEvidence)
        assert len(monochrome)>=1, "Gray/BW path must survive uneven lighting"
        assert all(not x["verified"] for x in monochrome)
        assert all(x["source"]=="adaptive-grayscale+color" for x in monochrome)
        assert all("adaptiveBW" in x["evidence"] for x in monochrome)

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
        assert review["method"]=="original-colour+CLAHE-grayscale+adaptive-BW"
        assert "confidence" in review["candidates"][0]
        assert len(review["candidates"])>=2
        aligned=json.loads((out / "B1-alignment-review.json").read_text())
        assert aligned["reviewRequired"] is True
        assert aligned["verified"] is False
        assert aligned["sampledPolygonCount"] >= 3
        assert report["floors"][0]["grayscaleAnalysis"] is True
        assert report["floors"][0]["adaptiveBinarization"] is True
        assert report["floors"][0]["segmentationMethod"]=="hybrid"
        assert report["floors"][0]["automaticChecksPassed"] is False
        reference=manifest["floorReferences"]["B1"]
        assert reference["qa"]["status"]=="pending"
        assert reference["qa"]["reviewer"] is None
        assert reference["imageSize"]==[340,180]
        assert reference["rasterSize"]==[340,180]
        assert reference["quality"]=="compressed-preview"
        assert (out / "B1.reference.webp.b64.part00").exists()

        assert all(not line["verified"] for line in review["candidates"])
        assert report["state"] == "needs-human-verification"
        assert report["floors"][0]["exactPerStoreGeometryVerified"] is False
        for name in ["B1-preview.jpg", "B1-wall-review.jpg",
                     "B1-districts-preview.jpg", "B1.geometry.zlib.b64",
                     "B1-grayscale-contrast.jpg", "B1-adaptive-bw.png",
                     "B1-confirmed-strokes.png", "B1-alignment-review.jpg",
                     "B1-alignment-review.json"]:
            assert (out / name).exists(), name
        print("PASS: floor boundaries, services, district names and unverified linework")


if __name__ == "__main__":
    run()
