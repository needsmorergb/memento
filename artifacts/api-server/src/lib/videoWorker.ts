import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, readFile, mkdir, rm } from "fs/promises";
import { db } from "@workspace/db";
import { videoJobsTable, mediaItemsTable } from "@workspace/db/schema";
import { eq, and, isNull, lt } from "drizzle-orm";
import { getStorageDriver } from "./storage";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

const POLL_INTERVAL_MS = 30_000;
const STUCK_JOB_TIMEOUT_MS = 30 * 60 * 1000;
const XFADE_DUR = 0.5; // seconds crossfade overlap between clips
const VIDEO_FILTER =
  "scale=1280:720:force_original_aspect_ratio=decrease," +
  "pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30";

// ── Object storage helpers ────────────────────────────────────────────────
//
// Backed by the pluggable storage driver (Replit/GCS or S3/MinIO) selected via
// STORAGE_DRIVER. entityId = the path after "/objects/".

async function downloadMediaToTmp(objectPath: string, destPath: string): Promise<void> {
  const entityId = objectPath.replace(/^\/objects\//, "");
  const buffer = await getStorageDriver().getObjectBytes(entityId);
  await writeFile(destPath, buffer);
}

async function uploadVideoToStorage(
  localPath: string,
  jobId: string,
): Promise<{ videoUrl: string; videoObjectPath: string }> {
  const entityId = `videos/${jobId}.mp4`;
  const videoBuffer = await readFile(localPath);
  await getStorageDriver().putObject(entityId, videoBuffer, "video/mp4");
  // 7-day signed GET URL embedded in the notification emails.
  const videoUrl = await getStorageDriver().signDownloadUrl(entityId, 86400 * 7);
  return { videoUrl, videoObjectPath: `/objects/${entityId}` };
}

// ── ffprobe helper ────────────────────────────────────────────────────────

async function probeDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const dur = parseFloat(stdout.trim());
  return isFinite(dur) && dur > 0 ? dur : 2;
}

async function probeHasAudio(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "a",
      "-show_entries", "stream=codec_type",
      "-of", "default=noprint_wrappers=1",
      filePath,
    ]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// ── Per-clip transcoding ───────────────────────────────────────────────────

/**
 * Photo → 2s normalized video clip with silent audio.
 */
async function makePhotoClip(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
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

/**
 * Video → normalized clip. Adds silent audio if source has no audio track.
 * Trimmed to maxDuration.
 */
async function makeVideoClip(
  inputPath: string,
  outputPath: string,
  maxDuration: number,
): Promise<void> {
  const hasAudio = await probeHasAudio(inputPath);
  if (hasAudio) {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-filter_complex",
        `[0:v]${VIDEO_FILTER}[v];[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a]`,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-ar", "44100", "-ac", "2",
      "-t", String(maxDuration),
      outputPath,
    ]);
  } else {
    await execFileAsync("ffmpeg", [
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

/**
 * Voice note → normalized AAC audio file (audio-only).
 * This is NOT converted to a video clip; it's overlaid on the main timeline.
 */
async function extractVoiceAudio(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-vn",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    outputPath,
  ]);
}

interface VoiceNote {
  audioPath: string;
  /** Milliseconds from the first media item's timestamp — used for adelay placement */
  delayMs: number;
}

// ── Assembly with xfade crossfades ────────────────────────────────────────

interface Clip {
  path: string;
  duration: number;
}

/**
 * Assemble visual clips with fade crossfades using ffmpeg's xfade + acrossfade filters.
 * Applies duration cap and writes to outputPath.
 */
async function assembleWithCrossfades(
  clips: Clip[],
  outputPath: string,
  durationCapSec: number,
): Promise<void> {
  if (clips.length === 0) throw new Error("No clips to assemble");

  if (clips.length === 1) {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", clips[0].path,
      "-t", String(durationCapSec),
      "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-ar", "44100", "-ac", "2",
      outputPath,
    ]);
    return;
  }

  // Build inputs
  const inputs: string[] = [];
  for (const clip of clips) {
    inputs.push("-i", clip.path);
  }

  // Build filter_complex for xfade + acrossfade chains
  const filterParts: string[] = [];
  let vLabel = "[0:v]";
  let aLabel = "[0:a]";
  let timeOffset = 0;

  for (let i = 1; i < clips.length; i++) {
    const prevDuration = clips[i - 1].duration;
    timeOffset += prevDuration - XFADE_DUR;

    const nextVLabel = i === clips.length - 1 ? "[vout]" : `[v${i}]`;
    const nextALabel = i === clips.length - 1 ? "[aout]" : `[a${i}]`;

    filterParts.push(
      `${vLabel}[${i}:v]xfade=transition=fade:duration=${XFADE_DUR}:offset=${timeOffset.toFixed(3)}${nextVLabel}`,
    );
    filterParts.push(
      `${aLabel}[${i}:a]acrossfade=d=${XFADE_DUR}:c1=tri:c2=tri${nextALabel}`,
    );

    vLabel = nextVLabel;
    aLabel = nextALabel;
  }

  await execFileAsync("ffmpeg", [
    "-y",
    ...inputs,
    "-filter_complex", filterParts.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    "-t", String(durationCapSec),
    outputPath,
  ]);
}

