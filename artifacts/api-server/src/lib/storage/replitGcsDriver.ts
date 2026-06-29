/**
 * Replit Object Storage driver (GCS via the Replit sidecar).
 *
 * This preserves the original behaviour: credentials and presigned URLs are
 * obtained from the Replit sidecar at 127.0.0.1:1106, and objects live under
 * PRIVATE_OBJECT_DIR (`/<bucket>/<dir>`). Used when STORAGE_DRIVER=replit
 * (the default) — i.e. when deployed on Replit.
 */

import { Storage } from "@google-cloud/storage";
import {
  ObjectNotFoundError,
  type ObjectStat,
  type ObjectStream,
  type StorageDriver,
} from "./types";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/");
  if (parts.length < 3) throw new Error("Invalid path: must contain at least a bucket name");
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

function privateObjectDir(): string {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set. Create a bucket in the 'Object Storage' tool and set PRIVATE_OBJECT_DIR.",
    );
  }
  return dir;
}

function publicSearchPaths(): string[] {
  const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
  return Array.from(
    new Set(pathsStr.split(",").map((p) => p.trim()).filter((p) => p.length > 0)),
  );
}

/** entityId (e.g. "uploads/<uuid>") → full "/<bucket>/<dir>/<entityId>" → bucket+object. */
function locate(entityId: string): { bucketName: string; objectName: string } {
  let dir = privateObjectDir();
  if (!dir.endsWith("/")) dir = `${dir}/`;
  return parseObjectPath(`${dir}${entityId}`);
}

async function sidecarSign(
  bucketName: string,
  objectName: string,
  method: "GET" | "PUT",
  ttlSec: number,
): Promise<string> {
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Failed to sign object URL (${response.status}); make sure you're running on Replit`);
  }
  const { signed_url } = (await response.json()) as { signed_url: string };
  return signed_url;
}

export class ReplitGcsDriver implements StorageDriver {
  async signUploadUrl(entityId: string, ttlSec: number): Promise<string> {
    const { bucketName, objectName } = locate(entityId);
    return sidecarSign(bucketName, objectName, "PUT", ttlSec);
  }

  async signDownloadUrl(entityId: string, ttlSec: number): Promise<string> {
    const { bucketName, objectName } = locate(entityId);
    return sidecarSign(bucketName, objectName, "GET", ttlSec);
  }

  async putObject(entityId: string, body: Buffer, contentType: string): Promise<void> {
    const { bucketName, objectName } = locate(entityId);
    await objectStorageClient
      .bucket(bucketName)
      .file(objectName)
      .save(body, { contentType, resumable: false });
  }

  async getObjectBytes(entityId: string): Promise<Buffer> {
    const { bucketName, objectName } = locate(entityId);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    const [buffer] = await file.download();
    return buffer;
  }

  async headObject(entityId: string): Promise<ObjectStat | null> {
    const { bucketName, objectName } = locate(entityId);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [metadata] = await file.getMetadata();
    return {
      contentType: metadata.contentType as string | undefined,
      size: metadata.size != null ? Number(metadata.size) : undefined,
    };
  }

  async getObjectStream(entityId: string): Promise<ObjectStream> {
    const { bucketName, objectName } = locate(entityId);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    const [metadata] = await file.getMetadata();
    return {
      stream: file.createReadStream(),
      stat: {
        contentType: metadata.contentType as string | undefined,
        size: metadata.size != null ? Number(metadata.size) : undefined,
      },
    };
  }

  uploadUrlToEntityId(url: string): string | null {
    if (!url.startsWith("https://storage.googleapis.com/")) return null;
    const rawObjectPath = new URL(url).pathname; // /<bucket>/<object>
    let dir = privateObjectDir();
    if (!dir.endsWith("/")) dir = `${dir}/`;
    if (!rawObjectPath.startsWith(dir)) return null;
    return rawObjectPath.slice(dir.length);
  }

  async getPublicObjectStream(relPath: string): Promise<ObjectStream | null> {
    for (const searchPath of publicSearchPaths()) {
      const { bucketName, objectName } = parseObjectPath(`${searchPath}/${relPath}`);
      const file = objectStorageClient.bucket(bucketName).file(objectName);
      const [exists] = await file.exists();
      if (exists) {
        const [metadata] = await file.getMetadata();
        return {
          stream: file.createReadStream(),
          stat: {
            contentType: metadata.contentType as string | undefined,
            size: metadata.size != null ? Number(metadata.size) : undefined,
          },
        };
      }
    }
    return null;
  }
}
