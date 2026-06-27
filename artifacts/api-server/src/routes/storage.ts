import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { eventGuestsTable, mediaItemsTable, eventsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * Requires Clerk auth or a valid guest token — prevents unauthorized upload cost abuse.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  // Auth check: Clerk session OR valid guest token
  const { userId } = getAuth(req);
  let isAuthenticated = Boolean(userId);

  let guestEventId: string | undefined;

  if (!isAuthenticated) {
    const guestToken = req.headers["x-guest-token"] as string | undefined;
    if (guestToken) {
      const guest = await db.query.eventGuestsTable.findFirst({
        where: eq(eventGuestsTable.guestToken, guestToken),
      });
      if (guest) {
        isAuthenticated = true;
        guestEventId = guest.eventId;
      }
    }
  }

  if (!isAuthenticated) {
    res.status(401).json({ error: "Authentication required to upload files" });
    return;
  }

  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve private object entities.
 * Access control: caller must be authenticated AND be the event host or a guest of
 * the event that the object belongs to.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    // Resolve caller identity
    const { userId: clerkUserId } = getAuth(req);
    let dbUserId: string | undefined;
    let guestRecord: typeof eventGuestsTable.$inferSelect | undefined;

    if (clerkUserId) {
      const { usersTable } = await import("@workspace/db/schema");
      const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, clerkUserId),
      });
      if (user) dbUserId = user.id;
    }

    const guestToken = req.headers["x-guest-token"] as string | undefined;
    if (guestToken) {
      const guest = await db.query.eventGuestsTable.findFirst({
        where: eq(eventGuestsTable.guestToken, guestToken),
      });
      if (guest) guestRecord = guest;
    }

    if (!dbUserId && !guestRecord) {
      res.status(401).json({ error: "Authentication required to access private objects" });
      return;
    }

    // Resolve the object path
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // Event-level ownership check: find which event owns this object
    const mediaItem = await db.query.mediaItemsTable.findFirst({
      where: eq(mediaItemsTable.objectPath, objectPath),
    });

    if (mediaItem) {
      const event = await db.query.eventsTable.findFirst({
        where: eq(eventsTable.id, mediaItem.eventId),
      });

      if (event) {
        const isHost = dbUserId && event.hostId === dbUserId;
        const isEventGuest = guestRecord && guestRecord.eventId === event.id;

        if (!isHost && !isEventGuest) {
          res.status(403).json({ error: "Access denied to this object" });
          return;
        }
      }
    } else if (!dbUserId) {
      // Object not in media_items (e.g. thumbnails, covers): require Clerk auth
      res.status(403).json({ error: "Access denied to this object" });
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
