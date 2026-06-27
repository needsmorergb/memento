import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncSubscriptionFromStripeEvent } from "./subscriptionSync";
import type { StripeEventLike } from "./subscriptionSync";

vi.mock("../routes/billing", () => ({
  activateSubscription: vi.fn().mockResolvedValue(undefined),
  updateSubscriptionByCustomer: vi.fn().mockResolvedValue(undefined),
  cancelSubscription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  activateSubscription,
  updateSubscriptionByCustomer,
  cancelSubscription,
} from "../routes/billing";

const mockStripe = {} as import("stripe").default;

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── checkout.session.completed ───────────────────────────────────────────────

describe("checkout.session.completed", () => {
  it("activates a pro subscription when all required fields are present", async () => {
    const event: StripeEventLike = {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          metadata: { userId: "user-123", tier: "pro" },
          subscription: "sub_abc123",
          customer: "cus_abc123",
        },
      },
    };

    await syncSubscriptionFromStripeEvent(mockStripe, event);

    expect(activateSubscription).toHaveBeenCalledOnce();
    expect(activateSubscription).toHaveBeenCalledWith({
      userId: "user-123",
      tier: "pro",
      stripeSubscriptionId: "sub_abc123",
      stripeCustomerId: "cus_abc123",
    });
    expect(updateSubscriptionByCustomer).not.toHaveBeenCalled();
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it("activates a vendor subscription correctly", async () => {
    const event: StripeEventLike = {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          metadata: { userId: "vendor-456", tier: "vendor" },
          subscription: "sub_vendor456",
          customer: "cus_vendor456",
        },
      },
    };

    await syncSubscriptionFromStripeEvent(mockStripe, event);

    expect(activateSubscription).toHaveBeenCalledWith({
      userId: "vendor-456",
      tier: "vendor",
      stripeSubscriptionId: "sub_vendor456",
      stripeCustomerId: "cus_vendor456",
    });
  });

  it("does nothing when mode is not subscription", async () => {
    const event: StripeEventLike = {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "payment",
          metadata: { userId: "user-123", tier: "pro" },
          subscription: "sub_abc123",
          customer: "cus_abc123",
        },
      },
    };

    await syncSubscriptionFromStripeEvent(mockStripe, event);

    expect(activateSubscription).not.toHaveBeenCalled();
  });

  it("does nothing when userId is missing from metadata", async () => {
    const event: StripeEventLike = {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          metadata: { tier: "pro" },
          subscription: "sub_abc123",
          customer: "cus_abc123",
        },
      },
    };

    await syncSubscriptionFromStripeEvent(mockStripe, event);

    expect(activateSubscription).not.toHaveBeenCalled();
  });

  it("does nothing when subscription ID is missing", async () => {
    const event: StripeEventLike = {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          metadata: { userId: "user-123", tier: "pro" },
          customer: "cus_abc123",
        },
      },
    };

    await syncSubscriptionFromStripeEvent(mockStripe, event);

    expect(activateSubscription).not.toHaveBeenCalled();
  });
});

// ─── invoice.payment_succeeded ────────────────────────────────────────────────

