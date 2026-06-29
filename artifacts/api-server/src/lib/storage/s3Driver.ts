/**
 * S3-compatible storage driver (MinIO locally, AWS S3, Cloudflare R2, …).
 *
 * Selected with STORAGE_DRIVER=s3. All objects live in a single bucket
 * (`S3_BUCKET`) under an optional prefix (`S3_PREFIX`). entityIds map directly
 * to keys: `uploads/<uuid>` → `<prefix>uploads/<uuid>`.
 *
 * Env:
 *   S3_ENDPOINT            e.g. http://localhost:9000 (MinIO). Omit for real AWS.
 *   S3_REGION              default "us-east-1"
 *   S3_BUCKET              required
 *   S3_ACCESS_KEY_ID       required
 *   S3_SECRET_ACCESS_KEY   required
 *   S3_FORCE_PATH_STYLE    "true" for MinIO (default true when S3_ENDPOINT is set)
 *   S3_PREFIX              optional key prefix (default "")
 */

import { Readable } from "stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ObjectNotFoundError,
  type ObjectStat,
  type ObjectStream,
  type StorageDriver,
} from "./types";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required when STORAGE_DRIVER=s3`);
  return v;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === "NoSuchKey" ||
    e?.name === "NotFound" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

export class S3Driver implements StorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT || undefined;
    const forcePathStyle =
      (process.env.S3_FORCE_PATH_STYLE ?? (endpoint ? "true" : "false")) === "true";
    this.bucket = requireEnv("S3_BUCKET");
    this.prefix = process.env.S3_PREFIX || "";
    this.client = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint,
      forcePathStyle,
      credentials: {
        accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
      },
    });
  }

  private key(entityId: string): string {
    return `${this.prefix}${entityId}`;
  }

  async signUploadUrl(entityId: string, ttlSec: number): Promise<string> {
    // Do NOT bind ContentType — the client sends its own Content-Type header,
    // and binding it here would break the presigned signature (matches GCS behaviour).
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: this.key(entityId) }),
      { expiresIn: ttlSec },
    );
  }

  async signDownloadUrl(entityId: string, ttlSec: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: this.key(entityId) }),
      { expiresIn: ttlSec },
    );
  }

  async putObject(entityId: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(entityId),
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getObjectBytes(entityId: string): Promise<Buffer> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(entityId) }),
      );
      const bytes = await res.Body!.transformToByteArray();
      return Buffer.from(bytes);
    } catch (err) {
      if (isNotFound(err)) throw new ObjectNotFoundError();
      throw err;
    }
  }

  async headObject(entityId: string): Promise<ObjectStat | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(entityId) }),
      );
      return { contentType: res.ContentType, size: res.ContentLength };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async getObjectStream(entityId: string): Promise<ObjectStream> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(entityId) }),
      );
      return {
        stream: res.Body as Readable,
        stat: { contentType: res.ContentType, size: res.ContentLength },
      };
    } catch (err) {
      if (isNotFound(err)) throw new ObjectNotFoundError();
      throw err;
    }
  }

  uploadUrlToEntityId(url: string): string | null {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(url).pathname);
    } catch {
      return null;
    }
    // Path-style (MinIO / forcePathStyle): /<bucket>/<key>
    const pathStylePrefix = `/${this.bucket}/`;
    let key: string | null = null;
    if (pathname.startsWith(pathStylePrefix)) {
      key = pathname.slice(pathStylePrefix.length);
    } else if (pathname.startsWith("/")) {
      // Virtual-hosted style: <bucket>.host/<key>
      key = pathname.slice(1);
    }
    if (key == null) return null;
    if (this.prefix && key.startsWith(this.prefix)) key = key.slice(this.prefix.length);
    return key || null;
  }

  async getPublicObjectStream(relPath: string): Promise<ObjectStream | null> {
    // PUBLIC_OBJECT_SEARCH_PATHS (comma-separated key prefixes) or default "public/".
    const prefixes = (process.env.PUBLIC_OBJECT_SEARCH_PATHS || "public")
      .split(",")
      .map((p) => p.trim().replace(/^\/+|\/+$/g, ""))
      .filter(Boolean);
    for (const p of prefixes) {
      const key = `${this.prefix}${p}/${relPath}`;
      try {
        const head = await this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        const res = await this.client.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        return {
          stream: res.Body as Readable,
          stat: { contentType: head.ContentType, size: head.ContentLength },
        };
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    }
    // Silence unused import in builds where ListObjectsV2 is not needed.
    void ListObjectsV2Command;
    return null;
  }
}
