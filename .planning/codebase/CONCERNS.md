# Codebase Concerns

**Analysis Date:** 2026-06-28

This audit focuses on the `artifacts/api-server` (Express 5 + Drizzle + Clerk + Stripe + Replit Object Storage) backend, with emphasis on the unauthenticated guest-join flow, two-step presigned-URL upload, subscription/tier enforcement, Stripe webhook handling, the same-day-edit video worker, and the vendor referral flow. Mobile/web clients were scanned for markers but the backend carries nearly all the risk.

---

## Tech Debt

**Duplicate `generateReferralCode` / `generateGuestToken` helpers:**
- Issue: `generateReferralCode` is defined identically in both `artifacts/api-server/src/routes/billing.ts` (line 23) and `artifacts/api-server/src/routes/vendors.ts` (line 10). Token-generation helpers (`crypto.randomBytes(...).toString("hex")`) are scattered across `guests.ts`, `events.ts`, `billing.ts`, `vendors.ts`.
- Files: `artifacts/api-server/src/routes/billing.ts`, `artifacts/api-server/src/routes/vendors.ts`, `artifacts/api-server/src/routes/guests.ts`, `artifacts/api-server/src/routes/events.ts`
- Impact: Two code paths can create vendor referral codes with subtly different behavior (see "Two divergent vendor-code creation paths" below). Drift risk.
- Fix approach: Extract a shared `lib/codes.ts` / `lib/tokens.ts` and call from a single place.

**Two divergent vendor-code creation paths:**
- Issue: `vendors.ts` `POST /vendors/register` creates a referral code via `referralCodesTable` (the alias) and persists `benefitDescription`. `billing.ts` `activateSubscription` independently creates a code via `vendorCodesTable` with no `benefitDescription` and a hardcoded `videoDurationCapSeconds: 180`. Both guard with `if (!existingCode)`, but which path runs first depends on webhook timing vs. user action.
- Files: `artifacts/api-server/src/routes/vendors.ts:78-93`, `artifacts/api-server/src/routes/billing.ts:289-301`
- Impact: A vendor who registers business details after the webhook fires will have a code lacking `benefitDescription`; the register endpoint will then short-circuit on `existingCode` and never backfill the description. Inconsistent vendor metadata.
- Fix approach: Single code-provisioning function; backfill `benefitDescription` on register even when a code already exists.

**`referralCodesTable` is an alias of `vendorCodesTable`:**
- Issue: `lib/db/src/schema/index.ts:113` exports `referralCodesTable = vendorCodesTable`. Same physical table referenced under two names across the codebase.
- Files: `lib/db/src/schema/index.ts:90-119`
- Impact: Obscures that `vendors.ts` and `billing.ts`/`guests.ts` touch the same rows. Future maintainers may assume two tables and reason incorrectly about uniqueness/migrations.
- Fix approach: Pick one name and use it everywhere, or document the alias loudly at every import site.

**Tier caps duplicated between code and DB defaults:**
- Issue: Video duration/quality caps live in `lib/tier.ts` (`TIER_CAPS`) but are also hardcoded as column defaults in `videoJobsTable` (`durationCapSeconds` default 60, `qualityCap` default "720p", `maxResolutionPx` default 1280) and as the literal `180` in two referral-code creation sites.
- Files: `artifacts/api-server/src/lib/tier.ts:4-23`, `lib/db/src/schema/index.ts:213-216`, `artifacts/api-server/src/routes/billing.ts:298`, `artifacts/api-server/src/routes/vendors.ts:90`
- Impact: Changing a tier cap requires edits in 3+ places; easy to leave them inconsistent.
- Fix approach: Derive all caps from `TIER_CAPS`; remove magic numbers.

**`process.env` read ad-hoc throughout (no central config):**
- Issue: `REPLIT_DEV_DOMAIN`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `REPLIT_DOMAINS`, `PORT` are read directly at call sites with inline fallbacks (e.g. `?? "http://localhost:3000"`).
- Files: `artifacts/api-server/src/routes/billing.ts:17-21`, `routes/events.ts:28-32`, `routes/vendors.ts:20-24`, `lib/objectStorage.ts:44-71`, `lib/notifications.ts:68-69`, `lib/videoWorker.ts:64-82`
- Impact: No startup validation of required env; misconfiguration surfaces as runtime 500s deep in request handling. `localhost:3000` fallbacks can leak into production share/join URLs and email links.
- Fix approach: Single validated config module loaded at boot; fail fast on missing required vars.

