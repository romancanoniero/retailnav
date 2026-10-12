#!/usr/bin/env bash
# Read-only server inventory. Run through an SSH transport; no configuration is changed.
set -uo pipefail
echo "=== RetailNav VPS inventory (read-only) ==="
echo "USER=$(id -un) GROUPS=$(id -Gn)"
echo "HOST=$(hostname -f 2>/dev/null || hostname)"
echo "HOME=$HOME"
echo "=== WEB SOFTWARE ==="
for tool in nginx caddy apache2 docker podman curl python3; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf '%s=%s\n' "$tool" "$(command -v "$tool")"
  fi
done
echo "=== LISTENING SOCKETS 80/443 ==="
ss -lntp 2>/dev/null | grep -E ':(80|443)[[:space:]]' | head -n 15 || true
echo "=== DOCKER SERVICES (if readable) ==="
docker ps --format 'table {{.Names}}\t{{.Ports}}' 2>/dev/null | head -n 35 || true
echo "=== CONFIGURATION SNAPSHOT (sanitized directives only) ==="
scratch="$(mktemp)"
trap 'rm -f -- "$scratch"' EXIT
chmod 600 "$scratch"
if command -v nginx >/dev/null 2>&1; then
  if nginx -T > "$scratch" 2>/dev/null; then
    echo "NGINX_CONFIG_READ=user"
  elif sudo -n nginx -T > "$scratch" 2>/dev/null; then
    echo "NGINX_CONFIG_READ=sudo-no-password"
  elif [ -n "${RN_SUDO_PASS:-}" ] && printf '%s\n' "$RN_SUDO_PASS" | sudo -S -p '' nginx -T > "$scratch" 2>/dev/null; then
    echo "NGINX_CONFIG_READ=sudo-with-password"
  else
    echo "NGINX_CONFIG_READ=unavailable"
  fi
  python3 - "$scratch" <<'PY'
import re,sys,os
lines=open(sys.argv[1],errors="replace").read().splitlines()
pattern=re.compile(r'^\s*(?:server_name|listen|root|alias|location|try_files|index|proxy_pass|include|rewrite|return)\b')
markers=[i for i,line in enumerate(lines) if 'improvingyourreality.com' in line and re.search(r'\bserver_name\b',line)]
if not markers:
    print("DOMAIN_SERVER_BLOCK=not located in host nginx configuration")
for i in markers[:8]:
    print("DOMAIN_SERVER_LINE",i+1)
    for k in range(max(0,i-10),min(len(lines),i+100)):
        line=lines[k].strip()
        if pattern.search(line):
            # Sanitize URLs with credentials, if unexpectedly configured.
            line=re.sub(r'(?i)(password|token|secret|authorization)=[^; ]+',r'\1=[REDACTED]',line)
            print("  line",k+1,line[:200])
print("NGINX_CONFIG_DIRECTIVE_COUNT",len(lines))
PY
fi
echo "=== SITE CANDIDATE DIRECTORIES (metadata only) ==="
for root in /var/www /var/www/html /srv/www /opt /home/iankmp /etc/nginx/sites-enabled; do
  if [ -e "$root" ]; then
    ls -ld -- "$root" 2>/dev/null || true
  fi
done
echo "=== SITE MOUNT PATHS ==="
docker inspect improvingyourreality-site-1 --format '{{range .Mounts}}{{println .Source " -> " .Destination}}{{end}}' 2>/dev/null || true
echo "=== HOST CONFIG CHECK COMPLETE ==="
