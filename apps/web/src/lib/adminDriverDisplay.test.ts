import assert from "node:assert/strict";
import {
  aggregateDocGroupBadge,
  completenessPercent,
  computeMissingRequirementsForRow,
  driverStatusActions,
  filterDrivers,
  getOpsPriorityScore,
  normalizeDriverStatus,
  sortDriversOps,
  stripeIdentityBadge,
  type AdminDriverListItem,
} from "./adminDriverDisplay";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function sample(partial: Partial<AdminDriverListItem> = {}): AdminDriverListItem {
  return {
    user_id: "u1",
    full_name: "Awa Driver",
    email: "awa@example.com",
    phone: "+1555",
    emergency_phone: "+1556",
    date_of_birth: "1990-01-01",
    address: "1 Main",
    city: "New York",
    state: "NY",
    zip_code: "10001",
    transport_mode: "bike",
    vehicle_brand: null,
    vehicle_model: null,
    vehicle_year: null,
    vehicle_color: null,
    plate_number: null,
    license_number: null,
    license_expiry: null,
    status: "pending",
    documents_required: true,
    missing_requirements: null,
    computed_missing_requirements: ["profile photo"],
    completeness_percent: 80,
    is_online: false,
    photo_url: null,
    created_at: "2026-01-01T00:00:00.000Z",
    rating: null,
    rating_count: null,
    total_deliveries: 3,
    taxi_completed_rides: null,
    acceptance_rate: null,
    cancellation_rate: null,
    stripe_identity_status: null,
    documents: [],
    vehicle: null,
    ...partial,
  };
}

test("normalizeDriverStatus maps unknown to pending", () => {
  assert.equal(normalizeDriverStatus("weird"), "pending");
  assert.equal(normalizeDriverStatus("approved"), "approved");
});

test("computeMissingRequirementsForRow bike does not require motor docs", () => {
  const missing = computeMissingRequirementsForRow({
    transport_mode: "bike",
    full_name: "A",
    phone: "1",
    emergency_phone: "2",
    address: "a",
    city: "c",
    state: "NY",
    zip_code: "1",
    date_of_birth: "1990-01-01",
    vehicle_brand: null,
    vehicle_model: null,
    vehicle_year: null,
    vehicle_color: null,
    plate_number: null,
    license_number: null,
    license_expiry: null,
    documents: [
      { doc_type: "profile_photo" },
      { doc_type: "id_card_front" },
      { doc_type: "id_card_back" },
    ],
  });
  assert.equal(missing.length, 0);
});

test("ops priority puts pending missing before approved", () => {
  const pending = sample({ status: "pending", computed_missing_requirements: ["x"] });
  const approved = sample({
    status: "approved",
    computed_missing_requirements: [],
    documents: [{ id: "1", user_id: "u1", doc_type: "profile_photo", status: "approved", file_path: "a", created_at: "", reviewed_at: null, review_notes: null }],
  });
  assert.ok(getOpsPriorityScore(pending) < getOpsPriorityScore(approved));
  const sorted = sortDriversOps([approved, pending]);
  assert.equal(sorted[0]!.status, "pending");
});

test("approved online sorts before approved offline", () => {
  const online = sample({
    status: "approved",
    is_online: true,
    computed_missing_requirements: [],
    documents: [{ id: "1", user_id: "u1", doc_type: "profile_photo", status: "approved", file_path: "a", created_at: "", reviewed_at: null, review_notes: null }],
  });
  const offline = { ...online, is_online: false, user_id: "u2" };
  assert.ok(getOpsPriorityScore(online) < getOpsPriorityScore(offline));
});

test("status actions hide approve for approved drivers", () => {
  const actions = driverStatusActions("approved", {
    canManage: true,
    missingCount: 0,
    userId: "u1",
  });
  assert.equal(
    actions.some((a) => a.key === "approve"),
    false
  );
  assert.ok(actions.some((a) => a.key === "suspend"));
});

test("suspended shows reactivate not approve label", () => {
  const actions = driverStatusActions("suspended", {
    canManage: true,
    missingCount: 0,
    userId: "u1",
  });
  assert.ok(actions.some((a) => a.key === "reactivate"));
  assert.equal(
    actions.some((a) => a.key === "approve"),
    false
  );
});

test("approve disabled when missing docs", () => {
  const actions = driverStatusActions("pending", {
    canManage: true,
    missingCount: 2,
    userId: "u1",
  });
  const approve = actions.find((a) => a.key === "approve");
  assert.equal(approve?.disabled, true);
});

test("doc group badge not provided", () => {
  const badge = aggregateDocGroupBadge([], ["insurance"]);
  assert.equal(badge.tone, "slate");
});

test("stripe identity badge", () => {
  assert.equal(stripeIdentityBadge("verified").tone, "green");
  assert.equal(stripeIdentityBadge(null).tone, "slate");
});

test("filterDrivers combines status and search", () => {
  const items = [
    sample({ user_id: "a", status: "approved", full_name: "Awa", computed_missing_requirements: [], documents: [{ id: "1", user_id: "a", doc_type: "profile_photo", status: "approved", file_path: "x", created_at: "", reviewed_at: null, review_notes: null }] }),
    sample({ user_id: "b", status: "pending", full_name: "Omar", plate_number: "ABC123" }),
  ];
  const filtered = filterDrivers(items, {
    q: "abc",
    status: "pending",
    mode: "",
    city: "",
    state: "",
    docsIncomplete: false,
    identity: "",
    online: "",
    dateFrom: "",
    minCompleteness: "",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.user_id, "b");
});

test("completenessPercent increases when fewer missing", () => {
  assert.ok(completenessPercent(0, "bike") > completenessPercent(5, "bike"));
});

console.log("adminDriverDisplay.test.ts passed");
