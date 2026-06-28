<!-- refreshed: 2026-06-28 -->
# Architecture

**Analysis Date:** 2026-06-28

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                          │
├──────────────────────┬──────────────────────┬───────────────────────────────┤
│   memento-mobile     │     memento-web      │      mockup-sandbox            │
│  Expo / React Native │   Vite / React SPA   │   Vite design playground      │
│ `artifacts/memento-  │ `artifacts/memento-  │ `artifacts/mockup-sandbox`    │
│  mobile`             │  web`                │   (not wired to API)          │
└──────────┬───────────┴──────────┬───────────┴───────────────────────────────┘
           │   React Query hooks   │   React Query hooks
           ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│             GENERATED CLIENT LAYER  (Orval, do not edit)                      │
│  `lib/api-client-react/src/generated/`  — React Query hooks + customFetch     │
│  `lib/api-zod/src/generated/`           — Zod request/response schemas        │
└──────────────────────────────────┬────────────────────────────────────────────┘
           HTTP  /api/*  (Clerk session cookie OR X-Guest-Token header)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    API SERVER  (Express 5, port 5000)                         │
│  `artifacts/api-server/src/app.ts`  → middleware + router mount               │
│  `artifacts/api-server/src/routes/` → handlers (events, guests, media, …)     │
│  `artifacts/api-server/src/lib/`    → auth, tier, storage, notifications,     │
│                                       videoWorker (in-process polling loop)    │
└──────────┬─────────────────────────────────┬──────────────────────────────────┘
           │ Drizzle ORM                      │ ffmpeg / signed URLs / Expo push
           ▼                                  ▼
┌──────────────────────────────┐   ┌──────────────────────────────────────────┐
│  PostgreSQL  (Drizzle)       │   │  Replit Object Storage (GCS-backed)        │
│ `lib/db/src/schema/index.ts` │   │  presigned PUT/GET via sidecar :1106       │
│  + Stripe-managed schema     │   │  Expo Push API · email · Clerk · Stripe    │
└──────────────────────────────┘   └──────────────────────────────────────────┘
```

## Single Source of Truth (Spec-First Codegen)

The defining architectural pattern is **spec-first, code-generated contracts** across a pnpm-workspace monorepo. There are three authoritative source files; everything else is either generated from them or consumes the generated output:

| Source of Truth | File | Generates / Governs |
|-----------------|------|---------------------|
| API contract | `lib/api-spec/openapi.yaml` | React Query hooks + Zod schemas (via Orval) |
| DB schema | `lib/db/src/schema/index.ts` | Postgres tables (via drizzle-kit push) + `drizzle-zod` types |
| Tier caps | `artifacts/api-server/src/lib/tier.ts` | Video duration/quality limits per subscription |

Codegen command (`lib/api-spec/package.json`): `orval --config ./orval.config.ts`. Config at `lib/api-spec/orval.config.ts` writes two targets — `react-query` into `lib/api-client-react/src/generated/`, and `zod` into `lib/api-zod/src/generated/`. **Never hand-edit files under `generated/`.** After editing `openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` and restart the API server.

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| API spec | OpenAPI contract — single source of truth for all endpoints | `lib/api-spec/openapi.yaml` |
| Orval config | Drives two codegen targets (hooks + zod) | `lib/api-spec/orval.config.ts` |
| Generated hooks | Typed React Query hooks consumed by clients | `lib/api-client-react/src/generated/api.ts` |
| customFetch | Shared fetch wrapper: baseURL + bearer token injection + error mapping | `lib/api-client-react/src/custom-fetch.ts` |
| Generated Zod | Request/response validation schemas | `lib/api-zod/src/generated/api.ts` |
| DB schema | All Drizzle table definitions, enums, insert/select schemas | `lib/db/src/schema/index.ts` |
| DB client | Drizzle pool + `db` export | `lib/db/src/index.ts` |
| Express app | Middleware chain, Stripe webhook (raw body), router mount | `artifacts/api-server/src/app.ts` |
| Server entry | Stripe init, `app.listen`, starts video worker | `artifacts/api-server/src/index.ts` |
| Route aggregator | Mounts all sub-routers under `/api` | `artifacts/api-server/src/routes/index.ts` |
| Auth middleware | Clerk JIT user provisioning + guest-token resolution | `artifacts/api-server/src/lib/auth.ts` |
| Tier caps | Video duration/quality per subscription tier | `artifacts/api-server/src/lib/tier.ts` |
| Object storage | Presigned upload URLs, ACL, download | `artifacts/api-server/src/lib/objectStorage.ts`, `objectAcl.ts` |
| Video worker | In-process DB-polling job runner; ffmpeg compilation | `artifacts/api-server/src/lib/videoWorker.ts` |
| Notifications | Expo push + guest/host emails | `artifacts/api-server/src/lib/notifications.ts` |
| Subscription sync | Mirrors Stripe events into `subscriptions` table | `artifacts/api-server/src/lib/subscriptionSync.ts` |
| Web SPA | Host dashboard + guest join + video playback | `artifacts/memento-web/src/App.tsx` |
| Mobile app | Expo Router guest capture/upload + push handling | `artifacts/memento-mobile/app/_layout.tsx` |

## Pattern Overview

**Overall:** Spec-first code-generated monorepo with a layered Express API and an in-process background worker.

**Key Characteristics:**
- One OpenAPI spec and one Drizzle schema drive all typed contracts; clients never write fetch/validation code by hand.
- Dual authentication model: Clerk sessions for hosts/vendors, opaque guest tokens for unauthenticated guests.
- Two-step presigned-URL media uploads — file bytes never pass through the API server.
- Background video compilation runs as an in-process polling loop in the same Node process (no external queue/broker).
- Soft deletes everywhere (`deletedAt` column; queries filter `isNull(table.deletedAt)`).

## Layers

**Spec / Contract layer:**
- Purpose: Define API and DB contracts once
- Location: `lib/api-spec/`, `lib/db/`
- Contains: `openapi.yaml`, Drizzle schema, Orval config, drizzle.config
- Depends on: nothing (authoritative)
- Used by: codegen → generated libs; API server imports `@workspace/db` directly

**Generated client layer:**
- Purpose: Typed hooks + validation schemas
- Location: `lib/api-client-react/src/generated/`, `lib/api-zod/src/generated/`
- Contains: React Query hooks, `customFetch`, Zod schemas
- Depends on: spec layer (regenerated)
- Used by: `memento-web`, `memento-mobile`

**API layer:**
- Purpose: HTTP handlers, auth, business rules
- Location: `artifacts/api-server/src/routes/`, `artifacts/api-server/src/lib/`
- Contains: Express routers, middleware, storage/notification/worker libs
- Depends on: `@workspace/db`, `@workspace/api-zod`, Clerk, Stripe, Object Storage
- Used by: clients over HTTP

**Client layer:**
- Purpose: UI for hosts (web), guests (mobile/web), vendors (web)
- Location: `artifacts/memento-web/`, `artifacts/memento-mobile/`
- Depends on: `@workspace/api-client-react`, Clerk, React Query
- Used by: end users

## Data Flow

### Two-Step Presigned Media Upload (primary write path)

1. Client requests an upload slot: `POST /api/storage/uploads/request-url` (`artifacts/api-server/src/routes/storage.ts:22`). Caller must have a Clerk session OR a valid `X-Guest-Token`.
2. Server validates body with `RequestUploadUrlBody` (Zod), generates a presigned GCS URL via `ObjectStorageService.getObjectEntityUploadURL()`, returns `{ uploadURL, objectPath }` (`storage.ts:56`).
3. Client `PUT`s the raw file bytes directly to `uploadURL` (bypasses the API server entirely).
4. Client confirms: `POST /api/events/:eventId/media` with `{ objectPath, mediaType, ... }` (`artifacts/api-server/src/routes/media.ts:98`). Server enforces host-or-guest access, validates `objectPath` starts with `/objects/`, rejects reused paths (409), and inserts a `media_items` row.
5. Private playback: `GET /api/storage/objects/*` (`storage.ts:112`) resolves object → `media_items` → event, then allows only the event host or an event guest.

### Guest Auth (unauthenticated join)

1. Guest opens share link/QR → `POST /api/guests/join` with `{ shareToken, displayName, email?, referralCode? }` (`artifacts/api-server/src/routes/guests.ts:24`).
2. Server looks up the event by `shareToken`; if a `referralCode` maps to an active vendor subscription, sets `vendorBenefit=true` and `vendorCodeId` on the guest (`guests.ts:64`).
3. Server generates a 32-byte hex `guestToken`, inserts an `event_guests` row, returns the token (`guests.ts:94`).
4. Client stores the token and sends it as `X-Guest-Token` on every subsequent call. Middleware `requireGuestAuth` / `optionalAuth` / `optionalGuestAuth` resolve it to `req.guestRecord` (`artifacts/api-server/src/lib/auth.ts:55`).
5. Hosts/vendors authenticate via Clerk instead; `requireAuth` does just-in-time user provisioning, inserting a `users` row on first request (`auth.ts:16`).

### Event Lifecycle → Same-Day-Edit Video

1. Host ends event: `POST /api/events/:eventId/end` (`artifacts/api-server/src/routes/events.ts:299`). Sets `status="ended"`, resolves the host's effective tier (lapsed subs treated as `free`), upgrades to `vendor` cap if any vendor-referred guest joined, then inserts a `video_jobs` row (status `pending`) with the resolved duration/quality caps.
2. The in-process video worker polls `video_jobs` every 30s (`artifacts/api-server/src/lib/videoWorker.ts:530`), atomically claims a pending job (`pending → processing`, `videoWorker.ts:342`), and downloads all `media_items` from object storage.
3. ffmpeg pipeline: photos → 2s clips, videos → normalized clips, voice notes → delayed audio overlaid chronologically; clips joined with xfade crossfades, capped to `durationCapSeconds` (`videoWorker.ts:220`, `:286`).
4. Output uploaded to storage via signed PUT; job marked `completed` with `videoUrl` (`videoWorker.ts:455`).
5. Notifications dispatched via `Promise.allSettled`: Expo push to all guests, guest emails, host summary email (`videoWorker.ts:494`, `artifacts/api-server/src/lib/notifications.ts`).
6. Clients poll status: host/guest via `GET /api/events/:eventId/video-status`; email recipients via public `GET /api/events/token/:shareToken/video-status` (`events.ts:553`).

### Stripe Billing Sync

1. Stripe webhook hits `POST /api/stripe/webhook` — registered **before** `express.json()` so the raw body stays a Buffer for signature verification (`artifacts/api-server/src/app.ts:21`).
2. `WebhookHandlers.processWebhook` (stripe-replit-sync) validates and updates `stripe.*` tables; then `syncSubscriptionFromStripeEvent` mirrors into the app's `subscriptions` table (`app.ts:42`, `artifacts/api-server/src/lib/subscriptionSync.ts`).

**State Management:**
- Server is stateless per request; all state in Postgres. Video-worker concurrency guarded by an in-process `isRunning` flag plus an atomic `pending → processing` UPDATE.
- Web client: TanStack Query cache (cleared on Clerk user change, `App.tsx:106`).
- Mobile client: TanStack Query + `EventContext` persisted to AsyncStorage (`artifacts/memento-mobile/context/EventContext.tsx`).

## Key Abstractions

**AuthenticatedRequest:**
- Purpose: Express request augmented with `dbUser?` and `guestRecord?`
- Examples: `artifacts/api-server/src/lib/auth.ts:7`
- Pattern: middleware attaches identity; handlers branch on `isHost` vs `isEventGuest`

**customFetch mutator:**
- Purpose: Single fetch wrapper for all generated hooks — base-URL prefixing, bearer-token injection (`setAuthTokenGetter`), structured `ApiError`
- Examples: `lib/api-client-react/src/custom-fetch.ts`
- Pattern: web uses cookie sessions (no token getter); mobile registers a Clerk token getter (`memento-mobile/app/_layout.tsx:78`)

**TIER_CAPS:**
- Purpose: Declarative tier → {duration, quality, resolution} map
- Examples: `artifacts/api-server/src/lib/tier.ts:4`
- Pattern: `getDurationCap` / `getQualityCap` resolve caps; consumed at event-end

**drizzle-zod table schemas:**
- Purpose: Insert/select Zod schemas derived from each table
- Examples: `lib/db/src/schema/index.ts` (`createInsertSchema`, `createSelectSchema`)
- Pattern: `$inferSelect` / `$inferInsert` types reused across server libs

## Entry Points

**API server:**
- Location: `artifacts/api-server/src/index.ts`
- Triggers: `pnpm --filter @workspace/api-server run dev` (esbuild build → `node dist/index.mjs`), port from `PORT`
- Responsibilities: init Stripe schema/webhook, `app.listen`, `startVideoWorker()`

**Web SPA:**
- Location: `artifacts/memento-web/src/App.tsx` (Vite, wouter routing, ClerkProvider)
- Triggers: `pnpm --filter @workspace/memento-web run dev`

**Mobile app:**
- Location: `artifacts/memento-mobile/app/_layout.tsx` (expo-router entry via `expo-router/entry`)
- Triggers: `pnpm --filter @workspace/memento-mobile run dev`

## Architectural Constraints

- **Threading:** Single Node event loop. The video worker runs **in the same process** as the HTTP server (started in `index.ts:72`). ffmpeg runs as child processes via `execFile`. There is no external queue/broker — a crash loses in-flight jobs (recovered by the stuck-job reset after 30 min, `videoWorker.ts:536`).
- **Global state:** Module-level singletons — `db` pool (`lib/db/src/index.ts`), `ObjectStorageService` instance (`storage.ts:14`), `isRunning` worker flag, and `customFetch`'s `_baseUrl`/`_authTokenGetter` module variables.
- **Generated code is immutable:** Anything under `lib/api-client-react/src/generated/` or `lib/api-zod/src/generated/` is overwritten on codegen. `lib/api-zod/src/index.ts` must only export `./generated/api` (the `indexFiles: false` flag prevents a types/api name clash).
- **Express 5 param typing:** `req.params.*` is `string | string[]`; always wrap with `String(...)` before passing to Drizzle `eq()`.
- **Webhook ordering:** The Stripe webhook route must stay registered before `express.json()` or signature verification breaks.

## Anti-Patterns

### Hand-editing generated client/zod files

**What happens:** Editing files under `lib/api-client-react/src/generated/` or `lib/api-zod/src/generated/`.
**Why it's wrong:** `clean: true` in `orval.config.ts` deletes and regenerates the whole directory on next codegen — edits are silently lost.
**Do this instead:** Change `lib/api-spec/openapi.yaml`, then run `pnpm --filter @workspace/api-spec run codegen`.

### Passing `req.params` straight into Drizzle

**What happens:** `eq(eventsTable.id, req.params.eventId)` under Express 5 types `eventId` as `string | string[]`.
**Why it's wrong:** Type error and potential array-as-value bugs.
**Do this instead:** `eq(eventsTable.id, String(req.params.eventId))` — see `artifacts/api-server/src/routes/events.ts:184`.

### Hard-deleting rows

**What happens:** Issuing `DELETE` against tables that have a `deletedAt` column.
**Why it's wrong:** Every table is soft-delete; reads filter `isNull(table.deletedAt)`. A hard delete breaks referential history and media/event ownership lookups.
**Do this instead:** Set `deletedAt: new Date()` — see event delete at `events.ts:286`.

### Trusting subscription tier without checking status

**What happens:** Reading `subscription.tier` directly to grant caps.
**Why it's wrong:** Lapsed/past-due/cancelled subs would still grant paid caps.
**Do this instead:** Only honor tier when `status` is `active`/`trialing`; otherwise treat as `free` — see `events.ts:323`.

## Error Handling

**Strategy:** Per-route try/catch returning JSON `{ error }` with appropriate status (400/401/403/404/409/500). The video worker wraps each job and writes `status="failed"` + `errorMessage` rather than throwing.

**Patterns:**
- Auth failures: 401 (missing/invalid token), 403 (authenticated but not host/guest).
- Path-reuse on media confirm returns 409 (`media.ts:156`).
- Client side: `customFetch` throws a structured `ApiError` (status, parsed body, message) consumed by React Query (`custom-fetch.ts:174`).
- Stripe sync errors are logged but never fail the webhook (`app.ts:51`).

## Cross-Cutting Concerns

**Logging:** `pino` + `pino-http` request logger (`artifacts/api-server/src/lib/logger.ts`); handlers use `req.log`.
**Validation:** Generated Zod schemas (`@workspace/api-zod`) on inputs; `drizzle-zod` for DB shapes. Note: several routes still validate inline with manual casts rather than the Zod schemas.
**Authentication:** Clerk (`@clerk/express`) with a host-based publishable-key proxy (`clerkProxyMiddleware.ts`); guest tokens via `X-Guest-Token`. JIT user provisioning in `requireAuth`.

---

*Architecture analysis: 2026-06-28*
