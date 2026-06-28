# Roadmap: Olla

## Overview

A focused "ship next features" milestone on a working brownfield product, structured as four vertical MVP slices — one per theme. Each phase delivers an end-to-end user capability across the API and both clients (web + mobile), riding the existing spec-first codegen pipeline (`openapi.yaml` → Orval, `schema/index.ts` → Drizzle). We start where the core value lives — making same-day-edit video delivery host-controlled and correctly timed — then harden host control and guest safety (live monitoring + guest revocation), open up the live shared gallery for guests, and finish by unifying vendor-code provisioning behind a single path with a vendor-facing benefits view.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Same-Day-Edit Video Control** - Host previews, approves or re-generates the edit before it ships, with voice notes timed to capture
- [ ] **Phase 2: Host Dashboard & Guest Control** - Live upload monitoring, guest list, and remove-guest that immediately revokes the token
- [ ] **Phase 3: Live Shared Gallery** - Guests browse all event media live, with new uploads appearing without a page reload
- [ ] **Phase 4: Vendor Provisioning & Benefits** - One unified vendor-code path with consistent metadata plus a vendor referral/benefits view

## Phase Details

### Phase 1: Same-Day-Edit Video Control
**Goal**: Host controls the same-day-edit video — previewing and approving or re-generating it before guests receive it — and voice notes land at the moment they were captured.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: VIDEO-01, VIDEO-02, VIDEO-03
**Success Criteria** (what must be TRUE):
  1. When an event ends, the compiled video is held for host review and is NOT auto-delivered to guests
  2. Host can watch the compiled same-day-edit video in-app (web and mobile) before any guest is notified
  3. Host can approve delivery, which then fans out push + email to guests; or trigger a re-generation that produces a fresh video for review
  4. Clients send a capture timestamp with each uploaded media item, and voice notes are positioned in the compiled video by that capture time rather than server confirm time
**Plans**: TBD
**UI hint**: yes

### Phase 2: Host Dashboard & Guest Control
**Goal**: Host can monitor an in-progress event and manage who has access — including removing a guest so their token can no longer upload or view media.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: HOST-01, HOST-02, HOST-03
**Success Criteria** (what must be TRUE):
  1. Host sees the upload count and newest media update live (near-real-time) while an event is in progress, without manually refreshing
  2. Host can view the list of guests who have joined an event
  3. Host can remove a guest, after which that guest's token immediately fails on upload and media/view endpoints (auth filters soft-deleted guests)
  4. A removed guest's existing media remains attributed correctly while the token is rejected on all subsequent guest-authenticated calls
**Plans**: TBD
**UI hint**: yes

### Phase 3: Live Shared Gallery
**Goal**: Guests can browse a shared gallery of all event media while the event is live, with newly captured media surfacing automatically.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: GALLERY-01, GALLERY-02
**Success Criteria** (what must be TRUE):
  1. A joined guest can open a shared gallery and see all event media (photos, videos, voice notes) captured so far, across all guests
  2. Newly uploaded media appears in the gallery (via polling) without the guest doing a full page reload
  3. Gallery access respects the guest-token model and excludes media for revoked/soft-deleted guests' access path
**Plans**: TBD
**UI hint**: yes

### Phase 4: Vendor Provisioning & Benefits
**Goal**: Vendor referral codes are created through one consistent path regardless of timing, and vendors can see their code and who has redeemed it.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: VENDOR-01, VENDOR-02
**Success Criteria** (what must be TRUE):
  1. A vendor code carries consistent benefit metadata (benefit description + duration cap) whether the vendor registers before or after checkout/webhook
  2. The two prior creation paths (`vendors.ts` and `billing.ts`) route through a single provisioning function, and registering after activation backfills missing metadata instead of short-circuiting
  3. Vendor can view their referral code in-app
  4. Vendor can see which events/guests have redeemed their code
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Same-Day-Edit Video Control | 0/TBD | Not started | - |
| 2. Host Dashboard & Guest Control | 0/TBD | Not started | - |
| 3. Live Shared Gallery | 0/TBD | Not started | - |
| 4. Vendor Provisioning & Benefits | 0/TBD | Not started | - |
