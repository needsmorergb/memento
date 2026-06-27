import { Router } from "express";
import { db } from "@workspace/db";
import {
  eventsTable,
  eventGuestsTable,
  mediaItemsTable,
  videoJobsTable,
  subscriptionsTable,
} from "@workspace/db/schema";
import { eq, and, isNull, count, sql } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { getDurationCap } from "../lib/tier";
import crypto from "crypto";

const router = Router();

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
    const tier = subscription?.tier ?? "free";
    const durationCap = getDurationCap(tier);

    const [job] = await db
      .insert(videoJobsTable)
      .values({
        eventId: event.id,
        tier,
        durationCapSeconds: durationCap,
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

// Get event video status
router.get("/events/:eventId/video-status", async (req, res) => {
  try {
    const job = await db.query.videoJobsTable.findFirst({
      where: eq(videoJobsTable.eventId, String(req.params.eventId)),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    if (!job) {
      res.status(404).json({ error: "No video job found for this event" });
      return;
    }

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
    (req as any).log?.error(err, "Failed to get video status");
    res.status(500).json({ error: "Internal server error" });
  }
});

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

export default router;