describe("invoice.payment_succeeded", () => {
  it("sets subscription status to active and updates period end", async () => {
    const periodEndUnix = 1800000000;
    const event: StripeEventLike = {
      type: "invoice.payment_succeeded",
      data: {
        object: {
          customer: "cus_abc123",
          lines: {
            data: [{ period: { end: periodEndUnix } }],
          },
        },
      },
    };

    await syncSubscriptionFromStripeEvent(mockStripe, event);

    expect(updateSubscriptionByCustomer).toHaveBeenCalledOnce();
    expect(updateSubscriptionByCustomer).toHaveBeenCalledWith("cus_abc123", {
      status: "active",
      currentPeriodEnd: new Date(periodEndUnix * 1000),
    });
    expect(activateSubscription).not.toHaveBeenCalled();
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it("sets status to active without period end when lines are absent", async () => {
    const event: StripeEventLike = {
      type: "invoice.payment_succeeded",
      data: {
        object: {
          customer: "cus_abc123",
        },
      },
    };

    await syncSubscriptionFromStripeEvent(mockStripe, event);

    expect(updateSubscriptionByCustomer).toHaveBeenCalledWith("cus_abc123", {
      status: "active",
      currentPeriodEnd: undefined,
    });
  });

  it("does nothing when customer ID is missing", async () => {
    const event: StripeEventLike = {
      type: "invoice.payment_succeeded",
      data: {
        object: {
          lines: { data: [{ period: { end: 1800000000 } }] },
        },
      },
    };

    await syncSubscriptionFromStripeEvent(mockStripe, event);

    expect(updateSubscriptionByCustomer).not.toHaveBeenCalled();
  });

  it("represents the renewal scenario (free→pro already active, renews → stays active)", async () => {
    const renewalPeriodEnd = 1800000000;
    const event: StripeEventLike = {
      type: "invoice.payment_succeeded",
      data: {
        object: {
          customer: "cus_renewal",
          lines: {
            data: [{ period: { end: renewalPeriodEnd } }],
          },
        },
      },
    };

    await syncSubscriptionFromStripeEvent(mockStripe, event);

    expect(updateSubscriptionByCustomer).toHaveBeenCalledWith("cus_renewal", {
      status: "active",
      currentPeriodEnd: new Date(renewalPeriodEnd * 1000),
    });
  });
});

// ─── invoice.payment_failed ───────────────────────────────────────────────────

describe("invoice.payment_failed", () => {
  it("marks subscription as past_due (pro→past_due)", async () => {
    const event: StripeEventLike = {
      type: "invoice.payment_failed",
      data: {
        object: {
          customer: "cus_abc123",
        },
      },
    };

    await syncSubscriptionFromStripeEvent(mockStripe, event);

    expect(updateSubscriptionByCustomer).toHaveBeenCalledOnce();
    expect(updateSubscriptionByCustomer).toHaveBeenCalledWith("cus_abc123", {
      status: "past_due",
    });
    expect(activateSubscription).not.toHaveBeenCalled();
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it("does nothing when customer ID is missing", async () => {
    const event: StripeEventLike = {
      type: "invoice.payment_failed",
      data: {
        object: {},
      },
    };

    await syncSubscriptionFromStripeEvent(mockStripe, event);

    expect(updateSubscriptionByCustomer).not.toHaveBeenCalled();
  });
});

// ─── customer.subscription.deleted ───────────────────────────────────────────

describe("customer.subscription.deleted", () => {
  it("cancels subscription and downgrades to free (pro→free)", async () => {
    const event: StripeEventLike = {
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_abc123",
        },
      },
    };

    await syncSubscriptionFromStripeEvent(mockStripe, event);

    expect(cancelSubscription).toHaveBeenCalledOnce();
    expect(cancelSubscription).toHaveBeenCalledWith("sub_abc123");
    expect(activateSubscription).not.toHaveBeenCalled();
    expect(updateSubscriptionByCustomer).not.toHaveBeenCalled();
  });

  it("does nothing when subscription ID is missing", async () => {
    const event: StripeEventLike = {
      type: "customer.subscription.deleted",
      data: {
        object: {},
      },
    };

    await syncSubscriptionFromStripeEvent(mockStripe, event);

    expect(cancelSubscription).not.toHaveBeenCalled();
  });
});

// ─── Unknown event types ──────────────────────────────────────────────────────

describe("unrecognised event types", () => {
  it("ignores unknown event types without calling any billing helper", async () => {
    const event: StripeEventLike = {
      type: "payment_intent.created",
      data: {
        object: {
          customer: "cus_abc123",
        },
      },
    };

    await syncSubscriptionFromStripeEvent(mockStripe, event);

    expect(activateSubscription).not.toHaveBeenCalled();
    expect(updateSubscriptionByCustomer).not.toHaveBeenCalled();
    expect(cancelSubscription).not.toHaveBeenCalled();
  });
});

// ─── Full lifecycle scenario ──────────────────────────────────────────────────

describe("full subscription lifecycle", () => {
  it("free→pro→past_due→pro→free covers the complete lifecycle sequence", async () => {
    const userId = "lifecycle-user";
    const customerId = "cus_lifecycle";
    const subId = "sub_lifecycle";
    const periodEnd = 1800000000;

    await syncSubscriptionFromStripeEvent(mockStripe, {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          metadata: { userId, tier: "pro" },
          subscription: subId,
          customer: customerId,
        },
      },
    });

    expect(activateSubscription).toHaveBeenCalledWith({
      userId,
      tier: "pro",
      stripeSubscriptionId: subId,
      stripeCustomerId: customerId,
    });

    await syncSubscriptionFromStripeEvent(mockStripe, {
      type: "invoice.payment_succeeded",
      data: {
        object: {
          customer: customerId,
          lines: { data: [{ period: { end: periodEnd } }] },
        },
      },
    });

    expect(updateSubscriptionByCustomer).toHaveBeenLastCalledWith(customerId, {
      status: "active",
      currentPeriodEnd: new Date(periodEnd * 1000),
    });

    await syncSubscriptionFromStripeEvent(mockStripe, {
      type: "invoice.payment_failed",
      data: { object: { customer: customerId } },
    });

    expect(updateSubscriptionByCustomer).toHaveBeenLastCalledWith(customerId, {
      status: "past_due",
    });

    await syncSubscriptionFromStripeEvent(mockStripe, {
      type: "invoice.payment_succeeded",
      data: {
        object: {
          customer: customerId,
          lines: { data: [{ period: { end: periodEnd + 2592000 } }] },
        },
      },
    });

    expect(updateSubscriptionByCustomer).toHaveBeenLastCalledWith(customerId, {
      status: "active",
      currentPeriodEnd: new Date((periodEnd + 2592000) * 1000),
    });

    await syncSubscriptionFromStripeEvent(mockStripe, {
      type: "customer.subscription.deleted",
      data: { object: { id: subId } },
    });

    expect(cancelSubscription).toHaveBeenCalledWith(subId);

    expect(activateSubscription).toHaveBeenCalledTimes(1);
    expect(updateSubscriptionByCustomer).toHaveBeenCalledTimes(3);
    expect(cancelSubscription).toHaveBeenCalledTimes(1);
  });
});
