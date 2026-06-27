import { logger } from "./logger";

type GuestRow = typeof import("@workspace/db/schema").eventGuestsTable.$inferSelect;
type EventRow = typeof import("@workspace/db/schema").eventsTable.$inferSelect;
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

async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_EMAIL ?? "Memento <no-reply@memento.app>";

  if (!apiKey) {
    logger.info(
      { to: opts.to, subject: opts.subject },
      "[email dry-run] RESEND_API_KEY not set — skipping send",
    );
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
  const results = await Promise.allSettled(
    guestsWithEmail.map((guest) =>
      sendEmail({
        to: guest.email!,
        subject,
        html: buildGuestEmailHtml({ guestName: guest.displayName, eventTitle: event.title, videoUrl }),
      }),
    ),
  );
  const failures = results.filter((r) => r.status === "rejected").length;
  logger.info(
    { count: guestsWithEmail.length, failures, eventId: event.id },
    "Guest emails dispatched",
  );
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
  await sendEmail({
    to: host.email,
    subject,
    html: buildHostEmailHtml({ hostName: host.displayName ?? "there", eventTitle: event.title, videoUrl, guestCount, mediaCount, tier }),
  });
}

// ── Email Templates ────────────────────────────────────────────────────────

function buildGuestEmailHtml(opts: {
  guestName: string;
  eventTitle: string;
  videoUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#f5f5f5;">
  <div style="max-width:600px;margin:40px auto;background:#1a1a1a;border-radius:16px;overflow:hidden;">

    <!-- Hero -->
    <div style="background:linear-gradient(135deg,#7c3aed,#2563eb);padding:40px;text-align:center;">
      <div style="font-size:52px;margin-bottom:8px;">🎬</div>
      <h1 style="margin:0;font-size:26px;font-weight:700;color:#fff;">Your edit is ready</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:15px;">${escapeHtml(opts.eventTitle)}</p>
    </div>

    <!-- Body -->
    <div style="padding:32px 40px;">
      <p style="font-size:16px;color:#d1d5db;margin:0 0 20px;">
        Hi ${escapeHtml(opts.guestName)}, your same-day edit is compiled and waiting for you!
      </p>

      <!-- Primary CTA -->
      <div style="text-align:center;margin:28px 0;">
        <a href="${opts.videoUrl}"
           style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;
                  text-decoration:none;padding:16px 44px;border-radius:50px;font-size:17px;font-weight:600;">
          ▶&nbsp; Watch your memories
        </a>
      </div>

      <p style="font-size:13px;color:#6b7280;text-align:center;margin:0 0 28px;">
        Link expires in 7 days — download the video to keep it forever.
      </p>

      <!-- Divider -->
      <hr style="border:none;border-top:1px solid #2d2d2d;margin:0 0 28px;" />

      <!-- Secondary CTAs -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <!-- Download App -->
          <td width="50%" style="padding:0 8px 0 0;vertical-align:top;">
            <div style="background:#242424;border-radius:12px;padding:20px;text-align:center;">
              <div style="font-size:28px;margin-bottom:8px;">📱</div>
              <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#e5e7eb;">Get the app</p>
              <p style="margin:0 0 12px;font-size:12px;color:#9ca3af;">
                Upload, browse, and relive every moment from your phone.
              </p>
              <a href="https://memento.app/download"
                 style="display:inline-block;background:#3d3d3d;color:#c4b5fd;text-decoration:none;
                        padding:8px 18px;border-radius:20px;font-size:13px;font-weight:500;">
                Download free →
              </a>
            </div>
          </td>
          <!-- Upgrade -->
          <td width="50%" style="padding:0 0 0 8px;vertical-align:top;">
            <div style="background:#242424;border-radius:12px;padding:20px;text-align:center;">
              <div style="font-size:28px;margin-bottom:8px;">✨</div>
              <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#e5e7eb;">Longer edits</p>
              <p style="margin:0 0 12px;font-size:12px;color:#9ca3af;">
                Upgrade to Pro for up to 5-minute same-day edits at 1080p.
              </p>
              <a href="https://memento.app/upgrade"
                 style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#2563eb);
                        color:#fff;text-decoration:none;padding:8px 18px;border-radius:20px;
                        font-size:13px;font-weight:500;">
                Upgrade →
              </a>
            </div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Footer -->
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
  const isPro = opts.tier === "pro";
  const isVendor = opts.tier === "vendor";
  const tierLabel = isPro ? "Pro" : isVendor ? "Vendor" : "Free";

  // Tier-specific upgrade/download section
  const upgradeBlock = isPro || isVendor
    ? `<!-- Pro/Vendor: full-resolution download -->
       <div style="background:#1e1b4b;border:1px solid #4338ca;border-radius:12px;padding:20px;margin-bottom:24px;text-align:center;">
         <div style="font-size:28px;margin-bottom:8px;">⬇️</div>
         <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#c7d2fe;">Full-resolution download</p>
         <p style="margin:0 0 12px;font-size:13px;color:#a5b4fc;">
           As a ${tierLabel} member you get the full-quality version — great for sharing or archiving.
         </p>
         <a href="${opts.videoUrl}"
            style="display:inline-block;background:#4338ca;color:#fff;text-decoration:none;
                   padding:10px 24px;border-radius:20px;font-size:13px;font-weight:600;">
           Download full-res video →
         </a>
       </div>`
    : `<!-- Free: upgrade prompt -->
       <div style="background:#1c1917;border:1px solid #78350f;border-radius:12px;padding:20px;margin-bottom:24px;text-align:center;">
         <div style="font-size:28px;margin-bottom:8px;">✨</div>
         <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#fde68a;">Your edit is limited to 60 seconds</p>
         <p style="margin:0 0 12px;font-size:13px;color:#fcd34d;">
           Upgrade to <strong>Pro</strong> to unlock up to 5-minute edits at full 1080p quality for every future event.
         </p>
         <a href="https://memento.app/upgrade"
            style="display:inline-block;background:linear-gradient(135deg,#d97706,#b45309);color:#fff;
                   text-decoration:none;padding:10px 24px;border-radius:20px;font-size:13px;font-weight:600;">
           Upgrade to Pro →
         </a>
       </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#f5f5f5;">
  <div style="max-width:600px;margin:40px auto;background:#1a1a1a;border-radius:16px;overflow:hidden;">

    <!-- Hero -->
    <div style="background:linear-gradient(135deg,#7c3aed,#2563eb);padding:40px;text-align:center;">
      <div style="font-size:52px;margin-bottom:8px;">🎉</div>
      <h1 style="margin:0;font-size:26px;font-weight:700;color:#fff;">Event complete!</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:15px;">${escapeHtml(opts.eventTitle)}</p>
    </div>

    <!-- Body -->
    <div style="padding:32px 40px;">
      <p style="font-size:16px;color:#d1d5db;margin:0 0 24px;">
        Hi ${escapeHtml(opts.hostName)}, your same-day edit is ready. Here's a quick look at how it went:
      </p>

      <!-- Stats -->
      <div style="background:#242424;border-radius:12px;padding:20px 16px;margin-bottom:24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;text-align:center;">
          <tr>
            <td style="padding:0 8px;">
              <div style="font-size:30px;font-weight:700;color:#a78bfa;">${opts.guestCount}</div>
              <div style="font-size:12px;color:#9ca3af;margin-top:2px;">Guests</div>
            </td>
            <td style="border-left:1px solid #3d3d3d;padding:0 8px;">
              <div style="font-size:30px;font-weight:700;color:#60a5fa;">${opts.mediaCount}</div>
              <div style="font-size:12px;color:#9ca3af;margin-top:2px;">Media items</div>
            </td>
            <td style="border-left:1px solid #3d3d3d;padding:0 8px;">
              <div style="font-size:30px;font-weight:700;color:#34d399;">${tierLabel}</div>
              <div style="font-size:12px;color:#9ca3af;margin-top:2px;">Tier</div>
            </td>
          </tr>
        </table>
      </div>

      <!-- Primary watch CTA -->
      <div style="text-align:center;margin:0 0 24px;">
        <a href="${opts.videoUrl}"
           style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;
                  text-decoration:none;padding:16px 44px;border-radius:50px;font-size:17px;font-weight:600;">
          ▶&nbsp; Watch your edit
        </a>
      </div>

      <!-- Divider -->
      <hr style="border:none;border-top:1px solid #2d2d2d;margin:0 0 24px;" />

      <!-- Tier-conditional block -->
      ${upgradeBlock}

      <p style="font-size:13px;color:#6b7280;text-align:center;margin:0;">
        All guests who uploaded media have been notified. Video link expires in 7 days.
      </p>
    </div>

    <!-- Footer -->
    <div style="padding:20px 40px;border-top:1px solid #2d2d2d;text-align:center;">
      <p style="font-size:12px;color:#6b7280;margin:0;">Made with Memento — capture every moment</p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
