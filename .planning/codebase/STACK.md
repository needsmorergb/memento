# Technology Stack

**Analysis Date:** 2026-06-28

## Languages

**Primary:**
- TypeScript ~5.9.3 - Entire monorepo (API server, web, mobile, libs, scripts). Pinned at the workspace root in `package.json`; `lib/db` and packages inherit it.

**Secondary:**
- JavaScript (ESM `.mjs`) - Build scripts only: `artifacts/api-server/build.mjs`, `artifacts/memento-mobile/scripts/build.js`, `artifacts/memento-mobile/server/serve.js`
- SQL - Inline raw SQL via Drizzle `sql` template for Stripe price/product lookups (`artifacts/api-server/src/routes/billing.ts`)
- Python 3.11 - Declared as a Replit module in `.replit` but no application code detected; ffmpeg/ffprobe (system binaries) are the actual media toolchain

## Runtime

**Environment:**
- Node.js 24 (Replit module `nodejs-24` in `.replit`; replit.md confirms "Node.js 24"). No `.nvmrc` present.
- TypeScript compile target `es2022`, `module: esnext`, `moduleResolution: bundler` (`tsconfig.base.json`)
- API server runs as native ESM with `--enable-source-maps` (`artifacts/api-server/package.json` `start` script)

**Package Manager:**
- pnpm (enforced — root `preinstall` script deletes `package-lock.json`/`yarn.lock` and rejects non-pnpm `npm_config_user_agent`)
- Workspace defined in `pnpm-workspace.yaml`: `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`
- Lockfile: `pnpm-lock.yaml` (present — pnpm workspace)
- Security control: `minimumReleaseAge: 1440` (1 day) in `pnpm-workspace.yaml` defends against supply-chain attacks; `@replit/*` and `stripe-replit-sync` are allowlisted via `minimumReleaseAgeExclude`

## Frameworks

**Core:**
- Express ^5.2.1 - API server HTTP framework (`artifacts/api-server`). Note: Express 5 types `req.params.*` as `string | string[]` — always `String(...)` cast before passing to Drizzle `eq()`
- React 19.1.0 (pinned exact, required by Expo) - Web and mobile UI
- React Native 0.81.5 + Expo ~54.0.27 - Mobile app (`artifacts/memento-mobile`), file-based routing via `expo-router` ~6.0.17
- Drizzle ORM ^0.45.2 (catalog) - Postgres data layer (`lib/db`)
- Vite ^7.3.2 (catalog) - Web build/dev for `artifacts/memento-web` and `artifacts/mockup-sandbox`
- Wouter ^3.3.5 - Client-side routing (web)
- TanStack React Query ^5.90.21 (catalog) - Server-state / API hooks (generated client in `lib/api-client-react`)

**Testing:**
- Vitest ^4.1.9 - API server unit tests (`artifacts/api-server`, `pnpm --filter @workspace/api-server test`). Test files: `*.test.ts` co-located in `src/lib` and `src/routes`

**Build/Dev:**
- esbuild 0.27.3 (pinned) - API server bundle to ESM (`artifacts/api-server/build.mjs`); CJS deps (e.g. Express) shimmed via injected `createRequire` banner
- esbuild-plugin-pino ^2.3.3 - Bundles pino transports (`pino-pretty`) correctly under esbuild
- Orval ^8.18.0 - Generates React Query hooks + Zod schemas from OpenAPI (`lib/api-spec/orval.config.ts`)
- drizzle-kit ^0.31.10 - Schema push to dev DB (`lib/db`, `pnpm --filter @workspace/db run push`)
- tsx ^4.21.0 (catalog) - TypeScript script execution (`scripts`)
- Prettier ^3.8.4 - Formatting (root devDependency)
- Tailwind CSS ^4.1.14 (catalog) via `@tailwindcss/vite` - Web styling
- Babel + react-compiler + Metro (Expo) - Mobile bundling

## Key Dependencies

