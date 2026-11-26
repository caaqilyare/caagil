# Changelog

This file is read by the updater. The panel shows the newest section under
**Settings → Panel updates → What's new** before you install an update.

## 1.6.0.4 — phpMyAdmin fix, MongoDB Studio redesign, AI Memory/History/App Editor & Custom AI API

- **phpMyAdmin fixed** — `internalSecret()` now decrypts the stored secret instead
  of returning the encrypted `v1:...` blob, container naming avoids the double
  `caaqil-caaqil-phpmyadmin` prefix, and asset writing removes stale directories
  and sets `0644` permissions so `www-data` can always read the signon bridge.
- **MongoDB Studio redesign** — upgraded `MongoStudioCard` with an AdminUX
  gradient hero header, live status pulse, encrypted credential vault with
  one-click copy & reveal, and cleaner Start/Open actions.
- **AI Operator Memory, Chat History & App Editor** — added `ai_threads` and
  `ai_memories` tables, chat history sidebar (`+ New Chat`, thread switching &
  deletion), persistent memory (`remember_fact`, `list_memories`, `forget_memory`),
  custom AI rules (`ai_custom_rules`), and app file tools (`list_app_files`,
  `read_app_file`, `write_app_file`, `mkdir_app`, `delete_app_file`) so the AI
  can design and edit apps directly.
- **Custom AI Provider in Settings** — added `Custom API` provider with API Base
  URL (link), protocol (`OpenAI-compatible` / `Anthropic-compatible`), Model ID,
  Model Name, API Key, and Custom AI Operator Rules.

## 1.6.0.3 — Fix GitHub update fetch hanging for 10+ minutes

- **Updater timeouts** — added a 30s timeout to Docker exec calls, a 25s
  timeout to `checkForUpdate()` fetches, and a 120s timeout to `git pull` in
  the update script so stalled GitHub connections fail fast instead of hanging.
- **Non-interactive & low-speed abort** — `GIT_TERMINAL_PROMPT=0` and
  `http.lowSpeedLimit=1000` / `http.lowSpeedTime=20` prevent `git` from waiting
  on prompts or stalled sockets.
- **Coalesced checks & fast start** — concurrent `checkForUpdate()` calls share
  one in-flight fetch, and `startUpdate()` / `startRollback()` read the updater
  state directly without blocking on a duplicate `git fetch`.

## 1.6.0.2 — AdminUX blue theme, components, shell & login redesign

- **Color & typography system** — adopted the AdminUX `.theme-blue` palette
  (`#0049e8` primary, `#4cbdff` secondary, `#03045e` / `#ab13c5` accents,
  `#eef3fc` → `#bfdbfb` radial background gradient) with `SUSE` headings and
  `Open Sans` body typography, plus matching dark-mode tokens (`#01051b` → `#09113d`).
- **Buttons, cards & list components** — updated `Button` variants (`primary`,
  `accent`, `outline`, `dashed`, `subtle`, `success`, `danger`, `lg` / `icon`),
  `Card` (`1.15rem` radius, clean light surface, hover lift), and added
  `ListGroup` / `ListItem` (`default` and borderless `minimal` variants).
- **Shell & navigation** — 280px frosted-glass sidebar with `#0049e8` active pill,
  68px topbar that transitions from transparent to frosted glass on scroll, and
  centered `300px` Quick Find search bar.
- **Login page** — full-bleed AdminUX gradient backdrop, transparent header,
  centered `426px` rounded card with password visibility toggle, full-width
  `Login` button, and `#0049e8` footer bar.

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
