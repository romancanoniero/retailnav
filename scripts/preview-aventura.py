from pathlib import Path
from PIL import Image,ImageStat
import json
r=Path("research-output/aventura")
names=["aventura-planta-361","aventura-planta-362","aventura-planta-363","aventura-superposicion-ll-ul","aventura-superposicion-ul-l3","aventura-superposicion-tres-plantas"]
checks=[]
for name in names:
    path=r/(name+".png")
    with Image.open(path) as pic:
        assert pic.size==(5400,3400),(name,pic.size)
        thumb=pic.convert("RGB")
        thumb.thumbnail((1000,1200),Image.Resampling.LANCZOS)
        preview=r/(name+"-vista.webp")
        thumb.save(preview,format="WEBP",quality=76,method=6)
        stat=ImageStat.Stat(thumb)
        nonwhite=sum(1 for pixel in thumb.resize((100,120)).getdata() if max(pixel)-min(pixel)>17 or min(pixel)<230)
        checks.append({"name":name,"size":list(pic.size),"preview":preview.name,"previewSize":list(thumb.size),
                       "previewBytes":preview.stat().st_size,"nonwhitePercent":round(nonwhite/12000*100,2),
                       "meanRGB":[round(c,1) for c in stat.mean]})
assert all(a["nonwhitePercent"]>3 for a in checks),checks
(r/"preview-validation.json").write_text(json.dumps(checks,indent=2))
print(json.dumps(checks,indent=2))
