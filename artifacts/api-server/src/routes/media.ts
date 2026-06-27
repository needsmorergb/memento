import { Router } from "express";
import { db } from "@workspace/db";
import {
  eventsTable,
  mediaItemsTable,
  eventGuestsTable,
} from "@workspace/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import {
  optionalGuestAuth,
  type AuthenticatedRequest,
} from "../lib/auth";

const router = Router();

function buildMediaUrl(objectPath: string): string {
  return `/api/storage${objectPath}`;
}

// List event media
router.get(
  "/events/:eventId/media",
  optionalGuestAuth,
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

      const items = await db.query.mediaItemsTable.findMany({
        where: and(
          eq(mediaItemsTable.eventId, event.id),
          isNull(mediaItemsTable.deletedAt),
        ),
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
router.post(
  "/events/:eventId/media",
  optionalGuestAuth,
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

      const {
        objectPath,
        mediaType,
        fileName,
        fileSizeBytes,
        durationSeconds,
        thumbnailPath,
      } = req.body as {
        objectPath: string;
        mediaType: "photo" | "video" | "voice_note";
        fileName?: string;
        fileSizeBytes?: number;
        durationSeconds?: number;
        thumbnailPath?: string;
      };

      if (!objectPath || !mediaType) {
        res.status(400).json({ error: "objectPath and mediaType are required" });
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
        fileName: item.fileName,
        fileSizeBytes: item.fileSizeBytes,
        durationSeconds: item.durationSeconds,
        thumbnailPath: item.thumbnailPath,
        createdAt: item.createdAt,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
