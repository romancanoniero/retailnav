# RetailNav — Comercios por mall, búsqueda incremental, plantas coincidentes y posición provisional

**Estado inicial (2026-10-15):** desarrollado en la rama `feature/store-search-floor-follow-orientation-20261015`, sujeto a comprobación de CI, aprobación y publicación. Este contrato debe mantenerse en los futuros portales de administración SaaS.

## 1. Fuente de datos y relaciones E2E

El repositorio contiene geometrías de cada planta (fotografiadas), directorios comerciales y etiquetas. **Un nombre leído en una foto, la existencia de un código y la certeza del polígono son tres pruebas distintas.** No se debe inventar una pared, un comercio o existencias comerciales solo para devolver un resultado visual.

`scripts/store_catalog.py` exporta una **tabla JSON por shopping**:

`public/catalog/malls/<mallId>/stores.json`

Las filas son registros independientes, incluso cuando dos locales tengan el mismo código en distintas plantas. Cada fila tiene:
- `mallId`: tenant; `storeId`: clave estable `mallId:floor:code`; `floor`: planta; `code`: número del directorio o referencia geométrica cuando todavía no se conoce el número real.
- `name`, `category`, `aliases`, `tags`, `productTerms`: datos para búsqueda incremental. `productsVerified` y `productEvidence`: separan un producto revisado de un nombre/rotulación que solo sugiere un tipo de mercancía.
- `polygonId`: código del vector *solo cuando se leyó o pudo vincular en el mapa de esa misma planta*; `vectorRelation`, `vectorVerified=false`: relación provisional en fase de fotos. Un vector compartido puede representar varias tiendas y no prueba sus límites exactos.
- `x`, `y`: ubicación de referencia de la imagen solo si pertenece al mismo sistema de coordenadas fotografiado; `positionStatus` describe sus límites, no se interpreta como entrada física.

El catálogo de la página incorpora exactamente las mismas filas en `mall.units` y una ficha `mall.storeCatalog` con URL, esquema, SHA-256, recuentos y versión, sin mantener una segunda lista de comercios desincronizada. El bundle con hash versionado se actualiza al modificar etiquetas o registros; las preferencias individuales del visitante no se publican por esta vía.

### Particularidades de los shoppings disponibles

- **Aventura Mall:** los planos vectorizados contienen referencias de planta y polígonos de locales/anclas. Se importan como filas con `codeKind=map-vector-reference-not-lease-number`. Se conservan nombres legibles como JCPenney o Apple, pero ninguna referencia `LL-001` debe mostrarse como si fuera un número de arrendamiento real. No hay entrada examinada y georreferenciada que pueda servir de punto del usuario.
- **AP Plaza:** directorio y región fotográfica B1, códigos del propio material; dos referencias de salida `Salida 8/7`. Son **señales de salida**, no entradas certificadas. El algoritmo puede usar una salida como **referencia provisional de acceso** perfectamente rotulada, no como prueba de que el usuario está allí.
- **New World City 上海新世界城:** nueve plantas L1-L9, directorio L1-L7, todos los registros y enlaces a polígonos candidatos cuando fueron reconocidos. No existe un punto de acceso público correctamente georreferenciado en los datos; por tanto, no se sitúa una esfera ficticia en este mall.

### Equipaje — ejemplo comprobable

El directorio fotográfico antiguo de New World City identifica **美旅箱包**, código **5A10** en **L5**, cuyo nombre sugiere maletas/equipaje. Se registró como anotación con el origen exacto de la fotografía de L5:

`data/store-products/new-world-city-shanghai.json`

Etiquetas como `equipaje`, `maletas`, `valijas`, `luggage`, `suitcases` son **asociaciones provisionales**, NO inventario certificado. **Atención:** el código 5A10 no pudo asociarse todavía a un polígono único de la imagen fotográfica de nueve plantas: su ficha permanece en la tabla con `polygonId=null` y **no aparece un vector falsamente iluminado**. La búsqueda sí abre L5 y presenta el comercio en resultados con aviso «Ubicación por verificar». La próxima revisión fotográfica debe confirmar en qué región está 5A10 para poder iluminarla.

## 2. Buscador incremental

`src/units.js` construye el vocabulario de sugerencias *exclusivamente de las etiquetas y productos disponibles del shopping activo*. La normalización admite mayúsculas y acentos (comparación insensible a diacríticos). El panel `#rnSearchSuggestions` muestra etiquetas existentes con cantidad de locales, sin publicidad ni sugerencias de categorías inexistentes.

