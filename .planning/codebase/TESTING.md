# Testing Patterns

**Analysis Date:** 2026-06-28

## Test Framework

**Runner:**
- **Vitest** `^4.1.9` — declared only in `artifacts/api-server` (`devDependencies`). No other package has a test runner or test script.
- **No `vitest.config.*` / `jest.config.*` file exists** anywhere in the repo. Tests run on Vitest defaults: ESM, Node environment, auto-discovery of `*.test.ts` / `*.spec.ts`, globals **off** (imports are explicit — see below).

**Assertion / mocking library:**
- Vitest built-ins. APIs are imported explicitly per file: `import { describe, it, expect, vi, beforeEach } from "vitest";` (globals are not enabled, since there is no config opting in).

**Run commands:**
```bash
pnpm --filter @workspace/api-server run test     # vitest run (one-shot, CI mode)
# No watch or coverage script is defined. To run ad-hoc:
pnpm --filter @workspace/api-server exec vitest         # watch mode
pnpm --filter @workspace/api-server exec vitest --coverage   # requires adding @vitest/coverage-v8
```
- The only `test` script in the entire monorepo is `"test": "vitest run"` in `artifacts/api-server/package.json`.
- `pnpm run build` (root) runs `typecheck` first — typechecking is the primary always-on quality gate; tests are run separately.

## Test File Organization

**Location:**
- **Co-located** with the module under test (same directory), not in a separate `__tests__/` or `tests/` tree. There are no `__tests__` directories.

**Naming:**
- `<module>.test.ts` for unit tests of a single module (`lib/subscriptionSync.test.ts`).
- `<module>.<scenario>.test.ts` when a test file targets one exported function / concern of a larger module (`routes/billing.activateSubscription.test.ts` tests the `activateSubscription` export of `billing.ts`).

**Existing test files (the complete inventory):**
```
artifacts/api-server/src/lib/subscriptionSync.test.ts
artifacts/api-server/src/routes/billing.activateSubscription.test.ts
```

## Test Structure

**Suite organization** — `describe` blocks grouped by event type / scenario, with `it` per behavior. Section banner comments separate groups:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../routes/billing", () => ({ /* ... */ }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkout.session.completed", () => {
  it("activates a pro subscription when all required fields are present", async () => {
    const event: StripeEventLike = { /* fixture */ };
    await syncSubscriptionFromStripeEvent(mockStripe, event);
    expect(activateSubscription).toHaveBeenCalledWith({ /* ... */ });
    expect(cancelSubscription).not.toHaveBeenCalled();
  });
});
```

**Patterns:**
- **Setup:** `beforeEach(() => vi.clearAllMocks())` in every file. When `clearAllMocks` wipes a default resolved value, it is re-applied in the same `beforeEach` (`mockExecute.mockResolvedValue(undefined)`).
- **Assertion style:** behavior-focused — assert *which collaborator was called* and *with what args* (`toHaveBeenCalledWith`, `toHaveBeenCalledTimes`, `toHaveBeenCalledOnce`, `.not.toHaveBeenCalled()`, `toHaveBeenLastCalledWith`). Tests verify orchestration/branching, not DB state.
- **Descriptive `it` names** spell out the business rule and expected outcome ("updates the existing row instead of inserting a duplicate", "free→pro→past_due→pro→free covers the complete lifecycle sequence").
- **Async:** handlers are `async`; tests `await` the function under test directly. Concurrency is modeled with `await Promise.all([...])`.

## Mocking

**Framework:** Vitest `vi.mock` (hoisted module mocks) + `vi.fn()` spies.

**Key pattern — mock the module boundary, import the SUT after the mock:**
```ts
// 1. Declare mock fns at module scope
const mockInsert = vi.fn();
const mockFindFirst = vi.fn();

