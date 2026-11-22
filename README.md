# Caagil

A small, fast, AI-native hosting control panel. One container, one MySQL, one
Traefik — it deploys PHP, Node.js and static sites, runs databases with optional
public access, and ships an AI operator that can actually do the work.

```
Panel UI      Next.js 15 (App Router) + Tailwind, dark glass UI
Panel data    MySQL 8.4 (sessions, apps, databases, domains, activity)
Apps          Docker containers on the `caagil` bridge network
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
| Remote DB | Publish a public port + `'user'@'%'` grant, or attach an external MySQL and query it read-only |
| Domains | Pick an existing domain or type a new one; attach many hostnames per app; auto certificates |
| Path routing | Mount an app under `/name` on the panel domain (or any host), e.g. `https://panel.example.com/blog` |
| Files | Built-in file manager per app: browse, edit, upload, rename and delete `data/sites/<app>` |
| Access | Change the panel domain, rename the panel, or reach it at `http://IP` — all from Settings, no compose edits |
| AI operator | Chat agent with 13 tools: create/delete apps, databases, domains, mount paths, read logs, system stats |
| Ops | Live CPU/mem/disk, container logs, start/stop/restart, activity log |

## Local development

```bash
cp .env.example .env      # fill PANEL_DB_* — no admin account is needed
npm install
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
curl -fsSL https://raw.githubusercontent.com/caaqilyare/caagil/main/scripts/bootstrap.sh \
  | sudo bash
```

It clones the repo to `/opt/caagil`, adds 4 GB swap on small hosts, installs
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
edge config. To install a fork or private mirror:

```bash
CAAGIL_REPO=git@github.com:you/caagil.git sudo -E bash scripts/bootstrap.sh
```

Unattended provisioning (skip the wizard):

```bash
curl -fsSL https://raw.githubusercontent.com/caaqilyare/caagil/main/scripts/bootstrap.sh -o /tmp/bootstrap.sh
sudo CAAGIL_AUTO_ADMIN=true ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='a-long-password' \
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

These write `/opt/caagil/edge/panel.yml`, which Traefik watches. No restart and
no compose edits.

## Create an app (domain or path)

Apps → New application:

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

Everything lives in `/opt/caagil`:

```
/opt/caagil/docker-compose.yml   stack definition
/opt/caagil/.env                 secrets
/opt/caagil/edge/panel.yml       panel domain + IP routing (Traefik file provider)
/opt/caagil/data/sites/          app sources, bind-mounted into every app (Git or uploaded)
Docker volumes: caagil-mysql, caagil-letsencrypt, caagil-db-<name>
```

Move to another server:

```bash
# old host
docker compose down
tar czf caagil-backup.tgz .env docker-compose.yml edge data
docker run --rm -v caagil-mysql:/v -v $PWD:/out alpine tar czf /out/mysql.tgz -C /v .

# new host
scp caagil-backup.tgz root@new-host:/opt/caagil/
cd /opt/caagil && tar xzf caagil-backup.tgz
docker compose up -d --build
```

Application data volumes (`caagil-db-*`) can be migrated the same way. DNS
points at the new IP and certificates are re-issued automatically.

## Resource notes

2 GB RAM is the floor. A busy stack (panel + MySQL + MongoDB + two apps) wants
4 GB. The installer adds 4 GB swap so Docker builds do not OOM the host. Keep an
eye on Settings → disk: build cache is the usual culprit.

```bash
docker system prune -af --volumes   # reclaim space when needed
```

## Security model

- Sessions are server-side rows; cookies are `httpOnly`, signed with `AUTH_SECRET`.
- Passwords use scrypt with per-user salt.
- The panel mounts `/var/run/docker.sock` — it is root-equivalent on the host, so
  only expose it behind HTTPS and a strong admin password.
- Remote database access is opt-in per database, with generated 24-char passwords.
- AI keys are stored in MySQL and never sent to the browser.
