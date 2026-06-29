# Running Olla locally (no Replit)

Olla now runs entirely on your machine. Replit's managed services are abstracted
behind env-selectable drivers, so the same codebase runs locally **and** on Replit.

## Prerequisites

- Node.js 24+ and `pnpm` (the repo enforces pnpm)
- Docker Desktop (for local Postgres + MinIO object storage)
- `ffmpeg` / `ffprobe` on PATH (only needed for same-day-edit video compilation)

## First-time setup

```bash
pnpm install
cp .env.example .env          # defaults already match docker-compose.yml
docker compose up -d          # Postgres :5432, MinIO :9000 (console :9001), creates the media bucket
pnpm --filter @workspace/db run push        # apply the schema to local Postgres
pnpm --filter @workspace/api-server run dev # build + start the API on :5000
```

Health check: `curl http://localhost:5000/api/healthz` → `{"status":"ok"}`.

## What runs where

| Concern | Local (default `.env`) | Replit / production |
|---|---|---|
| Database | Docker Postgres (`DATABASE_URL`) | Replit-provisioned Postgres |
| Object storage | MinIO via S3 driver (`STORAGE_DRIVER=s3`) | Replit Object Storage (`STORAGE_DRIVER=replit`) |
| Auth (Clerk) | Optional — guest flows work without it | Replit-managed Clerk |
| Billing (Stripe) | Optional — set `STRIPE_SECRET_KEY` to enable | Replit Stripe connector |
| Email (Resend) | Optional — logs a dry-run without a key | `RESEND_API_KEY` |

The driver is chosen by `STORAGE_DRIVER`:
- `s3` → `S3_*` env (MinIO/AWS/R2). See `artifacts/api-server/src/lib/storage/s3Driver.ts`.
- `replit` → Replit sidecar/GCS. See `artifacts/api-server/src/lib/storage/replitGcsDriver.ts`.

Production deploy is unchanged: leave `STORAGE_DRIVER` unset (defaults to `replit`)
and don't set `STRIPE_SECRET_KEY`/`S3_*`, and the Replit connectors are used exactly as before.

## Optional: enable host/vendor login (Clerk)

The guest capture → upload → video flow works without Clerk. For host/vendor login,
create a free dev instance at <https://dashboard.clerk.com> and set in `.env`:

```
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

Without these the server logs a warning and treats every request as signed-out.

## Optional: Stripe billing locally

```
STRIPE_SECRET_KEY=sk_test_...
# Forward webhooks with the Stripe CLI and paste the printed signing secret:
#   stripe listen --forward-to localhost:5000/api/stripe/webhook
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Services / ports

| Service | URL |
|---|---|
| API server | http://localhost:5000 |
| Postgres | postgres://olla:olla@localhost:5432/olla |
| MinIO S3 API | http://localhost:9000 |
| MinIO console | http://localhost:9001 (minioadmin / minioadmin) |

Stop services: `docker compose down` (add `-v` to also wipe the DB + object volumes).

## Notes

- `.env` is gitignored; `.env.example` is the tracked template.
- The Drizzle schema path is forward-slashed for Windows glob compatibility.
- The `preinstall` guard is a Node script (`scripts/check-package-manager.mjs`) so
  `pnpm install` works on Windows (the old `sh -c` guard failed without `sh` on PATH).
