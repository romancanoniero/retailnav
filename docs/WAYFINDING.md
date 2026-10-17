# Orientación en el visor 3D y recorridos provisionales

El plano vectorial 3D sigue siendo la superficie de interacción. La selección de un comercio debe explicar su relación con la planta del visitante, mantener visibles los dos extremos cuando hay un origen conocido y presentar una vista desde arriba para la misma planta. El centro visual de un local sirve para identificar el destino; no es una puerta ni un punto hasta el que pueda dibujarse una ruta atravesando el local.

## Estados de la interacción

- **Misma planta, origen conocido y conexión fuente disponible:** el botón de navegación cambia de gris al color primario. Al tocarlo se muestran puntos animados sobre un recorrido provisional de la red fuente, sin abrir la tarjeta grande. El recorrido termina antes de la pared o del local; no se prolonga hasta el marcador central del comercio.
- **Otra planta:** se explica la diferencia de plantas en el mismo visor 3D. El número de plantas no equivale a un número de escaleras ni confirma qué conector está operativo. El planificador ya admite segmentos por planta unidos por conectores verificados, pero los datos actuales de Aventura no incluyen desembarcos verticales aptos para routing y por eso no dibujan una ruta entre plantas.
- **Sin posición precisa:** el visitante puede elegir explícitamente un punto de partida sobre los pasillos fuente. Un punto ofrecido por la interfaz no afirma dónde está el visitante. Debe identificarse como «Punto de partida en este pasillo» y tener un área táctil de al menos 44 px.
- **Sin continuidad comprobable en la geometría:** quedan los marcadores de origen y destino y el mensaje correspondiente; no se dibuja un atajo, una recta entre tiendas ni un enlace al pasillo más cercano.

La vista previa no incluye una flecha presentada como orientación segura, instrucciones de giro, tiempos de llegada ni accesibilidad garantizada. Los iconos de ascensor o escalera tampoco sustituyen conexiones cartográficas. Para cruzar plantas, cada conector debe declarar tipo, sentido, costo medido, fuente y ambos nodos de desembarco con `verified:true` y `landingMappingsVerified:true`.

## Cabecera de tablet

La búsqueda conserva un único campo y se coloca a la derecha del nombre del shopping en la cabecera de tablet. El indicador de renderizador «WebGL listo» deja de mostrarse al visitante. Las acciones secundarias permanecen accesibles desde «Más» para no reducir el campo de búsqueda ni los controles táctiles en orientación vertical. Al volver al tamaño de teléfono, el mismo campo regresa al mapa conservando su consulta.

## Evidencia y límites

La compilación utiliza el archivo público `map.json` del mapa oficial de Aventura, venue 107:

- Fuente: <https://s3.us-east-2.amazonaws.com/settings.roveiq.com/venue-107/map.json>
- SHA256 fijado: `e08901ec3eaddf8cd287b19bae77d3ec6fd0e227e04a444da2fa9255ac0dfbfa`.
- Plantas: LL = 361, UL = 362, L3 = 363.
- Sistema de coordenadas: `roveiq:107:local-decimeters-v1`, el mismo que usa la geometría 3D actual. No existe una transformación a los píxeles de los planos fotográficos anteriores.
- Red: `routing_dataset.data.features`, sólo segmentos de la misma planta.
- Accesos declarados: `map_suites.settings.entrances`, vinculados por `suite_id` al polígono y por `floor_ids` a su planta.
- Obstáculos: todos los polígonos de locales, las capas de paredes interiores y exteriores y las de césped. Sólo se conserva circulación dentro de las superficies `noclick-floor` de la propia fuente.

Los campos de ancho, sentido y accesibilidad de los tramos no aportan una validación operativa suficiente. Las paredes dibujadas tampoco incluyen necesariamente una abertura en las entradas declaradas. Por ello, incluso una cadena geométricamente continua conserva `routingVerified: false` y `directionsVerified: false`.

La auditoría encontró que el camino fuente más corto desde el frente de Joe & The Juice a Venchi atraviesa parte de Dyson. La versión filtrada lo rechaza y ofrece una cadena más larga de aproximadamente 104 metros hasta antes de la pared de Venchi. El acceso de Joey Aventura en UL queda a aproximadamente 35,9 metros de la red y no se conecta. El acceso de Apple en LL tampoco queda habilitado por el filtro de obstáculos. Estos casos deben seguir produciendo falta de recorrido antes que una conexión inventada.

