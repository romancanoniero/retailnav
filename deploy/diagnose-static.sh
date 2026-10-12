#!/usr/bin/env bash
# Local-only diagnostic: does not expose any port or register a Traefik router.
set -u
ROOT=/home/iankmp/retailnav-host
if [[ ! -f "$ROOT/.retailnav-managed" ]]; then
  echo "MISSING_DEPLOYMENT_MARKER"; exit 2
fi
release="$(find "$ROOT/releases" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [[ -z "$release" ]]; then
  echo "MISSING_RELEASE"; exit 2
fi
echo "Testing staged RetailNav release $(basename "$release")"
name=retailnav-offline-probe
if docker container inspect "$name" >/dev/null 2>&1; then
  echo "Diagnostic container name occupied"; exit 2
fi
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$name" \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /var/cache/nginx --tmpfs /var/run --tmpfs /tmp \
  -v "$release:/srv/retailnav/current:ro" \
  -v "$ROOT/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:1.28-alpine
sleep 2
echo "CONTAINER_STATUS:"
docker inspect -f '{{.State.Status}} exit={{.State.ExitCode}}' "$name" || true
echo "NGINX_LOGS:"
docker logs --tail 35 "$name" 2>&1 || true
echo "LOCAL_MANIFEST:"
docker exec "$name" wget -qO- http://127.0.0.1:8080/maps/manifest.json 2>&1 | head -c 300 || true
echo
