#!/usr/bin/env bash
# Deploy Caagil from this machine to a server over SSH (development helper).
#   ACME_EMAIL=you@example.com ./scripts/deploy.sh root@203.0.113.10 panel.example.com
set -euo pipefail

TARGET="${1:-}"
DOMAIN="${2:-}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE=/opt/caagil

if [ -z "$TARGET" ]; then
  echo "Usage: ACME_EMAIL=you@example.com $0 user@server [panel.example.com]" >&2
  exit 1
fi

if [ -z "${ACME_EMAIL:-}" ]; then
  echo "Set ACME_EMAIL first, e.g. ACME_EMAIL=you@example.com $0 $TARGET $DOMAIN" >&2
  exit 1
fi

echo "→ syncing source to ${TARGET}:${REMOTE}"
ssh "$TARGET" "mkdir -p ${REMOTE}"
rsync -az --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude data \
  --exclude edge \
  --exclude .env \
  --exclude .git \
  "$DIR/" "${TARGET}:${REMOTE}/"

echo "→ installing on the server"
ssh "$TARGET" "cd ${REMOTE} && PANEL_DOMAIN='${DOMAIN}' ACME_EMAIL='${ACME_EMAIL}' bash scripts/install.sh"
