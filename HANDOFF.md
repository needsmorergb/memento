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
   - **Phase 1 is IMPLEMENTED (4/4 plans built & committed) — paused at one human-verify gate.**
     Commits `f7033d2 … bfba854`. All schema/codegen/backend/clients/UI work is done and spot-checked
     (api-server typecheck clean, 31 unit tests pass, VIDEO-01/02/03 closed in code). The only thing
     left before the phase is marked complete is a **visual UAT of the host review UI** (Plan 01-04) —
     see `.planning/phases/01-same-day-edit-video-control/.continue-here.md` and `01-HUMAN-UAT.md`.
     What shipped: a review gate where the same-day edit stops at `ready_for_review` (no guest is
     notified at compile time), a host-only Approve (fans out push+email, idempotent) / Regenerate
     flow on web + mobile, capture-time ordering of media (`capturedAt`), and the public/token path
     provably masks the unapproved cut.

2. **Local-dev portability is done** — the app no longer requires Replit. It runs with Docker
   ([LOCAL_DEV.md](LOCAL_DEV.md)) **or, on a machine without Docker, with native binaries** (see
   "Resume here" below — this machine uses native Postgres + MinIO because Docker isn't installed).
   Verified end-to-end: db push, typecheck, build, `GET /api/healthz` → 200, S3 round-trip vs MinIO.

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

## Resume here (this Mac — native stack, no Docker)

This machine has **no Docker** (and brew is locked to another user), so the docker-compose
services run as native binaries instead. Node 24 LTS is the default via `fnm` (no PATH hacks).
After a reboot, bring the stack back up:

```bash
# 1. Postgres 16 (native, portable build) + MinIO — both under ~/.olla-localdev
PGBIN=~/.olla-localdev/pg/postgresql-16.4.0-aarch64-apple-darwin/bin
MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin \
  nohup ~/.local/bin/minio server ~/.olla-localdev/minio-data --address :9000 --console-address :9001 \
  >~/.olla-localdev/logs/minio.log 2>&1 &
nohup "$PGBIN/postgres" -D ~/.olla-localdev/pgdata -p 5432 -k /tmp >~/.olla-localdev/logs/postgres.log 2>&1 &

# 2. API server (Node 24 is already default; PORT=5050 because macOS AirPlay holds :5000)
cd ~/memento && set -a && . ./.env && set +a && pnpm --filter @workspace/api-server run dev
# verify:  curl http://localhost:5050/api/healthz   →  {"status":"ok"}
```

> The `.env` here pins `PORT=5050` and `STORAGE_DRIVER=s3` (MinIO). The `olla-media` bucket and its
> public `download` prefix already exist. To re-create from scratch, see commands in
> `~/.local/bin/mc` usage or LOCAL_DEV.md.

## What's next (suggested)

- **Finish Phase 1** (one gate left): start the local stack (above) + web/mobile dev servers,
  walk `.planning/phases/01-same-day-edit-video-control/01-HUMAN-UAT.md` (6 checks) against an
  event whose edit reached `ready_for_review`. If all pass → reply "approved" and re-run
  `/gsd-execute-phase 1` — it resumes past the checkpoint, runs phase verification, and marks
  Phase 1 complete. If issues → `/gsd-plan-phase 1 --gaps` then `/gsd-execute-phase 1 --gaps-only`.
- Then continue the milestone: Phase 2 (Host Dashboard & Guest Control) via
  `/gsd-discuss-phase 2` → `/gsd-plan-phase 2` → `/gsd-execute-phase 2`, or `/gsd-autonomous`.
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
