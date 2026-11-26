/**
 * Self-update support. The panel container owns no checkout, so an
 * `updater` sidecar has the git repo and Docker CLI mounted. The panel talks
 * to it through `docker exec`, which keeps the update alive while the panel
 * container itself is recreated.
 *
 * Update flow (v1.2.0, fast + safe):
 *   1. tag the currently running panel image as `<image>:previous`
 *   2. git pull --ff-only
 *   3. docker compose build (BuildKit cache mounts make repeat builds fast)
 *   4. docker compose up --no-build (start ≠ build, so the UI steps are exact)
 *   5. health-check the panel for up to 90s
 *   6. on failure: automatic rollback — retag the previous image, git reset
 *      to the previous commit, restart. The panel never stays broken.
 * A manual rollback (one click in Settings) reverses the last update the
 * same instant way — no rebuild needed.
 */
import { PassThrough } from "node:stream";
import type { Readable } from "node:stream";
import { docker } from "./docker";
import { isUpdateAvailable } from "./update-version";
import { changelogBullets, parseLatestSection } from "./changelog";

const STATE_FILE = "/tmp/caaqil-update.state";
const LOG_FILE = "/tmp/caaqil-update.log";
const EXEC_TIMEOUT_MS = 30_000;

/**
 * Run git over HTTPS non-interactively and abort stalled transfers
 * (<1 KB/s for 20s) instead of hanging for 10+ minutes.
 */
const GIT_NET = "GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20";

function withTimeout(seconds: number, cmd: string): string {
  return `if command -v timeout >/dev/null 2>&1; then timeout ${seconds} sh -c '${cmd}'; else ${cmd}; fi`;
}

export type UpdateState = "idle" | "running" | "done" | "error" | "unavailable";

export type UpdateInfo = {
  /** Commit the running panel image was built from. */
  current: string;
  /** Commit currently on origin/main, if the updater could reach GitHub. */
  latest: string | null;
  available: boolean;
  running: boolean;
  state: UpdateState;
  log: string;
  error?: string;
  /** A previous version is tagged and a one-click rollback is possible. */
  canRollback?: boolean;
  /** Commit the rollback would restore. */
  previousCommit?: string | null;
  /** Newest changelog version/title from origin/main. */
  latestVersion?: string | null;
  latestTitle?: string | null;
  /** Bullet points for the incoming release, shown before installing. */
  changes?: string[];
};

async function updaterContainer() {
  const list = await docker.listContainers({ all: true });
  const hit = list.find(
    (c) =>
      c.Labels["com.docker.compose.service"] === "updater" ||
      c.Names.some((n) => /caaqil-updater|caagil-updater/.test(n)),
  );
  if (!hit) throw new Error("The updater service is not running. Re-run the installer to add it.");
  if (hit.State !== "running") throw new Error("The updater service is not running.");
  return docker.getContainer(hit.Id);
}

async function execOutput(
  container: Awaited<ReturnType<typeof updaterContainer>>,
  cmd: string[],
  timeoutMs = EXEC_TIMEOUT_MS,
): Promise<{ code: number; output: string }> {
  const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  const stream = (await exec.start({ hijack: true, stdin: false })) as Readable;
  const out = new PassThrough();
  const err = new PassThrough();
  docker.modem.demuxStream(stream, out, err);
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  err.on("data", (c: Buffer) => chunks.push(c));
  let timedOut = false;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      stream.destroy();
      resolve();
    }, timeoutMs);
    stream.on("end", () => {
      clearTimeout(timer);
      resolve();
    });
    stream.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
  if (timedOut) {
    return { code: 124, output: Buffer.concat(chunks).toString("utf8").trim() || "timed out" };
  }
  const info = (await exec.inspect()) as { ExitCode?: number };
  return { code: info.ExitCode ?? 1, output: Buffer.concat(chunks).toString("utf8").trim() };
}

function runningCommit(): string {
  return (process.env.CAAQIL_COMMIT || "").trim() || "unknown";
}

