# AP Plaza B1 — reconocimiento visual 2D y verificación fotográfica (experimental)

**Estado: PROVISIONAL / NO APTO PARA NAVEGACIÓN REAL. NO publicado.**

Este ensayo continúa el vectorizado de AP Plaza con geometrías candidatas procedentes de una **imagen de calco 2D generada visualmente**, no de un archivo SVG nativo ni de una ejecución de visión externa desde Python. El calco visual **puede inventar, desplazar u omitir paredes**. Por eso se considera una hipótesis: toda subdivisión añadida posteriormente debe encontrar tinta arquitectónica compatible en la foto de referencia *no editada*.

## Procedencia comprobable

- Fotografía rectificada: reconstruible a partir de `data/malls/ap-plaza/B1.reference.webp.b64.part00..04`, 1440 × 620 píxeles, SHA-256 WebP `8053ccfa86129533d693a05271efbe2b3bfcd3d7674fb8753bd54f914ce9e063`.
- Candidatos iniciales: `data/malls/ap-plaza/experimental/B1.ai2d.candidates.v1.zlib.b64` (191 regiones candidatas).
- Nuevos candidatos: `data/malls/ap-plaza/experimental/B1.ai2d.photo-refined.v2.zlib.b64` (197 regiones candidatas).
- Informe de los cortes: `data/malls/ap-plaza/experimental/B1.ai2d.photo-refined.v2.review.json`.
- Código de corrección: `scripts/refine_ai2d_photo_walls.py`. Únicamente evalúa costuras entre códigos anclados y evidencia de líneas del WebP ORIGINAL; no contiene modelo de visión.
- Regresión: `scripts/test_ai2d_photo_walls.py` y workflow aislado `.github/workflows/verify-ai2d-photo.yml`.

**No** se registró en el repositorio la imagen PNG de calco generado como si fuera una fotografía real; se preservó la geometría derivada para su auditoría. La procedencia del vectorizado inicial está registrada como **AI-generated image + extracción determinista**, con limitaciones explícitas.

## Resultado del experimento

| Comprobación | Calco v1 | Corrección v2 |
|---|---:|---:|
| Polígonos provisionales (no tiendas certificadas) | 191 | 197 |
| Códigos inequívocos según anclajes existentes | 22 | 31 |
| Anclajes de código preservados | 44 | 44 |
| Polígonos inválidos | 0 | 0 |
| Superposición geométrica | 0 | 0 px² |

Se proponen **6 divisiones nuevas**, en 5 regiones originales. La evidencia geométrica procede de tinta de la foto, pero ninguna división ha recibido aprobación arquitectónica manual.

Continúan **4 regiones con códigos múltiples**, incluidas subdivisiones parciales del bloque K; la revisión visual y la recuperación del PNG original de mejor calidad podrían requerir cambios. La v3 de producción ya tenía asociaciones provisionales adicionales que **NO** se deben perder reemplazándola con esta v2.

La coincidencia con bordes de la foto, incluso a distancia de 2 píxeles, **no prueba** que una línea sea una pared: logos, símbolos, letras y sombreado pueden dar falsos positivos.

## Reproducción sin modificar producción

Con Python 3.11+:

```bash
python3 -m pip install numpy opencv-python-headless "shapely>=2.1,<3"

python3 - <<'PY'
from pathlib import Path
import base64
root = Path('data/malls/ap-plaza')
parts = sorted(root.glob('B1.reference.webp.b64.part*'))
assert len(parts) == 5
photo = base64.b64decode(''.join(p.read_text().strip() for p in parts))
Path('/tmp/retailnav-ap-plaza-B1.webp').write_bytes(photo)
PY

python3 scripts/refine_ai2d_photo_walls.py \
  --photo /tmp/retailnav-ap-plaza-B1.webp \
  --input data/malls/ap-plaza/experimental/B1.ai2d.candidates.v1.zlib.b64 \
  --output /tmp/ap-plaza-ai2d-v2.geojson \
  --review /tmp/ap-plaza-ai2d-review.json

python3 -m unittest scripts/test_ai2d_photo_walls.py -v
```

Para leer un archivo `.zlib.b64` sin dependencias externas:

```python
import json, zlib, base64
from pathlib import Path
p = Path('data/malls/ap-plaza/experimental/B1.ai2d.photo-refined.v2.zlib.b64')
features = json.loads(zlib.decompress(base64.b64decode(p.read_text())))
print(len(features['features']))
```

## Barrera de publicación

- Esta rama no modifica `data/malls/ap-plaza/mall.json` ni el archivo `B1.geometry.v3.zlib.b64` que se consume en producción.
- Nunca se debe publicar una geometría porque aumentó la cantidad de polígonos o pasó pruebas de topología.
- Validar en comparador fotográfico con zoom: contornos, curvas, compartición de paredes, códigos, zonas, servicios y anomalías, con el PNG rectificado original si se consigue.
- Sólo luego generar una versión de RetailNav, ejecutar el conjunto completo de pruebas (incluido navegador móvil), revisar la publicación de `main`, desplegar y volver a probar Safari/Chromium.
- Aun después de ello, mantener el rótulo **NO APTO PARA NAVEGACIÓN REAL** hasta calibrar escala y confirmar límites arquitectónicos in situ.

**El procedimiento es técnicamente reproducible y merece seguir evaluándose; NO ha sido declarado método validado de mapeo arquitectónico.**
