#!/usr/bin/env bash
# Install RetailNav static assets only under the explicitly supplied document root.
set -euo pipefail
if [[ -z "${RETAILNAV_DOCROOT:-}" ]]; then
  echo "ERROR: set RETAILNAV_DOCROOT to the VERIFIED document root of improvingyourreality.com" >&2
  exit 2
fi
for tool in realpath rsync tar python3; do
  command -v "$tool" >/dev/null || { echo "ERROR: missing $tool" >&2; exit 2; }
done
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../public" && pwd -P)"
root="$(realpath -- "${RETAILNAV_DOCROOT}")"
if [[ ! -d "$root" || "$root" == "/" || "$root" == "/root" || "$root" == "/home" ]]; then
  echo "ERROR: unsafe or missing document root: $root" >&2
  exit 2
fi
target="$root/retailnav"
if [[ -L "$target" ]]; then
  echo "ERROR: the target is a symlink; do not overwrite it." >&2
  exit 2
fi
# Generate portable GLB assets reproducibly from the checked-in vectors.
python3 "$(dirname "${BASH_SOURCE[0]}")/../scripts/build-glb.py" "$source_dir"
test -s "$source_dir/index.html" || { echo "ERROR: missing viewer HTML" >&2; exit 2; }
test -s "$source_dir/maps/manifest.json" || { echo "ERROR: missing manifest" >&2; exit 2; }
for floor in LL UL L3; do
  test -s "$source_dir/maps/$floor.json" || { echo "ERROR: missing $floor" >&2; exit 2; }
done
python3 - "$source_dir" <<'PY'
import json, pathlib, sys
base=pathlib.Path(sys.argv[1])
manifest=json.loads((base/'maps/manifest.json').read_text())
assert [f['id'] for f in manifest['floors']]==['LL','UL','L3']
for f in manifest['floors']:
    p=base / 'maps' / (f['id']+'.json')
    d=json.loads(p.read_text())
    assert d['id']==f['id'] and len(d['geometry'])>0, p
print('RetailNav source manifest and floors verified')
PY
if [[ ! -w "$root" ]]; then
  echo "ERROR: no write permission for $root; rerun with sudo if appropriate." >&2
  exit 3
fi
if [[ -e "$target" && ! -d "$target" ]]; then
  echo "ERROR: target exists but is not a directory." >&2
  exit 3
fi
if [[ -d "$target" ]]; then
  owner="${SUDO_USER:-${USER:-unknown}}"
  backup_home="$(getent passwd "$owner" | cut -d: -f6 || true)"
  backup_root="${backup_home:-/root}/retailnav-backups"
  mkdir -p "$backup_root"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup="$backup_root/retailnav-$stamp.tar.gz"
  tar -czf "$backup" -C "$root" retailnav
  echo "Backup saved outside webroot: $backup"
fi
mkdir -p "$target"
# The delete scope is restricted to a single explicitly validated subdirectory.
rsync -a --delete -- "$source_dir/" "$target/"
echo "Installed RetailNav to $target"
echo "CHECK: curl -fSI https://improvingyourreality.com/retailnav/"
echo "CHECK: curl -fS https://improvingyourreality.com/retailnav/maps/manifest.json"
echo "No Nginx or Docker configuration was modified."
