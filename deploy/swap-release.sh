#!/usr/bin/env bash
set -euo pipefail

# Replace only the /retailnav subdirectory of an EXISTING web document root.
# A prebuilt release must be uploaded to .retailnav-stage-<id> beforehand.
# Usage: bash deploy/swap-release.sh /absolute/site/document/root .retailnav-stage-123
DOCROOT=${1:?Provide existing document root}
STAGE_NAME=${2:?Provide stage directory name}
[[ "$DOCROOT" = /* ]] || { echo "Document root must be absolute" >&2; exit 2; }
[[ "$STAGE_NAME" =~ ^\.retailnav-stage-[a-zA-Z0-9_-]+$ ]] || { echo "Unsafe stage name" >&2; exit 2; }
DOCROOT=$(realpath -e -- "$DOCROOT")
[[ -d "$DOCROOT" && "$DOCROOT" != / ]] || { echo "Existing document root required" >&2; exit 2; }
TARGET="$DOCROOT/retailnav"
STAGE="$DOCROOT/$STAGE_NAME"
[[ ! -L "$TARGET" && ! -L "$STAGE" ]] || { echo "Symlinks not supported" >&2; exit 2; }
[[ -d "$STAGE" && -s "$STAGE/index.html" && -s "$STAGE/maps/manifest.json" ]] || {
  echo "Missing staged RetailNav release" >&2; exit 2;
}
[[ -s "$STAGE/maps/Aventura-LL.glb" && -s "$STAGE/maps/Aventura-UL.glb" && -s "$STAGE/maps/Aventura-L3.glb" && -s "$STAGE/maps/Aventura-ALL.glb" ]] || {
  echo "Missing staged GLB models" >&2; exit 2;
}

# Backups are outside the public site root.
BACKUP_DIR="$(dirname "$DOCROOT")/retailnav-backups"
mkdir -p -- "$BACKUP_DIR"
chmod 700 -- "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
BACKUP="$BACKUP_DIR/$STAMP"

if [[ -e "$TARGET" ]]; then
  [[ -d "$TARGET" ]] || { echo "Existing retailnav path is not a directory" >&2; exit 2; }
  mv -- "$TARGET" "$BACKUP"
fi

if ! mv -- "$STAGE" "$TARGET"; then
  echo "Install failed, attempting restore" >&2
  if [[ -d "$BACKUP" && ! -e "$TARGET" ]]; then
    mv -- "$BACKUP" "$TARGET"
  fi
  exit 1
fi

[[ -s "$TARGET/index.html" ]] || {
  echo "Validation failed; rolling back" >&2
  mv -- "$TARGET" "$STAGE"
  if [[ -d "$BACKUP" ]]; then mv -- "$BACKUP" "$TARGET"; fi
  exit 1
}

echo "RetailNav installed at $TARGET"
echo "Previous version (if any): $BACKUP"
echo "Other website files and nginx configuration were not changed."
