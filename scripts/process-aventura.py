#!/usr/bin/env python3
"""Reference-only processing: no claim of surveyed inter-floor alignment."""
from pathlib import Path
import json
from itertools import combinations
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

root = Path("research-output/aventura")
diagnostics = root / "diagnostics.json"
if not diagnostics.exists():
    print("No diagnostics created; capture script did not complete")
    raise SystemExit(0)

data = json.loads(diagnostics.read_text())
captures = [item for item in data.get("captures", []) if (root / item["filename"]).exists()]
if len(captures) < 2:
    print("No two confirmed floor images; cannot overlay.")
    raise SystemExit(0)

font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
font = ImageFont.truetype(font_path, 42) if Path(font_path).exists() else ImageFont.load_default()
small = ImageFont.truetype(font_path, 23) if Path(font_path).exists() else font

def image(item):
    return np.array(Image.open(root / item["filename"]).convert("RGB"))

def contours(rgb):
    """Broad exploratory image edges, NOT validated elevator shafts."""
    # Source canvas and label overlays have no special exemption here: this
    # output is only for manual visual comparison; inspect the originals.
    grey = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    blur = cv2.GaussianBlur(grey, (7, 7), 0)
    edge = cv2.Canny(blur, 75, 165)
    edge = cv2.dilate(edge, np.ones((3,3), np.uint8), iterations=1)
    return edge.astype(bool)

metrics = []
for a,b in zip(captures,captures[1:]):
    im1,im2 = image(a),image(b)
    if im1.shape != im2.shape:
        metrics.append({"floors":[a["name"],b["name"]],"error":"Screenshots have different dimensions; invalid comparison"})
        continue
    h,w,_ = im1.shape
    grey1=cv2.cvtColor(im1,cv2.COLOR_RGB2GRAY)
    grey2=cv2.cvtColor(im2,cv2.COLOR_RGB2GRAY)
    delta=np.max(np.abs(im1.astype("int16")-im2.astype("int16")),axis=2)
    meaningful = delta>35
    metrics.append({"floors":[a["name"],b["name"]],"imageSize":[w,h],"changedPixelPercent":round(float(meaningful.mean()*100),2),"samePixelPercent":round(float((~meaningful).mean()*100),2),"note":"Identical pixels can be shared map background; not proof of geometric alignment"})
    # Plain semi-transparent overlay to inspect matching corridor alignments.
    mixed=cv2.addWeighted(im1,0.5,im2,0.5,0)
    render=Image.fromarray(mixed)
    draw=ImageDraw.Draw(render)
    draw.rectangle((0,0,w,110),fill=(255,255,255))
    draw.text((34,17),f"Mezcla 50/50 — {a['name']} + {b['name']}",font=font,fill=(15,27,44))
    draw.text((35,73),"Solo comparación visual; núcleos verticales todavía sin verificar",font=small,fill=(75,90,105))
    name=f"mezcla-{a['index']+1}-{b['index']+1}.png"
    render.save(root/name,optimize=True)
    # Structural image-edge overlay with base yellow and upper red,
    # red visually overwrites yellow on exact-pixel correspondence.
    base=contours(im1)
    top=contours(im2)
    rendered=np.full((h,w,3),255,dtype=np.uint8)
    rendered[base]=(244,199,39)
    rendered[top]=(220,49,59)
    edgeout=Image.fromarray(rendered)
    draw=ImageDraw.Draw(edgeout)
    draw.rectangle((0,0,w,125),fill=(255,255,255))
    draw.text((34,12),f"Contornos — {a['name']} (amarillo) | {b['name']} (rojo)",font=font,fill=(15,27,44))
    draw.text((35,73),"Rojo sobre amarillo = coincidencia de píxeles, no validación arquitectónica",font=small,fill=(75,90,105))
    name=f"contornos-{a['index']+1}-{b['index']+1}.png"
    edgeout.save(root/name,optimize=True)
    print("Generated",name)
(root/"comparison-report.json").write_text(json.dumps({"captures":captures,"comparisons":metrics,"method":"Direct same-viewport RoveIQ floor switching. Camera consistency is assumed, not measured. No automatically identified elevator or escalator points."},indent=2))
print("Comparison metrics",json.dumps(metrics))
