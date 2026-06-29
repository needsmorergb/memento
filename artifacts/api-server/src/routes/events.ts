import { Router, type Response } from "express";
import { db } from "@workspace/db";
import {
  eventsTable,
  eventGuestsTable,
  mediaItemsTable,
  videoJobsTable,
  subscriptionsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, and, isNull, count, sql } from "drizzle-orm";
import { requireAuth, optionalAuth, type AuthenticatedRequest } from "../lib/auth";
import { getDurationCap, getQualityCap } from "../lib/tier";
import {
  sendPushNotifications,
  sendGuestEmails,
  sendHostEmail,
} from "../lib/notifications";
import crypto from "crypto";

const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

function generateShareToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

function buildShareUrl(token: string): string {
  const domain = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://localhost:3000";
  return `${domain}/event/${token}`;
}

async function getEventCounts(eventId: string) {
  const [guestCount] = await db
    .select({ count: count() })
    .from(eventGuestsTable)
    .where(
      and(
        eq(eventGuestsTable.eventId, eventId),
        isNull(eventGuestsTable.deletedAt),
      ),
    );
  const [mediaCount] = await db
    .select({ count: count() })
    .from(mediaItemsTable)
    .where(
      and(
        eq(mediaItemsTable.eventId, eventId),
        isNull(mediaItemsTable.deletedAt),
      ),
    );
  return {
    guestCount: Number(guestCount?.count ?? 0),
    mediaCount: Number(mediaCount?.count ?? 0),
  };
}

function formatEvent(
  event: typeof eventsTable.$inferSelect,
  guestCount: number,
  mediaCount: number,
  extra?: {
    hostName?: string | null;
    videoJob?: typeof videoJobsTable.$inferSelect | null;
  },
) {
  const base = {
    id: event.id,
    title: event.title,
    description: event.description,
    eventDate: event.eventDate,
    endTime: event.endTime,
    status: event.status,
    shareToken: event.shareToken,
    shareUrl: buildShareUrl(event.shareToken),
    guestCount,
    mediaCount,
    coverImagePath: event.coverImagePath,
    createdAt: event.createdAt,
    hostId: event.hostId,
  };
  if (extra) {
    return {
      ...base,
      hostName: extra.hostName ?? null,
      videoJob: extra.videoJob
        ? {
            id: extra.videoJob.id,
            eventId: extra.videoJob.eventId,
            status: extra.videoJob.status,
            videoUrl: extra.videoJob.videoUrl,
            durationCapSeconds: extra.videoJob.durationCapSeconds,
            tier: extra.videoJob.tier,
            errorMessage: extra.videoJob.errorMessage,
            createdAt: extra.videoJob.createdAt,
            completedAt: extra.videoJob.completedAt,
          }
        : null,
    };
  }
  return base;
}

type VideoJobRow = typeof videoJobsTable.$inferSelect;

// Centralized VideoJobStatus serializer (CONVENTIONS §Function & Module Design —
// a formatEvent-style serializer over inlining; now 4+ identical call sites).
// Exported for unit testing.
export function formatVideoJob(job: VideoJobRow) {
  return {
    id: job.id,
    eventId: job.eventId,
    status: job.status,
    videoUrl: job.videoUrl,
    durationCapSeconds: job.durationCapSeconds,
    tier: job.tier,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    approvedAt: job.approvedAt,
  };
}

// SECURITY-CRITICAL (Research Pitfall 1): the public/token video-status must NOT
// expose the unapproved review cut. Until approvedAt is set, withhold videoUrl
// and map any pre-approval state to a benign "processing"-equivalent so guests
// cannot learn a review cut exists. Only once approvedAt is set is the full shape
// (including videoUrl) exposed. Exported for unit testing.
export function buildTokenVideoStatusResponse(job: VideoJobRow) {
  if (job.approvedAt) {
    return formatVideoJob(job);
  }
  // Pre-approval: leak nothing about the review cut.
  // pending/processing/failed are pre-existing guest-visible states; ready_for_review
  // (and any future pre-approval state) is masked to "processing".
  const guestStatus = job.status === "failed" ? "failed" : "processing";
  return {
    id: job.id,
    eventId: job.eventId,
    status: guestStatus,
    videoUrl: null,
    durationCapSeconds: job.durationCapSeconds,
    tier: job.tier,
    errorMessage: job.status === "failed" ? job.errorMessage : null,
    createdAt: job.createdAt,
    completedAt: null,
    approvedAt: null,
  };
}

