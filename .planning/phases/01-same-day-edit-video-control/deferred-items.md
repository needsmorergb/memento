# Deferred Items — Phase 01 (same-day-edit-video-control)

Out-of-scope discoveries logged during execution. NOT fixed by the plan that found them.

| Found in | Item | Detail | Why deferred |
|----------|------|--------|--------------|
| Plan 01-01 | Pre-existing typecheck failures in radix-derived UI components | `artifacts/memento-web/src/components/ui/calendar.tsx` (lines 132/161/189) and `artifacts/memento-web/src/components/ui/spinner.tsx:7` (and the same `spinner.tsx`/`calendar.tsx` in `artifacts/mockup-sandbox`) fail `tsc` with `@types/react@19.1.17` "Two different types with this name exist" / `VoidOrUndefinedOnly` duplicate-instance errors. | Pre-existing (files untouched by this plan — last changed in commit `185b07c`, the frontend-build commit). Caused by a duplicated `@types/react` instance in the pnpm tree under React 19, not by the spec/codegen changes in this plan. Does not consume `VideoJobStatus`/`api-client-react`/`capturedAt`. SCOPE BOUNDARY — not fixed here. |
