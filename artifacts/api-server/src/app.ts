import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { WebhookHandlers } from "./lib/webhookHandlers";
import {
  activateSubscription,
  updateSubscriptionByCustomer,
  cancelSubscription,
} from "./routes/billing";
import { getUncachableStripeClient } from "./lib/stripeClient";
import router from "./routes";

const app: Express = express();

// ─── Stripe webhook — must be BEFORE express.json() so body stays a Buffer ───

app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }
    const sig = Array.isArray(signature) ? signature[0] : signature;

    if (!Buffer.isBuffer(req.body)) {
      logger.error(
        "Stripe webhook body is not a Buffer — express.json() may have run first",
      );
      res.status(500).json({ error: "Webhook processing error" });
      return;
    }

    try {
      // Let stripe-replit-sync validate the signature and update stripe.* schema tables
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);

      // Also parse the event ourselves to sync our own subscriptionsTable
      try {
        const stripe = await getUncachableStripeClient();
        const rawBody = (req.body as Buffer).toString("utf-8");
        const event = JSON.parse(rawBody) as { type: string; data: { object: Record<string, unknown> } };

        await syncSubscriptionFromStripeEvent(stripe, event);
      } catch (syncErr) {
        // Log but don't fail the webhook — stripe-replit-sync already validated it
        logger.warn({ syncErr }, "Failed to sync subscription from Stripe event");
      }

      res.status(200).json({ received: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err }, "Stripe webhook processing error");
      res.status(400).json({ error: message });
    }
  },
);

async function syncSubscriptionFromStripeEvent(
  _stripe: import("stripe").default,
  event: { type: string; data: { object: Record<string, unknown> } },
): Promise<void> {
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      if (obj["mode"] !== "subscription") break;
      const userId = (obj["metadata"] as Record<string, string> | null)?.userId;
      const tier = (obj["metadata"] as Record<string, string> | null)?.tier as
        | "pro"
        | "vendor"
        | undefined;
      const stripeSubId = obj["subscription"] as string | undefined;
      const stripeCustomerId = obj["customer"] as string | undefined;

      if (!userId || !tier || !stripeSubId || !stripeCustomerId) break;

      await activateSubscription({
        userId,
        tier,
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId,
      });
      logger.info({ userId, tier }, "Subscription activated from checkout");
      break;
    }

    case "invoice.payment_succeeded": {
      const customerId = obj["customer"] as string | undefined;
      const lines = obj["lines"] as { data?: Array<{ period?: { end?: number } }> } | undefined;
      const periodEnd = lines?.data?.[0]?.period?.end;
      if (!customerId) break;
      await updateSubscriptionByCustomer(customerId, {
        status: "active",
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : undefined,
      });
      break;
    }

    case "invoice.payment_failed": {
      const customerId = obj["customer"] as string | undefined;
      if (!customerId) break;
      await updateSubscriptionByCustomer(customerId, { status: "past_due" });
      logger.info({ customerId }, "Subscription marked past_due");
      break;
    }

    case "customer.subscription.deleted": {
      const subId = obj["id"] as string | undefined;
      if (!subId) break;
      await cancelSubscription(subId);
      logger.info({ subId }, "Subscription cancelled — downgraded to free");
      break;
    }

    default:
      break;
  }
}

// ─── Standard middleware (applied AFTER webhook route) ─────────────────────

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
