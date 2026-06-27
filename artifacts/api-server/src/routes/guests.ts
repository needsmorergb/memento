import { Router } from "express";
import { db } from "@workspace/db";
import {
  eventsTable,
  eventGuestsTable,
  vendorCodesTable,
} from "@workspace/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireGuestAuth, type AuthenticatedRequest } from "../lib/auth";
import crypto from "crypto";

const router = Router();

function generateGuestToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Join an event
router.post("/guests/join", async (req, res) => {
  try {
    const { shareToken, displayName, email, phone, referralCode } =
      req.body as {
        shareToken: string;
        displayName: string;
        email?: string;
        phone?: string;
        referralCode?: string;
      };

    if (!shareToken || !displayName) {
      res.status(400).json({ error: "shareToken and displayName are required" });
      return;
    }

    const event = await db.query.eventsTable.findFirst({
      where: and(
        eq(eventsTable.shareToken, shareToken),
        isNull(eventsTable.deletedAt),
      ),
    });

    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    let vendorCodeId: string | undefined;
    let vendorBenefit = false;

    if (referralCode) {
      const vendorCode = await db.query.vendorCodesTable.findFirst({
        where: and(
          eq(vendorCodesTable.code, referralCode),
          eq(vendorCodesTable.isActive, true),
        ),
      });
      if (vendorCode) {
        vendorCodeId = vendorCode.id;
        vendorBenefit = true;
      }
    }

    const guestToken = generateGuestToken();
    const [guest] = await db
      .insert(eventGuestsTable)
      .values({
        eventId: event.id,
        displayName,
        email,
        phone,
        guestToken,
        vendorCodeId,
        vendorBenefit,
      })
      .returning();

    const host = await db.query.usersTable.findFirst({
      where: (u) => eq(u.id, event.hostId),
    });

    res.status(201).json({
      guest: {
        id: guest.id,
        displayName: guest.displayName,
        email: guest.email,
        guestToken: guest.guestToken,
        vendorBenefit: guest.vendorBenefit,
        joinedAt: guest.joinedAt,
      },
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        eventDate: event.eventDate,
        status: event.status,
        hostName: host?.displayName ?? null,
        coverImagePath: event.coverImagePath,
        guestCount: 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update guest (push token, etc.)
router.patch(
  "/guests/me",
  requireGuestAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const guest = req.guestRecord!;
      const { pushToken, email, displayName } = req.body as {
        pushToken?: string;
        email?: string;
        displayName?: string;
      };

      const [updated] = await db
        .update(eventGuestsTable)
        .set({
          ...(pushToken !== undefined && { pushToken }),
          ...(email !== undefined && { email }),
          ...(displayName !== undefined && { displayName }),
        })
        .where(eq(eventGuestsTable.id, guest.id))
        .returning();

      res.json({
        id: updated.id,
        displayName: updated.displayName,
        email: updated.email,
        guestToken: updated.guestToken,
        vendorBenefit: updated.vendorBenefit,
        joinedAt: updated.joinedAt,
      });
    } catch (err) {
      req.log.error(err, "Failed to update guest");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
