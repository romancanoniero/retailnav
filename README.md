# RetailNav · Aventura Mall (prototipo)

[**Abrir RetailNav en Improving Your Reality**](https://improvingyourreality.com/retailnav/)

Visor 3D web de un centro comercial, con tres plantas vectorizadas desde planos aportados y experiencia social de visita en grupo. Funciona en Safari y navegadores modernos, sin instalar una app.

## Visor 3D

- Plantas **LL, UL y L3**. Tocá un indicador en el modelo para enfocar esa planta y ocultar las demás.
- Botón **Mostrar las 3 plantas** o pestaña **Todas** para restablecer la vista conjunta.
- Un dedo orbita; dos dedos desplazan, amplían y **giran mediante torsión**, incluso dejando un dedo fijo.
- Etiquetas, búsqueda de tiendas ancla, ruta ilustrativa sobre pasillos trazados, comparación con fuente y exportación GLB.
- Cuatro amigos **DEMO** ficticios sobre plantas diferentes, identificados claramente. Se pueden ocultar.
- Renderizado WebGL con alternativa 3D Canvas. QR generado localmente, sin dependencia de CDN.

## Visitantes sin registro obligatorio

La primera vez que un visitante abre RetailNav, el servidor crea una **identidad anónima aleatoria**. La sesión se conserva mediante una cookie segura, HttpOnly y SameSite=Lax. **No se identifica por IP, huella digital del dispositivo ni GPS**.

En **Mis amigos** se puede:

1. Cambiar el nombre visible sin registrarse.
2. Mostrar un **QR temporal de 5 minutos y un solo uso**; el otro visitante lo escanea con la cámara del teléfono, abre el enlace y confirma una solicitud.
3. Aceptar o rechazar la solicitud desde el primer teléfono. Solo **ambos consentimientos** producen el vínculo recíproco.
4. Recuperar automáticamente los contactos al cerrar y volver a abrir el mismo navegador.
5. Opcionalmente generar una **clave de recuperación de un solo uso** para trasladar la identidad a otro navegador o recuperarla después de borrar Safari.
6. Desvincular contactos en ambos sentidos.

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
| Persistencia | JSON privado, escritura atómica, fuera de releases | `/home/iankmp/retailnav-host/state/` |

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
