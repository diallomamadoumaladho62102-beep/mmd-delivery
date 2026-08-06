import assert from "node:assert/strict";
import {
  computeTaxiRideKpis,
  filterTaxiRides,
  getTaxiRideOpsPriorityScore,
  rideStatusActions,
  rideStatusBadge,
  revenueTodayCents,
  sortTaxiRidesOps,
  taxiRideUiBucket,
  type AdminTaxiRideListItem,
} from "./adminTaxiRideDisplay";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function sample(partial: Partial<AdminTaxiRideListItem> = {}): AdminTaxiRideListItem {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    status: "dispatching",
    vehicle_class: "standard",
    payment_status: "paid",
    refund_status: null,
    total_cents: 2500,
    currency: "USD",
    client_user_id: "c1",
    driver_id: "d1",
    pickup_address: "12 Main St, New York",
    dropoff_address: "90 Broadway, New York",
    pickup_city: "New York",
    distance_miles: 3.2,
    duration_minutes: 18,
    next_ride_eta_minutes: 5,
    created_at: "2026-08-05T12:00:00.000Z",
    completed_at: null,
    accepted_at: null,
    driver_arrived_at: null,
    started_at: null,
    updated_at: "2026-08-05T12:05:00.000Z",
    driver_is_online: true,
    client: {
      id: "c1",
      full_name: "José Client",
      email: "jose@example.com",
      phone: "+15551212",
      avatar_url: null,
      account_kind: "real",
    },
    driver: {
      id: "d1",
      full_name: "Awa Driver",
      email: "awa@example.com",
      phone: "+15553434",
      avatar_url: null,
      account_kind: null,
    },
    vehicle: {
      id: "v1",
      photo_url: null,
      vehicle_type: "car",
      make: "Toyota",
      model: "Camry",
      year: 2020,
      color: "Black",
      plate: "ABC123",
    },
    ...partial,
  };
}

test("bucket maps dispatching to searching", () => {
  assert.equal(taxiRideUiBucket(sample()), "searching");
});

test("payment failed before refund pending before searching", () => {
  const failed = sample({ payment_status: "failed", status: "dispatching" });
  const refund = sample({
    payment_status: "paid",
    refund_status: "pending",
    status: "completed",
  });
  const searching = sample({ payment_status: "paid", status: "dispatching" });
  assert.ok(getTaxiRideOpsPriorityScore(failed) < getTaxiRideOpsPriorityScore(refund));
  assert.ok(getTaxiRideOpsPriorityScore(refund) < getTaxiRideOpsPriorityScore(searching));
});

test("ops sort: searching before completed before canceled", () => {
  const searching = sample({ id: "a", status: "dispatching" });
  const completed = sample({
    id: "b",
    status: "completed",
    completed_at: "2026-08-05T13:00:00.000Z",
  });
  const canceled = sample({ id: "c", status: "canceled" });
  const sorted = sortTaxiRidesOps([canceled, completed, searching]);
  assert.equal(sorted[0]!.id, "a");
  assert.equal(sorted[1]!.id, "b");
  assert.equal(sorted[2]!.id, "c");
});

test("status badges", () => {
  assert.equal(rideStatusBadge("completed").label, "Completed");
  assert.equal(rideStatusBadge("accepted").label, "Driver Assigned");
  assert.equal(rideStatusBadge("driver_arrived").label, "Driver Arriving");
  assert.equal(rideStatusBadge("in_progress").label, "Passenger On Board");
  assert.equal(rideStatusBadge("dispatching").label, "Searching Driver");
  assert.equal(rideStatusBadge("canceled").tone, "red");
});

test("completed actions include receipt, not view details as primary set", () => {
  const actions = rideStatusActions(
    sample({ status: "completed", id: "ride-1" })
  );
  assert.ok(actions.some((a) => a.key === "receipt"));
  assert.equal(
    actions.some((a) => a.key === "view"),
    false
  );
});

test("canceled actions omit receipt", () => {
  const actions = rideStatusActions(sample({ status: "canceled" }));
  assert.equal(
    actions.some((a) => a.key === "receipt"),
    false
  );
  assert.ok(actions.some((a) => a.key === "timeline"));
});

test("active actions include view details and live map", () => {
  const actions = rideStatusActions(sample({ status: "accepted" }));
  assert.ok(actions.some((a) => a.key === "view"));
  assert.ok(actions.some((a) => a.key === "live_map"));
});

test("completed actions omit live map", () => {
  const actions = rideStatusActions(sample({ status: "completed" }));
  assert.equal(
    actions.some((a) => a.key === "live_map"),
    false
  );
});

test("filter search accent-insensitive + plate", () => {
  const items = [
    sample({ id: "1", client: { ...sample().client!, full_name: "José Client" } }),
    sample({
      id: "2",
      client: {
        id: "c2",
        full_name: "Omar",
        email: null,
        phone: null,
        avatar_url: null,
        account_kind: null,
      },
      vehicle: { ...sample().vehicle!, plate: "ZZZ999" },
    }),
  ];
  const byName = filterTaxiRides(items, {
    q: "jose",
    status: "",
    payment: "",
    vehicle: "",
    city: "",
    online: "",
    dateFrom: "",
    clientId: "",
    driverId: "",
  });
  assert.equal(byName.length, 1);
  assert.equal(byName[0]!.id, "1");

  const byPlate = filterTaxiRides(items, {
    q: "zzz",
    status: "",
    payment: "",
    vehicle: "",
    city: "",
    online: "",
    dateFrom: "",
    clientId: "",
    driverId: "",
  });
  assert.equal(byPlate[0]!.id, "2");
});

test("revenue today sums completed persisted cents", () => {
  const now = new Date();
  const todayIso = now.toISOString();
  const yesterday = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
  const items = [
    sample({
      status: "completed",
      total_cents: 1000,
      completed_at: todayIso,
    }),
    sample({
      id: "x",
      status: "completed",
      total_cents: 500,
      completed_at: yesterday,
    }),
    sample({ id: "y", status: "in_progress", total_cents: 9000 }),
  ];
  assert.equal(revenueTodayCents(items, now), 1000);
  assert.equal(computeTaxiRideKpis(items).completed, 2);
  assert.equal(computeTaxiRideKpis(items).onBoard, 1);
});

console.log("adminTaxiRideDisplay.test.ts passed");
