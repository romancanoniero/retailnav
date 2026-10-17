# RetailNav — panel lateral de comercios y encuentros consensuados

Fecha: 2026-10-16. Estado: **PR #44 en revisión, NO publicado ni certificado para navegación física**.

## Contrato de experiencia

- **Tablet / escritorio (>=761px):** al seleccionar una etiqueta existente (p. ej. `Coffee`), se cierra el panel izquierdo y aparece una columna derecha de ancho limitado, con **listado vertical** de los comercios del centro actual. El lienzo WebGL/Canvas se acorta a la izquierda: no hay una lámina opaca sobre el mapa ni una escala geométrica distinta.
- **Teléfono:** se conserva el panel inferior, el mapa accesible y la navegación táctil. Un toque en el resultado selecciona el comercio y enfoca su referencia cartográfica sin desmontar la lista. Doble toque/doble clic (o Enter sobre la tarjeta seleccionada) abre la ficha en el mismo panel; volver recupera la lista.
- **Acciones posteriores al enfoque:** seleccionar desde la lista o desde un polígono del mapa inicia el mismo enfoque de cámara. El diálogo de orientación no se abre automáticamente. Al terminar el giro aparecen, con una transición breve, tres botones circulares con sombra: **orientarme**, **invitar** e **información**. Orientarme abre la tarjeta de planta/origen sólo a demanda; invitar reutiliza el flujo privado de encuentros; información abre la ficha existente y vuelve directamente al mapa cuando se invoca sin lista visible. En locales sin geometría vinculada, orientación queda deshabilitada y las otras dos acciones continúan disponibles.
- **Ficha:** logo solo si hay enlace válido, iniciales en su defecto; nombre, planta documentada, especialidades, descripción y enlaces HTTPS de menú/sitio/directorio **solo si constan en la fuente**. Datos faltantes se reconocen; nunca se inventan precios, horarios, menús ni coordenadas. Un registro sin vector mantiene la advertencia de ubicación por confirmar.
- **Navegación AR:** se reserva la acción pero permanece DESHABILITADA en mapas fotográficos no certificados. No basta que el invitado confirme: se necesitan localización y orientación confiables, escala métrica calibrada, pasillos transitables y rutas accesibles validadas, entrada del local conocida, privacidad/autorización de cámara y API nativa/WebXR compatible. El actual trazado de prueba no se ofrece como guía real. En iOS Safari no se presupone WebXR immersivo; evaluar puente nativo ARKit y alternativa 2D verificada.
- **Encuentros:** únicamente entre amistades reales recíprocas; no con usuarios DEMO. Se envía **identificador de shopping + comercio y nombre**, no GPS, cámara, avatar privado ni trayectoria. Cada invitado puede aceptar, rechazar o proponer otra tienda del mismo centro. Una contrapropuesta requiere aprobación del organizador y nueva aceptación de quienes no la propusieron; destino confirmado al aceptar todos. El organizador puede cancelar; deshacer vínculo/eliminar cuenta invalida encuentros conjuntos. Se descartan al vencer (24 horas) y no se conservan historiales permanentes. API autenticada con sesión HttpOnly y validación de origen.
- **Bandeja global:** botón en cabecera muestra invitaciones incluso si no hay ninguna búsqueda activa. Refresca con consulta ligera cada 20 s mientras la página esté visible, además del regreso a primer plano. Sin geolocalización continua.
- **Seguridad:** las propuestas son invitaciones, no evidencia de que exista una puerta de acceso o servicio vigente. Los identificadores ingresados deben validarse contra el catálogo canónico antes de uso comercial con datos administrados por terceros; mientras tanto el destinatario ve una propuesta declarativa no verificada. Control de abuso por rate limit de sesión existente, topes por organizador y duración finita.

## Módulos

- `backend/meetups.mjs`: API GET `/meetups`; POST `/meetups/create`, POST `/meetups/decision` con acciones `accept`, `decline`, `counter`, `approve`, `reject`, `cancel`.
- `backend/server.mjs`: integra el servicio, eliminaciones de cuenta y contactos.
- `deploy/deploy-social.sh`: añade el módulo al despliegue/rollback aislado.
- `src/store-meetups.js`: vista de fichas y negociaciones. Se incluye en `scripts/build-web.py` y `src/page.template.html`.
- `src/style.css`: encaje tablet y responsive.
- Pruebas en `backend/server.test.mjs`, `scripts/test-store-search-browser.mjs` y regresiones del visor.

## Criterios de liberación

1. CI de sintaxis, construcción, pruebas de privacidad/aislamiento, navegador Chromium + WebKit.
2. En tablet, `viewport.right <= panel.left`; en móvil panel inferior intacto.
3. Al elegir Coffee, listado correcto **del mall actual**, multilingüe. Un toque enfoca y mantiene lista; dos abren ficha.
4. La bandeja de acciones permanece oculta durante el vuelo y aparece al terminar; sus tres controles son circulares y tienen al menos 44 px. La tarjeta grande de orientación permanece cerrada hasta pulsar orientarme.
5. Eliminar contacto invalida automáticamente las propuestas relacionadas; tercero no puede leer ni cambiar reuniones.
6. Otra propuesta nunca cambia la meta hasta ratificación del organizador y todos los participantes.
7. Si no hay rutas verificadas, botón AR no se puede activar; nunca indicar caminar por geometría fotográfica como ruta segura.
8. Despliegue en Contabo y verificación real de versión en Safari/iPad, sin asumir éxito a partir de CI solamente.

## Pendientes posteriores, deliberadamente fuera del PR

- Catálogo de menú, horarios, teléfonos y enlaces declarados **y revisados** por el operador del shopping (portal de administrador).
- Identificadores de comercio y etiquetas validados por el backend contra catálogo firmado y versionado.
- Anclajes métricos y mapa de pasillos/salidas, escaleras y elevadores que soporte rutas en interiores.
- Núcleo de rutas por preferencias de accesibilidad + navegación 2D ligera; luego integración ARKit nativa, WebXR donde exista, QA dentro de cada centro.
- Push opcional de invitaciones (con consentimiento y rate limit) para sustituir polling cuando esté disponible.
