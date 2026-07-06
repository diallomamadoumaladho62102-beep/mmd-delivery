import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PREFERENCE_DROP_ORDER,
  buildPreferenceWidenClientMessage,
  driverSatisfiesPreferences,
  formatClientPreferencesForDriver,
  getDroppedPreferencesAtStage,
  getEnforcedPreferences,
  shouldAdvancePreferenceStage,
} from "./taxiClientPreferences";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const migration = path.join(
  repoRoot,
  "supabase",
  "migrations",
  "20260730120000_taxi_client_preferences_staged_dispatch.sql",
);

test("stage 0 enforces all requested preferences", () => {
  const enforced = getEnforcedPreferences({
    requested: {
      non_smoking_driver: true,
      child_seat_required: true,
    },
    dropOrder: DEFAULT_PREFERENCE_DROP_ORDER,
    stage: 0,
  });
  assert.equal(enforced.non_smoking_driver, true);
  assert.equal(enforced.child_seat_required, true);
});

test("stage 1 drops first preference in order", () => {
  const enforced = getEnforcedPreferences({
    requested: {
      non_smoking_driver: true,
      child_seat_required: true,
    },
    dropOrder: DEFAULT_PREFERENCE_DROP_ORDER,
    stage: 1,
  });
  assert.equal(enforced.child_seat_required, undefined);
  assert.equal(enforced.non_smoking_driver, true);
});

test("driver satisfies all enforced preferences", () => {
  assert.equal(
    driverSatisfiesPreferences({
      enforced: { non_smoking_driver: true, child_seat_required: true },
      driver: { non_smoking: true, child_seat_available: true },
    }),
    true,
  );
});

test("driver fails when child seat missing", () => {
  assert.equal(
    driverSatisfiesPreferences({
      enforced: { child_seat_required: true },
      driver: { child_seat_available: false },
    }),
    false,
  );
});

test("ambiance never appears in enforced blocking prefs", () => {
  const enforced = getEnforcedPreferences({
    requested: { non_smoking_driver: true, ambiance: "quiet" },
    dropOrder: DEFAULT_PREFERENCE_DROP_ORDER,
    stage: 0,
  });
  assert.equal((enforced as { ambiance?: string }).ambiance, undefined);
});

test("formatClientPreferencesForDriver includes vehicle and ambiance lines", () => {
  const lines = formatClientPreferencesForDriver({
    clientPreferences: { non_smoking_driver: true },
    preferElectricOrHybrid: true,
    ambiance: "quiet",
  });
  assert.ok(lines.some((l) => l.label.includes("Non-Smoking")));
  assert.ok(lines.some((l) => l.label.includes("Electric")));
  assert.ok(lines.some((l) => l.label.includes("Quiet Ride")));
});

test("comfort category skips redundant AC enforcement in TS mirror", () => {
  assert.equal(
    driverSatisfiesPreferences({
      enforced: { air_conditioning_required: true },
      driver: { has_air_conditioning: false },
      vehicleClass: "comfort",
    }),
    true,
  );
});

test("shouldAdvancePreferenceStage when deadline passed", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  assert.equal(shouldAdvancePreferenceStage({ stageUntil: past }), true);
});

test("getDroppedPreferencesAtStage returns ordered drops", () => {
  const dropped = getDroppedPreferencesAtStage(DEFAULT_PREFERENCE_DROP_ORDER, 2);
  assert.deepEqual(dropped, ["child_seat_required", "non_smoking_driver"]);
});

test("buildPreferenceWidenClientMessage is non-empty when unmet", () => {
  const msg = buildPreferenceWidenClientMessage(["child_seat_required"]);
  assert.match(msg, /élargi la recherche/i);
});

test("migration defines staged dispatch functions", () => {
  const sql = fs.readFileSync(migration, "utf8");
  assert.match(sql, /driver_satisfies_ride_preferences/i);
  assert.match(sql, /advance_taxi_preference_dispatch_stage/i);
  assert.match(sql, /taxi_dispatch_preference_rules/i);
  assert.match(sql, /ambiance_preference/i);
});

test("performance: preference matching for 10000 drivers under 500ms", () => {
  const enforced = getEnforcedPreferences({
    requested: { non_smoking_driver: true, prefer_electric_or_hybrid: true },
    preferElectricOrHybrid: true,
    dropOrder: DEFAULT_PREFERENCE_DROP_ORDER,
    stage: 0,
  });
  const start = performance.now();
  for (let i = 0; i < 10_000; i += 1) {
    driverSatisfiesPreferences({
      enforced,
      driver: {
        non_smoking: i % 2 === 0,
        fuel_type: i % 3 === 0 ? "electric" : "gasoline",
      },
    });
  }
  assert.ok(performance.now() - start < 500);
});