**Critical:**
- `@clerk/express` ^2.1.32 - Server-side auth middleware (`artifacts/api-server/src/lib/auth.ts`, `src/app.ts`)
- `@clerk/react` ^6.11.1 / `@clerk/expo` ^3.6.2 - Client auth (web / mobile)
- `stripe` ^22.3.0 (root) - Payments / subscription billing
- `stripe-replit-sync` ^1.0.0 (root) - Replit-managed Stripe webhook validation + `stripe.*` schema sync + managed webhook registration
- `@replit/connectors-sdk` ^0.4.1 (root) - Replit integration connector access
- `drizzle-orm` ^0.45.2 + `drizzle-zod` ^0.8.3 - ORM + schema-derived Zod validation
- `zod` ^3.25.76 (catalog) - Validation (note: replit.md references `zod/v4` import surface, but the installed catalog version is the 3.25 line which exposes the v4 API)
- `@google-cloud/storage` ^7.21.0 - GCS client used against Replit Object Storage sidecar (`artifacts/api-server/src/lib/objectStorage.ts`)
- `pg` ^8.22.0 - Postgres driver (`lib/db/src/index.ts`, node-postgres `Pool`)

**Infrastructure:**
- `pino` ^9.14.0 + `pino-http` ^10.5.0 + `pino-pretty` ^13.1.3 - Structured logging (`artifacts/api-server/src/lib/logger.ts`)
- `cors` ^2.8.6, `cookie-parser` ^1.4.7 - HTTP middleware
- `http-proxy-middleware` ^4.1.1 - Clerk Frontend API proxy (`src/middlewares/clerkProxyMiddleware.ts`)
- `google-auth-library` ^10.9.0 - Auth for GCS client
- ffmpeg / ffprobe (system binaries, not npm) - Video compilation in `src/lib/videoWorker.ts`
- Radix UI (`@radix-ui/react-*`) - Web component primitives (shadcn-style)
- Expo native modules: `expo-camera`, `expo-image-picker`, `expo-av`, `expo-notifications`, `expo-secure-store`, `expo-location`, `expo-haptics`, etc.

## Configuration

**Environment:**
- No `.env` files committed (none detected). Env is supplied by the Replit runtime and connector tooling.
- Required: `DATABASE_URL` (Postgres connection string, auto-provisioned). Hard-failed at import in `lib/db/src/index.ts` and `lib/db/drizzle.config.ts`.
- `PORT` (defaults to `5000` via `.replit` `userenv.shared`); server throws if unset (`src/index.ts`)
- Clerk: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- Object Storage: `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`
- Email: `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (optional — dry-run logging if unset)
- Replit/Stripe connector: `REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY`, `WEB_REPL_RENEWAL`, `REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN`
- Logging: `LOG_LEVEL`, `NODE_ENV`

**Build:**
- `artifacts/api-server/build.mjs` - esbuild bundle config (ESM output, large `external` list for native modules)
- `tsconfig.base.json` / `tsconfig.json` - shared TS config; `customConditions: ["workspace"]` resolves workspace package `exports`
- `lib/api-spec/orval.config.ts` - codegen config (two targets: `api-client-react`, `zod`)
- `lib/db/drizzle.config.ts` - drizzle-kit (dialect `postgresql`)
- Vite configs per web artifact (`vite.config.ts`)

## Platform Requirements

**Development:**
- Replit workspace (PNPM_WORKSPACE stack, Nix channel `stable-25_05`, GitHub integration)
- Workflow "Start API server": `pnpm --filter @workspace/api-server run dev`, waits for port 5000
- System binaries: `ffmpeg`, `ffprobe` on PATH (video worker)
- pnpm-only; node 24 + python 3.11 modules

**Production:**
- Replit Autoscale deployment (`.replit` `deploymentTarget = "autoscale"`, `router = "application"`)
- Post-build: `pnpm store prune` (`.replit` `deployment.postBuild`)
- Object Storage sidecar reachable at `http://127.0.0.1:1106` (presigned URLs + auth tokens)
- Stripe + Clerk are Replit-managed integrations (no external dashboards)

---

*Stack analysis: 2026-06-28*
