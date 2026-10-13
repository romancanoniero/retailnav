#!/usr/bin/env python3
"""Offline regression tests for provisional AI2D photo-backed mall geometry."""
import base64
import hashlib
import json
import sys
import unittest
import zlib
from pathlib import Path

import cv2
import numpy as np
from shapely.geometry import Polygon, Point, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from refine_ai2d_photo_walls import (
    best_photo_division, distribute_anchors, refine_collection, wall_images
)

DATA = ROOT / "data" / "malls" / "ap-plaza"
EXPERIMENTAL = DATA / "experimental"


def read_fixture(filename):
    content = (EXPERIMENTAL / filename).read_text(encoding="utf8").strip()
    return json.loads(zlib.decompress(base64.b64decode(content)))


def reconstructed_original():
    chunks = sorted(DATA.glob("B1.reference.webp.b64.part*"))
    if len(chunks) != 5:
        raise AssertionError(f"AP Plaza reference requires 5 chunks, got {len(chunks)}")
    encoded = "".join(p.read_text(encoding="utf8").strip() for p in chunks)
    original = base64.b64decode(encoded)
    raster = cv2.imdecode(np.frombuffer(original, dtype=np.uint8), cv2.IMREAD_COLOR)
    if raster is None:
        raise AssertionError("Unable to decode original registered reference photograph")
    return original, raster


class SyntheticWallEvidence(unittest.TestCase):
    def setUp(self):
        self.poly = Polygon([(20,15),(88,15),(88,82),(20,82)])
        self.anchors = [{"code":"A-1","x":40,"y":31,"association":"inside"},
                        {"code":"A-2","x":40,"y":65,"association":"inside"}]

    def image(self, with_wall):
        im = np.full((100, 120, 3), (165,113,135), dtype=np.uint8)
        if with_wall:
            cv2.line(im, (20,46), (88,46), (18,17,18), 2)
        return im

    def test_real_dark_photo_wall_may_split(self):
        cut = best_photo_division(self.poly, self.anchors,
                                  wall_images(self.image(True)))
        self.assertIsNotNone(cut)
        self.assertEqual(len(cut["parts"]),2)
        self.assertEqual({v["code"] for group in cut["groups"] for v in group},
                         {"A-1","A-2"})
        self.assertAlmostEqual(sum(p.area for p in cut["parts"]), self.poly.area)

    def test_no_wall_means_no_division(self):
        cut = best_photo_division(self.poly, self.anchors,
                                  wall_images(self.image(False)))
        self.assertIsNone(cut)

    def test_anchor_on_shared_edge_is_not_double_assigned(self):
        p1=Polygon([(10,10),(50,10),(50,50),(10,50)])
        p2=Polygon([(10,50),(50,50),(50,90),(10,90)])
        self.assertIsNone(distribute_anchors(
            [p1,p2],[{"code":"AMB","x":30,"y":50}]))

    def test_near_edge_anchor_is_preserved(self):
        p1=Polygon([(10,10),(50,10),(50,50),(10,50)])
        p2=Polygon([(10,50),(50,50),(50,90),(10,90)])
        groups=distribute_anchors([p1,p2],[
            {"code":"A","x":30,"y":20},
            {"code":"B","x":50.7,"y":80},
        ])
        self.assertEqual([len(group) for group in groups],[1,1])


class APPlazaEvidenceRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original, cls.photo = reconstructed_original()
        cls.baseline = read_fixture("B1.ai2d.candidates.v1.zlib.b64")
        cls.snapshot = read_fixture("B1.ai2d.photo-refined.v2.zlib.b64")
        cls.report = json.loads((EXPERIMENTAL / "B1.ai2d.photo-refined.v2.review.json").read_text())

    def test_photo_registered_exactly(self):
        self.assertEqual(self.photo.shape[:2],(620,1440))
        photo_sha=hashlib.sha256(self.original).hexdigest()
        self.assertEqual(photo_sha,"8053ccfa86129533d693a05271efbe2b3bfcd3d7674fb8753bd54f914ce9e063")
        self.assertEqual(self.baseline["metadata"]["photoSHA256"],photo_sha)
        self.assertEqual(self.report["photoSHA256"],photo_sha)

    def test_baseline_and_stored_result_are_never_certified(self):
        self.assertEqual(len(self.baseline["features"]),191)
        self.assertEqual(len(self.snapshot["features"]),197)
        self.assertFalse(self.report["geometryReviewApproved"])
        self.assertFalse(self.report["publishedToContabo"])
        for f in self.snapshot["features"]:
            self.assertIn("NOT-APPROVED",f["properties"].get("status",""))

    def test_stored_polygons_valid_no_overlaps(self):
        polygons=[shape(f["geometry"]) for f in self.snapshot["features"]]
        self.assertTrue(all(p.is_valid and p.area>0 for p in polygons))
        self.assertLess(sum(p.area for p in polygons)-unary_union(polygons).area,2)

    def test_photo_backed_refinement_reproducible(self):
        sha=hashlib.sha256(self.original).hexdigest()
        current,report=refine_collection(self.baseline,self.photo,sha)
        self.assertEqual(report["sourceAnchorsBefore"],44)
        self.assertEqual(report["sourceAnchorsAfter"],44)
        self.assertEqual(report["featuresBefore"],191)
        self.assertEqual(report["featuresAfter"],197)
        self.assertEqual(report["codesAfter"],31)
        self.assertEqual(report["polygonOverlapPx2"],0.0)
        self.assertFalse(report["photographicApproved"])
        self.assertFalse(report["publishAllowed"])
        # Same images, parameters and anchors must reproduce the exact
        # sequence of geometry IDs and near-identical polygon coordinates.
        self.assertEqual([f["properties"]["id"] for f in current["features"]],
                         [f["properties"]["id"] for f in self.snapshot["features"]])
        for newer, stored in zip(current["features"],self.snapshot["features"]):
            self.assertLess(shape(newer["geometry"]).hausdorff_distance(
                            shape(stored["geometry"])),0.01)

    def test_approved_shop_count_is_not_claimed(self):
        labels={f["properties"].get("storeCode") for f in self.snapshot["features"]}
        labels.discard(None)
        self.assertEqual(len(labels),31)
        self.assertGreater(len(self.snapshot["features"]),len(labels))


if __name__=="__main__":
    unittest.main()
