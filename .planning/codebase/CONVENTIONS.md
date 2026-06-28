# Coding Conventions

**Analysis Date:** 2026-06-28

This is "Memento" — a pnpm-workspaces monorepo (Node 24, TypeScript 5.9). Packages live under `artifacts/*` (deployable apps) and `lib/*` (shared libraries). The single source of truth for API contracts is `lib/api-spec/openapi.yaml`; client hooks and Zod validators are **generated** from it via Orval.

## Naming Patterns

**Files:**
- Backend (`artifacts/api-server/src/`): `camelCase.ts` for libs (`subscriptionSync.ts`, `objectStorage.ts`, `stripeClient.ts`), lowercase nouns for route modules (`events.ts`, `guests.ts`, `billing.ts`).
- Tests: co-located, dotted descriptor before `.test.ts` — `subscriptionSync.test.ts`, `billing.activateSubscription.test.ts`.
- Web (`artifacts/memento-web/src/`): `kebab-case.tsx` for pages (`event-join.tsx`, `video-playback.tsx`, `host/event-detail.tsx`) and shadcn/ui primitives (`components/ui/alert-dialog.tsx`); `PascalCase.tsx` for hand-written feature components (`PlanPickerDialog.tsx`). Hooks are `use-*.ts(x)` (`use-mobile.tsx`, `use-toast.ts`).
- Mobile (`artifacts/memento-mobile/`): Expo Router file-based routing under `app/`, route groups in parens (`app/(tabs)/`).

**Functions:**
- `camelCase` everywhere: `generateShareToken()`, `getEventCounts()`, `getDurationCap()`, `requireAuth()`.
- Express middleware named as verbs/predicates: `requireAuth`, `optionalAuth`, `requireGuestAuth`, `optionalGuestAuth`.
- Generated React Query hooks follow Orval's `use<OperationId>` convention derived from the OpenAPI `operationId`: `useCreateEvent`, `useListMyEvents`, `useGetEventByToken`. Matching query-key helpers are `get<OperationId>QueryKey` (`getListMyEventsQueryKey`). **Do not rename — these come from the spec.**

**Variables:**
- `camelCase` for locals and params. `SCREAMING_SNAKE_CASE` for module-level constants/regex (`UUID_RE`, `TIER_CAPS`, `BASE_OPTS`, `CLERK_PROXY_PATH`).
- Drizzle table objects are suffixed `Table`: `usersTable`, `eventsTable`, `eventGuestsTable`, `videoJobsTable`, `subscriptionsTable`.

**Types:**
- `PascalCase` for interfaces/types (`AuthenticatedRequest`, `SubscriptionTier`, `StripeEventLike`).
- DB row types derived from Drizzle inference, not hand-written: `typeof usersTable.$inferSelect`, `typeof eventsTable.$inferSelect`.
- Zod-derived insert types via `z.infer<typeof insertUserSchema>` exported as `InsertUser`, etc. (see `lib/db/src/schema/index.ts`).
- DB enums use `pgEnum` + `...Enum` suffix: `subscriptionTierEnum`, `eventStatusEnum`, `mediaTypeEnum`, `videoJobStatusEnum`.

## Code Style

**Formatting:**
- Prettier `^3.8.4` (root `devDependency`). **No `.prettierrc` checked in** — Prettier defaults apply. Observed style: 2-space indent, double quotes, semicolons, trailing commas in multiline.
- Orval is configured with `prettier: true` so generated output matches the same style.

**Linting:**
- No ESLint/Biome config present. The quality gate is the **TypeScript compiler**, run via `pnpm run typecheck`.

**TypeScript strictness (`tsconfig.base.json`):**
- `strictNullChecks: true`, `noImplicitAny: true`, `noImplicitThis: true`, `strictBindCallApply: true`, `strictPropertyInitialization: true`, `alwaysStrict: true`, `useUnknownInCatchVariables: true`, `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true`, `isolatedModules: true`, `noEmitOnError: true`.
- Notably relaxed: `strictFunctionTypes: false`, `noUnusedLocals: false`, `noImplicitOverride: false` (full `strict: true` is **not** enabled — it is decomposed into individual flags).
- `module: "esnext"`, `moduleResolution: "bundler"`, `target: "es2022"`, `customConditions: ["workspace"]` (resolves `workspace:*` deps to source via the `exports` "workspace" condition).
- Each package has its own `tsconfig.json` extending the base; typecheck command is `tsc -p tsconfig.json --noEmit` per package. Library typechecking uses `tsc --build` project references (`pnpm run typecheck:libs`).

## Import Organization

**Order (observed, not enforced by tooling):**
1. Node/third-party packages (`express`, `drizzle-orm`, `@clerk/express`, `crypto`).
2. Workspace packages (`@workspace/db`, `@workspace/db/schema`, `@workspace/api-zod`, `@workspace/api-client-react`).
3. Relative imports (`../lib/auth`, `./billing`).

**Path aliases:**
- Cross-package: `@workspace/*` (pnpm workspace protocol `workspace:*`). Subpath exports defined in each lib's `package.json` `exports` map — e.g. `@workspace/db` → `./src/index.ts`, `@workspace/db/schema` → `./src/schema/index.ts`.
- `@workspace/api-zod` re-exports **only** `./generated/api` (`lib/api-zod/src/index.ts` is a single `export * from "./generated/api"` line — see Codegen Discipline).
- Frontend may define `@/*` aliases via Vite/tsconfig (shadcn convention) — verify in each app's `tsconfig.json` before adding.

## Validation

**Library:** Zod, imported as **`zod/v4`** (`import { z } from "zod/v4"`). Always use this import path, not bare `zod`, for parity with `drizzle-zod` and Orval output.

