import assert from "node:assert/strict";
import {
  isMarketplaceDispatchLiveEnabled,
  MARKETPLACE_DISPATCH_LIVE_DISABLED_MESSAGE,
} from "./marketplaceDispatch";
import {
  assignMarketplaceDriver,
  getMarketplaceDispatchStatus,
  markMarketplaceJobReady,
  prepareMarketplaceDeliveryJob,
  simulateMarketplaceDispatch,
} from "./marketplaceDispatchService";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(
    () => console.log(`ok ${name}`),
    (error) => {
      console.error(`FAIL ${name}`);
      throw error;
    }
  );
}

const originalDispatchFlag = process.env.MARKETPLACE_DISPATCH_LIVE_ENABLED;

function createMockAdmin(overrides: Record<string, unknown> = {}) {
  const state = {
    jobs: [] as Record<string, unknown>[],
    orders: [
      {
        id: "order-paid-1",
        seller_id: "seller-1",
        client_user_id: "client-1",
        status: "paid",
        payment_status: "paid",
        pickup_location_id: "pickup-1",
        dropoff_location_id: "dropoff-1",
        seller_pickup_address: "Seller shop",
        estimated_distance_miles: 4.2,
        estimated_minutes: 14,
        driver_earning_shadow_cents: 800,
        platform_margin_shadow_cents: 200,
        sellers: { country_code: "GN" },
      },
    ] as Record<string, unknown>[],
    locations: [
      {
        id: "pickup-1",
        formatted_address: "Pickup address",
        commune_name: "Matam",
        quartier_name: "Zone A",
        country_code: "GN",
        pin_lat: 9.6378,
        pin_lng: -13.5784,
      },
      {
        id: "dropoff-1",
        formatted_address: "Dropoff address",
        commune_name: "Ratoma",
        quartier_name: "Zone B",
        country_code: "GN",
        pin_lat: 9.6412,
        pin_lng: -13.5718,
      },
    ] as Record<string, unknown>[],
    deliveryRequestsInserted: 0,
    ...overrides,
  };

  const from = (table: string) => ({
    select: (_cols: string) => ({
      eq: (col: string, val: string) => ({
        maybeSingle: async () => {
          if (table === "marketplace_delivery_jobs") {
            const row = state.jobs.find((j) => j[col] === val) ?? null;
            return { data: row, error: null };
          }
          if (table === "seller_orders") {
            const row = state.orders.find((o) => o[col] === val) ?? null;
            return { data: row, error: null };
          }
          if (table === "location_points") {
            const row = state.locations.find((l) => l[col] === val) ?? null;
            return { data: row, error: null };
          }
          return { data: null, error: null };
        },
      }),
    }),
    insert: (payload: Record<string, unknown>) => ({
      select: (_cols: string) => ({
        maybeSingle: async () => {
          if (table === "delivery_requests") {
            state.deliveryRequestsInserted += 1;
            return { data: payload, error: null };
          }
          if (table === "marketplace_delivery_jobs") {
            const row = { id: "job-1", ...payload };
            state.jobs.push(row);
            return { data: row, error: null };
          }
          return { data: null, error: null };
        },
      }),
    }),
    update: (payload: Record<string, unknown>) => ({
      eq: (col: string, val: string) => ({
        neq: () => ({
          select: (_cols: string) => ({
            maybeSingle: async () => {
              const row = state.jobs.find((j) => j[col] === val);
              if (!row) return { data: null, error: null };
              Object.assign(row, payload);
              return { data: row, error: null };
            },
          }),
        }),
        in: (_statusCol: string, _statuses: string[]) => ({
          select: (_cols: string) => ({
            maybeSingle: async () => {
              const row = state.jobs.find((j) => j[col] === val);
              if (!row) return { data: null, error: null };
              Object.assign(row, payload);
              return { data: row, error: null };
            },
          }),
        }),
      }),
    }),
  });

  return { admin: { from } as never, state };
}

