---
phase: 01-same-day-edit-video-control
plan: 04
subsystem: clients (memento-web host event-detail + memento-mobile event tab)
tags: [react, react-query, expo-av, shadcn, radix, video-review, security]

# Dependency graph
requires:
  - phase: 01-01
    provides: "generated hooks useApproveEventVideo / useRegenerateEventVideo / useGetEventVideoStatus(ByToken); VideoJobStatus with ready_for_review + nullable approvedAt"
  - phase: 01-02
    provides: "approve (idempotent fan-out) + regenerate (supersede) handlers; token status withholds the unapproved cut"
provides:
  - "Web host 'Review same-day edit' card: ready_for_review branch with <video> player + Approve & notify guests (primary Dialog confirm) and Regenerate edit (outline confirm)"
  - "Web approved/delivered green success state (no action buttons) + failed destructive state with Regenerate recovery"
  - "Mobile host review card driven by the AUTHED useGetEventVideoStatus (gated by isHost), never the public token hook"
  - "Mobile ready_for_review branch: expo-av Video player + Approve/Regenerate behind Alert.alert confirms; approved/failed states"
affects: [] # final vertical slice of the phase
provides-requirements: [VIDEO-01, VIDEO-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Host review card consumes the authed video-status hook on both clients (web already authed; mobile switched off the public token hook)"
    - "High-consequence Approve action gated behind an informed confirm (web Dialog mirroring showEndDialog; mobile Alert.alert mirroring handleEndEvent) naming push + email + un-sendable"
    - "Reuse existing refetchInterval polling (3000ms while pending/processing) — no new polling mechanism"
    - "Mutations via the generated imperative functions (approveEventVideo/regenerateEventVideo) with getToken() Authorization header on mobile; generated useApprove/useRegenerate mutation hooks on web; invalidate getGetEventVideoStatusQueryKey on success"

key-files:
  created: []
  modified:
    - artifacts/memento-web/src/pages/host/event-detail.tsx
    - artifacts/memento-mobile/app/(tabs)/event.tsx

key-decisions:
  - "Mobile keeps BOTH video-status hooks: authed useGetEventVideoStatus for the host (gated by isHost) and the public useGetEventVideoStatusByToken for the guest path; videoStatus = isHost ? hostVideoStatus : guestVideoStatus. This satisfies the security requirement (T-04-01) — the host's review card is never driven by the public path."
  - "Mobile mutations use the imperative approveEventVideo/regenerateEventVideo functions + getToken() Authorization header (mirroring the existing endEvent pattern) rather than the mutation hooks, with useQueryClient invalidation — consistent with the file's established imperative auth pattern."
  - "Web reuses the generated useApproveEventVideo/useRegenerateEventVideo mutation hooks and invalidates both getGetEventVideoStatusQueryKey + getGetEventQueryKey on success."
  - "completed + approvedAt maps to the 'Approved & delivered' success treatment (per 01-01 status model: approved => completed). No re-send actions in this state."

patterns-established:
  - "Pre-approval states reassure 'guests haven't been notified yet'; Approve confirm names both channels (push + email) and the un-sendable fan-out"
  - "Approved state removes both action buttons so an edit cannot be re-sent"

requirements-completed: [VIDEO-01, VIDEO-02]

# Metrics
duration: ~3min
completed: 2026-06-29
---

# Phase 1 Plan 04: Host Review UI (web + mobile) Summary

**Host-facing 'Review same-day edit' card on both clients — an in-app video player plus Approve & notify guests (primary, behind an informed push+email confirm) and Regenerate edit (outline, lighter confirm), reusing the existing video-status polling. The mobile host card is moved OFF the public `useGetEventVideoStatusByToken` ONTO the authed `useGetEventVideoStatus`, so the unapproved review cut is never served on the public path.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-29T04:36:36Z
- **Completed:** 2026-06-29T04:39:47Z
- **Tasks:** 2 implementation (Task 3 is a human-verify checkpoint)
- **Files modified:** 2

## Accomplishments

- **Web (Task 1):** Added a `ready_for_review` branch to the `event-detail.tsx` video card (before `completed`) that renders the existing `<video controls>` player at `videoStatus.videoUrl`, a primary `Approve & notify guests` button, and an `outline` `Regenerate edit` button. Approve opens a `Dialog` confirm (title `Send this edit to all guests?`, body naming push + email + un-sendable, confirm `Approve & notify` / cancel `Keep reviewing`) → `useApproveEventVideo`; Regenerate opens a lighter `Dialog` confirm → `useRegenerateEventVideo`. Both invalidate `getGetEventVideoStatusQueryKey(eventId)` + `getGetEventQueryKey(eventId)` and toast on success/error. Added a distinct `completed` "Approved & delivered" green success state (`CheckCircle`, `text-green-600`) with no action buttons, and reworked `failed` into a destructive card with a `Regenerate edit` recovery. Pending labels `Approving…` / `Regenerating…`.
- **Mobile (Task 2):** **SECURITY-CRITICAL hook switch** — the host review card now reads the authed `useGetEventVideoStatus(eventId, ...)` (gated by `isHost`, polling 3000ms while pending/processing); the public `useGetEventVideoStatusByToken` remains only for the guest path (`videoStatus = isHost ? hostVideoStatus : guestVideoStatus`). Added a `ready_for_review` branch with an `expo-av` `Video` player (`ResizeMode.CONTAIN`, `useNativeControls`, sized 16:9 card — not absoluteFill), a primary `Approve & notify guests` button, and an outline `Regenerate edit` button, each behind an `Alert.alert` confirm mirroring `handleEndEvent` with copy matching web. Approved (`completed`) shows the existing green success card with no actions; `failed` shows the error + a host-only Regenerate recovery. Mutations use the imperative `approveEventVideo`/`regenerateEventVideo` + `getToken()` Authorization header, then invalidate the authed `getGetEventVideoStatusQueryKey`.

## Task Commits

1. **Task 1: Web host review card — player + Approve/Regenerate** — `63883d0` (feat)
2. **Task 2: Mobile host review card — authed hook switch + expo-av player + confirms** — `1950b85` (feat)

## Files Created/Modified

- `artifacts/memento-web/src/pages/host/event-detail.tsx` — imported `useApproveEventVideo`/`useRegenerateEventVideo`; added approve/regenerate mutation handlers + dialog state; `ready_for_review` (player + actions), `completed` (approved success), and `failed` (destructive + Regenerate) branches; Approve + Regenerate confirm Dialogs.
- `artifacts/memento-mobile/app/(tabs)/event.tsx` — imported `useGetEventVideoStatus` (authed), `approveEventVideo`/`regenerateEventVideo`, `ResizeMode`/`Video`, `useQueryClient`, `getGetEventVideoStatusQueryKey`; switched host card to the authed hook; added approve/regenerate Alert handlers; `ready_for_review` branch (expo-av player + Approve/Regenerate), refined `completed`/`failed` states; new `reviewVideo`/`outlineBtn` styles.

## Decisions Made

- **Mobile dual-hook gating** (security): the host card is bound to the authed hook only; the public token hook is restricted to `!isHost`. This is the mitigation for threat T-04-01 (review cut never served on the public path); the backend gate from Plan 02 is the authoritative second layer.
- **Imperative mobile mutations** consistent with the file's existing `endEvent(eventId, { headers: { Authorization } })` pattern, plus `useQueryClient` invalidation — avoids introducing a second mutation style in the same file.
- **Web mutation hooks** (`useApproveEventVideo`/`useRegenerateEventVideo`) used directly, matching the existing `useEndEvent`/`useDeleteEvent` style in the file.

## Deviations from Plan

None — both implementation tasks executed exactly as written. The plan's `<verify>` blocks reference a Windows path (`cd D:/apaul/Documents/memento`); the actual verification ran from the local repo root `/Users/fresh-mac/memento` (path-only difference, same commands). No code changes resulted.

## Issues Encountered

- `pnpm --filter @workspace/memento-web run typecheck` does not exit 0 due to the **pre-existing** `@types/react` 19 duplicate-instance errors in `src/components/ui/calendar.tsx` and `src/components/ui/spinner.tsx` (documented as out-of-scope in 01-01's Deferred Issues and the execution environment notes). Confirmed `event-detail.tsx` itself has **zero** typecheck errors (the only erroring files are those two radix-derived components). `memento-mobile` typecheck exits 0 cleanly.

## Deferred Issues

- Pre-existing `@types/react` 19 duplicate-instance typecheck failures in `memento-web` `components/ui/{calendar,spinner}.tsx` (and `mockup-sandbox`). Untouched by this plan; out of scope.

## Known Stubs

None. The "placeholder" string matches in `event.tsx` are pre-existing `TextInput placeholder=` props on the host sign-in form, not data stubs.

## Threat Flags

None — no new network/auth/file/schema surface. The plan's threat register (T-04-01 host-card-on-authed-hook, T-04-02 informed Approve confirm) is satisfied; T-04-03/T-04-SC were `accept`. The authoritative security boundary (token gate, host-only approve/regenerate) lives server-side in Plan 02; this UI consumes it.

## User Setup Required

None.

## Self-Check: PASSED
- FOUND: artifacts/memento-web/src/pages/host/event-detail.tsx
- FOUND: artifacts/memento-mobile/app/(tabs)/event.tsx
- FOUND commit: 63883d0
- FOUND commit: 1950b85
- Verified: web grep `useApproveEventVideo|useRegenerateEventVideo|ready_for_review` = 6 (>= 3); event-detail.tsx typechecks clean (only pre-existing radix errors remain).
- Verified: mobile authed `useGetEventVideoStatus` present and distinct from `...ByToken`; grep `ready_for_review|Approve & notify guests` = 3 (>= 2); memento-mobile typecheck exits 0.
- Security verified: mobile `videoStatus = isHost ? hostVideoStatus : guestVideoStatus`; host card never reads the public token hook.

## Checkpoint Status

Task 3 is a `checkpoint:human-verify` gate (autonomous:false). All build work is complete and committed; the visual/interaction contract on web + mobile awaits human verification. See the checkpoint return relayed to the orchestrator. No visual confirmation has been fabricated.

---
*Phase: 01-same-day-edit-video-control*
*Completed: 2026-06-29*
