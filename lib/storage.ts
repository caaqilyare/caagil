/**
 * Disk-usage inspection and safe reclamation.
 *
 * Everything here goes through the Docker Engine API on the mounted socket —
 * the panel image has no `docker` CLI. Cleanup is deliberately conservative:
 *
 *   - stopped containers      → removed
 *   - dangling (<none>) images → removed
 *   - unused networks         → removed
 *   - BuildKit build cache    → capped (1 GB by default, 0 with `deep`)
 *
 * Volumes are **never** pruned: they hold MySQL data and app state. Running
 * images, tagged images (including the `:previous` rollback tag) and bind
 * mounts are left untouched, so an update rollback keeps working.
 */
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { DATA_DIR, docker } from "./docker";

export type StorageCategoryKey =
  | "images"
  | "containers"
  | "buildCache"
  | "volumes"
  | "appData"
  | "backups";

export type StorageCategory = {
  key: StorageCategoryKey;
  label: string;
  bytes: number;
  /** Bytes the automatic cleanup can free (volumes and data stay at 0). */
  reclaimableBytes: number;
  note: string;
};

export type StorageImage = {
  tags: string[];
  bytes: number;
  inUse: boolean;
  created: number;
};

export type StorageVolume = {
  name: string;
  bytes: number;
  inUse: boolean;
};

export type StorageInfo = {
  disk: { totalBytes: number; usedBytes: number; freeBytes: number; percent: number };
  categories: StorageCategory[];
  dockerBytes: number;
  reclaimableBytes: number;
  dockerOk: boolean;
  images: StorageImage[];
  volumes: StorageVolume[];
  buildCacheCount: number;
  swap: { totalBytes: number; usedBytes: number } | null;
  updatedAt: number;
};

export type CleanupResult = {
  reclaimedBytes: number;
  details: string[];
  info: StorageInfo;
};

type RawImage = {
  Id: string;
  RepoTags?: string[] | null;
  Created: number;
  Size: number;
  SharedSize?: number;
  Containers: number;
};

type RawContainer = {
  Id: string;
  Names?: string[];
  Image: string;
  State: string;
  SizeRw?: number;
  Created: number;
};

type RawVolume = {
  Name: string;
  CreatedAt?: string;
  UsageData?: { Size: number; RefCount: number } | null;
};

type RawBuildCache = {
  ID?: string;
  Type?: string;
  Size: number;
  InUse: boolean;
  Shared?: boolean;
  CreatedAt?: string;
  LastUsedAt?: string;
};

type RawDf = {
  LayersSize?: number;
  Images?: RawImage[];
  Containers?: RawContainer[];
  Volumes?: RawVolume[];
  BuildCache?: RawBuildCache[];
};

async function rawDf(): Promise<RawDf> {
  const df = (await docker.df()) as RawDf;
  return df ?? {};
}

async function diskUsage(): Promise<StorageInfo["disk"]> {
  try {
    const st = await fs.statfs(process.env.DATA_DIR || DATA_DIR || "/");
    const totalBytes = Number(st.blocks) * Number(st.bsize);
    const freeBytes = Number(st.bavail) * Number(st.bsize);
    const usedBytes = totalBytes - freeBytes;
    return {
      totalBytes,
      usedBytes,
      freeBytes,
      percent: totalBytes ? Math.round((usedBytes / totalBytes) * 100) : 0,
    };
  } catch {
    return { totalBytes: 0, usedBytes: 0, freeBytes: 0, percent: 0 };
  }
}

/** Recursive directory size with a hard entry cap so huge trees cannot hang a request. */
async function dirSize(root: string, maxEntries = 40_000): Promise<number> {
  let total = 0;
  let seen = 0;
  const stack = [root];
  while (stack.length > 0 && seen < maxEntries) {
    const dir = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++seen >= maxEntries) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          total += (await fs.stat(full)).size;
        } catch {
          /* vanished file — ignore */
        }
      }
    }
  }
  return total;
}

async function swapUsage(): Promise<StorageInfo["swap"]> {
  try {
    const meminfo = await fs.readFile("/proc/meminfo", "utf8");
    const value = (key: string) => {
      const m = meminfo.match(new RegExp(`^${key}:\\s+(\\d+) kB`, "m"));
      return m ? Number(m[1]) * 1024 : 0;
    };
    const totalBytes = value("SwapTotal");
    if (!totalBytes) return null;
    return { totalBytes, usedBytes: totalBytes - value("SwapFree") };
  } catch {
    return null;
  }
}

