# Phase 1: Same-Day-Edit Video Control - Research

**Researched:** 2026-06-27
**Domain:** Brownfield feature work — Express 5 + Drizzle/Postgres API, in-process ffmpeg video worker, Orval-generated React Query clients (web Vite/React + Expo mobile), spec-first codegen
**Confidence:** HIGH (all findings grounded in actual repo files cited by path:line)

## Summary

This phase splits *video compilation* from *delivery* and fixes voice-note timing, entirely within the existing monorepo's spec-first pipeline. Three concrete code seams carry the work: (1) the video worker (`videoWorker.ts`) currently compiles AND auto-fans-out notifications in one path (`:466–:512`) — the notification block must move out of the worker into a new host-only approve handler; (2) the video-status model needs an additive "review gate" representation so a completed-but-unapproved video is distinguishable from an approved/delivered one without breaking existing `pending|processing|completed|failed` consumers; (3) `media_items` gains a nullable `capturedAt`, sent by clients at confirm, used by the worker to order voice notes by capture time instead of `createdAt` (`videoWorker.ts:371,414`).

The least-disruptive status representation is **additive**: add a nullable `approvedAt` timestamp column to `videoJobsTable` and add a new `ready_for_review` value to the existing `videoJobStatusEnum` (a Postgres enum — values can be appended via `ALTER TYPE ... ADD VALUE`, which `drizzle-kit push` handles). The worker writes `ready_for_review` instead of `completed` on compile finish; the approve handler stamps `approvedAt` and flips status to `completed` (preserving the meaning the clients already attach to `completed` = "watchable/delivered"). This keeps every existing `status === "completed"` check correct post-approval while making the review gate explicit.

The security-critical requirement: the **public/token** video-status endpoint (`/events/token/:shareToken/video-status`) must NOT expose the review video (its `videoUrl`) before approval, and the mobile host review card must switch from `useGetEventVideoStatusByToken` (public) to `useGetEventVideoStatus` (authed). Guests must see nothing until `approvedAt` is set.

**Primary recommendation:** Add `approvedAt` (nullable timestamp) + `supersededAt` (nullable timestamp) columns and a `ready_for_review` enum value to `videoJobsTable`; move the notification fan-out from `videoWorker.ts` into a new `POST /events/:eventId/video/approve` handler; add `POST /events/:eventId/video/regenerate`; gate the public/token status response so it never returns `videoUrl`/review state pre-approval; add nullable `capturedAt` to `media_items` and order the worker's media query + voice-note delay by `COALESCE(capturedAt, createdAt)`. Follow spec-first order strictly: edit `schema/index.ts` + `openapi.yaml` FIRST, then `db push` + `codegen`, then restart.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Delivery Gating (compile vs deliver split)**
- On event end, the video is compiled but NOT auto-delivered; no guest notification fires until the host approves.
- Approval is a new host-only endpoint `POST /api/events/:eventId/video/approve` (Clerk host auth) that triggers the existing notification fan-out (Expo push + guest/host email).
- Re-generate creates a NEW `video_jobs` row that supersedes the prior one; the prior job is marked superseded and does not notify. New endpoint `POST /api/events/:eventId/video/regenerate`.
- If the host never approves, the video stays in review indefinitely — no auto-send, no reminder (reminders out of scope).

**Video Status Model**
- Extend the video job/event video status to represent the review gate. A completed-but-unapproved video reads as `ready_for_review`, an approved/delivered one reads as `approved` (delivered). Prefer additive status values / a nullable `approvedAt` over breaking existing enum consumers — planner to choose least-disruptive representation consistent with `schema/index.ts` and `videoJobsTable`.
- Extend the existing `GET /api/events/:eventId/video-status` (and public `GET /api/events/token/:shareToken/video-status`) to surface the review/approved state rather than adding a new status endpoint. Public/token status must NOT expose the review video before approval.
- Notifications fire on approve, not on compile completion. Move the fan-out out of the worker's completion path into the approve handler.
- New behavior applies to events ending after deploy; no migration of already-delivered videos.

**Capture Timestamp (VIDEO-03)**
- Add a nullable `capturedAt` timestamp column to `media_items` (`schema/index.ts`, then `pnpm --filter @workspace/db run push`).
- Clients send `capturedAt` at the confirm step — extend `POST /api/events/:eventId/media` request body in `openapi.yaml`, then regenerate Zod + hooks (`pnpm --filter @workspace/api-spec run codegen`). Field is optional for backward compatibility.
- The video worker orders voice notes (and clips) by `capturedAt` when present, falling back to `createdAt`.
- No backfill of existing rows; null `capturedAt` falls back to `createdAt`.

