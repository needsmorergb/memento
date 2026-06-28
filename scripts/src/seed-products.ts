import { getUncachableStripeClient } from "./stripeClient.ts";

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
    console.log(`✓ Pro Host product already exists: ${proProduct.id}`);
  } else {
    proProduct = await stripe.products.create({
      name: "Momento Pro Host",
      description:
        "Unlimited events, up to 5-minute same-day edit videos, and priority processing.",
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
    console.log(
      `✓ Vendor product already exists: ${existingVendor.data[0].id}`,
    );
  } else {
    const vendorProduct = await stripe.products.create({
      name: "Momento Vendor",
      description:
        "Everything in Pro, plus vendor referral codes that give clients 3-minute edits.",
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
