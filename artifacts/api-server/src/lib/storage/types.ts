/**
 * Storage driver abstraction.
 *
 * The app stores media (photos, videos, voice notes) and compiled videos in an
 * object store. Historically this was Replit Object Storage (GCS via the Replit
 * sidecar). To allow running the app locally (and on any host), object storage is
 * abstracted behind {@link StorageDriver}, selected at runtime via the
 * `STORAGE_DRIVER` env var:
 *
 *   - `replit` (default) — GCS through the Replit sidecar. Production / Replit.
 *   - `s3`              — any S3-compatible store (MinIO locally, AWS S3, R2…).
 *
 * The unit of identity is the **entityId** — the path that follows `/objects/` in
 * a stored object path. Examples: `uploads/<uuid>`, `videos/<jobId>.mp4`. Each
 * driver maps an entityId onto its own physical location (a GCS bucket path, an
 * S3 key, …). Callers never deal with bucket names or driver specifics.
 */

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export interface ObjectStat {
  contentType?: string;
  size?: number;
}

export interface ObjectStream {
  stream: NodeJS.ReadableStream;
  stat: ObjectStat;
}

export interface StorageDriver {
  /** Presigned URL the client PUTs raw bytes to. Content-Type is NOT bound, so any bytes are accepted (matches prior GCS behaviour). */
  signUploadUrl(entityId: string, ttlSec: number): Promise<string>;

  /** Presigned URL for GET — used for the 7-day video link embedded in emails. */
  signDownloadUrl(entityId: string, ttlSec: number): Promise<string>;

  /** Upload bytes directly (server-side) — used by the video worker to store the compiled MP4. */
  putObject(entityId: string, body: Buffer, contentType: string): Promise<void>;

  /** Download an object's full bytes — used by the video worker to fetch media for compilation. */
  getObjectBytes(entityId: string): Promise<Buffer>;

  /** Stat an object, or null if it does not exist. */
  headObject(entityId: string): Promise<ObjectStat | null>;

  /** Open a read stream for an object. Throws {@link ObjectNotFoundError} if it does not exist. */
  getObjectStream(entityId: string): Promise<ObjectStream>;

  /** Recover the entityId from a previously-signed upload URL (for normalising the stored objectPath). Returns null if the URL is not recognised. */
  uploadUrlToEntityId(url: string): string | null;

  /** Serve a public object by relative path (PUBLIC_OBJECT_SEARCH_PATHS analog). Returns null if not found. */
  getPublicObjectStream(relPath: string): Promise<ObjectStream | null>;
}
