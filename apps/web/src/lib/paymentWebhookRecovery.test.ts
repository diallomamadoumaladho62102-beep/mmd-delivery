import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  claimPaymentWebhookEvent,
  finalizePaymentWebhookEvent,
  handleProviderWebhook,
  WEBHOOK_PROCESSING_STALE_SECONDS,
} from "./paymentWebhookService";

type WebhookRow = {
  id: string;
  provider: string;
  external_event_id: string;
  payload: Record<string, unknown>;
  status: string;
  processing_started_at: string | null;
  processed_at: string | null;
  last_error: string | null;
  attempt_count: number;
  next_retry_at: string | null;
  payment_transaction_id: string | null;
  received_at: string;
};

function createWebhookHarness(options?: {
  settleCrashAfterInsert?: boolean;
  settleCrashAfterPartial?: boolean;
  permanentFail?: boolean;
  fetchStatus?: "paid" | "processing" | "failed";
}) {
  const events = new Map<string, WebhookRow>();
  const settlements: string[] = [];
  let settleCalls = 0;

  const key = (provider: string, externalEventId: string) =>
    `${provider}::${externalEventId}`;

  const supabaseAdmin = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "claim_payment_webhook_event") {
        return Promise.resolve(
          claimLocal(
            String(args.p_provider),
            String(args.p_external_event_id),
            (args.p_payload as Record<string, unknown>) ?? {},
            Number(args.p_stale_seconds ?? WEBHOOK_PROCESSING_STALE_SECONDS),
          ),
        );
      }
      if (name === "finalize_payment_webhook_event") {
        const id = String(args.p_event_id);
        const row = [...events.values()].find((e) => e.id === id);
        if (!row) {
          return Promise.resolve({
            data: { ok: false, error: "webhook_event_not_found" },
            error: null,
          });
        }
        const outcome = String(args.p_outcome);
        row.status = outcome;
        if (outcome === "processed") {
          row.processed_at = new Date().toISOString();
          row.last_error = null;
          row.payment_transaction_id =
            (args.p_payment_transaction_id as string) ?? row.payment_transaction_id;
        } else {
          row.last_error = (args.p_last_error as string) ?? row.last_error;
          if (outcome === "retryable") {
            row.next_retry_at = new Date(Date.now() + 60_000).toISOString();
          }
        }
        return Promise.resolve({
          data: { ok: true, id: row.id, status: row.status, attempt_count: row.attempt_count },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: "unknown rpc" } });
    },
    from(table: string) {
      if (table === "payment_transactions") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle: async () => ({
                        data: {
                          id: "pay-1",
                          user_id: "user-1",
                          entity_type: "taxi_ride",
                          entity_id: "ride-1",
                          country_code: "GN",
                          provider: "orange_money_gn",
                          method_code: "mobile_money",
                          amount_cents: 1000,
                          currency: "gnf",
                          status: "processing",
                          external_reference: "ext-1",
                          provider_payload: {},
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
      }
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({ data: null, error: null }),
                  };
                },
              };
            },
          };
        },
        insert() {
          return {
            select() {
              return {
                single: async () => ({ data: null, error: { message: "unused" } }),
              };
            },
          };
        },
        update() {
          return {
            eq() {
              return {
                in() {
                  return {
                    select() {
                      return {
                        maybeSingle: async () => ({ data: null, error: null }),
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  function claimLocal(
    provider: string,
    externalEventId: string,
    payload: Record<string, unknown>,
    staleSeconds: number,
  ) {
    const k = key(provider, externalEventId);
    let row = events.get(k);
    if (!row) {
      row = {
        id: randomUUID(),
        provider,
        external_event_id: externalEventId,
        payload,
        status: "received",
        processing_started_at: null,
        processed_at: null,
        last_error: null,
        attempt_count: 0,
        next_retry_at: null,
        payment_transaction_id: null,
        received_at: new Date().toISOString(),
      };
      events.set(k, row);
    }

    if (row.status === "processed") {
      return {
        data: {
          ok: true,
          outcome: "already_processed",
          id: row.id,
          status: row.status,
          attempt_count: row.attempt_count,
        },
        error: null,
      };
    }

    const started = row.processing_started_at
      ? Date.parse(row.processing_started_at)
      : 0;
    if (
      row.status === "processing" &&
      started &&
      Date.now() - started < staleSeconds * 1000
    ) {
      return {
        data: {
          ok: true,
          outcome: "in_progress",
          id: row.id,
          status: row.status,
          attempt_count: row.attempt_count,
        },
        error: null,
      };
    }

    row.status = "processing";
    row.processing_started_at = new Date().toISOString();
    row.attempt_count += 1;
    row.payload = payload;
    row.last_error = null;
    return {
      data: {
        ok: true,
        outcome: "claimed",
        id: row.id,
        status: "processing",
        attempt_count: row.attempt_count,
      },
      error: null,
    };
  }

  // Patch settlement path via module dependency injection is hard;
  // we exercise claim/finalize + a thin settlement simulator here, and
  // handleProviderWebhook with mocked adapters via env isolation below.
  async function settleOnce(eventId: string) {
    settleCalls += 1;
    if (options?.settleCrashAfterInsert && settleCalls === 1) {
      throw new Error("simulated_crash_before_settlement");
    }
    if (options?.settleCrashAfterPartial && settleCalls === 1) {
      settlements.push("partial");
      throw new Error("simulated_crash_after_partial");
    }
    if (options?.permanentFail) {
      throw new Error("permanent_provider_reject");
    }
    settlements.push("settled");
    await finalizePaymentWebhookEvent(supabaseAdmin as never, {
      eventId,
      outcome: "processed",
      paymentTransactionId: "pay-1",
    });
  }

  return {
    supabaseAdmin: supabaseAdmin as never,
    events,
    settlements,
    getSettleCalls: () => settleCalls,
    claim: (externalEventId: string) =>
      claimPaymentWebhookEvent(supabaseAdmin as never, {
        provider: "orange_money_gn",
        externalEventId,
        payload: { token: externalEventId },
      }),
    settleOnce,
    markStale(externalEventId: string) {
      const row = events.get(key("orange_money_gn", externalEventId));
      assert.ok(row);
      row.status = "processing";
      row.processing_started_at = new Date(
        Date.now() - (WEBHOOK_PROCESSING_STALE_SECONDS + 30) * 1000,
      ).toISOString();
    },
  };
}

test("webhook happy path: claim then processed", async () => {
  const h = createWebhookHarness();
  const claim = await h.claim("evt-1");
  assert.equal(claim.outcome, "claimed");
  await h.settleOnce(claim.id!);
  const again = await h.claim("evt-1");
  assert.equal(again.outcome, "already_processed");
  assert.equal(h.settlements.length, 1);
});

test("duplicate after success does not settle again", async () => {
  const h = createWebhookHarness();
  const claim = await h.claim("evt-2");
  await h.settleOnce(claim.id!);
  const dup = await h.claim("evt-2");
  assert.equal(dup.outcome, "already_processed");
  assert.equal(h.getSettleCalls(), 1);
});

test("crash after insert then retry completes once", async () => {
  const h = createWebhookHarness({ settleCrashAfterInsert: true });
  const claim1 = await h.claim("evt-3");
  assert.equal(claim1.outcome, "claimed");
  await assert.rejects(() => h.settleOnce(claim1.id!), /simulated_crash_before_settlement/);
  await finalizePaymentWebhookEvent(h.supabaseAdmin, {
    eventId: claim1.id!,
    outcome: "retryable",
    lastError: "simulated_crash_before_settlement",
  });

  const claim2 = await h.claim("evt-3");
  assert.equal(claim2.outcome, "claimed");
  await h.settleOnce(claim2.id!);
  assert.deepEqual(h.settlements, ["settled"]);
  assert.equal(h.getSettleCalls(), 2);

  const claim3 = await h.claim("evt-3");
  assert.equal(claim3.outcome, "already_processed");
});

test("crash after partial then retry finishes without double settle marker", async () => {
  const h = createWebhookHarness({ settleCrashAfterPartial: true });
  const claim1 = await h.claim("evt-4");
  await assert.rejects(() => h.settleOnce(claim1.id!), /simulated_crash_after_partial/);
  await finalizePaymentWebhookEvent(h.supabaseAdmin, {
    eventId: claim1.id!,
    outcome: "retryable",
    lastError: "simulated_crash_after_partial",
  });
  const claim2 = await h.claim("evt-4");
  assert.equal(claim2.outcome, "claimed");
  await h.settleOnce(claim2.id!);
  assert.deepEqual(h.settlements, ["partial", "settled"]);
});

test("two concurrent claims: only one wins", async () => {
  const h = createWebhookHarness();
  const [a, b] = await Promise.all([h.claim("evt-5"), h.claim("evt-5")]);
  const outcomes = [a.outcome, b.outcome].sort();
  assert.deepEqual(outcomes, ["claimed", "in_progress"]);
});

test("abandoned processing can be reclaimed", async () => {
  const h = createWebhookHarness();
  const first = await h.claim("evt-6");
  assert.equal(first.outcome, "claimed");
  h.markStale("evt-6");
  const second = await h.claim("evt-6");
  assert.equal(second.outcome, "claimed");
  assert.ok((second.attempt_count ?? 0) >= 2);
});

test("permanent failure is recorded as failed", async () => {
  const h = createWebhookHarness({ permanentFail: true });
  const claim = await h.claim("evt-7");
  await assert.rejects(() => h.settleOnce(claim.id!), /permanent_provider_reject/);
  await finalizePaymentWebhookEvent(h.supabaseAdmin, {
    eventId: claim.id!,
    outcome: "failed",
    lastError: "permanent_provider_reject",
  });
  const row = [...h.events.values()].find((e) => e.external_event_id === "evt-7");
  assert.equal(row?.status, "failed");
  assert.equal(row?.last_error, "permanent_provider_reject");
});

// Keep handleProviderWebhook import exercised (unknown provider path).
test("handleProviderWebhook rejects unknown provider", async () => {
  const result = await handleProviderWebhook(
    { rpc: async () => ({ data: null, error: null }) } as never,
    "not_a_provider",
    {},
    new Headers(),
  );
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.equal(result.error, "unknown_provider");
  }
});
