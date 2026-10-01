import assert from "node:assert/strict";
import test from "node:test";
import { anomaliesNeverDeletePay, detectAnomalies } from "./anomaly";
import { cloneDefaultSettings } from "./engineGate";
import { gpsAbsenceIsNotFraud } from "./gpsIntegrity";
import type { ProgressSignals } from "./types";

function signals(over: Partial<ProgressSignals> = {}): ProgressSignals {
  return {
    driverAcceptedAtMs: 0,
    nowMs: 20 * 60 * 1000,
    arrivedAtMs: null,
    waitTimerStartedAtMs: null,
    pickedUpAtMs: null,
    deliveredAtMs: null,
    cancelledAtMs: null,
    locationUpdatedAtMs: null,
    metersFromAccept: null,
    gpsAvailable: false,
    gpsStale: false,
    waitReasonCode: null,
    ...over,
  };
}

test("GPS absent is an info anomaly and never fraud / pay deletion", () => {
  const settings = {
    ...cloneDefaultSettings(),
    monitoringEnabled: true,
    driverAcceptanceWarningAfterSeconds: 60,
  };
  const rows = detectAnomalies({
    signals: signals(),
    settings,
    acceptGps: null,
    currentGps: null,
    previousGps: null,
    priorAnomalyCount: 0,
  });
  assert.equal(gpsAbsenceIsNotFraud(false), true);
  assert.ok(rows.some((r) => r.type === "gps_unavailable"));
  assert.equal(anomaliesNeverDeletePay(rows), true);
  assert.ok(rows.every((r) => r.automaticFraud === false));
});

test("long trip is review-only and does not delete trip time", () => {
  const settings = {
    ...cloneDefaultSettings(),
    longTripThresholdSeconds: 600,
  };
  const rows = detectAnomalies({
    signals: signals({ nowMs: 20 * 60 * 1000 }),
    settings,
    acceptGps: null,
    currentGps: null,
    previousGps: null,
    priorAnomalyCount: 0,
  });
  const long = rows.find((r) => r.type === "long_trip");
  assert.ok(long);
  assert.equal(long!.automaticPayDeletion, false);
  assert.match(String(long!.details.note), /does_not_delete/);
});

test("impossible speed is high severity review, not automatic fraud", () => {
  const settings = {
    ...cloneDefaultSettings(),
    impossibleSpeedThresholdMps: 50,
  };
  const rows = detectAnomalies({
    signals: signals({ gpsAvailable: true }),
    settings,
    acceptGps: { lat: 40.7, lng: -74.0, atMs: 0 },
    previousGps: { lat: 40.7, lng: -74.0, atMs: 0 },
    currentGps: { lat: 41.7, lng: -74.0, atMs: 1000 },
    priorAnomalyCount: 0,
  });
  const speed = rows.find((r) => r.type === "impossible_speed");
  assert.ok(speed);
  assert.equal(speed!.severity, "high");
  assert.equal(speed!.automaticFraud, false);
});

test("stationary driver is review-only", () => {
  const settings = {
    ...cloneDefaultSettings(),
    stationaryThresholdSeconds: 120,
    movementProgressThresholdMeters: 40,
  };
  const rows = detectAnomalies({
    signals: signals({
      gpsAvailable: true,
      metersFromAccept: 5,
      nowMs: 180_000,
    }),
    settings,
    acceptGps: { lat: 40.7, lng: -74.0, atMs: 0 },
    currentGps: { lat: 40.70001, lng: -74.0, atMs: 180_000 },
    previousGps: null,
    priorAnomalyCount: 0,
  });
  assert.ok(rows.some((r) => r.type === "stationary"));
});

test("restaurant wait over threshold does not delete admissible time", () => {
  const settings = {
    ...cloneDefaultSettings(),
    restaurantWaitReviewThresholdSeconds: 600,
  };
  const rows = detectAnomalies({
    signals: signals({
      arrivedAtMs: 0,
      nowMs: 20 * 60 * 1000,
    }),
    settings,
    acceptGps: null,
    currentGps: null,
    previousGps: null,
    priorAnomalyCount: 0,
  });
  const wait = rows.find((r) => r.type === "restaurant_wait_review");
  assert.ok(wait);
  assert.equal(wait!.automaticPayDeletion, false);
});

test("anomaly history is not automatic fraud", () => {
  const rows = detectAnomalies({
    signals: signals(),
    settings: cloneDefaultSettings(),
    acceptGps: null,
    currentGps: null,
    previousGps: null,
    priorAnomalyCount: 5,
  });
  const repeated = rows.find((r) => r.type === "repeated_anomalies");
  assert.ok(repeated);
  assert.match(String(repeated!.details.note), /not_automatic_fraud/);
});
