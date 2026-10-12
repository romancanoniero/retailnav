#!/usr/bin/env bash
set -euo pipefail
# Run on the Contabo VPS only after confirming the EXISTING document root
# from nginx -T or the reverse-proxy configuration.
# Usage: bash deploy/install-from-github.sh /absolute/site/document/root
DOCROOT=${1:?Provide the existing document root for improvingyourreality.com}
[[ "$DOCROOT" = /* ]] || { echo "Document root must be absolute" >&2; exit 2; }
DOCROOT=$(realpath -e -- "$DOCROOT")
[[ -d "$DOCROOT" && "$DOCROOT" != / ]] || { echo "Invalid document root" >&2; exit 2; }

for program in curl tar python3 mktemp; do
  command -v "$program" >/dev/null || { echo "Missing executable: $program" >&2; exit 3; }
done

TMPDIR=$(mktemp -d)
trap 'rm -rf -- "$TMPDIR"' EXIT
SRC_TAR="$TMPDIR/retailnav.tar.gz"
SOURCE_URL="https://github.com/romancanoniero/retailnav/archive/refs/heads/main.tar.gz"

echo "Fetching source from $SOURCE_URL"
curl --proto '=https' --tlsv1.2 -fLSs --connect-timeout 15 --max-time 90 "$SOURCE_URL" -o "$SRC_TAR"
mkdir -p -- "$TMPDIR/source"
tar -xzf "$SRC_TAR" -C "$TMPDIR/source" --strip-components=1
cd "$TMPDIR/source"

python3 tools/verify_maps.py
python3 tools/build_glb.py
python3 tools/verify_maps.py --require-glb

STAMP="$(date -u +%Y%m%dT%H%M%S)-$$"
STAGE_NAME=".retailnav-stage-$STAMP"
STAGE="$DOCROOT/$STAGE_NAME"
mkdir -- "$STAGE"
cp -a public/. "$STAGE/"

bash deploy/swap-release.sh "$DOCROOT" "$STAGE_NAME"
echo "Check https://improvingyourreality.com/retailnav/ in Safari."
echo "This installer does not alter nginx, Docker, existing sites or DNS."
