import { Router } from "express";
import { db } from "@workspace/db";
import {
  eventsTable,
  mediaItemsTable,
  eventGuestsTable,
} from "@workspace/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import {
  optionalAuth,
  type AuthenticatedRequest,
} from "../lib/auth";

const router = Router();

function buildMediaUrl(objectPath: string): string {
  return `/api/storage${objectPath}`;
}

// List event media
// Requires the caller to be either the event host (Clerk auth) or a guest for this event (guest token)
// Optional ?guestId=<id> filter to view a single guest's uploads
router.get(
  "/events/:eventId/media",
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

      // Access control: host or a guest belonging to this event
      const isHost = req.dbUser && req.dbUser.id === event.hostId;
      const isEventGuest =
        req.guestRecord && req.guestRecord.eventId === event.id;

      if (!isHost && !isEventGuest) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      // Optional per-guest filter
      const filterGuestId = req.query.guestId as string | undefined;

      const whereConditions = [
        eq(mediaItemsTable.eventId, event.id),
        isNull(mediaItemsTable.deletedAt),
        ...(filterGuestId
          ? [eq(mediaItemsTable.guestId, filterGuestId)]
          : []),
      ];

      const items = await db.query.mediaItemsTable.findMany({
        where: and(...(whereConditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]])),
        orderBy: [desc(mediaItemsTable.createdAt)],
      });

      // Build a map of guestId -> displayName for this event
      const allGuests = await db.query.eventGuestsTable.findMany({
        where: eq(eventGuestsTable.eventId, event.id),
      });
      const guestMap = new Map(allGuests.map((g) => [g.id, g.displayName]));

      res.json({
        media: items.map((item) => ({
          id: item.id,
          eventId: item.eventId,
          guestId: item.guestId,
          uploaderDisplayName: item.guestId
            ? guestMap.get(item.guestId) ?? null
            : null,
          mediaType: item.mediaType,
          objectPath: item.objectPath,
          mediaUrl: buildMediaUrl(item.objectPath),
          fileName: item.fileName,
          fileSizeBytes: item.fileSizeBytes,
          durationSeconds: item.durationSeconds,
          thumbnailPath: item.thumbnailPath,
          createdAt: item.createdAt,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Confirm media upload (create record after successful storage upload)
// Requires a valid guest token for this event, or host auth
router.post(
  "/events/:eventId/media",
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

      // Access control: host or a guest belonging to this event
      const isHost = req.dbUser && req.dbUser.id === event.hostId;
      const isEventGuest =
        req.guestRecord && req.guestRecord.eventId === event.id;

      if (!isHost && !isEventGuest) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      const {
        objectPath,
        mediaType,
        fileName,
        fileSizeBytes,
        durationSeconds,
        thumbnailPath,
        capturedAt,
      } = req.body as {
        objectPath: string;
        mediaType: "photo" | "video" | "voice_note";
        fileName?: string;
        fileSizeBytes?: number;
        durationSeconds?: number;
        thumbnailPath?: string;
        capturedAt?: string;
      };

      if (!objectPath || !mediaType) {
        res.status(400).json({ error: "objectPath and mediaType are required" });
        return;
      }

      // Validate objectPath format — must start with /objects/ (the private bucket prefix)
      if (!objectPath.startsWith("/objects/")) {
        res.status(400).json({ error: "Invalid objectPath: must start with /objects/" });
        return;
      }

      // Prevent path reuse: reject if this objectPath is already claimed
      const existing = await db.query.mediaItemsTable.findFirst({
        where: eq(mediaItemsTable.objectPath, objectPath),
      });
      if (existing) {
        res.status(409).json({ error: "This object path has already been registered" });
        return;
      }

      const guest = req.guestRecord;

      const [item] = await db
        .insert(mediaItemsTable)
        .values({
          eventId: event.id,
          guestId: guest?.id,
          uploaderId: req.dbUser?.id,
          mediaType,
          objectPath,
          fileName,
          fileSizeBytes,
          durationSeconds,
          thumbnailPath,
          capturedAt: capturedAt ? new Date(capturedAt) : undefined,
        })
        .returning();

      const uploaderDisplayName = guest?.displayName ?? null;

      res.status(201).json({
        id: item.id,
        eventId: item.eventId,
        guestId: item.guestId,
        uploaderDisplayName,
        mediaType: item.mediaType,
        objectPath: item.objectPath,
        mediaUrl: buildMediaUrl(item.objectPath),
        fileName: item.fileName,
        fileSizeBytes: item.fileSizeBytes,
        durationSeconds: item.durationSeconds,
        thumbnailPath: item.thumbnailPath,
        capturedAt: item.capturedAt,
        createdAt: item.createdAt,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