**Host Preview UI (web + mobile)**
- Host event-detail surface gains a "Review video" state: a video player plus Approve and Regenerate actions, shown once the video is `ready_for_review`.
- Player: native `<video>` on web; `expo-av`/`expo-video` on mobile, pointed at the signed playback URL.
- Reuse the existing video-status React Query hooks/polling from `@workspace/api-client-react`; do not introduce a new polling mechanism.
- Guests see nothing about the video until it is approved.

### Claude's Discretion
- Exact status enum vs nullable-timestamp representation (choose least disruptive to existing consumers).
- Naming of new endpoints/fields within the conventions above.
- Whether regenerate reuses the same compile code path with a fresh job or a parameterized worker entry.

### Deferred Ideas (OUT OF SCOPE)
- Themes / music selection for the edit (VIDEO-04, v2).
- Full-length audio montage for voice-only events (VIDEO-05, v2).
- Upload size/content-type/tier enforcement at confirm (SAFE-01/02, separate safety milestone).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VIDEO-01 | Host can preview the compiled same-day-edit video before delivery | Worker writes `ready_for_review` (no notify); status endpoints surface review state to host only; host review card on web `event-detail.tsx` + mobile `event.tsx` plays the signed URL (existing `<video>` / `app/video.tsx` expo-av pattern). |
| VIDEO-02 | Host can approve delivery or trigger a re-generation before send | New `POST /events/:eventId/video/approve` (moves fan-out from `videoWorker.ts:494`) + `POST /events/:eventId/video/regenerate` (inserts fresh `video_jobs` row, marks prior `supersededAt`). |
| VIDEO-03 | Voice notes positioned by capture time | Nullable `capturedAt` on `media_items`; clients send it at confirm; worker orders media + computes `delayMs` from `COALESCE(capturedAt, createdAt)` (replaces `createdAt` use at `videoWorker.ts:362,371,414`). |

## Project Constraints (from CLAUDE.md)

These are authoritative directives extracted from `./CLAUDE.md` and `.planning/codebase/*`. The plan must not contradict them:

1. **Spec-first codegen (CRITICAL):** Edit `lib/api-spec/openapi.yaml` and/or `lib/db/src/schema/index.ts` FIRST, then run codegen / db push, then restart the API server. **Never hand-edit anything under `lib/api-client-react/src/generated/` or `lib/api-zod/src/generated/`.**
2. **Orval `indexFiles: false` (zod target):** Do NOT remove this flag; `lib/api-zod/src/index.ts` must remain a single `export * from "./generated/api"` line or the build breaks (types/api name clash). `titleTransformer` forces `info.title = "Api"` → output lands in `api.ts`.
3. **Both Orval targets use `clean: true`** — output dirs are wiped each run. The only hand-written seams are `lib/api-client-react/src/custom-fetch.ts` and `lib/api-zod/src/index.ts`.
4. **Express 5 footgun:** `req.params.*` is `string | string[]` — always wrap with `String(...)` before Drizzle `eq()`.
5. **Generated hook names come from `operationId`** — do not rename. New endpoints' hook names derive from their `operationId` (e.g. `approveEventVideo` → `useApproveEventVideo`).
6. **Soft deletes everywhere:** queries filter `isNull(table.deletedAt)`.
7. **Error response shape is `{ error: string }`**; 401 auth / 403 authz / 404 for missing-or-owned-by-other (ownership checks return 404 to avoid leaking existence). Handlers return `void` (call `res.json(...); return;`, never `return res.json(...)`).
8. **Use the request-scoped logger `req.log`** inside handlers, not the module `logger`. Pino call convention `(objOrErr, msg)`.
9. **pnpm only**; `minimumReleaseAge: 1440` supply-chain guard — do not disable. **No new external packages are needed for this phase** (see Package Legitimacy Audit).
10. **Quality gate is the TypeScript compiler** (`pnpm run typecheck`), no ESLint/Biome. `codegen` script already runs `pnpm -w run typecheck:libs` after Orval.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Compile video, write `ready_for_review` (no notify) | Video worker (`videoWorker.ts`) | DB | Worker owns ffmpeg + job state transitions; it must stop notifying. |
| Approve → fan-out push + email | API / Backend (new approve handler) | Notifications lib | Notification dispatch is a host-authenticated action, not a worker side-effect. |
| Regenerate → new superseding job | API / Backend (new regenerate handler) | DB / worker | Endpoint inserts a fresh `video_jobs` row; worker picks it up via existing poll. |
| Review-gate status representation | DB schema (`videoJobsTable`) | API serializers | Additive enum value + `approvedAt` column is the source of truth. |
| Hide review video pre-approval on public path | API / Backend (token status handler) | — | Token endpoint is unauthenticated; must not leak `videoUrl` before `approvedAt`. |
| `capturedAt` capture | Client (mobile camera / web join) | — | Only the client knows real capture time; captured at shutter/record-start. |
| `capturedAt` ordering | Video worker | DB query | Worker orders media + voice-note delays by `COALESCE(capturedAt, createdAt)`. |
| Host review UI (player + Approve/Regenerate) | Frontend (web SPA + Expo mobile) | Generated hooks | Reuses existing event-detail surfaces + video-status hooks. |