/**
 * Rollback facts, read from the updater sidecar: the previous commit recorded
 * in .env and whether its image tag still exists.
 */
async function rollbackInfo(container: Awaited<ReturnType<typeof updaterContainer>>): Promise<{
  canRollback: boolean;
  previousCommit: string | null;
}> {
  const probe = await execOutput(container, [
    "sh",
    "-lc",
    `cd /repo 2>/dev/null || exit 0
PREV=$(grep '^CAAQIL_PREV_COMMIT=' .env 2>/dev/null | tail -n 1 | cut -d= -f2)
CUR=$(grep '^CAAQIL_COMMIT=' .env 2>/dev/null | tail -n 1 | cut -d= -f2)
IMG=$(grep '^CAAQIL_PANEL_IMAGE=' .env 2>/dev/null | tail -n 1 | cut -d= -f2)
[ -z "$IMG" ] && IMG=caaqil-panel
if [ -n "$PREV" ] && [ "$PREV" != "$CUR" ] && docker image inspect "$IMG:previous" >/dev/null 2>&1; then
  echo "ok $PREV"
else
  echo no
fi`,
  ]);
  const line = probe.output.split("\n").pop()?.trim() ?? "";
  if (probe.code === 0 && line.startsWith("ok ")) {
    return { canRollback: true, previousCommit: line.slice(3).trim() || null };
  }
  return { canRollback: false, previousCommit: null };
}

let inflightCheck: Promise<UpdateInfo> | null = null;

async function readUpdaterStatus(
  container: Awaited<ReturnType<typeof updaterContainer>>,
): Promise<{ state: Exclude<UpdateState, "unavailable">; log: string }> {
  const status = await execOutput(container, [
    "sh",
    "-lc",
    `cat ${STATE_FILE} 2>/dev/null || echo idle; echo '---CAQ---'; tail -n 60 ${LOG_FILE} 2>/dev/null || true`,
  ]);
  const [statePart, ...logParts] = status.output.split("---CAQ---");
  const raw = (statePart ?? "").trim().split("\n").pop()?.trim() ?? "idle";
  const known = ["idle", "running", "done", "error"] as const;
  const state = (known as readonly string[]).includes(raw) ? (raw as (typeof known)[number]) : "idle";
  return { state, log: logParts.join("---CAQ---").trim() };
}

/** Ask the updater for origin/main and the last update state (coalesced). */
export async function checkForUpdate(): Promise<UpdateInfo> {
  if (inflightCheck) return inflightCheck;
  inflightCheck = runCheckForUpdate().finally(() => {
    inflightCheck = null;
  });
  return inflightCheck;
}

