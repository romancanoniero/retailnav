# RetailNav — importar planos de cualquier shopping

## Lectura y control obligatorios antes de empezar

Este documento es el procedimiento canónico de toda alta o migración de mapas.
Antes de tocar datos hay que leer también `docs/RETAILNAV-PLAN-MAESTRO-E2E.md`
(sección 0 y MAP-01..MAP-17) y `docs/STORE-SEARCH-POSITIONING-E2E.md`.
El archivo `AGENTS.md` de la raíz del repositorio convierte esta lectura y los
controles siguientes en requisitos de cada tarea futura.

Orden de preferencia de fuentes: geometría vectorial oficial; PDF vectorial;
imagen raster oficial de resolución completa; fotografía rectificada. Si un
SVG/PDF ya contiene contornos de locales, hay que extraerlos en sus coordenadas
nativas. Está prohibido descartarlos y publicar rectángulos, losas o envolventes
de sustitución.

La primera entrega revisable siempre es 2D y por planta: fuente original,
contornos extraídos y códigos reales o posiciones oficiales superpuestos. Hay
que inspeccionar todas las plantas antes de generar el 3D y repetir la revisión
en el visor final. La compilación debe fallar si detecta geometría de relleno,
una cantidad trivial de regiones o una planta sin comparación visual.

Un registro comercial sólo se enlaza a `polygonId` cuando la fuente da el ID
explícito o cuando su punto revisado cae inequívocamente dentro de un único
contorno. **Nunca se asigna por cercanía.** Un código sin contorno conserva su
nombre, planta y coordenada oficial; un contorno sin código permanece visible
como región sin identificar.

Cada contorno físico de tipo local o ancla también genera una fila independiente
en `public/catalog/malls/<mallId>/spaces.json`. Su `spaceId` canónico es
`<mallId>:space:<floor>:<polygonId>` y no depende del nombre, la marca, el código
comercial ni el ocupante actual. Un recinto sin comercio identificado conserva
`identityStatus: unidentified` y `navigationDestination: true`; cuando se
complete su ficha sólo cambia la relación `storeIds`, nunca el `spaceId`.

### Identidad, marcas, tipografía y etiquetas comerciales

Antes de escribir el importador se deben inspeccionar el HTML, CSS, manifiesto
de red y directorio oficial. El inventario obligatorio incluye el logomark del
shopping, logos publicados por cada comercio, paleta, familias tipográficas,
categorías y cualquier vocabulario de búsqueda. Cada asset conserva bytes
originales, URL, MIME real, dimensiones, SHA-256 y estado de licencia. Una URL
oficial rota queda registrada como no disponible; no se reemplaza por una marca
parecida ni se reconstruye.

Las categorías publicadas se normalizan mediante una tabla mall-específica y
trazable. Cada registro debe conservar la categoría original, sus etiquetas y
la evidencia. Las etiquetas de categoría sirven para buscar; no prueban stock,
servicios vigentes ni productos concretos de la marca. Si el directorio publica
categorías y el CSV termina con `tags` vacías, la importación debe fallar.

### Contrato obligatorio de datos por local

Importar un mapa incluye importar su directorio comercial completo. Antes de
programar la extracción se arma una matriz con **todos los campos que publica la
fuente oficial**, aunque alguno todavía no tenga equivalente visual. Por cada
local se deben conservar, cuando existan:

- ID y código oficial, nombre, planta y estado del local;
- categoría original, tags normalizadas, sinónimos y conceptos semánticos con evidencia;
- URL y archivo del logo oficial, MIME, dimensiones, SHA-256, licencia/estado;
- descripción, teléfonos, web, redes, horarios, servicios y accesibilidad;
- coordenadas o marcador oficial, `polygonId` sólo con evidencia válida y estado de enlace;
- URL/archivo fuente, fecha de extracción y motivo explícito de cualquier dato ausente o inválido.

