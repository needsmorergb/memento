# External Integrations

**Analysis Date:** 2026-06-28

All third-party integrations are Replit-managed where possible (Clerk auth, Stripe payments, Object Storage). There are no external dashboards for Clerk or Stripe — configuration is done via the Replit Auth pane and Integrations tab, and credentials are fetched at runtime through the Replit connectors API / sidecar rather than from committed `.env` secrets.

Note: `lib/integrations/*` is declared as a workspace glob in `pnpm-workspace.yaml` but currently contains no packages. All integration code lives in `artifacts/api-server/src/lib/`.

## APIs & External Services

**Payments (Stripe):**
- Stripe - Subscription billing for Pro/Vendor tiers
  - SDK/Client: `stripe` ^22.3.0 + `stripe-replit-sync` ^1.0.0
  - Client factory: `artifacts/api-server/src/lib/stripeClient.ts` (`getUncachableStripeClient`, `getStripeSync`)
  - Credentials: fetched at runtime from the Replit connectors API (`https://${REPLIT_CONNECTORS_HOSTNAME}/api/v2/connection?connector_names=stripe`) using the `X_REPLIT_TOKEN` header derived from `REPL_IDENTITY` / `WEB_REPL_RENEWAL`. Secret key and webhook secret are never stored in env vars directly.
  - Routes: `src/routes/billing.ts` — `POST /api/billing/checkout` (Checkout Session), `POST /api/billing/portal` (Customer Portal), `GET /api/billing/prices`, `PATCH /api/billing/subscription` (monthly→annual interval switch with proration)
  - Price/product lookup: raw SQL against the `stripe.products` / `stripe.prices` tables synced into Postgres by `stripe-replit-sync` (matched via `metadata->>'tier'`)

**Push Notifications (Expo):**
- Expo Push Service - Same-day-edit "video ready" notifications to guests
  - Endpoint: `https://exp.host/--/api/v2/push/send` (`src/lib/notifications.ts` `sendPushNotifications`)
  - Auth: none (Expo push tokens are the bearer); tokens validated to start with `ExponentPushToken`
  - Token source: stored on `event_guests.push_token`; captured client-side via `expo-notifications` in the mobile app

**Email (Resend):**
- Resend - Transactional email (guest + host "edit ready" emails)
  - Endpoint: `https://api.resend.com/emails` (`src/lib/notifications.ts` `sendEmail`)
  - Auth: `Authorization: Bearer ${RESEND_API_KEY}`
  - From: `RESEND_FROM_EMAIL` (default `Memento <no-reply@memento.app>`)
  - Graceful degradation: if `RESEND_API_KEY` is unset, emails are logged as `[email dry-run]` and skipped (non-fatal)
  - HTML templates are inlined in `src/lib/notifications.ts` (`buildGuestEmailHtml`, `buildHostEmailHtml`)

## Data Storage

**Databases:**
- PostgreSQL (Replit-provisioned)
  - Connection: `DATABASE_URL` env var (required; hard-fails at import)
  - Client: `pg` ^8.22.0 `Pool` wrapped by Drizzle ORM `drizzle-orm/node-postgres` (`lib/db/src/index.ts`)
  - Schema: `lib/db/src/schema/index.ts` (single source of truth); push via `drizzle-kit push`
  - Additional schema: `stripe.*` tables (products, prices, subscriptions, etc.) created and synced by `stripe-replit-sync` `runMigrations` at server boot (`src/index.ts`)

**File Storage:**
- Replit Object Storage (GCS-backed)
  - Client: `@google-cloud/storage` `Storage` configured with an `external_account` credential whose `token_url`/`credential_source` point at the Replit sidecar `http://127.0.0.1:1106` (`src/lib/objectStorage.ts`)
  - Presigned URLs: obtained from the sidecar `POST /object-storage/signed-object-url` (not GCS native signing) — used for both upload (PUT, 15 min TTL) and download (GET, 7-day TTL for generated videos)
  - Buckets/paths: `PRIVATE_OBJECT_DIR` (private media + generated videos), `PUBLIC_OBJECT_SEARCH_PATHS` (comma-separated public search paths)
  - ACL: custom policy stored in object metadata (`src/lib/objectAcl.ts`), enforced by `ObjectStorageService.canAccessObjectEntity`
  - Upload flow (two-step presigned): client `POST /api/storage/uploads/request-url` → receives GCS-style PUT URL → PUTs file directly → `POST /api/events/:id/media` confirms and writes the DB record

**Caching:**
- None (no Redis/Memcached). HTTP `Cache-Control` headers are set on object downloads (`src/lib/objectStorage.ts`); video worker uses DB polling, not a queue.