async function runCheckForUpdate(): Promise<UpdateInfo> {
  const current = runningCommit();
  let latest: string | null = null;
  let state: UpdateState = "unavailable";
  let log = "";
  let error: string | undefined;
  let canRollback = false;
  let previousCommit: string | null = null;
  let latestVersion: string | null = null;
  let latestTitle: string | null = null;
  let changes: string[] = [];

  try {
    const container = await updaterContainer();
    const fetchCmd = withTimeout(25, `${GIT_NET} fetch --quiet origin main >/dev/null 2>&1`);
    const remote = await execOutput(
      container,
      [
        "sh",
        "-lc",
        `cd /repo 2>/dev/null || exit 3; ${fetchCmd}; git rev-parse origin/main 2>/dev/null || true`,
      ],
      30_000,
    );
    if (remote.code === 3) {
      error = "The updater cannot see the install directory (/repo).";
    } else if (remote.code === 124) {
      error = "Timed out fetching origin/main from GitHub.";
    } else {
      latest = remote.output.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? null;
      if (!latest) error = "Could not read origin/main from GitHub.";
    }

    // Changelog for the incoming release: best-effort, never blocks an update.
    if (latest) {
      try {
        const notes = await execOutput(container, [
          "sh",
          "-lc",
          "cd /repo 2>/dev/null || exit 3; git show origin/main:CHANGELOG.md 2>/dev/null || true",
        ]);
        if (notes.code === 0 && notes.output) {
          const section = parseLatestSection(notes.output.slice(0, 16_000));
          if (section) {
            latestVersion = section.version;
            latestTitle = section.title;
            changes = changelogBullets(section.body, 10);
          }
        }
      } catch {
        /* changelog is optional */
      }
    }

    const status = await readUpdaterStatus(container);
    state = status.state;
    log = status.log;
    if (state === "error" && !error) error = "The last update failed. Check the log below.";

    // Rollback is offered when the panel is idle (not mid-update) and a
    // previous version is tagged.
    if (state === "idle" || state === "done") {
      const roll = await rollbackInfo(container);
      canRollback = roll.canRollback;
      previousCommit = roll.previousCommit;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    state = "unavailable";
  }

  const available = isUpdateAvailable(current, latest);
  return {
    current,
    latest,
    available,
    running: state === "running",
    state,
    log,
    ...(error ? { error } : {}),
    ...(canRollback ? { canRollback, previousCommit } : {}),
    ...(latestVersion ? { latestVersion } : {}),
    ...(latestTitle ? { latestTitle } : {}),
    ...(changes.length ? { changes } : {}),
  };
}

const HEALTH_CHECK = `
HEALTH=failed
echo "== waiting for the panel to answer"
i=0
while [ $i -lt 45 ]; do
  if wget -q -O /dev/null http://panel:4000/login 2>/dev/null; then
    HEALTH=ok
    echo "== health check ok"
    break
  fi
  sleep 2
  i=$((i+1))
done
`;

const UPDATE_SCRIPT = `
set -u
cd /repo || { echo "cannot cd /repo"; echo error > ${STATE_FILE}; exit 3; }
PIDFILE=/tmp/caaqil-update.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "an update is already running"
  exit 4
fi
echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT
echo running > ${STATE_FILE}
: > ${LOG_FILE}
echo "== update started $(date -u +%FT%TZ)"

# Remember what is running right now so a failed update can be undone
# instantly (retag the image, no rebuild).
PREV_COMMIT=$(grep '^CAAQIL_COMMIT=' .env 2>/dev/null | tail -n 1 | cut -d= -f2 || true)
IMAGE_BASE=caaqil-panel
PANEL_CID=$(docker ps -q --filter label=com.docker.compose.service=panel | head -n 1)
if [ -n "$PANEL_CID" ]; then
  RUNNING_IMG=$(docker inspect -f '{{.Image}}' "$PANEL_CID" 2>/dev/null || true)
  DETECTED=$(docker inspect -f '{{.Config.Image}}' "$PANEL_CID" 2>/dev/null | cut -d@ -f1 | cut -d: -f1 || true)
  [ -n "$DETECTED" ] && IMAGE_BASE="$DETECTED"
  if [ -n "$RUNNING_IMG" ] && docker tag "$RUNNING_IMG" "$IMAGE_BASE:previous" 2>/dev/null; then
    echo "== previous image saved as $IMAGE_BASE:previous (rollback safety net)"
  else
    echo "== warning: could not tag the previous image; rollback will be limited"
  fi
fi

echo "== fetching code from GitHub"
if ! ${withTimeout(120, `${GIT_NET} pull --ff-only origin main`)}; then
  echo "== git pull failed or timed out after 120s"
  echo error > ${STATE_FILE}
  exit 5
fi
COMMIT=$(git rev-parse HEAD)

echo "== building the new panel image (cached layers make repeat updates much faster)"
if ! DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 CAAQIL_COMMIT="$COMMIT" docker compose build panel; then
  echo "== docker compose build failed"
  echo error > ${STATE_FILE}
  exit 6
fi

echo "== restarting the panel"
if ! CAAQIL_COMMIT="$COMMIT" docker compose up -d --no-deps --no-build panel; then
  echo "== docker compose up failed"
  echo error > ${STATE_FILE}
  exit 6
fi

${HEALTH_CHECK}

if [ "$HEALTH" != ok ]; then
  echo "== the new panel did not become healthy — rolling back automatically"
  ROLLED=0
  if docker image inspect "$IMAGE_BASE:previous" >/dev/null 2>&1; then
    RUNNING_REF=$(docker inspect -f '{{.Config.Image}}' "$(docker ps -q --filter label=com.docker.compose.service=panel | head -n 1)" 2>/dev/null || true)
    if [ -n "$RUNNING_REF" ]; then
      docker tag "$IMAGE_BASE:previous" "$RUNNING_REF" && ROLLED=1
    fi
    docker tag "$IMAGE_BASE:previous" "$IMAGE_BASE:latest" && ROLLED=1
  fi
  if [ -n "$PREV_COMMIT" ] && git cat-file -e "$PREV_COMMIT" 2>/dev/null; then
    git reset --hard "$PREV_COMMIT" && ROLLED=1
  fi
  if [ "$ROLLED" = 1 ]; then
    docker compose up -d --no-deps --no-build panel || true
    if [ -n "$PREV_COMMIT" ]; then
      if grep -q '^CAAQIL_COMMIT=' .env 2>/dev/null; then
        sed -i "s|^CAAQIL_COMMIT=.*|CAAQIL_COMMIT=$PREV_COMMIT|" .env
      fi
      if grep -q '^CAAQIL_PREV_COMMIT=' .env 2>/dev/null; then
        sed -i "s|^CAAQIL_PREV_COMMIT=.*|CAAQIL_PREV_COMMIT=$COMMIT|" .env
      else
        echo "CAAQIL_PREV_COMMIT=$COMMIT" >> .env
      fi
    fi
    echo "== rolled back to the previous version — the panel is up again"
  else
    echo "== rollback was not possible (no previous image was tagged)"
  fi
  echo "== update failed; the previous version is running"
  echo error > ${STATE_FILE}
  exit 7
fi

if grep -q '^CAAQIL_PANEL_IMAGE=' .env 2>/dev/null; then
  sed -i "s|^CAAQIL_PANEL_IMAGE=.*|CAAQIL_PANEL_IMAGE=$IMAGE_BASE|" .env
else
  echo "CAAQIL_PANEL_IMAGE=$IMAGE_BASE" >> .env
fi
if [ -n "$PREV_COMMIT" ]; then
  if grep -q '^CAAQIL_PREV_COMMIT=' .env 2>/dev/null; then
    sed -i "s|^CAAQIL_PREV_COMMIT=.*|CAAQIL_PREV_COMMIT=$PREV_COMMIT|" .env
  else
    echo "CAAQIL_PREV_COMMIT=$PREV_COMMIT" >> .env
  fi
fi
# Persist the new commit only after a verified healthy start, so a failed
# update leaves the old value in .env and the rollback pointer intact.
if grep -q '^CAAQIL_COMMIT=' .env 2>/dev/null; then
  sed -i "s|^CAAQIL_COMMIT=.*|CAAQIL_COMMIT=$COMMIT|" .env
else
  echo "CAAQIL_COMMIT=$COMMIT" >> .env
fi

# Clean up orphaned images, dangling layers and build caches to prevent disk exhaustion
echo "== freeing disk space: pruning dangling images and build cache"
docker image prune -f --filter "dangling=true" 2>/dev/null || true
docker builder prune -f --keep-storage 1GB 2>/dev/null || true
docker container prune -f 2>/dev/null || true
docker network prune -f 2>/dev/null || true

echo "== done $(date -u +%FT%TZ) — running $COMMIT"
echo done > ${STATE_FILE}
`;

const ROLLBACK_SCRIPT = `
set -u
cd /repo || { echo "cannot cd /repo"; echo error > ${STATE_FILE}; exit 3; }
PIDFILE=/tmp/caaqil-update.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "an update is already running"
  exit 4
fi
echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT
echo running > ${STATE_FILE}
: > ${LOG_FILE}
echo "== rollback started $(date -u +%FT%TZ)"

PREV_COMMIT=$(grep '^CAAQIL_PREV_COMMIT=' .env 2>/dev/null | tail -n 1 | cut -d= -f2 || true)
CUR_COMMIT=$(grep '^CAAQIL_COMMIT=' .env 2>/dev/null | tail -n 1 | cut -d= -f2 || true)
IMAGE_BASE=$(grep '^CAAQIL_PANEL_IMAGE=' .env 2>/dev/null | tail -n 1 | cut -d= -f2 || true)
[ -z "$IMAGE_BASE" ] && IMAGE_BASE=caaqil-panel

if [ -z "$PREV_COMMIT" ]; then
  echo "== no previous version is recorded — nothing to roll back to"
  echo error > ${STATE_FILE}
  exit 8
fi
if ! docker image inspect "$IMAGE_BASE:previous" >/dev/null 2>&1; then
  echo "== the previous panel image is not available anymore"
  echo error > ${STATE_FILE}
  exit 8
fi

echo "== switching the checkout to $PREV_COMMIT"
${withTimeout(20, `${GIT_NET} fetch --quiet origin main 2>/dev/null || true`)}
if ! git reset --hard "$PREV_COMMIT"; then
  echo "== could not check out the previous commit"
  echo error > ${STATE_FILE}
  exit 8
fi

echo "== restoring the previous panel image"
PANEL_CID=$(docker ps -aq --filter label=com.docker.compose.service=panel | head -n 1)
if [ -n "$PANEL_CID" ]; then
  RUNNING_REF=$(docker inspect -f '{{.Config.Image}}' "$PANEL_CID" 2>/dev/null || true)
  [ -n "$RUNNING_REF" ] && docker tag "$IMAGE_BASE:previous" "$RUNNING_REF" 2>/dev/null || true
fi
docker tag "$IMAGE_BASE:previous" "$IMAGE_BASE:latest"

# Swap the pointers so rolling back can itself be undone.
if grep -q '^CAAQIL_PREV_COMMIT=' .env 2>/dev/null; then
  sed -i "s|^CAAQIL_PREV_COMMIT=.*|CAAQIL_PREV_COMMIT=$CUR_COMMIT|" .env
fi
if grep -q '^CAAQIL_COMMIT=' .env 2>/dev/null; then
  sed -i "s|^CAAQIL_COMMIT=.*|CAAQIL_COMMIT=$PREV_COMMIT|" .env
fi

echo "== restarting the panel on the previous version"
docker compose up -d --no-deps --no-build panel || true

${HEALTH_CHECK}

if [ "$HEALTH" != "ok" ]; then
  echo "== the panel did not come back healthy after the rollback — check docker logs"
  echo error > ${STATE_FILE}
  exit 9
fi

echo "== rollback complete — running $PREV_COMMIT"
echo done > ${STATE_FILE}
`;

/** Kick off `git pull` + rebuild of the panel in the updater sidecar.
 * Detached so the request can return before the panel container restarts. */
export async function startUpdate(): Promise<{ started: true }> {
  const container = await updaterContainer();
  const status = await readUpdaterStatus(container);
  if (status.state === "running") throw new Error("An update is already running.");

  const exec = await container.exec({
    Cmd: ["sh", "-lc", `${UPDATE_SCRIPT} >> ${LOG_FILE} 2>&1`],
    AttachStdout: false,
    AttachStderr: false,
  });
  await exec.start({ Detach: true, stdin: false });
  return { started: true };
}

/** One-click rollback to the previously tagged panel image. Detached. */
export async function startRollback(): Promise<{ started: true }> {
  const container = await updaterContainer();
  const status = await readUpdaterStatus(container);
  if (status.state === "running") throw new Error("An update is already running.");
  const roll = await rollbackInfo(container);
  if (!roll.canRollback) {
    throw new Error("No previous version is available to roll back to.");
  }

  const exec = await container.exec({
    Cmd: ["sh", "-lc", `${ROLLBACK_SCRIPT} >> ${LOG_FILE} 2>&1`],
    AttachStdout: false,
    AttachStderr: false,
  });
  await exec.start({ Detach: true, stdin: false });
  return { started: true };
}