export type StorageDfImage = {
  RepoTags?: string[] | null;
  Size: number;
  SharedSize?: number;
  Containers?: number;
};

/** An image with no usable tag is dangling and safe to prune. */
export function isDanglingImage(image: StorageDfImage): boolean {
  const tags = image.RepoTags ?? [];
  return tags.length === 0 || tags.every((t) => !t || t.startsWith("<none>"));
}

/** Unique-ish size: Docker reports shared layers separately. */
export function imageUniqueBytes(image: StorageDfImage): number {
  const size = Math.max(0, Number(image.Size) || 0);
  const shared = Math.max(0, Number(image.SharedSize) || 0);
  return Math.max(0, size - shared);
}

const isDangling = (image: RawImage) => isDanglingImage(image);
const uniqueImageBytes = (image: RawImage) => imageUniqueBytes(image);

function buildCategories(df: RawDf, appDataBytes: number, backupsBytes: number): StorageCategory[] {
  const images = df.Images ?? [];
  const containers = df.Containers ?? [];
  const volumes = df.Volumes ?? [];
  const buildCache = df.BuildCache ?? [];

  const imagesBytes = images.reduce((sum, i) => sum + uniqueImageBytes(i), 0);
  const danglingBytes = images
    .filter(isDangling)
    .reduce((sum, i) => sum + uniqueImageBytes(i), 0);

  const stopped = containers.filter((c) => c.State !== "running");
  const stoppedBytes = stopped.reduce((sum, c) => sum + Math.max(0, Number(c.SizeRw) || 0), 0);

  const volumesBytes = volumes.reduce(
    (sum, v) => sum + Math.max(0, Number(v.UsageData?.Size) || 0),
    0,
  );
  const unusedVolumeBytes = volumes
    .filter((v) => (v.UsageData?.RefCount ?? 0) === 0)
    .reduce((sum, v) => sum + Math.max(0, Number(v.UsageData?.Size) || 0), 0);

  const cacheBytes = buildCache.reduce((sum, b) => sum + Math.max(0, Number(b.Size) || 0), 0);
  const unusedCacheBytes = buildCache
    .filter((b) => !b.InUse)
    .reduce((sum, b) => sum + Math.max(0, Number(b.Size) || 0), 0);

  return [
    {
      key: "images",
      label: "Docker images",
      bytes: imagesBytes,
      reclaimableBytes: danglingBytes,
      note: "Running images, app base images and the :previous rollback tag are kept.",
    },
    {
      key: "containers",
      label: "Containers",
      bytes: containers.reduce((sum, c) => sum + Math.max(0, Number(c.SizeRw) || 0), 0),
      reclaimableBytes: stoppedBytes,
      note: `${stopped.length} stopped container${stopped.length === 1 ? "" : "s"} can be removed.`,
    },
    {
      key: "buildCache",
      label: "Build cache",
      bytes: cacheBytes,
      reclaimableBytes: unusedCacheBytes,
      note: "Kept at ~1 GB so future panel updates stay fast.",
    },
    {
      key: "volumes",
      label: "Volumes",
      bytes: volumesBytes,
      reclaimableBytes: 0,
      note: `Never pruned automatically — holds MySQL and app data${
        unusedVolumeBytes > 0 ? ` (${formatBytes(unusedVolumeBytes)} unreferenced)` : ""
      }.`,
    },
    {
      key: "appData",
      label: "Site files",
      bytes: appDataBytes,
      reclaimableBytes: 0,
      note: "Your deployed app files under data/sites.",
    },
    {
      key: "backups",
      label: "Backups",
      bytes: backupsBytes,
      reclaimableBytes: 0,
      note: "data/backups — retention keeps the newest 3 per target.",
    },
  ];
}

