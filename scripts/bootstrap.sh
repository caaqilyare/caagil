#!/usr/bin/env bash
# One-step installer for a fresh Ubuntu/Debian server.
#
#   curl -fsSL https://raw.githubusercontent.com/caaqilyare/caagil/main/scripts/bootstrap.sh | sudo bash -s -- panel.example.com you@example.com
#
# Environment overrides:
#   CAAGIL_REPO   git URL (default: the public repo)
#   CAAGIL_BRANCH branch (default: main)
#   CAAGIL_DIR    install directory (default: /opt/caagil)
#   CAAGIL_ALLOW_IP=false  disable the plain-HTTP IP fallback
set -euo pipefail

REPO="${CAAGIL_REPO:-https://github.com/caaqilyare/caagil.git}"
BRANCH="${CAAGIL_BRANCH:-main}"
DIR="${CAAGIL_DIR:-/opt/caagil}"
DOMAIN="${1:-${PANEL_DOMAIN:-}}"
EMAIL="${2:-${ACME_EMAIL:-}}"

log() { printf '\033[1;32m[caagil]\033[0m %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: curl … | sudo bash -s -- panel.example.com you@example.com" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
if ! command -v git >/dev/null 2>&1; then
  log "installing git"
  apt-get update -qq
  apt-get install -y -qq git ca-certificates curl
fi

if [ -d "$DIR/.git" ]; then
  log "updating existing checkout in $DIR"
  git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" pull --ff-only origin "$BRANCH"
elif [ -e "$DIR" ]; then
  echo "$DIR exists but is not a Caagil git checkout. Move it away first." >&2
  exit 1
else
  log "cloning $REPO"
  mkdir -p "$(dirname "$DIR")"
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
fi

log "starting the installer"
PANEL_DOMAIN="$DOMAIN" ACME_EMAIL="$EMAIL" bash "$DIR/scripts/install.sh"