---

## Known Bugs

**Effective-tier check in two endpoints uses different status logic:**
- Symptoms: `events.ts` `POST /events/:eventId/end` treats only `["active","trialing"]` as entitled (correct). But `subscriptions.ts` `GET /subscriptions/me` returns `subscription?.tier ?? "free"` **without** checking `status` — a `past_due` or `cancelled` row still reporting `tier: "pro"` will advertise a 300s cap to the client.
- Files: `artifacts/api-server/src/routes/subscriptions.ts:20-29` vs. `artifacts/api-server/src/routes/events.ts:319-327`
- Trigger: Subscription lapses to `past_due`; client reads `/subscriptions/me` and shows Pro caps even though `/end` will correctly downgrade to free.
- Workaround: Trust the server-side cap chosen at `/end`; treat `/subscriptions/me` as advisory only.

**`activateSubscription` ignores `currentPeriodEnd` from checkout sync:**
- Symptoms: `syncSubscriptionFromStripeEvent` calls `activateSubscription` without `currentPeriodEnd`, so on first activation the row is written with `currentPeriodEnd: null`. It is only later populated by `invoice.payment_succeeded`. If that event is delayed/missed, the period end stays null.
- Files: `artifacts/api-server/src/lib/subscriptionSync.ts:44-50`, `artifacts/api-server/src/routes/billing.ts:261`
- Trigger: `checkout.session.completed` processed but the paired invoice event lost/delayed.
- Workaround: None automatic; relies on subsequent invoice webhook.

**`current_period_end` read via untyped cast (Stripe SDK v22):**
- Symptoms: `billing.ts` PATCH `/billing/subscription` reads `(updated as unknown as Record<string, unknown>)["current_period_end"]`. In Stripe API/SDK versions where `current_period_end` moved onto subscription items, this top-level field may be `undefined`, leaving `currentPeriodEnd` null after a monthly→annual switch.
- Files: `artifacts/api-server/src/routes/billing.ts:382-385`
- Trigger: Annual upgrade with an SDK/API version that omits the top-level field.
- Workaround: Period end is refreshed by the next `invoice.payment_succeeded`.

**Voice-note "chronological" placement uses `createdAt` (server confirm time), not capture time:**
- Symptoms: The video worker computes voice-note delay from `mediaItems[0].createdAt` and each item's `createdAt`. `createdAt` is the DB insert time at the **confirm** step, not when the media was captured. Out-of-order or batched uploads will mis-sync voice overlays.
- Files: `artifacts/api-server/src/lib/videoWorker.ts:371,414`
- Trigger: Guest uploads several items after the fact, or network reordering.
- Workaround: None; there is no client capture-timestamp column in `media_items`.

**Voice-only events produce a 5s black placeholder with no audio overlay:**
- Symptoms: If an event has only voice notes (no photos/videos), `visualClips.length === 0` triggers `makePlaceholderVideo(...Math.min(cap,5))`. The subsequent voice-overlay step uses `-t durationCapSec` but the placeholder is only ~5s, so voice notes beyond 5s are truncated.
- Files: `artifacts/api-server/src/lib/videoWorker.ts:429-441`
- Trigger: Event with voice notes but no visual media.
- Workaround: None.

---

## Security Considerations

