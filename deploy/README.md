# Publicación de RetailNav en Contabo

La instalación prevista es **https://improvingyourreality.com/retailnav/**, dentro del dominio ya existente. **Ninguna publicación a Contabo se ha ejecutado desde este repositorio.**

## Seguridad y aislamiento

- No modificar, borrar ni reiniciar otras aplicaciones, contenedores o virtual hosts.
- No reutilizar claves de SSH escritas en chats. Rotarlas y utilizar clave SSH.
- No tocar puertos, firewall ni el proxy principal sin inspeccionarlo antes.
- Solo copiar los archivos de `public/` al directorio `retailnav/` del sitio web identificado.
- El instalador rechaza rutas no especificadas; realiza copia de seguridad antes de sincronizar.

## Paso 1: determinar cómo se sirve el sitio

En la consola VNC de Contabo, comprobar sin escribir configuraciones:

```bash
sudo nginx -T 2>/dev/null | grep -n -A 20 -B 5 'server_name.*improvingyourreality.com'
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

Si el dominio es atendido por un proxy dentro de Docker, **no asumir** que su `root` es un directorio del host. Obtener primero el directorio/volumen real que sirve estáticos o configurar una ruta aislada.

## Paso 2: instalar estáticos (cuando ya existe un directorio público identificado)

```bash
git clone https://github.com/romancanoniero/retailnav.git
cd retailnav
sudo env RETAILNAV_DOCROOT="/RUTA/REAL/DEL/WEBROOT" bash deploy/install-on-contabo.sh
```

El script transfiere solo el contenido de `public/` hacia `/RUTA/REAL/DEL/WEBROOT/retailnav/`. Si hay una instalación previa, deja un respaldo `.tar.gz` fuera del webroot.

El directorio web **no necesariamente** corresponde a `/var/www/html`: confirmar su valor real antes de ejecutar.

## Paso 3: servir y verificar

- Asegurarse de que `/retailnav/` apunte al `index.html` de ese directorio, con prioridad sobre cualquier catch-all de SPA existente.
- `GET /retailnav/` debe devolver 200 y el HTML de RetailNav.
- `GET /retailnav/maps/manifest.json` debe devolver 200 y `application/json`.
- `GET /retailnav/maps/LL.json`, `UL.json`, `L3.json` deben devolver 200.
- La app debe permitir zoom, rotación, pan, selección de pisos y comparación.
- Probar en Safari del iPhone, no en el visor de archivos de ChatGPT.

Si Nginx usa un `alias` explícito, ejemplo sujeto a configuración existente:

```nginx
location ^~ /retailnav/ {
    alias /RUTA/REAL/DEL/WEBROOT/retailnav/;
    index index.html;
    try_files $uri $uri/ =404;
}
```

**No copiar a ciegas este bloque al Nginx en producción:** primero inspeccionar el server block y la estructura existente.

## Futuro dominio independiente

Como todos los archivos están dentro de `public/` y las rutas son relativas, cuando RetailNav tenga dominio propio bastará asignarle un nuevo virtual host a ese mismo directorio y migrar DNS/HTTPS. Mantener el prototipo separado de los otros proyectos.
