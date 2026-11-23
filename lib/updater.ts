/**
 * Self-update support. The panel container owns no checkout, so an
 * `updater` sidecar has the git repo and Docker CLI mounted. The panel talks
 * to it through `docker exec`, which keeps the update alive while the panel
 * container itself is recreated.
 */
import { PassThrough } from "node:stream";
import type { Readable } from "node:stream";
import { docker } from "./docker";

const STATE_FILE = "/tmp/caaqil-update.state";
const LOG_FILE = "/tmp/caaqil-update.log";

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
): Promise<{ code: number; output: string }> {
  const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  const stream = (await exec.start({ hijack: true, stdin: false })) as Readable;
  const out = new PassThrough();
  const err = new PassThrough();
  docker.modem.demuxStream(stream, out, err);
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  err.on("data", (c: Buffer) => chunks.push(c));
  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  const info = (await exec.inspect()) as { ExitCode?: number };
  return { code: info.ExitCode ?? 1, output: Buffer.concat(chunks).toString("utf8").trim() };
}

function runningCommit(): string {
  return (process.env.CAAQIL_COMMIT || "").trim() || "unknown";
}

function sameCommit(a: string, b: string): boolean {
  if (!a || !b || a === "unknown" || b === "unknown") return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/** Ask the updater for origin/main and the last update state. */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = runningCommit();
  let latest: string | null = null;
  let state: UpdateState = "unavailable";
  let log = "";
  let error: string | undefined;

  try {
    const container = await updaterContainer();
    const remote = await execOutput(container, [
      "sh",
      "-lc",
      "cd /repo 2>/dev/null || exit 3; git fetch --quiet origin main >/dev/null 2>&1; git rev-parse origin/main 2>/dev/null || true",
    ]);
    if (remote.code === 3) {
      error = "The updater cannot see the install directory (/repo).";
    } else {
      latest = remote.output.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? null;
      if (!latest) error = "Could not read origin/main from GitHub.";
    }

    const status = await execOutput(container, [
      "sh",
      "-lc",
      `cat ${STATE_FILE} 2>/dev/null || echo idle; echo '---CAQ---'; tail -n 40 ${LOG_FILE} 2>/dev/null || true`,
    ]);
    const [statePart, ...logParts] = status.output.split("---CAQ---");
    const raw = (statePart ?? "").trim().split("\n").pop()?.trim() ?? "idle";
    const known = ["idle", "running", "done", "error"] as const;
    state = (known as readonly string[]).includes(raw) ? (raw as (typeof known)[number]) : "idle";
    log = logParts.join("---CAQ---").trim();
    if (state === "error" && !error) error = "The last update failed. Check the log below.";
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    state = "unavailable";
  }

  const available = Boolean(latest && !sameCommit(current, latest));
  return {
    current,
    latest,
    available,
    running: state === "running",
    state,
    log,
    ...(error ? { error } : {}),
    // A build without commit metadata cannot be compared; keep the badge off.
    ...(current === "unknown" ? { available: false } : {}),
  };
}

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
if ! git pull --ff-only origin main; then
  echo "== git pull failed"
  echo error > ${STATE_FILE}
  exit 5
fi
COMMIT=$(git rev-parse HEAD)
echo "== building panel at $COMMIT (the panel restarts when this finishes)"
if ! CAAQIL_COMMIT="$COMMIT" docker compose up -d --build --no-deps panel; then
  echo "== docker compose failed"
  echo error > ${STATE_FILE}
  exit 6
fi
# Persist the new commit only after a successful build, so a failed update
# leaves the old value in .env and the running container keeps reporting it.
if grep -q '^CAAQIL_COMMIT=' .env 2>/dev/null; then
  sed -i "s|^CAAQIL_COMMIT=.*|CAAQIL_COMMIT=$COMMIT|" .env
else
  echo "CAAQIL_COMMIT=$COMMIT" >> .env
fi
echo "== done $(date -u +%FT%TZ)"
echo done > ${STATE_FILE}
`;

/** Kick off `git pull` + rebuild of the panel in the updater sidecar.
 * Detached so the request can return before the panel container restarts. */
export async function startUpdate(): Promise<{ started: true }> {
  const container = await updaterContainer();
  const info = await checkForUpdate();
  if (info.running) throw new Error("An update is already running.");

  const exec = await container.exec({
    Cmd: ["sh", "-lc", `${UPDATE_SCRIPT} >> ${LOG_FILE} 2>&1`],
    AttachStdout: false,
    AttachStderr: false,
  });
  await exec.start({ Detach: true, stdin: false });
  return { started: true };
}
