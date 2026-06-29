---
phase: 01-same-day-edit-video-control
plan: 01
subsystem: database
tags: [drizzle, postgres, openapi, orval, zod, react-query, codegen]

# Dependency graph
requires:
  - phase: (none — first plan of the phase)
    provides: existing videoJobsTable / mediaItemsTable / VideoJobStatus contract
provides:
  - "Additive video_job_status enum value: ready_for_review (between processing and completed)"
  - "Nullable videoJobsTable columns: approvedAt (delivered signal), supersededAt (regenerate marker)"
  - "Nullable mediaItemsTable column: capturedAt (client-supplied capture time, VIDEO-03)"
  - "OpenAPI paths: POST /events/{eventId}/video/approve (approveEventVideo), POST /events/{eventId}/video/regenerate (regenerateEventVideo)"
  - "Extended VideoJobStatus response: ready_for_review status + nullable approvedAt"
  - "Extended ConfirmMediaUploadRequest: optional capturedAt (not required)"
  - "Generated React Query hooks: useApproveEventVideo, useRegenerateEventVideo"
  - "Generated zod: capturedAt optional Date; ready_for_review in status enum"
affects: [02 (approve/regenerate handlers + worker fan-out relocation + token-status gating), 03 (capturedAt confirm wiring + worker ordering), 04 (host review UI web + mobile)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive Postgres enum value via ALTER TYPE ADD VALUE (drizzle-kit push) — never rename/remove"
    - "Spec-first codegen: edit schema/openapi FIRST, then db push + Orval codegen, never hand-edit generated/"
    - "Nullable audit-timestamp columns (approvedAt/supersededAt) mirroring existing startedAt/completedAt"

key-files:
  created: []
  modified:
    - lib/db/src/schema/index.ts
    - lib/api-spec/openapi.yaml
    - lib/api-client-react/src/generated/api.ts
    - lib/api-client-react/src/generated/api.schemas.ts
    - lib/api-zod/src/generated/api.ts
    - lib/api-zod/src/generated/types/confirmMediaUploadRequest.ts
    - lib/api-zod/src/generated/types/videoJobStatus.ts
    - lib/api-zod/src/generated/types/videoJobStatusStatus.ts
    - artifacts/memento-web/src/pages/host/event-detail.tsx

key-decisions:
  - "Additive enum value + nullable approvedAt chosen as the least-disruptive review-gate representation (preserves status === 'completed' = delivered for all existing consumers)"
  - "capturedAt kept out of ConfirmMediaUploadRequest.required[] and out of insertMediaItemSchema.omit() so the client supplies it optionally"
  - "approvedAt/supersededAt added to insertVideoJobSchema.omit() (handler-managed, like completedAt)"

patterns-established:
  - "Review-gate audit timestamps (approvedAt/supersededAt) are nullable and handler-managed"
  - "New video endpoints follow the endEvent path block verbatim (clerkAuth, eventId param, VideoJobStatus 200, 401/404, +409 for approve)"

requirements-completed: [VIDEO-01, VIDEO-02, VIDEO-03]

# Metrics
duration: 3min
completed: 2026-06-28
---

# Phase 1 Plan 01: Spec-First Video Review-Gate Foundation Summary

**Additive Drizzle schema (ready_for_review enum value + approvedAt/supersededAt/capturedAt nullable columns, pushed to live Postgres) and OpenAPI approve/regenerate endpoints + extended video/media schemas, regenerated into typed React Query hooks and zod via Orval.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-28T21:17Z (local -07:00)
- **Completed:** 2026-06-28T21:22:31-07:00
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Extended `video_job_status` Postgres enum with an additive `ready_for_review` value (original 4 values intact) and added three nullable columns — `video_jobs.approved_at`, `video_jobs.superseded_at`, `media_items.captured_at` — applied to the live Postgres via `drizzle-kit push` and verified by direct `psql` inspection.
- Added two new OpenAPI paths (`approveEventVideo`, `regenerateEventVideo`) mirroring the `endEvent` block, extended `VideoJobStatus` (ready_for_review + nullable approvedAt) and `ConfirmMediaUploadRequest` (optional capturedAt), and regenerated the client — producing `useApproveEventVideo`/`useRegenerateEventVideo` hooks and matching zod schemas.
- Kept all spec-first discipline intact: generated files were regenerated (never hand-edited), `lib/api-zod/src/index.ts` remains the single `export * from "./generated/api"` line, and `indexFiles: false` was untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: Additive DB schema changes (enum value + 3 nullable columns)** - `f7033d2` (feat)
2. **Task 2: OpenAPI contract — new paths + extended schemas + codegen** - `648a27f` (feat)

## Files Created/Modified
- `lib/db/src/schema/index.ts` - Added `ready_for_review` enum value; nullable `approvedAt`/`supersededAt` on videoJobsTable; nullable `capturedAt` on mediaItemsTable; omit list updated for the two handler-managed video-job columns.
- `lib/api-spec/openapi.yaml` - Added `/events/{eventId}/video/approve` (+409) and `/events/{eventId}/video/regenerate`; extended `VideoJobStatus` and `ConfirmMediaUploadRequest`.
- `lib/api-client-react/src/generated/api.ts` + `api.schemas.ts` - Regenerated hooks/types (`useApproveEventVideo`, `useRegenerateEventVideo`, widened status union, optional capturedAt).
- `lib/api-zod/src/generated/api.ts` + `types/{confirmMediaUploadRequest,videoJobStatus,videoJobStatusStatus}.ts` - Regenerated zod (capturedAt optional Date; ready_for_review in status enum).
- `artifacts/memento-web/src/pages/host/event-detail.tsx` - Added `ready_for_review` entry to the `videoStatusConfig` status-label map (see Deviations).

## Decisions Made
- Used the additive enum + nullable `approvedAt` representation (per RESEARCH A1/A2 and CONTEXT discretion) so every existing `status === "completed"` consumer stays correct; approve will later map approved → `completed` with `approvedAt` set.
- The 409 response on approve references the existing `ErrorEnvelope` schema (the spec has no bare `Error` schema; corrected during authoring before commit).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `ready_for_review` entry to web `videoStatusConfig`**
- **Found during:** Task 2 (codegen + typecheck)
- **Issue:** Adding `ready_for_review` to the generated `VideoJobStatus.status` union widened the type indexed by `videoStatusConfig[videoStatus.status]` in `event-detail.tsx:312`, producing `TS7053` (property `ready_for_review` missing) and breaking the `memento-web` typecheck — a direct consequence of this plan's contract change.
- **Fix:** Added a `ready_for_review: { label: "Ready for review", icon: CheckCircle, className: "text-amber-600" }` entry to the existing `videoStatusConfig` map. This is the minimal change to keep the union exhaustive; the full review-gate UI (player + Approve/Regenerate) is Plan 04's scope.
- **Files modified:** `artifacts/memento-web/src/pages/host/event-detail.tsx`
- **Verification:** Re-ran `pnpm --filter @workspace/memento-web run typecheck` — the `event-detail.tsx`/`ready_for_review` error is gone; only pre-existing unrelated radix errors remain (see Deferred Issues).
- **Committed in:** `648a27f` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix is required for the workspace to compile after the additive enum change and introduces no UI scope creep (label-map only). No architectural change.

## Issues Encountered
- The 409 response initially referenced a non-existent `#/components/schemas/Error`; corrected to `ErrorEnvelope` (the spec's standard error schema, used by all `responses.*`) before the Task 2 commit.

## Deferred Issues
- **Pre-existing `@types/react` 19 duplicate-instance typecheck failures** in radix-derived UI components: `artifacts/memento-web/src/components/ui/calendar.tsx` (lines 132/161/189), `spinner.tsx:7`, and the same files in `artifacts/mockup-sandbox`. These files are untouched by this plan (last changed in commit `185b07c`) and do not consume any spec/codegen surface this plan modified. They are SCOPE BOUNDARY / out-of-scope and logged to `deferred-items.md`. Because of them, the whole-workspace `pnpm run typecheck` does not exit 0, but every package that consumes this plan's contract change typechecks clean: `api-server` ✓, `memento-mobile` ✓, and `memento-web`'s only remaining errors are the pre-existing radix ones (the regenerated client + zod also pass via `typecheck:libs` during codegen).

## User Setup Required
None - no external service configuration required. DB push ran against the local Postgres (DATABASE_URL from `.env`); no new secrets or env vars.

## Next Phase Readiness
- Wave-1 blocking foundation is complete: the `ready_for_review` enum value, `approvedAt`/`supersededAt`/`capturedAt` columns, the approve/regenerate endpoints, the extended response/request schemas, and the generated `useApproveEventVideo`/`useRegenerateEventVideo` hooks all exist.
- Plans 02–04 can now consume the columns, enum value, response shape (`approvedAt`), request field (`capturedAt`), and generated hooks. No blockers introduced.
- Reminder for downstream plans: the public/token `video-status` handler must withhold `videoUrl` until `approvedAt` is set (RESEARCH Pitfall 1); the worker must stop notifying on completion and order media by `capturedAt ?? createdAt`.

## Self-Check: PASSED
- FOUND: lib/db/src/schema/index.ts
- FOUND: lib/api-spec/openapi.yaml
- FOUND: lib/api-client-react/src/generated/api.ts (useApproveEventVideo + useRegenerateEventVideo present)
- FOUND commit: f7033d2
- FOUND commit: 648a27f
- Live Postgres verified: enum has [pending, processing, ready_for_review, completed, failed]; video_jobs.approved_at, video_jobs.superseded_at, media_items.captured_at exist.

---
*Phase: 01-same-day-edit-video-control*
*Completed: 2026-06-28*