## Standard Stack

No new libraries. Every capability is served by code/deps already in the repo.

### Core (already present)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | ^0.45.2 (catalog) | Schema + `ALTER TYPE`/column add via `drizzle-kit push` | Already the DB layer; enum append + nullable column are first-class. |
| drizzle-zod | ^0.8.3 | Insert/select Zod schemas derived from tables | Used throughout `schema/index.ts`. |
| Orval | ^8.18.0 | Regenerate hooks + Zod from `openapi.yaml` | The only sanctioned client-contract path. |
| Express | ^5.2.1 | New approve/regenerate route handlers | Existing API framework. |
| @clerk/express | ^2.1.32 | `requireAuth` host gating on approve/regenerate | Existing host-auth middleware. |
| TanStack React Query | ^5.90.21 (catalog) | Existing video-status polling hooks (reuse) | UI-SPEC mandates reuse, no new polling. |
| ffmpeg / ffprobe | system binaries | Compilation (unchanged) | Already the media toolchain. |
| expo-av | ~16.0.8 | Mobile review player (`Video`, `ResizeMode.CONTAIN`, `useNativeControls`) | Already installed and used in `app/video.tsx`; UI-SPEC fixes this as the player. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Additive `ready_for_review` enum + `approvedAt` | New `videoJobApprovalEnum` / boolean `isApproved` | A boolean loses the failed/processing distinction and still needs a "ready vs delivered" signal; `approvedAt` doubles as an audit timestamp. Additive enum value is non-breaking (Postgres `ADD VALUE`); a *renamed* or *removed* value would break existing consumers. **Recommended: additive.** |
| `expo-av` (deprecated) | `expo-video` | `expo-av` is deprecated and removed in Expo SDK 55, but this repo is on SDK ~54 where it still ships and is the **installed, working** player (`app/video.tsx`). Migrating to `expo-video` is out of scope (new dep + API rewrite). Stay on `expo-av`; flag SDK-55 removal as a deferred concern. [CITED: expo.dev/changelog/sdk-54] |

**Installation:** None. `expo-video` is NOT installed and should not be added in this phase.

## Package Legitimacy Audit

**No external packages are installed in this phase.** All work uses dependencies already present in the monorepo (verified in `artifacts/api-server/package.json`, `lib/db/package.json`, `artifacts/memento-mobile/package.json`). The Package Legitimacy Gate is therefore not triggered.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none added) | — | N/A — phase adds zero new dependencies |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

> If the planner later decides to add `expo-video` (NOT recommended for this phase), it MUST be gated behind a `checkpoint:human-verify` task and verified on the npm registry first.

## Architecture Patterns

### System Architecture Diagram

```text
                        EVENT END (host)
                              │
            POST /events/:id/end  (events.ts:299)
                              │  inserts video_jobs row (status=pending)
                              ▼
        ┌──────────────────────────────────────────────┐
        │  Video worker  (in-process poll, 30s)         │
        │  pollAndProcess → processVideoJob             │
        │   • claim pending → processing                │
        │   • order media by COALESCE(capturedAt,       │
        │       createdAt)   ← VIDEO-03 change          │
        │   • ffmpeg compile + voice overlay            │
        │   • upload mp4, set status = ready_for_review │
        │   ✗ NO notification fan-out here (REMOVED)    │
        └──────────────────────────────────────────────┘
                              │ status = ready_for_review
                              ▼
   GET /events/:id/video-status (authed host)      GET /events/token/:tok/video-status (PUBLIC)
   → returns review state + videoUrl               → MUST hide videoUrl/review until approvedAt
                              │                                   │
              ┌───────────────┴───────────────┐                  └─ guests see "not ready" until approve
              ▼                                ▼
   POST /events/:id/video/approve     POST /events/:id/video/regenerate
   (host, Clerk)                      (host, Clerk)
   • set approvedAt, status=completed  • mark current job supersededAt
   • fan-out push + email  ◄── moved   • insert NEW video_jobs (pending)
     from worker                         (worker recompiles)
              │
              ▼
   sendPushNotifications / sendGuestEmails / sendHostEmail  (notifications.ts — unchanged)
              │
              ▼
   Guests notified → public/token status now exposes videoUrl
```

