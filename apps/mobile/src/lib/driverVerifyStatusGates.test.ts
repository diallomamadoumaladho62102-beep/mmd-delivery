import assert from "node:assert/strict";

/**
 * Mirrors DriverOrderDetailsScreen pickup/dropoff button gates.
 * Food/PD/DR: after accept → dispatched; pickup until picked_up; dropoff at picked_up.
 * Taxi: accepted/driver_arrived → pickup code; in_progress → complete ride.
 */
function canPickup(params: {
  status: string;
  assigned: boolean;
  marketplace?: boolean;
  deliveryRequest?: boolean;
  taxi?: boolean;
}) {
  const orderStatus = String(params.status ?? "").toLowerCase();
  if (!params.assigned || params.marketplace) return false;
  if (params.taxi) {
    return orderStatus === "accepted" || orderStatus === "driver_arrived";
  }
  if (params.deliveryRequest) return orderStatus === "dispatched";
  return ["ready", "accepted", "prepared", "dispatched"].includes(orderStatus);
}

function canDeliver(params: {
  status: string;
  assigned: boolean;
  marketplace?: boolean;
  taxi?: boolean;
}) {
  const orderStatus = String(params.status ?? "").toLowerCase();
  if (!params.assigned || params.marketplace) return false;
  if (params.taxi) return orderStatus === "in_progress";
  return orderStatus === "picked_up";
}

assert.equal(
  canPickup({ status: "dispatched", assigned: true }),
  true,
  "food dispatched → pickup enabled"
);
assert.equal(
  canDeliver({ status: "dispatched", assigned: true }),
  false,
  "food dispatched → dropoff disabled"
);
assert.equal(
  canPickup({ status: "picked_up", assigned: true }),
  false,
  "food picked_up → pickup disabled"
);
assert.equal(
  canDeliver({ status: "picked_up", assigned: true }),
  true,
  "food picked_up → dropoff enabled"
);
assert.equal(
  canPickup({ status: "ready", assigned: true, deliveryRequest: false }),
  true
);
assert.equal(
  canPickup({ status: "accepted", assigned: true }),
  true,
  "accepted (food PD / taxi) → pickup enabled"
);
assert.equal(
  canPickup({ status: "prepared", assigned: true }),
  true
);
assert.equal(
  canPickup({ status: "dispatched", assigned: true, deliveryRequest: true }),
  true
);
assert.equal(
  canDeliver({ status: "picked_up", assigned: true, deliveryRequest: true }),
  true
);
assert.equal(
  canPickup({ status: "completed", assigned: true }),
  false,
  "completed → pickup disabled"
);
assert.equal(
  canDeliver({ status: "completed", assigned: true }),
  false,
  "completed → dropoff disabled"
);
assert.equal(
  canPickup({ status: "dispatched", assigned: false }),
  false,
  "unassigned cannot pickup"
);
assert.equal(
  canPickup({ status: "dispatched", assigned: true, marketplace: true }),
  false
);

// Taxi lifecycle
assert.equal(
  canPickup({ status: "accepted", assigned: true, taxi: true }),
  true,
  "taxi accepted → pickup"
);
assert.equal(
  canPickup({ status: "driver_arrived", assigned: true, taxi: true }),
  true,
  "taxi driver_arrived → pickup"
);
assert.equal(
  canDeliver({ status: "driver_arrived", assigned: true, taxi: true }),
  false,
  "taxi before start → no complete"
);
assert.equal(
  canPickup({ status: "in_progress", assigned: true, taxi: true }),
  false,
  "taxi in_progress → pickup off"
);
assert.equal(
  canDeliver({ status: "in_progress", assigned: true, taxi: true }),
  true,
  "taxi in_progress → complete ride"
);
assert.equal(
  canDeliver({ status: "completed", assigned: true, taxi: true }),
  false,
  "taxi completed → complete off"
);

console.log("driverVerifyStatusGates tests passed");
