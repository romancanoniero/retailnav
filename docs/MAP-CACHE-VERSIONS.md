# RetailNav — mapas en caché por centro comercial

## Objetivo

Abrir la página para un centro comercial seleccionado (por ejemplo, `?mall=aventura`) muestra exclusivamente la versión de ese mapa. Los mapas son independientes, inmutables y cuentan con una versión de 64 caracteres derivada de SHA-256.

## Contrato

1. El HTML conserva únicamente el catálogo y los datos descriptivos de cada shopping. La geometría principal **no se incrusta** en el HTML.
2. `scripts/build-web.py` produce `public/maps/malls/<slug>-<version>.json`, con `schema=retailnav.map.bundle.v1`, `mallId`, `version` y `floors`. El catálogo declara el nombre, versión, hash SHA-256, tamaño y cantidad de plantas.
3. En la carga, `src/map-cache.js` inspecciona **Cache Storage** (`retailnav-mall-maps-v1`). Si hay una copia válida con el mismo `mallId`, `version`, hash y estructura, la usa sin descarga de geometría.
4. Si falta, está corrupta o fue reemplazada por una versión nueva, aparece una **pantalla completamente blanca** indicando el nombre del shopping, estado y progreso de descarga.
5. La nueva copia se verifica por SHA-256, estructura y pisos *antes* de guardarse. Recién entonces se reemplaza el mapa de caché de ese shopping y se eliminan las versiones anteriores de **ese mismo shopping**, sin afectar mapas de otros centros.
6. Después de preparar la geometría en memoria y dibujar el primer frame, se oculta la pantalla blanca y se revela el visor. Nunca se muestra un mapa mezclado o incompleto.
7. Si la descarga falla no se oculta la capa blanca: muestra un mensaje y un botón real para reintentar. Una versión antigua no se presenta como actual.

## Consideraciones

- El mapa en caché es contenido cartográfico público, **no** contactos, fotos privadas, perfiles, datos de ubicación ni sesiones de usuario.
- El caché persiste cuando el navegador lo permite. No está garantizado en modo privado, con políticas del navegador o si el dispositivo libera almacenamiento.
- Abrir la aplicación totalmente desconectada también exige que el navegador disponga del HTML de la aplicación. Esta mejora administra la geometría del mapa, no instala una PWA para almacenar el shell.
- Las versiones dependen del contenido del mapa y de los metadatos del shopping, no de una fecha inventada.
- El encabezado HTML debe revalidarse con `Cache-Control: no-cache, must-revalidate` para enterarse de nuevas versiones. Los archivos JSON inmutables pueden cachearse a largo plazo.
- No modifica rutas, objetos 3D, pisos, amigos, búsqueda, vectores, fotografías originales ni la documentación de fuentes.

## Tests

- `node --test scripts/test-map-cache.mjs`: 8 escenarios (versión vigente, offline con versión válida, versión nueva, descarga fallida, integridad, aislamiento por shopping).
- `python3 scripts/build-web.py && python3 scripts/verify.py public`: conserva los invariantes y verifica hashes por shopping.
- `node scripts/test-map-cache-browser.mjs`: navegador Chromium táctil de 390 × 844, visita fría con capa blanca, visita caliente sin redescarga, cambio de shopping, versión nueva, fallo de red y botón de reintento. Requiere Playwright instalado.

**Importante:** Los cambios están separados de la validación arquitectónica de los planos; siguen siendo mapas provisionales donde corresponda.
