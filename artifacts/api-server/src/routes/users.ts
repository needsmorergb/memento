import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, subscriptionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";

const router = Router();

router.get("/users/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const subscription = await db.query.subscriptionsTable.findFirst({
      where: eq(subscriptionsTable.userId, user.id),
    });

    res.json({
      id: user.id,
      clerkId: user.clerkId,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isVendor: user.isVendor,
      vendorBusinessName: user.vendorBusinessName,
      subscriptionTier: subscription?.tier ?? "free",
      createdAt: user.createdAt,
    });
  } catch (err) {
    req.log.error(err, "Failed to get user");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/users/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const { displayName, avatarUrl } = req.body as {
      displayName?: string;
      avatarUrl?: string;
    };

    const [updated] = await db
      .update(usersTable)
      .set({
        ...(displayName !== undefined && { displayName }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id))
      .returning();

    const subscription = await db.query.subscriptionsTable.findFirst({
      where: eq(subscriptionsTable.userId, user.id),
    });

    res.json({
      id: updated.id,
      clerkId: updated.clerkId,
      email: updated.email,
      displayName: updated.displayName,
      avatarUrl: updated.avatarUrl,
      isVendor: updated.isVendor,
      vendorBusinessName: updated.vendorBusinessName,
      subscriptionTier: subscription?.tier ?? "free",
      createdAt: updated.createdAt,
    });
  } catch (err) {
    req.log.error(err, "Failed to update user");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
