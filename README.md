# Caaqil

A fast, AI-native hosting control panel. One container, one MySQL, one
Traefik — it deploys PHP, Node.js and static sites, runs databases with optional
public access, manages MySQL users and phpMyAdmin, schedules cron jobs, takes
backups, and ships an AI operator that can actually do the work.

```
Panel UI      Next.js 15 (App Router) + Tailwind, shadcn-style glass UI (light + dark)
Panel data    MySQL 8.4 (sessions, apps, databases, domains, activity)
Apps          Docker containers on the `caaqil` bridge network
Routing       Traefik v3 + Let's Encrypt (HTTP-01), automatic HTTPS
AI            OpenAI · Anthropic · DeepSeek via Vercel AI SDK, tool calling
Deploy        docker compose up -d --build  (portable, single directory)
```

## What it does

| Area | Capability |
| --- | --- |
| Applications | PHP 8.2/8.3/8.4 (Apache), Laravel, WordPress, Node 20/22, static Nginx, any custom image |
| WordPress one-click | Auto-install with its own MySQL database, admin user + password, and a live URL — cPanel/Softaculous style |
| Source | Clone from Git over HTTPS/SSH, redeploy with one click |
| Databases | MySQL, MariaDB, PostgreSQL, MongoDB, Redis — on the internal network as `db-<name>` |
| MongoDB Studio | Per-database mongo-express at `/mongo/<name>/` behind Traefik basic auth — start/stop from the panel |
| MySQL administration | Create/drop schemas, manage users + grants, export/import SQL dumps on the panel's own MySQL server |
| phpMyAdmin | One-click phpMyAdmin at `<panel>/pma` with one-time signon tokens — no root exposure, no passwords in URLs |
| Remote DB | Publish a public port + `'user'@'%'` grant, or attach an external MySQL and query it read-only |
| Domains | Pick an existing domain or type a new one; attach many hostnames per app; auto certificates |
| Path routing | Mount an app under `/name` on the panel domain (or any host), e.g. `https://panel.example.com/blog` — WordPress keeps the prefix in `wp-admin`/auth redirects and pretty permalinks resolve |
| Cron jobs | 5-field cron engine with per-run history, output capture, timeouts, panel- or app-container execution |
| Backups | tar.gz file archives + gzip database dumps, verify/restore/download, per-target retention |
| Metrics history | 1-minute samples for CPU/memory/disk, dashboard sparklines (1h–30d), disk/memory alerts |
| Logs | Filterable activity feed + failed-cron output viewer at `/logs` |
| Files | Built-in file manager per app: browse, edit, upload, rename and delete `data/sites/<app>` |
| Access | Change the panel domain, rename the panel, or reach it at `http://IP` — all from Settings, no compose edits |
| AI operator | Chat agent with 13 tools: create/delete apps, databases, domains, mount paths, read logs, system stats |
| Ops | Live CPU/mem/disk with 24h sparklines, container logs, start/stop/restart, activity log |
| Security | Login rate limiting, same-origin enforcement on all mutating APIs, security headers, AES-256-GCM secret encryption, background session/token cleanup |

## phpMyAdmin

Databases → **phpMyAdmin** → *Install & start*. The panel:

1. Provisions a dedicated MySQL user `caaqil_pma` that has privileges **only**
   on managed app databases (`wp_%`) — never global rights, never the panel
   database, never root.
2. Writes a phpMyAdmin `config.user.inc.php` (`auth_type = signon`) and a
   signon bridge script into `data/pma/` and mounts them read-only into a
   panel-managed `phpmyadmin:5.2-apache` container on the `caaqil` network.
3. Routes it through Traefik at `https://<panel-domain>/pma`.

Clicking **Open phpMyAdmin** creates a **single-use, 60-second token** (only its
SHA-256 hash is stored). The browser is redirected to the signon bridge, which
exchanges the token server-to-server (shared internal secret) for the limited
MySQL credentials and starts the phpMyAdmin session. MySQL passwords never
appear in URLs, referrer headers or logs, and the token cannot be replayed.
Changing the panel domain/IP in Settings automatically recreates the container
with the new routing labels. Stop removes the container; starting again is
one click.

**Fixed in v1.6.0:** the signon bridge now calls `session_start()` before writing
the `PMA_single_signon_*` values (without it every signon bounced back to the
login form), `SignonSession`/`SignonURL` are set per server as phpMyAdmin
expects, the signon session has its own name (`CaaqilSignon`), and the config
files are mounted from the **host** data path (`HOST_DATA_DIR`) instead of the
panel container's internal path.

