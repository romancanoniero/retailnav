# RetailNav — Paletas configurables por shopping y colores del mapa 3D

**Estado:** implementación en la rama `feature/mall-map-palette-20261015`, pendiente de pasar las pruebas y de merge/despliegue.

## Decisión

Los colores de cada centro comercial se definen en un **manifiesto de branding por shopping**, nunca se deducen de los píxeles de los planos. La paleta puede personalizar la interfaz y el mapa WebGL/Canvas manteniendo exactamente los mismos polígonos, IDs, textos, escalas, tiendas y coordenadas. El logo es un asset independiente. **No se sustituye ni altera la geometría** para aplicar un cambio visual.

### Fuentes utilizadas para Aventura Mall

- Sitio oficial: https://aventuramall.com/
- Logo oficial (SVG): https://aventuramall.com/wp-content/uploads/2025/01/logo.svg
- Símbolo original: https://aventuramall.com/wp-content/uploads/2025/01/logo-2.svg
- Los logos originales fueron copiados en `public/branding/aventura-logo.svg` y `aventura-mark.svg`. El símbolo original incluye el color **#100F0F**.
- La gama de arena, marfil, piedra y marrón del mapa es una **propuesta de diseño RetailNav para armonizar con el sitio y su logo**, no una supuesta tabla corporativa oficial de Aventura Mall. Solicitar permisos comerciales para usar marcas de terceros cuando corresponda.

### Fuente de verdad (editable)

`data/mall-themes/aventura.json`:

```json
{
  "schema": "retailnav.mall.theme.v1",
  "mallId": "aventura",
  "preset": "aventura-editorial",
  "logoUrl": "branding/aventura-logo.svg",
  "brandLogoKind": "wordmark",
  "theme": {
    "background": "#F5F1EA",
    "surface": "#FFFFFF",
    "text": "#17150F",
    "muted": "#665F54",
    "accent": "#100F0F",
    "accentText": "#FFFFFF",
    "border": "#DCD4C8",
    "mapUnit": "#CDB99E",
    "mapAnchor": "#AA957A",
    "mapCorridor": "#EDE3D4",
    "mapZone": "#D9C7AE",
    "mapSlab": "#F2E9DB",
    "mapOutline": "#514739",
    "mapVoid": "#D3C8B8",
    "mapAmenity": "#57717C",
    "mapRoute": "#AA7132",
    "mapSelected": "#BE833B",
    "mapGrid": "#D3C6B8",
    "mapFloor1": "#D0BA9C",
    "mapFloor2": "#E1D0B7",
    "mapFloor3": "#F1E5D4",
    "font": "editorial",
    "corners": "soft"
  }
}
```

**Valores validables:** colores CSS en formato hexadecimal exacto `#RRGGBB`, tipografía `editorial|modern|rounded` y esquinas `soft|square`. No se aceptan hojas de estilo, URLs CSS, imágenes externas ni JavaScript incrustados en la configuración.

**Presets:** predeterminado propio del shopping, `retailnav-classic` (estilo oscuro preservado para los otros centros del prototipo) y `high-contrast` para vista previa de contraste. No mezclar el tema de un shopping con el de otro.

### Capas del mapa cubiertas

- **WebGL:** caras superiores y laterales de locales y anclas, losas, pasillos, áreas, huecos, líneas y contornos, cuadrícula, selección y recorrido; distinción de tonos LL/UL/L3; exportación GLB recoge los colores actuales.
- **Canvas 3D de respaldo:** utiliza la misma función de paleta que WebGL; rutas, cuadrícula, paredes y líneas responden al tema.
- **Interfaz:** fondo del plano, barra principal, paneles, buscador, controles 2D/3D, menú de planta y tipografías/estilos; imagen de logotipo original.
- **Sin cambio:** avatares/fotografías y colores elegidos explícitamente por cada persona; señalizaciones de seguridad normativas; foto de referencia (nunca recolorear fotos originales); transparencia de geometría o precisión de posicionamiento.

Las preferencias deben preservar legibilidad, contraste y significado de selección (no usar dos colores indiscernibles en ruta/selección).

### Vista previa en la UI actual

En la configuración (rueda dentada) existe la opción **«Paleta de colores del mapa y presentación»** con colores editables, opción de restaurar, selección de tema base y exportación de un JSON para revisión.

- Los cambios son **vista previa en este dispositivo**, guardada bajo `retailnav:theme-preview:v1:<mallId>` en `localStorage` si el usuario elige guardar.
- Nunca modifican los datos públicos, otros visitantes o los temas de otros shoppings.
- Se aplican al mapa **sin descargar de nuevo la geometría** ni reabrir los amigos. WebGL reemplaza buffers de colores existentes liberando los anteriores; Canvas consulta los tokens en cada dibujo.
- Restablecer elimina la vista previa local y recupera el tema oficial publicado.
- Sólo un **administrador del shopping autenticado** podrá publicar colores para todos los visitantes. Esta función administrativa sigue pendiente de finalizar en `feature/mall-manager-branding`.

### Futuro flujo E2E de publicación por administradores

1. `mall_owner` o `mall_content_editor` entra al portal autenticado, selecciona su propio tenant y cambia logo/paleta desde el panel.
2. El servidor valida la **misma lista blanca** y aplica verificación de contraste WCAG, licencia y dimensiones del logo; rechaza un `tenant_id` ajeno.
3. Guardar **borrador** no altera la versión de visitantes. Preview de móvil y 3D usan los mismos tokens y capas.
4. Supervisor/owner aprueba y publica una `themeVersion`. El catálogo público distribuye el tema actualizado; el mapa usa los mismos IDs y polígonos.
5. Hoy los metadatos del tema forman parte del hash de bundle `retailnav.map.bundle.v1`. En el futuro `v2` debe separar `themeVersion` de `mapVersion` para no volver a descargar geometría cuando sólo cambia un color.
6. Auditoría de quien editó, publicó y aprobó; rollback a revisión anterior; test A/B y contrastes.
7. Cliente no puede publicar: su JSON es únicamente una **propuesta**, que el administrador del tenant puede aceptar/editar.

### QA y regresiones mínimas

1. Aventura en iPhone simulado: logo visible, 3 plantas y tema marfil; buscar/rotar/zoom/seleccionar deben seguir funcionando.
2. Cambio de `mapUnit` en panel: la malla cambia sin descargas, los IDs y vértices no cambian.
3. Cerrar/abrir el navegador: vista previa guardada sólo para el dispositivo.
4. Cambiar AP Plaza/New World City: tema anterior oscuro, sin filtración de colores de Aventura.
5. Restaurar Aventura: mismo color predeterminado, no se borra la caché versionada.
6. Intentar `url(javascript:...)` como color: rechazado; JSON desconocido o tema de otro tenant: rechazado en publicación.
7. WebGL desactivado: Canvas sigue utilizando los colores aprobados.
8. Confirmar con `scripts/verify.py` que los polígonos, alturas, IDs, POI y número de plantas no cambiaron.

**Implementación:** `src/mall-theme.js`, `src/viewer.js`, `src/mall-selector.js`, `src/style.css`, `src/page.template.html`, `scripts/build-web.py` y `data/mall-themes/aventura.json`. Unit tests `scripts/test-mall-themes.mjs` y navegador `scripts/test-mall-theme-browser.mjs`.

**Mantenimiento:** cualquier desarrollo posterior del portal del shopping debe consumir el mismo contrato de paleta `retailnav.mall.theme.v1`, evitando crear otra nomenclatura incompatible.
