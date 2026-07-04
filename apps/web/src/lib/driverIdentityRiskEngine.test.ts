import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateIdentityTriggers,
  hashIp,
} from "./driverIdentityRiskEngine";
import { identityBlocksOnline } from "./driverIdentityTypes";

const baseSettings = {
  id: 1,
  random_check_enabled: true,
  random_min_rides: 10,
  random_max_rides: 20,
  require_on_new_device: true,
  require_after_inactivity_days: 30,
  require_on_city_change: true,
  require_on_country_change: true,
  require_on_report: true,
  require_on_first_online: true,
  require_on_profile_photo_change: true,
  require_on_phone_change: true,
  require_after_suspension: true,
  periodic_check_enabled: true,
  periodic_check_days: 90,
  manual_review_enabled: true,
  manual_review_risk_threshold: 65,
  verification_validity_days: 180,
  retention_days: 365,
  default_provider: "internal",
};

test("identityBlocksOnline blocks required and manual_review", () => {
  assert.equal(identityBlocksOnline("required"), true);
  assert.equal(identityBlocksOnline("manual_review"), true);
  assert.equal(identityBlocksOnline("verified"), false);
  assert.equal(identityBlocksOnline("not_required"), false);
});

test("first online triggers verification when never verified", () => {
  const decision = evaluateIdentityTriggers({
    settings: baseSettings,
    state: null,
    context: { driverId: "driver-1", intent: "go_online" },
    hasOpenReport: false,
    isKnownDevice: true,
    profileWasSuspended: false,
    profilePhotoChangedRecently: false,
    phoneChangedRecently: false,
    pendingPostSuspensionCheck: false,
  });

  assert.ok(decision);
  assert.equal(decision.triggerType, "first_online");
});

test("verified driver can go online when no triggers", () => {
  const decision = evaluateIdentityTriggers({
    settings: baseSettings,
    state: {
      driver_id: "driver-1",
      gate_status: "verified",
      active_check_id: null,
      last_verified_at: new Date().toISOString(),
      last_device_id_hash: "dev_abc",
      last_city: "Paris",
      last_country: "FR",
      rides_since_verification: 2,
      last_online_at: new Date().toISOString(),
      next_random_ride_threshold: 15,
    },
    context: {
      driverId: "driver-1",
      intent: "go_online",
      deviceIdHash: "dev_abc",
      city: "Paris",
      country: "FR",
    },
    hasOpenReport: false,
    isKnownDevice: true,
    profileWasSuspended: false,
    profilePhotoChangedRecently: false,
    phoneChangedRecently: false,
    pendingPostSuspensionCheck: false,
  });

  assert.equal(decision, null);
});

test("new device triggers verification", () => {
  const decision = evaluateIdentityTriggers({
    settings: baseSettings,
    state: {
      driver_id: "driver-1",
      gate_status: "verified",
      active_check_id: null,
      last_verified_at: new Date().toISOString(),
      last_device_id_hash: "dev_old",
      last_city: "Paris",
      last_country: "FR",
      rides_since_verification: 1,
      last_online_at: new Date().toISOString(),
      next_random_ride_threshold: 15,
    },
    context: {
      driverId: "driver-1",
      intent: "go_online",
      deviceIdHash: "dev_new",
      city: "Paris",
      country: "FR",
    },
    hasOpenReport: false,
    isKnownDevice: false,
    profileWasSuspended: false,
    profilePhotoChangedRecently: false,
    phoneChangedRecently: false,
    pendingPostSuspensionCheck: false,
  });

  assert.ok(decision);
  assert.equal(decision.triggerType, "new_device");
});

test("inactivity triggers verification", () => {
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const decision = evaluateIdentityTriggers({
    settings: baseSettings,
    state: {
      driver_id: "driver-1",
      gate_status: "verified",
      active_check_id: null,
      last_verified_at: old,
      last_device_id_hash: "dev_abc",
      last_city: "Paris",
      last_country: "FR",
      rides_since_verification: 1,
      last_online_at: old,
      next_random_ride_threshold: 15,
    },
    context: {
      driverId: "driver-1",
      intent: "go_online",
      deviceIdHash: "dev_abc",
      city: "Paris",
      country: "FR",
    },
    hasOpenReport: false,
    isKnownDevice: true,
    profileWasSuspended: false,
    profilePhotoChangedRecently: false,
    phoneChangedRecently: false,
    pendingPostSuspensionCheck: false,
  });

  assert.ok(decision);
  assert.equal(decision.triggerType, "inactivity");
});

test("client report triggers verification", () => {
  const decision = evaluateIdentityTriggers({
    settings: baseSettings,
    state: {
      driver_id: "driver-1",
      gate_status: "verified",
      active_check_id: null,
      last_verified_at: new Date().toISOString(),
      last_device_id_hash: "dev_abc",
      last_city: "Paris",
      last_country: "FR",
      rides_since_verification: 1,
      last_online_at: new Date().toISOString(),
      next_random_ride_threshold: 15,
    },
    context: { driverId: "driver-1", intent: "go_online", deviceIdHash: "dev_abc" },
    hasOpenReport: true,
    isKnownDevice: true,
    profileWasSuspended: false,
    profilePhotoChangedRecently: false,
    phoneChangedRecently: false,
    pendingPostSuspensionCheck: false,
  });

  assert.ok(decision);
  assert.equal(decision.triggerType, "client_report");
  assert.equal(decision.requiresManualReview, true);
});

test("hashIp returns stable hashed prefix", () => {
  const a = hashIp("203.0.113.10");
  const b = hashIp("203.0.113.10");
  assert.equal(a, b);
  assert.match(String(a), /^ip_[0-9a-f]+$/);
});