## MongoDB Studio

Databases → **MongoDB Studio** appears for every panel-created MongoDB
database. It is a per-database [mongo-express](https://github.com/mongo-express/mongo-express)
container (`mongo-express:1.0.2-20`):

- **Start studio** creates `caaqil-mongo-studio-<name>`, connects it with that
  database's own root credentials over the internal `db-<name>` alias, and
  routes it at `https://<panel-domain>/mongo/<name>/`.
- **Basic auth** is enforced by Traefik. The username is `caaqil` and the
  password is generated once, stored encrypted in the panel database, and shown
  in the card (reveal/copy). It never appears in a URL.
- **Stop studio** removes the container; the MongoDB database itself keeps
  running. Deleting the database removes its studio and stored credentials too.
- Changing the panel domain/IP recreates running studios with the new labels.

## MySQL administration

Also on the Databases page, for the panel's own MySQL server (the one that
hosts `wp_*` WordPress databases):

- **Server info** — version, uptime, connection count, total size.
- **Databases** — create/drop schemas, per-database size and table counts,
  download a `.sql` dump (mysqldump `--single-transaction`), import a dump
  (≤ 64 MB) straight into an existing database.
- **Users & privileges** — create users with generated 24+ char passwords,
  reset passwords, delete users; every identifier is validated
  (`[a-z][a-z0-9_]`) and quoted, and root credentials never leave the mysql
  container (all statements run through `docker exec`).

## Cron jobs

Ops → **Cron jobs**. Standard 5-field crontab expressions with presets
(`*/5 * * * *`, daily, weekly, monthly…), executed by the panel's background
scheduler once per matched minute (idempotent — a restart never double-runs a
slot). Each job can run:

- in the **panel container** (`sh -lc`, for host-side maintenance), or
- inside an **app container** (`docker exec` + `timeout`, busybox compatible).

Every run records exit code, duration and up to 16 KB of output; the history
dialog shows the last 50 runs with expandable output, and failures appear in
`/logs` and the activity feed. Timeouts are enforced (5 s – 1 h).

## Backups

Ops → **Backups**:

- **App files** — `tar.gz` of `data/sites/<app>`.
- **Databases** — `mysqldump | gzip` of any managed database.
- **Verify** — integrity-check the gzip/tar stream before you need it.
- **Restore** — files: the current directory is moved aside as
  `<app>.pre-restore` first; databases: the dump's own DROP/CREATE statements
  are applied.
- **Download** — authenticated streaming download for off-server storage.
- **Retention** — the newest 10 backups per target are kept; older ones are
  pruned by the scheduler.

Backups live on the same disk as the panel (`data/backups/`) — download
important ones off the server.

## Metrics history & alerts

The scheduler samples CPU, memory and disk once per minute into MySQL and the
dashboard renders 24-hour sparklines next to each gauge. `/api/metrics?range=`
serves bucket-averaged series for 1h / 6h / 24h / 7d / 30d. When disk or memory
crosses 90%, an alert is written to the activity feed at most once per hour.

## Logs

Ops → **Logs** combines the panel activity feed with failed cron-run output.
Filter by text, toggle *errors only*, auto-refresh every 30 s. Also available
at `GET /api/logs`.

## Command palette

Press **Ctrl/Cmd + K** anywhere in the panel for quick page navigation.
The sidebar is grouped into Overview / Hosting / Databases / Operations / System.

## Appearance & themes

The panel ships a shadcn-style design system built on CSS-variable tokens
(`hsl(var(--…))`), Lucide icons and Framer Motion.

- **Light / Dark / System** — switch with the sun/moon button in the top bar, or
  pick explicitly in **Settings → Appearance**. The choice is stored per browser
  (`localStorage: caaqil-theme`) and follows the OS while set to *System*.
- **No flash** — a tiny inline script applies the theme class before the first
  paint, so a light-mode user never sees a dark frame.
- **Soft glow, not neon** — `.glow-soft` / `.glow-ring` use low-opacity rings and
  wide blooms; ambient background blobs drop to 40% opacity in light mode to
  keep contrast comfortable.
- **Blue-white aurora glass** — a fixed backdrop of blue, cyan and white blobs
  (`.aurora`) lights the shadcn-style `.glass-panel` cards from v1.6.0. Cards
  and lists stagger in with Framer Motion (`GlowList` / `GlowItem`) and lift on
  hover; light mode tones the aurora down to 42%.
