import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, referralCodesTable, subscriptionsTable } from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import crypto from "crypto";

const router = Router();

function generateReferralCode(businessName: string): string {
  const slug = businessName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${slug}-${suffix}`;
}

function buildJoinUrl(code: string): string {
  const domain = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://localhost:3000";
  return `${domain}/join?ref=${code}`;
}

// Register as vendor — saves businessName and redirects to Stripe checkout if not subscribed
router.post(
  "/vendors/register",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.dbUser!;
      const { businessName, benefitDescription } = req.body as {
        businessName: string;
        benefitDescription?: string;
      };

      if (!businessName) {
        res.status(400).json({ error: "businessName is required" });
        return;
      }

      // Always save businessName so it's ready when the subscription activates
      await db
        .update(usersTable)
        .set({ vendorBusinessName: businessName, updatedAt: new Date() })
        .where(eq(usersTable.id, user.id));

      // Check for active vendor subscription before granting vendor capabilities
      const subscription = await db.query.subscriptionsTable.findFirst({
        where: and(
          eq(subscriptionsTable.userId, user.id),
          isNull(subscriptionsTable.deletedAt),
        ),
      });

      const activeStatuses = ["active", "trialing"];
      const hasActiveVendorSub =
        subscription?.tier === "vendor" &&
        subscription.status != null &&
        activeStatuses.includes(subscription.status);

      if (!hasActiveVendorSub) {
        // Return a 402 with a clear message — client should redirect to billing checkout
        res.status(402).json({
          error: "A Vendor subscription is required to access vendor features.",
          checkoutRequired: true,
        });
        return;
      }

      // Active subscription confirmed — grant vendor flag and referral code
      await db
        .update(usersTable)
        .set({ isVendor: true, updatedAt: new Date() })
        .where(eq(usersTable.id, user.id));

      let referralCode = await db.query.referralCodesTable.findFirst({
        where: eq(referralCodesTable.userId, user.id),
      });

      if (!referralCode) {
        const code = generateReferralCode(businessName);
        [referralCode] = await db
          .insert(referralCodesTable)
          .values({
            userId: user.id,
            code,
            benefitDescription,
            videoDurationCapSeconds: 180,
          })
          .returning();
      }

      res.json({
        isVendor: true,
        businessName,
        referralCode: referralCode.code,
      });
    } catch (err) {
      req.log.error(err, "Failed to register vendor");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Get vendor referral code
router.get(
  "/vendors/referral-code",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.dbUser!;
      const referralCode = await db.query.referralCodesTable.findFirst({
        where: eq(referralCodesTable.userId, user.id),
      });

      if (!referralCode) {
        res.status(404).json({ error: "No referral code found — register as a vendor first" });
        return;
      }

      res.json({
        code: referralCode.code,
        joinUrl: buildJoinUrl(referralCode.code),
        benefitDescription: referralCode.benefitDescription,
        videoDurationCapSeconds: referralCode.videoDurationCapSeconds,
      });
    } catch (err) {
      req.log.error(err, "Failed to get referral code");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