// 2. vi.mock is hoisted above imports — define the @workspace/db surface
vi.mock("@workspace/db", () => ({
  db: {
    transaction: vi.fn(async (fn) => { /* build a tx with execute/query/insert/update */ }),
    query: { usersTable: { findFirst: vi.fn().mockResolvedValue(null) } },
  },
  subscriptionsTable: {}, usersTable: {}, vendorCodesTable: {},
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/stripeClient", () => ({ getUncachableStripeClient: vi.fn() }));

// 3. THEN import the system under test and the mocked symbols
import { activateSubscription } from "./billing";
import { db } from "@workspace/db";
```

**What IS mocked:**
- The database: `@workspace/db` is fully mocked. `db.transaction` is replaced with a fake that constructs a `tx` exposing `execute`, `query.subscriptionsTable.findFirst`, `insert()`, and `update()` chains — letting tests simulate concurrent webhook deliveries without Postgres.
- Drizzle fluent chains are emulated with `mockReturnThis()` (`update().set().where()`).
- The logger (`../lib/logger` / `./logger`) — silenced to a no-op spy object.
- External clients: Stripe (`../lib/stripeClient`), and sibling billing helpers (`../routes/billing`) when testing `subscriptionSync`.
- Stripe events are passed as plain object literals typed `StripeEventLike` rather than constructed via the Stripe SDK; the client itself is a typed empty stub: `const mockStripe = {} as import("stripe").default`.

**What is NOT mocked:**
- The function under test and its pure branching logic.
- Drizzle's `sql` tag output is inspected rather than mocked — the advisory-lock test asserts `JSON.stringify(call)` matches `/pg_advisory_xact_lock/` to confirm the lock SQL is issued.

**msw:** `msw` appears in `pnpm-workspace.yaml`'s `onlyBuiltDependencies` (its install build script is allowlisted), but **no test currently imports or uses msw**, and it is not a declared dependency of any package. It is available infrastructure for HTTP-level mocking (e.g. future frontend/API client tests) but is presently unused. Current backend tests mock at the module boundary instead of the network.

## Fixtures and Factories

- **No factory library or shared fixtures directory.** Test data is inline object literals built per `it` (e.g. `BASE_OPTS` const at the top of `billing.activateSubscription.test.ts`, reused and spread across cases).
- Stripe events are hand-authored literals typed to the local `StripeEventLike` type exported from `subscriptionSync.ts`.
- Unix timestamps are used as raw numbers and converted (`new Date(periodEndUnix * 1000)`) to mirror production code.

## Coverage

- **No coverage tooling installed or configured.** `@vitest/coverage-v8` is not a dependency; `/coverage` is gitignored (placeholder convention only).
- **No enforced thresholds.** To enable: add `@vitest/coverage-v8`, a `vitest.config.ts` with `test.coverage`, and a `test:coverage` script.

## Test Types

**Unit tests:** Present. Both existing files are isolated unit tests of subscription/billing orchestration logic with all I/O mocked. Scope: webhook event → correct billing helper dispatch, and insert-vs-update idempotency under duplicate/concurrent webhook delivery.

**Integration tests:** **None.** No tests exercise a real Express app, real Postgres, real Clerk, or real object storage. No use of `supertest` or an in-memory DB.

**E2E / UI tests:** **None.** No Playwright/Cypress/React Testing Library setup. The web app (`memento-web`) and mobile app (`memento-mobile`) have **no test scripts and no test files**. There is a top-level `.maestro/` directory (untracked) which may hold Maestro mobile-UI flows, but it is not wired into any package's test script.

## Common Patterns

**Async testing:**
```ts
it("...", async () => {
  await syncSubscriptionFromStripeEvent(mockStripe, event);
  expect(activateSubscription).toHaveBeenCalledOnce();
});
```

**Concurrency / idempotency testing** — simulate ordered delivery via a call-counting mock, then fire both with `Promise.all`:
```ts
let callCount = 0;
mockFindFirst.mockImplementation(async () => {
  callCount += 1;
  return callCount === 1 ? undefined : { id: "sub-row-id", /* ... */ };
});
await Promise.all([activateSubscription(BASE_OPTS), activateSubscription(BASE_OPTS)]);
expect(mockInsert).toHaveBeenCalledTimes(1);
expect(mockUpdate).toHaveBeenCalledTimes(1);
```

**Negative / no-op assertions** — heavily used to prove branches do nothing on missing/invalid input:
```ts
expect(activateSubscription).not.toHaveBeenCalled();
```

**SQL emission assertions** (in lieu of a real DB) — stringify the captured Drizzle `sql` object and pattern-match:
```ts
const call = mockExecute.mock.calls[0][0];
expect(JSON.stringify(call)).toMatch(/pg_advisory_xact_lock/);
```

## Gaps & Recommendations

- **Coverage is concentrated on Stripe/billing only.** Untested backend areas: `routes/events.ts`, `routes/guests.ts`, `routes/media.ts`, `routes/storage.ts`, `routes/vendors.ts`, `routes/users.ts`, and `lib/auth.ts` (auth/guest-token middleware), `lib/tier.ts`, `lib/objectStorage.ts`, `lib/objectAcl.ts`, `lib/videoWorker.ts`, `lib/notifications.ts`. **Priority: High** for `auth.ts` and the `String(req.params.*)` param-casting paths (the documented Express 5 gotcha is exactly the kind of regression a test would catch).
- **No integration test of the Express layer.** Consider `supertest` against the exported `app` (`artifacts/api-server/src/app.ts`) with the DB mocked, to cover middleware ordering (Stripe raw body before `express.json()`), auth rejection (401/403/404), and Zod request validation (`storage.ts` `safeParse`).
- **No frontend tests at all.** `msw` is already allowlisted for builds — wire it into a Vitest + React Testing Library setup in `memento-web` to test pages against mocked `@workspace/api-client-react` endpoints.
- **No shared test config.** Adding a root or per-app `vitest.config.ts` (with `globals`, environment, coverage) would standardize behavior before the suite grows.
- **No CI test step.** `.replit` defines only a dev workflow (`Start API server`) and a deploy `postBuild`; there is no `.github/workflows`. Tests and typecheck are not gated on merge — run `pnpm --filter @workspace/api-server run test` and `pnpm run typecheck` manually.

---

*Testing analysis: 2026-06-28*
