import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, readFile, mkdir, rm } from "fs/promises";
import { db } from "@workspace/db";
import {
  videoJobsTable,
  eventsTable,
  mediaItemsTable,
  eventGuestsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, and, isNull, asc, count, lt } from "drizzle-orm";
import { objectStorageClient } from "./objectStorage";
import { sendPushNotifications, sendGuestEmails, sendHostEmail } from "./notifications";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

const POLL_INTERVAL_MS = 30_000;
const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const STUCK_JOB_TIMEOUT_MS = 30 * 60 * 1000;

// ── Object storage helpers ────────────────────────────────────────────────

function parseRawPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 1) throw new Error(`Invalid object path: ${path}`);
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}

async function signObjectURL(opts: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT";
  ttlSec: number;
}): Promise<string> {
  const res = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: opts.bucketName,
      object_name: opts.objectName,
      method: opts.method,
      expires_at: new Date(Date.now() + opts.ttlSec * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to sign URL (${res.status}): ${text}`);
  }
  const { signed_url } = (await res.json()) as { signed_url: string };
  return signed_url;
}

/**
 * Download an object from storage given its normalized path (/objects/uploads/uuid)
 * and write the bytes to destPath on the local filesystem.
 */
async function downloadMediaToTmp(objectPath: string, destPath: string): Promise<void> {
  const privateDir = process.env.PRIVATE_OBJECT_DIR ?? "";
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not set");

  // objectPath is like /objects/uploads/{uuid}
  // Strip the leading /objects/ to get the entity sub-path
  const entitySubPath = objectPath.replace(/^\/objects\//, "");

  const { bucketName, objectName: dirName } = parseRawPath(privateDir);
  const fullObjectName = dirName ? `${dirName}/${entitySubPath}` : entitySubPath;

  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(fullObjectName);
  const [exists] = await file.exists();
  if (!exists) throw new Error(`Object not found: ${fullObjectName}`);

  const [buffer] = await file.download();
  await writeFile(destPath, buffer);
}

/**
 * Upload a local file to object storage and return a signed 7-day GET URL.
 */
async function uploadVideoToStorage(localPath: string, jobId: string): Promise<{ videoUrl: string; videoObjectPath: string }> {
  const privateDir = process.env.PRIVATE_OBJECT_DIR ?? "";
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not set");

  const { bucketName, objectName: dirName } = parseRawPath(privateDir);
  const objectName = dirName ? `${dirName}/videos/${jobId}.mp4` : `videos/${jobId}.mp4`;

  // Get signed PUT URL and upload
  const putUrl = await signObjectURL({ bucketName, objectName, method: "PUT", ttlSec: 900 });
  const videoBuffer = await readFile(localPath);

  const putRes = await fetch(putUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: videoBuffer,
    signal: AbortSignal.timeout(300_000),
  });
  if (!putRes.ok) throw new Error(`Video upload failed: ${putRes.status}`);

  // Generate a 7-day signed GET URL for playback
  const videoUrl = await signObjectURL({ bucketName, objectName, method: "GET", ttlSec: 86400 * 7 });
  const videoObjectPath = `/objects/videos/${jobId}.mp4`;

  return { videoUrl, videoObjectPath };
}

// ── ffmpeg helpers ─────────────────────────────────────────────────────────

const FFMPEG = "ffmpeg";
const VIDEO_FILTER = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30";

async function makePhotoClip(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync(FFMPEG, [
    "-y",
    "-loop", "1", "-t", "2",
    "-i", inputPath,
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-filter_complex", `[0:v]${VIDEO_FILTER}[v]`,
    "-map", "[v]", "-map", "1:a",
    "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    "-shortest",
    outputPath,
  ]);
}

async function makeVideoClip(inputPath: string, outputPath: string, maxDuration: number): Promise<void> {
  // Probe for audio stream existence
  let hasAudio = false;
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "a",
      "-show_entries", "stream=codec_type",
      "-of", "default=noprint_wrappers=1",
      inputPath,
    ]);
    hasAudio = stdout.trim().length > 0;
  } catch {
    hasAudio = false;
  }

  if (hasAudio) {
    await execFileAsync(FFMPEG, [
      "-y",
      "-i", inputPath,
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-filter_complex",
        `[0:v]${VIDEO_FILTER}[v];[0:a]aresample=44100[oa];[oa][1:a]amix=inputs=2:duration=first:dropout_transition=3[a]`,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-ar", "44100", "-ac", "2",
      "-t", String(maxDuration),
      outputPath,
    ]);
  } else {
    await execFileAsync(FFMPEG, [
      "-y",
      "-i", inputPath,
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-filter_complex", `[0:v]${VIDEO_FILTER}[v]`,
      "-map", "[v]", "-map", "1:a",
      "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-ar", "44100", "-ac", "2",
      "-t", String(maxDuration),
      "-shortest",
      outputPath,
    ]);
  }
}

async function makeVoiceClip(inputPath: string, outputPath: string): Promise<void> {
  // Voice note: black video frame + audio
  await execFileAsync(FFMPEG, [
    "-y",
    "-i", inputPath,
    "-f", "lavfi", "-i", "color=black:s=1280x720:r=30",
    "-filter_complex", "[1:v]setsar=1[v];[0:a]aresample=44100[a]",
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    "-shortest",
    outputPath,
  ]);
}

async function concatClips(clipPaths: string[], outputPath: string, durationCapSec: number): Promise<void> {
  if (clipPaths.length === 1) {
    await execFileAsync(FFMPEG, [
      "-y",
      "-i", clipPaths[0],
      "-t", String(durationCapSec),
      "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-ar", "44100", "-ac", "2",
      outputPath,
    ]);
    return;
  }

  // Write filelist for concat demuxer
  const fileListPath = `${outputPath}.filelist.txt`;
  await writeFile(fileListPath, clipPaths.map((p) => `file '${p}'`).join("\n"));

  await execFileAsync(FFMPEG, [
    "-y",
    "-f", "concat", "-safe", "0",
    "-i", fileListPath,
    "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    "-t", String(durationCapSec),
    outputPath,
  ]);
}

async function makePlaceholderVideo(outputPath: string, durationSec: number): Promise<void> {
  await execFileAsync(FFMPEG, [
    "-y",
    "-f", "lavfi", "-i", `color=black:s=1280x720:r=30:d=${durationSec}`,
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    "-t", String(durationSec),
    outputPath,
  ]);
}

// ── Core job processor ────────────────────────────────────────────────────

async function processVideoJob(jobId: string): Promise<void> {
  // Atomically claim the job: only proceed if it's still pending
  const claimed = await db
    .update(videoJobsTable)
    .set({ status: "processing", startedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(videoJobsTable.id, jobId), eq(videoJobsTable.status, "pending")))
    .returning();

  if (!claimed.length) {
    logger.info({ jobId }, "Job already claimed by another worker, skipping");
    return;
  }

  const job = claimed[0];
  const workDir = join(tmpdir(), `memento-job-${jobId}`);

  try {
    await mkdir(workDir, { recursive: true });
    logger.info({ jobId, eventId: job.eventId, tier: job.tier }, "Video job processing started");

    // Fetch all media for the event sorted by creation time
    const mediaItems = await db.query.mediaItemsTable.findMany({
      where: and(eq(mediaItemsTable.eventId, job.eventId), isNull(mediaItemsTable.deletedAt)),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });

    logger.info({ jobId, itemCount: mediaItems.length }, "Media items fetched");

    const clipPaths: string[] = [];
    let clipIndex = 0;

    for (const item of mediaItems) {
      const ext =
        item.mediaType === "photo" ? "jpg" :
        item.mediaType === "voice_note" ? "m4a" :
        "mp4";
      const inputPath = join(workDir, `input_${clipIndex}.${ext}`);
      const clipPath = join(workDir, `clip_${clipIndex}.mp4`);

      // Download media from object storage
      try {
        await downloadMediaToTmp(item.objectPath, inputPath);
      } catch (err) {
        logger.warn({ err, objectPath: item.objectPath }, "Failed to download media item, skipping");
        clipIndex++;
        continue;
      }

      // Transcode to uniform format
      try {
        if (item.mediaType === "photo") {
          await makePhotoClip(inputPath, clipPath);
        } else if (item.mediaType === "video") {
          await makeVideoClip(inputPath, clipPath, job.durationCapSeconds);
        } else {
          await makeVoiceClip(inputPath, clipPath);
        }
        clipPaths.push(clipPath);
        logger.info({ jobId, clipIndex, mediaType: item.mediaType }, "Clip created");
      } catch (err) {
        logger.warn({ err, mediaType: item.mediaType, objectPath: item.objectPath }, "Failed to create clip, skipping");
      }

      clipIndex++;
    }

    const outputPath = join(workDir, "output.mp4");

    if (clipPaths.length === 0) {
      logger.warn({ jobId }, "No clips available, generating placeholder video");
      await makePlaceholderVideo(outputPath, Math.min(job.durationCapSeconds, 5));
    } else {
      await concatClips(clipPaths, outputPath, job.durationCapSeconds);
    }

    logger.info({ jobId }, "Compilation complete, uploading to storage");

    // Upload to object storage
    const { videoUrl, videoObjectPath } = await uploadVideoToStorage(outputPath, jobId);

    // Mark job completed
    await db
      .update(videoJobsTable)
      .set({ status: "completed", videoUrl, videoObjectPath, completedAt: new Date(), updatedAt: new Date() })
      .where(eq(videoJobsTable.id, jobId));

    logger.info({ jobId, videoUrl }, "Video job completed, dispatching notifications");

    // Fetch event, guests, and host for notifications
    const event = await db.query.eventsTable.findFirst({ where: eq(eventsTable.id, job.eventId) });
    if (!event) {
      logger.warn({ jobId }, "Event not found for notifications");
      return;
    }

    const guests = await db.query.eventGuestsTable.findMany({
      where: and(eq(eventGuestsTable.eventId, job.eventId), isNull(eventGuestsTable.deletedAt)),
    });

    const host = await db.query.usersTable.findFirst({ where: eq(usersTable.id, event.hostId) });

    const [{ value: mediaCount }] = await db
      .select({ value: count() })
      .from(mediaItemsTable)
      .where(and(eq(mediaItemsTable.eventId, job.eventId), isNull(mediaItemsTable.deletedAt)));

    // Notifications run in parallel — failures logged but don't fail the job
    await Promise.allSettled([
      sendPushNotifications(guests, event.title, videoUrl),
      sendGuestEmails(guests, event, videoUrl),
      host ? sendHostEmail(host, event, videoUrl, guests.length, Number(mediaCount), job.tier) : Promise.resolve(),
    ]);

    logger.info({ jobId }, "All notifications dispatched");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, jobId }, "Video job failed");

    await db
      .update(videoJobsTable)
      .set({ status: "failed", errorMessage: message.slice(0, 1000), updatedAt: new Date() })
      .where(eq(videoJobsTable.id, jobId))
      .catch((e) => logger.error({ e }, "Failed to mark job as failed"));
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Polling loop ──────────────────────────────────────────────────────────

let isRunning = false;

async function pollAndProcess(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    // Reset stuck processing jobs (started > STUCK_JOB_TIMEOUT_MS ago)
    const stuckThreshold = new Date(Date.now() - STUCK_JOB_TIMEOUT_MS);
    await db
      .update(videoJobsTable)
      .set({ status: "failed", errorMessage: "Job timed out", updatedAt: new Date() })
      .where(
        and(
          eq(videoJobsTable.status, "processing"),
          lt(videoJobsTable.startedAt, stuckThreshold),
        ),
      )
      .catch(() => {});

    // Find the oldest pending job
    const pending = await db.query.videoJobsTable.findFirst({
      where: eq(videoJobsTable.status, "pending"),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });

    if (pending) {
      logger.info({ jobId: pending.id }, "Found pending video job");
      await processVideoJob(pending.id);
    }
  } catch (err) {
    logger.error({ err }, "Video worker poll error");
  } finally {
    isRunning = false;
  }
}

export function startVideoWorker(): void {
  logger.info("Starting video worker (DB polling every 30s)");
  // Initial poll after 5s to let the server fully boot
  setTimeout(() => {
    pollAndProcess().catch((err) => logger.error({ err }, "Initial poll failed"));
  }, 5_000);
  // Recurring poll
  setInterval(() => {
    pollAndProcess().catch((err) => logger.error({ err }, "Recurring poll failed"));
  }, POLL_INTERVAL_MS);
}
