#!/usr/bin/env python3
"""Regression for uncompromised AI2D visual geometry in RetailNav renderer."""
import base64
import copy
import json
from pathlib import Path
import sys
import unittest
import zlib

from shapely.geometry import Polygon
from shapely.ops import unary_union

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
from convert_ai2d_retailnav import convert, read_geojson


class AI2DGeometry(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture=ROOT/"data/malls/ap-plaza/experimental/B1.ai2d.photo-refined.v2.zlib.b64"
        cls.data=read_geojson(cls.fixture)
        cls.output=ROOT/"data/malls/ap-plaza/B1.geometry.ai2d.v2.zlib.b64"

    def test_valid_concave_geometry_triangles(self):
        entries,report=convert(self.data)
        self.assertEqual(len(entries),197)
        self.assertEqual(report["vertices"],2119)
        self.assertEqual(report["triangles"],1725)
        self.assertEqual(report["codes"],31)
        self.assertEqual(report["overlapPx2"],0)
        self.assertFalse(report["navigationApproved"])
        polygons=[]
        for fid,kind,label,deltas,rings,triangles,center in entries:
            x=y=0;points=[]
            for dx,dy in zip(deltas[::2],deltas[1::2]):
                x+=dx;y+=dy;points.append((x/2,y/2))
            polygon=Polygon(points)
            self.assertTrue(polygon.is_valid,fid)
            self.assertTrue(0<=center[0]<=1440 and 0<=center[1]<=620)
            self.assertEqual(len(triangles)%3,0)
            self.assertLess(max(triangles),len(points))
            triangle_area=0
            for i in range(0,len(triangles),3):
                triangle=Polygon([points[j] for j in triangles[i:i+3]])
                self.assertTrue(polygon.buffer(.001).covers(triangle),fid)
                triangle_area+=triangle.area
            self.assertAlmostEqual(triangle_area,polygon.area,delta=.1,msg=fid)
            polygons.append(polygon)
        self.assertLess(sum(p.area for p in polygons)-unary_union(polygons).area,.01)

    def test_stored_mesh_exactly_reproducible(self):
        entries,_=convert(self.data)
        expected=json.loads(zlib.decompress(base64.b64decode(self.output.read_text().strip())))
        self.assertEqual(entries,expected)

    def test_photo_reference_mismatch_is_rejected(self):
        changed=copy.deepcopy(self.data)
        changed["metadata"]["photoSHA256"]="not-original"
        with self.assertRaisesRegex(ValueError,"exact B1"):
            convert(changed)

    def test_self_intersection_is_never_silently_repaired(self):
        changed=copy.deepcopy(self.data)
        changed["features"][0]["geometry"]={
            "type":"Polygon","coordinates":[[
                [10,10],[50,50],[50,10],[10,50],[10,10]]]
        }
        with self.assertRaisesRegex(ValueError,"Invalid polygon"):
            convert(changed)

    def test_ids_unique_and_source_not_replaced(self):
        rows=self.data["features"]
        self.assertEqual(len({f["properties"]["id"] for f in rows}),197)
        self.assertEqual(len([f for f in rows if f["properties"].get("storeCode")]),31)
        self.assertEqual(self.data["metadata"]["status"],
                         "PROVISIONAL-NOT-APPROVED-FOR-NAVIGATION")


if __name__=="__main__":
    unittest.main()