- **Motion** — page transitions, the sidebar active indicator, modals, the
  theme toggle and dashboard stat cards animate with Framer Motion and respect
  `prefers-reduced-motion`.

All existing screens were kept API-compatible: the light theme remaps the older
`text-white` / `bg-white/*` / `border-white/*` / `bg-ink-*` utilities through a
compatibility layer in `app/globals.css`, so no page had to be rewritten.

> **Already updated but still see the old UI?** The panel is served from a built
> image, so the code only changes after the image is rebuilt. Open
> **Settings → Panel updates → Update now** (or run the manual commands below),
> then hard-refresh the browser with **Ctrl/Cmd + Shift + R**.

## Local development

```bash
cp .env.example .env      # fill PANEL_DB_* — no admin account is needed
npm install
npm test                  # unit tests (cron parser, crypto, validators, …)
npm run dev               # http://localhost:4000/setup
```

You need a reachable MySQL for the panel database. The first visit opens the
setup wizard where you choose the owner username and password. The AI operator
needs one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY` (or set
the key in Settings → AI).

## One-line install (fresh server)

Requirements: Ubuntu/Debian, root SSH, 1.5 GB RAM, 15 GB+ disk. Point a DNS
`A` record at the server first (or use the automatic IP fallback).

```bash
curl -fsSL https://raw.githubusercontent.com/caaqilyare/caaqil-host/main/scripts/bootstrap.sh \
  | sudo bash
```

It clones the repo to `/opt/caaqil`, adds 4 GB swap on hosts with limited RAM, installs
Docker, generates secrets, writes the Traefik edge config, and boots the stack.

**First visit:** open `http://SERVER-IP` and choose the owner username (or
email) and password. The panel starts on plain HTTP so it works before DNS.
Then go to Settings → Panel domain, enter your domain, point DNS at the server,
and HTTPS is issued automatically.

To install with a domain from the start, pass it as an argument:

```bash
curl -fsSL …/bootstrap.sh | sudo bash -s -- panel.example.com you@example.com
```

Re-running the same command updates the code and keeps `.env`, app data and the
edge config. An install from before the rename, still in `/opt/caagil`, is moved
to `/opt/caaqil` automatically (with `/opt/caagil` left as a symlink so running
app containers keep their bind mounts).

## Upgrading an install made before the rename

Installs created when the project was called Caagil keep their existing MySQL
database and user, Docker volumes and network — the installer pins the old
`caagil` names in `.env` so live data is never orphaned. New installs use the
`caaqil` names everywhere. To install a fork or private mirror:

```bash
CAAQIL_REPO=git@github.com:you/caaqil-host.git sudo -E bash scripts/bootstrap.sh
```

Unattended provisioning (skip the wizard):

```bash
curl -fsSL https://raw.githubusercontent.com/caaqilyare/caaqil-host/main/scripts/bootstrap.sh -o /tmp/bootstrap.sh
sudo CAAQIL_AUTO_ADMIN=true ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='a-long-password' \
  bash /tmp/bootstrap.sh panel.example.com you@example.com
```

## Change the panel domain (after install)

Settings → Panel:

- **Panel domain** — serve the panel on a new hostname. Point DNS at the server
  first; Traefik requests the certificate automatically. Apps mounted under
  `/path` on the old domain are moved to the new one.
- **Public IP** + **IP access** — also serve the panel at `http://IP` (no
  certificate needed). Useful before DNS is ready or for recovery. Plain HTTP
  sends the password unencrypted, so turn it off once HTTPS works.
- **Panel name** — rebrand the UI.

These write `/opt/caaqil/edge/panel.yml`, which Traefik watches. No restart and
no compose edits.

## Update the panel from GitHub

Every install includes an `updater` sidecar with the git checkout and the
Docker socket mounted. **Settings → Panel updates** checks `origin/main` every
few minutes (and on demand with the refresh icon):

1. A pulsing **Update available** badge appears when GitHub has new commits,
   with `main @ abc1234 · you run def5678`.
2. **Update now** runs `git pull --ff-only`, rebuilds only the panel image and
   recreates only the panel container. MySQL, apps and volumes keep running.
3. A progress overlay shows each step and the live build log; the page reloads
   by itself when the new panel answers.

