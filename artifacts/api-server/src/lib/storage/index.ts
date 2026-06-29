/**
 * Storage driver selector.
 *
 * Chooses the active {@link StorageDriver} from the `STORAGE_DRIVER` env var:
 *   - `s3`     → {@link S3Driver} (MinIO / AWS S3 / R2 — local development & portable hosting)
 *   - `replit` → {@link ReplitGcsDriver} (default — Replit Object Storage via the sidecar)
 *
 * The driver is constructed lazily and memoised so env is read once.
 */

import type { StorageDriver } from "./types";
import { ReplitGcsDriver } from "./replitGcsDriver";
import { S3Driver } from "./s3Driver";

export { ObjectNotFoundError } from "./types";
export type { StorageDriver, ObjectStat, ObjectStream } from "./types";

let cached: StorageDriver | null = null;

export function getStorageDriver(): StorageDriver {
  if (cached) return cached;
  const which = (process.env.STORAGE_DRIVER || "replit").toLowerCase();
  cached = which === "s3" ? new S3Driver() : new ReplitGcsDriver();
  return cached;
}
