# Phase 1: Same-Day-Edit Video Control - Pattern Map

**Mapped:** 2026-06-27
**Files analyzed:** 11 (7 modified, 0 net-new files — all work threads into existing modules)
**Analogs found:** 11 / 11 (every change has a same-file or sibling-file analog)

> This is a **relocation + additive-field** phase, not a build-new-systems phase. Every new endpoint, column, enum value, and UI branch has an exact in-repo analog. The planner should copy structure verbatim and change only the load-bearing lines noted below. **Spec-first order is mandatory:** edit `schema/index.ts` + `openapi.yaml` FIRST, then `db push` + `codegen`, then implement handlers, then restart.

---

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `lib/db/src/schema/index.ts` (enum + cols) | model / schema | transform (additive DDL) | same file — `videoJobStatusEnum` (:28), `mediaItemsTable` (:179), `videoJobsTable` (:208) | exact (in-file) |
| `lib/api-spec/openapi.yaml` (new paths + schema fields) | config / contract | request-response | same file — `endEvent` path (:188), `VideoJobStatus` (:1099), `ConfirmMediaUploadRequest` (:980) | exact (in-file) |
| `artifacts/api-server/src/routes/events.ts` → `POST .../video/approve` | route handler | request-response (command + side-effect fan-out) | `events.ts` `/end` (:299); fan-out block from `videoWorker.ts:468–512` | exact (sibling pattern + relocation) |
| `artifacts/api-server/src/routes/events.ts` → `POST .../video/regenerate` | route handler | request-response (command + DB insert) | `events.ts` `/end` (:299) — inserts a `video_jobs` row | exact |
| `artifacts/api-server/src/routes/events.ts` → `video-status` (extend) | route handler | request-response (read) | same handler `:419–473` (authed) | exact (in-file edit) |
| `artifacts/api-server/src/routes/events.ts` → token `video-status` (gate) | route handler | request-response (public read) | same handler `:553–591` | exact (in-file edit) |
| `artifacts/api-server/src/lib/videoWorker.ts` (remove fan-out; order by capturedAt) | worker / service | batch + file-I/O | same file `:360–512` | exact (in-file edit) |
| `artifacts/api-server/src/routes/media.ts` → confirm body (accept `capturedAt`) | route handler | request-response (create) | same handler `:98–198` | exact (in-file edit) |
| `artifacts/memento-web/src/pages/host/event-detail.tsx` → review card | component | event-driven (poll → mutate) | same file video card `:284–318`; `showEndDialog` confirm pattern | exact (in-file extend) |
| `artifacts/memento-mobile/app/(tabs)/event.tsx` → review card + hook switch | component | event-driven (poll → mutate) | same file `videoCard :572+`; `app/video.tsx` player; `Alert.alert` confirm `:183` | exact (in-file extend) |
| `artifacts/memento-mobile/app/(tabs)/camera.tsx` + `memento-web/src/pages/event-join.tsx` → send `capturedAt` | component | request-response (confirm body) | `camera.tsx doUpload :87–141`; `event-join.tsx confirmUpload :96` | exact (in-file extend) |

No genuinely new files are created — all surfaces already exist. See **No Analog Found** (empty).

---

## Pattern Assignments

### `lib/db/src/schema/index.ts` — enum value + nullable columns (EDIT FIRST)

**Analog:** the enum and tables already in this file. Additive only — never rename/remove an existing value (breaks every client `status ===` check).

**Enum extension** (current, `schema/index.ts:28-33`):
```typescript
export const videoJobStatusEnum = pgEnum("video_job_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);
```
Add `"ready_for_review"` between `processing` and `completed` (Postgres `ALTER TYPE ... ADD VALUE`, applied by `drizzle-kit push`).

**`mediaItemsTable` column** — mirror the existing nullable `timestamp` convention in this table (`createdAt`/`updatedAt`/`deletedAt` at `:192-194`). Add inside the table def (`:179-195`):
```typescript
capturedAt: timestamp("captured_at"),   // nullable; client-supplied at confirm (VIDEO-03)
```

**`videoJobsTable` columns** — mirror existing nullable timestamps `startedAt`/`completedAt` (`:221-222`). Add inside the table def (`:208-226`):
```typescript
approvedAt: timestamp("approved_at"),     // set by approve handler — doubles as "delivered" signal
supersededAt: timestamp("superseded_at"), // set on prior job by regenerate
```

