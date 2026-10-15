import assert from "node:assert/strict";
import {
  evaluateTaxiRideCompletion,
  evaluateTaxiStopAction,
  resolveTaxiNavigationPlan,
} from "./taxiDriverProgress";

const pickup = { latitude: 9.64, longitude: -13.58, address: "Pickup" };
const dropoff = { latitude: 9.65, longitude: -13.57, address: "Dropoff" };

function stops(count: number, statuses: string[]) {
  return Array.from({ length: count }, (_, index) => ({
    stopOrder: index + 1,
    status: statuses[index] ?? "pending",
    address: `Stop ${index + 1}`,
    latitude: 9.641 + index / 100,
    longitude: -13.57 - index / 100,
  }));
}

function testNoStops() {
  const completion = evaluateTaxiRideCompletion({ rideStatus: "in_progress", stops: [] });
  assert.equal(completion.ok, true);
  const plan = resolveTaxiNavigationPlan({
    rideStatus: "accepted",
    pickup,
    dropoff,
    stops: [],
  });
  assert.equal(plan.stage, "pickup");
  assert.equal(plan.waypoints.length, 0);
  const driving = resolveTaxiNavigationPlan({
    rideStatus: "in_progress",
    pickup,
    dropoff,
    stops: [],
  });
  assert.equal(driving.activeRole, "dropoff");
  assert.equal(driving.waypoints.length, 0);
  assert.equal(driving.holdStageArrival, false);
}

function testOneTwoThreeStops() {
  for (const count of [1, 2, 3]) {
    const rows = stops(count, Array(count).fill("pending"));
    const arriveLater = evaluateTaxiStopAction({
      rideStatus: "in_progress",
      stops: rows,
      stopOrder: count,
      action: "arrive",
    });
    if (count === 1) {
      assert.equal(arriveLater.ok, true);
    } else {
      assert.equal(arriveLater.ok, false);
      if (!arriveLater.ok) assert.equal(arriveLater.error, "stop_out_of_order");
    }

    const plan = resolveTaxiNavigationPlan({
      rideStatus: "in_progress",
      pickup,
      dropoff,
      stops: rows,
    });
    assert.equal(plan.activeRole, "stop");
    assert.equal(plan.activeOrder, 1);
    assert.equal(plan.waypoints.length, count);
    assert.equal(plan.destination?.latitude, dropoff.latitude);
    assert.equal(plan.holdStageArrival, true);
  }
}

function testOrderAndSkip() {
  const rows = stops(3, ["pending", "pending", "pending"]);
  assert.equal(
    evaluateTaxiStopAction({
      rideStatus: "in_progress",
      stops: rows,
      stopOrder: 2,
      action: "arrive",
    }).ok,
    false,
  );
  assert.equal(
    evaluateTaxiStopAction({
      rideStatus: "in_progress",
      stops: rows,
      stopOrder: 1,
      action: "complete",
    }).ok,
    false,
  );
  const arrived = stops(3, ["arrived", "pending", "pending"]);
  const completeFirst = evaluateTaxiStopAction({
    rideStatus: "in_progress",
    stops: arrived,
    stopOrder: 1,
    action: "complete",
  });
  assert.equal(completeFirst.ok, true);
  const skipDropoff = evaluateTaxiRideCompletion({
    rideStatus: "in_progress",
    stops: arrived,
  });
  assert.equal(skipDropoff.ok, false);
  if (!skipDropoff.ok) assert.equal(skipDropoff.error, "stops_incomplete");
}

function testNormalProgressAndReplay() {
  let rows = stops(2, ["pending", "pending"]);
  assert.equal(
    evaluateTaxiStopAction({ rideStatus: "in_progress", stops: rows, stopOrder: 1, action: "arrive" })
      .ok,
    true,
  );
  rows = stops(2, ["arrived", "pending"]);
  const again = evaluateTaxiStopAction({
    rideStatus: "in_progress",
    stops: rows,
    stopOrder: 1,
    action: "arrive",
  });
  assert.equal(again.ok && again.idempotent, true);
  rows = stops(2, ["completed", "pending"]);
  const replayComplete = evaluateTaxiStopAction({
    rideStatus: "in_progress",
    stops: rows,
    stopOrder: 1,
    action: "complete",
  });
  assert.equal(replayComplete.ok && replayComplete.idempotent, true);
  assert.equal(
    evaluateTaxiStopAction({ rideStatus: "in_progress", stops: rows, stopOrder: 2, action: "arrive" })
      .ok,
    true,
  );
  rows = stops(2, ["completed", "completed"]);
  const done = evaluateTaxiRideCompletion({ rideStatus: "in_progress", stops: rows });
  assert.equal(done.ok, true);
  const secondEnd = evaluateTaxiRideCompletion({ rideStatus: "completed", stops: rows });
  assert.equal(secondEnd.ok, false);
  if (!secondEnd.ok) assert.equal(secondEnd.error, "invalid_status");
}

function testResumeKeepsRemainingOrder() {
  const plan = resolveTaxiNavigationPlan({
    rideStatus: "in_progress",
    pickup,
    dropoff,
    stops: stops(3, ["completed", "arrived", "pending"]),
  });
  assert.equal(plan.activeOrder, 2);
  assert.equal(plan.waypoints.length, 2);
  assert.equal(plan.waypoints[0]?.latitude, 9.641 + 1 / 100);
  const beforeStart = resolveTaxiNavigationPlan({
    rideStatus: "driver_arrived",
    pickup,
    dropoff,
    stops: stops(3, ["pending", "pending", "pending"]),
  });
  assert.equal(beforeStart.stage, "pickup");
  assert.equal(beforeStart.waypoints.length, 0);
}

function testRoundTripTwoStopsStayOrdered() {
  const rows = stops(2, ["pending", "pending"]);
  const skip = evaluateTaxiStopAction({
    rideStatus: "in_progress",
    stops: rows,
    stopOrder: 2,
    action: "arrive",
  });
  assert.equal(skip.ok, false);
  if (!skip.ok) assert.equal(skip.error, "stop_out_of_order");
  const earlyEnd = evaluateTaxiRideCompletion({ rideStatus: "in_progress", stops: rows });
  assert.equal(earlyEnd.ok, false);
}

function main() {
  testNoStops();
  testOneTwoThreeStops();
  testOrderAndSkip();
  testNormalProgressAndReplay();
  testResumeKeepsRemainingOrder();
  testRoundTripTwoStopsStayOrdered();
  console.log("taxiDriverProgress.test.ts OK");
}

main();
