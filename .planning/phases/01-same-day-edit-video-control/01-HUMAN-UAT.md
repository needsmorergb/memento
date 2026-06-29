---
status: partial
phase: 01-same-day-edit-video-control
source: [01-04-PLAN.md, 01-04-SUMMARY.md]
started: "2026-06-29"
updated: "2026-06-29"
---

## Current Test

[awaiting human testing — Plan 01-04 host review UI on web + mobile]

## Prerequisites

The local stack must be running (all native, no Docker — see HANDOFF.md "Resume here"):
- Postgres :5432, MinIO :9000, API on **:5050** (PORT=5050; macOS holds :5000).
- You need an event whose same-day edit reached `ready_for_review`. Quickest path: create an
  event as host → upload a couple of guest media items → end the event → the in-process video
  worker compiles and the job lands at `ready_for_review` (it now STOPS there, no auto-notify).

## Tests

### 1. Web host review card renders
expected: `pnpm --filter @workspace/memento-web run dev` (API on :5050). As host, open an event whose edit reached `ready_for_review` → in-app video player shows, a rust **Approve & notify guests** button, an outline **Regenerate edit** button, and a status line "Ready for your review — guests haven't been notified yet".
result: [pending]

### 2. Web Approve flow (high-consequence confirm)
expected: Click **Approve** → dialog names BOTH push and email and says it can't be un-sent. "Keep reviewing" closes with no effect. "Approve & notify" → card transitions to green **Approved & delivered** with NO action buttons.
result: [pending]

### 3. Web Regenerate flow
expected: On a fresh `ready_for_review` job, click **Regenerate** → lighter confirm → card returns to a compiling/polling state; a new edit eventually returns to review.
result: [pending]

### 4. Mobile host review card (authed hook)
expected: `pnpm --filter @workspace/memento-mobile run dev`. As host on the same event, the review card appears, the expo-av player plays the cut, and Approve/Regenerate Alert copy matches web.
result: [pending]

### 5. Guest never sees the unapproved cut (security)
expected: As a **guest** (public/token path), nothing about the video is shown until AFTER approval. Code-verified (`videoStatus = isHost ? hostVideoStatus : guestVideoStatus`; token status masks `ready_for_review`→`processing` and withholds `videoUrl` until `approvedAt`), but confirm in-app.
result: [pending]

### 6. Notifications fire only after Approve
expected: Guests receive push + email only AFTER Approve — not at compile time. (Resend is dry-run unless `RESEND_API_KEY` is set, so check the API logs for the send/dry-run lines; push needs Expo tokens.)
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
