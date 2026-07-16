import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertDriverCanGoOnline,
  didMaterialVehicleFieldsChange,
} from "./driverOnlineStatus";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

test("material vehicle field detection flags plate/year changes", () => {
  assert.equal(
    didMaterialVehicleFieldsChange(
      { license_plate: "ABC123", nickname: "old" },
      { license_plate: "XYZ999", nickname: "new" },
    ),
    true,
  );
  assert.equal(
    didMaterialVehicleFieldsChange(
      { license_plate: "ABC123", nickname: "old" },
      { nickname: "new" },
    ),
    false,
  );
});

test("online gate requires approved active vehicle for car mode", async () => {
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const supabase = {
    from(table: string) {
      const state: { filters: Record<string, unknown>; maybeSingle?: () => Promise<any> } = {
        filters: {},
      };
      const builder: any = {
        select() {
          return builder;
        },
        eq(col: string, value: unknown) {
          state.filters[col] = value;
          return builder;
        },
        maybeSingle: async () => {
          calls.push({ table, filters: { ...state.filters } });
          if (table === "driver_profiles") {
            return {
              data: {
                status: "approved",
                transport_mode: "car",
                active_vehicle_id: "veh-1",
                is_online: false,
              },
              error: null,
            };
          }
          if (table === "driver_service_preferences") {
            return {
              data: {
                food_delivery_enabled: true,
                package_delivery_enabled: false,
                taxi_rides_enabled: false,
              },
              error: null,
            };
          }
          if (table === "driver_vehicles") {
            return {
              data: {
                id: "veh-1",
                vehicle_status: "pending_review",
                vehicle_active: true,
                admin_review_status: "pending_review",
                deleted_at: null,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  };

  const result = await assertDriverCanGoOnline(supabase as any, "driver-1");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "vehicle_pending_review");
  }
});

test("online gate allows bike without vehicle when a service is enabled", async () => {
  const supabase = {
    from(table: string) {
      const builder: any = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle: async () => {
          if (table === "driver_profiles") {
            return {
              data: {
                status: "approved",
                transport_mode: "bike",
                active_vehicle_id: null,
                is_online: false,
              },
              error: null,
            };
          }
          if (table === "driver_service_preferences") {
            return {
              data: {
                food_delivery_enabled: true,
                package_delivery_enabled: false,
                taxi_rides_enabled: false,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  };

  const result = await assertDriverCanGoOnline(supabase as any, "driver-bike");
  assert.equal(result.ok, true);
});

test("admin reject route clears active vehicle and recalculates", () => {
  const route = fs.readFileSync(
    path.join(repoRoot, "apps", "web", "app", "api", "admin", "driver-vehicles", "route.ts"),
    "utf8",
  );
  assert.match(route, /action === "reject_vehicle"/);
  assert.match(route, /vehicle_active:\s*false/);
  assert.match(route, /active_vehicle_id:\s*null/);
  assert.match(route, /recalculateVehicleWithNotifications/);
  assert.match(route, /invalid_action/);
});

test("driver online API exists and uses service-role helper", () => {
  const route = fs.readFileSync(
    path.join(repoRoot, "apps", "web", "app", "api", "driver", "online", "route.ts"),
    "utf8",
  );
  assert.match(route, /setDriverOnlineStatusAdmin/);
  assert.match(route, /is_online/);
});

test("driver vehicle PATCH resets review on material edits", () => {
  const route = fs.readFileSync(
    path.join(repoRoot, "apps", "web", "app", "api", "driver", "vehicles", "[id]", "route.ts"),
    "utf8",
  );
  assert.match(route, /didMaterialVehicleFieldsChange/);
  assert.match(route, /pending_review/);
  assert.match(route, /vehicle_resubmitted_for_review/);
});

test("latest migration hardens active vehicle + eligibility gates", () => {
  const sql = fs.readFileSync(
    path.join(
      repoRoot,
      "supabase",
      "migrations",
      "20260815120000_driver_vehicle_online_gate_hardening.sql",
    ),
    "utf8",
  );
  assert.match(sql, /admin_review_status.*approved/i);
  assert.match(sql, /active_vehicle_id/i);
  assert.doesNotMatch(sql, /%.1f/);
  assert.match(sql, /to_char\(v_rule\.min_driver_rating/);
  assert.match(sql, /driver_user_id', v_vehicle\.driver_user_id/);
});

test("mobile uses online API instead of direct is_online write", () => {
  const home = fs.readFileSync(
    path.join(repoRoot, "apps", "mobile", "src", "screens", "DriverHomeScreen.tsx"),
    "utf8",
  );
  const api = fs.readFileSync(
    path.join(repoRoot, "apps", "mobile", "src", "lib", "driverServicePreferencesApi.ts"),
    "utf8",
  );
  const location = fs.readFileSync(
    path.join(repoRoot, "apps", "mobile", "src", "lib", "location.ts"),
    "utf8",
  );
  assert.match(api, /\/api\/driver\/online/);
  assert.match(home, /setDriverOnlineViaApi/);
  assert.match(location, /setDriverOnlineViaApi/);
  assert.doesNotMatch(
    home,
    /\.from\("driver_profiles"\)\s*\.update\(\{\s*is_online/,
  );
});

test("vehicles screen subscribes to realtime vehicle updates", () => {
  const screen = fs.readFileSync(
    path.join(repoRoot, "apps", "mobile", "src", "screens", "driver", "DriverVehiclesScreen.tsx"),
    "utf8",
  );
  assert.match(screen, /subscribePostgresChannel/);
  assert.match(screen, /driver_vehicles/);
  assert.match(screen, /vehicle_category_eligibility/);
});