The running commit is baked into the image (`CAAQIL_COMMIT`) by
`scripts/install.sh`. Builds created before that metadata existed report
`Version unknown`; as of v1.5.0.1 they still get an **Update now** button, and
the rebuild writes the commit so later checks are exact. A build with no
updater sidecar at all still needs `scripts/install.sh` re-run once.

Manual update, same thing on the server:

```bash
cd /opt/caaqil
git pull --ff-only
docker compose up -d --build panel
```

If an update fails, the panel keeps running the old image and the log is shown
in the overlay. Re-run `bash /opt/caaqil/scripts/install.sh` to restore the
sidecar if it was removed.

### Rollback safety net

Before every update the running panel image is tagged `<image>:previous` and
the current commit is recorded in `.env`. The updater then:

1. pulls `origin/main` (`--ff-only`),
2. rebuilds with BuildKit cache mounts (repeat updates reuse layers instead of
   recompiling from zero),
3. starts the new container without rebuilding again, and
4. health-checks `http://panel:4000/login` for up to 90 s.

If the new panel does not answer, it **rolls back automatically**: the previous
image is retagged and restarted, and the checkout returns to the previous
commit. The panel never stays broken.

**Settings → Panel updates → Roll back** does the same thing on demand for the
last successful update (instant — it retags the saved image, no rebuild). A
rollback can itself be undone because the pointers are swapped.

## Create an app (domain or path)

Apps → New application — a three-step wizard:

1. **Source** — name, runtime, and where the code comes from: *Fresh start* or
   *GitHub repository* (URL + branch, cloned on first install).
2. **Configure** — domain (existing or new), path route with live URL preview,
   WordPress one-click options (admin user/password/email) when the runtime is
   WordPress, and extra environment variables.
3. **Deploy** — a summary (including the WP admin password, shown once), then a
   live animated progress screen: checking settings → cloning the repository →
   creating the MySQL database → creating the database user → pulling the image
   → starting the container & routing → installing WordPress. The deploy runs in
   the background, so closing the wizard does not cancel it; when it finishes
   you get direct links to the site and wp-admin.

Other things to know:

- **Domain** — pick an existing hostname from the list or type a new one. It is
  attached to the app and gets a certificate automatically.
- **Path route** — leave the domain empty and set a path such as `/blog` to get
  `https://panel.example.com/blog`. The host defaults to the panel domain; pick
  another host to mount it on a different domain. "Strip prefix" is on by
  default, so the app sees `/` instead of `/blog`.
- **Domains** button — attach extra hostnames later (add-on domains).
- **Files** button — open the file manager for `data/sites/<app>`: browse
  folders, edit text files, upload (8 MB), rename and delete. Downloads are
  authenticated by your panel session.

## WordPress one-click install

Pick the **WordPress** runtime and the panel does what a hosting control panel
should: it creates a dedicated database (`wp_<app>`) and user on the panel's
MySQL server, wires `WORDPRESS_DB_*` + HTTPS-behind-proxy config into the
container, gives the site a URL (`https://domain` or `https://panel/<name>` when
you leave the domain empty), then runs `wp core install` so the site is ready to
log into — no `/wp-admin/install.php` wizard.

You choose in the create dialog:

- **Site title**
- **Admin username**
- **Admin password** (auto-generated, can be regenerated/shown)
- **Admin email**

Afterwards the app card shows the database name, user and password (with a
copy button), a `wp-admin` link, and a **WP** button to run the installer again
(for example after pointing the app at a new domain). Deleting the app drops its
database and user too.

## Portability / migrating to another host

Everything lives in `/opt/caaqil`:

```
/opt/caaqil/docker-compose.yml   stack definition
/opt/caaqil/.env                 secrets
/opt/caaqil/edge/panel.yml       panel domain + IP routing (Traefik file provider)
/opt/caaqil/data/sites/          app sources, bind-mounted into every app (Git or uploaded)
Docker volumes: caaqil-mysql, caaqil-letsencrypt, caaqil-db-<name>
```

Move to another server:

```bash
# old host
docker compose down
tar czf caaqil-backup.tgz .env docker-compose.yml edge data
docker run --rm -v caaqil-mysql:/v -v $PWD:/out alpine tar czf /out/mysql.tgz -C /v .

# new host
scp caaqil-backup.tgz root@new-host:/opt/caaqil/
cd /opt/caaqil && tar xzf caaqil-backup.tgz
docker compose up -d --build
```

Application data volumes (`caaqil-db-*`) can be migrated the same way. DNS
points at the new IP and certificates are re-issued automatically.

