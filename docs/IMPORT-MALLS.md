# RetailNav — importar planos de cualquier shopping

## AP Plaza (Shanghai)

Primer caso: el plano B1 fotografiado en AP Plaza y rectificado desde la foto aportada el 13/10/2026. La extracción detectó 61 regiones cromáticas provisionales y cinco nombres reconocibles (TOYcPLAY, KFC, Starbucks, McDonald's, 7-Eleven). Son regiones coloreadas, NO 61 locales individualmente certificados.

## Importar otros mapas

Requisitos: Python 3, opencv-python-headless y numpy.

```bash
python3 -m pip install opencv-python-headless numpy
python3 scripts/floorplan_vectorizer.py --mall mi-shopping \
  --name "Mi Shopping" --city "Buenos Aires" \
  --floor B1=imagenes/B1.jpg --floor B2=imagenes/B2.jpg \
  --out data/malls/mi-shopping
```

Para fotos inclinadas de carteles, usar también `--corners "TLx,TLy;TRx,TRy;BRx,BRy;BLx,BLy"` y `--size 1440x620`. Ejemplo reproducible de AP Plaza:

```bash
python3 scripts/floorplan_vectorizer.py --mall ap-plaza --name "AP Plaza" \
  --floor B1=imagenes/ap-plaza.jpg \
  --corners "66,235;1404,204;1448,803;35,822" \
  --size 1440x620 --min-area 175 --out /tmp/ap-provisional
```

El script genera: `mall.json` (metadatos), `B1.geometry.zlib.b64` (polígonos compactos), `B1.json` (datos editables) y `B1-preview.jpg` (imagen original con los vectores sobrepuestos). Puede repetirse `--floor` para varias plantas.

Para identificar tiendas sin inventar nombres, crear `anchors.json` con coordenadas revisadas y pasar `--labels anchors.json`. Ejemplo:

```json
{"B1":[{"name":"KFC","x":468,"y":198,"maxDistance":120}]}
```

Revisar los previews y confirmar únicamente el manifiesto y los ficheros de geometría bajo `data/malls/<slug>/`. El build de RetailNav descubre automáticamente todas las carpetas con `mall.json`, las incorpora al selector del engranaje, compila y despliega a Contabo por GitHub Actions. No hace falta tocar el visor para cada nuevo mall.

## Qué no puede inferirse de una fotografía

Los polígonos pueden englobar varios locales, las divisiones pequeñas pueden perderse y no se comprueban escala, puertas, escaleras, corredores ni rutas accesibles. Las plantas importadas tienen `navigable:false`: no son mapas operativos de seguridad o navegación real. La extracción monocromática es experimental.

El selector GPS sólo se ejecuta tras el clic y sirve para sugerir el mall cercano sin almacenar/transmitir coordenadas; no determina planta ni pasillo. El punto rojo fotografiado en AP Plaza se interpreta como una marca fija del cartel, no como seguimiento por GPS.

Los usuarios ficticios son por mall (9 en Aventura, 6 en AP Plaza). No se transfieren ubicaciones reales de un shopping a otro.

Pruebas: `node --test scripts/test-demo-model.mjs`, `python3 scripts/build-web.py`, `python3 scripts/verify.py public`.

Demo AP Plaza: https://improvingyourreality.com/retailnav/?mall=ap-plaza