/**
 * Build a positioned voice audio track by applying adelay to each voice note
 * based on its real-world timestamp offset from the first media item.
 * All delayed tracks are mixed together, then overlaid on the visual video at 0.4 weight.
 */
async function overlayVoiceNotesChronological(
  videoPath: string,
  voiceNotes: VoiceNote[],
  outputPath: string,
  durationCapSec: number,
): Promise<void> {
  if (voiceNotes.length === 0) throw new Error("No voice notes provided");

  // Build inputs and filter graph
  const inputs: string[] = ["-i", videoPath];
  const filterParts: string[] = [];
  const mixLabels: string[] = [];

  for (let i = 0; i < voiceNotes.length; i++) {
    inputs.push("-i", voiceNotes[i].audioPath);
    // adelay format: "delayMs|delayMs" for stereo channels; all=1 applies to all channels
    const delayMs = Math.max(0, Math.round(voiceNotes[i].delayMs));
    const voiceLabel = `[va${i}]`;
    filterParts.push(`[${i + 1}:a]adelay=${delayMs}:all=1${voiceLabel}`);
    mixLabels.push(voiceLabel);
  }

  // Mix all positioned voice tracks together
  filterParts.push(
    `${mixLabels.join("")}amix=inputs=${voiceNotes.length}:duration=longest:normalize=0[voice_mix]`,
  );
  // Blend with main video audio (voice at 0.4 weight)
  filterParts.push("[0:a][voice_mix]amix=inputs=2:duration=first:weights=1 0.4[aout]");

  await execFileAsync("ffmpeg", [
    "-y",
    ...inputs,
    "-filter_complex", filterParts.join(";"),
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    "-t", String(durationCapSec),
    outputPath,
  ]);
}

