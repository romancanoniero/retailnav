# Perfiles de entrada y gestos

RetailNav mantiene un solo visor web y adapta controles, ayuda y gestos según
las capacidades que comunica el navegador. No usa el nombre del dispositivo ni
una aplicación paralela. Esto evita mostrar instrucciones táctiles en una Mac y
permite que una notebook híbrida use pantalla táctil y trackpad en la misma
sesión.

## Perfiles

- **Táctil:** un dedo desplaza; dos dedos amplían, giran e inclinan; doble toque
  amplía; doble toque sostenido y arrastre controla el zoom.
- **Precisión:** mouse o trackpad. Arrastrar gira el modelo; la rueda o pellizco
  amplían; el gesto de giro del trackpad rota; `Mayúsculas` más desplazamiento
  con dos dedos inclina.
- **Híbrido:** admite ambos conjuntos y muestra una ayuda combinada.

El perfil se recalcula si cambia `any-pointer`, por ejemplo al conectar un mouse
a una tablet. El atributo `data-input-profile` del documento y el estado público
`inputProfile` permiten comprobar qué interfaz eligió el visor.

## Safari en macOS

Safari no expone cada dedo del trackpad como `PointerEvent`. El visor convierte
sus `gesturestart`, `gesturechange` y `gestureend` en zoom y rotación de la cámara,
anclados al punto del mapa bajo el gesto. Los eventos quedan confinados al mapa;
el zoom de accesibilidad del navegador sigue disponible fuera del visor.

Safari no entrega el desplazamiento paralelo de dos dedos como dos contactos
independientes. Por eso la inclinación usa `Mayúsculas` más desplazamiento. La
prueba `scripts/test-desktop-gestures-browser.mjs` cubre los perfiles de precisión,
pellizco, giro, inclinación y el límite entre mapa y página en Chromium y WebKit.
