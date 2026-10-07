import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const web = process.cwd();
const read = (rel: string) => readFileSync(join(web, rel), "utf8");

const migration = read(
  "../../supabase/migrations/20261210120000_audit_remediation.sql",
);
const smart = read("app/api/dispatch/smart/route.ts");
const taxiDispatch = read("src/lib/runTaxiRideDispatch.ts");
const closePay = read("src/lib/minimumPay/closePayPeriod.ts");
const refund = read("src/lib/stripeWebhookChargeRefunded.ts");
const webhook = read("app/api/stripe/webhook/route.ts");
const select = read("src/lib/orderPaymentSelect.ts");
const adminCancel = read("src/lib/adminCancelOrderRefundCore.ts");

test("offered drivers can read a live job and strangers cannot", () => {
  assert.match(migration, /driver_has_live_order_offer/);
  assert.match(migration, /driver_has_live_delivery_offer/);
  assert.match(migration, /driver_has_live_taxi_offer/);
  assert.match(migration, /p_user_id is distinct from auth.uid\(\)/);
  assert.match(migration, /o.expires_at > now\(\)/);
  assert.match(migration, /orders_select_participants/);
});

test("food accept-ready delegates to a live offer", () => {
  assert.match(migration, /offer_required/);
  assert.match(migration, /return public.driver_accept_order_offer\(v_offer_id\)/);
  assert.match(smart, /offer_id: offerId/);
  assert.doesNotMatch(smart, /screen: "DriverTabs"/);
});

test("food delivery cannot skip pickup or customer arrival", () => {
  assert.match(migration, /v_status <> 'picked_up'/);
  assert.match(migration, /customer_arrival_required/);
  assert.match(migration, /pickup_arrival_required/);
  assert.match(migration, /code_required/);
  assert.doesNotMatch(
    migration,
    /lower\(coalesce\(status, ''\)\) in \('picked_up', 'dispatched'\)/,
  );
});

test("join_order ignores the client-supplied role", () => {
  assert.match(migration, /from public.profiles p/);
  assert.match(migration, /forbidden_client/);
  assert.doesNotMatch(migration, /v_role_in/);
});

test("verification codes are revoked from authenticated table reads", () => {
  assert.match(migration, /get_authorized_verification_codes/);
  assert.match(migration, /mmd_sync_trip_column_privileges\('orders'\)/);
  assert.match(migration, /verification_attempt_blocked/);
  assert.match(migration, /Do not replace its return type/);
  assert.match(migration, /revoke select on table public.%I from anon, authenticated/);
  assert.match(migration, /protect_order_verification_codes/);
  assert.match(migration, /on conflict \(order_id, user_id\) do nothing/);
});

test("driver stats and capacity settings are not world-readable", () => {
  assert.match(migration, /v_caller is distinct from p_driver_id/);
  assert.match(migration, /driver_capacity_settings_auth_read/);
  assert.match(migration, /analytics_card_catalog_select/);
  assert.match(migration, /is_staff_user\(auth.uid\(\)\)/);
});

test("food finance uses net charge and partial refunds enqueue again", () => {
  assert.match(select, /net_charge_cents/);
  assert.match(webhook, /resolveOrderAmountCents\(paidOrder\)/);
  assert.match(webhook, /resolveOrderAmountCents\(paidOrderPi\)/);
  assert.match(webhook, /resolveDeliveryRequestAmountCents/);
  assert.match(refund, /external_ref_type/);
  assert.match(closePay, /entity_type === "taxi_ride"/);
  assert.match(refund, /isNewRefund/);
  assert.match(refund, /incomingRefundId !== existingRefundId/);
  assert.match(adminCancel, /payment_status = "refunded"/);
});

test("failed minimum-pay transfer returns to computed", () => {
  assert.match(closePay, /transfer.ok && transfer.skipped/);
  assert.match(closePay, /test_or_archived_source/);
  assert.match(closePay, /seller_order_id/);
});