**drizzle-zod follows automatically** — `insertVideoJobSchema` (`:228`) already `.omit`s server-managed fields; add `approvedAt`/`supersededAt` to its omit list (they are handler-managed, like `completedAt`). `capturedAt` should NOT be omitted from `insertMediaItemSchema` (`:197`) since the client supplies it.

After editing: `pnpm --filter @workspace/db run push`.

---

### `lib/api-spec/openapi.yaml` — new paths + schema fields (EDIT FIRST, then codegen)

**Analog for new paths:** the `endEvent` path (`:188-207`) — copy its `security: [- clerkAuth: []]`, `parameters: [- $ref: "#/components/parameters/eventId"]`, and the `200 → VideoJobStatus` response shape verbatim.

**`endEvent` path block to mirror** (`:188-207`):
```yaml
  /events/{eventId}/end:
    post:
      operationId: endEvent
      tags: [events]
      summary: End an event and trigger video generation
      security:
        - clerkAuth: []
      parameters:
        - $ref: "#/components/parameters/eventId"
      responses:
        "200":
          description: Event ended and video job enqueued
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/VideoJobStatus"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
```

**New paths** (add near the existing video paths). `operationId` drives the generated hook name — `approveEventVideo` → `useApproveEventVideo`, `regenerateEventVideo` → `useRegenerateEventVideo`:
```yaml
  /events/{eventId}/video/approve:
    post:
      operationId: approveEventVideo
      tags: [video]
      security: [- clerkAuth: []]
      parameters: [- $ref: "#/components/parameters/eventId"]
      responses:
        "200": { ... $ref VideoJobStatus }
        "401": Unauthorized   "404": NotFound   "409": { not ready_for_review }
  /events/{eventId}/video/regenerate:
    post:
      operationId: regenerateEventVideo
      tags: [video]
      security: [- clerkAuth: []]
      parameters: [- $ref: "#/components/parameters/eventId"]
      responses: { "200": VideoJobStatus, "401", "404" }
```

**`VideoJobStatus` schema** (current `:1099-1129`) — add `ready_for_review` to the enum and an `approvedAt` field, mirroring the existing nullable `completedAt`:
```yaml
        status:
          type: string
          enum: [pending, processing, ready_for_review, completed, failed]   # ADD ready_for_review
        approvedAt:                                                            # ADD, mirrors completedAt
          type: string
          format: date-time
          nullable: true
```

**`ConfirmMediaUploadRequest` schema** (current `:980-996`) — add optional `capturedAt` alongside the existing optional fields (`fileName`, `durationSeconds` etc.). Do NOT add it to `required: [objectPath, mediaType]` (backward-compat):
```yaml
        capturedAt:
          type: string
          format: date-time
          description: Client capture time; orders media. Optional (falls back to server confirm time).
```

After editing: `pnpm --filter @workspace/api-spec run codegen` (runs Orval + `typecheck:libs`). **Never hand-edit `generated/`.**

---

### `artifacts/api-server/src/routes/events.ts` — `POST /events/:eventId/video/approve` (NEW handler)

**Analog:** the `/end` handler (`events.ts:299-377`) for the ownership + handler shell; the fan-out block from `videoWorker.ts:468-512` (relocated here). Place the new handlers next to the existing video-status handler.

**Ownership + handler shell** (copy from `/end`, `events.ts:299-317`):
```typescript
router.post("/events/:eventId/end", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const event = await db.query.eventsTable.findFirst({
      where: and(
        eq(eventsTable.id, String(req.params.eventId)),   // Express 5: String(...) before eq()
        isNull(eventsTable.deletedAt),
      ),
    });
    if (!event || event.hostId !== user.id) {              // ownership → 404, never 403
      res.status(404).json({ error: "Event not found" });
      return;
    }
    // ...
  } catch (err) {
    req.log.error(err, "Failed to end event");             // req.log, (objOrErr, msg)
    res.status(500).json({ error: "Internal server error" });
  }
});
```

