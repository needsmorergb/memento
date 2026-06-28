<!-- GSD:project-start source:PROJECT.md -->
## Project

**Olla**

Olla (get-olla.com) is a shared event-media platform for weddings, parties, and events. Guests join via a link/QR code (no account required) and capture photos, videos, and voice notes that are automatically pooled; when the host ends the event, Olla compiles a "same-day edit" highlight video and delivers it to everyone by push notification and email. Hosts and vendors manage events through web and mobile apps; monetization is tiered (free / pro / vendor) via Stripe.

> **Naming note:** The product is **Olla** (domain **get-olla.com**). The codebase still uses the original working name "Memento" in package/directory names (`memento-web`, `memento-mobile`, `@workspace/*`) and config (e.g. `RESEND_FROM_EMAIL`). The `.planning/codebase/*` docs intentionally keep those literal identifiers. A code/asset rebrand is **not** part of this milestone's feature scope (see Out of Scope).

**Core Value:** When an event ends, every guest receives a polished same-day-edit video built from the media they all captured together — that delivery must work reliably.

### Constraints

- **Tech stack**: pnpm workspaces, Node 24, TypeScript 5.9, Express 5, Drizzle/Postgres, Clerk, Stripe, Replit Object Storage, Expo (React Native), Vite/React. New work fits the existing monorepo and codegen pipeline.
- **Platform**: Runtime assumes the Replit sidecar for object-storage signing and Stripe credentials (`http://127.0.0.1:1106`, connectors API). Local-only testing of storage/billing is limited.
- **Codegen**: Adding/altering endpoints means editing `openapi.yaml` first, regenerating, then restarting the API server. DB changes go through `lib/db/src/schema/index.ts` + `pnpm --filter @workspace/db run push`.
- **Security**: Guest flows are unauthenticated by design — any new guest-facing endpoint must respect the `X-Guest-Token` model and filter soft-deleted records once revocation ships.
- **Express 5 footgun**: `req.params.*` is `string | string[]` — always wrap with `String(...)` before Drizzle `eq()`.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript ~5.9.3 - Entire monorepo (API server, web, mobile, libs, scripts). Pinned at the workspace root in `package.json`; `lib/db` and packages inherit it.
- JavaScript (ESM `.mjs`) - Build scripts only: `artifacts/api-server/build.mjs`, `artifacts/memento-mobile/scripts/build.js`, `artifacts/memento-mobile/server/serve.js`
- SQL - Inline raw SQL via Drizzle `sql` template for Stripe price/product lookups (`artifacts/api-server/src/routes/billing.ts`)
- Python 3.11 - Declared as a Replit module in `.replit` but no application code detected; ffmpeg/ffprobe (system binaries) are the actual media toolchain
## Runtime
- Node.js 24 (Replit module `nodejs-24` in `.replit`; replit.md confirms "Node.js 24"). No `.nvmrc` present.
- TypeScript compile target `es2022`, `module: esnext`, `moduleResolution: bundler` (`tsconfig.base.json`)
- API server runs as native ESM with `--enable-source-maps` (`artifacts/api-server/package.json` `start` script)
- pnpm (enforced — root `preinstall` script deletes `package-lock.json`/`yarn.lock` and rejects non-pnpm `npm_config_user_agent`)
- Workspace defined in `pnpm-workspace.yaml`: `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`
- Lockfile: `pnpm-lock.yaml` (present — pnpm workspace)
- Security control: `minimumReleaseAge: 1440` (1 day) in `pnpm-workspace.yaml` defends against supply-chain attacks; `@replit/*` and `stripe-replit-sync` are allowlisted via `minimumReleaseAgeExclude`
## Frameworks
- Express ^5.2.1 - API server HTTP framework (`artifacts/api-server`). Note: Express 5 types `req.params.*` as `string | string[]` — always `String(...)` cast before passing to Drizzle `eq()`
- React 19.1.0 (pinned exact, required by Expo) - Web and mobile UI
- React Native 0.81.5 + Expo ~54.0.27 - Mobile app (`artifacts/memento-mobile`), file-based routing via `expo-router` ~6.0.17
- Drizzle ORM ^0.45.2 (catalog) - Postgres data layer (`lib/db`)
- Vite ^7.3.2 (catalog) - Web build/dev for `artifacts/memento-web` and `artifacts/mockup-sandbox`
- Wouter ^3.3.5 - Client-side routing (web)
- TanStack React Query ^5.90.21 (catalog) - Server-state / API hooks (generated client in `lib/api-client-react`)
- Vitest ^4.1.9 - API server unit tests (`artifacts/api-server`, `pnpm --filter @workspace/api-server test`). Test files: `*.test.ts` co-located in `src/lib` and `src/routes`
- esbuild 0.27.3 (pinned) - API server bundle to ESM (`artifacts/api-server/build.mjs`); CJS deps (e.g. Express) shimmed via injected `createRequire` banner
- esbuild-plugin-pino ^2.3.3 - Bundles pino transports (`pino-pretty`) correctly under esbuild
- Orval ^8.18.0 - Generates React Query hooks + Zod schemas from OpenAPI (`lib/api-spec/orval.config.ts`)
- drizzle-kit ^0.31.10 - Schema push to dev DB (`lib/db`, `pnpm --filter @workspace/db run push`)
- tsx ^4.21.0 (catalog) - TypeScript script execution (`scripts`)
- Prettier ^3.8.4 - Formatting (root devDependency)
- Tailwind CSS ^4.1.14 (catalog) via `@tailwindcss/vite` - Web styling
- Babel + react-compiler + Metro (Expo) - Mobile bundling
## Key Dependencies
- `@clerk/express` ^2.1.32 - Server-side auth middleware (`artifacts/api-server/src/lib/auth.ts`, `src/app.ts`)
- `@clerk/react` ^6.11.1 / `@clerk/expo` ^3.6.2 - Client auth (web / mobile)
- `stripe` ^22.3.0 (root) - Payments / subscription billing
- `stripe-replit-sync` ^1.0.0 (root) - Replit-managed Stripe webhook validation + `stripe.*` schema sync + managed webhook registration
- `@replit/connectors-sdk` ^0.4.1 (root) - Replit integration connector access
- `drizzle-orm` ^0.45.2 + `drizzle-zod` ^0.8.3 - ORM + schema-derived Zod validation
- `zod` ^3.25.76 (catalog) - Validation (note: replit.md references `zod/v4` import surface, but the installed catalog version is the 3.25 line which exposes the v4 API)
- `@google-cloud/storage` ^7.21.0 - GCS client used against Replit Object Storage sidecar (`artifacts/api-server/src/lib/objectStorage.ts`)
- `pg` ^8.22.0 - Postgres driver (`lib/db/src/index.ts`, node-postgres `Pool`)
- `pino` ^9.14.0 + `pino-http` ^10.5.0 + `pino-pretty` ^13.1.3 - Structured logging (`artifacts/api-server/src/lib/logger.ts`)
- `cors` ^2.8.6, `cookie-parser` ^1.4.7 - HTTP middleware
- `http-proxy-middleware` ^4.1.1 - Clerk Frontend API proxy (`src/middlewares/clerkProxyMiddleware.ts`)
- `google-auth-library` ^10.9.0 - Auth for GCS client
- ffmpeg / ffprobe (system binaries, not npm) - Video compilation in `src/lib/videoWorker.ts`
- Radix UI (`@radix-ui/react-*`) - Web component primitives (shadcn-style)
- Expo native modules: `expo-camera`, `expo-image-picker`, `expo-av`, `expo-notifications`, `expo-secure-store`, `expo-location`, `expo-haptics`, etc.
## Configuration
- No `.env` files committed (none detected). Env is supplied by the Replit runtime and connector tooling.
- Required: `DATABASE_URL` (Postgres connection string, auto-provisioned). Hard-failed at import in `lib/db/src/index.ts` and `lib/db/drizzle.config.ts`.
- `PORT` (defaults to `5000` via `.replit` `userenv.shared`); server throws if unset (`src/index.ts`)
- Clerk: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- Object Storage: `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`
- Email: `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (optional — dry-run logging if unset)
- Replit/Stripe connector: `REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY`, `WEB_REPL_RENEWAL`, `REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN`
- Logging: `LOG_LEVEL`, `NODE_ENV`
- `artifacts/api-server/build.mjs` - esbuild bundle config (ESM output, large `external` list for native modules)
- `tsconfig.base.json` / `tsconfig.json` - shared TS config; `customConditions: ["workspace"]` resolves workspace package `exports`
- `lib/api-spec/orval.config.ts` - codegen config (two targets: `api-client-react`, `zod`)
- `lib/db/drizzle.config.ts` - drizzle-kit (dialect `postgresql`)
- Vite configs per web artifact (`vite.config.ts`)
## Platform Requirements
- Replit workspace (PNPM_WORKSPACE stack, Nix channel `stable-25_05`, GitHub integration)
- Workflow "Start API server": `pnpm --filter @workspace/api-server run dev`, waits for port 5000
- System binaries: `ffmpeg`, `ffprobe` on PATH (video worker)
- pnpm-only; node 24 + python 3.11 modules
- Replit Autoscale deployment (`.replit` `deploymentTarget = "autoscale"`, `router = "application"`)
- Post-build: `pnpm store prune` (`.replit` `deployment.postBuild`)
- Object Storage sidecar reachable at `http://127.0.0.1:1106` (presigned URLs + auth tokens)
- Stripe + Clerk are Replit-managed integrations (no external dashboards)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Backend (`artifacts/api-server/src/`): `camelCase.ts` for libs (`subscriptionSync.ts`, `objectStorage.ts`, `stripeClient.ts`), lowercase nouns for route modules (`events.ts`, `guests.ts`, `billing.ts`).
- Tests: co-located, dotted descriptor before `.test.ts` — `subscriptionSync.test.ts`, `billing.activateSubscription.test.ts`.
- Web (`artifacts/memento-web/src/`): `kebab-case.tsx` for pages (`event-join.tsx`, `video-playback.tsx`, `host/event-detail.tsx`) and shadcn/ui primitives (`components/ui/alert-dialog.tsx`); `PascalCase.tsx` for hand-written feature components (`PlanPickerDialog.tsx`). Hooks are `use-*.ts(x)` (`use-mobile.tsx`, `use-toast.ts`).
- Mobile (`artifacts/memento-mobile/`): Expo Router file-based routing under `app/`, route groups in parens (`app/(tabs)/`).
- `camelCase` everywhere: `generateShareToken()`, `getEventCounts()`, `getDurationCap()`, `requireAuth()`.
- Express middleware named as verbs/predicates: `requireAuth`, `optionalAuth`, `requireGuestAuth`, `optionalGuestAuth`.
- Generated React Query hooks follow Orval's `use<OperationId>` convention derived from the OpenAPI `operationId`: `useCreateEvent`, `useListMyEvents`, `useGetEventByToken`. Matching query-key helpers are `get<OperationId>QueryKey` (`getListMyEventsQueryKey`). **Do not rename — these come from the spec.**
- `camelCase` for locals and params. `SCREAMING_SNAKE_CASE` for module-level constants/regex (`UUID_RE`, `TIER_CAPS`, `BASE_OPTS`, `CLERK_PROXY_PATH`).
- Drizzle table objects are suffixed `Table`: `usersTable`, `eventsTable`, `eventGuestsTable`, `videoJobsTable`, `subscriptionsTable`.
- `PascalCase` for interfaces/types (`AuthenticatedRequest`, `SubscriptionTier`, `StripeEventLike`).
- DB row types derived from Drizzle inference, not hand-written: `typeof usersTable.$inferSelect`, `typeof eventsTable.$inferSelect`.
- Zod-derived insert types via `z.infer<typeof insertUserSchema>` exported as `InsertUser`, etc. (see `lib/db/src/schema/index.ts`).
- DB enums use `pgEnum` + `...Enum` suffix: `subscriptionTierEnum`, `eventStatusEnum`, `mediaTypeEnum`, `videoJobStatusEnum`.
## Code Style
- Prettier `^3.8.4` (root `devDependency`). **No `.prettierrc` checked in** — Prettier defaults apply. Observed style: 2-space indent, double quotes, semicolons, trailing commas in multiline.
- Orval is configured with `prettier: true` so generated output matches the same style.
- No ESLint/Biome config present. The quality gate is the **TypeScript compiler**, run via `pnpm run typecheck`.
- `strictNullChecks: true`, `noImplicitAny: true`, `noImplicitThis: true`, `strictBindCallApply: true`, `strictPropertyInitialization: true`, `alwaysStrict: true`, `useUnknownInCatchVariables: true`, `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true`, `isolatedModules: true`, `noEmitOnError: true`.
- Notably relaxed: `strictFunctionTypes: false`, `noUnusedLocals: false`, `noImplicitOverride: false` (full `strict: true` is **not** enabled — it is decomposed into individual flags).
- `module: "esnext"`, `moduleResolution: "bundler"`, `target: "es2022"`, `customConditions: ["workspace"]` (resolves `workspace:*` deps to source via the `exports` "workspace" condition).
- Each package has its own `tsconfig.json` extending the base; typecheck command is `tsc -p tsconfig.json --noEmit` per package. Library typechecking uses `tsc --build` project references (`pnpm run typecheck:libs`).
## Import Organization
- Cross-package: `@workspace/*` (pnpm workspace protocol `workspace:*`). Subpath exports defined in each lib's `package.json` `exports` map — e.g. `@workspace/db` → `./src/index.ts`, `@workspace/db/schema` → `./src/schema/index.ts`.
- `@workspace/api-zod` re-exports **only** `./generated/api` (`lib/api-zod/src/index.ts` is a single `export * from "./generated/api"` line — see Codegen Discipline).
- Frontend may define `@/*` aliases via Vite/tsconfig (shadcn convention) — verify in each app's `tsconfig.json` before adding.
## Validation
## Express 5 Conventions (api-server)
- Each route file exports a `Router` (`const router = Router(); ... export default router;`). `routes/index.ts` mounts them all with `router.use(...)`; `app.ts` mounts the aggregate under `/api`.
- **GOTCHA — `req.params.*` is typed `string | string[]` in Express 5.** Always wrap with `String(...)` before passing to Drizzle `eq()`:
- Handlers are `async (req, res) => {}`. For authenticated routes the request is typed `AuthenticatedRequest` (adds optional `dbUser` and `guestRecord`). Access the authed user with the non-null assertion `req.dbUser!` (the `requireAuth` middleware guarantees it).
- **Early-return on error/short-circuit** — call `res.status(...).json(...)` then `return;` (handlers return `void`, never `return res.json(...)`).
- Middleware ordering in `app.ts` is load-bearing: the Stripe webhook route (`express.raw`) is registered **before** `express.json()` so the signature can be verified against the raw Buffer. Do not move it.
## Error Handling
- **Route handlers:** wrap the body in `try/catch`. On error, log via the request-scoped logger and return a generic 500 — never leak internals:
- Validation failures → `400` with `{ error: "..." }`. Auth failures → `401`. Authorization failures → `403`. Missing/owned-by-other resources → `404` (ownership checks return 404, not 403, to avoid leaking existence: `if (!event || event.hostId !== user.id) return 404`).
- Error response shape is consistently `{ error: string }`.
- `catch` variables are `unknown` (`useUnknownInCatchVariables`). Narrow before use: `err instanceof Error ? err.message : "Unknown error"`.
- Non-critical side-effect failures are caught and logged at `warn` without failing the request (e.g. subscription sync inside the Stripe webhook in `app.ts`).
## Logging
- Inside handlers use the request-scoped child logger `req.log` (provided by `pino-http`), not the module `logger`.
- Pino call convention is `(objOrErr, msg)`: `req.log.error(err, "Failed to ...")` or `logger.warn({ syncErr }, "Failed to sync ...")`.
- `level` from `LOG_LEVEL` env (default `info`). **Redaction is configured** for `req.headers.authorization`, `req.headers.cookie`, and `res.headers['set-cookie']` — never log raw auth headers.
- HTTP serializers strip query strings from URLs and log only `id/method/url` and `statusCode`.
## Comments
- File- and section-level banner comments using box-drawing rules (`// ─── Users ───`) organize the schema and large modules.
- JSDoc (`/** ... */`) on exported middleware and service functions, describing behavior and intent (see `auth.ts`, `tier.ts`, `storage.ts`). Inline `//` comments explain non-obvious business rules (e.g. vendor-benefit cap upgrade, advisory-lock idempotency, webhook ordering).
## Function & Module Design
- Route modules keep pure helpers at the top (`isUuid`, `generateShareToken`, `buildShareUrl`, `getEventCounts`, `formatEvent`) and the router definitions below.
- Response shaping is centralized in a `formatEvent`-style serializer rather than inlined per handler — reuse this pattern when a resource is returned from multiple endpoints.
- Exports: named exports for helpers/types; `export default router` for route modules. Barrel files (`routes/index.ts`, `lib/*/src/index.ts`) aggregate.
- Constants live in dedicated modules (`lib/tier.ts` for tier caps). `as const` is used to derive literal-union types from data (`TIER_CAPS` → `SubscriptionTier`).
## Codegen Discipline (CRITICAL)
- `lib/api-client-react/src/generated/` — React Query hooks + `api.schemas.ts` (do not edit).
- `lib/api-zod/src/generated/` — Zod request/response schemas (do not edit).
- The hand-written seams are `lib/api-client-react/src/custom-fetch.ts` (the Orval `mutator`) and `lib/api-zod/src/index.ts` (single re-export line).
- The zod target sets `indexFiles: false` — this prevents regeneration of `lib/api-zod/src/index.ts`. **Do not remove that flag**, or the generated `types` folder collides with the `api` name and breaks the build. `index.ts` must only `export * from "./generated/api"`.
- A `titleTransformer` forces `info.title = "Api"` so generated output lands in `api.ts`; exports assume this name.
- Both targets use `clean: true` (output dirs are wiped on each run) and `mode: "split"`. The react-query target routes all calls through the `customFetch` mutator with `baseUrl: "/api"`.
## Dependency / Supply-Chain Conventions
- **pnpm only** — the root `preinstall` hook rejects npm/yarn.
- `pnpm-workspace.yaml` enforces `minimumReleaseAge: 1440` (1 day) as a supply-chain defense; **do not disable**. Only `@replit/*` and `stripe-replit-sync` are allowlisted.
- Shared versions are pinned via the workspace `catalog:` (React, drizzle-orm, vite, tanstack-query, zod, etc.) — reference `catalog:` in package.json rather than hardcoding versions for catalogued deps.
- `onlyBuiltDependencies` allowlists post-install build scripts: `@swc/core`, `esbuild`, `msw`, `unrs-resolver`.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
```
## Single Source of Truth (Spec-First Codegen)
| Source of Truth | File | Generates / Governs |
|-----------------|------|---------------------|
| API contract | `lib/api-spec/openapi.yaml` | React Query hooks + Zod schemas (via Orval) |
| DB schema | `lib/db/src/schema/index.ts` | Postgres tables (via drizzle-kit push) + `drizzle-zod` types |
| Tier caps | `artifacts/api-server/src/lib/tier.ts` | Video duration/quality limits per subscription |
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
- One OpenAPI spec and one Drizzle schema drive all typed contracts; clients never write fetch/validation code by hand.
- Dual authentication model: Clerk sessions for hosts/vendors, opaque guest tokens for unauthenticated guests.
- Two-step presigned-URL media uploads — file bytes never pass through the API server.
- Background video compilation runs as an in-process polling loop in the same Node process (no external queue/broker).
- Soft deletes everywhere (`deletedAt` column; queries filter `isNull(table.deletedAt)`).
## Layers
- Purpose: Define API and DB contracts once
- Location: `lib/api-spec/`, `lib/db/`
- Contains: `openapi.yaml`, Drizzle schema, Orval config, drizzle.config
- Depends on: nothing (authoritative)
- Used by: codegen → generated libs; API server imports `@workspace/db` directly
- Purpose: Typed hooks + validation schemas
- Location: `lib/api-client-react/src/generated/`, `lib/api-zod/src/generated/`
- Contains: React Query hooks, `customFetch`, Zod schemas
- Depends on: spec layer (regenerated)
- Used by: `memento-web`, `memento-mobile`
- Purpose: HTTP handlers, auth, business rules
- Location: `artifacts/api-server/src/routes/`, `artifacts/api-server/src/lib/`
- Contains: Express routers, middleware, storage/notification/worker libs
- Depends on: `@workspace/db`, `@workspace/api-zod`, Clerk, Stripe, Object Storage
- Used by: clients over HTTP
- Purpose: UI for hosts (web), guests (mobile/web), vendors (web)
- Location: `artifacts/memento-web/`, `artifacts/memento-mobile/`
- Depends on: `@workspace/api-client-react`, Clerk, React Query
- Used by: end users
## Data Flow
### Two-Step Presigned Media Upload (primary write path)
### Guest Auth (unauthenticated join)
### Event Lifecycle → Same-Day-Edit Video
### Stripe Billing Sync
- Server is stateless per request; all state in Postgres. Video-worker concurrency guarded by an in-process `isRunning` flag plus an atomic `pending → processing` UPDATE.
- Web client: TanStack Query cache (cleared on Clerk user change, `App.tsx:106`).
- Mobile client: TanStack Query + `EventContext` persisted to AsyncStorage (`artifacts/memento-mobile/context/EventContext.tsx`).
## Key Abstractions
- Purpose: Express request augmented with `dbUser?` and `guestRecord?`
- Examples: `artifacts/api-server/src/lib/auth.ts:7`
- Pattern: middleware attaches identity; handlers branch on `isHost` vs `isEventGuest`
- Purpose: Single fetch wrapper for all generated hooks — base-URL prefixing, bearer-token injection (`setAuthTokenGetter`), structured `ApiError`
- Examples: `lib/api-client-react/src/custom-fetch.ts`
- Pattern: web uses cookie sessions (no token getter); mobile registers a Clerk token getter (`memento-mobile/app/_layout.tsx:78`)
- Purpose: Declarative tier → {duration, quality, resolution} map
- Examples: `artifacts/api-server/src/lib/tier.ts:4`
- Pattern: `getDurationCap` / `getQualityCap` resolve caps; consumed at event-end
- Purpose: Insert/select Zod schemas derived from each table
- Examples: `lib/db/src/schema/index.ts` (`createInsertSchema`, `createSelectSchema`)
- Pattern: `$inferSelect` / `$inferInsert` types reused across server libs
## Entry Points
- Location: `artifacts/api-server/src/index.ts`
- Triggers: `pnpm --filter @workspace/api-server run dev` (esbuild build → `node dist/index.mjs`), port from `PORT`
- Responsibilities: init Stripe schema/webhook, `app.listen`, `startVideoWorker()`
- Location: `artifacts/memento-web/src/App.tsx` (Vite, wouter routing, ClerkProvider)
- Triggers: `pnpm --filter @workspace/memento-web run dev`
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
### Passing `req.params` straight into Drizzle
### Hard-deleting rows
### Trusting subscription tier without checking status
## Error Handling
- Auth failures: 401 (missing/invalid token), 403 (authenticated but not host/guest).
- Path-reuse on media confirm returns 409 (`media.ts:156`).
- Client side: `customFetch` throws a structured `ApiError` (status, parsed body, message) consumed by React Query (`custom-fetch.ts:174`).
- Stripe sync errors are logged but never fail the webhook (`app.ts:51`).
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
