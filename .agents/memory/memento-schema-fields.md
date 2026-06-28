---
name: Momento schema field name gotchas
description: Correct field names in API response schemas — easy to confuse with intuitive names
---

# Momento Schema Field Name Gotchas

## MediaItem
- `uploaderDisplayName` — NOT `uploaderName`
- `durationSeconds` — optional, nullable
- `objectPath` — the storage path (not a URL)

## VideoJobStatus
- `tier` — NOT `qualityCap` (values: "free" | "pro" | "vendor")
- `durationCapSeconds` — optional, may be undefined
- `videoUrl` — optional, only present when `status === "completed"`

## UploadUrlRequest
- `name` — NOT `fileName`
- `size` — file size in bytes, NOT optional
- `contentType` — the MIME type
- Has NO `eventId` field (eventId goes in the confirm step URL path)

## UploadUrlResponse
- `uploadURL` — capital URL, NOT `uploadUrl`
- `objectPath` — the path to pass to confirmMediaUpload

## JoinEventResponse
- `{ guest: GuestSummary, event: PublicEventInfo }` — NOT a flat `guestToken` field
- Guest token is at `res.guest.guestToken` (optional field on GuestSummary)

## VendorCodeInfo
- `code`, `joinUrl`, `benefitDescription`, `videoDurationCapSeconds`
- Has NO `isActive` field

## GuestSummary
- `displayName` — NOT `name`
- `guestToken` — optional, this is the auth token for guest operations

## PublicEventInfo
- Has NO `shareToken` or `shareUrl` — only available on `EventSummary` (full event)
- Does NOT have `mediaCount`

**Why:** The OpenAPI spec diverges from what you'd intuitively name fields. Always check `api.schemas.ts` before writing page code.

**How to apply:** When writing new pages, grep `api.schemas.ts` for the interface before using any field.