No encontrar un dato en la fuente se representa como ausencia trazable; no se
rellena por intuición. Encontrarlo y no importarlo es un error de importación.
Un asset oficial roto conserva su URL, el error observado y el estado
`invalid`/`unavailable`; nunca se reemplaza por otro logo inventado.

Cada mall debe generar o incorporar a su prueba específica un informe de
completitud por campo con los conteos `published`, `imported`, `missing` e
`invalid`, más los IDs afectados. El build/publicación se rechaza si:

- `missing > 0` para un campo disponible en la fuente oficial;
- una categoría publicada produce `tags` vacías o conceptos sin evidencia;
- un logo válido y disponible no fue archivado o no coincide con su hash;
- una ausencia o referencia rota carece de motivo y procedencia;
- el catálogo perdió datos que estaban presentes en una importación anterior.

Los rótulos 3D se generan desde contornos de una fuente identificada, permitida
y archivada: se aplanan curvas con resolución declarada, se triangulan caras y
se extruyen laterales. Queda prohibido convertir letras rasterizadas en bloques,
agrandar bitmaps o usar una textura plana como si fuera texto 3D vectorial. Si
la fuente propietaria no puede redistribuirse, se usa otra fuente licenciada que
la fuente oficial también emplee y se documenta la limitación.

Cada local vinculado debe llevar su **nombre comercial como malla tipográfica
vectorial extruida sobre el techo** y, cuando exista un segmento de fachada,
una segunda versión menor, también vectorial y extruida, sobre ese frente. El
nombre es el rótulo principal y puede dividirse en líneas para conservar tamaño;
el código de local queda subordinado. El rótulo superior sólo se omite cuando
el registro declara una imagen o textura de techo explícita (`roofImageURL`,
`roofTextureURL` o el equivalente dentro de `roof`). `logoURL` identifica la
marca para fichas y resultados: nunca se interpreta como imagen de techo y no
puede ocultar el nombre. Una imagen de techo conserva el rótulo menor de
fachada. La prueba del mall debe contar nombres de techo, nombres de frente y
supresiones por imagen, y rechazar cualquier local vinculado que pierda ambos.

### Lista mínima antes de publicar

- fuente, URL, fecha, hash, dimensiones y transformación preservados;
- IDs estables por planta y contorno, sin regenerarlos por cambios de etiquetas;
- una fila `spaceId` única por cada local físico, incluidos los no identificados, todos conservados como destinos;
- comparación 2D de cada planta revisada con contornos y códigos visibles;
- ningún contorno nativo sustituido por losas sintéticas;
- enlaces tienda-polígono con evidencia explícita o contención única;
- registros no vinculados conservados y cuantificados;
- matriz completa de campos oficiales revisada por local, sin descarte silencioso;
- logos y fuente con manifiesto de hashes, faltantes oficiales documentados;
- categorías originales, etiquetas no vacías y conceptos trazables para cada categoría publicada;
- descripción, contacto, web/redes, horarios, servicios y accesibilidad preservados cuando la fuente los publique;
- informe `published/imported/missing/invalid` aprobado y regresión contra pérdida de datos;
- rótulos 3D verificados como contornos vectoriales extruidos, sin píxeles;
- nombre vectorial principal en cada techo vinculado sin imagen de techo, nombre menor en cada fachada disponible y supresiones explícitas auditadas;
- mapa abierto en navegador real en vistas 2D, 3D, planta individual y todas;
- prueba mall-específica y barrera de despliegue contra regresiones;
- limitaciones, validaciones y despliegue registrados en el plan maestro.

## AP Plaza (Shanghai)