**Latest-job selection** (copy from `events.ts:447-450`, add `isNull(supersededAt)` per Research Open Q2):
```typescript
const job = await db.query.videoJobsTable.findFirst({
  where: and(eq(videoJobsTable.eventId, event.id), isNull(videoJobsTable.supersededAt)),
  orderBy: (t, { desc }) => [desc(t.createdAt)],
});
```
Then: require `job.status === "ready_for_review"` else `res.status(409)...; return;`. **Idempotency** (Research Open Q1): if `job.approvedAt` already set, return 200 without re-notifying.

**On approve:** set `approvedAt: new Date()`, `status: "completed"` (preserves clients' `status === "completed"` = delivered), then run the relocated fan-out.

**Relocated fan-out block** (move verbatim from `videoWorker.ts:476-507`):
```typescript
const allGuests = await db.query.eventGuestsTable.findMany({
  where: and(eq(eventGuestsTable.eventId, job.eventId), isNull(eventGuestsTable.deletedAt)),
});
const host = await db.query.usersTable.findFirst({ where: eq(usersTable.id, event.hostId) });
const [{ value: mediaCount }] = await db
  .select({ value: count() })
  .from(mediaItemsTable)
  .where(and(eq(mediaItemsTable.eventId, job.eventId), isNull(mediaItemsTable.deletedAt)));

await Promise.allSettled([
  sendPushNotifications(allGuests, event.title, videoUrl),
  sendGuestEmails(allGuests, event, videoUrl),
  host
    ? sendHostEmail(host, event, videoUrl, allGuests.length, Number(mediaCount), job.tier)
    : Promise.resolve(),
]);
```
`sendPushNotifications` / `sendGuestEmails` / `sendHostEmail` are exported from `../lib/notifications` (signatures at `notifications.ts:18,106,131`). Add `usersTable` to the `@workspace/db/schema` import in `events.ts:3-9` (currently absent there).

**Response:** reuse the inline VideoJobStatus serializer from `/end` (`events.ts:362-372`), adding `approvedAt: job.approvedAt`.

---

### `artifacts/api-server/src/routes/events.ts` — `POST /events/:eventId/video/regenerate` (NEW handler)

**Analog:** `/end` handler (`events.ts:299-377`) — same ownership shell, same `db.insert(videoJobsTable)...returning()` pattern (`events.ts:351-360`):
```typescript
const [job] = await db
  .insert(videoJobsTable)
  .values({ eventId: event.id, tier, durationCapSeconds, qualityCap: quality, maxResolutionPx })
  .returning();
```
Regenerate flow: (1) mark the current latest non-superseded job `supersededAt: new Date()`; (2) re-resolve tier caps via `getDurationCap`/`getQualityCap` (already imported at `events.ts:12`) — or copy them from the superseded job; (3) insert a fresh `video_jobs` row (status defaults to `pending`); the worker poll picks it up. Return the new job via the same serializer.

---

### `artifacts/api-server/src/routes/events.ts` — extend authed `video-status` (`:419-473`)

**Analog:** the handler as-is. Two edits: (1) `findFirst` where-clause gains `isNull(videoJobsTable.supersededAt)` so it always reads the latest active job; (2) the response object (`:457-467`) gains `approvedAt: job.approvedAt`. The host path surfaces `ready_for_review` + `videoUrl` freely (host is authed). Current response shape:
```typescript
res.json({
  id: job.id, eventId: job.eventId, status: job.status, videoUrl: job.videoUrl,
  durationCapSeconds: job.durationCapSeconds, tier: job.tier,
  errorMessage: job.errorMessage, createdAt: job.createdAt, completedAt: job.completedAt,
});
```

---

### `artifacts/api-server/src/routes/events.ts` — gate public token `video-status` (`:553-591`)

**Analog:** same handler. **SECURITY-CRITICAL** (Research Pitfall 1): the public path must NOT expose the review cut before approval. Add `isNull(supersededAt)` to the `findFirst`, then gate the response:
- If `job.approvedAt` is null: return a benign in-progress shape with **`videoUrl: null`** and a non-revealing status (map `ready_for_review` → `processing`-equivalent for guests). Never leak `videoUrl` while `approvedAt` is null.
- If `job.approvedAt` is set: return the full shape (current behavior) including `videoUrl`.

The current handler returns the job verbatim (`:577-587`) — that is exactly the leak to fix.

---

### `artifacts/api-server/src/lib/videoWorker.ts` — remove fan-out, order by capturedAt (`:360-512`)

**Analog:** same file. Three precise edits, no filter-graph touching (Research Pitfall 4/5):

1. **Terminal status** — change the completion update (`:455-464`) from `status: "completed"` to `status: "ready_for_review"`. Drop `completedAt` here (it now belongs to the approve handler).
2. **Delete the notification block** (`:466-512`) entirely — the `event`/`allGuests`/`host`/`mediaCount` fetches existed only to feed the fan-out; they move to the approve handler. The worker's terminal action is just setting `ready_for_review`.
3. **Order by `capturedAt ?? createdAt`** (VIDEO-03). Current ordering + anchor + delay use `createdAt` (`:362,371,414`):
```typescript
// :362  orderBy: (t, { asc }) => [asc(t.createdAt)],
// :371  const anchorTime = mediaItems.length > 0 ? mediaItems[0].createdAt.getTime() : Date.now();
// :414  const delayMs = Math.max(0, item.createdAt.getTime() - anchorTime);
```
Replace with a `COALESCE(capturedAt, createdAt)` sort key in JS after `findMany` (Research A4 — avoids raw-SQL footgun; `adelay` already consumes `delayMs` from the `VoiceNote` struct, so the filter strings are untouched):
```typescript
const sortKey = (m: { capturedAt: Date | null; createdAt: Date }) =>
  (m.capturedAt ?? m.createdAt).getTime();
mediaItems.sort((a, b) => sortKey(a) - sortKey(b));
const anchorTime = mediaItems.length > 0 ? sortKey(mediaItems[0]) : Date.now();
// in the voice_note branch: const delayMs = Math.max(0, sortKey(item) - anchorTime);
```
Keep the `visualClips.length === 0` placeholder branch (`:429-431`) byte-identical.

---

### `artifacts/api-server/src/routes/media.ts` — accept `capturedAt` in confirm body (`:98-198`)

**Analog:** the confirm handler itself. Add `capturedAt` to the destructure (`:125-139`) and the insert values (`:163-176`), mirroring the existing optional fields:
```typescript
const { objectPath, mediaType, fileName, fileSizeBytes, durationSeconds, thumbnailPath, capturedAt } =
  req.body as { /* ...existing... */; capturedAt?: string };
// ...
const [item] = await db.insert(mediaItemsTable).values({
  eventId: event.id, guestId: guest?.id, uploaderId: req.dbUser?.id,
  mediaType, objectPath, fileName, fileSizeBytes, durationSeconds, thumbnailPath,
  capturedAt: capturedAt ? new Date(capturedAt) : undefined,   // optional; null falls back to createdAt
}).returning();
```
Optionally surface `capturedAt` in the 201 response (`:180-193`). The generated zod (`ConfirmMediaUploadRequest`) validates the `date-time` shape with `useDates: true`.

---

### `artifacts/memento-web/src/pages/host/event-detail.tsx` — host review card (`:284-318`)

**Analog:** the existing "Same-day edit" card in this file, plus the `showEndDialog` confirm pattern.

**Polling hook (reuse, do NOT add new polling)** — `useGetEventVideoStatus` with `refetchInterval` (`:116-125`):
```typescript
const { data: videoStatus } = useGetEventVideoStatus(eventId, {
  query: {
    enabled: event?.status === "ended",
    queryKey: getGetEventVideoStatusQueryKey(eventId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "processing" ? 3000 : false;
    },
  },
});
```
Extend the `refetchInterval` predicate to keep polling while `regenerating` (a fresh `pending`/`processing` job) — it already does, since regenerate produces a `pending` job.

**Card branching** (current `:290-317`) — add a `ready_for_review` branch BEFORE the `completed` branch. The `completed` + `videoUrl` branch already renders the `<video>` player + Download (`:290-301`); reuse that player markup for the review state and append the Approve/Regenerate actions:
```tsx
<video controls className="w-full rounded-xl mb-3 bg-black" data-testid="video-player">
  <source src={videoStatus.videoUrl} />
</video>
```
- Approve CTA: primary `<Button>` (default variant) → opens a `Dialog` confirm (import already present `:26`), mirroring `showEndDialog`/`handleEndEvent` (`:130,135-147`). On confirm, call `useApproveEventVideo` (new generated hook). On success, invalidate `getGetEventVideoStatusQueryKey(eventId)` and `getGetEventQueryKey(eventId)` (pattern at `:140`) and `toast({...})`.
- Regenerate: `variant="outline"` `<Button>` → lighter confirm → `useRegenerateEventVideo`.
- Pending labels: `endEvent.isPending ? "Ending..." : ...` pattern → `"Approving…"` / `"Regenerating…"`.
- Errors: `toast({ title, variant: "destructive" })` (the existing `onError` pattern `:144`).

Icons (`Film`, `Download`, `AlertCircle`, `Loader2`, `CheckCircle`) and `useToast` are already imported (`:17-27`). UI copy and state→branch mapping come from `01-UI-SPEC.md` §Interaction Contract + §Copywriting Contract.

---

### `artifacts/memento-mobile/app/(tabs)/event.tsx` — host review card + authed hook switch (`:572+`)

**Analog:** the existing `videoCard` (`:572-648`) for layout; `app/video.tsx` for the `expo-av` player; the `Alert.alert` "End Event" confirm (`:183-199`) for the destructive confirm.

**CRITICAL hook switch** (Research Pitfall 2, UI-SPEC §Polling + Assumption 3). Mobile currently drives the host card from the PUBLIC token hook (`event.tsx:25,139-142`):
```typescript
import { useGetEventVideoStatusByToken } from "@workspace/api-client-react";
const { data: videoStatus } = useGetEventVideoStatusByToken(shareToken ?? "", {
  query: { enabled: !!shareToken && eventStatus === "ended", refetchInterval: 20000 } as any,
});
```
For the host, switch to the AUTHED `useGetEventVideoStatus(eventId, ...)` (gated by `isHost`), mirroring web `event-detail.tsx:116`. The public token hook may remain for the guest-facing path. This is a correctness requirement: the unapproved review video must never be served on the public/token path.

**Player** — copy the `expo-av` `Video` usage from `app/video.tsx:2,95-101`:
```typescript
import { ResizeMode, Video } from "expo-av";
<Video
  ref={videoRef}
  source={{ uri: videoStatus.videoUrl }}
  style={StyleSheet.absoluteFill}   // (use a sized style inside the card, not absoluteFill)
  resizeMode={ResizeMode.CONTAIN}
  useNativeControls
/>
```

**Card / status branching** — extend the existing `videoStatus.status === ...` ladder (`:608-648`). Add a `ready_for_review` branch with the player + two buttons:
- Approve: primary button (mobile `watchBtn`/`signInBtn` style, min 46px height) → `Alert.alert` confirm mirroring `handleEndEvent` (`:183-199`) → call the new approve hook. Mutations on mobile follow the imperative `endEvent(eventId, { headers: { Authorization: Bearer ... } })` pattern (`event.tsx:3,196-198`) using `getToken()` — or the generated `use*` mutation hook.
- Regenerate: `outline`/secondary styled button → lighter `Alert.alert` → regenerate hook.
- Loading/error: `ActivityIndicator` (already imported `:9`) while pending; `Alert` on mutation error (mirrors `handleEndEvent` catch). Icons via `Feather name="film"` (`:588`), tint `colors.primary`.

Copy/states from `01-UI-SPEC.md`. Note mobile uses `Outfit_400Regular`/`_600SemiBold` only (UI-SPEC §Typography) — the existing `Outfit_500Medium` in `InfoRow` (`:59`) is pre-existing and out of scope to change.

---

### `camera.tsx` + `event-join.tsx` — send `capturedAt` at confirm

**Mobile analog** — `doUpload` → `confirmUpload.mutate` (`camera.tsx:78-128`). Capture the moment at shutter/record-start and thread it into the confirm `data`:
```typescript
confirmUpload.mutate(
  { eventId, data: { objectPath, mediaType, fileName, fileSizeBytes, durationSeconds, capturedAt } },
  { onSuccess: () => res(), onError: rej }
);
```
Capture moments per Research: photo at `handleTakePhoto`, video from `recordingStartRef`, voice from `voiceStartRef`. Pass `capturedAt` (an ISO string) down through `doUpload`'s params.

**Web analog** — `event-join.tsx` `confirmUpload.mutate` (`:96`, hook at `:227`). Derive `capturedAt` from the file's `lastModified` or `new Date()` at selection (Research A6). Optional everywhere; null falls back to `createdAt`.

---

## Shared Patterns

### Host ownership + Clerk auth (apply to: approve, regenerate handlers)
**Source:** `artifacts/api-server/src/routes/events.ts:299-313` (and every other host handler).
```typescript
router.post("/events/:eventId/...", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.dbUser!;
  const event = await db.query.eventsTable.findFirst({
    where: and(eq(eventsTable.id, String(req.params.eventId)), isNull(eventsTable.deletedAt)),
  });
  if (!event || event.hostId !== user.id) {
    res.status(404).json({ error: "Event not found" });   // ownership → 404, not 403
    return;
  }
```
`requireAuth` + `AuthenticatedRequest` come from `../lib/auth` (`events.ts:11`). Always `String(req.params.eventId)` (Express 5). Handlers return `void` — `res.json(...); return;`, never `return res.json(...)`.

### Error handling (apply to: every new/edited handler)
**Source:** `events.ts:373-375`, CONVENTIONS.md §Error Handling.
```typescript
} catch (err) {
  req.log.error(err, "Failed to <action>");   // req.log child logger, (objOrErr, msg)
  res.status(500).json({ error: "Internal server error" });
}
```
Error shape is always `{ error: string }`. 400 validation / 401 auth / 403 authz / 404 missing-or-owned-by-other / 409 wrong-state (approve when not `ready_for_review`).

### Latest active video job (apply to: approve, regenerate, both video-status handlers, getEvent)
**Source:** `events.ts:447-450` — extend with `isNull(supersededAt)` (Research Open Q2):
```typescript
const job = await db.query.videoJobsTable.findFirst({
  where: and(eq(videoJobsTable.eventId, event.id), isNull(videoJobsTable.supersededAt)),
  orderBy: (t, { desc }) => [desc(t.createdAt)],
});
```

### VideoJobStatus response serializer (apply to: all four video endpoints)
**Source:** inline shape repeated at `events.ts:362-372, 457-467, 577-587`. Add `approvedAt: job.approvedAt` to all of them. Consider centralizing into a `formatVideoJob(job)` helper (CONVENTIONS.md §Function & Module Design recommends a `formatEvent`-style serializer over inlining) — there are now 4+ identical call sites.

### Notification fan-out (apply to: approve handler ONLY — relocated)
**Source:** `videoWorker.ts:476-507`, helpers in `artifacts/api-server/src/lib/notifications.ts` (`sendPushNotifications:18`, `sendGuestEmails:106`, `sendHostEmail:131`). All `Promise.allSettled`-based; just relocate the call site. Email dry-runs if `RESEND_API_KEY` unset — approve still succeeds.

### Spec-first codegen discipline (apply to: schema + openapi edits)
**Source:** CONVENTIONS.md §Codegen Discipline, `lib/api-spec/orval.config.ts`.
1. Edit `lib/db/src/schema/index.ts` + `lib/api-spec/openapi.yaml` FIRST.
2. `pnpm --filter @workspace/db run push` then `pnpm --filter @workspace/api-spec run codegen`.
3. Restart api-server. **Never hand-edit `lib/api-client-react/src/generated/` or `lib/api-zod/src/generated/`.** Hook names derive from `operationId`.

### Reuse-existing-polling (apply to: web + mobile review cards)
**Source:** web `event-detail.tsx:116-125` `refetchInterval` predicate. UI-SPEC forbids a new polling mechanism — reuse `useGetEventVideoStatus`'s `refetchInterval`.

---

## No Analog Found

None. Every file in scope is an edit to an existing module with an in-repo (often in-file) analog. No net-new files, no event-driven/streaming/pub-sub patterns are introduced. The planner should not need to fall back to RESEARCH.md generic patterns for any surface.

---

## Metadata

**Analog search scope:** `artifacts/api-server/src/routes/`, `artifacts/api-server/src/lib/`, `lib/db/src/schema/`, `lib/api-spec/`, `artifacts/memento-web/src/pages/host/`, `artifacts/memento-mobile/app/`.
**Files scanned:** events.ts, media.ts, videoWorker.ts, notifications.ts, schema/index.ts, openapi.yaml, event-detail.tsx, mobile event.tsx, video.tsx, camera.tsx, event-join.tsx.
**Pattern extraction date:** 2026-06-27
