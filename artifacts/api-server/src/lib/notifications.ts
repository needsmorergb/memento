import type { EventGuest, Event, User } from "@workspace/db/schema";
import { logger } from "./logger";

type EventRow = typeof import("@workspace/db/schema").eventsTable.$inferSelect;
type GuestRow = typeof import("@workspace/db/schema").eventGuestsTable.$inferSelect;
type UserRow = typeof import("@workspace/db/schema").usersTable.$inferSelect;

// ── Expo Push Notifications ────────────────────────────────────────────────

interface ExpoPushMessage {
  to: string;
  sound?: "default" | null;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  badge?: number;
}

export async function sendPushNotifications(
  guests: GuestRow[],
  eventTitle: string,
  videoUrl: string,
): Promise<void> {
  const tokens = guests
    .filter((g) => g.pushToken && g.pushToken.startsWith("ExponentPushToken"))
    .map((g) => g.pushToken!);

  if (tokens.length === 0) {
    logger.info("No push tokens to notify");
    return;
  }

  const messages: ExpoPushMessage[] = tokens.map((token) => ({
    to: token,
    sound: "default",
    title: `${eventTitle} — same-day edit ready 🎬`,
    body: "Your memories are compiled. Tap to watch!",
    data: { videoUrl, eventTitle, screen: "video" },
    badge: 1,
  }));

  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, text }, "Expo push API returned non-2xx");
    } else {
      const json = await res.json();
      logger.info({ tokenCount: tokens.length, response: json }, "Push notifications sent");
    }
  } catch (err) {
    logger.error({ err }, "Failed to send push notifications");
  }
}

// ── Email via Resend ───────────────────────────────────────────────────────

async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_EMAIL ?? "Memento <no-reply@memento.app>";

  if (!apiKey) {
    logger.info({ to: opts.to, subject: opts.subject }, "[email dry-run] Would send email (no RESEND_API_KEY)");
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, text, to: opts.to }, "Resend returned non-2xx");
    } else {
      logger.info({ to: opts.to, subject: opts.subject }, "Email sent via Resend");
    }
  } catch (err) {
    logger.error({ err, to: opts.to }, "Failed to send email");
  }
}

export async function sendGuestEmails(
  guests: GuestRow[],
  event: EventRow,
  videoUrl: string,
): Promise<void> {
  const guestsWithEmail = guests.filter((g) => g.email);
  if (guestsWithEmail.length === 0) return;

  const subject = `Your ${event.title} memories are ready to watch 🎬`;
  const promises = guestsWithEmail.map((guest) => {
    const html = buildGuestEmailHtml({
      guestName: guest.displayName,
      eventTitle: event.title,
      videoUrl,
    });
    return sendEmail({ to: guest.email!, subject, html });
  });

  await Promise.allSettled(promises);
  logger.info({ count: guestsWithEmail.length, eventId: event.id }, "Guest emails dispatched");
}

export async function sendHostEmail(
  host: UserRow,
  event: EventRow,
  videoUrl: string,
  guestCount: number,
  mediaCount: number,
  tier: string,
): Promise<void> {
  if (!host.email) return;

  const subject = `Your ${event.title} same-day edit is ready 🎬`;
  const html = buildHostEmailHtml({
    hostName: host.displayName ?? "there",
    eventTitle: event.title,
    videoUrl,
    guestCount,
    mediaCount,
    tier,
  });

  await sendEmail({ to: host.email, subject, html });
}

// ── Email Templates ────────────────────────────────────────────────────────

function buildGuestEmailHtml(opts: {
  guestName: string;
  eventTitle: string;
  videoUrl: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#f5f5f5;">
  <div style="max-width:600px;margin:40px auto;background:#1a1a1a;border-radius:16px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#7c3aed,#2563eb);padding:40px;text-align:center;">
      <div style="font-size:48px;margin-bottom:8px;">🎬</div>
      <h1 style="margin:0;font-size:28px;font-weight:700;color:#fff;">Your edit is ready</h1>
    </div>
    <div style="padding:32px 40px;">
      <p style="font-size:16px;color:#d1d5db;margin:0 0 8px;">Hi ${escapeHtml(opts.guestName)},</p>
      <p style="font-size:16px;color:#d1d5db;margin:0 0 24px;">
        The same-day edit from <strong style="color:#fff;">${escapeHtml(opts.eventTitle)}</strong> is compiled and ready to watch!
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${opts.videoUrl}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;text-decoration:none;padding:16px 40px;border-radius:50px;font-size:18px;font-weight:600;">
          Watch your memories ▶
        </a>
      </div>
      <p style="font-size:13px;color:#6b7280;margin:24px 0 0;text-align:center;">
        This link expires in 7 days. Download your video to keep it forever.
      </p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #2d2d2d;text-align:center;">
      <p style="font-size:12px;color:#6b7280;margin:0;">Made with Memento — capture every moment</p>
    </div>
  </div>
</body>
</html>`;
}

function buildHostEmailHtml(opts: {
  hostName: string;
  eventTitle: string;
  videoUrl: string;
  guestCount: number;
  mediaCount: number;
  tier: string;
}): string {
  const tierLabel = opts.tier === "pro" ? "Pro" : opts.tier === "vendor" ? "Vendor" : "Free";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#f5f5f5;">
  <div style="max-width:600px;margin:40px auto;background:#1a1a1a;border-radius:16px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#7c3aed,#2563eb);padding:40px;text-align:center;">
      <div style="font-size:48px;margin-bottom:8px;">🎉</div>
      <h1 style="margin:0;font-size:28px;font-weight:700;color:#fff;">Event complete!</h1>
    </div>
    <div style="padding:32px 40px;">
      <p style="font-size:16px;color:#d1d5db;margin:0 0 8px;">Hi ${escapeHtml(opts.hostName)},</p>
      <p style="font-size:16px;color:#d1d5db;margin:0 0 24px;">
        Your <strong style="color:#fff;">${escapeHtml(opts.eventTitle)}</strong> same-day edit is ready. Here's a quick summary:
      </p>
      <div style="background:#2d2d2d;border-radius:12px;padding:20px;margin-bottom:24px;">
        <div style="display:flex;justify-content:space-around;text-align:center;">
          <div>
            <div style="font-size:32px;font-weight:700;color:#a78bfa;">${opts.guestCount}</div>
            <div style="font-size:13px;color:#9ca3af;">Guests</div>
          </div>
          <div style="border-left:1px solid #3d3d3d;"></div>
          <div>
            <div style="font-size:32px;font-weight:700;color:#60a5fa;">${opts.mediaCount}</div>
            <div style="font-size:13px;color:#9ca3af;">Media items</div>
          </div>
          <div style="border-left:1px solid #3d3d3d;"></div>
          <div>
            <div style="font-size:32px;font-weight:700;color:#34d399;">${tierLabel}</div>
            <div style="font-size:13px;color:#9ca3af;">Tier</div>
          </div>
        </div>
      </div>
      <div style="text-align:center;margin:32px 0;">
        <a href="${opts.videoUrl}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;text-decoration:none;padding:16px 40px;border-radius:50px;font-size:18px;font-weight:600;">
          Watch your edit ▶
        </a>
      </div>
      <p style="font-size:13px;color:#6b7280;margin:24px 0 0;text-align:center;">
        Notifications have been sent to all guests. This link expires in 7 days.
      </p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #2d2d2d;text-align:center;">
      <p style="font-size:12px;color:#6b7280;margin:0;">Made with Memento — capture every moment</p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
