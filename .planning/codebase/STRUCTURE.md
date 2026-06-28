# Codebase Structure

**Analysis Date:** 2026-06-28

## Directory Layout

```text
memento/                          # pnpm-workspace monorepo root
├── pnpm-workspace.yaml           # workspace globs, catalog versions, security policy
├── package.json                  # root scripts (typecheck, build) + tooling
├── tsconfig.base.json            # shared compiler options (customConditions: ["workspace"])
├── tsconfig.json                 # root project references
├── replit.md                     # architecture notes / source-of-truth map
├── .agents/                      # agent memory (overview, schema field notes)
├── scripts/                      # workspace utility scripts (@workspace/scripts)
│
├── lib/                          # shared, non-deployed packages (@workspace/*)
│   ├── api-spec/                 # SOURCE OF TRUTH for the API
│   │   ├── openapi.yaml          # the OpenAPI contract — edit here
│   │   └── orval.config.ts       # drives both codegen targets
│   ├── api-client-react/         # @workspace/api-client-react
│   │   └── src/
│   │       ├── custom-fetch.ts   # hand-written fetch mutator (editable)
│   │       ├── index.ts          # re-exports generated + setBaseUrl/setAuthTokenGetter
│   │       └── generated/        # GENERATED — do not edit (api.ts, api.schemas.ts)
│   ├── api-zod/                  # @workspace/api-zod
│   │   └── src/
│   │       ├── index.ts          # exports ONLY ./generated/api (indexFiles:false)
│   │       └── generated/        # GENERATED — do not edit (api.ts)
│   └── db/                       # @workspace/db
│       ├── drizzle.config.ts     # drizzle-kit config (schema path, dialect)
│       └── src/
│           ├── index.ts          # pool + `db` Drizzle client + re-export schema
│           └── schema/index.ts   # SOURCE OF TRUTH for all tables/enums
│
└── artifacts/                    # deployable apps (each its own .replit-artifact)
    ├── api-server/               # @workspace/api-server (Express 5)
    │   ├── build.mjs             # esbuild ESM bundle config
    │   └── src/
    │       ├── index.ts          # entry: Stripe init, listen, start worker
    │       ├── app.ts            # Express app, middleware, webhook, router mount
    │       ├── routes/           # one router file per resource
    │       ├── middlewares/      # clerkProxyMiddleware
    │       └── lib/              # auth, tier, storage, notifications, videoWorker, …
    ├── memento-mobile/           # @workspace/memento-mobile (Expo / RN)
    │   ├── app/                  # expo-router file-based routes
    │   ├── components/ context/ hooks/ constants/
    │   └── server/               # static landing-page server for web build
    ├── memento-web/              # @workspace/memento-web (Vite / React SPA)
    │   └── src/
    │       ├── App.tsx           # wouter routes + ClerkProvider
    │       ├── pages/            # route pages (host/, event-join, video-playback, vendor)
    │       ├── components/       # PlanPickerDialog + ui/ (shadcn primitives)
    │       ├── hooks/ lib/
    └── mockup-sandbox/           # @workspace/mockup-sandbox (design playground, no API)
```

## Directory Purposes

**`lib/` (shared packages):**
- Purpose: Non-deployed packages consumed by apps via `workspace:*`
- Contains: API spec, generated clients, Zod schemas, DB schema/client
- Key files: `lib/api-spec/openapi.yaml`, `lib/db/src/schema/index.ts`

**`artifacts/` (apps):**
- Purpose: Independently deployable applications (each has `.replit-artifact`)
- Contains: api-server, memento-mobile, memento-web, mockup-sandbox

**`artifacts/api-server/src/routes/`:**
- Purpose: Express route handlers, one file per resource, aggregated by `index.ts`
- Contains: `health.ts`, `storage.ts`, `users.ts`, `events.ts`, `guests.ts`, `media.ts`, `subscriptions.ts`, `vendors.ts`, `billing.ts`
- Key files: `index.ts` (mount order)

**`artifacts/api-server/src/lib/`:**
- Purpose: Server-side business logic and integrations
- Contains: `auth.ts`, `tier.ts`, `objectStorage.ts`, `objectAcl.ts`, `notifications.ts`, `videoWorker.ts`, `subscriptionSync.ts`, `webhookHandlers.ts`, `stripeClient.ts`, `logger.ts`
- Co-located tests: `subscriptionSync.test.ts`, `billing.activateSubscription.test.ts` (in routes/)

**`artifacts/memento-web/src/components/ui/`:**
- Purpose: shadcn/Radix UI primitives (~50 components)
- Generated: scaffolded by shadcn; treated as editable project code

**`artifacts/memento-mobile/app/`:**
- Purpose: expo-router file-based routing
- Key files: `_layout.tsx` (root nav + providers), `(tabs)/` (camera, feed, event, index), `join.tsx`, `onboarding.tsx`, `video.tsx`

## Key File Locations

**Entry Points:**
- `artifacts/api-server/src/index.ts`: API server bootstrap (port 5000)
- `artifacts/memento-web/src/App.tsx`: web SPA root
- `artifacts/memento-mobile/app/_layout.tsx`: mobile root layout (via `expo-router/entry`)

