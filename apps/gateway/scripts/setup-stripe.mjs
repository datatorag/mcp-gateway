#!/usr/bin/env node
// One-shot: create Product + Meter + Prices in Stripe. Idempotent on rerun
// via metadata lookup + lookup_keys. Prints env vars to add to .env.
import Stripe from "stripe";

const apiKey = process.env.STRIPE_API_KEY;
if (!apiKey) {
  console.error("STRIPE_API_KEY required");
  process.exit(1);
}
const stripe = new Stripe(apiKey);

const PRODUCT_LOOKUP = "datatorag_pro";
const METER_EVENT = "tool_calls";

async function findOrCreateProduct() {
  const list = await stripe.products.search({
    query: `metadata['lookup']:'${PRODUCT_LOOKUP}'`,
  });
  if (list.data[0]) return list.data[0];
  return stripe.products.create({
    name: "DataToRAG Pro",
    metadata: { lookup: PRODUCT_LOOKUP },
  });
}

async function findOrCreateMeter() {
  const list = await stripe.billing.meters.list({ limit: 100 });
  const existing = list.data.find((m) => m.event_name === METER_EVENT);
  if (existing) return existing;
  return stripe.billing.meters.create({
    display_name: "Tool calls",
    event_name: METER_EVENT,
    default_aggregation: { formula: "sum" },
    customer_mapping: {
      type: "by_id",
      event_payload_key: "stripe_customer_id",
    },
    value_settings: { event_payload_key: "value" },
  });
}

async function findOrCreatePrice({ product, lookup_key, params }) {
  const list = await stripe.prices.list({ lookup_keys: [lookup_key], limit: 1 });
  if (list.data[0]) return list.data[0];
  return stripe.prices.create({
    product,
    currency: "usd",
    lookup_key,
    ...params,
  });
}

const product = await findOrCreateProduct();
console.log(`Product: ${product.id} (${product.name})`);

const meter = await findOrCreateMeter();
console.log(`Meter:   ${meter.id} (${meter.event_name})`);

const proMonthly = await findOrCreatePrice({
  product: product.id,
  lookup_key: "pro_monthly_v1",
  params: { unit_amount: 2000, recurring: { interval: "month" } },
});
const proYearly = await findOrCreatePrice({
  product: product.id,
  lookup_key: "pro_yearly_v1",
  params: { unit_amount: 20000, recurring: { interval: "year" } },
});
const proOverage = await findOrCreatePrice({
  product: product.id,
  lookup_key: "pro_overage_v1",
  params: {
    billing_scheme: "per_unit",
    unit_amount_decimal: "1", // $0.01 per call
    recurring: { interval: "month", usage_type: "metered", meter: meter.id },
  },
});
const payg = await findOrCreatePrice({
  product: product.id,
  lookup_key: "payg_v1",
  params: {
    billing_scheme: "per_unit",
    unit_amount_decimal: "2", // $0.02 per call
    recurring: { interval: "month", usage_type: "metered", meter: meter.id },
  },
});

console.log("\nAdd to your .env:\n");
console.log(`STRIPE_PRO_MONTHLY_PRICE_ID=${proMonthly.id}`);
console.log(`STRIPE_PRO_YEARLY_PRICE_ID=${proYearly.id}`);
console.log(`STRIPE_PAYG_PRICE_ID=${payg.id}`);
console.log(`STRIPE_METER_ID=${meter.id}`);
console.log(`# Pro overage price (used in Checkout config): ${proOverage.id}`);
