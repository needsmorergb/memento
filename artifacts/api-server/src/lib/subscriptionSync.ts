import type Stripe from "stripe";
import {
  activateSubscription,
  updateSubscriptionByCustomer,
  cancelSubscription,
} from "../routes/billing";
import { logger } from "./logger";

export type StripeEventLike = {
  type: string;
  data: { object: Record<string, unknown> };
};

export async function syncSubscriptionFromStripeEvent(
  _stripe: Stripe,
  event: StripeEventLike,
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

      // Retrieve the Stripe subscription to determine the billing interval
      let billingInterval: "monthly" | "annual" | undefined;
      try {
        const sub = await _stripe.subscriptions.retrieve(stripeSubId);
        const interval = sub.items.data[0]?.price?.recurring?.interval;
        if (interval === "year") billingInterval = "annual";
        else if (interval === "month") billingInterval = "monthly";
      } catch {
        // non-fatal — interval stays undefined
      }

      await activateSubscription({
        userId,
        tier,
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId,
        billingInterval,
      });
      logger.info({ userId, tier, billingInterval }, "Subscription activated from checkout");
      break;
    }

    case "invoice.payment_succeeded": {
      const customerId = obj["customer"] as string | undefined;
      const lines = obj["lines"] as
        | { data?: Array<{ period?: { end?: number } }> }
        | undefined;
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