**Configuration:**
- `pnpm-workspace.yaml`: workspace packages, catalog versions, `minimumReleaseAge` security policy
- `tsconfig.base.json`: shared TS options; `customConditions: ["workspace"]`
- `lib/api-spec/orval.config.ts`: codegen targets/output paths
- `lib/db/drizzle.config.ts`: schema path + Postgres dialect
- `artifacts/api-server/build.mjs`: esbuild bundle (externals list)

**Core Logic:**
- `lib/api-spec/openapi.yaml`: API contract (single source of truth)
- `lib/db/src/schema/index.ts`: all tables/enums
- `artifacts/api-server/src/lib/auth.ts`: Clerk + guest-token middleware
- `artifacts/api-server/src/lib/tier.ts`: tier caps
- `artifacts/api-server/src/lib/videoWorker.ts`: same-day-edit compilation

**Testing:**
- `artifacts/api-server/src/lib/subscriptionSync.test.ts`
- `artifacts/api-server/src/routes/billing.activateSubscription.test.ts`
- Runner: Vitest (`pnpm --filter @workspace/api-server run test`)

## Naming Conventions

**Packages:**
- Scoped `@workspace/<name>` (e.g. `@workspace/api-server`, `@workspace/db`); all `private: true`, version `0.0.0`.

**Files:**
- Server routes/libs: `camelCase.ts` (`videoWorker.ts`, `objectStorage.ts`); routes named by resource (`events.ts`).
- Tests: co-located `*.test.ts`.
- Web pages: `kebab-case.tsx` (`event-join.tsx`, `video-playback.tsx`); nested host pages under `pages/host/`.
- Web UI primitives: `kebab-case.tsx` under `components/ui/`; app components `PascalCase.tsx` (`PlanPickerDialog.tsx`).
- Mobile screens: expo-router convention — `lowercase.tsx`, route groups in parens `(tabs)`, dynamic via params; special files `_layout.tsx`, `+not-found.tsx`.

**Database (in `schema/index.ts`):**
- Drizzle exports `camelCaseTable` (e.g. `eventGuestsTable`), Postgres tables `snake_case` (`event_guests`), columns `snake_case`.
- Enums: `nameEnum` export → `snake_case` pg enum (`videoJobStatusEnum` → `video_job_status`).
- Per-table Zod: `insertXSchema` / `selectXSchema`; types `InsertX` / `X`.

**Code style:**
- Functions/vars `camelCase`; types/components `PascalCase`; constants `UPPER_SNAKE_CASE` (`TIER_CAPS`, `POLL_INTERVAL_MS`).
- Path alias `@/` in web and mobile apps; cross-package imports via `@workspace/*`.

## Where to Add New Code

**New API endpoint:**
1. Add the path/schema to `lib/api-spec/openapi.yaml`.
2. Run `pnpm --filter @workspace/api-spec run codegen` (regenerates hooks + zod).
3. Implement the handler in the matching `artifacts/api-server/src/routes/<resource>.ts` (or a new router mounted in `routes/index.ts`).
4. Validate input with the generated `@workspace/api-zod` schema; cast `req.params.*` with `String(...)`.
5. Restart the api-server workflow.

**New DB table / column:**
- Edit `lib/db/src/schema/index.ts` (follow the existing table + `insert/select` schema + type pattern, include `createdAt/updatedAt/deletedAt`).
- Run `pnpm --filter @workspace/db run push`.

**New server-side logic / integration:**
- Add a `camelCase.ts` module under `artifacts/api-server/src/lib/`; co-locate a `*.test.ts`.

**New web page:**
- Add `kebab-case.tsx` under `artifacts/memento-web/src/pages/` (host-only under `pages/host/`), then register a `<Route>` in `artifacts/memento-web/src/App.tsx`.

**New mobile screen:**
- Add a file under `artifacts/memento-mobile/app/` (or `app/(tabs)/` for a tab); wire navigation in `_layout.tsx` if a new stack screen.

**Shared API consumption:**
- Import generated hooks from `@workspace/api-client-react`; never call `fetch` directly. Configure base URL/auth via `setBaseUrl` / `setAuthTokenGetter`.

**Utilities:**
- Web/mobile local helpers: `src/lib/utils.ts` within the app.
- Cross-package scripts: `scripts/src/`.

## Special Directories

**`lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`:**
- Purpose: Orval output (hooks + Zod schemas)
- Generated: Yes (regenerated with `clean: true`)
- Committed: Yes — but never hand-edit

**`artifacts/*/.replit-artifact/`:**
- Purpose: Replit per-artifact deployment metadata
- Generated: Yes (tooling)
- Committed: Yes

**`artifacts/mockup-sandbox/src/.generated/`:**
- Purpose: Generated mockup component registry
- Generated: Yes
- Committed: Yes

**`.agents/memory/`:**
- Purpose: Agent context notes (`memento-overview.md`, `memento-schema-fields.md`)
- Generated: No (curated)
- Committed: Yes

---

*Structure analysis: 2026-06-28*
