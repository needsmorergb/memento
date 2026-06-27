import app from "./app";
import { logger } from "./lib/logger";
import { startVideoWorker } from "./lib/videoWorker";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./lib/stripeClient";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function initStripe(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set — skipping Stripe initialisation");
    return;
  }

  try {
    logger.info("Initialising Stripe schema…");
    await runMigrations({ databaseUrl });
    logger.info("Stripe schema ready");

    const stripeSync = await getStripeSync();

    const webhookBaseUrl = process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
      : null;

    if (webhookBaseUrl) {
      await stripeSync.findOrCreateManagedWebhook(
        `${webhookBaseUrl}/api/stripe/webhook`,
      );
      logger.info("Stripe managed webhook configured");
    } else {
      logger.warn(
        "REPLIT_DOMAINS not set — skipping managed webhook registration",
      );
    }

    // Backfill in background so server starts immediately
    stripeSync
      .syncBackfill()
      .then(() => logger.info("Stripe data backfill complete"))
      .catch((err) => logger.warn({ err }, "Stripe backfill warning"));
  } catch (err) {
    logger.warn(
      { err },
      "Stripe initialisation skipped — connect Stripe in the Integrations tab",
    );
  }
}

await initStripe();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startVideoWorker();
});
