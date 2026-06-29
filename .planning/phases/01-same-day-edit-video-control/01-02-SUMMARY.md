---
phase: 01-same-day-edit-video-control
plan: 02
subsystem: api-server (video worker + events routes)
tags: [express, drizzle, video-worker, notifications, security, tdd, vitest]

# Dependency graph
requires:
  - phase: 01-01
    provides: "ready_for_review enum value; video_jobs.approvedAt/supersededAt + media_items.capturedAt columns; approveEventVideo/regenerateEventVideo OpenAPI ops + generated hooks; extended VideoJobStatus (approvedAt)"
provides:
  - "videoWorker terminates compilation at status=ready_for_review (no fan-out, no completedAt)"
  - "Media + voice-note delays ordered by capturedAt ?? createdAt (VIDEO-03)"
  - "POST /events/:eventId/video/approve — host-only, idempotent, relocated notification fan-out (push + guest/host email) exactly once"
  - "POST /events/:eventId/video/regenerate — host-only, supersedes latest job + enqueues fresh pending job, no notify"
  - "formatVideoJob serializer (includes approvedAt) used by authed status + both new handlers"
  - "buildTokenVideoStatusResponse — public/token status withholds videoUrl + masks review state until approvedAt set"
  - "Both video-status handlers + approve/regenerate select latest job via isNull(supersededAt)"
