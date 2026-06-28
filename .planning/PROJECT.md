# Memento

## What This Is

Memento is a shared event-media platform for weddings, parties, and events. Guests join via a link/QR code (no account required) and capture photos, videos, and voice notes that are automatically pooled; when the host ends the event, Memento compiles a "same-day edit" highlight video and delivers it to everyone by push notification and email. Hosts and vendors manage events through web and mobile apps; monetization is tiered (free / pro / vendor) via Stripe.

## Core Value

When an event ends, every guest receives a polished same-day-edit video built from the media they all captured together — that delivery must work reliably.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from the existing codebase (see .planning/codebase/). -->

- ✓ Hosts create events and get a shareable link + QR code — existing
- ✓ Guests join unauthenticated via share token and receive a `guestToken` (X-Guest-Token) — existing
- ✓ Two-step presigned-URL media upload (photos, videos, voice notes) direct to object storage — existing
- ✓ Event-end triggers same-day-edit video compilation (in-process ffmpeg worker) — existing
- ✓ Push (Expo) + email (Resend) notification fan-out when the video is ready — existing
- ✓ Subscription tiers with video duration caps (free 60s / pro 300s / vendor 180s) via Stripe — existing
- ✓ Vendor referral codes: guests joining with a vendor code get the vendor cap + benefit flag — existing
- ✓ Clerk authentication for hosts/vendors with JIT user provisioning — existing
- ✓ Spec-first codegen: OpenAPI + Drizzle schema drive generated React Query hooks and Zod schemas — existing
- ✓ Web host dashboard + guest join/playback (Vite SPA) and Expo mobile capture app — existing

### Active

<!-- This milestone: ship next features. Focused scope — one high-leverage vertical slice per theme. -->

- [ ] Same-day-edit video upgrades — host preview/approve-before-send and re-generate, plus correct voice-note timing
- [ ] Host dashboard & control — live upload monitoring and guest management (remove/revoke a leaked guest token)
- [ ] Guest capture & gallery — real-time shared event gallery guests can browse during the event
- [ ] Monetization & vendor growth — unified vendor-code provisioning + a vendor referral/benefits view

### Out of Scope

<!-- Explicit boundaries for this milestone. -->

- Content moderation / virus scanning of uploads — important but a separate safety milestone; not a "feature" slice
- Off-Replit portability (S3/GCS-direct, external job queue) — infrastructure refactor, not user-facing scope here
- Real-time chat between guests — outside the capture/gallery core value
- Net-new subscription tiers — this milestone polishes existing tiers, doesn't add pricing SKUs

## Context

- **Brownfield, working product.** Full codebase map in `.planning/codebase/` (STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS).
- **Spec-first discipline:** all API contracts live in `lib/api-spec/openapi.yaml`; DB schema in `lib/db/src/schema/index.ts`. Generated clients (`lib/api-client-react/`, `lib/api-zod/`) are never hand-edited — change the spec and run `pnpm --filter @workspace/api-spec run codegen`.
- **Known gaps that shape this milestone (from CONCERNS.md):**
  - Guest tokens are permanent bearer credentials; there is **no host-side revoke/remove-guest endpoint**, and auth lookups ignore `deletedAt` — relevant to the Host control slice.
  - Voice-note placement in the video uses server confirm-time, not capture time — relevant to the video slice.
  - Two divergent vendor-code creation paths (`vendors.ts` vs `billing.ts`) with inconsistent metadata — relevant to the monetization slice.
  - Upload confirm step does not verify object existence/size/type or enforce tier caps — adjacent risk to touch carefully when extending uploads.
- **Test coverage is thin:** only 2 backend test files, no test runner wired in the API server, no CI test step. New high-risk code (auth/revoke, video preview, gallery) should ship with tests.
- **Single-process video worker:** ffmpeg runs in-process on the API server, one job at a time, 30s poll. Acceptable for now; preview/re-generate must not assume a separate worker tier.

## Constraints

- **Tech stack**: pnpm workspaces, Node 24, TypeScript 5.9, Express 5, Drizzle/Postgres, Clerk, Stripe, Replit Object Storage, Expo (React Native), Vite/React. New work fits the existing monorepo and codegen pipeline.
- **Platform**: Runtime assumes the Replit sidecar for object-storage signing and Stripe credentials (`http://127.0.0.1:1106`, connectors API). Local-only testing of storage/billing is limited.
- **Codegen**: Adding/altering endpoints means editing `openapi.yaml` first, regenerating, then restarting the API server. DB changes go through `lib/db/src/schema/index.ts` + `pnpm --filter @workspace/db run push`.
- **Security**: Guest flows are unauthenticated by design — any new guest-facing endpoint must respect the `X-Guest-Token` model and filter soft-deleted records once revocation ships.
- **Express 5 footgun**: `req.params.*` is `string | string[]` — always wrap with `String(...)` before Drizzle `eq()`.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Map the codebase before initializing the project | Brownfield repo; planning agents need accurate architecture/concerns context | ✓ Good — full map in `.planning/codebase/` |
| Scope this milestone as one focused vertical slice per chosen theme | User selected all four themes but a focused 3–5 phase scope; depth-per-theme beats breadth | — Pending |
| Structure phases as Vertical MVP slices across API + clients | User chose "both / full-stack slices"; each phase delivers an end-to-end user capability | — Pending |
| Treat guest-revocation as the anchor of the Host-control slice | It is both a requested feature and a known security gap (no revoke endpoint, auth ignores `deletedAt`) | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-28 after initialization*