// Approve the same-day-edit video: stamp approvedAt + status=completed and fan out
// push + email exactly once. Idempotent on approvedAt. Host-only (ownership → 404).
// Exported for unit testing.
export async function approveVideoHandler(req: AuthenticatedRequest, res: Response) {
  try {
    const user = req.dbUser!;
    const event = await db.query.eventsTable.findFirst({
      where: and(
        eq(eventsTable.id, String(req.params.eventId)),
        isNull(eventsTable.deletedAt),
      ),
    });

    if (!event || event.hostId !== user.id) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const job = await db.query.videoJobsTable.findFirst({
      where: and(
        eq(videoJobsTable.eventId, event.id),
        isNull(videoJobsTable.supersededAt),
      ),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    if (!job || job.status !== "ready_for_review") {
      // Already-approved jobs are status=completed and handled by the idempotency
      // branch below; otherwise the video is not in a reviewable state.
      if (job?.approvedAt) {
        res.status(200).json(formatVideoJob(job));
        return;
      }
      res.status(409).json({ error: "Video is not ready for review" });
      return;
    }

    // Idempotency (Research Open Q1): a re-approve must not re-notify.
    if (job.approvedAt) {
      res.status(200).json(formatVideoJob(job));
      return;
    }

    const now = new Date();
    const [updatedJob] = await db
      .update(videoJobsTable)
      .set({
        status: "completed",
        approvedAt: now,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(videoJobsTable.id, job.id))
      .returning();

    // Relocated fan-out (from videoWorker.ts). Notifications fire on approve only.
    const videoUrl = updatedJob.videoUrl ?? job.videoUrl ?? "";
    const allGuests = await db.query.eventGuestsTable.findMany({
      where: and(
        eq(eventGuestsTable.eventId, event.id),
        isNull(eventGuestsTable.deletedAt),
      ),
    });
    const host = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, event.hostId),
    });
    const [{ value: mediaCount }] = await db
      .select({ value: count() })
      .from(mediaItemsTable)
      .where(
        and(
          eq(mediaItemsTable.eventId, event.id),
          isNull(mediaItemsTable.deletedAt),
        ),
      );

    await Promise.allSettled([
      sendPushNotifications(allGuests, event.title, videoUrl),
      sendGuestEmails(allGuests, event, videoUrl),
      host
        ? sendHostEmail(
            host,
            event,
            videoUrl,
            allGuests.length,
            Number(mediaCount),
            job.tier,
          )
        : Promise.resolve(),
    ]);

    res.status(200).json(formatVideoJob(updatedJob));
  } catch (err) {
    req.log.error(err, "Failed to approve video");
    res.status(500).json({ error: "Internal server error" });
  }
}

