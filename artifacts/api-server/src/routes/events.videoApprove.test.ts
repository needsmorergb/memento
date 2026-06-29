import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module-boundary mocks (hoisted above imports) ───────────────────────────

const mockFindFirstEvent = vi.fn();
const mockFindFirstJob = vi.fn();
const mockFindManyGuests = vi.fn();
const mockFindFirstUser = vi.fn();
const mockUpdateSet = vi.fn();
const mockInsertReturning = vi.fn();
const mockSelect = vi.fn();

vi.mock("@workspace/db", () => {
  // update().set().where() chain — set() resolves, returning() yields the row
  const updateChain = {
    set: (...args: unknown[]) => {
      mockUpdateSet(...args);
      return {
        where: () => ({
          returning: () => Promise.resolve(mockInsertReturning()),
        }),
      };
    },
  };
  return {
    db: {
      query: {
        eventsTable: { findFirst: (...a: unknown[]) => mockFindFirstEvent(...a) },
        videoJobsTable: { findFirst: (...a: unknown[]) => mockFindFirstJob(...a) },
        eventGuestsTable: { findMany: (...a: unknown[]) => mockFindManyGuests(...a) },
        usersTable: { findFirst: (...a: unknown[]) => mockFindFirstUser(...a) },
      },
      update: () => updateChain,
      insert: () => ({
        values: () => ({ returning: () => Promise.resolve(mockInsertReturning()) }),
      }),
      select: (...a: unknown[]) => mockSelect(...a),
    },
    eventsTable: {},
    eventGuestsTable: {},
    mediaItemsTable: {},
    videoJobsTable: {},
    subscriptionsTable: {},
    usersTable: {},
  };
});

vi.mock("@workspace/db/schema", () => ({
  eventsTable: {},
  eventGuestsTable: {},
  mediaItemsTable: {},
  videoJobsTable: {},
  subscriptionsTable: {},
  usersTable: {},
}));

const mockSendPush = vi.fn().mockResolvedValue(undefined);
const mockSendGuestEmails = vi.fn().mockResolvedValue(undefined);
const mockSendHostEmail = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/notifications", () => ({
  sendPushNotifications: (...a: unknown[]) => mockSendPush(...a),
  sendGuestEmails: (...a: unknown[]) => mockSendGuestEmails(...a),
  sendHostEmail: (...a: unknown[]) => mockSendHostEmail(...a),
}));

vi.mock("../lib/auth", () => ({
  requireAuth: vi.fn(),
  optionalAuth: vi.fn(),
}));

vi.mock("../lib/tier", () => ({
  getDurationCap: () => 60,
  getQualityCap: () => ({ quality: "standard", maxResolutionPx: 720 }),
}));

// ── SUT (imported after mocks) ──────────────────────────────────────────────
import {
  approveVideoHandler,
  regenerateVideoHandler,
  buildTokenVideoStatusResponse,
  formatVideoJob,
} from "./events";

// ── Test helpers ────────────────────────────────────────────────────────────

function makeRes() {
  const res: {
    statusCode: number;
    body: unknown;
    status: (c: number) => typeof res;
    json: (b: unknown) => typeof res;
  } = {
    statusCode: 200,
    body: undefined,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return res;
}

function makeReq(eventId: string, userId: string) {
  return {
    params: { eventId },
    dbUser: { id: userId },
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  };
}

const HOST_ID = "host-1";
const EVENT_ID = "event-1";

const readyJob = {
  id: "job-1",
  eventId: EVENT_ID,
  status: "ready_for_review",
  videoUrl: "https://signed/review.mp4",
  videoObjectPath: "/objects/videos/job-1.mp4",
  durationCapSeconds: 60,
  tier: "free",
  errorMessage: null,
  createdAt: new Date("2026-06-28T00:00:00Z"),
  completedAt: null,
  approvedAt: null,
  supersededAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSendPush.mockResolvedValue(undefined);
  mockSendGuestEmails.mockResolvedValue(undefined);
  mockSendHostEmail.mockResolvedValue(undefined);
  mockFindFirstEvent.mockResolvedValue({ id: EVENT_ID, hostId: HOST_ID, title: "Party" });
  mockFindManyGuests.mockResolvedValue([{ id: "g1", email: "g@x.com", pushToken: null }]);
  mockFindFirstUser.mockResolvedValue({ id: HOST_ID, email: "host@x.com", displayName: "Host" });
  // select().from().where() for media count
  mockSelect.mockReturnValue({
    from: () => ({ where: () => Promise.resolve([{ value: 3 }]) }),
  });
});

// ── approve ───────────────────────────────────────────────────────────────

