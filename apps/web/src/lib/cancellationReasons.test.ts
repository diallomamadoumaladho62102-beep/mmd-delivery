import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANCEL_NOTE_MIN,
  DELIVERY_CLIENT_CANCEL_REASONS,
  DELIVERY_DRIVER_CANCEL_REASONS,
  RESTAURANT_CANCEL_REASONS,
  SELLER_CANCEL_REASONS,
  TAXI_CLIENT_CANCEL_REASONS,
  TAXI_DRIVER_CANCEL_REASONS,
  customerSafeCancelCode,
  parseStructuredCancelReason,
} from "./cancellationReasons";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

assert.deepEqual([...TAXI_CLIENT_CANCEL_REASONS], [
  "driver_not_moving",
  "driver_too_late",
  "driver_concerning_behavior",
  "passenger_feels_unsafe",
  "pickup_location_problem",
  "other",
]);
assert.equal(TAXI_CLIENT_CANCEL_REASONS.includes("changed_mind" as never), false);
assert.deepEqual([...TAXI_DRIVER_CANCEL_REASONS], [
  "customer_not_responding",
  "unsafe_pickup_location",
  "intoxicated_or_threatening_customer",
  "vehicle_problem",
  "emergency_or_personal_issue",
  "other",
]);
assert.equal([...DELIVERY_CLIENT_CANCEL_REASONS].length, 6);
assert.equal([...DELIVERY_DRIVER_CANCEL_REASONS].length, 6);
assert.equal([...RESTAURANT_CANCEL_REASONS].length, 6);
assert.equal([...SELLER_CANCEL_REASONS].length, 6);

const missing = parseStructuredCancelReason({ reasonCode: "hacked", reasonNote: "" }, TAXI_CLIENT_CANCEL_REASONS);
assert.equal(missing.ok, false);
const emptyOther = parseStructuredCancelReason(
  { reasonCode: "other", reasonNote: "   " },
  TAXI_CLIENT_CANCEL_REASONS,
);
assert.equal(emptyOther.ok, false);
const shortOther = parseStructuredCancelReason(
  { reasonCode: "other", reasonNote: "short" },
  TAXI_DRIVER_CANCEL_REASONS,
);
assert.equal(shortOther.ok, false);
const okOther = parseStructuredCancelReason(
  { reasonCode: "other", reasonNote: "  The street was closed for construction.  " },
  DELIVERY_CLIENT_CANCEL_REASONS,
);
assert.equal(okOther.ok, true);
if (okOther.ok) {
  assert.equal(okOther.reasonCode, "other");
  assert.equal(okOther.reasonNote, "The street was closed for construction.");
  assert.ok((okOther.reasonNote ?? "").length >= CANCEL_NOTE_MIN);
}
assert.equal(customerSafeCancelCode("intoxicated_or_threatening_customer"), "driver_released");

const orders = read("apps/web/app/api/orders/cancel/route.ts");
assert.match(orders, /actor_spoof_rejected/);
assert.match(orders, /recordServiceCancellation/);
assert.doesNotMatch(orders, /normalizeRole\(body\.role\)\s*;[\s\S]{0,40}const role = normalizeRole/);

const driverRelease = read("apps/web/app/api/taxi/rides/driver-cancel/route.ts");
assert.match(driverRelease, /acceptance_rate_impact: false/);
assert.match(driverRelease, /acceptanceRateImpact: false/);
assert.doesNotMatch(driverRelease, /paymentIntents\.create/);

const migration = read("supabase/migrations/20261217120000_service_cancellations.sql");
assert.match(migration, /acceptance_rate_impact boolean not null default false/);
assert.doesNotMatch(migration, /acceptance_rate\s*=/);
assert.match(migration, /cancellation_rate = least/);
assert.match(migration, /revoke all on table public.service_cancellations/);

const admin = read("apps/web/app/api/admin/cancellations/route.ts");
assert.match(admin, /assertStaffPermission/);
assert.match(admin, /reason_note/);
assert.doesNotMatch(admin, /\.update\(/);

for (const locale of ["en", "fr", "es", "ar", "zh", "ff"]) {
  const raw = read(`apps/mobile/src/i18n/locales/${locale}/cancellation.json`);
  for (const code of TAXI_CLIENT_CANCEL_REASONS) {
    assert.match(raw, new RegExp(`"${code}"`), locale);
  }
  for (const code of TAXI_DRIVER_CANCEL_REASONS) {
    assert.match(raw, new RegExp(`"${code}"`), locale);
  }
  assert.match(raw, /"tooShort"/, locale);
}

console.log("cancellation reason regression passed");
