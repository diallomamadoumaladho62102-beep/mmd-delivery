import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveClientPlatformScope } from "./platformScopeResolver";

function createMockSupabase(options: {
  savedCountry?: string | null;
  savedState?: string | null;
  profileCountry?: string | null;
}) {
  return {
    from(table: string) {
      if (table === "client_addresses") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: options.savedCountry
                    ? {
                        country: options.savedCountry,
                        state: options.savedState ?? null,
                      }
                    : null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.profileCountry
                  ? { country_code: options.profileCountry }
                  : null,
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "mmd_zones") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "zone-conakry",
                  zone_code: "gn_conakry",
                  region_name: "Conakry",
                  prefecture_name: null,
                  city_name: null,
                  commune_name: null,
                  quartier_name: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }

      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

async function run() {
  const nycLat = 40.7128;
  const nycLng = -74.006;
  const conakryLat = 9.6412;
  const conakryLng = -13.5784;

  await test("GPS New York beats saved GN address", async () => {
    const supabase = createMockSupabase({ savedCountry: "GN", profileCountry: "GN" });
    const scope = await resolveClientPlatformScope(supabase, "user-1", {
      lat: nycLat,
      lng: nycLng,
    });
    assert.equal(scope.country_code, "US");
    assert.equal(scope.state_code, "NY");
    assert.equal(scope.region_code, "ny");
    assert.equal(scope.county_code, "nyc");
    assert.equal(scope.scope_level, "county");
    assert.equal(scope.scope_source, "gps");
  });

  await test("GPS Conakry resolves GN zone", async () => {
    const supabase = createMockSupabase({ savedCountry: "US", profileCountry: "US" });
    const scope = await resolveClientPlatformScope(supabase, "user-1", {
      lat: conakryLat,
      lng: conakryLng,
    });
    assert.equal(scope.country_code, "GN");
    assert.equal(scope.zone_code, "gn_conakry");
    assert.equal(scope.scope_source, "gps");
  });

  await test("saved GN address used when GPS absent", async () => {
    const supabase = createMockSupabase({ savedCountry: "GN" });
    const scope = await resolveClientPlatformScope(supabase, "user-1", {});
    assert.equal(scope.country_code, "GN");
    assert.equal(scope.scope_source, "saved_address");
  });

  await test("explicit manual GN selection", async () => {
    const supabase = createMockSupabase({ savedCountry: "US" });
    const scope = await resolveClientPlatformScope(supabase, "user-1", {
      manualCountry: "GN",
    });
    assert.equal(scope.country_code, "GN");
    assert.equal(scope.scope_source, "manual");
  });

  await test("pickup country wins over GPS", async () => {
    const supabase = createMockSupabase({});
    const scope = await resolveClientPlatformScope(supabase, "user-1", {
      pickupCountry: "GN",
      lat: nycLat,
      lng: nycLng,
    });
    assert.equal(scope.country_code, "GN");
    assert.equal(scope.scope_source, "order_pickup");
  });

  console.log("platformScopeResolver clientScope tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
