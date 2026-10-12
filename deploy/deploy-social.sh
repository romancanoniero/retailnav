#!/usr/bin/env bash
# Safe, isolated anonymous-presence backend for RetailNav.
# DOES NOT modify the main site, other Docker projects, Traefik or DNS.
set -euo pipefail
REV="${1:?A 40-character pinned Git revision is required}"
[[ "$REV" =~ ^[a-f0-9]{40}$ ]] || { echo "Invalid revision" >&2; exit 2; }
[[ "$(id -un)" == "iankmp" ]] || { echo "Expected iankmp" >&2; exit 2; }
BASE=/home/iankmp/retailnav-host
[[ -f "$BASE/.retailnav-managed" && -f "$BASE/compose.yml" ]] || {
  echo "Isolated RetailNav static deployment has not been established" >&2
  exit 2
}
docker network inspect edge >/dev/null
docker compose version >/dev/null
for path in "$BASE/api" "$BASE/state"; do
  if [[ -L "$path" ]]; then
    echo "Refusing symlink: $path" >&2
    exit 3
  fi
done

TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
curl --proto '=https' --tlsv1.2 -fLsS --retry 2 --connect-timeout 15 --max-time 120 \
  "https://github.com/romancanoniero/retailnav/archive/$REV.tar.gz" \
  -o "$TEMP/retailnav.tgz"
mkdir "$TEMP/source"
tar -xzf "$TEMP/retailnav.tgz" -C "$TEMP/source" --strip-components=1
test -s "$TEMP/source/backend/server.mjs"
test -s "$TEMP/source/backend/server.test.mjs"

# The persistent state is kept completely outside release directories.
mkdir -p "$BASE/api" "$BASE/state"
chmod 700 "$BASE/state"
if [[ -f "$BASE/api/server.mjs" ]]; then
  cp "$BASE/api/server.mjs" "$TEMP/server.previous.mjs"
fi
cp "$TEMP/source/backend/server.mjs" "$BASE/api/.server.next"
mv -f "$BASE/api/.server.next" "$BASE/api/server.mjs"

cat > "$BASE/social-compose.yml" <<'COMPOSE'
name: retailnav
services:
  api:
    image: node:22-alpine
    restart: unless-stopped
    command: ["node", "/app/server.mjs"]
    user: "RETAILNAV_RUNTIME_USER"
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    tmpfs:
      - /tmp
    environment:
      NODE_ENV: production
      PORT: "3181"
      RETAILNAV_DATA_DIR: /data
      RETAILNAV_ALLOWED_ORIGINS: "https://improvingyourreality.com,https://www.improvingyourreality.com"
    volumes:
      - ./api:/app:ro
      - ./state:/data
    networks:
      - edge
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=edge"
      - "traefik.http.routers.retailnav-api.rule=(Host(`improvingyourreality.com`) || Host(`www.improvingyourreality.com`)) && PathPrefix(`/retailnav/api/`)"
      - "traefik.http.routers.retailnav-api.entrypoints=websecure"
      - "traefik.http.routers.retailnav-api.tls=true"
      - "traefik.http.routers.retailnav-api.tls.certresolver=le"
      - "traefik.http.routers.retailnav-api.priority=1100"
      - "traefik.http.routers.retailnav-api.middlewares=retailnav-api-strip"
      - "traefik.http.middlewares.retailnav-api-strip.stripprefix.prefixes=/retailnav/api"
      - "traefik.http.routers.retailnav-api.service=retailnav-api"
      - "traefik.http.services.retailnav-api.loadbalancer.server.port=3181"
networks:
  edge:
    external: true
COMPOSE

# Write only numeric runtime UID/GID; no Docker-root privileges needed.
sed -i "s/RETAILNAV_RUNTIME_USER/$(id -u):$(id -g)/" "$BASE/social-compose.yml"

docker compose -p retailnav -f "$BASE/compose.yml" -f "$BASE/social-compose.yml" config --quiet

# Recreate only the RetailNav API service, never touching the existing web service.
if ! docker compose -p retailnav -f "$BASE/compose.yml" -f "$BASE/social-compose.yml" \
  up -d --no-deps --force-recreate api; then
  echo "RetailNav presence container failed to start" >&2
  exit 4
fi

READY=false
for attempt in $(seq 1 20); do
  if curl -fLsS --connect-timeout 4 --max-time 8 \
    https://improvingyourreality.com/retailnav/api/health -o "$TEMP/health.json" 2>/dev/null && \
    python3 - "$TEMP/health.json" <<'PY'
import json,sys
try:
  status=json.load(open(sys.argv[1]))
  assert status["ok"] is True and status["service"]=="retailnav-anonymous-presence"
except Exception:
  raise SystemExit(1)
PY
  then
    READY=true
    break
  fi
  sleep 3
done
if [[ "$READY" != true ]]; then
  echo "API verification failed; inspect only RetailNav API logs" >&2
  docker logs --tail 50 retailnav-api-1 2>&1 || true
  if [[ -f "$TEMP/server.previous.mjs" ]]; then
    cp "$TEMP/server.previous.mjs" "$BASE/api/.server.rollback"
    mv -f "$BASE/api/.server.rollback" "$BASE/api/server.mjs"
    docker compose -p retailnav -f "$BASE/compose.yml" -f "$BASE/social-compose.yml" \
      up -d --no-deps --force-recreate api || true
  else
    docker compose -p retailnav -f "$BASE/compose.yml" -f "$BASE/social-compose.yml" \
      stop api || true
  fi
  exit 5
fi
echo "RETAILNAV_SOCIAL_API_READY revision=$REV"
echo "PERSISTENT_STATE=$BASE/state (never overwritten by subsequent releases)"
