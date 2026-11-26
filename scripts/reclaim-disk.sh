#!/usr/bin/env bash
# Reclaim disk space on a small (15 GB) Caaqil server.
#
#   sudo bash /opt/caaqil/scripts/reclaim-disk.sh
#   sudo bash /opt/caaqil/scripts/reclaim-disk.sh --deep        # also drop the whole build cache
#   sudo bash /opt/caaqil/scripts/reclaim-disk.sh --no-swap     # leave the swap file alone
#   sudo bash /opt/caaqil/scripts/reclaim-disk.sh --swap=512M   # shrink swap to 512 MB
#
# What it removes: stopped containers, dangling (<none>) images, unused
# networks, build cache beyond ~1 GB, oversized container JSON logs, journal
# files and APT caches. What it NEVER removes: volumes (MySQL/app data),
# running containers, tagged images (including the :previous rollback tag),
# site files or backups.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEEP=false
SKIP_SWAP=false
SWAP_SIZE="${CAAQIL_SWAP_SIZE:-1G}"

for arg in "$@"; do
  case "$arg" in
    --deep) DEEP=true ;;
    --no-swap) SKIP_SWAP=true ;;
    --swap=*) SWAP_SIZE="${arg#*=}" ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

log() { printf '\033[1;32m[caaqil]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[caaqil]\033[0m %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

human() { du -sh "$1" 2>/dev/null | awk '{print $1}' || true; }

log "install directory: $DIR"
log "disk before:"
df -h / | tail -n 1

HAVE_DOCKER=false
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  HAVE_DOCKER=true
  echo
  log "Docker usage before:"
  docker system df || true
fi

if $HAVE_DOCKER; then
  # 1. Stopped containers (never running ones).
  log "removing stopped containers"
  docker container prune -f || true

  # 2. Dangling images only. Tagged images — app bases, :latest, :previous —
  #    are kept so running apps and update rollback keep working.
  log "removing dangling images"
  docker image prune -f || true

  # 3. Unused networks.
  log "removing unused networks"
  docker network prune -f || true

  # 4. Build cache. Keep 1 GB so the next panel update is still fast; --deep
  #    drops everything and the next update rebuilds from scratch.
  if $DEEP; then
    log "deep-cleaning the whole Docker build cache (next update will be slower)"
    docker builder prune -af || true
  else
    log "trimming build cache to 1 GB"
    docker builder prune -f --keep-storage 1GB || true
  fi

  # 5. Container JSON logs. Docker's default json-file driver has no size cap
  #    for containers created before daemon.json was configured, so an app can
  #    quietly write gigabytes. Truncating a live log is safe.
  if [ -d /var/lib/docker/containers ]; then
    log "truncating container logs larger than 20 MB (was $(human /var/lib/docker/containers))"
    find /var/lib/docker/containers -type f -name '*-json.log' -size +20M \
      -exec truncate -s 0 {} \; 2>/dev/null || true
    log "container logs now $(human /var/lib/docker/containers)"
  fi

  # 6. Global log rotation for containers created from now on (the panel
  #    creates app containers through the API, so compose-level caps are not
  #    enough). Only touch daemon.json when it does not exist — never clobber
  #    a custom data-root or registry mirror.
  DAEMON=/etc/docker/daemon.json
  if [ ! -f "$DAEMON" ]; then
    log "writing /etc/docker/daemon.json (10 MB × 2 log rotation)"
    mkdir -p /etc/docker
    cat > "$DAEMON" <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "2"
  }
}
JSON
    if command -v systemctl >/dev/null 2>&1; then
      log "restarting Docker to apply log rotation (containers restart automatically)"
      systemctl restart docker || warn "docker restart failed — run: systemctl restart docker"
      for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
    fi
  elif ! grep -q '"max-size"' "$DAEMON"; then
    warn "$DAEMON exists without log rotation — add this yourself, then restart Docker:"
    printf '  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "2" }\n'
  fi
fi

# 7. systemd journal.
if command -v journalctl >/dev/null 2>&1; then
  log "vacuuming the systemd journal to 100 MB"
  journalctl --vacuum-size=100M >/dev/null 2>&1 || true
fi

# 8. APT caches (safe: only downloaded .deb files).
log "clearing APT caches"
apt-get clean >/dev/null 2>&1 || true
rm -rf /var/cache/apt/archives/*.deb 2>/dev/null || true

# 9. MySQL binary logs. Binlogging is disabled now (`--disable-log-bin`), but
#    installs that ran before that flag can still carry gigabytes of old
#    binlog files inside the mysql volume. This is a standalone server, so
#    purging them is safe.
if $HAVE_DOCKER && [ -f "$DIR/.env" ]; then
  ROOT_PW="$(grep -m1 '^PANEL_DB_ROOT_PASSWORD=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
  if [ -n "$ROOT_PW" ] && docker ps --format '{{.Names}}' 2>/dev/null | grep -Eq 'mysql'; then
    log "purging old MySQL binary logs"
    if ( cd "$DIR" && docker compose exec -T -e MYSQL_PWD="$ROOT_PW" mysql \
        mysql -uroot -e "PURGE BINARY LOGS BEFORE NOW();" >/dev/null 2>&1 ); then
      log "binary logs purged"
    else
      warn "could not purge binary logs (binlogging may already be off)"
    fi
  fi
fi

# 10. Swap file. The installer used to create 2–4 GB; 1 GB is enough headroom
#    for a 15 GB disk. swapoff fails while swap is in active use, in which
#    case the file is left untouched.
if ! $SKIP_SWAP && [ -f /swapfile ]; then
  cur_bytes=$(stat -c%s /swapfile 2>/dev/null || echo 0)
  target_bytes=$(numfmt --from=iec "$SWAP_SIZE" 2>/dev/null || echo 1073741824)
  if [ "$cur_bytes" -gt "$target_bytes" ]; then
    log "shrinking swap from $(numfmt --to=iec "$cur_bytes") to $SWAP_SIZE"
    if swapoff /swapfile 2>/dev/null; then
      rm -f /swapfile
      if ! fallocate -l "$SWAP_SIZE" /swapfile 2>/dev/null; then
        dd if=/dev/zero of=/swapfile bs=1M count=$((target_bytes / 1024 / 1024)) status=none
      fi
      chmod 600 /swapfile
      mkswap /swapfile >/dev/null
      swapon /swapfile
      grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
      log "swap is now $(numfmt --to=iec "$(stat -c%s /swapfile)")"
    else
      warn "swap is in active use; keeping the current swap file (try again after a reboot)"
    fi
  else
    log "swap is already $(numfmt --to=iec "$cur_bytes") — no change"
  fi
fi

echo
if $HAVE_DOCKER; then
  log "Docker usage after:"
  docker system df || true
  echo
fi
log "disk after:"
df -h / | tail -n 1

echo
log "done. Volumes, databases, site files and backups were not touched."
if ! $DEEP; then
  log "build cache kept at ~1 GB so panel updates stay fast. Use --deep to remove it too."
fi