### Recommended Approach: status model (the core discretion decision)

**Use an additive Postgres enum value + nullable timestamps on `videoJobsTable`:**

- Add `ready_for_review` to `videoJobStatusEnum` (`schema/index.ts:28`). Postgres `ALTER TYPE ... ADD VALUE` is non-breaking and applied by `drizzle-kit push`.
- Add `approvedAt: timestamp("approved_at")` (nullable) — set by the approve handler; doubles as the "delivered" signal and an audit trail.
- Add `supersededAt: timestamp("superseded_at")` (nullable) — set on the prior job by regenerate so it is excluded from "latest active job" and never notifies.

**State mapping the clients must handle:**

| DB state | `status` value | `approvedAt` | Client meaning |
|----------|---------------|-------------|----------------|
| compiling | `pending`/`processing` | null | "Compiling…" (existing) |
| compiled, awaiting host | `ready_for_review` (NEW) | null | Review gate — player + Approve/Regenerate (host only) |
| approved & delivered | `completed` | set | "Approved & delivered" — guests notified, video public |
| failed | `failed` | null | Error + Regenerate recovery (existing) |
| regenerating | prior job `supersededAt` set; new job `pending` | null | "Building a fresh edit…" |

**Why preserve `completed` = delivered:** every existing client check is `status === "completed"` to mean "watchable/delivered" (`event-detail.tsx:290`, `event.tsx:612,621`). Mapping approved→`completed` keeps those correct with zero edits to the *delivered* branch, while the NEW `ready_for_review` branch is purely additive UI. The response should also include `approvedAt` (nullable) so the host card can distinguish `ready_for_review` from `completed` explicitly.

### Pattern: route handler shape (new approve/regenerate)
```typescript
// Source: existing pattern in events.ts:299 (/end handler) — mirror exactly
router.post("/events/:eventId/video/approve", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const event = await db.query.eventsTable.findFirst({
      where: and(eq(eventsTable.id, String(req.params.eventId)), isNull(eventsTable.deletedAt)),
    });
    if (!event || event.hostId !== user.id) { res.status(404).json({ error: "Event not found" }); return; }
    // load latest non-superseded job; require status === "ready_for_review"; else 409
    // set approvedAt + status="completed"; then run the moved notification fan-out
    // (idempotency: if already approvedAt set, return 200 without re-notifying)
  } catch (err) {
    req.log.error(err, "Failed to approve video");
    res.status(500).json({ error: "Internal server error" });
  }
});
```

### Pattern: worker ordering change (VIDEO-03)
```typescript
// Source: videoWorker.ts:360 — change orderBy and anchor/delay computation
// BEFORE: orderBy asc(createdAt); anchorTime = mediaItems[0].createdAt; delayMs from item.createdAt
// AFTER:  order + anchor + delay by capturedAt ?? createdAt
const sortKey = (m: { capturedAt: Date | null; createdAt: Date }) =>
  (m.capturedAt ?? m.createdAt).getTime();
// in the loop: const delayMs = Math.max(0, sortKey(item) - anchorSortKey);
```
Drizzle has no clean `COALESCE` in the relational `orderBy` callback, so either sort in JS after `findMany` (simplest, correct, small N) or use a raw `sql` ordering. **Recommended: fetch then `mediaItems.sort((a,b) => sortKey(a) - sortKey(b))` in JS** — avoids a raw-SQL footgun and is the least fragile change to the worker's hand-built filter graph.

### Anti-Patterns to Avoid
- **Removing/renaming an existing enum value** (`completed`, etc.) — breaks all client `status ===` checks. Only ADD values.
- **Notifying from the worker** — the whole point is to move the fan-out (`videoWorker.ts:494–507`) into the approve handler. Leaving it fires guest notifications before approval.
- **Returning `videoUrl` from the public/token endpoint pre-approval** — leaks the review cut to guests. The token handler must null out `videoUrl` (and the review state) unless `approvedAt` is set.
- **Hand-editing generated hooks/zod** — regenerate from spec.
- **Computing voice-note delay from `createdAt`** after this phase — that is the exact bug VIDEO-03 fixes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Client API hooks for new endpoints | Manual `fetch` calls | Orval codegen from `openapi.yaml` → `useApproveEventVideo`, `useRegenerateEventVideo` | Repo mandates spec-first; manual fetch bypasses `customFetch` auth injection + error mapping. |
| Request/response validation | Hand-written zod | drizzle-zod (`schema/index.ts`) + Orval zod target | Already the established source of truth. |
| Enum migration | Manual SQL `ALTER TYPE` script | `drizzle-kit push` after editing `videoJobStatusEnum` | `push` diffs and applies enum value additions. |
| Polling | New interval/effect | Existing `useGetEventVideoStatus` `refetchInterval` (`event-detail.tsx:120`) | UI-SPEC forbids a new polling mechanism. |
| Push + email fan-out | Re-implement in approve handler | Call existing `sendPushNotifications`/`sendGuestEmails`/`sendHostEmail` from `notifications.ts` | Helpers are `Promise.allSettled`-based and tested by use; just relocate the call site. |

