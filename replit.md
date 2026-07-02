# Momento

A shared event media platform for weddings, parties, and events — guests capture photos, videos, and voice notes that are automatically distributed to everyone, capped with a "same-day edit" video delivered by push notification and email when the event ends.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (auto-provisioned)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + Clerk authentication (Replit-managed)
- DB: PostgreSQL + Drizzle ORM
- Storage: Replit Object Storage (GCS-backed presigned URL uploads)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/index.ts` — all DB table definitions (Drizzle ORM)
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit manually)
- `lib/api-zod/src/generated/` — generated Zod schemas (do not edit manually)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/auth.ts` — Clerk + guest token auth middleware
- `artifacts/api-server/src/lib/tier.ts` — subscription tier constants and video duration caps

## Architecture decisions

- Guest join is unauthenticated — guests receive a `guestToken` (stored in `event_guests.guest_token`) used in `X-Guest-Token` header for subsequent uploads. No account required.
- Subscription tiers control video duration caps: free=60s, pro=300s, vendor=180s. Defined in `lib/tier.ts`.
- Vendors get a referral code; guests who join with `?ref=CODE` get `vendor_benefit=true` on their `event_guest` record and a 180s video cap.
- OpenAPI spec namespaces: orval `indexFiles: false` on the zod target prevents regeneration of `lib/api-zod/src/index.ts` — do not remove that flag or the types/api name conflict returns.
- Media uploads use a two-step presigned URL flow: client POSTs metadata to `/api/storage/uploads/request-url`, receives a GCS URL, PUTs the file directly, then POSTs to `/api/events/:id/media` to confirm and create the DB record.

## Product

- **Hosts** create events, get a shareable link + QR code, and monitor uploads
- **Guests** join via link/QR (no account required), upload photos/videos/voice notes
- **Event end** triggers a video compilation job (same-day edit), which notifies all guests via push + email
- **Monetization**: free (60s video), pro (5min video), vendor (referral codes + 3min for their clients)

## User preferences

_Populate as you build._

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after editing `openapi.yaml`, then restart the API server workflow
- `pnpm --filter @workspace/db run push` applies schema changes to the development DB — do this after editing `lib/db/src/schema/index.ts`
- `lib/api-zod/src/index.ts` must only export from `./generated/api` — the types folder creates name conflicts. The `indexFiles: false` flag in `orval.config.ts` prevents regeneration.
- Express 5 types `req.params.*` as `string | string[]` — always cast with `String(req.params.foo)` before passing to Drizzle `eq()`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
