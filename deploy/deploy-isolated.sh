#!/usr/bin/env bash
# Isolated RetailNav release on the existing Traefik edge network.
set -euo pipefail
REV="${1:?A pinned git revision is required}"
[[ "$REV" =~ ^[a-f0-9]{40}$ ]] || exit 2
[[ "$(id -un)" == "iankmp" ]] || exit 2
docker network inspect edge >/dev/null
docker compose version >/dev/null

BASE=/home/iankmp/retailnav-host
if [[ -e "$BASE" && ! -f "$BASE/.retailnav-managed" ]]; then
  echo "Unmanaged path exists: refusing to overwrite" >&2
  exit 3
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fLsS --retry 2 --connect-timeout 15 --max-time 120 \
  "https://github.com/romancanoniero/retailnav/archive/$REV.tar.gz" \
  -o "$TMP/source.tgz"
mkdir "$TMP/source"
tar -xzf "$TMP/source.tgz" -C "$TMP/source" --strip-components=1
cd "$TMP/source"
python3 scripts/build-web.py
python3 scripts/verify.py public
python3 scripts/build-glb.py public
python3 scripts/verify.py public
test -s public/maps/Aventura-ALL.glb
test -s public/maps/manifest.json

mkdir -p "$BASE/releases"
printf 'retailnav\n' > "$BASE/.retailnav-managed"
RELEASE="$BASE/releases/$REV"
if [[ ! -d "$RELEASE" ]]; then
  mkdir "$RELEASE"
  cp -a public/. "$RELEASE/"
fi

cat > "$BASE/nginx.conf" <<'NGINX'
server {
  listen 80;
  server_name _;
  root /srv/retailnav/current;
  index index.html;
  charset utf-8;
  location / { try_files $uri $uri/ =404; }
  location ~* \.glb$ {
    types { model/gltf-binary glb; }
    try_files $uri =404;
  }
}
NGINX

cat > "$BASE/compose.yml" <<'COMPOSE'
name: retailnav
services:
  web:
    image: nginx:1.28-alpine
    restart: unless-stopped
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    tmpfs:
      - /var/cache/nginx
      - /var/run
      - /tmp
    volumes:
      - ./releases:/srv/retailnav/releases:ro
      - ./current:/srv/retailnav/current:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    networks:
      - edge
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=edge"
      - "traefik.http.routers.retailnav.rule=(Host(`improvingyourreality.com`) || Host(`www.improvingyourreality.com`)) && PathPrefix(`/retailnav/`)"
      - "traefik.http.routers.retailnav.entrypoints=websecure"
      - "traefik.http.routers.retailnav.tls=true"
      - "traefik.http.routers.retailnav.tls.certresolver=le"
      - "traefik.http.routers.retailnav.priority=1000"
      - "traefik.http.routers.retailnav.middlewares=retailnav-strip"
      - "traefik.http.middlewares.retailnav-strip.stripprefix.prefixes=/retailnav"
      - "traefik.http.services.retailnav.loadbalancer.server.port=80"
networks:
  edge:
    external: true
COMPOSE

docker compose -f "$BASE/compose.yml" config --quiet
OLD=$(readlink "$BASE/current" || true)
ln -s "releases/$REV" "$BASE/.next-current"
mv -Tf "$BASE/.next-current" "$BASE/current"

if ! docker compose -p retailnav -f "$BASE/compose.yml" up -d --no-deps; then
  echo "Container start failed" >&2
  if [[ -n "$OLD" ]]; then
    ln -s "$OLD" "$BASE/.restore-current"
    mv -Tf "$BASE/.restore-current" "$BASE/current"
  fi
  exit 4
fi

READY=false
for i in $(seq 1 20); do
  if curl -fsS --connect-timeout 4 --max-time 10 \
       https://improvingyourreality.com/retailnav/maps/manifest.json \
       -o "$TMP/check.json" && \
     python3 - "$TMP/check.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]))
assert p["schema"] == "retailnav.manifest.v1"
assert [f["id"] for f in p["floors"]] == ["LL","UL","L3"]
PY
  then
    READY=true
    break
  fi
  sleep 3
done

if [[ "$READY" != true ]]; then
  echo "Verification failed, rolling back RetailNav only" >&2
  if [[ -n "$OLD" ]]; then
    ln -s "$OLD" "$BASE/.restore-current"
    mv -Tf "$BASE/.restore-current" "$BASE/current"
  else
    docker compose -p retailnav -f "$BASE/compose.yml" down
    rm -f "$BASE/current"
  fi
  exit 5
fi
curl -fsS --max-time 12 \
  https://improvingyourreality.com/retailnav/ -o "$TMP/index.html"
grep -q "RetailNav" "$TMP/index.html"
echo "RETAILNAV_DEPLOYED revision=$REV"
echo "RETAILNAV_URL=https://improvingyourreality.com/retailnav/"