**Key insight:** This is a *relocation + additive-field* phase, not a build-new-systems phase. The riskiest temptation is touching the ffmpeg filter-graph builder (fragile, untested — see Pitfalls); the only worker change needed is the media ordering/delay key, which can be a pure JS sort with no filter-graph edits.

## Runtime State Inventory

> This is an additive feature phase with one schema change, not a rename/migration. No string-identifier renames are involved. Inventory included for the schema/state changes that have runtime implications.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing `video_jobs` rows have `status` in `{pending,processing,completed,failed}` and no `approvedAt`/`supersededAt`. CONTEXT.md decision: **no migration of already-delivered videos**; new behavior applies to events ending after deploy. | None — new columns are nullable; old `completed` rows remain "delivered" (their `approvedAt` stays null, which is acceptable since they predate the gate). |
| Live service config | None — no external service stores these identifiers. | None. |
| OS-registered state | None — the worker is in-process (`index.ts` `startVideoWorker()`); no Task Scheduler / cron registration. | None. |
| Secrets/env vars | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `PRIVATE_OBJECT_DIR` unchanged. No new secrets. | None. |
| Build artifacts | Generated `lib/api-client-react/src/generated/*` and `lib/api-zod/src/generated/*` are regenerated by `codegen` (`clean: true` wipes them). | Run `pnpm --filter @workspace/api-spec run codegen` after editing `openapi.yaml`; restart API after `db push`. |

**Verified by:** reading `schema/index.ts`, `index.ts` (worker start), `orval.config.ts`, and the notifications/worker call sites.

## Common Pitfalls

### Pitfall 1: Public/token endpoint leaks the review video
**What goes wrong:** Extending `/events/token/:shareToken/video-status` to surface the new state without gating exposes `videoUrl` (and the existence of a review cut) to anyone with the share link, before the host approves.
**Why it happens:** The token handler (`events.ts:553`) returns the latest job verbatim; a naive extension passes the review state through.
**How to avoid:** In the token handler, if the latest active job is not yet approved (`approvedAt` null), return a non-revealing status (e.g. map `ready_for_review`→`processing`-equivalent for guests, or a dedicated "not ready" shape) and **null `videoUrl`**. Only expose `videoUrl` once `approvedAt` is set. Add a focused test.
**Warning signs:** A guest (token-only) request returns a non-null `videoUrl` while `approvedAt` is null.

### Pitfall 2: Mobile host card still uses the public token hook
**What goes wrong:** `app/(tabs)/event.tsx` uses `useGetEventVideoStatusByToken` (`event.tsx:139`) even for the host. If that hook stays, the host's review card is driven by the (correctly gated) public response and would never see the review video — OR, if the public path is mis-gated, it leaks.
**Why it happens:** The mobile event tab was built around the public token flow.
**How to avoid:** Switch the host's review card to the authed `useGetEventVideoStatus(eventId, ...)` hook (gated by `isHost`), mirroring web `event-detail.tsx:116`. The public token hook can remain for the guest-facing path. This is called out explicitly in UI-SPEC §Polling and §Assumptions(3).
**Warning signs:** Host on mobile never sees Approve/Regenerate; or the review video appears on the guest path.

### Pitfall 3: Notification fan-out left in the worker (double-send or premature send)
**What goes wrong:** If the worker keeps notifying (`videoWorker.ts:494–507`) AND the approve handler also notifies, guests get notified at compile time (premature) and again at approve (double).
**Why it happens:** Incomplete relocation.
**How to avoid:** Delete the entire notification block (and the guest/host/event/mediaCount fetches that exist only to feed it, `videoWorker.ts:468–512`) from the worker; the worker's terminal action becomes setting `status = ready_for_review`. Re-create those fetches inside the approve handler.
**Warning signs:** Guests receive a push before the host clicks Approve.