**Guest tokens are bearer credentials with no scoping, expiry, or rotation:**
- Risk: A `guestToken` (`crypto.randomBytes(32)` hex, stored in `event_guests.guest_token`) is a permanent bearer token sent in the `X-Guest-Token` header. Anyone who obtains it (shared device, log leak, screenshot of a join response) has indefinite read access to all event media (`GET /storage/objects/*`, `GET /events/:id/media`, `GET /events/:id/video-status`) and can upload media attributed to that guest. There is no expiry, no revocation endpoint, and no per-token rate limiting.
- Files: `artifacts/api-server/src/lib/auth.ts:84-126`, `routes/guests.ts:17-19,94-107`, `routes/storage.ts:30-39,127-133`, `routes/media.ts`
- Current mitigation: 256-bit entropy makes guessing infeasible; tokens are not logged (request logger strips query strings and does not log headers — `app.ts:67-85`).
- Recommendations: Add token expiry tied to event end; add a host-side "remove guest" / revoke path (soft-delete already exists on `event_guests` but no endpoint sets `deletedAt`, and auth lookups do **not** filter `isNull(deletedAt)` — a soft-deleted guest's token still authenticates). Consider scoping tokens to the single `eventId`.

**Soft-deleted guests still authenticate:**
- Risk: `requireGuestAuth` / `optionalAuth` / `optionalGuestAuth` look up `eventGuestsTable` by `guestToken` only, with **no** `isNull(deletedAt)` filter. A revoked/soft-deleted guest retains full access.
- Files: `artifacts/api-server/src/lib/auth.ts:72-76,91-96,115-118`, `routes/storage.ts:32-37,129-132`
- Current mitigation: None — no endpoint currently soft-deletes guests, so it is latent.
- Recommendations: Add `isNull(eventGuestsTable.deletedAt)` to every guest-token lookup before a revoke feature ships.

**Upload confirm step does not verify the object exists or enforce size/type/tier:**
- Risk: `POST /events/:eventId/media` accepts a client-supplied `objectPath`, `fileSizeBytes`, `durationSeconds`, and `mediaType` and inserts a DB row **without** (a) confirming the object was actually PUT to storage, (b) checking the stored object's real size/content-type, or (c) enforcing tier caps on `durationSeconds`. The only validation is `objectPath.startsWith("/objects/")` and a duplicate-path 409 check.
- Files: `artifacts/api-server/src/routes/media.ts:96-198`, `routes/storage.ts:22-70`
- Current mitigation: `request-url` requires auth (Clerk or guest token), so cost-abuse is gated to joined guests; presigned PUT URLs expire in 900s.
- Recommendations: After confirm, HEAD/stat the object to validate it exists and matches the declared size/content-type; reject `mediaType`/`contentType` not in an allowlist (`image/*`, `video/*`, `audio/*`); clamp `durationSeconds`/file size by tier server-side. Note `durationCapSeconds` is applied at compile time in the worker, not at upload — so an unbounded number of large files can be uploaded and stored regardless of tier.

**No file-size limit anywhere on the upload path:**
- Risk: `RequestUploadUrlBody` only enforces `size >= 1` (`lib/api-zod/src/generated/api.ts:537-541`; OpenAPI `lib/api-spec/openapi.yaml:1133-1141` has no `maximum`). The presigned PUT to GCS has no max-size constraint. A guest can upload arbitrarily large files, inflating storage cost and starving the video worker.
- Files: `lib/api-spec/openapi.yaml:1130-1142`, `lib/api-zod/src/generated/api.ts:537-541`, `routes/storage.ts:47-65`
- Current mitigation: None.
- Recommendations: Add a `maximum` to the OpenAPI `size`, regenerate Zod, and enforce a max-content-length condition on the signed PUT URL.

**`contentType` from the request is never used to constrain the signed URL:**
- Risk: `getObjectEntityUploadURL()` signs a PUT URL with no content-type binding; the client's declared `contentType` is echoed back in metadata but not enforced. A guest can upload any bytes (e.g. an executable) to the private bucket.
- Files: `artifacts/api-server/src/lib/objectStorage.ts:109-129`, `routes/storage.ts:54-65`
- Current mitigation: Private objects are only served back through the ACL-checked `GET /storage/objects/*`.
- Recommendations: Bind content-type to the signed URL; validate against an allowlist.

**Object ACL framework is effectively a no-op:**
- Risk: `objectAcl.ts` defines an ACL system, but `ObjectAccessGroupType` is an empty enum and `createObjectAccessGroup` throws for any group type. Uploaded objects never get an ACL policy set (the confirm path does not call `trySetObjectEntityAclPolicy`), so `canAccessObject` would return `false` for all private objects. The real access control is the DB ownership check in `storage.ts` (`media_items` → `event` → host/guest), not the ACL layer.
- Files: `artifacts/api-server/src/lib/objectAcl.ts:13,58-68,97-137`, `routes/storage.ts:144-172`
- Current mitigation: The `GET /storage/objects/*` handler bypasses ACL and does its own event-ownership check — which is correct and sufficient today.
- Recommendations: Either remove the dead ACL scaffolding to avoid confusion, or wire it up. As-is it is misleading dead code that looks like security.

**Compiled videos are served via a 7-day signed GCS GET URL embedded in emails:**
- Risk: `uploadVideoToStorage` mints a `GET` signed URL valid for 7 days and stores it as `videoUrl`, then emails it to all guests and the host. Anyone with the email link (forwarded, leaked) can watch/download with no auth for 7 days.
- Files: `artifacts/api-server/src/lib/videoWorker.ts:94-100,453-464`, `lib/notifications.ts:176,319`
- Current mitigation: Long random object name; 7-day expiry.
- Recommendations: Acceptable for "share with guests" UX, but document it; consider serving through the authenticated `/storage/objects/*` route for in-app playback and reserving the signed URL for email only.

**Stripe webhook signature handled by `stripe-replit-sync`; secondary parse is unverified:**
- Risk: `app.ts` first calls `WebhookHandlers.processWebhook` (which validates the signature via `stripe-replit-sync`), then **independently** `JSON.parse`s the raw body and runs `syncSubscriptionFromStripeEvent` on it. The second path trusts the body after the first validated it, which is fine **only** because the first call throws on bad signatures before the parse. If the first call's validation is ever made non-throwing or reordered, the app-table sync would process unsigned input.
- Files: `artifacts/api-server/src/app.ts:40-55`, `lib/webhookHandlers.ts`, `lib/stripeClient.ts:59-71`
- Current mitigation: Order is correct today; `webhookSecret` defaults to `""` if the connector omits it (`stripeClient.ts:69`), which would make signature verification fail closed (good) — but verify that `StripeSync` treats empty secret as "reject", not "skip".
- Recommendations: Confirm `stripe-replit-sync` rejects when `stripeWebhookSecret` is `""`. Consider verifying the signature once and passing the parsed event to both sinks rather than re-parsing.

**No secret values committed; env handling is read-only:**
- Confirmed `.env*` is gitignored (`.gitignore`); secrets are fetched at runtime from the Replit connector API (`stripeClient.ts:22-52`) or env. No hardcoded keys found in source. `RESEND_API_KEY` absence triggers a logged dry-run rather than a failure (`notifications.ts:71-77`).

---

## Performance Bottlenecks

**Video worker is a single-process, single-job-at-a-time DB poller:**
- Problem: `startVideoWorker` polls every 30s and processes **one** pending job per tick (`findFirst` on `status="pending"`). All ffmpeg work runs in-process on the API server. Concurrent events ending together queue serially; each job downloads every media item, transcodes per-clip, then does an N-input `filter_complex` xfade assembly.
- Files: `artifacts/api-server/src/lib/videoWorker.ts:341-355,530-572`
- Cause: No queue/worker separation; in-process `execFile` ffmpeg competes with HTTP request handling for CPU.
- Improvement path: Move to a dedicated worker process/container; allow bounded concurrency; consider a real job queue. At minimum, run ffmpeg off the API event loop's host.

**Job claim is racy across multiple API instances:**
- Problem: `pollAndProcess` uses an in-memory `isRunning` guard, which only serializes within one process. `processVideoJob` does claim atomically (`UPDATE ... WHERE status='pending' RETURNING`), which is correct — but the stuck-job reset (`UPDATE status='failed' WHERE status='processing' AND startedAt < threshold`) could fail a job that another instance is actively processing if clocks/timeouts disagree.
- Files: `artifacts/api-server/src/lib/videoWorker.ts:528-546`
- Cause: Timeout-based reaping with no heartbeat.
- Improvement path: Add a heartbeat/`updatedAt` touch during processing and reap based on that.

**N+1 queries on event listing and notification fan-out:**
- Problem: `GET /events` runs `getEventCounts` (2 queries) per event via `Promise.all` — O(2N) round-trips. Notification dispatch loads all guests and emails them one HTTP call each.
- Files: `artifacts/api-server/src/routes/events.ts:117-122,34-57`, `lib/notifications.ts:106-129`
- Cause: Per-row aggregation instead of grouped queries.
- Improvement path: Single grouped `COUNT ... GROUP BY event_id`. Batch Expo push (already batched into one request) — but Resend emails are sent individually with no rate limiting; large guest lists could hit Resend rate limits.

**ffmpeg loads whole files into memory:**
- Problem: `downloadMediaToTmp` does `file.download()` into a Buffer then `writeFile`; `uploadVideoToStorage` does `readFile` of the whole MP4 into a Buffer before PUT. Large videos can spike memory.
- Files: `artifacts/api-server/src/lib/videoWorker.ts:63-101`
- Improvement path: Stream to/from disk.

---

## Fragile Areas

**Video worker ffmpeg `filter_complex` graph construction:**
- Files: `artifacts/api-server/src/lib/videoWorker.ts:220-325`
- Why fragile: Hand-built xfade/acrossfade filter strings with computed `timeOffset` per clip; an off-by-one in offsets, a clip with duration `< XFADE_DUR` (0.5s), or a mismatched stream count silently corrupts output or makes ffmpeg error. `probeDuration` falls back to `2` on parse failure, masking bad inputs.
- Safe modification: Add unit coverage for the filter-graph builder with known clip sets; validate each clip's duration `> XFADE_DUR` before chaining.
- Test coverage: None.

**Stripe event-object field access via string indexing + `as` casts:**
- Files: `artifacts/api-server/src/lib/subscriptionSync.ts:22-83`, `billing.ts:382-385`
- Why fragile: `obj["metadata"]`, `obj["subscription"]`, `lines?.data?.[0]?.period?.end`, and the `current_period_end` cast all assume a Stripe payload shape with no schema validation. Stripe API version changes silently break these.
- Safe modification: Validate webhook payloads against typed Stripe SDK event types; pin the Stripe API version explicitly.
- Test coverage: `subscriptionSync.test.ts` exists (see below) but covers a subset.

**`activateSubscription` advisory-lock concurrency fix (task-22):**
- Files: `artifacts/api-server/src/routes/billing.ts:229-304`
- Why fragile: Concurrent duplicate `checkout.session.completed` deliveries are serialized with `pg_advisory_xact_lock(hashtext(userId))`. This correctly prevents two active rows **for the same user**, but: (1) `hashtext` is 32-bit — collisions across different users would needlessly serialize but not corrupt; (2) the vendor-flag/code creation block (lines 279-303) runs **outside** the locked transaction, so two concurrent vendor activations could still race to `insert vendorCodes` — mitigated only by the `if (!existingCode)` read, which is itself not transactional and can double-insert (the `code` column is `unique`, so the loser throws and the webhook is logged-but-swallowed in `app.ts`).
- Safe modification: Move vendor-flag/code provisioning inside the advisory-locked transaction, or rely on the unique constraint with an upsert.
- Test coverage: `billing.activateSubscription.test.ts` exists; verify it exercises the concurrent path.

**Express 5 `req.params` typing footgun:**
- Files: every route using `String(req.params.x)` (e.g. `events.ts`, `media.ts`); `storage.ts:80-81,141-142` handle the wildcard `string | string[]` case.
- Why fragile: Documented in `replit.md` Gotchas. Forgetting `String(...)` passes `string[]` to Drizzle `eq()`. `media.ts` `req.query.guestId as string` is cast without validation — an array query param (`?guestId=a&guestId=b`) becomes `string[]` and could break the `eq()` filter.
- Safe modification: Centralize param coercion/validation (zod) at route entry.

**`escapeHtml` does not escape `videoUrl` in email href attributes:**
- Files: `artifacts/api-server/src/lib/notifications.ts:176,258,319` — `${opts.videoUrl}` is interpolated into `href="..."` un-escaped, while text fields use `escapeHtml`.
- Why fragile: `videoUrl` is a server-generated signed GCS URL today (low risk), but if a video URL ever becomes attacker-influenced, it is an HTML-injection vector. `escapeHtml` also omits `'` (single quote).
- Safe modification: URL-encode/validate `videoUrl`; escape single quotes.

---

## Scaling Limits

**Single API process owns HTTP + video transcoding + polling:**
- Current capacity: One in-process ffmpeg job at a time; 30s poll latency before a job starts.
- Limit: CPU-bound transcoding blocks/degrades HTTP latency under load; throughput is ~1 event video per (job duration) serially.
- Scaling path: Separate worker tier, job queue, horizontal worker scaling. The DB-claim pattern already supports multiple workers if the in-memory `isRunning` guard and timeout reaper are made multi-instance safe.

**Resend email sent per-recipient with no batching/rate control:**
- Current capacity: One Resend HTTP call per guest with an email, fired via `Promise.allSettled`.
- Limit: Large guest lists (hundreds) burst-call Resend and may hit provider rate limits; failures are logged but not retried.
- Scaling path: Batch sends / use Resend batch API; add retry with backoff and a dead-letter log.

**Notification delivery is fire-and-forget with no retry or idempotency:**
- Current capacity: `Promise.allSettled` over push/email; failures are logged only.
- Limit: A transient Expo/Resend outage permanently drops notifications for that job — there is no per-recipient delivery record or retry. Re-running the job would re-notify everyone (no idempotency key).
- Scaling path: Persist per-recipient notification status; retry failed deliveries; dedupe.

---

## Dependencies at Risk

**`stripe-replit-sync` (v1.0.0) — Replit-specific, single-source:**
- Risk: Owns webhook validation, `stripe.*` schema migrations, backfill, and managed-webhook registration. v1.0.0 with limited ecosystem; tightly couples billing to the Replit platform.
- Impact: A break or abandonment forces reimplementing signature verification, the `stripe.products`/`stripe.prices` tables that `billing.ts` SQL-queries directly, and webhook registration.
- Migration plan: Wrap behind an interface; the raw SQL in `findPriceIdForTier`/`/billing/prices` (`billing.ts:71-223`) reads `stripe.products`/`stripe.prices` directly — these would need a replacement source.

**`@replit/connectors-sdk` / Replit sidecar for storage + Stripe creds:**
- Risk: Object storage signing (`http://127.0.0.1:1106`) and Stripe credential fetch (`REPLIT_CONNECTORS_HOSTNAME`) assume the Replit runtime. Not portable off-platform.
- Files: `artifacts/api-server/src/lib/objectStorage.ts:12,230-267`, `lib/videoWorker.ts:22,44-61`, `lib/stripeClient.ts:8-52`
- Impact: Cannot run/test storage or billing locally without Replit; hard dependency on the sidecar being up.
- Migration plan: Abstract the signing/credential providers behind interfaces with a local (S3/GCS-direct) implementation.

**Stripe SDK v22 with unpinned API version:**
- Risk: `new Stripe(secretKey)` with no `apiVersion` pin (`stripeClient.ts:56`); `current_period_end` accessed via cast suggests SDK-shape volatility.
- Migration plan: Pin `apiVersion`; replace casts with typed accessors.

---

## Missing Critical Features

**No host-side guest revocation / removal:**
- Problem: `event_guests.deletedAt` exists but no endpoint sets it, and auth lookups ignore it. A host cannot kick a guest or invalidate a leaked guest token.
- Blocks: Incident response for a compromised event link/token.

**No rate limiting anywhere:**
- Problem: No rate-limit middleware on `POST /guests/join`, `POST /storage/uploads/request-url`, or any auth path. `guests/join` only needs a valid public `shareToken`.
- Blocks: Abuse protection — a leaked share link allows unlimited guest-record and upload-URL creation.

**No upload object lifecycle / orphan cleanup:**
- Problem: Presigned PUT can succeed without a confirm POST, leaving orphaned objects in the private bucket with no `media_items` row (and thus unservable and uncleaned).
- Blocks: Storage cost control; no reaper for objects without a DB record.

**No content moderation / virus scanning on guest uploads:**
- Problem: Unauthenticated guests upload arbitrary bytes that are later served to all attendees and the host.
- Blocks: Abuse/illegal-content handling.

---

## Test Coverage Gaps

**Only two backend test files exist:**
- `artifacts/api-server/src/lib/subscriptionSync.test.ts`
- `artifacts/api-server/src/routes/billing.activateSubscription.test.ts`
- There is **no** test runner configured in the API server (`package.json` has no `test` script per repo scripts), no CI test step, and no client-side tests. Coverage is effectively limited to subscription activation/sync.

**Untested high-risk areas (priority High):**
- Guest auth & access control (`lib/auth.ts`, `routes/storage.ts` ownership checks, `routes/media.ts` 403 paths). Risk: a regression silently exposes another event's media.
- Two-step upload validation (`routes/storage.ts`, `routes/media.ts` — objectPath prefix check, duplicate-path 409, missing existence/size/type checks). Risk: upload-flow regressions ship unnoticed.
- Video worker (`lib/videoWorker.ts` — filter-graph builder, voice-only/empty-media branches, duration capping, job claim/reaper). Risk: corrupt or empty videos in production; the most complex untested code in the repo.
- Tier enforcement & vendor-benefit upgrade at `/events/:id/end` (`routes/events.ts:319-360`). Risk: wrong caps applied; revenue leakage or under-delivery.
- Vendor referral flow (`routes/vendors.ts` vs `billing.ts` divergence; lapsed-vendor code deactivation in `cancelSubscription`). Risk: lapsed vendors keep granting benefits, or codes lose metadata.

**Untested medium-risk areas (priority Medium):**
- Stripe webhook ordering / signature failure paths (`app.ts:21-63`).
- Notification fan-out partial-failure handling (`lib/notifications.ts`).
- Email template HTML rendering / escaping (`lib/notifications.ts`).

---

*Concerns audit: 2026-06-28*