**Two validation surfaces:**
1. **DB layer** (`lib/db/src/schema/index.ts`): `drizzle-zod`'s `createInsertSchema` / `createSelectSchema` derive Zod schemas directly from Drizzle tables. Insert schemas `.omit({ id, createdAt, updatedAt, deletedAt })` server-managed columns. Pattern:
   ```ts
   export const insertEventSchema = createInsertSchema(eventsTable).omit({
     id: true, createdAt: true, updatedAt: true, deletedAt: true,
   });
   export const selectEventSchema = createSelectSchema(eventsTable);
   export type InsertUser = z.infer<typeof insertUserSchema>;
   ```
2. **API boundary** (`@workspace/api-zod`): request/response schemas are **generated by Orval** from `openapi.yaml`. Routes import them by name and validate:
   ```ts
   const parsed = RequestUploadUrlBody.safeParse(req.body);
   if (!parsed.success) {
     res.status(400).json({ error: "Missing or invalid required fields" });
     return;
   }
   // ...
   res.json(RequestUploadUrlResponse.parse({ ... })); // response validated on the way out
   ```
   Orval's zod target uses `coerce` for query/param (`boolean`, `number`, `string`) and body/response (`bigint`, `date`), plus `useDates: true` and `useBigInt: true`.

**Inline validation:** Some routes still hand-validate `req.body` with a type assertion + guard rather than a generated schema (`events.ts` create/update). Prefer the generated `@workspace/api-zod` schema when the operation exists in the spec; fall back to manual guards only for fields not yet in the spec.

## Express 5 Conventions (api-server)

- Each route file exports a `Router` (`const router = Router(); ... export default router;`). `routes/index.ts` mounts them all with `router.use(...)`; `app.ts` mounts the aggregate under `/api`.
- **GOTCHA — `req.params.*` is typed `string | string[]` in Express 5.** Always wrap with `String(...)` before passing to Drizzle `eq()`:
  ```ts
  where: eq(eventsTable.id, String(req.params.eventId))
  ```
  This is the single most common correctness pitfall in this codebase. Apply it to every param read.
- Handlers are `async (req, res) => {}`. For authenticated routes the request is typed `AuthenticatedRequest` (adds optional `dbUser` and `guestRecord`). Access the authed user with the non-null assertion `req.dbUser!` (the `requireAuth` middleware guarantees it).
- **Early-return on error/short-circuit** — call `res.status(...).json(...)` then `return;` (handlers return `void`, never `return res.json(...)`).
- Middleware ordering in `app.ts` is load-bearing: the Stripe webhook route (`express.raw`) is registered **before** `express.json()` so the signature can be verified against the raw Buffer. Do not move it.

## Error Handling

- **Route handlers:** wrap the body in `try/catch`. On error, log via the request-scoped logger and return a generic 500 — never leak internals:
  ```ts
  } catch (err) {
    req.log.error(err, "Failed to list events");
    res.status(500).json({ error: "Internal server error" });
  }
  ```
- Validation failures → `400` with `{ error: "..." }`. Auth failures → `401`. Authorization failures → `403`. Missing/owned-by-other resources → `404` (ownership checks return 404, not 403, to avoid leaking existence: `if (!event || event.hostId !== user.id) return 404`).
- Error response shape is consistently `{ error: string }`.
- `catch` variables are `unknown` (`useUnknownInCatchVariables`). Narrow before use: `err instanceof Error ? err.message : "Unknown error"`.
- Non-critical side-effect failures are caught and logged at `warn` without failing the request (e.g. subscription sync inside the Stripe webhook in `app.ts`).

## Logging

**Framework:** `pino` (`lib/logger.ts`) + `pino-http` request logging (`app.ts`). `pino-pretty` in development only. Build uses `esbuild-plugin-pino`.

**Patterns:**
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

Generated directories are the contract output and **must never be hand-edited**:
- `lib/api-client-react/src/generated/` — React Query hooks + `api.schemas.ts` (do not edit).
- `lib/api-zod/src/generated/` — Zod request/response schemas (do not edit).
- The hand-written seams are `lib/api-client-react/src/custom-fetch.ts` (the Orval `mutator`) and `lib/api-zod/src/index.ts` (single re-export line).

**Workflow:**
1. Edit `lib/api-spec/openapi.yaml` (single source of truth for all API contracts).
2. Run `pnpm --filter @workspace/api-spec run codegen` (runs Orval, then `typecheck:libs`).
3. Restart the API server workflow.

**Hard constraints (from `lib/api-spec/orval.config.ts` and `replit.md`):**
- The zod target sets `indexFiles: false` — this prevents regeneration of `lib/api-zod/src/index.ts`. **Do not remove that flag**, or the generated `types` folder collides with the `api` name and breaks the build. `index.ts` must only `export * from "./generated/api"`.
- A `titleTransformer` forces `info.title = "Api"` so generated output lands in `api.ts`; exports assume this name.
- Both targets use `clean: true` (output dirs are wiped on each run) and `mode: "split"`. The react-query target routes all calls through the `customFetch` mutator with `baseUrl: "/api"`.

## Dependency / Supply-Chain Conventions

- **pnpm only** — the root `preinstall` hook rejects npm/yarn.
- `pnpm-workspace.yaml` enforces `minimumReleaseAge: 1440` (1 day) as a supply-chain defense; **do not disable**. Only `@replit/*` and `stripe-replit-sync` are allowlisted.
- Shared versions are pinned via the workspace `catalog:` (React, drizzle-orm, vite, tanstack-query, zod, etc.) — reference `catalog:` in package.json rather than hardcoding versions for catalogued deps.
- `onlyBuiltDependencies` allowlists post-install build scripts: `@swc/core`, `esbuild`, `msw`, `unrs-resolver`.

---

*Convention analysis: 2026-06-28*
