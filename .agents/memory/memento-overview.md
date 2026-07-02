---
name: Momento project overview
description: Stack, API client patterns, and key architectural facts for the Momento wedding/event media-sharing app
---

# Momento Project Overview

## Stack
- pnpm workspaces monorepo, Node.js 24, TypeScript 5.9
- Backend: Express 5, PostgreSQL + Drizzle ORM, Clerk auth, Replit Object Storage
- Frontend: React + Vite + Wouter (SPA), `@workspace/api-client-react` (Orval-generated hooks)
- API client generated from OpenAPI spec into `lib/api-client-react/src/generated/api.ts`

## Key architectural facts
- API base URL is `/api`; Clerk proxy is `/api/__clerk`
- Two API server workflows exist — "artifacts/api-server: API Server" (port 8080, the registered artifact)
- Web artifact port: 25102; preview path: `/`
- Guest join is unauthenticated; guest token stored in localStorage as `memento_guest_${eventId}`

## API client patterns
- Query hooks: `useGetEvent(id)`, `useListEventMedia(eventId)`, etc.
- Query key functions: `getGetEventQueryKey(id)`, `getListEventMediaQueryKey(eventId)`, etc.
- Mutation hooks: `useCreateEvent()`, `useEndEvent()`, etc. — variables passed to `.mutate({ data: ... })`
- The `request` option (for custom headers) is set at hook level: `useRequestUploadUrl({ request: { headers: { "X-Guest-Token": token } } })`
- NOT at `.mutate()` call level — the generated mutations don't support per-call headers

**Why:** Orval codegen pattern — `SecondParameter<typeof customFetch>` is baked into mutation options, not variables.

## Theme
- Background: warm linen `hsl(36 33% 96%)`
- Primary: rust/terracotta `hsl(13 49% 48%)`
- Foreground/espresso: `hsl(30 15% 16%)`
- Fonts: Outfit (sans), Playfair Display (serif)