| Planta | Segmentos fuente no nulos | Segmentos conservados | Segmentos descartados | Alternativas de acceso recortadas |
| --- | ---: | ---: | ---: | ---: |
| LL | 594 | 295 | 299 | 156 |
| UL | 492 | 282 | 210 | 115 |
| L3 | 141 | 82 | 59 | 26 |

Las alternativas de acceso no son cantidades de comercios: una entrada puede tener más de una aproximación y varias entradas pueden pertenecer al mismo comercio.

## Reglas del compilador

`scripts/import-routing-preview.py` exige que el archivo original coincida con el SHA256 fijado en `data/official-maps/aventura.json`. Su resultado es `data/official-maps/aventura-routing-preview.json`.

1. Conserva únicamente segmentos fuente completos que no atraviesan el interior de ningún local, pared o césped y permanecen dentro de una superficie de planta fuente.
2. Mantiene conexiones únicamente cuando los segmentos comparten el mismo extremo fuente. No une extremos cercanos ni convierte cruces visuales en conexiones nuevas.
3. Sólo considera una entrada declarada en la misma planta, dentro del polígono correspondiente o en su borde. La entrada debe coincidir con un segmento fuente dentro de 0,15 metros, tolerancia de precisión de las coordenadas originales.
4. Para aproximarse al destino, recorta exclusivamente su segmento de acceso fuente antes del primer obstáculo, con un pequeño margen exterior. Rechaza aproximaciones que antes atraviesen otro local, césped o un hueco fuera de la superficie de planta. Una pared intermedia sólo puede delimitar una región de obstáculo continua con el propio destino.
5. Nunca dibuja el tramo restante entre el punto recortado y la entrada. La ausencia de ese tramo es una limitación real del plano, no un hueco que pueda rellenarse por proximidad.

Recompilación con una copia del archivo original:

```sh
python3 scripts/import-routing-preview.py /ruta/al/map.json
```

## Contrato del módulo

`src/wayfinding-route.js` expone `window.RetailNavWayfindingRoute`:

- `configure(data)` valida y carga el conjunto de datos; devuelve un booleano. Una configuración inválida descarta los datos previos.
- `plan({mallId, coordinateSpace, floor, origin: {x, y}, destinationPolygonIds})` devuelve `status: 'provisional'` con `points`, o `status: 'unavailable'` con una razón y `points: []`.
- En un recorrido entre plantas, `origin.floor` identifica la planta inicial y `floor` la planta del destino. La respuesta divide el camino en `routeSegments: [{floor, points}]` y enumera `connectorsUsed`; nunca dibuja una línea vertical entre desembarcos.
- `getOriginCandidates({mallId, coordinateSpace, floor, destinationFloor, destinationPolygonIds})` devuelve puntos `{id, floor, x, y, previewOnly: true}` que el visitante puede elegir. Sólo incluye nodos de componentes conectados a una alternativa de acceso del destino, incluyendo conectores verificados si existen. No selecciona un origen por el visitante.

El campo opcional `connectors` del dataset acepta exclusivamente `escalator`, `elevator`, `stairs` o `ramp`. Cada registro exige `from` y `to` con planta/nodo existentes, `direction`, `costUnits`, `sourceId`, `verified:true` y `landingMappingsVerified:true`. Un conector incompleto invalida el dataset entero; la ausencia de conectores produce `vertical-connection-unavailable` al pedir otra planta.

El origen de `plan` debe estar sobre un segmento fuente conservado. La tolerancia máxima de 0,15 metros sólo normaliza precisión de coordenadas: no crea un tramo de aproximación visible. Para un toque libre lejos de la red, el resultado es `origin-not-on-source-path`; la interfaz puede ofrecer los puntos de partida explícitos, nunca colocar automáticamente al visitante en el más cercano.

La posición elegida para esta vista previa es un dato local de orientación. No debe publicarse como posición real del visitante ni sobrescribir su ancla de posicionamiento de manera implícita.

## Verificación

```sh
node --test scripts/test-wayfinding-route.mjs
```

Las pruebas verifican la correspondencia de todos los segmentos con la circulación fuente, el desvío de Venchi que evita los locales, el final exterior, las coordenadas y plantas incompatibles, la tolerancia del origen, la ausencia de conexiones entre extremos separados y que todos los candidatos de origen ofrecidos producen un recorrido provisional. Los recorridos continúan identificados como provisionales aunque estas comprobaciones pasen.