async function main() {
  await test("dispatch live flag defaults to disabled", () => {
    delete process.env.MARKETPLACE_DISPATCH_LIVE_ENABLED;
    assert.equal(isMarketplaceDispatchLiveEnabled(), false);
    assert.equal(
      MARKETPLACE_DISPATCH_LIVE_DISABLED_MESSAGE,
      "Marketplace live dispatch is not enabled yet"
    );
  });

  await test("paid order creates dispatch job with flag off (shadow-safe)", async () => {
    delete process.env.MARKETPLACE_DISPATCH_LIVE_ENABLED;
    const { admin, state } = createMockAdmin();

    const result = await prepareMarketplaceDeliveryJob(admin, {
      sellerOrderId: "order-paid-1",
      source: "test",
    });

    assert.equal(result.ok, true);
    assert.ok(result.job);
    assert.equal(result.job?.status, "dispatch_pending");
    assert.equal(result.job?.live_dispatch_enabled, false);
    assert.equal(result.job?.drivers_notified, false);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.deliveryRequestsInserted, 0);
  });

  await test("unpaid order skips job creation", async () => {
    delete process.env.MARKETPLACE_DISPATCH_LIVE_ENABLED;
    const { admin, state } = createMockAdmin({
      orders: [
        {
          id: "order-draft-1",
          seller_id: "seller-1",
          client_user_id: "client-1",
          status: "draft",
          payment_status: "pending",
        },
      ],
    });

    const result = await prepareMarketplaceDeliveryJob(admin, {
      sellerOrderId: "order-draft-1",
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, "order_not_paid");
    assert.equal(state.jobs.length, 0);
  });

  await test("flag OFF means assignMarketplaceDriver is ignored", async () => {
    delete process.env.MARKETPLACE_DISPATCH_LIVE_ENABLED;
    const { admin } = createMockAdmin();

    const assigned = await assignMarketplaceDriver(admin, {
      jobId: "job-1",
      driverUserId: "driver-1",
    });
    assert.equal(assigned.ok, true);
    assert.equal(assigned.ignored, "marketplace_dispatch_live_disabled");
  });

  await test("simulateMarketplaceDispatch never notifies drivers", async () => {
    delete process.env.MARKETPLACE_DISPATCH_LIVE_ENABLED;
    const { admin, state } = createMockAdmin();
    state.jobs.push({
      id: "job-1",
      seller_order_id: "order-paid-1",
      estimated_distance_miles: 3,
      estimated_minutes: 10,
      driver_earning_cents: 500,
      platform_margin_cents: 100,
      drivers_notified: false,
      live_dispatch_enabled: false,
    });

    const simulated = await simulateMarketplaceDispatch(admin, { jobId: "job-1" });
    assert.equal(simulated.ok, true);
    assert.equal(simulated.simulation?.drivers_notified, false);
    assert.equal(simulated.job?.drivers_notified, false);
  });

  await test("markMarketplaceJobReady ignored when flag off", async () => {
    delete process.env.MARKETPLACE_DISPATCH_LIVE_ENABLED;
    const { admin } = createMockAdmin();

    const ready = await markMarketplaceJobReady(admin, { jobId: "job-1" });
    assert.equal(ready.ok, true);
    assert.equal(ready.ignored, "marketplace_dispatch_live_disabled");
  });

  await test("getMarketplaceDispatchStatus reports platform flag off", async () => {
    delete process.env.MARKETPLACE_DISPATCH_LIVE_ENABLED;
    const { admin } = createMockAdmin();

    const status = await getMarketplaceDispatchStatus(admin, {
      sellerOrderId: "order-paid-1",
    });
    assert.equal(status.ok, true);
    assert.equal(status.live_dispatch_enabled, false);
    assert.equal(status.job, null);
  });

  process.env.MARKETPLACE_DISPATCH_LIVE_ENABLED = originalDispatchFlag;
  console.log("marketplaceDispatchService tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
