/**
 * Object storage facade used by the API routes.
 *
 * Thin wrapper over the active {@link StorageDriver} (see ./storage). Keeps the
 * `ObjectStorageService` surface the routes already use, but is now backed by a
 * pluggable driver (Replit/GCS or S3/MinIO) selected via STORAGE_DRIVER.
 *
 * The unit of identity is the entityId — the path after `/objects/` in a stored
 * objectPath (e.g. `/objects/uploads/<uuid>` → entityId `uploads/<uuid>`).
 */

import { Readable } from "stream";
import { randomUUID } from "crypto";
import { getStorageDriver } from "./storage";
import { ObjectNotFoundError, type ObjectStat } from "./storage/types";

export { ObjectNotFoundError };

function entityIdFromObjectPath(objectPath: string): string {
  if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
  return objectPath.slice("/objects/".length);
}

function streamToResponse(
  stream: NodeJS.ReadableStream,
  stat: ObjectStat,
  cacheTtlSec: number,
  isPublic: boolean,
): Response {
  const webStream = Readable.toWeb(stream as Readable) as ReadableStream;
  const headers: Record<string, string> = {
    "Content-Type": stat.contentType || "application/octet-stream",
    "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
  };
  if (stat.size != null) headers["Content-Length"] = String(stat.size);
  return new Response(webStream, { headers });
}

export class ObjectStorageService {
  /** Presigned PUT URL for a fresh upload object. */
  async getObjectEntityUploadURL(): Promise<string> {
    const entityId = `uploads/${randomUUID()}`;
    return getStorageDriver().signUploadUrl(entityId, 900);
  }

  /** Map a signed upload URL back to its canonical `/objects/...` path. Pass-through for already-normalised paths. */
  normalizeObjectEntityPath(rawPath: string): string {
    if (!/^https?:\/\//i.test(rawPath)) return rawPath;
    const entityId = getStorageDriver().uploadUrlToEntityId(rawPath);
    return entityId ? `/objects/${entityId}` : rawPath;
  }

  /** Stream a private object as a web Response. Throws {@link ObjectNotFoundError} if missing. */
  async getObjectEntityResponse(objectPath: string, cacheTtlSec = 3600): Promise<Response> {
    const entityId = entityIdFromObjectPath(objectPath);
    const { stream, stat } = await getStorageDriver().getObjectStream(entityId);
    return streamToResponse(stream, stat, cacheTtlSec, false);
  }

  /** Stream a public object by relative path, or null if not found. */
  async getPublicObjectResponse(relPath: string, cacheTtlSec = 3600): Promise<Response | null> {
    const found = await getStorageDriver().getPublicObjectStream(relPath);
    if (!found) return null;
    return streamToResponse(found.stream, found.stat, cacheTtlSec, true);
  }
}
