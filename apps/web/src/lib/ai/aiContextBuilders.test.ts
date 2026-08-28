import assert from "node:assert/strict";
import { buildSharedMissionContext } from "./contexts/buildSharedMissionContext";

function fakeSupabase(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      return {
        select() {
          return {
            eq(_col: string, id: string) {
              return {
                maybeSingle: async () => ({
                  data: rows.find((r) => (r as { id: string }).id === id) ?? null,
                  error: null,
                }),
              };
            },
            or() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return this;
            },
            maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
          };
        },
      };
    },
  };
}

const order = {
  id: "11111111-1111-1111-1111-111111111111",
  kind: "food",
  status: "ready",
  payment_status: "paid",
  pickup_address: "Resto",
  dropoff_address: "Home",
  restaurant_name: "Thiep House",
  driver_id: "driver-1",
  client_user_id: "client-1",
};

const ride = {
  id: "22222222-2222-2222-2222-222222222222",
  status: "in_progress",
  payment_status: "paid",
  pickup_address: "A",
  dropoff_address: "B",
  driver_id: "driver-1",
  client_user_id: "client-1",
};

async function main() {
  const foodMission = await buildSharedMissionContext({
    supabaseAdmin: fakeSupabase({
      orders: [order],
      delivery_requests: [],
      taxi_rides: [],
    }) as never,
    userId: "client-1",
    viewerRole: "client",
    orderId: order.id,
  });
  assert.equal(foodMission?.missionKind, "restaurant_order");
  assert.equal(foodMission?.driverAssigned, true);
  assert.match(foodMission?.safeSummary ?? "", /Thiep House/);

  const denied = await buildSharedMissionContext({
    supabaseAdmin: fakeSupabase({
      orders: [order],
      delivery_requests: [],
      taxi_rides: [],
    }) as never,
    userId: "other-user",
    viewerRole: "client",
    orderId: order.id,
  });
  assert.equal(denied, null);

  const taxiMission = await buildSharedMissionContext({
    supabaseAdmin: fakeSupabase({
      orders: [],
      delivery_requests: [],
      taxi_rides: [ride],
    }) as never,
    userId: "client-1",
    viewerRole: "client",
    orderId: ride.id,
  });
  assert.equal(taxiMission?.missionKind, "taxi_ride");

  const invalid = await buildSharedMissionContext({
    supabaseAdmin: fakeSupabase({}) as never,
    userId: "client-1",
    viewerRole: "client",
    orderId: "not-a-uuid",
  });
  assert.equal(invalid, null);

  console.log("aiContextBuilders.test.ts OK");
}

void main();