### Pitfall 4: Touching the ffmpeg filter-graph builder
**What goes wrong:** Editing `assembleWithCrossfades` / `overlayVoiceNotesChronological` (`videoWorker.ts:220–325`) to thread `capturedAt` corrupts the hand-built xfade/adelay offsets (off-by-one, clip `< XFADE_DUR`). This code is fragile and untested (CONCERNS.md "Fragile Areas").
**Why it happens:** Over-reaching the VIDEO-03 change.
**How to avoid:** VIDEO-03 only needs the **ordering key** and the **`delayMs` anchor** to use `capturedAt ?? createdAt`. The `adelay` computation already consumes `delayMs` from the `VoiceNote` struct (`videoWorker.ts:302`) — feed it the capture-time-derived delay and change nothing in the filter strings.
**Warning signs:** ffmpeg errors or silent corruption on multi-clip events that previously worked.

### Pitfall 5 (do-not-regress): voice-only / empty-media edge cases
**What goes wrong:** Voice-only events (no visual clips) produce a 5s black placeholder that truncates voice notes beyond 5s (`videoWorker.ts:429–441`; CONCERNS.md known bug). This is **deferred to VIDEO-05** — do NOT fix it here, but do NOT make it worse. The `capturedAt` ordering change must not alter the placeholder/voice-only branch behavior.
**How to avoid:** Keep the `visualClips.length === 0` branch logic identical; only change how `delayMs`/ordering is derived. Verify a voice-only event still compiles to the same (placeholder) output after the change.
**Warning signs:** Voice-only event errors out or changes output length after the ordering change.

### Pitfall 6: Express 5 param typing
**What goes wrong:** New handlers pass `req.params.eventId` (`string | string[]`) directly to Drizzle `eq()`.
**How to avoid:** `String(req.params.eventId)` — every existing handler does this (e.g. `events.ts:304`).

## Code Examples

### Schema additions (edit FIRST)
```typescript
// Source: lib/db/src/schema/index.ts — additive only
// 1) extend the enum (Postgres ADD VALUE — non-breaking)
export const videoJobStatusEnum = pgEnum("video_job_status", [
  "pending", "processing", "ready_for_review", "completed", "failed",
]);

// 2) media_items: nullable capture timestamp (VIDEO-03)
//    add inside mediaItemsTable definition:
capturedAt: timestamp("captured_at"),   // nullable; client-supplied at confirm

// 3) video_jobs: review-gate timestamps
//    add inside videoJobsTable definition:
approvedAt: timestamp("approved_at"),     // set by approve handler
supersededAt: timestamp("superseded_at"), // set on prior job by regenerate
```

### OpenAPI additions (edit FIRST, then codegen)
```yaml
# Source: lib/api-spec/openapi.yaml
# ConfirmMediaUploadRequest (line ~980): add optional capturedAt
capturedAt:
  type: string
  format: date-time
  description: Client-side capture time; used to order media. Optional (falls back to server confirm time).

# VideoJobStatus (line ~1099): add ready_for_review + approvedAt
status:
  enum: [pending, processing, ready_for_review, completed, failed]
approvedAt:
  type: string
  format: date-time
  nullable: true

# New paths (mirror endEvent security: clerkAuth):
# POST /events/{eventId}/video/approve     operationId: approveEventVideo
# POST /events/{eventId}/video/regenerate  operationId: regenerateEventVideo
#   both → 200 VideoJobStatus, 401 Unauthorized, 404 NotFound, (409 for approve if not ready_for_review)
```

### Client capture timestamp (mobile)
```typescript
// Source: artifacts/memento-mobile/app/(tabs)/camera.tsx
// Capture the moment at shutter/record-start, pass through doUpload into confirm body.
// Photo: capturedAt = new Date().toISOString() at handleTakePhoto (camera.tsx:157)
// Video: derive from recordingStartRef.current (camera.tsx:178)
// Voice: derive from voiceStartRef.current (camera.tsx:224)
// then add to confirmUpload.mutate data: { ...existing, capturedAt }
```
Web guest path (`event-join.tsx:101`) can send `capturedAt` from the file's `lastModified` or `new Date()` at selection — optional, falls back to `createdAt`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `expo-av` Video | `expo-video` | Deprecated SDK 53, ships last in SDK 54, removed SDK 55 | This repo (SDK ~54) keeps `expo-av`; migration is out of scope. Flag for a future phase. [CITED: expo.dev/changelog/sdk-54] |

