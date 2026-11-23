#!/usr/bin/env bash
# Caaqil server installer — run as root on Ubuntu/Debian.
# Creates swap, installs Docker, writes .env and boots the stack.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

PANEL_DOMAIN="${PANEL_DOMAIN:-${1:-}}"
PANEL_NAME="${PANEL_NAME:-Caaqil}"
ACME_EMAIL="${ACME_EMAIL:-${2:-}}"
PANEL_DOMAIN="$(printf '%s' "$PANEL_DOMAIN" | tr '[:upper:]' '[:lower:]')"
if [ -n "$PANEL_DOMAIN" ] && [ -z "$ACME_EMAIL" ]; then
  ACME_EMAIL="admin@${PANEL_DOMAIN}"
fi
# The first visit creates the owner account. For unattended installs set
# CAAQIL_AUTO_ADMIN=true together with ADMIN_EMAIL and ADMIN_PASSWORD.
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
AUTO_ADMIN="${CAAQIL_AUTO_ADMIN:-${CAAGIL_AUTO_ADMIN:-false}}"
DATA_DIR="${CAAQIL_DATA_DIR:-${CAAGIL_DATA_DIR:-/opt/caaqil/data}}"
EDGE_DIR="${CAAQIL_EDGE_DIR:-${CAAGIL_EDGE_DIR:-/opt/caaqil/edge}}"
ALLOW_IP="${CAAQIL_ALLOW_IP:-${CAAGIL_ALLOW_IP:-true}}"

log() { printf '\033[1;32m[caaqil]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[caaqil]\033[0m %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root (sudo)." >&2
  exit 1
fi

if [ -n "$PANEL_DOMAIN" ] && ! printf '%s' "$PANEL_DOMAIN" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'; then
  echo "PANEL_DOMAIN must look like panel.example.com (no scheme or path)." >&2
  exit 1
fi

# ── swap: 2 GB hosts need headroom for Docker builds ──────────────
mem_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
if [ "$mem_mb" -lt 3000 ] && [ ! -f /swapfile ]; then
  log "adding 4 GB swap (host has ${mem_mb} MB RAM)"
  fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ── docker ───────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg git rsync ufw

  # Prefer the distro packages: on brand-new Ubuntu releases the Docker
  # apt repository often has no suite for the codename yet.
  if apt-cache policy docker.io 2>/dev/null | grep -q Candidate; then
    log "installing docker.io from the distribution repository"
    apt-get install -y -qq docker.io docker-compose-v2
  else
    log "installing Docker from download.docker.com"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    suite=$(. /etc/os-release && echo "$VERSION_CODENAME")
    for candidate in "$suite" noble jammy; do
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${candidate} stable" \
        > /etc/apt/sources.list.d/docker.list
      if apt-get update -qq 2>/dev/null; then break; fi
    done
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  systemctl enable --now docker
else
  log "docker already installed"
fi

if ! docker compose version >/dev/null 2>&1; then
  warn "docker compose plugin missing — installing"
  apt-get install -y -qq docker-compose-v2 || apt-get install -y -qq docker-compose-plugin
fi


# ── firewall ─────────────────────────────────────────────────────
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80,443/tcp >/dev/null 2>&1 || true
  yes | ufw enable >/dev/null 2>&1 || true
fi

# ── env ──────────────────────────────────────────────────────────
# Installs created before the rename keep their existing MySQL database and
# user, Docker volumes and network. Renaming those would orphan live data.
if [ -f .env ] && ! grep -q '^CAAQIL_LAYOUT=caaqil' .env; then
  log "keeping legacy database/volume/network names from the previous layout"
  sed -i 's/^CAAGIL_/CAAQIL_/' .env
  grep -q '^COMPOSE_PROJECT_NAME=' .env || echo "COMPOSE_PROJECT_NAME=caagil" >> .env
  grep -q '^PANEL_NETWORK=' .env || echo "PANEL_NETWORK=caagil" >> .env
  grep -q '^PANEL_DB_NAME=' .env || echo "PANEL_DB_NAME=caagil" >> .env
  grep -q '^PANEL_DB_USER=' .env || echo "PANEL_DB_USER=caagil" >> .env
  grep -q '^CAAQIL_MYSQL_VOLUME=' .env || echo "CAAQIL_MYSQL_VOLUME=caagil_caagil-mysql" >> .env
  grep -q '^CAAQIL_LETSENCRYPT_VOLUME=' .env || echo "CAAQIL_LETSENCRYPT_VOLUME=caagil_caagil-letsencrypt" >> .env
  echo "CAAQIL_LAYOUT=caaqil" >> .env
  saved_dir="$(grep -m1 '^CAAQIL_DATA_DIR=' .env | cut -d= -f2- || true)"
  saved_edge="$(grep -m1 '^CAAQIL_EDGE_DIR=' .env | cut -d= -f2- || true)"
  if [ -n "$saved_dir" ]; then DATA_DIR="$saved_dir"; fi
  if [ -n "$saved_edge" ]; then EDGE_DIR="$saved_edge"; fi
fi

mkdir -p "$DATA_DIR/sites" "$EDGE_DIR"
if [ ! -f .env ]; then
  log "writing .env"
  cat > .env <<EOF
AUTH_SECRET=$(openssl rand -hex 32)
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
CAAQIL_AUTO_ADMIN=${AUTO_ADMIN}
PANEL_DB_ROOT_PASSWORD=$(openssl rand -hex 18)
PANEL_DB_PASSWORD=$(openssl rand -hex 18)
PANEL_DOMAIN=${PANEL_DOMAIN}
PANEL_NAME=${PANEL_NAME}
ACME_EMAIL=${ACME_EMAIL}
CAAQIL_DATA_DIR=${DATA_DIR}
CAAQIL_EDGE_DIR=${EDGE_DIR}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}
CAAQIL_LAYOUT=caaqil
EOF
  chmod 600 .env