## Authentication & Identity

**Auth Provider:**
- Clerk (Replit-managed — no external Clerk dashboard; configured via the Replit Auth pane)
  - Server: `@clerk/express` `clerkMiddleware` + `getAuth` (`src/app.ts`, `src/lib/auth.ts`)
  - Web: `@clerk/react` ^6.11.1 (+ `@clerk/themes`)
  - Mobile: `@clerk/expo` ^3.6.2 with token cache backed by `expo-secure-store`
  - Keys: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
  - Frontend API proxy: `src/middlewares/clerkProxyMiddleware.ts` proxies `/api/__clerk` → `https://frontend-api.clerk.dev` (production only) so Clerk works on custom/.replit.app domains without CNAME setup. Mounted BEFORE `express.json()`.
  - JIT user provisioning: `requireAuth` resolves a Clerk `userId` to a row in `users` (keyed on `clerk_id`), creating it on first request from `sessionClaims` email/name.

**Guest auth (custom, no account):**
- Guests join unauthenticated and receive a `guestToken` (stored in `event_guests.guest_token`), passed in the `X-Guest-Token` header for subsequent uploads.
- Middleware: `optionalAuth`, `optionalGuestAuth`, `requireGuestAuth` in `src/lib/auth.ts`
- Vendor referral: guests joining with `?ref=CODE` get `vendor_benefit=true` and a 180s video cap (`vendor_codes` table)

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry/Datadog). Errors are logged via pino and, for video jobs, persisted to `video_jobs.error_message`.

**Logs:**
- pino structured JSON logging (`src/lib/logger.ts`), `pino-http` request logging in `src/app.ts` (req serialized to id/method/url, res to statusCode). `LOG_LEVEL` env controls verbosity; `pino-pretty` transport for dev.

## CI/CD & Deployment

**Hosting:**
- Replit Autoscale (`.replit`: `deploymentTarget = "autoscale"`, `router = "application"`). Post-build runs `pnpm store prune`.

**CI Pipeline:**
- No standalone CI service detected (no GitHub Actions workflows). Replit GitHub integration is enabled (`.replit` `integrations = ["github:1.0.0"]`); `postMerge` runs `scripts/post-merge.sh`.

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - Postgres connection (hard-required)
- `PORT` - server port (defaults 5000 via `.replit`)
- `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` - Clerk auth
- `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS` - Object Storage paths
- `REPLIT_CONNECTORS_HOSTNAME` + (`REPL_IDENTITY` | `WEB_REPL_RENEWAL`) - Stripe connector credential fetch
- `REPLIT_DOMAINS` - used to register the Stripe managed webhook URL at boot
- `REPLIT_DEV_DOMAIN` - used to build Checkout success/cancel URLs

**Optional env vars:**
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` - email (dry-run if absent)
- `LOG_LEVEL`, `NODE_ENV`

**Secrets location:**
- No committed secret files. Stripe credentials come from the Replit connectors API at runtime; Clerk/DB/Object-Storage values come from the Replit-managed environment. Mobile stores the Clerk token in device secure storage via `expo-secure-store`.

## Webhooks & Callbacks

**Incoming:**
- `POST /api/stripe/webhook` (`src/app.ts`) - Stripe events. Registered with `express.raw({ type: "application/json" })` BEFORE `express.json()` so the body stays a `Buffer` for signature verification. Processing is two-layer:
  1. `stripe-replit-sync` validates the signature and updates the `stripe.*` tables (`src/lib/webhookHandlers.ts`)
  2. App-level sync into the `subscriptions` table (`src/lib/subscriptionSync.ts`) handling `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.updated`/`deleted` → `activateSubscription` / `updateSubscriptionByCustomer` / `cancelSubscription` in `src/routes/billing.ts`. Concurrent duplicate deliveries are serialized with a Postgres advisory lock (`pg_advisory_xact_lock`).
- The Stripe webhook endpoint is auto-registered at boot via `stripeSync.findOrCreateManagedWebhook(${REPLIT_DOMAINS}/api/stripe/webhook)` (`src/index.ts`).

**Outgoing:**
- Stripe API calls (Checkout Sessions, Customer Portal, subscription retrieve/update) - `src/routes/billing.ts`
- Expo push send - `src/lib/notifications.ts`
- Resend email send - `src/lib/notifications.ts`
- Replit Object Storage sidecar (presigned URL signing, credential/token) - `src/lib/objectStorage.ts`, `src/lib/videoWorker.ts`

---

*Integration audit: 2026-06-28*
