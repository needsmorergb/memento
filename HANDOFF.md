# Olla — Project Handoff

Last updated: 2026-06-28. Read this first when picking the project up on a new
machine or in a new session.

## What this is

**Olla** (get-olla.com) — a shared event-media platform (weddings, parties,
events). Guests join via link/QR (no account), capture photos/videos/voice notes,
and when the host ends the event Olla compiles a "same-day edit" highlight video
and delivers it via push + email. pnpm-workspace monorepo: Express 5 API,
Expo mobile app, Vite web app, Postgres/Drizzle, Stripe billing.

> The product is **Olla**, but code identifiers are still `memento-*`
> (`memento-web`, `memento-mobile`, repo name). No rebrand this milestone.

## Current state

1. **GSD planning is set up** in `.planning/` (run via the `gsd-*` skills):
   - Full codebase map → `.planning/codebase/` (7 docs).
   - `PROJECT.md`, `REQUIREMENTS.md` (10 v1 reqs), `ROADMAP.md` (4 phases), `STATE.md`, `config.json`.
   - 4-phase roadmap: ① Same-Day-Edit Video Control · ② Host Dashboard & Guest Control · ③ Live Shared Gallery · ④ Vendor Provisioning & Benefits.
   - **Phase 1 is fully planned but not executed**: `CONTEXT`, `UI-SPEC`, `RESEARCH`, `PATTERNS`, and 4 `PLAN` files in `.planning/phases/01-same-day-edit-video-control/`.

2. **Local-dev portability is done** (this is the big recent change): the app no
   longer requires Replit — it builds and runs on any machine with Docker. See
   [LOCAL_DEV.md](LOCAL_DEV.md). Verified end-to-end: db push, typecheck, build,
   server boots, `GET /api/healthz` → 200, S3 presigned round-trip against MinIO.

## Get running on a new machine

Prereqs: Node 24+, `pnpm`, Docker Desktop, and `ffmpeg`/`ffprobe` on PATH (video only).

```bash
git clone https://github.com/needsmorergb/memento.git
cd memento
pnpm install
cp .env.example .env                          # defaults match docker-compose.yml
docker compose up -d                          # Postgres + MinIO + bucket
pnpm --filter @workspace/db run push          # apply schema
pnpm --filter @workspace/api-server run dev    # API on :5000
# verify:  curl http://localhost:5000/api/healthz   →  {"status":"ok"}
```

Clients (separate terminals, optional):
```bash
pnpm --filter @workspace/memento-web run dev
pnpm --filter @workspace/memento-mobile run dev
```

### Secrets / env (NOT in the repo)

`.env` is gitignored — never committed. `.env.example` is the template and the
local defaults already work with Docker. To enable the optional integrations,
fill these in `.env`:

| Integration | Vars | Where to get them | Needed for |
|---|---|---|---|
| Clerk (auth) | `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | free dev instance at dashboard.clerk.com | host/vendor login (guest flow works without) |
| Stripe (billing) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe dashboard + `stripe listen` | billing/subscriptions |
| Resend (email) | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | resend.com | sending (else dry-run logs) |

Storage/DB envs (`DATABASE_URL`, `S3_*`, `STORAGE_DRIVER=s3`) are pre-filled for
local Docker. For production/Replit, leave `STORAGE_DRIVER` unset (defaults to
`replit`) and the Replit connectors are used unchanged.

## What's next (suggested)

- **Execute Phase 1** — now possible locally: `/gsd:execute-phase 1` (4 plans,
  3 waves: schema+codegen → backend review gate + capture-time → host review UI).
  Then continue the milestone (`/gsd-autonomous` resumes at the execute gate).
- Or do feature work directly; the roadmap/requirements in `.planning/` are the spec.

## Gotchas

- **Windows:** `pnpm` and `docker` are on the PowerShell PATH but not always the
  Git-Bash PATH — use PowerShell for them.
- Spec-first codegen: edit `lib/api-spec/openapi.yaml` / `lib/db/src/schema/index.ts`
  **first**, then `pnpm --filter @workspace/api-spec run codegen` / `db push`.
  Never hand-edit `lib/*/src/generated/`.
- Express 5: wrap `req.params.*` in `String(...)` before Drizzle `eq()`.
- Storage driver lives in `artifacts/api-server/src/lib/storage/` (`s3Driver.ts`
  local, `replitGcsDriver.ts` prod, selected by `STORAGE_DRIVER`).

## Key locations

| What | Where |
|---|---|
| Planning / roadmap / state | `.planning/` |
| Local dev guide | `LOCAL_DEV.md` |
| API contracts (source of truth) | `lib/api-spec/openapi.yaml` |
| DB schema | `lib/db/src/schema/index.ts` |
| API routes | `artifacts/api-server/src/routes/` |
| Storage drivers | `artifacts/api-server/src/lib/storage/` |
| Local services | `docker-compose.yml` |
