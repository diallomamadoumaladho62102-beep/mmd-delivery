import assert from "node:assert/strict";
import test from "node:test";
import { chargeWaitLateFeeIfEligible } from "./waitTimerLateFeeBilling";

function createMockAdmin(state: {
  row: Record<string, unknown> | null;
  existingPaymentId?: string | null;
}) {
  const inserts: Record<string, unknown>[] = [];

  function chain(table: string) {
    const filters: Record<string, unknown> = {};
    return {
      eq(col: string, val: unknown) {
        filters[col] = val;
        return chain(table);
      },
      in(col: string, _vals: unknown[]) {
        filters[col] = _vals;
        return {
          maybeSingle: async () => {
            if (table === "payment_transactions") {
              return {
                data: state.existingPaymentId ? { id: state.existingPaymentId } : null,
                error: null,
              };
            }
            return { data: null, error: null };
          },
        };
      },
      maybeSingle: async () => {
        if (table === "orders" || table === "delivery_requests" || table === "taxi_rides") {
          return { data: state.row, error: null };
        }
        if (table === "payment_transactions") {
          return {
            data: state.existingPaymentId ? { id: state.existingPaymentId } : null,
            error: null,
          };
        }
        return { data: null, error: null };
      },
    };
  }

  const supabaseAdmin = {
    from(table: string) {
      return {
        select(_cols: string) {
          if (table === "wallet_ledger") {
            return {
              eq(_col: string, _val: unknown) {
                const afterCurrency = {
                  order(_col3: string, _opts: { ascending: boolean }) {
                    return {
                      limit(_n: number) {
                        return {
                          eq(_col4: string, _val4: unknown) {
                            return {
                              maybeSingle: async () => ({
                                data: { balance_after_cents: 0 },
                                error: null,
                              }),
                            };
                          },
                          is(_col4: string, _val4: null) {
                            return {
                              maybeSingle: async () => ({
                                data: { balance_after_cents: 0 },
                                error: null,
                              }),
                            };
                          },
                        };
                      },
                    };
                  },
                };
                return {
                  eq(_col2: string, _val2: unknown) {
                    return afterCurrency;
                  },
                };
              },
            };
          }
          return chain(table);
        },
        update(_patch: Record<string, unknown>) {
          return {
            eq() {
              return Promise.resolve({ error: null });
            },
          };
        },
        insert(payload: Record<string, unknown>) {
          inserts.push(payload);
          return {
            select() {
              return {
                single: async () => ({
                  data:
                    table === "wallet_ledger"
                      ? { id: "ledger-1", ...payload }
                      : table === "wait_timer_events"
                        ? { id: "event-1", ...payload }
                        : {
                            id: "pay-late-fee-1",
                            ...payload,
                            status: "paid",
                          },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };

  return { supabaseAdmin: supabaseAdmin as never, inserts };
}

test("chargeWaitLateFeeIfEligible skips when GPS not validated", async () => {
  const { supabaseAdmin } = createMockAdmin({
    row: {
      id: "order-1",
      driver_id: "driver-1",
      client_user_id: "client-1",
      currency: "USD",
      wait_fee_status: "accruing",
      driver_arrived_at: new Date().toISOString(),
      manual_arrival_required: true,
      driver_distance_to_target_meters: 10,
      wait_timer_started_at: new Date(Date.now() - 13 * 60 * 1000).toISOString(),
      free_wait_minutes: 5,
      leave_at_door: false,
    },
  });

  const result = await chargeWaitLateFeeIfEligible(supabaseAdmin, {
    entityType: "order",
    entityId: "order-1",
    orderId: "order-1",
  });

  assert.equal(result.charged, false);
  if (result.charged === false) {
    assert.equal(result.reason, "gps_not_validated");
  }
});

test("chargeWaitLateFeeIfEligible creates payment_transaction and marks charged", async () => {
  const started = new Date(Date.now() - 13 * 60 * 1000).toISOString();
  const { supabaseAdmin, inserts } = createMockAdmin({
    row: {
      id: "order-2",
      driver_id: "driver-2",
      client_user_id: "client-2",
      currency: "USD",
      pickup_lat: 40.7,
      pickup_lng: -74.0,
      dropoff_lat: 40.71,
      dropoff_lng: -74.01,
      wait_fee_status: "capped",
      driver_arrived_at: started,
      manual_arrival_required: false,
      driver_distance_to_target_meters: 25,
      wait_timer_started_at: started,
      free_wait_minutes: 5,
      leave_at_door: false,
    },
  });

  const result = await chargeWaitLateFeeIfEligible(supabaseAdmin, {
    entityType: "order",
    entityId: "order-2",
    orderId: "order-2",
  });

  assert.equal(result.charged, true);
  if (result.charged === true) {
    assert.ok(result.fee_cents > 0);
    assert.equal(result.payment_transaction_id, "pay-late-fee-1");
  }

  const paymentInsert = inserts.find((row) => row.charge_category === "late_fee");
  assert.ok(paymentInsert);
  assert.equal(paymentInsert?.status, "paid");
});

test("chargeWaitLateFeeIfEligible is idempotent when already charged", async () => {
  const started = new Date(Date.now() - 13 * 60 * 1000).toISOString();
  const { supabaseAdmin } = createMockAdmin({
    row: {
      id: "order-3",
      driver_id: "driver-3",
      client_user_id: "client-3",
      currency: "USD",
      wait_fee_status: "charged",
      driver_arrived_at: started,
      manual_arrival_required: false,
      driver_distance_to_target_meters: 20,
      wait_timer_started_at: started,
      free_wait_minutes: 5,
      leave_at_door: false,
    },
  });

  const result = await chargeWaitLateFeeIfEligible(supabaseAdmin, {
    entityType: "order",
    entityId: "order-3",
    orderId: "order-3",
  });

  assert.equal(result.charged, false);
  if (result.charged === false) {
    assert.equal(result.reason, "already_charged");
  }
});
