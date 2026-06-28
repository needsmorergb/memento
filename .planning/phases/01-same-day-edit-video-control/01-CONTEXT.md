# Phase 1: Same-Day-Edit Video Control - Context

**Gathered:** 2026-06-28
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase makes same-day-edit video delivery **host-controlled** instead of automatic, and fixes voice-note timing. It splits *compilation* from *delivery*: when an event ends the video is compiled and held in a review state; the host previews it in-app (web + mobile) and either approves (which triggers the existing push + email fan-out) or re-generates a fresh edit. It also adds a per-media capture timestamp so voice notes are positioned by when they were captured, not when the upload was confirmed.

Covers: VIDEO-01 (host preview before delivery), VIDEO-02 (approve / re-generate), VIDEO-03 (capture-time voice-note placement).

Out of this phase: themes/music, voice-only montage improvements, separate worker tier, upload size/type validation.
</domain>

<decisions>
## Implementation Decisions

### Delivery Gating (compile vs deliver split)
- On event end, the video is compiled but NOT auto-delivered; no guest notification fires until the host approves.
- Approval is a new host-only endpoint `POST /api/events/:eventId/video/approve` (Clerk host auth) that triggers the existing notification fan-out (Expo push + guest/host email).
- Re-generate creates a NEW `video_jobs` row that supersedes the prior one; the prior job is marked superseded and does not notify. New endpoint `POST /api/events/:eventId/video/regenerate`.
- If the host never approves, the video stays in review indefinitely — no auto-send, no reminder (reminders out of scope).

### Video Status Model
- Extend the video job/event video status to represent the review gate. Add states so a completed-but-unapproved video reads as `ready_for_review`, and an approved/delivered one reads as `approved` (delivered). Prefer additive status values / a nullable `approvedAt` over breaking existing enum consumers — planner to choose the least-disruptive representation consistent with `lib/db/src/schema/index.ts` and `videoJobsTable`.
- Extend the existing `GET /api/events/:eventId/video-status` (and the public `GET /api/events/token/:shareToken/video-status`) to surface the review/approved state rather than adding a new status endpoint. Public/token status must NOT expose the review video before approval.
- Notifications fire on approve, not on compile completion. Move the fan-out out of the worker's completion path into the approve handler.
- New behavior applies to events ending after deploy; no migration of already-delivered videos.

### Capture Timestamp (VIDEO-03)
- Add a nullable `capturedAt` timestamp column to `media_items` (`lib/db/src/schema/index.ts`, then `pnpm --filter @workspace/db run push`).
- Clients send `capturedAt` at the confirm step — extend the `POST /api/events/:eventId/media` request body in `lib/api-spec/openapi.yaml`, then regenerate Zod + hooks (`pnpm --filter @workspace/api-spec run codegen`). Field is optional for backward compatibility.
- The video worker orders voice notes (and clips) by `capturedAt` when present, falling back to `createdAt` (`videoWorker.ts` voice-note delay computation).
- No backfill of existing rows; null `capturedAt` falls back to `createdAt`.

### Host Preview UI (web + mobile)
- The host event-detail surface gains a "Review video" state: a video player plus Approve and Regenerate actions, shown once the video is `ready_for_review`.
- Player: native `<video>` on web (`memento-web`), `expo-av`/`expo-video` on mobile (`memento-mobile`), pointed at the signed playback URL.
- Reuse the existing video-status React Query hooks/polling from `@workspace/api-client-react`; do not introduce a new polling mechanism.
- Guests see nothing about the video until it is approved.

### Claude's Discretion
- Exact status enum vs nullable-timestamp representation (choose least disruptive to existing consumers).
- Naming of new endpoints/fields within the conventions above.
- Whether regenerate reuses the same compile code path with a fresh job or a parameterized worker entry.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `artifacts/api-server/src/lib/videoWorker.ts` — in-process worker; compiles and currently auto-notifies at `:494`. Notification fan-out moves to the approve handler.
- `artifacts/api-server/src/lib/notifications.ts` — Expo push + Resend email helpers, already `Promise.allSettled` based.
- `artifacts/api-server/src/routes/events.ts` — `/end` (`:299`) inserts the `video_jobs` row and resolves tier caps; `video-status` (`:553`) and token video-status.
- `lib/db/src/schema/index.ts` — `videoJobsTable`, `mediaItemsTable`; soft-delete + drizzle-zod conventions.
- `@workspace/api-client-react` generated hooks + `customFetch`; mobile registers a Clerk token getter.

### Established Patterns
- Spec-first codegen: edit `openapi.yaml` / Drizzle schema FIRST, then `codegen` / `db push`, then restart API. Never hand-edit `generated/`.
- Soft deletes everywhere (`isNull(deletedAt)` filters).
- Tier caps resolved server-side at `/end`; only `active`/`trialing` subs honored.
- Express 5: wrap `req.params.*` with `String(...)` before Drizzle `eq()`.

### Integration Points
- DB: new `capturedAt` column; video-job status/approval fields.
- API: new approve + regenerate endpoints; extended media confirm body; extended video-status response.
- Worker: stop notifying on completion; order by `capturedAt`.
- Clients: host review UI on event-detail (web + mobile); send `capturedAt` on confirm.
</code_context>

<specifics>
## Specific Ideas

- Core value is reliable host-controlled delivery — the review gate must guarantee no guest is notified before host approval.
- Voice-only / empty-media edge cases (5s placeholder truncation) are a known concern but deferred to v2 (VIDEO-05); do not regress them.
</specifics>

<deferred>
## Deferred Ideas

- Themes / music selection for the edit (VIDEO-04, v2).
- Full-length audio montage for voice-only events (VIDEO-05, v2).
- Upload size/content-type/tier enforcement at confirm (SAFE-01/02, separate safety milestone).
</deferred>
