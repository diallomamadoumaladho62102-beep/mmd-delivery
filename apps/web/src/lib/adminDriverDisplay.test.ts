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
    last_activity_at: null,
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

test("ops priority: pending before missing before rejected before suspended", () => {
  const pending = sample({ status: "pending", computed_missing_requirements: [] });
  const missing = sample({
    status: "approved",
    computed_missing_requirements: ["license front"],
    is_online: false,
  });
  const rejected = sample({
    status: "rejected",
    computed_missing_requirements: [],
  });
  const suspended = sample({ status: "suspended", computed_missing_requirements: [] });
  const disabled = sample({ status: "disabled", computed_missing_requirements: [] });
  const approved = sample({
    status: "approved",
    computed_missing_requirements: [],
    is_online: false,
  });

  assert.ok(getOpsPriorityScore(pending) < getOpsPriorityScore(missing));
  assert.ok(getOpsPriorityScore(missing) < getOpsPriorityScore(rejected));
  assert.ok(getOpsPriorityScore(rejected) < getOpsPriorityScore(suspended));
  assert.ok(getOpsPriorityScore(suspended) < getOpsPriorityScore(disabled));
  assert.ok(getOpsPriorityScore(disabled) < getOpsPriorityScore(approved));

  const sorted = sortDriversOps([approved, suspended, rejected, missing, pending]);
  assert.equal(sorted[0]!.status, "pending");
  assert.equal(sorted[1]!.user_id, missing.user_id);
});

test("approved online sorts before approved offline, then by activity", () => {
  const onlineOlder = sample({
    user_id: "online-old",
    status: "approved",
    is_online: true,
    computed_missing_requirements: [],
    last_activity_at: "2026-01-01T00:00:00.000Z",
    created_at: "2025-01-01T00:00:00.000Z",
  });
  const onlineNewer = sample({
    user_id: "online-new",
    status: "approved",
    is_online: true,
    computed_missing_requirements: [],
    last_activity_at: "2026-06-01T00:00:00.000Z",
    created_at: "2025-06-01T00:00:00.000Z",
  });
  const offline = sample({
    user_id: "offline",
    status: "approved",
    is_online: false,
    computed_missing_requirements: [],
    last_activity_at: "2026-07-01T00:00:00.000Z",
  });
  assert.ok(getOpsPriorityScore(onlineNewer) < getOpsPriorityScore(offline));
  const sorted = sortDriversOps([offline, onlineOlder, onlineNewer]);
  assert.equal(sorted[0]!.user_id, "online-new");
  assert.equal(sorted[1]!.user_id, "online-old");
  assert.equal(sorted[2]!.user_id, "offline");
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
  assert.ok(actions.some((a) => a.key === "identity" && a.label === "Audit"));
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

test("rejected never shows approve", () => {
  const actions = driverStatusActions("rejected", {
    canManage: true,
    missingCount: 0,
    userId: "u1",
  });
  assert.equal(
    actions.some((a) => a.key === "approve"),
    false
  );
  assert.deepEqual(
    actions.map((a) => a.key),
    ["view", "history"]
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

test("doc group badge missing", () => {
  const badge = aggregateDocGroupBadge([], ["insurance"]);
  assert.equal(badge.tone, "slate");
  assert.equal(badge.label, "Missing");
});

test("doc group badge valid", () => {
  const badge = aggregateDocGroupBadge(
    [
      {
        id: "1",
        user_id: "u1",
        doc_type: "insurance",
        status: "approved",
        file_path: "x",
        created_at: "",
        reviewed_at: null,
        review_notes: null,
      },
    ],
    ["insurance"]
  );
  assert.equal(badge.label, "Valid");
  assert.equal(badge.tone, "green");
});

test("stripe identity badge labels", () => {
  assert.equal(stripeIdentityBadge("verified").label, "Verified");
  assert.equal(stripeIdentityBadge(null).label, "Not started");
  assert.equal(stripeIdentityBadge("rejected").label, "Rejected");
});

test("filterDrivers combines status, mode, and accent-insensitive search", () => {
  const items = [
    sample({
      user_id: "a",
      status: "approved",
      full_name: "Awa",
      transport_mode: "car",
      computed_missing_requirements: [],
    }),
    sample({
      user_id: "b",
      status: "pending",
      full_name: "José Omar",
      plate_number: "ABC123",
      transport_mode: "bike",
    }),
  ];
  const filtered = filterDrivers(items, {
    q: "jose",
    status: "pending",
    mode: "bike",
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
