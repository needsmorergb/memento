import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @workspace/db before importing the module under test ──────────────────
// We control what findFirst / insert / update / execute return per test so we
// can simulate concurrent webhook deliveries without a real database.

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockFindFirst = vi.fn();
const mockExecute = vi.fn().mockResolvedValue(undefined);

vi.mock("@workspace/db", () => {
  const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };

  return {
    db: {
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          execute: mockExecute,
          query: {
            subscriptionsTable: { findFirst: mockFindFirst },
          },
          insert: () => insertChain,
          update: () => updateChain,
        };
        (tx.insert as ReturnType<typeof vi.fn>) = vi.fn(() => {
          mockInsert();
          return insertChain;
        });
        (tx.update as ReturnType<typeof vi.fn>) = vi.fn(() => {
          mockUpdate();
          return updateChain;
        });
        await fn(tx);
      }),
      query: {
        usersTable: { findFirst: vi.fn().mockResolvedValue(null) },
      },
    },
    subscriptionsTable: {},
    usersTable: {},
    vendorCodesTable: {},
  };
});

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/stripeClient", () => ({
  getUncachableStripeClient: vi.fn(),
}));

import { activateSubscription } from "./billing";
import { db } from "@workspace/db";

const BASE_OPTS = {
  userId: "user-concurrent-123",
  tier: "pro" as const,
  stripeSubscriptionId: "sub_abc",
  stripeCustomerId: "cus_abc",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Re-apply defaults that clearAllMocks wipes
  mockExecute.mockResolvedValue(undefined);
});

describe("activateSubscription — idempotency / duplicate webhook delivery", () => {
  it("inserts a new row when no subscription exists", async () => {
    mockFindFirst.mockResolvedValue(undefined);

    await activateSubscription(BASE_OPTS);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates the existing row instead of inserting a duplicate", async () => {
    mockFindFirst.mockResolvedValue({
      id: "sub-row-id",
      userId: BASE_OPTS.userId,
      tier: "pro",
      status: "active",
    });

    await activateSubscription(BASE_OPTS);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("simulates two concurrent checkout.session.completed deliveries — only one INSERT, never two", async () => {
    // The advisory lock guarantees serial execution. We model that here:
    // call-1 runs its transaction body first (finds no row → inserts),
    // call-2 runs its transaction body second (finds the row → updates).
    // Net result: exactly one INSERT, one UPDATE, no duplicate rows.

    let callCount = 0;
    mockFindFirst.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        // First delivery sees an empty table
        return undefined;
      }
      // Second delivery (after first transaction committed) sees the row
      return { id: "sub-row-id", userId: BASE_OPTS.userId, tier: "pro", status: "active" };
    });

    // Fire both "concurrently" (the advisory lock serialises them in production;
    // in tests the mock runs them sequentially, which is the same net effect).
    await Promise.all([
      activateSubscription(BASE_OPTS),
      activateSubscription(BASE_OPTS),
    ]);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("always acquires the advisory lock inside the transaction", async () => {
    mockFindFirst.mockResolvedValue(undefined);

    await activateSubscription(BASE_OPTS);

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const call = mockExecute.mock.calls[0][0];
    // The SQL object produced by Drizzle's sql`` tag has a queryChunks / sql
    // property; just verify it contains the lock function name as a string.
    expect(JSON.stringify(call)).toMatch(/pg_advisory_xact_lock/);
  });
});
