# RetailNav · Aventura Mall (prototipo)

[**Abrir RetailNav en Improving Your Reality**](https://improvingyourreality.com/retailnav/)

> **Desarrollo futuro y continuidad E2E:** [Plan Maestro de RetailNav — módulos SaaS, administradores de shoppings, comercios, web y apps móviles](docs/RETAILNAV-PLAN-MAESTRO-E2E.md). Este documento registra funcionalidades, roles, seguridad, contratos de datos, flujos E2E, pruebas, riesgos, decisiones pendientes y el estado real de implementación. **Leer y actualizar antes de comenzar cualquier módulo nuevo**; las capacidades propuestas no deben confundirse con funciones ya desplegadas.

Visor 3D web de un centro comercial, con tres plantas vectoriales y experiencia social de visita en grupo. Aventura usa los polígonos de la fuente oficial en el mismo motor 3D; los planos aportados permanecen en «Tu plano» como referencia histórica. Funciona en Safari y navegadores modernos, sin instalar una app.

## Visor 3D

- Plantas **LL, UL y L3**. Tocá un indicador en el modelo para enfocar esa planta y ocultar las demás.
- Botón **Mostrar las 3 plantas** o pestaña **Todas** para restablecer la vista conjunta.
- Un dedo orbita; dos dedos desplazan, amplían y **giran mediante torsión**, incluso dejando un dedo fijo.
- Búsqueda y selección de comercios con enfoque animado, comparación con fuente y exportación GLB. Sin rutas peatonales hasta verificar pasillos, puertas y conectores.
- **Nueve amigos DEMO (tres por planta)**, con retratos sintéticos, nombre, cuerpo 3D y sombra de colores independientes. Los pines se dibujan en coordenadas espaciales y acompañan la rotación del mapa. Aparecen también en el pulldown «Mis amigos», con un botón 📍 para enfocar cada persona. Se pueden ocultar sin alterar contactos reales.
- Renderizado WebGL con alternativa 3D Canvas. Generación y lectura de códigos QR locales, **sin dependencia de CDN**, incluso en Safari sin BarcodeDetector.
- Los perfiles DEMO están en `src/demo-friends.js`. En Aventura sus ubicaciones ilustrativas se toman de puntos de la circulación de la fuente oficial, dentro del marco local del modelo; no se inventan coordenadas GPS ni posiciones medidas. Su modelo de posición `{mallId,floor,x,y,source,coordinateSpace}` permite reemplazarlos por contactos reales en el mismo renderizador. Cuerpo, borde y sombra se configuran por persona o por paleta general en `window.RETAILNAV_MARKER_PALETTE`; ningún pin usa PNG estáticos.
- El renderizador `src/pins3d.js` traza cada pin y su sombra mediante geometría proyectada 3D en un lienzo transparente compartido; los avatares son texturas separadas. Las fotos reales, cuando se comparten, se cargan de manera privada desde el backend. El modelo mantiene el anclaje por planta al rotar, trasladar o acercar el mapa.

## Visitantes sin registro obligatorio

La primera vez que un visitante abre RetailNav, el servidor crea una **identidad anónima aleatoria**. La sesión se conserva mediante una cookie segura, HttpOnly y SameSite=Lax. **No se identifica por IP, huella digital del dispositivo ni GPS**.

Al tocar el icono de amigos aparece un **pulldown compacto anclado a ese botón**. No es un diálogo modal: deja el plano interactivo, se cierra al tocar cualquier otra parte de la pantalla, al pulsar el icono nuevamente o con Escape. **«Mi QR» abre un diálogo independiente**: primero se cierra el pulldown, luego aparece el QR y, al cerrar el diálogo (con la X o Escape), se vuelve directamente al mapa. Para ver amigos nuevamente hay que tocar su icono. El contenido está dividido por líneas horizontales: perfil, invitaciones y amigos, y luego solicitudes, ubicación y recuperación plegables.

1. **Perfil:** cambiar el nombre visible y elegir foto de la galería o tomarla con la cámara. El ID interno permanece inalterable. Las fotos se reducen a JPEG antes de subirlas, se guardan fuera del directorio público y solo el usuario y sus amigos pueden consultarlas.
2. **Mi QR:** al pulsar el icono del perfil se genera un QR temporal de cinco minutos y un solo uso. El invitado lo escanea en la web o con la Cámara de Safari, solicita el vínculo y quien mostró el QR lo confirma.
3. **Invitar por link:** quien genera el enlace **autoriza previamente** esa invitación; cuando el destinatario abre el enlace de mensajería y pulsa «Agregar a mis amigos», se añaden **recíprocamente** de inmediato. El enlace vence a los treinta minutos, es de un solo uso y debe enviarse solo a personas conocidas. Abrirlo sin aceptarlo no añade contactos.
4. **Mis amigos:** lista con foto o inicial, nombre y botón de marcador para enfocarlo en la planta compartida. Si la ubicación está oculta, el marcador no permite buscarla. Un menú discreto permite desvincular.
5. Volver a entrar en el mismo navegador restaura la identidad y los vínculos. Una **clave de recuperación voluntaria** permite volver a acceder tras borrar Safari o cambiar de teléfono.
6. **Eliminar mi identidad y contactos** revoca las sesiones, elimina los vínculos recíprocos y borra también la foto privada del servidor.

Los enlaces de invitación usan fragmentos URL (no se envían automáticamente en la solicitud web), códigos aleatorios resistentes a adivinación y validación del consentimiento.

**Limitación de recuperación:** si Safari borra la cookie, se usa navegación privada o se cambia de teléfono *sin una clave de recuperación guardada*, la identidad anónima anterior no podrá recuperarse. Los contactos quedan en el servidor, pero no son accesibles desde la identidad nueva.

## Ubicación y privacidad

- La única posición que puede compartirse es **una marca manual aproximada** que el visitante selecciona en el plano.
- Se comparte únicamente con contactos vinculados y **solo después de una acción explícita**.
- Se deja de compartir con un botón y la posición caduca automáticamente a los **10 minutos**. Cerrar el navegador no produce rastreo en segundo plano.
- Los marcadores reales se diferencian de los ficticios, y los datos de posición llevan `source: "manual"`.
- **No hay posicionamiento interior real**: no se usa GPS, cámaras, Bluetooth, UWB, Wi-Fi ni medición de distancias para localizar a personas. Para saber su ubicación efectiva harán falta calibración y sensores de posicionamiento interior.
- No compartas información sensible a través de los nombres de perfil o códigos QR.

## Arquitectura

| Parte | Tecnología | Ruta |
|---|---|---|
| Visor estático | HTML/JS/WebGL + Nginx | `/retailnav/` |
| Contactos anónimos | Node 22, HTTP JSON y cookie HttpOnly | `/retailnav/api/` |
| Publicación | Docker Compose aislado en red `edge` + Traefik | `deploy/` |
| Persistencia | JSON privado y avatares JPEG protegidos, fuera de releases | `/home/iankmp/retailnav-host/state/` |

No se alteran las aplicaciones existentes de Improving Your Reality. El backend social no publica puertos directamente; solo Traefik expone su prefijo de API. Los nuevos despliegues **no borran** la identidad ni los contactos guardados.

Para desarrollo estático sin servidor:

```bash
python3 scripts/build-web.py
python3 scripts/verify.py public
python3 scripts/build-glb.py public
python3 -m http.server 8080 --directory public
```

La interfaz 3D funciona sin backend; en ese caso debe mostrar que los **contactos reales están desconectados**, aunque los amigos DEMO seguirán visibles.

Para probar la API de contactos, con Node 22:

```bash
node --test backend/server.test.mjs
```

Publicación y pruebas: [GitHub Actions](../../actions). Incluye validación del anonimato, rechazo de solicitudes no autorizadas, QR de un solo uso, consentimiento mutuo, persistencia, privacidad y prueba automatizada de navegador móvil en el sitio HTTPS real.

## Futuro traslado a dominio propio

La interfaz utiliza rutas relativas y genera enlaces QR desde el origen actual. Para moverla a la raíz de un nuevo dominio se cambia el enrutamiento de Traefik y se configura `RETAILNAV_COOKIE_PATH=/` en la API. Es importante migrar y proteger la carpeta persistente de datos, y explicar a los visitantes la transición de las cookies de dominio.

## Calidad de los planos

**Los mapas son una maqueta** trazada a partir de tres imágenes, **no LiDAR ni un relevamiento físico**. No están verificadas la escala, las divisiones comerciales, las puertas, las conexiones entre plantas, la accesibilidad ni las rutas. **No deben usarse para orientar visitantes dentro del edificio real** hasta tener un levantamiento preciso y una validación in situ.

Repositorio exploratorio anterior `romancanoniero/MallMasters`: se conserva sin cambios.