affects: [03 (capturedAt confirm wiring already consumed by worker ordering), 04 (host review UI consumes ready_for_review status + approve/regenerate handlers + approvedAt)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Exported named handler functions (approveVideoHandler/regenerateVideoHandler) for module-boundary unit testing, registered via router.post(...)"
    - "Pure response-shaping helpers (formatVideoJob, buildTokenVideoStatusResponse) testable in isolation"
    - "Notification fan-out relocated from worker terminal path to a host-authenticated command handler; idempotent on approvedAt"
    - "Latest-active-job selection via isNull(supersededAt) + desc(createdAt) across all four read/write sites"

key-files:
  created:
    - artifacts/api-server/src/routes/events.videoApprove.test.ts
  modified:
    - artifacts/api-server/src/lib/videoWorker.ts
    - artifacts/api-server/src/routes/events.ts

key-decisions:
  - "Approve idempotency keyed on approvedAt (Research Open Q1): a re-approve returns 200 without re-notifying; an already-approved job reached via the not-ready branch also short-circuits to 200"
  - "Token-gate masks ready_for_review (and any pre-approval state) to 'processing' and forces videoUrl:null until approvedAt set; 'failed' remains visible to guests (pre-existing behavior preserved)"
  - "regenerate marks the current latest non-superseded job superseded regardless of status (Research Open Q2) and carries over tier/caps from it (fresh resolution as fallback)"
  - "Handlers extracted as exported functions so Vitest can test them directly per TESTING.md (mock @workspace/db boundary, import SUT after)"

patterns-established:
  - "Command handlers with side-effects (notifications) are host-authenticated, idempotent, and own the fan-out — workers only write terminal job state"
  - "Public/unauthenticated read paths route through an explicit gating serializer rather than returning the row verbatim"

requirements-completed: [VIDEO-01, VIDEO-02, VIDEO-03]

# Metrics
duration: ~12min
completed: 2026-06-28
---

# Phase 1 Plan 02: Backend Review Gate (worker split + approve/regenerate + token gating) Summary

**Split video compilation from delivery: the worker now leaves jobs at `ready_for_review` (no premature notification) and orders media by capture time, while new host-only `approve` (idempotent, relocated fan-out) and `regenerate` (superseding) endpoints control delivery — and the public/token status provably never leaks the unapproved review cut.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-06-28
- **Tasks:** 2 (Task 2 via TDD)
- **Files created:** 1 / **modified:** 2

## Accomplishments

- **Worker (Task 1):** `videoWorker.ts` compilation now terminates by writing `status: "ready_for_review"` (no `completedAt`, no notification block). Deleted the entire fan-out (and its `event`/`allGuests`/`host`/`mediaCount` fetches) and pruned the now-unused imports (`eventsTable`, `eventGuestsTable`, `usersTable`, `count`, `asc`, and the three notification helpers). Media items and voice-note `delayMs` anchor are now ordered by a JS `sortKey = capturedAt ?? createdAt` (VIDEO-03) — the fragile ffmpeg filter graph and the `visualClips.length === 0` voice-only placeholder branch are byte-identical.
- **Approve (Task 2):** `POST /events/:eventId/video/approve` (host-only, `requireAuth`, ownership → 404) loads the latest `isNull(supersededAt)` job, requires `ready_for_review` (else 409), is idempotent on `approvedAt`, stamps `approvedAt`+`completed`+`completedAt`, then runs the relocated `Promise.allSettled([sendPushNotifications, sendGuestEmails, sendHostEmail])` fan-out exactly once.
- **Regenerate (Task 2):** `POST /events/:eventId/video/regenerate` (host-only) marks the current latest non-superseded job `supersededAt` (regardless of status) and inserts a fresh `pending` job carrying over tier/caps; no notification.
- **Status gating (Task 2):** Added a `formatVideoJob` serializer (now includes `approvedAt`) used by the authed status handler and both new handlers; added `buildTokenVideoStatusResponse` so the public/token status withholds `videoUrl` and masks `ready_for_review`→`processing` until `approvedAt` is set. Both video-status handlers and both new handlers select the latest active job via `isNull(supersededAt)`.
- **Tests:** New `events.videoApprove.test.ts` (12 cases) following TESTING.md module-boundary mocking — covers approve idempotency (notify-once / no re-notify), ownership 404, 409-when-not-ready, no-job, regenerate supersede+enqueue+no-notify, and the security-critical token withholding (videoUrl null pre-approval, full shape post-approval). Full api-server suite: **31 passed**.

## Task Commits

1. **Task 1: Worker — terminate at ready_for_review, remove fan-out, order by capturedAt** — `473de72` (feat)
2. **Task 2 (RED): failing tests for approve/regenerate + token gate** — `4db4a98` (test)
3. **Task 2 (GREEN): approve/regenerate handlers + gated token status** — `ffc5e26` (feat)

## Files Created/Modified

- `artifacts/api-server/src/lib/videoWorker.ts` — terminal status `ready_for_review`, fan-out removed, `capturedAt ?? createdAt` ordering, pruned imports.
- `artifacts/api-server/src/routes/events.ts` — added `usersTable` + notification imports + `Response` type; `formatVideoJob` + `buildTokenVideoStatusResponse` helpers; exported `approveVideoHandler`/`regenerateVideoHandler`; registered both routes; extended authed status (`isNull(supersededAt)` + serializer); gated token status.
- `artifacts/api-server/src/routes/events.videoApprove.test.ts` — new Vitest unit tests.

## Decisions Made

- **Idempotency on `approvedAt`** (Research Open Q1): re-approve returns 200 without re-notifying. Because approve flips status to `completed`, a second call lands in the not-ready branch — that branch checks `job.approvedAt` and short-circuits to a 200 `formatVideoJob(job)` rather than a spurious 409.
- **Token gate masking** (Research Pitfall 1 / Open Q3): pre-approval responses force `videoUrl: null` and map `ready_for_review` (and any non-`failed` pre-approval state) to `processing`; `failed` stays visible (pre-existing guest behavior). Guests cannot learn a review cut exists.
- **Regenerate supersedes regardless of status** (Research Open Q2) and carries over tier/caps from the superseded job (with fresh `getDurationCap`/`getQualityCap` as fallback).
- **Exported handler functions** so Vitest tests call them directly (TESTING.md pattern), registered with `router.post(...)`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Typed handler `res` params with Express `Response` instead of the plan's inferred-type expression**
- **Found during:** Task 2 (typecheck)
- **Issue:** Typing `res` via `Parameters<Parameters<typeof router.post>[2]>[1]` resolved against Express's 2-arg `router.post(path, subApp)` overload, producing `res: never` and `TS2339: Property 'status' does not exist on type 'never'`.
- **Fix:** `import { type Response } from "express"` and typed both handlers `(req: AuthenticatedRequest, res: Response)`. Route registration still typechecks against Express's handler overloads.
- **Files modified:** `artifacts/api-server/src/routes/events.ts`
- **Verification:** `pnpm --filter @workspace/api-server run typecheck` exits 0.
- **Committed in:** `ffc5e26`

**2. [Rule 3 - Blocking] Completed the test `readyJob` fixture to the full `VideoJobRow` shape**
- **Found during:** Task 2 (typecheck)
- **Issue:** `formatVideoJob`/`buildTokenVideoStatusResponse` accept `typeof videoJobsTable.$inferSelect`; the initial fixture omitted `qualityCap`, `maxResolutionPx`, `startedAt`, `updatedAt`, `deletedAt` → `TS2345`.
- **Fix:** Added the missing nullable/required columns (matching `lib/db/src/schema/index.ts`) and `as const` on `status`/`tier`.
- **Files modified:** `artifacts/api-server/src/routes/events.videoApprove.test.ts`
- **Committed in:** `ffc5e26`

**Total deviations:** 2 auto-fixed (both blocking, both typecheck-driven). No architectural change; no scope creep.

## Issues Encountered

- None beyond the two typecheck fixes above. Tests are pure unit tests with the DB and notifications mocked at the module boundary, so they run cleanly off-Replit (no Postgres/MinIO/sidecar needed).

## Deferred Issues

- None. Fix-attempt limit not approached.

## Known Stubs

- None. The voice-only 5s placeholder branch (`visualClips.length === 0`) was intentionally left byte-identical (VIDEO-05 deferred per CONTEXT/RESEARCH Pitfall 5) — this is pre-existing behavior, not a new stub.

## Threat Flags

None — no new network/auth/file/schema surface beyond the two endpoints already specified in the plan's threat model (T-02-01..05). The implemented mitigations match the register: token gate (T-02-01), ownership 404 (T-02-02), idempotent relocated fan-out (T-02-03), `String(req.params.eventId)` (T-02-04).

## User Setup Required

None. Approve email dry-runs if `RESEND_API_KEY` is unset (`notifications.ts`) — the approve flow still succeeds.

## Next Phase Readiness

- Plan 03 (capturedAt confirm wiring): the worker already consumes `capturedAt ?? createdAt`, so once clients send `capturedAt` at confirm, voice-note timing is correct end-to-end. No backend ordering work remains.
- Plan 04 (host review UI web + mobile): consume `status === "ready_for_review"` + `approvedAt` from `useGetEventVideoStatus` (authed), and call `useApproveEventVideo` / `useRegenerateEventVideo` (already generated in 01-01). Mobile must switch the host review card from the public token hook to the authed hook (Research Pitfall 2) — the public path is now correctly gated.

## Self-Check: PASSED
- FOUND: artifacts/api-server/src/lib/videoWorker.ts
- FOUND: artifacts/api-server/src/routes/events.ts
- FOUND: artifacts/api-server/src/routes/events.videoApprove.test.ts
- FOUND commit: 473de72
- FOUND commit: 4db4a98
- FOUND commit: ffc5e26
- Verified: api-server typecheck exits 0; api-server test suite 31/31 passing; worker has 0 fan-out helper references and >=1 ready_for_review; both new routes behind requireAuth.

---
*Phase: 01-same-day-edit-video-control*
*Completed: 2026-06-28*