Al tocar una sugerencia o pulsar **Enter**:
1. Buscar en todos los comercios del shopping, **no solo** en la planta actual y **sin limitar** a cuatro locales.
2. Identificar `referenceFloor` en `RetailNavIndoor`: planta comprobada, anclaje manual o referencia provisional de la planta baja/1.
3. Abrir conjuntamente el conjunto `{planta del usuario} ∪ {plantas con comercios coincidentes}`. La cámara permite seguir moviéndose, acercar y girar las plantas.
4. Iluminar **todos los polígonos realmente relacionados** con los locales encontrados; insertar indicadores del código por cada tienda con coordenadas de imagen que correspondan a esa planta. Los locales sin correspondencia permanecen en la lista, no reciben un punto inventado.
5. Presentar el número de coincidencias, las plantas abiertas y la diferencia entre dato confirmado y aproximación. La selección de un resultado puede dirigir la cámara a un comercio, sin borrar otras plantas si forman parte del mismo conjunto.
6. Al borrar o cambiar la búsqueda, limpiar resaltados de búsquedas antiguas sin modificar ni sustituir las mallas guardadas en caché.

La implementación actual: `src/units.js` (índice y sugerencias); `src/viewer.js` (conjunto de plantas visibles, mallas de colores, pines para tienda y estado), `src/unit-signs-webgl.js` (carteles sin colisiones entre códigos repetidos), `src/page.template.html` y `src/style.css`.

## 3. Planta propia y esfera de orientación

**Ningún teléfono puede detectar por GPS por sí solo en qué piso se encuentra en un interior sin datos de calibración y precisión suficientes.** Se sigue aprovechando la API de GPS/altitud cuando el navegador lo permite, con las mismas restricciones de permiso; tampoco se deduce una posición exacta del usuario a partir de la esquina de una foto.

Orden de referencias:

1. **Calibración GPS 3D realmente registrada** + altura/datum/sistema de coordenadas comprobados → planta y posición si la precisión y caducidad lo permiten.
2. Referencia **manual** colocada por el usuario o referencia compartida explícitamente por QR con consentimiento → planta del usuario declarada; no se declara GPS cierto.
3. Sin referencia interior utilizable o cuando el GPS informa que el usuario está fuera de la zona aproximada → **planta baja o 1** (si no existe, la primera planta realmente registrada, p. ej. B1 de AP Plaza). Si existe una **entrada reconocida** con datos revisados, se usa como **referencia provisional** del plano. Una señal de salida no verificada puede servir solo como hipótesis de acceso, no como entrada certificada.
4. Si NO hay un acceso con coordenadas confiables, se muestra el nombre de la planta y «sin entrada registrada». **No se inventa una esfera en una coordenada aleatoria.**

En el mapa la esfera **azul** identifica un anclaje del usuario realmente declarado o registrado; **dorado** identifica un acceso por defecto provisional. La flecha de orientación gira según la brújula del teléfono cuando recibe permiso. Mientras no se calibre el norte de la fotografía, esa flecha es solo una **referencia direccional provisional, no instrucciones de navegación**. En Safari el navegador puede pedir el permiso del sensor al usuario.

La app se inicia en la planta de referencia y cambia automáticamente si recibe una observación de planta real/manual. La búsqueda multipiso incorpora esa planta. El usuario puede seleccionar otras plantas para explorarlas sin cambiar su posición almacenada.

**Privacidad:** las coordenadas GPS y la brújula permanecen en el navegador y no forman parte de la tabla de comercios ni se transmiten al shopping.

## 4. Funciones administrativas futuras

El operador del shopping necesita un CRUD autenticado de `mall_stores`, `store_product_tags`, `store_vector_links` y `recognized_entrances` por `tenant_id` y planta. Al subir un plano:
1. Vectorizar primero en 2D, mostrar cada polígono y su código del directorio superpuesto sobre foto.
2. Asociar por revisión del operador al local correcto; rechazar duplicidades/códigos de otras plantas y señalar regiones compartidas.
3. Aprobar nombre, marca, etiquetas de producto/actividad, evidencia y fecha de vigencia de cada producto. Productos sin confirmación siguen marcados como «provisional».
4. Confirmar entrada(s) y planta(s) de acceso, con coordenadas fotográficas y en el futuro geográficas calibradas; nunca reutilizar una salida de emergencia como entrada pública.
5. Publicar transaccionalmente una nueva `catalogVersion` (idealmente separada de `mapGeometryVersion`), invalidando solo las cachés correspondientes, con rollback y auditoría.
6. Probar con el celular: autocompletado, múltiples plantas resaltadas, selección, ruta deshabilitada mientras escaleras no estén verificadas, permisos de sensores y operación offline.

## 5. QA y limitaciones explícitas

- `scripts/test-store-search-browser.mjs`: iPhone Chromium con Aventura, AP Plaza y New World City; referencia de planta, selección manual, sugerencias `equi → equipaje`, todas las coincidencias en mapa/resultados, no inventar polígono ni entrada.
- `.github/workflows/mall-store-search.yml`: valida construcción de la tabla por mall, checksums, códigos únicos por planta, integridad del enlace `polygonId` y regresiones previas de caché, posicionamiento y geometría.
- No hay información suficiente para afirmar que 5A10 sigue abierto, que tenga existencias hoy o que su posición exacta esté validada.
- Las entradas de Auckland Airport y su plano de prueba necesitan vectorización y revisión por separado: **no crear locales ni accesos aeroportuarios ficticios desde este índice de centros comerciales**.

**No fusionar ni publicar la rama sin pruebas de navegador/catálogo exitosas y controles de no regresión.**