**Deprecated/outdated:**
- `expo-av` — deprecated but present and functional on SDK 54; the UI-SPEC and existing `app/video.tsx` standardize on it for this phase. Do not migrate now.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Additive `ready_for_review` enum value + `approvedAt` is the least-disruptive status representation (vs new boolean/enum). | Architecture Patterns | Low — verified non-breaking against all existing `status===` consumers; planner has discretion per CONTEXT.md. |
| A2 | Mapping approved → `status="completed"` (with `approvedAt` set) keeps existing "delivered/watchable" client branches correct. | Architecture Patterns | Low — grounded in `event-detail.tsx:290`, `event.tsx:612`. If planner prefers a distinct `approved` enum value, all `completed` client checks must be updated too (more churn). |
| A3 | `drizzle-kit push` applies a Postgres enum `ADD VALUE` cleanly. | Standard Stack | Low-Medium — true for additive values; verify push output. Enum value adds cannot run inside a transaction in some PG versions, but `push` handles this. [ASSUMED] |
| A4 | Sorting media in JS by `capturedAt ?? createdAt` (rather than SQL `COALESCE` orderBy) is the safest worker change. | Code Examples | Low — N is small per event; avoids raw-SQL fragility. |
| A5 | `expo-av` remains the correct mobile player for this phase (no `expo-video` migration). | Standard Stack | Low — installed, used, and fixed by UI-SPEC. |
| A6 | Web guest `capturedAt` can derive from file `lastModified`/selection time. | Code Examples | Low — optional field; exact source is the client's discretion. |

## Open Questions

1. **Approve idempotency / re-send guard**
   - What we know: CONTEXT.md says "no auto-send, no reminder"; approve triggers fan-out.
   - What's unclear: Should a second approve call (double-tap, retry) re-notify?
   - Recommendation: Make approve idempotent — if `approvedAt` already set, return 200 without re-notifying. Mirrors the "can't un-send" copy in UI-SPEC.

2. **Regenerate while a prior job is still `processing`**
   - What we know: Regenerate inserts a new `video_jobs` row; worker processes one job at a time.
   - What's unclear: Behavior if the host regenerates before the first compile finishes.
   - Recommendation: On regenerate, mark the current latest job `supersededAt` regardless of its status; the worker's "latest non-superseded pending" selection then picks the new job. Ensure the status endpoints always read the **latest non-superseded** job (add `isNull(supersededAt)` to the `findFirst` ordering used by `video-status`, `getEvent`, and the token endpoint).

3. **Public/token "not ready" shape for guests**
   - What we know: Public path must not expose `videoUrl` pre-approval.
   - What's unclear: Exact response when a review video exists but isn't approved — 404, or a `processing`-like status?
   - Recommendation: Return a benign in-progress shape (status mapped so guests see "not ready yet") with `videoUrl: null`; avoid 404 churn for clients already polling. Planner to pick; either satisfies the security requirement as long as `videoUrl` is withheld.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Postgres (DATABASE_URL) | schema push | ✓ (Replit-provisioned) | — | none — required |
| drizzle-kit push | enum + column add | ✓ | ^0.31.10 | none |
| Orval codegen | client hooks/zod | ✓ | ^8.18.0 | none |
| ffmpeg/ffprobe | worker (unchanged) | ✓ (PATH, per `.replit`) | system | none |
| Replit Object Storage sidecar (127.0.0.1:1106) | signed playback URL | ✓ on Replit | — | not testable off-Replit |
| RESEND_API_KEY | guest/host email on approve | optional | — | dry-run logging (`notifications.ts:71`) — approve still succeeds |
| expo-av | mobile review player | ✓ | ~16.0.8 | none needed |

**Missing dependencies with no fallback:** none — all required tooling is present in the Replit runtime.
**Missing dependencies with fallback:** `RESEND_API_KEY` (email dry-runs if unset; push still attempts; approve flow not blocked).

## Security Domain

> `security_enforcement` is not set to `false` in config → treat as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Approve/regenerate gated by Clerk `requireAuth`; host-ownership check returns 404 (existing pattern). |
| V3 Session Management | no | No new session surface; reuses Clerk sessions / guest tokens. |
| V4 Access Control | yes | **Critical:** public/token status must not expose review `videoUrl` pre-approval; host-only on approve/regenerate (`event.hostId === user.id`); mobile must switch host card to authed hook. |
| V5 Input Validation | yes | New `capturedAt` validated as `date-time` via generated zod; new endpoints validate `eventId` (`String(...)`) and require `ready_for_review` state before approve (409 otherwise). |
| V6 Cryptography | no | No new crypto; signed GCS URLs unchanged. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Guest views unapproved review cut via public token endpoint | Information Disclosure | Withhold `videoUrl` and review state on `/events/token/:tok/video-status` until `approvedAt` set. |
| Non-host approves/regenerates someone else's event video | Elevation of Privilege | Clerk `requireAuth` + `event.hostId !== user.id → 404` (existing ownership pattern). |
| Premature/double guest notification | Tampering / abuse of trust | Move fan-out to approve handler; make approve idempotent on `approvedAt`. |
| Express 5 `req.params` array injection into `eq()` | Tampering | `String(req.params.eventId)` on every new handler. |

