# RetailNav — Logo oficial de Aventura Mall, VPS, persistencia y cabecera

**Objetivo (2026-10-15):** al entrar a RetailNav, mostrar el **símbolo oficial de Aventura Mall a la izquierda de «Aventura Mall»**, sin ocultar el texto, únicamente cuando la imagen existe y es válida. Registrar el recurso en el almacenamiento persistente de Contabo y exponer sus metadatos por API. No cambiar las tres plantas, los polígonos, las fichas ni la caché de mapas.

## Origen y autorización

- Fuente original del símbolo: `https://aventuramall.com/wp-content/uploads/2025/01/logo-2.svg`.
- Aventura wordmark: `https://aventuramall.com/wp-content/uploads/2025/01/logo.svg`.
- Copia revisada del símbolo (archivo en repositorio): `public/branding/aventura-mark.svg`, SVG de `112 × 69`, color `#100F0F`.
- El logo de un tercero requiere autorización del titular para un **producto comercial**, incluso cuando se haya publicado en su web. El prototipo de referencia no supone dicha autorización.
- En el render 3D el estilo claro de Aventura sigue siendo independiente de la imagen y está definido en `data/mall-themes/aventura.json`.

## Persistencia actual (prototipo)

La aplicación utiliza actualmente una **base JSON** para sus datos persistentes de visitantes, no una base SQL. El logo tiene un registro **separado y privado** que podrá migrarse a la tabla `mall_assets` cuando se adopte el modelo multi-tenant transaccional descrito en `docs/RETAILNAV-PLAN-MAESTRO-E2E.md`.

| Tipo | Ruta persistente en Contabo | Propósito |
|---|---|---|
| Fuente binaria | `/home/iankmp/retailnav-host/state/brand-assets/aventura-mark.svg` | Logo oficial comprobado byte por byte, fuera de cada release |
| Registro DB JSON | `/home/iankmp/retailnav-host/state/mall-brands.json` | ID shopping, nombre, URL origen, URL pública, MIME, SHA-256, dimensiones y colocación |
| Código fuente desplegado | `/home/iankmp/retailnav-host/api/mall-brands.mjs` | Lectura de la base, comprobación de integridad, API pública |
| Respaldo público | `/home/iankmp/retailnav-host/releases/<revision>/branding/aventura-mark.svg` | Evita ocultar la marca si el servicio de metadata no responde; no reemplaza a la base |

**La carpeta `state` NO se borra, sustituye ni regenera durante el despliegue web.** El script `deploy/deploy-social.sh` obtiene el símbolo desde la página oficial cuando está disponible; sólo lo acepta si coincide con SHA-256 de la copia revisada que ya existe en el repositorio. Si el origen remoto no responde, conserva esta copia exacta. Si encuentra otro archivo en el almacenamiento persistente, se niega a sobreescribirlo silenciosamente.

Al iniciar, `backend/mall-brands.mjs` crea el registro `mall-brands.json` **únicamente si el archivo validado está presente y todavía no existe esa entrada**. El servidor lee el SVG desde la carpeta persistente y comprueba su huella SHA-256 en cada entrega.

### Contrato API

- `GET /retailnav/api/mall-brands/aventura` → `{mallId, mallName, available, logo:{url,sha256,mime,sourceUrl,placement,assetKind}}`
- `GET /retailnav/api/mall-brands/aventura/logo.svg` → imagen SVG oficial y ETag por SHA-256
- Sin logo registrado, hash inválido u otro shopping → **404** (nunca afirmar «disponible»).
- No existe endpoint de escritura público. El registro actual sólo se administra desde un despliegue firmado o un futuro panel de shopping autorizado.

El navegador selecciona el shopping y usa primero su logomark estático revisado; si la API indica que el recurso está registrado y su URL corresponde al mismo shopping, verifica que la imagen cargue correctamente y entonces utiliza la URL persistente de la API. **El título permanece visible** siempre, situado a la derecha del logo. Los shoppings sin logo mantienen sólo su nombre.

## Camino de implementación humana futura

1. Administrador autenticado del shopping sube un PNG/JPEG/WebP o logo SVG procesado por un pipeline de sanitización.
2. Backend valida tipo real, dimensiones, hash, derechos de uso y aislamiento por tenant.
3. Almacena asset en un object store/directorio privado por `tenant_id` y registra un `mall_asset_id` en una base transaccional, con estado «pendiente de aprobación».
4. Usuario autorizado aprueba/publica y actualiza `brandVersion` y `logoAssetId` del shopping. Los visitantes cargan la imagen pública validada.
5. En caso de indisponibilidad se conserva el nombre y, si existe, un respaldo de la marca. Rollback mantiene historial; no modifica los mapas vectorizados ni sus IDs.

**No extender el endpoint prototipo con edición anónima:** la rama `feature/mall-manager-branding` contiene trabajo WIP de administración por shopping y debe reconciliarse con este modelo de activos.

## QA E2E y regresiones

- `node --test backend/mall-brands.test.mjs backend/server.test.mjs`: base persistente y API, primer registro, reinicio, faltantes y alteraciones, compatibilidad de sesiones de visitante.
- `node scripts/test-mall-logo-browser.mjs`: navegador móvil 390 × 844 con logo real desde API a la izquierda, nombre legible, 3 plantas, API caída → respaldo y aislamiento de AP Plaza.
- `python3 scripts/build-web.py && python3 scripts/verify.py public`: geometría original, caché, número de plantas y metadata seguros.
- `node scripts/test-map-cache-browser.mjs`: caché de mapas no modificada.
- `deploy/deploy-social.sh`: comprobar por HTTPS el endpoint de metadata, `placement=left-of-name`, hash del registro y hash del SVG servido **antes** de declarar éxito; si falla revertir el módulo API.

### Registro de despliegue

Actualizar aquí con commit, resultado CI y verificación pública una vez publicados. No declarar «registrado en VPS» sólo por guardar este documento en GitHub.