export async function storageInfo(): Promise<StorageInfo> {
  let dockerOk = true;
  const [df, disk, swap, appDataBytes, backupsBytes] = await Promise.all([
    rawDf().catch(() => {
      dockerOk = false;
      return {} as RawDf;
    }),
    diskUsage(),
    swapUsage(),
    dirSize(path.join(DATA_DIR, "sites")),
    dirSize(path.join(DATA_DIR, "backups")),
  ]);

  const categories = buildCategories(df, appDataBytes, backupsBytes);
  const dockerKeys: StorageCategoryKey[] = ["images", "containers", "buildCache", "volumes"];
  const dockerBytes = categories
    .filter((c) => dockerKeys.includes(c.key))
    .reduce((sum, c) => sum + c.bytes, 0);
  const reclaimableBytes = categories.reduce((sum, c) => sum + c.reclaimableBytes, 0);

  const images: StorageImage[] = (df.Images ?? [])
    .map((i) => ({
      tags: (i.RepoTags ?? []).filter((t) => t && !t.startsWith("<none>")),
      bytes: uniqueImageBytes(i),
      inUse: (i.Containers ?? 0) > 0,
      created: Number(i.Created) || 0,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 12);

  const volumes: StorageVolume[] = (df.Volumes ?? [])
    .map((v) => ({
      name: v.Name,
      bytes: Math.max(0, Number(v.UsageData?.Size) || 0),
      inUse: (v.UsageData?.RefCount ?? 0) > 0,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 12);

  return {
    disk,
    categories,
    dockerBytes,
    reclaimableBytes,
    dockerOk,
    images,
    volumes,
    buildCacheCount: (df.BuildCache ?? []).length,
    swap,
    updatedAt: Date.now(),
  };
}

/**
 * BuildKit prune with a `keep-storage` cap. dockerode exposes `pruneBuilder()`
 * but without the cap, so this uses the modem directly and falls back to the
 * full prune only in deep mode.
 */
async function pruneBuildCache(keepBytes: number, deep: boolean): Promise<number> {
  const modem = (docker as unknown as { modem?: { dial?: (...args: unknown[]) => unknown } }).modem;
  if (typeof modem?.dial === "function") {
    try {
      const data = await new Promise<unknown>((resolve, reject) => {
        modem.dial!(
          {
            // docker-modem appends `options` as the query string when the path
            // ends in "?" — passing it inline in the path gets truncated.
            path: "/build/prune?",
            method: "POST",
            options: { "keep-storage": String(Math.max(0, Math.floor(keepBytes))) },
            statusCodes: { 200: true, 500: true },
          },
          (err: Error | null, payload: unknown) => (err ? reject(err) : resolve(payload)),
        );
      });
      const parsed =
        typeof data === "string"
          ? (JSON.parse(data) as { SpaceReclaimed?: number })
          : Buffer.isBuffer(data)
            ? (JSON.parse(data.toString("utf8")) as { SpaceReclaimed?: number })
            : (data as { SpaceReclaimed?: number });
      return Number(parsed?.SpaceReclaimed) || 0;
    } catch {
      /* fall through */
    }
  }
  if (!deep) return 0;
  const res = await docker.pruneBuilder().catch(() => null);
  return Number(res?.SpaceReclaimed) || 0;
}

const KEEP_BUILD_CACHE = 1024 * 1024 * 1024; // 1 GiB

export async function cleanupStorage(opts: { deep?: boolean } = {}): Promise<CleanupResult> {
  const deep = Boolean(opts.deep);
  const before = await diskUsage();
  const details: string[] = [];

  const containers = await docker.pruneContainers().catch(() => null);
  if (containers) {
    const n = containers.ContainersDeleted?.length ?? 0;
    details.push(`${n} stopped container${n === 1 ? "" : "s"} removed`);
  }

  const images = await docker
    .pruneImages({ filters: { dangling: { true: true } } })
    .catch(() => null);
  if (images) {
    const n = images.ImagesDeleted?.length ?? 0;
    details.push(`${n} dangling image layer${n === 1 ? "" : "s"} removed`);
  }

  const networks = await docker.pruneNetworks().catch(() => null);
  if (networks) {
    const n = networks.NetworksDeleted?.length ?? 0;
    if (n > 0) details.push(`${n} unused network${n === 1 ? "" : "s"} removed`);
  }

  const cacheFreed = await pruneBuildCache(deep ? 0 : KEEP_BUILD_CACHE, deep).catch(() => 0);
  if (cacheFreed > 0) details.push(`${formatBytes(cacheFreed)} of build cache freed`);

  const after = await diskUsage();
  const reclaimedBytes = Math.max(0, before.usedBytes - after.usedBytes);

  return {
    reclaimedBytes,
    details,
    info: await storageInfo(),
  };
}

export function formatBytes(bytes: number): string {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[i]}`;
}