test("taxi offer push carries ride and offer ids", () => {
  assert.match(taxiDispatch, /taxi_ride_id: ride.id/);
  assert.match(taxiDispatch, /offer_id: offerId/);
});

test("multi-driver accept can supersede the other offer and taxi rides are published", () => {
  const followUp = read(
    "../../supabase/migrations/20261210130000_offer_superseded_and_taxi_realtime.sql",
  );
  assert.match(followUp, /driver_order_offers_status_check/);
  assert.match(followUp, /delivery_request_driver_offers_status_check/);
  assert.match(followUp, /'superseded'/);
  assert.match(followUp, /add table public.taxi_rides/);
  assert.match(followUp, /mmd_sync_trip_column_privileges\('taxi_rides'\)/);
});

test("unassigned jobs are not readable by every driver", () => {
  const followUp = read(
    "../../supabase/migrations/20261210140000_close_open_driver_job_board.sql",
  );
  const home = read("../../apps/mobile/src/screens/DriverHomeScreen.tsx");
  assert.match(followUp, /drop policy if exists drivers_can_see_available_orders/);
  assert.match(followUp, /drop policy if exists drivers_can_see_ready_orders/);
  assert.match(followUp, /drop policy if exists delivery_requests_select_available_for_drivers/);
  assert.doesNotMatch(home, /\.in\("status", \["pending", "ready"\]\)/);
});

test("driver stats signatures do not overlap and seconds come from sessions", () => {
  const followUp = read(
    "../../supabase/migrations/20261210150000_stats_codes_and_member_audit.sql",
  );
  const revenue = read("../../apps/mobile/src/screens/DriverRevenueDetailsScreen.tsx");
  assert.match(followUp, /drop function if exists public.get_driver_stats\(uuid, timestamptz, timestamptz\)/);
  assert.match(followUp, /from public.driver_sessions ds/);
  assert.match(followUp, /from public.driver_drive_sessions dds/);
  assert.doesNotMatch(followUp, /online_minutes', 0/);
  assert.doesNotMatch(followUp, /p_from timestamptz default null/i);
  assert.doesNotMatch(followUp, /p_driver_id uuid default null/i);
  assert.match(revenue, /from_ts: fromISO/);
  assert.match(revenue, /to_ts: toISO/);
});

test("taxi pickup codes are rate limited and memberships can be audited", () => {
  const followUp = read(
    "../../supabase/migrations/20261210150000_stats_codes_and_member_audit.sql",
  );
  assert.match(followUp, /verification_attempt_blocked\(v_driver_id, p_ride_id, 'taxi_pickup', 5\)/);
  assert.match(followUp, /verification_attempt_record\(v_driver_id, p_ride_id, 'taxi_pickup'\)/);
  assert.match(followUp, /verification_attempt_clear\(v_driver_id, p_ride_id, 'taxi_pickup'\)/);
  assert.match(followUp, /count_unauthorized_order_members/);
  assert.match(followUp, /Replica identity stays DEFAULT/);
});

test("paid package dispatch failure returns 500 and the retry path redispatches", () => {
  assert.match(webhook, /dispatch_trigger_failed/);
  assert.equal(webhook.split("dispatchPaidDeliveryOrFail").length - 1, 5);
  assert.doesNotMatch(webhook, /delivery request dispatch trigger failed/);
  const trigger = read("src/lib/triggerDeliveryRequestDispatch.ts");
  assert.match(trigger, /catch \(error\)/);
  assert.match(trigger, /retryScheduled/);
  const retry = read("src/lib/retryDeliveryRequestDispatch.ts");
  assert.match(retry, /if \(lastWaveAt && lastWaveAt > cutoffIso\) continue/);
});

test("obsolete food accept helper cannot be called from mobile", () => {
  const api = read("../../apps/mobile/src/lib/driverOrderDriverApi.ts");
  const route = read("app/api/orders/accept-ready/route.ts");
  assert.doesNotMatch(api, /acceptReadyFoodOrder/);
  assert.match(route, /driver_accept_ready_order/);
});
