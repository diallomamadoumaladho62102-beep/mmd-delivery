/**
 * Poll Live certification entities after founder card payment.
 * Usage: node apps/web/scripts/enterprise-live-poll-payments.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const require = createRequire(import.meta.url);
require("dotenv").config({ path: path.join(root, "apps/web/.env.local") });
require("dotenv").config({
  path: path.join(root, "docs/production/final-certification.env"),
  override: false,
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const service =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const checkoutsPath = path.join(
  root,
  "docs/production/reports/enterprise-live-checkouts.json"
);
const checkouts = JSON.parse(fs.readFileSync(checkoutsPath, "utf8"));
const since = checkouts.generatedAt;

const result = {
  generatedAt: new Date().toISOString(),
  since,
  entities: [],
  webhooks: [],
};

for (const c of checkouts.checkouts || []) {
  if (!c.entity_id) continue;
  if (c.flow === "taxi") {
    const { data } = await admin
      .from("taxi_rides")
      .select(
        "id,payment_status,status,total_cents,stripe_payment_intent_id,stripe_checkout_session_id,fare_components"
      )
      .eq("id", c.entity_id)
      .maybeSingle();
    result.entities.push({ flow: "taxi", expected_amount_cents: c.amount_cents, row: data });
  }
  if (c.flow === "food") {
    const { data } = await admin
      .from("orders")
      .select(
        "id,payment_status,status,total_cents,stripe_payment_intent_id,stripe_checkout_session_id"
      )
      .eq("id", c.entity_id)
      .maybeSingle();
    result.entities.push({ flow: "food", expected_amount: c.amount, row: data });
  }
}

const { data: events } = await admin
  .from("stripe_webhook_events")
  .select("stripe_event_id,event_type,received_at")
  .gte("received_at", since)
  .order("received_at", { ascending: false })
    .limit(40);
result.webhooks = events || [];

const out = path.join(
  root,
  "docs/production/reports/enterprise-live-payment-poll.json"
);
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
console.log("Wrote", out);