async function makePlaceholderVideo(outputPath: string, durationSec: number): Promise<void> {
  await execFileAsync("ffmpeg", [
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
  const claimed = await db
    .update(videoJobsTable)
    .set({ status: "processing", startedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(videoJobsTable.id, jobId), eq(videoJobsTable.status, "pending")))
    .returning();

  if (!claimed.length) {
    logger.info({ jobId }, "Job already claimed, skipping");
    return;
  }

  const job = claimed[0];
  const workDir = join(tmpdir(), `memento-job-${jobId}`);

  try {
    await mkdir(workDir, { recursive: true });
    logger.info({ jobId, eventId: job.eventId, tier: job.tier }, "Video job started");

    const mediaItems = await db.query.mediaItemsTable.findMany({
      where: and(eq(mediaItemsTable.eventId, job.eventId), isNull(mediaItemsTable.deletedAt)),
    });

    // Order by capture time (VIDEO-03): prefer client-supplied capturedAt, fall back
    // to server confirm time (createdAt). Drizzle has no clean COALESCE in the
    // relational orderBy callback, so sort in JS (small N per event).
    const sortKey = (m: { capturedAt: Date | null; createdAt: Date }) =>
      (m.capturedAt ?? m.createdAt).getTime();
    mediaItems.sort((a, b) => sortKey(a) - sortKey(b));

    logger.info({ jobId, itemCount: mediaItems.length }, "Media items fetched");

    // Separate visual clips from voice notes, tracking timestamps for chronological placement
    const visualClips: Clip[] = [];
    const voiceNotes: VoiceNote[] = [];
    // Anchor timestamp: capture time of the first media item, for computing delays
    const anchorTime = mediaItems.length > 0 ? sortKey(mediaItems[0]) : Date.now();
    let idx = 0;

    for (const item of mediaItems) {
      const ext =
        item.mediaType === "photo" ? "jpg" :
        item.mediaType === "voice_note" ? "m4a" :
        "mp4";
      const inputPath = join(workDir, `input_${idx}.${ext}`);

      try {
        await downloadMediaToTmp(item.objectPath, inputPath);
      } catch (err) {
        logger.warn({ err, objectPath: item.objectPath }, "Download failed, skipping");
        idx++;
        continue;
      }

      if (item.mediaType === "photo") {
        const clipPath = join(workDir, `clip_${idx}.mp4`);
        try {
          await makePhotoClip(inputPath, clipPath);
          const duration = await probeDuration(clipPath);
          visualClips.push({ path: clipPath, duration });
          logger.info({ jobId, idx, mediaType: "photo", duration }, "Photo clip created");
        } catch (err) {
          logger.warn({ err }, "Photo clip failed, skipping");
        }
      } else if (item.mediaType === "video") {
        const clipPath = join(workDir, `clip_${idx}.mp4`);
        try {
          await makeVideoClip(inputPath, clipPath, job.durationCapSeconds);
          const duration = await probeDuration(clipPath);
          visualClips.push({ path: clipPath, duration });
          logger.info({ jobId, idx, mediaType: "video", duration }, "Video clip created");
        } catch (err) {
          logger.warn({ err }, "Video clip failed, skipping");
        }
      } else {
        // voice_note — extract audio only and record delay from anchor timestamp
        const audioPath = join(workDir, `voice_${idx}.aac`);
        try {
          await extractVoiceAudio(inputPath, audioPath);
          const delayMs = Math.max(0, sortKey(item) - anchorTime);
          voiceNotes.push({ audioPath, delayMs });
          logger.info({ jobId, idx, delayMs }, "Voice note audio extracted");
        } catch (err) {
          logger.warn({ err }, "Voice note extraction failed, skipping");
        }
      }

      idx++;
    }

    const assembledPath = join(workDir, "assembled.mp4");
    const outputPath = join(workDir, "output.mp4");

    // Step 1: Assemble visual clips with crossfade transitions
    if (visualClips.length === 0) {
      logger.warn({ jobId }, "No visual clips — generating placeholder");
      await makePlaceholderVideo(assembledPath, Math.min(job.durationCapSeconds, 5));
    } else {
      logger.info({ jobId, clipCount: visualClips.length }, "Assembling with crossfades");
      await assembleWithCrossfades(visualClips, assembledPath, job.durationCapSeconds);
    }

    // Step 2: Overlay voice notes chronologically over the assembled video
    if (voiceNotes.length > 0) {
      logger.info({ jobId, voiceCount: voiceNotes.length }, "Overlaying voice notes chronologically");
      await overlayVoiceNotesChronological(assembledPath, voiceNotes, outputPath, job.durationCapSeconds);
    } else {
      // No voice notes: pass assembled video through with duration cap
      await execFileAsync("ffmpeg", [
        "-y", "-i", assembledPath,
        "-t", String(job.durationCapSeconds),
        "-c", "copy",
        outputPath,
      ]);
    }

    logger.info({ jobId }, "Compilation done, uploading to storage");

    const { videoUrl, videoObjectPath } = await uploadVideoToStorage(outputPath, jobId);

    // Terminal state is ready_for_review — the host must approve before any
    // guest is notified. The notification fan-out lives in the approve handler
    // (routes/events.ts), NOT here. completedAt is stamped on approval.
    await db
      .update(videoJobsTable)
      .set({
        status: "ready_for_review",
        videoUrl,
        videoObjectPath,
        updatedAt: new Date(),
      })
      .where(eq(videoJobsTable.id, jobId));

    logger.info({ jobId, videoUrl }, "Job ready for review — awaiting host approval");
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
    // Reset stuck processing jobs older than the timeout threshold
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
  setTimeout(() => {
    pollAndProcess().catch((err) => logger.error({ err }, "Initial poll failed"));
  }, 5_000);
  setInterval(() => {
    pollAndProcess().catch((err) => logger.error({ err }, "Recurring poll failed"));
  }, POLL_INTERVAL_MS);
}