else
  log ".env already exists — keeping it"
fi

if [ -n "$PANEL_DOMAIN" ] && [ -z "$ACME_EMAIL" ]; then
  warn "ACME_EMAIL is empty: HTTPS certificate issuance will fail."
fi

# ── edge routing (Traefik file provider) ─────────────────────────
# On re-runs, report the domain that actually exists in .env.
if [ -f .env ]; then
  saved_domain="$(grep -m1 '^PANEL_DOMAIN=' .env | cut -d= -f2- || true)"
  if [ -n "$saved_domain" ]; then PANEL_DOMAIN="$saved_domain"; fi
fi

ip=$(curl -s -4 --max-time 6 https://ifconfig.me/ip 2>/dev/null || true)
if ! printf '%s' "$ip" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
allow_ip_effective=false
if [ "$ALLOW_IP" != "false" ] && printf '%s' "$ip" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
  allow_ip_effective=true
fi

if [ -z "$PANEL_DOMAIN" ] && [ "$allow_ip_effective" != "true" ]; then
  echo "Set PANEL_DOMAIN (panel.example.com) or allow IP access to reach the panel." >&2
  exit 1
fi

if [ -f "$EDGE_DIR/panel.yml" ] && [ "${CAAQIL_RESET_EDGE:-${CAAGIL_RESET_EDGE:-false}}" != "true" ]; then
  log "edge config already exists — keeping it (CAAQIL_RESET_EDGE=true regenerates)"
else
  log "writing edge config for ${PANEL_DOMAIN:-http://$ip}"
  {
    echo "# Managed by Caaqil. Change this from Settings → Access in the panel."
    echo "http:"
    echo "  routers:"
    if [ -n "$PANEL_DOMAIN" ]; then
      echo "    caaqil-panel:"
      printf '      rule: "Host(`%s`)"\n' "$PANEL_DOMAIN"
      echo "      entryPoints: [websecure]"
      echo "      service: caaqil-panel"
      echo "      priority: 150"
      echo "      tls:"
      echo "        certResolver: le"
      echo "    caaqil-panel-http:"
      printf '      rule: "Host(`%s`)"\n' "$PANEL_DOMAIN"
      echo "      entryPoints: [web]"
      echo "      service: caaqil-panel"
      echo "      middlewares: [caaqil-panel-https]"
      echo "      priority: 150"
    fi
    if [ "$allow_ip_effective" = "true" ]; then
      echo "    caaqil-panel-ip:"
      printf '      rule: "Host(`%s`)"\n' "$ip"
      echo "      entryPoints: [web]"
      echo "      service: caaqil-panel"
      echo "      priority: 160"
    fi
    echo "  middlewares:"
    echo "    caaqil-panel-https:"
    echo "      redirectScheme:"
    echo "        scheme: https"
    echo "        permanent: true"
    echo "  services:"
    echo "    caaqil-panel:"
    echo "      loadBalancer:"
    echo "        servers:"
    echo '          - url: "http://panel:4000"'
  } > "$EDGE_DIR/panel.yml"
  chmod 644 "$EDGE_DIR/panel.yml"
fi

# ── boot ─────────────────────────────────────────────────────────
log "building and starting the stack (this takes a few minutes)"
docker compose up -d --build

log "waiting for the panel…"
for i in $(seq 1 90); do
  if docker compose exec -T panel wget -qO- http://127.0.0.1:4000/login >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

panel_lines=""
if [ -n "$PANEL_DOMAIN" ]; then
  panel_lines+="    Panel   https://${PANEL_DOMAIN}"$'\n'
fi
if [ "$allow_ip_effective" = "true" ]; then
  panel_lines+="    IP      http://${ip}"$'\n'
fi

if [ "$AUTO_ADMIN" = "true" ] && [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  account_lines="    Login   ${ADMIN_EMAIL}"$'\n'"    Pass    ${ADMIN_PASSWORD}"$'\n'
else
  account_lines="    First visit creates your owner username and password."$'\n'
fi

cat <<EOF

  Caaqil is up.

${panel_lines}${account_lines}    Data    ${DATA_DIR}
    Edge    ${EDGE_DIR}/panel.yml

  Point an A record for ${PANEL_DOMAIN:-your domain} at ${ip} and Traefik issues
  the certificate on the first HTTPS request. Until then, use the IP address
  over HTTP (you can turn that off in Settings → Access).

EOF