## Sources

### Primary (HIGH confidence — repo files, read this session)
- `artifacts/api-server/src/lib/videoWorker.ts` — compile path, notification fan-out (`:466–512`), voice-note delay from `createdAt` (`:362,371,414`), job claim/status transitions, stuck-job reaper.
- `artifacts/api-server/src/routes/events.ts` — `/end` (`:299`), `video-status` (`:419`), token `video-status` (`:553`), `formatEvent` videoJob serializer (`:83–101`).
- `artifacts/api-server/src/routes/media.ts` — confirm handler (`:98–198`), confirm body destructure (`:125–139`).
- `artifacts/api-server/src/lib/notifications.ts` — `sendPushNotifications`/`sendGuestEmails`/`sendHostEmail` (the fan-out to relocate).
- `lib/db/src/schema/index.ts` — `videoJobStatusEnum` (`:28`), `mediaItemsTable` (`:179`), `videoJobsTable` (`:208`), drizzle-zod conventions.
- `lib/api-spec/openapi.yaml` — `VideoJobStatus` (`:1099`), `ConfirmMediaUploadRequest` (`:980`), `MediaItem` (`:942`), endEvent/video-status paths (`:188–317`).
- `lib/api-spec/orval.config.ts` — `indexFiles: false`, `clean: true`, `titleTransformer`, mutator.
- `lib/api-client-react/src/generated/api.ts` — confirmed hooks `useGetEventVideoStatus` (`:882`), `useGetEventVideoStatusByToken` (`:1114`), `useConfirmMediaUpload` (`:1409`), `useEndEvent`, `getGetEventVideoStatusQueryKey`.
- `artifacts/memento-web/src/pages/host/event-detail.tsx` — authed status hook + polling (`:116`), video card (`:284–318`).
- `artifacts/memento-mobile/app/(tabs)/event.tsx` — uses public token hook for host (`:139`); videoCard (`:572+`); End Event `Alert.alert` confirm (`:183`).
- `artifacts/memento-mobile/app/video.tsx` — `expo-av` `Video` player pattern (`:2,95–100`).
- `artifacts/memento-mobile/app/(tabs)/camera.tsx` — `doUpload`/confirm body (`:78–141`); capture moments (`:157,178,224`).
- `artifacts/memento-mobile/package.json` — `expo-av ~16.0.8` (no `expo-video`).
- Build scripts: `lib/api-spec/package.json` `codegen`, `lib/db/package.json` `push`, `artifacts/api-server/package.json` `dev`.

### Secondary (MEDIUM confidence)
- `.planning/codebase/CONCERNS.md` — fragile filter-graph, voice-only 5s truncation bug, `createdAt`-vs-capture-time bug, single in-process worker.

### Tertiary (LOW confidence — verify)
- [CITED: expo.dev/changelog/sdk-54] expo-av deprecation/removal timeline (SDK 55) — https://expo.dev/changelog/sdk-54

## Codegen + Deploy Commands

```bash
# 1. Edit FIRST: lib/db/src/schema/index.ts (enum + columns) and lib/api-spec/openapi.yaml

# 2. Push DB schema (enum ADD VALUE + nullable columns)
pnpm --filter @workspace/db run push

# 3. Regenerate client hooks + zod (also runs typecheck:libs)
pnpm --filter @workspace/api-spec run codegen

# 4. Typecheck the workspace
pnpm run typecheck

# 5. Restart the API server (esbuild rebuild → node)
pnpm --filter @workspace/api-server run dev

# Mobile / web pick up regenerated hooks automatically (workspace:* source resolution).
```

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all deps verified in package.json; no new packages.
- Architecture (status model, fan-out relocation, capturedAt): HIGH — every seam read at path:line; representation choice grounded in actual client consumers.
- Pitfalls / security: HIGH — public-path leak, mobile hook switch, and fan-out relocation are concretely located and matched to CONTEXT.md + UI-SPEC requirements.
- expo-av deprecation timeline: MEDIUM — single official changelog source; not load-bearing (staying on expo-av).

**Research date:** 2026-06-27
**Valid until:** 2026-07-27 (stable brownfield repo; expo-av timeline fixed by Expo release cadence)