// Regenerate the same-day-edit video: supersede the current latest job and enqueue
// a fresh pending job (worker picks it up). Host-only. Does NOT notify.
// Exported for unit testing.
export async function regenerateVideoHandler(req: AuthenticatedRequest, res: Response) {
  try {
    const user = req.dbUser!;
    const event = await db.query.eventsTable.findFirst({
      where: and(
        eq(eventsTable.id, String(req.params.eventId)),
        isNull(eventsTable.deletedAt),
      ),
    });

    if (!event || event.hostId !== user.id) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const current = await db.query.videoJobsTable.findFirst({
      where: and(
        eq(videoJobsTable.eventId, event.id),
        isNull(videoJobsTable.supersededAt),
      ),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    const now = new Date();
    // Mark the current latest non-superseded job superseded regardless of its
    // status (Research Open Q2) so the worker's selection picks the new job.
    if (current) {
      await db
        .update(videoJobsTable)
        .set({ supersededAt: now, updatedAt: now })
        .where(eq(videoJobsTable.id, current.id));
    }

    // Re-resolve tier caps (carry over from the superseded job when present).
    const tier = current?.tier ?? "free";
    const durationCapSeconds = current?.durationCapSeconds ?? getDurationCap(tier);
    const { quality, maxResolutionPx } = getQualityCap(tier);

    const [newJob] = await db
      .insert(videoJobsTable)
      .values({
        eventId: event.id,
        tier,
        durationCapSeconds,
        qualityCap: current?.qualityCap ?? quality,
        maxResolutionPx: current?.maxResolutionPx ?? maxResolutionPx,
      })
      .returning();

    res.status(200).json(formatVideoJob(newJob));
  } catch (err) {
    req.log.error(err, "Failed to regenerate video");
    res.status(500).json({ error: "Internal server error" });
  }
}

// List host's events
router.get("/events", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const events = await db.query.eventsTable.findMany({
      where: and(
        eq(eventsTable.hostId, user.id),
        isNull(eventsTable.deletedAt),
      ),
      orderBy: (t, { desc }) => [desc(t.eventDate)],
    });

    const enriched = await Promise.all(
      events.map(async (e) => {
        const counts = await getEventCounts(e.id);
        return formatEvent(e, counts.guestCount, counts.mediaCount);
      }),
    );

    res.json({ events: enriched });
  } catch (err) {
    req.log.error(err, "Failed to list events");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create event
router.post("/events", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const { title, description, eventDate, endTime, coverImagePath } =
      req.body as {
        title: string;
        description?: string;
        eventDate: string;
        endTime?: string;
        coverImagePath?: string;
      };

    if (!title || !eventDate) {
      res.status(400).json({ error: "title and eventDate are required" });
      return;
    }

    const shareToken = generateShareToken();
    const [event] = await db
      .insert(eventsTable)
      .values({
        hostId: user.id,
        title,
        description,
        eventDate: new Date(eventDate),
        endTime: endTime ? new Date(endTime) : undefined,
        shareToken,
        coverImagePath,
      })
      .returning();

    const counts = await getEventCounts(event.id);
    res
      .status(201)
      .json(
        formatEvent(event, counts.guestCount, counts.mediaCount, {
          hostName: user.displayName,
          videoJob: null,
        }),
      );
  } catch (err) {
    req.log.error(err, "Failed to create event");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get event by ID
router.get("/events/:eventId", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const event = await db.query.eventsTable.findFirst({
      where: and(
        eq(eventsTable.id, String(req.params.eventId)),
        isNull(eventsTable.deletedAt),
      ),
    });

    if (!event || event.hostId !== user.id) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const counts = await getEventCounts(event.id);
    const videoJob = await db.query.videoJobsTable.findFirst({
      where: eq(videoJobsTable.eventId, event.id),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    res.json(
      formatEvent(event, counts.guestCount, counts.mediaCount, {
        hostName: user.displayName,
        videoJob: videoJob ?? null,
      }),
    );
  } catch (err) {
    req.log.error(err, "Failed to get event");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update event
router.patch("/events/:eventId", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const event = await db.query.eventsTable.findFirst({
      where: and(
        eq(eventsTable.id, String(req.params.eventId)),
        isNull(eventsTable.deletedAt),
      ),
    });

    if (!event || event.hostId !== user.id) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const { title, description, eventDate, endTime, status, coverImagePath } =
      req.body as {
        title?: string;
        description?: string;
        eventDate?: string;
        endTime?: string;
        status?: "upcoming" | "live" | "ended";
        coverImagePath?: string;
      };

    const [updated] = await db
      .update(eventsTable)
      .set({
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(eventDate !== undefined && { eventDate: new Date(eventDate) }),
        ...(endTime !== undefined && { endTime: new Date(endTime) }),
        ...(status !== undefined && { status }),
        ...(coverImagePath !== undefined && { coverImagePath }),
        updatedAt: new Date(),
      })
      .where(eq(eventsTable.id, event.id))
      .returning();

    const counts = await getEventCounts(updated.id);
    const videoJob = await db.query.videoJobsTable.findFirst({
      where: eq(videoJobsTable.eventId, updated.id),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    res.json(
      formatEvent(updated, counts.guestCount, counts.mediaCount, {
        hostName: user.displayName,
        videoJob: videoJob ?? null,
      }),
    );
  } catch (err) {
    req.log.error(err, "Failed to update event");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete event
router.delete("/events/:eventId", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const event = await db.query.eventsTable.findFirst({
      where: and(
        eq(eventsTable.id, String(req.params.eventId)),
        isNull(eventsTable.deletedAt),
      ),
    });

    if (!event || event.hostId !== user.id) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    await db
      .update(eventsTable)
      .set({ deletedAt: new Date() })
      .where(eq(eventsTable.id, event.id));

    res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to delete event");
    res.status(500).json({ error: "Internal server error" });
  }
});

// End event and trigger video job
router.post("/events/:eventId/end", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const event = await db.query.eventsTable.findFirst({
      where: and(
        eq(eventsTable.id, String(req.params.eventId)),
        isNull(eventsTable.deletedAt),
      ),
    });

    if (!event || event.hostId !== user.id) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    await db
      .update(eventsTable)
      .set({ status: "ended", updatedAt: new Date() })
      .where(eq(eventsTable.id, event.id));

    const subscription = await db.query.subscriptionsTable.findFirst({
      where: eq(subscriptionsTable.userId, user.id),
    });
    // Treat lapsed/past-due/cancelled subscriptions as free to avoid giving paid caps for free
    const activeStatuses = ["active", "trialing"];
    const hostEffectiveTier =
      subscription?.status && activeStatuses.includes(subscription.status)
        ? (subscription.tier ?? "free")
        : "free";

    // If host is on free tier, check if any guests joined via an active vendor referral code.
    // A vendor-referred guest earns the event a 3-minute (vendor) cap — the host's free cap is upgraded.
    let tier = hostEffectiveTier;
    if (tier === "free") {
      const [vendorGuestRow] = await db
        .select({ cnt: count() })
        .from(eventGuestsTable)
        .where(
          and(
            eq(eventGuestsTable.eventId, event.id),
            eq(eventGuestsTable.vendorBenefit, true),
            isNull(eventGuestsTable.deletedAt),
          ),
        );
      if (Number(vendorGuestRow?.cnt ?? 0) > 0) {
        tier = "vendor"; // 3-minute cap from vendor benefit
      }
    }

    const durationCap = getDurationCap(tier);
    const { quality, maxResolutionPx } = getQualityCap(tier);

    const [job] = await db
      .insert(videoJobsTable)
      .values({
        eventId: event.id,
        tier,
        durationCapSeconds: durationCap,
        qualityCap: quality,
        maxResolutionPx,
      })
      .returning();

    res.json({
      id: job.id,
      eventId: job.eventId,
      status: job.status,
      videoUrl: job.videoUrl,
      durationCapSeconds: job.durationCapSeconds,
      tier: job.tier,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    });
  } catch (err) {
    req.log.error(err, "Failed to end event");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Approve the compiled video for delivery (host only) — triggers notification fan-out
router.post("/events/:eventId/video/approve", requireAuth, approveVideoHandler);

// Regenerate the video: supersede the current job and enqueue a fresh one (host only)
router.post("/events/:eventId/video/regenerate", requireAuth, regenerateVideoHandler);

// List event guests (host only)
router.get("/events/:eventId/guests", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const event = await db.query.eventsTable.findFirst({
      where: and(
        eq(eventsTable.id, String(req.params.eventId)),
        isNull(eventsTable.deletedAt),
      ),
    });

    if (!event || event.hostId !== user.id) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const guests = await db.query.eventGuestsTable.findMany({
      where: and(
        eq(eventGuestsTable.eventId, event.id),
        isNull(eventGuestsTable.deletedAt),
      ),
      orderBy: (t, { asc }) => [asc(t.joinedAt)],
    });

    res.json({
      guests: guests.map((g) => ({
        id: g.id,
        displayName: g.displayName,
        email: g.email,
        guestToken: g.guestToken,
        vendorBenefit: g.vendorBenefit,
        joinedAt: g.joinedAt,
      })),
    });
  } catch (err) {
    req.log.error(err, "Failed to list guests");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get event video status (host or event-guest only)
router.get(
  "/events/:eventId/video-status",
  optionalAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const event = await db.query.eventsTable.findFirst({
        where: and(
          eq(eventsTable.id, String(req.params.eventId)),
          isNull(eventsTable.deletedAt),
        ),
      });

      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }

      // Access control: host or a guest of this event
      const isHost = req.dbUser && req.dbUser.id === event.hostId;
      const isEventGuest =
        req.guestRecord && req.guestRecord.eventId === event.id;

      if (!isHost && !isEventGuest) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      const job = await db.query.videoJobsTable.findFirst({
        where: and(
          eq(videoJobsTable.eventId, event.id),
          isNull(videoJobsTable.supersededAt),
        ),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });

      if (!job) {
        res.status(404).json({ error: "No video job found for this event" });
        return;
      }

      // Host/event-guest are authed — surface ready_for_review + videoUrl freely.
      res.json(formatVideoJob(job));
    } catch (err) {
      req.log.error(err, "Failed to get video status");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Get QR payload for an event (host only)
// Returns the join URL and share token to be encoded into a QR code
router.get(
  "/events/:eventId/qr-payload",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const event = await db.query.eventsTable.findFirst({
        where: and(
          eq(eventsTable.id, String(req.params.eventId)),
          isNull(eventsTable.deletedAt),
        ),
      });

      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }

      if (event.hostId !== req.dbUser!.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const shareUrl = buildShareUrl(event.shareToken);

      res.json({
        shareToken: event.shareToken,
        shareUrl,
        qrData: shareUrl,
        eventId: event.id,
        eventTitle: event.title,
      });
    } catch (err) {
      req.log.error(err, "Failed to get QR payload");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Get event by share token (public)
router.get("/events/token/:shareToken", async (req, res) => {
  try {
    const event = await db.query.eventsTable.findFirst({
      where: and(
        eq(eventsTable.shareToken, String(req.params.shareToken)),
        isNull(eventsTable.deletedAt),
      ),
    });

    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const counts = await getEventCounts(event.id);

    const host = await db.query.usersTable.findFirst({
      where: (u) => eq(u.id, event.hostId),
    });

    res.json({
      id: event.id,
      title: event.title,
      description: event.description,
      eventDate: event.eventDate,
      status: event.status,
      hostName: host?.displayName ?? null,
      coverImagePath: event.coverImagePath,
      guestCount: counts.guestCount,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get video status by share token (PUBLIC — used by email link recipients on any device)
// Returns video status only when a job exists; 404 if no job yet.
router.get("/events/token/:shareToken/video-status", async (req, res) => {
  try {
    const event = await db.query.eventsTable.findFirst({
      where: and(
        eq(eventsTable.shareToken, String(req.params.shareToken)),
        isNull(eventsTable.deletedAt),
      ),
    });

    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const job = await db.query.videoJobsTable.findFirst({
      where: and(
        eq(videoJobsTable.eventId, event.id),
        isNull(videoJobsTable.supersededAt),
      ),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    if (!job) {
      res.status(404).json({ error: "No video job found for this event" });
      return;
    }

    // SECURITY-CRITICAL: never expose the unapproved review cut to guests.
    res.json(buildTokenVideoStatusResponse(job));
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
