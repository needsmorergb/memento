import { getUncachableStripeClient } from "./stripeClient.ts";

const PRO_NAME = "Momento Pro Host";
const PRO_DESCRIPTION =
  "Unlimited events, up to 5-minute same-day edit videos, and priority processing.";
const VENDOR_NAME = "Momento Vendor";
const VENDOR_DESCRIPTION =
  "Everything in Pro, plus vendor referral codes that give clients 3-minute edits.";

async function seedProducts() {
  const stripe = await getUncachableStripeClient();
  console.log("Seeding Stripe products for Momento...");

  // ── Pro Host Plan ──────────────────────────────────────────────────────────

  const existingPro = await stripe.products.search({
    query: "metadata['tier']:'pro' AND active:'true'",
  });

  let proProduct: { id: string };
  if (existingPro.data.length > 0) {
    proProduct = existingPro.data[0];
    // Apply current branding/copy to the already-seeded product. Without this,
    // accounts initialised before a rebrand keep stale names on billing surfaces
    // (GET /billing/prices exposes product.name).
    await stripe.products.update(proProduct.id, {
      name: PRO_NAME,
      description: PRO_DESCRIPTION,
    });
    console.log(`✓ Updated existing Pro Host product: ${proProduct.id}`);
  } else {
    proProduct = await stripe.products.create({
      name: PRO_NAME,
      description: PRO_DESCRIPTION,
      metadata: { tier: "pro" },
    });
    console.log(`✓ Created Pro Host product: ${proProduct.id}`);

    const proMonthly = await stripe.prices.create({
      product: proProduct.id,
      unit_amount: 2900,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: { tier: "pro", interval: "month" },
    });
    console.log(`  · Monthly price $29/mo: ${proMonthly.id}`);

    const proAnnual = await stripe.prices.create({
      product: proProduct.id,
      unit_amount: 29000,
      currency: "usd",
      recurring: { interval: "year" },
      metadata: { tier: "pro", interval: "year" },
    });
    console.log(`  · Annual price $290/yr: ${proAnnual.id}`);
  }

  // ── Vendor Plan ────────────────────────────────────────────────────────────

  const existingVendor = await stripe.products.search({
    query: "metadata['tier']:'vendor' AND active:'true'",
  });

  if (existingVendor.data.length > 0) {
    await stripe.products.update(existingVendor.data[0].id, {
      name: VENDOR_NAME,
      description: VENDOR_DESCRIPTION,
    });
    console.log(
      `✓ Updated existing Vendor product: ${existingVendor.data[0].id}`,
    );
  } else {
    const vendorProduct = await stripe.products.create({
      name: VENDOR_NAME,
      description: VENDOR_DESCRIPTION,
      metadata: { tier: "vendor" },
    });
    console.log(`✓ Created Vendor product: ${vendorProduct.id}`);

    const vendorMonthly = await stripe.prices.create({
      product: vendorProduct.id,
      unit_amount: 9900,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: { tier: "vendor", interval: "month" },
    });
    console.log(`  · Monthly price $99/mo: ${vendorMonthly.id}`);
  }

  console.log("\n✓ Done. Webhooks will sync these products to the database.");
  console.log(
    '  Run the API server and call GET /api/billing/prices to verify.',
  );
}

seedProducts().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
