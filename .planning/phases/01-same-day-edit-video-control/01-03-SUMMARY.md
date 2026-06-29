---
phase: 01-same-day-edit-video-control
plan: 03
subsystem: api-server (media confirm) + clients (mobile camera, web guest join)
tags: [express, drizzle, react-query, expo, vite, video-03, capture-time]

# Dependency graph
requires:
  - phase: 01-01
    provides: "media_items.captured_at nullable column; optional capturedAt on ConfirmMediaUploadRequest (OpenAPI + regenerated React client + zod: capturedAt?: string / capturedAt?: Date)"
  - phase: 01-02
    provides: "videoWorker orders media + voice-note delay by capturedAt ?? createdAt (inert until clients send capturedAt)"
provides:
  - "Media confirm handler reads optional capturedAt from body and persists it to media_items.captured_at (null falls back to createdAt server-side)"
  - "Mobile capture sends capturedAt at the actual shutter (photo) / record-start (video, voice) moment via the typed confirm hook"
  - "Web guest join sends capturedAt derived from file.lastModified at selection"
  - "capturedAt surfaced in the media confirm 201 response"
affects: [04 (host review UI — unaffected; this slice closes VIDEO-03 end-to-end)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Capture-time threaded as an optional trailing param through a shared upload helper (doUpload on mobile, uploadFileAs on web), populated per-capture-path"
    - "Client-supplied date-time converted server-side: capturedAt ? new Date(capturedAt) : undefined — never a raw string into a timestamp column"
    - "All client capture timestamps flow through the generated useConfirmMediaUpload hook (no hand-rolled fetch)"

key-files:
  created: []
  modified:
    - artifacts/api-server/src/routes/media.ts
    - artifacts/memento-mobile/app/(tabs)/camera.tsx
    - artifacts/memento-web/src/pages/event-join.tsx

key-decisions:
  - "Mobile capture time anchored at record-START (recordingStartRef / voiceStartRef) for video & voice — matches the worker's chronological ordering intent (when the moment began), and at shutter time for photo"
  - "Captured the start-ref value into a local BEFORE the existing code nulls the ref, so the ISO timestamp survives the post-record cleanup"
  - "Web derives capturedAt from file.lastModified (Research A6), falling back to Date.now() when lastModified is 0/absent (recorded voice-note File has lastModified = now)"
  - "capturedAt left optional everywhere — omitting it still inserts successfully (column null), preserving backward compatibility"

patterns-established:
  - "Optional client capture timestamp passed via the typed confirm hook and null-safe-converted at the insert"

requirements-completed: [VIDEO-03]

# Metrics
duration: ~9min
completed: 2026-06-29
---

# Phase 1 Plan 03: Capture-Time Confirm Wiring (VIDEO-03) Summary

**The media confirm handler now accepts and persists an optional client-supplied `capturedAt`, and both clients send it — mobile at the actual shutter/record-start/voice-start moment and web at file-selection time — making capture-time real end-to-end so Plan 02's `capturedAt ?? createdAt` worker ordering finally positions voice notes (and clips) by when they were captured.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-06-29T04:32:23Z
- **Completed:** 2026-06-29
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- **API (Task 1):** `media.ts` confirm handler destructures `capturedAt?: string` from the body and inserts `capturedAt: capturedAt ? new Date(capturedAt) : undefined` into `mediaItemsTable` — null-safe conversion, never a raw string into the timestamp column. When omitted, the column stays null and the worker falls back to `createdAt`. Also surfaced `capturedAt` in the 201 response. Validation flow, the path-reuse 409, and all other fields are untouched.
- **Mobile (Task 2):** `camera.tsx` `doUpload` gained an optional trailing `capturedAt?: string` param threaded into the `confirmUpload.mutate` `data`. Photo supplies `new Date().toISOString()` at `handleTakePhoto` (shutter); video and voice derive an ISO string from `recordingStartRef.current` / `voiceStartRef.current` (record-start), captured into a local *before* the existing code nulls those refs.
- **Web (Task 2):** `event-join.tsx` `uploadFileAs` derives `capturedAt` from `new Date(file.lastModified || Date.now()).toISOString()` at the confirm step and adds it to the typed confirm `data` — covering both file-picker uploads and recorded voice notes.
- **Spec discipline:** No codegen run — Plan 01-01 already shipped the contract (`capturedAt?: string` in `api.schemas.ts`, `capturedAt?: Date` in the zod `confirmMediaUploadRequest`). Verified before touching code; no generated file hand-edited.

## Task Commits

Each task was committed atomically:

1. **Task 1: API confirm handler accepts and persists optional capturedAt** — `9cf1c38` (feat)
2. **Task 2: Clients send capturedAt at capture/selection (mobile + web)** — `2b63c1a` (feat)

## Files Created/Modified

- `artifacts/api-server/src/routes/media.ts` — confirm body destructure (+`capturedAt?: string`), insert (`capturedAt: capturedAt ? new Date(capturedAt) : undefined`), 201 response (+`capturedAt`).
- `artifacts/memento-mobile/app/(tabs)/camera.tsx` — `doUpload` `capturedAt?` param + confirm `data.capturedAt`; photo (shutter), video (`recordingStartRef`), voice (`voiceStartRef`) supply ISO capture times.
- `artifacts/memento-web/src/pages/event-join.tsx` — `uploadFileAs` derives `capturedAt` from `file.lastModified` and sends it in the confirm `data`.

## Decisions Made

- **Record-start anchoring** for video/voice (vs record-stop): the worker orders by *when the moment began*, so `recordingStartRef`/`voiceStartRef` is the correct source. Captured into a local before the refs are nulled by the existing post-record cleanup.
- **Photo at shutter** via `new Date().toISOString()` in `handleTakePhoto`.
- **Web from `file.lastModified`** (Research A6) with a `|| Date.now()` fallback (a recorded voice-note `File` has `lastModified` = now; some browsers report 0 for synthetic files).
- **Optional + null-safe** end to end — omission inserts null and falls back to `createdAt` (backward compatible per the threat model T-03-01: capturedAt is ordering-only input).

## Deviations from Plan

None — plan executed exactly as written. Codegen was intentionally not re-run (contract already present from 01-01, verified before edits, per the plan's "verify before re-running codegen" guidance).

## Issues Encountered

None.

## Known Stubs

None.

## Threat Flags

None — no new network/auth/file/schema surface. The only client-supplied input is `capturedAt`, which is ordering-only (threat register T-03-01: accept) and validated as `date-time` by the generated zod; the handler converts it null-safely. The change touches only the request body, not `req.params` (T-03-02).

## Deferred Issues

- **Pre-existing `@types/react` 19 duplicate-instance typecheck errors** in `artifacts/memento-web/src/components/ui/calendar.tsx` (lines 132/161/189) and `spinner.tsx:7` — untouched by this plan, flagged as out-of-scope in the environment notes and the 01-01 SUMMARY. The whole-workspace web typecheck does not exit 0 because of them, but the file this plan touches (`event-join.tsx`) produces **0 errors**. `api-server` and `memento-mobile` typecheck clean (exit 0).

## User Setup Required

None — no schema push, no codegen, no new env/secrets. Changes are code-only on top of 01-01's already-live column and contract.

## Next Phase Readiness

- **VIDEO-03 is now closed end-to-end:** column (01-01) + worker ordering (01-02) + client capture-time + server persistence (this plan). Voice notes are positioned by capture time.
- Plan 04 (host review UI) is unaffected by this slice and can proceed on the 01-01/01-02 surface.

## Self-Check: PASSED
- FOUND: artifacts/api-server/src/routes/media.ts
- FOUND: artifacts/memento-mobile/app/(tabs)/camera.tsx
- FOUND: artifacts/memento-web/src/pages/event-join.tsx
- FOUND commit: 9cf1c38
- FOUND commit: 2b63c1a
- Verified: api-server typecheck exits 0; memento-mobile typecheck exits 0; event-join.tsx has 0 typecheck errors (only pre-existing radix calendar/spinner errors remain in memento-web). grep capturedAt: media.ts=4, camera.tsx=8, event-join.tsx=2.

---
*Phase: 01-same-day-edit-video-control*
*Completed: 2026-06-29*