describe("approveVideoHandler", () => {
  it("approves a ready_for_review job: sets approvedAt, fans out once, returns 200", async () => {
    mockFindFirstJob.mockResolvedValue({ ...readyJob });
    mockInsertReturning.mockReturnValue([
      { ...readyJob, status: "completed", approvedAt: new Date(), completedAt: new Date() },
    ]);

    const res = makeRes();
    await approveVideoHandler(makeReq(EVENT_ID, HOST_ID) as never, res as never);

    expect(res.statusCode).toBe(200);
    expect((res.body as { approvedAt: Date | null }).approvedAt).not.toBeNull();
    expect((res.body as { status: string }).status).toBe("completed");
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(mockSendGuestEmails).toHaveBeenCalledTimes(1);
    expect(mockSendHostEmail).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: a second approve (already approvedAt) does NOT re-notify", async () => {
    mockFindFirstJob.mockResolvedValue({
      ...readyJob,
      status: "completed",
      approvedAt: new Date("2026-06-28T01:00:00Z"),
      completedAt: new Date("2026-06-28T01:00:00Z"),
    });

    const res = makeRes();
    await approveVideoHandler(makeReq(EVENT_ID, HOST_ID) as never, res as never);

    expect(res.statusCode).toBe(200);
    expect((res.body as { approvedAt: Date | null }).approvedAt).not.toBeNull();
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(mockSendGuestEmails).not.toHaveBeenCalled();
    expect(mockSendHostEmail).not.toHaveBeenCalled();
  });

  it("returns 409 and does not notify when latest job is not ready_for_review", async () => {
    mockFindFirstJob.mockResolvedValue({ ...readyJob, status: "processing", videoUrl: null });

    const res = makeRes();
    await approveVideoHandler(makeReq(EVENT_ID, HOST_ID) as never, res as never);

    expect(res.statusCode).toBe(409);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-owner and never loads a job", async () => {
    const res = makeRes();
    await approveVideoHandler(makeReq(EVENT_ID, "intruder") as never, res as never);

    expect(res.statusCode).toBe(404);
    expect(mockFindFirstJob).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("returns 404 when the event does not exist", async () => {
    mockFindFirstEvent.mockResolvedValue(undefined);

    const res = makeRes();
    await approveVideoHandler(makeReq(EVENT_ID, HOST_ID) as never, res as never);

    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when no job exists yet", async () => {
    mockFindFirstJob.mockResolvedValue(undefined);

    const res = makeRes();
    await approveVideoHandler(makeReq(EVENT_ID, HOST_ID) as never, res as never);

    expect(res.statusCode).toBe(409);
    expect(mockSendPush).not.toHaveBeenCalled();
  });
});

// ── regenerate ──────────────────────────────────────────────────────────────

describe("regenerateVideoHandler", () => {
  it("supersedes the current job, enqueues a fresh pending job, does NOT notify", async () => {
    mockFindFirstJob.mockResolvedValue({ ...readyJob });
    mockInsertReturning.mockReturnValue([
      { ...readyJob, id: "job-2", status: "pending", videoUrl: null, approvedAt: null },
    ]);

    const res = makeRes();
    await regenerateVideoHandler(makeReq(EVENT_ID, HOST_ID) as never, res as never);

    expect(res.statusCode).toBe(200);
    expect((res.body as { id: string }).id).toBe("job-2");
    expect((res.body as { status: string }).status).toBe("pending");
    // current job marked superseded
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ supersededAt: expect.any(Date) }),
    );
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(mockSendGuestEmails).not.toHaveBeenCalled();
    expect(mockSendHostEmail).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-owner", async () => {
    const res = makeRes();
    await regenerateVideoHandler(makeReq(EVENT_ID, "intruder") as never, res as never);

    expect(res.statusCode).toBe(404);
    expect(mockInsertReturning).not.toHaveBeenCalled();
  });
});

// ── public/token gate (SECURITY-CRITICAL) ────────────────────────────────────

describe("buildTokenVideoStatusResponse", () => {
  it("withholds videoUrl and review state while approvedAt is null", () => {
    const out = buildTokenVideoStatusResponse({ ...readyJob }); // ready_for_review, approvedAt null
    expect(out.videoUrl).toBeNull();
    expect(out.status).not.toBe("ready_for_review");
    expect(out.approvedAt).toBeNull();
  });

  it("withholds videoUrl for a pending job too", () => {
    const out = buildTokenVideoStatusResponse({
      ...readyJob,
      status: "pending",
      videoUrl: null,
    });
    expect(out.videoUrl).toBeNull();
  });

  it("exposes the full shape including videoUrl once approvedAt is set", () => {
    const approvedAt = new Date("2026-06-28T02:00:00Z");
    const out = buildTokenVideoStatusResponse({
      ...readyJob,
      status: "completed",
      approvedAt,
    });
    expect(out.videoUrl).toBe("https://signed/review.mp4");
    expect(out.status).toBe("completed");
    expect(out.approvedAt).toBe(approvedAt);
  });
});

describe("formatVideoJob", () => {
  it("includes approvedAt in the serialized shape", () => {
    const out = formatVideoJob({ ...readyJob });
    expect(out).toHaveProperty("approvedAt", null);
    expect(out).toMatchObject({ id: "job-1", eventId: EVENT_ID, status: "ready_for_review" });
  });
});
