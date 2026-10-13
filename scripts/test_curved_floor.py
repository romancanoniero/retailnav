"""Offline geometry regression: a rounded storefront is not flattened."""
import base64
import json
import tempfile
import zlib
from pathlib import Path

import cv2
import numpy as np
from shapely.geometry import Polygon

from refine_curved_floor import (triangulate_clean, as_feature, refine,
                                  decode_shape, write_geometry, read_geometry)


def demo():
    img = np.full((280, 300, 3), (250, 245, 240), np.uint8)
    cv2.ellipse(img, (145, 140), (65, 50), 0, 0, 360, (80, 180, 180), -1)
    cv2.ellipse(img, (145, 140), (65, 50), 0, 0, 360, (13, 26, 34), 2)
    rect = np.array([[83, 93], [207, 93], [207, 187], [83, 187]], dtype='int32')
    dummy = ['B1-curve-store', 1, 'Store with curved facade', [],
             [[0, 1, 2, 3]], [0, 1, 2, 0, 2, 3], [145.0, 140.0]]
    initial = as_feature(dummy, rect, [0, 1, 2, 0, 2, 3])
    result, review = refine(img, [initial])
    assert len(result) == 1
    assert result[0][0] == initial[0] and result[0][2] == initial[2]
    assert result[0][6] == initial[6]
    assert review[0]['status'] == 'refined-provisionally', review[0]
    new_vertices = len(result[0][3]) // 2
    assert new_vertices >= 12, new_vertices
    assert new_vertices > len(initial[3]) // 2
    assert review[0]['iou'] >= .65
    assert 0 < len(result[0][5]) and len(result[0][5]) % 3 == 0
    assert max(result[0][5]) < new_vertices
    assert Polygon(decode_shape(result[0])).is_valid
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / 'B1.geometry.zlib.b64'
        write_geometry(path, result)
        restored = read_geometry(path)
        assert restored == result, 'New curves must survive compact delta compression'
    # Protect concavities and avoid inventing convex outlines.
    concave = np.array([[20, 20], [100, 20], [100, 60],
                        [60, 60], [60, 100], [20, 100]], dtype='int32')
    triangulated = triangulate_clean(concave)
    assert triangulated is not None
    vertices, indices = triangulated
    assert len(vertices) == 6 and len(indices) == 12
    print('PASS: curved store preserved as textured/triangulated multi-edge geometry')


if __name__ == '__main__':
    demo()