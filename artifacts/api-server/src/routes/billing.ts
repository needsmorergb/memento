import { Router } from "express";
import { db } from "@workspace/db";
import {
  subscriptionsTable,
  usersTable,
  vendorCodesTable,
} from "@workspace/db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { logger } from "../lib/logger";
import crypto from "crypto";

const router = Router();

function buildAppUrl(path: string): string {
  const domain = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://localhost:3000";
  return `${domain}${path}`;
}

function generateReferralCode(businessName: string): string {
  const slug = businessName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${slug}-${suffix}`;
}

async function findOrCreateStripeCustomer(
  userId: string,
  email: string,
): Promise<string> {
  const stripe = await getUncachableStripeClient();

  const existing = await db.query.subscriptionsTable.findFirst({
    where: and(
      eq(subscriptionsTable.userId, userId),
      isNull(subscriptionsTable.deletedAt),
    ),
  });

  if (existing?.stripeCustomerId) {
    return existing.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  });

  if (existing) {
    await db
      .update(subscriptionsTable)
      .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
      .where(eq(subscriptionsTable.id, existing.id));
  } else {
    await db.insert(subscriptionsTable).values({
      userId,
      tier: "free",
      stripeCustomerId: customer.id,
      status: "active",
    });
  }

  return customer.id;
}

async function findPriceIdForTier(
  tier: "pro" | "vendor",
): Promise<string | null> {
  try {
    const result = await db.execute(sql`
      SELECT pr.id
      FROM stripe.prices pr
      JOIN stripe.products p ON pr.product = p.id
      WHERE p.metadata->>'tier' = ${tier}
        AND pr.active = true
        AND p.active = true
      ORDER BY pr.unit_amount ASC
      LIMIT 1
    `);
    return (result.rows[0]?.id as string) ?? null;
  } catch {
    return null;
  }
}

// POST /billing/checkout — create a Stripe Checkout session
router.post(
  "/billing/checkout",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.dbUser!;
      const { plan } = req.body as { plan?: string };

      if (plan !== "pro" && plan !== "vendor") {
        res.status(400).json({ error: "plan must be 'pro' or 'vendor'" });
        return;
      }

      const priceId = await findPriceIdForTier(plan);
      if (!priceId) {
        res.status(503).json({
          error:
            "Stripe products not yet seeded. Run the seed-products script first.",
        });
        return;
      }

      const customerId = await findOrCreateStripeCustomer(user.id, user.email);
      const stripe = await getUncachableStripeClient();

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "subscription",
        subscription_data: {
          metadata: { userId: user.id, tier: plan },
        },
        metadata: { userId: user.id, tier: plan },
        success_url: buildAppUrl(`/host?checkout=success&plan=${plan}`),
        cancel_url: buildAppUrl("/host?checkout=cancelled"),
      });

      res.json({ url: session.url });
    } catch (err) {
      logger.error({ err }, "Failed to create checkout session");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// POST /billing/portal — create a Stripe Customer Portal session
router.post(
  "/billing/portal",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.dbUser!;

      const subscription = await db.query.subscriptionsTable.findFirst({
        where: and(
          eq(subscriptionsTable.userId, user.id),
          isNull(subscriptionsTable.deletedAt),
        ),
      });

      if (!subscription?.stripeCustomerId) {
        res.status(404).json({
          error:
            "No billing account found. Please subscribe to a plan first.",
        });
        return;
      }

      const stripe = await getUncachableStripeClient();
      const session = await stripe.billingPortal.sessions.create({
        customer: subscription.stripeCustomerId,
        return_url: buildAppUrl("/host"),
      });

      res.json({ url: session.url });
    } catch (err) {
      logger.error({ err }, "Failed to create portal session");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// GET /billing/prices — list available plans (public)
router.get("/billing/prices", async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.description AS product_description,
        p.metadata AS product_metadata,
        pr.id AS price_id,
        pr.unit_amount,
        pr.currency,
        pr.recurring
      FROM stripe.products p
      JOIN stripe.prices pr ON pr.product = p.id
      WHERE p.active = true AND pr.active = true
      ORDER BY pr.unit_amount ASC
    `);
    res.json({ prices: rows.rows });
  } catch (err) {
    logger.error({ err }, "Failed to list prices");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Internal helper — called from webhook sync to activate a subscription
export async function activateSubscription(opts: {
  userId: string;
  tier: "pro" | "vendor";
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  currentPeriodEnd?: Date;
}): Promise<void> {
  const { userId, tier, stripeSubscriptionId, stripeCustomerId, currentPeriodEnd } = opts;

  const existing = await db.query.subscriptionsTable.findFirst({
    where: and(
      eq(subscriptionsTable.userId, userId),
      isNull(subscriptionsTable.deletedAt),
    ),
  });

  if (existing) {
    await db
      .update(subscriptionsTable)
      .set({
        tier,
        status: "active",
        stripeSubscriptionId,
        stripeCustomerId,
        currentPeriodEnd: currentPeriodEnd ?? null,
        updatedAt: new Date(),
      })
      .where(eq(subscriptionsTable.id, existing.id));
  } else {
    await db.insert(subscriptionsTable).values({
      userId,
      tier,
      status: "active",
      stripeSubscriptionId,
      stripeCustomerId,
      currentPeriodEnd: currentPeriodEnd ?? null,
    });
  }

  if (tier === "vendor") {
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, userId),
    });
    if (user && !user.isVendor) {
      await db
        .update(usersTable)
        .set({ isVendor: true, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));

      const existingCode = await db.query.vendorCodesTable.findFirst({
        where: eq(vendorCodesTable.userId, userId),
      });
      if (!existingCode) {
        const businessName = user.vendorBusinessName ?? user.displayName ?? user.email;
        const code = generateReferralCode(businessName);
        await db.insert(vendorCodesTable).values({
          userId,
          code,
          videoDurationCapSeconds: 180,
          isActive: true,
        });
      }
    }
  }
}

// Internal helper — update subscription status by Stripe customer ID
export async function updateSubscriptionByCustomer(
  stripeCustomerId: string,
  updates: { status?: string; tier?: "free" | "pro" | "vendor"; currentPeriodEnd?: Date },
): Promise<void> {
  const existing = await db.query.subscriptionsTable.findFirst({
    where: and(
      eq(subscriptionsTable.stripeCustomerId, stripeCustomerId),
      isNull(subscriptionsTable.deletedAt),
    ),
  });

  if (!existing) return;

  await db
    .update(subscriptionsTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(subscriptionsTable.id, existing.id));
}

// Internal helper — downgrade subscription by Stripe subscription ID
export async function cancelSubscription(
  stripeSubscriptionId: string,
): Promise<void> {
  const existing = await db.query.subscriptionsTable.findFirst({
    where: and(
      eq(subscriptionsTable.stripeSubscriptionId, stripeSubscriptionId),
      isNull(subscriptionsTable.deletedAt),
    ),
  });

  if (!existing) return;

  await db
    .update(subscriptionsTable)
    .set({
      tier: "free",
      status: "cancelled",
      stripeSubscriptionId: null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionsTable.id, existing.id));
}

export default router;