> Installs from before the rename still use `caagil-mysql`, `caagil-letsencrypt`
> and `caagil-db-*` volume names (and a `caagil` MySQL database). Substitute the
> old names in the commands above for those hosts.

## SSL management (cPanel-style "Add SSL")

Every hostname is probed live — **Domains** shows a badge per domain
(`Let's Encrypt · 82d left`, `no SSL yet`, …) and a **Check SSL** button refreshes
the probes.

- When a domain is added, Traefik requests the certificate immediately and the
  panel watches in the background, logging `certificate live` once HTTPS works.
- If a certificate is missing (DNS was late, rate limit, …) press **Add SSL** on
  the domain card — or next to the panel domain in **Settings**. It runs a
  step-by-step job: checking DNS → refreshing the HTTPS route → requesting the
  Let's Encrypt certificate → verifying HTTPS, and tells you exactly what failed
  (e.g. "does not resolve in DNS yet — add an A record → 193.x.x.x first").

## Disk usage on small servers (15 GB)

Caaqil keeps its own footprint bounded:

| Item | Typical size | Guard |
| --- | --- | --- |
| Panel image | 450–650 MB | one image, rebuilt in place |
| MySQL image + data | 600 MB–1.5 GB | binlogs disabled (`--disable-log-bin`) |
| Traefik | ~180 MB | — |
| Updater sidecar | ~60 MB | — |
| Docker build cache | ≤ 1 GB | capped after every install and update |
| Swap file | 1 GB | only created when RAM < 3 GB |
| Container logs | ≤ 20 MB per container | `max-size 10m`, `max-file 2` (daemon-wide) |
| App images | 150–600 MB each | PHP/Apache is the heavy one |

A fresh install (OS + panel + MySQL + Traefik + one PHP app) is roughly
**3.5–5 GB**. With a handful of apps and their data, **6–8 GB** is the normal
range, leaving useful headroom on a 15 GB disk.

> Older installs could reach 12 GB because the build cache grew without a cap,
> container logs were unbounded and the installer created a 4 GB swap file.
> Those are fixed, and the reclaim script below cleans an existing server.

### Reclaim space (safe, one command)

```bash
sudo bash /opt/caaqil/scripts/reclaim-disk.sh          # safe cleanup
sudo bash /opt/caaqil/scripts/reclaim-disk.sh --deep   # also drop the build cache
```

It removes stopped containers, dangling images, unused networks, build cache
beyond 1 GB, container logs over 20 MB, old journal files and APT caches, and
shrinks a 2–4 GB swap file to 1 GB. It **never** removes volumes, running
containers, tagged images (including the `:previous` rollback tag), site files
or backups.

The same actions are available in **Settings → Disk & Storage**: a live
breakdown (images, containers, build cache, volumes, site files, backups), the
reclaimable total, and **Safe cleanup** / **Deep clean** buttons.

> ⚠️ Never run `docker system prune --volumes` or `docker volume prune` on this
> server — that deletes the MySQL volume and your databases.

## Security model

- Sessions are server-side rows; cookies are `httpOnly`, signed with `AUTH_SECRET`.
- Passwords use scrypt with per-user salt.
- **Login rate limiting** — failed sign-ins are counted per source IP (10) and
  per account (8) over a sliding 15-minute window; successful sign-ins clear
  their record. Replies stay generic and the limit never breaks availability
  (it fails open if the table is unreachable).
- **Same-origin enforcement** — every mutating API (`/api/actions`, file
  operations, setup, login helpers) rejects requests whose `Origin`/`Referer`
  does not match the serving host, on top of `SameSite=Lax` cookies.
- **Security headers** — `X-Frame-Options: DENY`, `nosniff`, restrictive
  `Referrer-Policy` and `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- **Secret encryption at rest** — database credentials and internal secrets in
  the `settings` table are encrypted with AES-256-GCM (key derived from
  `AUTH_SECRET` via scrypt, `enc:v1:` prefix); legacy plaintext rows still
  decrypt transparently.
- **Background cleanup** — the scheduler prunes expired sessions, login
  attempts, phpMyAdmin tokens and stale metric samples.
- The panel mounts `/var/run/docker.sock` — it is root-equivalent on the host, so
  only expose it behind HTTPS and a strong admin password.
- Remote database access is opt-in per database, with generated 24-char passwords.
- AI keys are stored in MySQL (encrypted) and never sent to the browser.
- phpMyAdmin runs with a least-privilege MySQL user and one-time signon tokens;
  root credentials are never shared with it.