Primer caso: el plano B1 fotografiado en AP Plaza y rectificado desde la foto aportada el 13/10/2026. La extracción detectó 190 contornos provisionales tras separar líneas negras internas y cinco nombres reconocibles (TOYcPLAY, KFC, Starbucks, McDonald's, 7-Eleven). Son regiones coloreadas, NO 190 locales individualmente certificados.

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
  --size 1440x620 --min-area 28 --out /tmp/ap-provisional
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

## Vista previa de recorridos en una planta

Que el usuario y el local estén en la misma planta no demuestra por sí solo que exista un camino transitable. Toda importación debe declarar una de estas dos fuentes antes de ofrecer el botón de recorrido:

- una red de pasillos y accesos a locales aportada por la fuente, con segmentos y terminales trazables; o
- para un SVG oficial que contenga el perímetro completo de la planta y los contornos individuales de los locales, `sameFloorRoutingPreview` con `schema: retailnav.same-floor-routing-preview.v1`, `routingVerified: false` y `sourceGeometry: official-svg-floor-minus-units`.

La segunda opción sólo dibuja una vista previa punteada por el espacio libre del SVG, termina fuera del local y debe seguir presentándose como provisional. No habilita instrucciones verificadas, no cambia `navigable:false` y no puede unir plantas. Escaleras mecánicas, ascensores, escaleras y rampas se incorporan únicamente con sus desembarcos y correspondencias de planta verificados.

Pruebas: `node --test scripts/test-demo-model.mjs`, `python3 scripts/build-web.py`, `python3 scripts/verify.py public`.

Demo AP Plaza: https://improvingyourreality.com/retailnav/?mall=ap-plaza


## Identificación de tiendas impresa en la fotografía

El importador ya no desecha los códigos de los locales. Cuando está instalado Tesseract
y el módulo opcional Python `pytesseract`, intenta reconocer automáticamente códigos
como `A-01`, `K1-31` o `J-02`. Se escriben a `B1-unit-codes.csv`
junto a su coordenada y su fuente `ocr-unreviewed`. Estos datos deben revisarse;
la fotografía de AP Plaza no permite reconocer de forma automática todos los textos.

Los identificadores revisados por una persona se pueden suministrar de forma
acumulativa por cada planta mediante `--unit-codes códigos.json`:

```json
{"B1":[{"code":"A-01","name":"TOYcPLAY","x":215,"y":118},
       {"code":"K1-31","x":1110,"y":100}]}
```

Esos códigos se exportan independientemente de los polígonos y siempre se pueden
buscar en RetailNav. Sólo se asocian al `polygonId` si el texto está contenido
sin ambigüedad en un único contorno. Nunca se asignan por proximidad.

En AP Plaza se transcribieron manualmente 75 códigos de local y cinco nombres de
comercios conocidos. No se les asignan puertas, contratos ni ubicaciones
certificadas sin confirmación.

## Pines 3D, GPS y sensores

Los amigos ficticios se dibujan con una **malla WebGL 3D real**, fija en el
sistema de coordenadas del shopping. El cuerpo tiene laterales y reverso,
aro circular blanco con profundidad y fotografía aplicada sobre el disco frontal.
La vista cambia al rotar el plano. En navegadores sin WebGL permanece el
renderizador Canvas de respaldo (2D).

El control `Mi ubicación` requiere permiso explícito. GPS sólo detecta
proximidad al shopping; el usuario debe indicar un punto en el mapa para fijar
su posición interior. La brújula se orienta con una alineación manual hacia
arriba del plano. El acelerómetro estima pasos **sólo** si además se dispone
de una escala medida del plano, con creciente incertidumbre y detención
tras un tramo breve. Los datos no se guardan ni transmiten al servidor.
Sin estas calibraciones no se presentará un punto interior supuestamente exacto.

Los servicios se guardan en `pois`: baños, información, metro, salidas,
ascensor y conexiones verticales tentativas. Todos conservan `confidence`
y algunas posiciones permanecen pendientes de inspección.


## Nueva extracción revisable de divisiones y servicios

El vectorizador separa las regiones de color de las líneas negras potencialmente
divisorias. En cada ejecución produce:
- B1-wall-candidates.json: trazos candidatos, TODOS sin verificar
- B1-wall-review.jpg: comparación visual sobre la fotografía de la planta
- vectorization-review.json: informe de polígonos, identificadores, zonas, servicios y dudas

Estos trazos incluyen ocasionalmente letras y logos. Por ello NO se convierten
automáticamente en muros ni en rutas: se exige validación visual de cada línea.
Se pueden incorporar paredes aprobadas mediante --reviewed-walls con un JSON
indexado por planta; cada línea debe tener puntos a y b, y verified: true.

Para conservar el resto de información del plano:
- --unit-codes: códigos y nombres de comercios vinculados a posiciones
- --districts: nombres de zonas independientes de los locales (rótulos 3D)
- --pois: baños, escaleras, ascensores, accesos, metro e información
- --wall-min-length: longitud mínima de candidatos a divisiones

IMPORTANTE: un polígono de color no equivale necesariamente a un local.
Ninguna región se considera exacta ni navegable sin revisar la fuente.
Si los códigos o las divisiones son demasiado pequeños para leerse en la foto,
hay que obtener una imagen más cercana o un plano digital de mayor resolución.

Los pines de usuarios tienen otra responsabilidad: se dimensionan por el zoom
desde src/pins-webgl.js, respetan una altura física máxima y no atraviesan
los rótulos suspendidos del mapa. Eso corresponde a visualización, no a la
vectorización que extrae los datos arquitectónicos.


## Auditoría automática asistida por escala de grises y blanco/negro

La importación nueva usa **tres observaciones de la MISMA fotografía registrada**:

- Color HSV: preserva superficies de zonas comerciales y cambios cromáticos.
- Escala de grises con **CLAHE**: recupera contraste local de trazos oscuros.
- Blanco/negro con **umbral adaptativo gaussiano**: detecta posibles separaciones
  con sombras y luz desigual. La coincidencia con trazos oscuros se exige como
  evidencia adicional antes de considerar una línea candidata.

Ejemplo (requiere OpenCV y NumPy):

\`\`\`sh
python3 scripts/floorplan_vectorizer.py \
  --mall nuevo-shopping --name "Nuevo Shopping" \
  --floor B1=/ruta/planta-original.jpg --out data/malls/nuevo-shopping \
  --segmentation hybrid --wall-min-length 14 \
  --unit-codes codes.json --districts zones.json --pois amenities.json
\`\`\`

Para comparar el algoritmo previo, usar \`--segmentation color\`. La variante
híbrida es la predeterminada. El importador guarda, por cada planta:

- \`B1-grayscale-contrast.jpg\`, \`B1-adaptive-bw.png\` y
  \`B1-confirmed-strokes.png\`, para inspeccionar **qué vio** el análisis.
- \`B1-wall-candidates.json\`: cada línea tiene soporte del umbral binario,
  contraste local y color a ambos lados, junto a una puntuación **provisional**.
- \`B1-alignment-review.json\` y \`B1-alignment-review.jpg\`: cotejo de
  contornos vectorizados contra bordes del plano, con regiones sospechosas.
- \`B1.reference.webp.b64.part00\` (y partes siguientes, si hace falta):
  imagen registrada para comparar dentro de la web; por ser una vista previa
  comprimida **no autoriza la aprobación definitiva**.
- \`vectorization-review.json\`: síntesis de discrepancias y garantía de que
  la planta permanece en estado no navegable hasta revisión.

**Importante:** una coincidencia con líneas negras no prueba que exista
una pared ni demuestra que los locales sean correctos. Letras, logotipos,
sombras y bordes mal rectificados pueden producir falsos positivos. Ningún
hallazgo se promueve automáticamente a \`verified: true\`.

### Verificación en la web

El botón de comparación abre la foto y los polígonos de cada planta. El
estilo predeterminado son rellenos negros al 40 %, contorno blanco de 2 px
a opacidad completa, o **solo contorno**, zoom hasta 800 % y códigos
transcritos opcionales. Marcar anomalía permite elegir tipo, coordenadas,
polígono aproximado y descripción. Los datos se guardan localmente en el
navegador, vinculados a la versión geométrica; no se envían al servidor.
\`Exportar informe JSON\` sirve para entregar las observaciones a un revisor.
Una planta no se certifica por el mero hecho de haber ejecutado el proceso.


## AP Plaza B1 v3: curvas, fotografía íntegra e IA opcional

La versión **B1.geometry.v3.zlib.b64** se reconstruyó contra una
fotografía rectificada de **1440 × 620** píxeles, no contra la vista
reducida de 400 × 172. Conserva 190 identificadores de región y sus
códigos impresos; pasa de 968 a 2023 vértices para reproducir curvas
mediante segmentos más finos en WebGL.

**Diez regiones** no superaron la comprobación de coincidencia con los
píxeles y mantienen su contorno anterior. Permanecen sin aprobar:
\`vectorizado-provisional\` y \`navigable: false\`. El archivo
\`B1.curves-v3-review.json\` identifica cada propuesta o anomalía.
\`floorReferences.B1\` registra la fotografía de 1440 × 620 para la
comparación negro/blanco con zoom hasta 800 %.

### Importación con curvas reales de plano

\`scripts/floorplan_vectorizer.py\` utiliza ahora
**1,25 píxeles de desviación máxima de contorno**, no el antiguo 3,1 %
del perímetro, que aplanaba fachadas curvas y arcos cortos.
El parámetro \`--simplify\` acepta de 0,4 a 4 píxeles.
El módulo triangula polígonos cóncavos mediante Shapely y **nunca**
los sustituye por envolventes convexas ficticias.

Ejemplo de importación:

\`\`\`sh
python3 scripts/floorplan_vectorizer.py \
  --mall nuevo-shopping --name "Nuevo Shopping" \
  --floor B1=/ruta/plano.png --out data/malls/nuevo-shopping \
  --segmentation hybrid --simplify 1.25
\`\`\`

Para refinar geometría ya existente **sin cambiar sus identificadores**
ni sus nombres, usar \`scripts/refine_curved_floor.py\` con argumentos
\`--source\`, \`--geometry\`, \`--output\`, \`--report\` y \`--preview\`.
Compara la forma propuesta contra el original mediante IoU y relación
de áreas; las formas dudosas se conservan intactas y se reportan.

Requiere \`numpy\`, \`opencv-python-headless\` y \`shapely>=2.1\`.

### IA visual incorporada (opt-in; no ejecutada en AP Plaza)

Con \`--ai-review\`, el importador envía sectores ampliados y
superpuestos del plano a un modelo de visión que propone divisiones,
curvas, códigos y servicios. Ninguna propuesta modifica la geometría
automáticamente: se exporta a \`B1-ai-suggestions.json\` con
\`verified: false\` y requiere revisión humana.

**Costos y privacidad:** es necesario configurar \`OPENAI_API_KEY\`.
La opción envía imágenes de la planta a la API de OpenAI y puede incurrir
en cargos. SIN esa opción, ni el importador ni CI realizan llamadas de IA.

\`\`\`sh
export OPENAI_API_KEY="TU_CLAVE_EN_ENTORNO_SEGURO"
python3 scripts/floorplan_vectorizer.py \
  --mall nuevo-shopping --name "Nuevo Shopping" \
  --floor B1=/ruta/plano.png --out data/malls/nuevo-shopping \
  --segmentation hybrid --simplify 1.25 \
  --ai-review --ai-model gpt-4.1-mini --ai-max-tiles 12
\`\`\`

Como no se configuró ninguna clave en el entorno usado para AP Plaza,
la nueva geometría fue generada por visión geométrica OpenCV +
triangulación robusta, **no** por un modelo generativo remoto. La
validación arquitectónica sigue pendiente.
