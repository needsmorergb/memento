# Requirements: Olla

**Defined:** 2026-06-28
**Core Value:** When an event ends, every guest receives a polished same-day-edit video built from the media they all captured together — that delivery must work reliably.

## v1 Requirements

Focused "ship next features" milestone. One high-leverage vertical slice per chosen theme. Each requirement is user-centric, testable, and atomic.

### Same-Day-Edit Video (VIDEO)

- [ ] **VIDEO-01**: Host can preview the compiled same-day-edit video before it is delivered to guests
- [ ] **VIDEO-02**: Host can approve delivery or trigger a re-generation of the video before it is sent
- [ ] **VIDEO-03**: Voice notes are positioned in the compiled video by their capture time so audio lines up with the moment it was recorded

### Host Dashboard & Control (HOST)

- [ ] **HOST-01**: Host can see uploads update live (count and newest media) while an event is in progress
- [ ] **HOST-02**: Host can view the list of guests who have joined an event
- [ ] **HOST-03**: Host can remove a guest, immediately invalidating that guest's token so it can no longer upload or view media

### Guest Capture & Gallery (GALLERY)

- [ ] **GALLERY-01**: Guests can browse a shared gallery of all event media while the event is live
- [ ] **GALLERY-02**: The shared gallery shows newly uploaded media as guests add it, without a full page reload

### Monetization & Vendor Growth (VENDOR)

- [ ] **VENDOR-01**: Vendor referral codes are created through a single unified provisioning path with consistent benefit metadata regardless of whether registration or checkout happens first
- [ ] **VENDOR-02**: Vendor can view their referral code and which events/guests have redeemed it

## v2 Requirements

Deferred — acknowledged but not in this milestone's roadmap.

### Video

- **VIDEO-04**: Host can choose a theme/music track for the same-day edit
- **VIDEO-05**: Voice-only events produce a full-length audio montage instead of a 5s placeholder

### Uploads & Safety

- **SAFE-01**: Upload confirm verifies the stored object's real size/content-type and enforces tier caps server-side
- **SAFE-02**: Per-tier maximum upload size is enforced on the presigned PUT
- **SAFE-03**: Rate limiting on guest join and upload-URL endpoints

### Reliability

- **REL-01**: Notification delivery is tracked per-recipient and retried on failure
- **REL-02**: Video transcoding runs on a dedicated worker tier with bounded concurrency

## Out of Scope

| Feature | Reason |
|---------|--------|
| Content moderation / virus scanning of uploads | Separate safety milestone, not a feature slice |
| Off-Replit portability (S3/GCS-direct, external queue) | Infrastructure refactor, not user-facing scope |
| Real-time chat between guests | Outside the capture/gallery core value |
| Net-new subscription tiers / pricing SKUs | This milestone polishes existing tiers, doesn't add pricing |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| VIDEO-01 | Phase 1 | Pending |
| VIDEO-02 | Phase 1 | Pending |
| VIDEO-03 | Phase 1 | Pending |
| HOST-01 | Phase 2 | Pending |
| HOST-02 | Phase 2 | Pending |
| HOST-03 | Phase 2 | Pending |
| GALLERY-01 | Phase 3 | Pending |
| GALLERY-02 | Phase 3 | Pending |
| VENDOR-01 | Phase 4 | Pending |
| VENDOR-02 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 10 total
- Mapped to phases: 10 ✓
- Unmapped: 0

---
*Requirements defined: 2026-06-28*
*Last updated: 2026-06-28 after roadmap creation (traceability populated)*
