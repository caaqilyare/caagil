# Changelog

This file is read by the updater. The panel shows the newest section under
**Settings → Panel updates → What's new** before you install an update.

## 1.6.0.1 — Update details in the panel + release versioning rule

- **What's new panel** — when an update is available the panel now shows the
  incoming changelog (UI, fixes, features) instead of only "Update available".
  The full list is in the update dialog.
- **Release versioning rule** — every release increments the last segment by
  exactly one: `1.6.0.1 → 1.6.0.2 → 1.6.0.3`. Versions are never skipped.
  `npm run version:bump` (or `node scripts/next-version.mjs --write`) updates
  `lib/version.ts`, `package.json` and the lockfile together.
- `CHANGELOG.md` is now the source of truth for update notes.

## 1.6.0 — Blue-white glass UI, MongoDB Studio, phpMyAdmin fixes

- **Blue-white glassmorphism** — fixed blue/cyan/white aurora backdrop and new
  `GlassPanel` / `GlowList` / `GlowItem` components with Framer Motion entrances,
  staggered lists and hover lift. Light mode dims the aurora to 42%.
- **MongoDB Studio** — one `mongo-express` container per MongoDB database at
  `/mongo/<name>/`, protected by Traefik basic auth with a generated password
  stored encrypted. Start/stop from the panel.
- **phpMyAdmin fixed** — the signon bridge now calls `session_start()`,
  `SignonSession`/`SignonURL` are per-server (`CaaqilSignon`), and config files
  are mounted from the host data path (`HOST_DATA_DIR`).

## 1.5.0.1 — Update from unknown builds

- Builds without `CAAQIL_COMMIT` metadata can now update from inside the panel;
  the rebuild records the commit so later checks are exact.
- The stored theme is applied before paint, removing the wrong-icon flash.

## 1.5.0 — New admin UI with light and dark themes

- shadcn-style design system (CSS-variable tokens, CVA variants, tailwind-merge).
- Light / dark / system themes with a no-flash script and an Appearance picker.
- Framer Motion page transitions, sidebar active pill, modals and stat cards.
- Soft glow (`.glow-soft`, `.glow-ring`) tuned to stay comfortable at night.

## 1.4.0 — Disk saver for 15 GB servers

- `scripts/reclaim-disk.sh` safe reclaim, Storage card in Settings, capped build
  cache, 1 GB swap, Docker log rotation and journal limits.

## 1.3.0.2 and earlier

- Frosted-glass Settings redesign, username/password modals, factory reset,
  MySQL/phpMyAdmin management, cron, backups, logs, SSL, AI operator.
