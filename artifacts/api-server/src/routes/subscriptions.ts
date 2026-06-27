import { Router } from "express";
import { db } from "@workspace/db";
import { subscriptionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { getDurationCap, type SubscriptionTier } from "../lib/tier";

const router = Router();

router.get(
  "/subscriptions/me",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.dbUser!;
      const subscription = await db.query.subscriptionsTable.findFirst({
        where: eq(subscriptionsTable.userId, user.id),
      });

      const tier = (subscription?.tier ?? "free") as SubscriptionTier;

      res.json({
        tier,
        status: subscription?.status ?? "active",
        stripeSubscriptionId: subscription?.stripeSubscriptionId ?? null,
        currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
        billingInterval: subscription?.billingInterval ?? null,
        videoDurationCapSeconds: getDurationCap(tier),
      });
    } catch (err) {
      req.log.error(err, "Failed to get subscription");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
