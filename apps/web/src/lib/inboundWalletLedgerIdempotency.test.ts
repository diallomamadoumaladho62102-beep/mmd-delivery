import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  appendWalletLedgerEntry,
  buildWalletLedgerIdempotencyKey,
} from "./payoutTransactionService";
import { recordInboundPaymentWalletEntries } from "./inboundWalletBridge";
import type { PaymentTransactionRow } from "./paymentTypes";

type LedgerRow = {
  id: string;
  account_type: string;
  account_user_id: string | null;
  country_code: string;
  currency: string;
  direction: string;
  amount_cents: number;
  balance_after_cents: number;
  reference_type: string;
  reference_id: string;
  description: string | null;
  metadata: Record<string, unknown>;
  idempotency_key: string;
  created_at: string;
};

function createLedgerStore() {
  const rows: LedgerRow[] = [];
  let rpcEnabled = true;
  let forceSqlError: string | null = null;

  function idemKey(input: {
    account_type: string;
    account_user_id: string | null;
    reference_type: string;
    reference_id: string;
    direction: string;
  }) {
    return buildWalletLedgerIdempotencyKey({
      accountType: input.account_type,
      accountUserId: input.account_user_id,
      referenceType: input.reference_type,
      referenceId: input.reference_id,
      direction: input.direction,
    });
  }

  function insertRow(payload: Record<string, unknown>): {
    data: LedgerRow | null;
    error: { code?: string; message: string } | null;
  } {
    if (forceSqlError) {
      return { data: null, error: { message: forceSqlError, code: "XX000" } };
    }
    const row: LedgerRow = {
      id: randomUUID(),
      account_type: String(payload.account_type),
      account_user_id: (payload.account_user_id as string | null) ?? null,
      country_code: String(payload.country_code),
      currency: String(payload.currency),
      direction: String(payload.direction),
      amount_cents: Number(payload.amount_cents),
      balance_after_cents: Number(payload.balance_after_cents ?? 0),
      reference_type: String(payload.reference_type),
      reference_id: String(payload.reference_id),
      description: (payload.description as string | null) ?? null,
      metadata: (payload.metadata as Record<string, unknown>) ?? {},
      idempotency_key:
        String(payload.idempotency_key ?? "") ||
        idemKey({
          account_type: String(payload.account_type),
          account_user_id: (payload.account_user_id as string | null) ?? null,
          reference_type: String(payload.reference_type),
          reference_id: String(payload.reference_id),
          direction: String(payload.direction),
        }),
      created_at: new Date().toISOString(),
    };
    if (rows.some((r) => r.idempotency_key === row.idempotency_key)) {
      return {
        data: null,
        error: { code: "23505", message: "duplicate key value violates unique constraint" },
      };
    }
    rows.push(row);
    return { data: row, error: null };
  }

  const supabaseAdmin = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name !== "record_inbound_payment_wallet_entries" || !rpcEnabled) {
        return Promise.resolve({
          data: null,
          error: { message: "could not find the function", code: "PGRST202" },
        });
      }
      if (forceSqlError) {
        return Promise.resolve({
          data: { ok: false, error: forceSqlError },
          error: null,
        });
      }

      const txId = String(args.p_transaction_id);
      const userId = String(args.p_user_id);
      const amount = Number(args.p_amount_cents);

      const creditPayload = {
        account_type: "platform",
        account_user_id: null,
        country_code: args.p_country_code,
        currency: args.p_currency,
        direction: "credit",
        amount_cents: amount,
        balance_after_cents: amount,
        reference_type: "payment_transaction",
        reference_id: txId,
        description: args.p_credit_description,
        metadata: {},
      };
      const debitPayload = {
        account_type: "client",
        account_user_id: userId,
        country_code: args.p_country_code,
        currency: args.p_currency,
        direction: "debit",
        amount_cents: amount,
        balance_after_cents: 0,
        reference_type: "payment_transaction",
        reference_id: txId,
        description: args.p_debit_description,
        metadata: {},
      };

      const before = rows.length;
      const credit = insertRow(creditPayload);
      if (credit.error && credit.error.code !== "23505") {
        return Promise.resolve({
          data: { ok: false, error: credit.error.message },
          error: null,
        });
      }
      if (credit.error?.code === "23505") {
        const existing = rows.find(
          (r) =>
            r.idempotency_key ===
            idemKey({
              account_type: "platform",
              account_user_id: null,
              reference_type: "payment_transaction",
              reference_id: txId,
              direction: "credit",
            }),
        )!;
        credit.data = existing;
      }

      const debit = insertRow(debitPayload);
      if (debit.error && debit.error.code !== "23505") {
        return Promise.resolve({
          data: { ok: false, error: debit.error.message },
          error: null,
        });
      }
      if (debit.error?.code === "23505") {
        const existing = rows.find(
          (r) =>
            r.idempotency_key ===
            idemKey({
              account_type: "client",
              account_user_id: userId,
              reference_type: "payment_transaction",
              reference_id: txId,
              direction: "debit",
            }),
        )!;
        debit.data = existing;
      }

      return Promise.resolve({
        data: {
          ok: true,
          created: rows.length > before,
          credit_id: credit.data!.id,
          debit_id: debit.data!.id,
        },
        error: null,
      });
    },
    from(table: string) {
      assert.equal(table, "wallet_ledger");
      const filters: Record<string, unknown> = {};
      const api = {
        select() {
          return api;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return api;
        },
        is(col: string, val: null) {
          filters[col] = val;
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        maybeSingle: async () => {
          if ("idempotency_key" in filters) {
            return {
              data: rows.find((r) => r.idempotency_key === filters.idempotency_key) ?? null,
              error: null,
            };
          }
          return { data: null, error: null };
        },
        then(
          resolve: (v: {
            data: Array<{ direction: string; amount_cents: number }>;
            error: null;
          }) => unknown,
          reject?: (e: unknown) => unknown
        ) {
          try {
            let filtered = [...rows];
            if ("account_type" in filters) {
              filtered = filtered.filter((r) => r.account_type === filters.account_type);
            }
            if ("currency" in filters) {
              filtered = filtered.filter((r) => r.currency === filters.currency);
            }
            if ("account_user_id" in filters) {
              const uid = filters.account_user_id;
              filtered =
                uid === null
                  ? filtered.filter((r) => r.account_user_id === null)
                  : filtered.filter((r) => r.account_user_id === uid);
            }
            return Promise.resolve(
              resolve({
                data: filtered.map((r) => ({
                  direction: r.direction,
                  amount_cents: r.amount_cents,
                })),
                error: null,
              })
            );
          } catch (e) {
            return Promise.reject(reject ? reject(e) : e);
          }
        },
      };
      return {
        select(_cols?: string) {
          void _cols;
          return api.select();
        },
        insert(payload: Record<string, unknown>) {
          return {
            select() {
              return {
                single: async () => insertRow(payload),
              };
            },
          };
        },
      };
    },
  };

  return {
    supabaseAdmin: supabaseAdmin as never,
    rows,
    setRpcEnabled(v: boolean) {
      rpcEnabled = v;
    },
    setForceSqlError(message: string | null) {
      forceSqlError = message;
    },
  };
}

function sampleTx(id = randomUUID()): PaymentTransactionRow {
  const now = new Date().toISOString();
  return {
    id,
    order_id: null,
    user_id: randomUUID(),
    entity_type: "taxi_ride",
    entity_id: randomUUID(),
    country_code: "US",
    provider: "stripe",
    method_code: "card",
    amount_cents: 1500,
    currency: "usd",
    status: "paid",
    external_reference: "pi_test",
    payment_url: null,
    provider_payload: {},
    payer_phone: null,
    failure_reason: null,
    paid_at: now,
    expires_at: null,
    created_at: now,
    updated_at: now,
  };
}

test("buildWalletLedgerIdempotencyKey separates credit and debit for same reference", () => {
  const credit = buildWalletLedgerIdempotencyKey({
    accountType: "platform",
    accountUserId: null,
    referenceType: "payment_transaction",
    referenceId: "tx-1",
    direction: "credit",
  });
  const debit = buildWalletLedgerIdempotencyKey({
    accountType: "client",
    accountUserId: "user-1",
    referenceType: "payment_transaction",
    referenceId: "tx-1",
    direction: "debit",
  });
  assert.notEqual(credit, debit);
});

test("first payment creates credit+debit pair; replay creates none", async () => {
  const store = createLedgerStore();
  const tx = sampleTx();

  const first = await recordInboundPaymentWalletEntries(store.supabaseAdmin, tx);
  assert.equal(first.ok, true);
  assert.equal(store.rows.length, 2);

  const second = await recordInboundPaymentWalletEntries(store.supabaseAdmin, tx);
  assert.equal(second.ok, true);
  assert.equal(store.rows.length, 2);
  assert.equal(second.creditId, first.creditId);
  assert.equal(second.debitId, first.debitId);
});

test("ten concurrent replays still yield a single pair", async () => {
  const store = createLedgerStore();
  const tx = sampleTx();

  await Promise.all(
    Array.from({ length: 10 }, () =>
      recordInboundPaymentWalletEntries(store.supabaseAdmin, tx),
    ),
  );

  assert.equal(store.rows.length, 2);
  const directions = store.rows.map((r) => r.direction).sort();
  assert.deepEqual(directions, ["credit", "debit"]);
});

test("two legitimate directions with same reference_id do not block each other", async () => {
  const store = createLedgerStore();
  store.setRpcEnabled(false);
  const referenceId = randomUUID();

  const credit = await appendWalletLedgerEntry(store.supabaseAdmin, {
    accountType: "platform",
    accountUserId: null,
    countryCode: "US",
    currency: "usd",
    direction: "credit",
    amountCents: 100,
    referenceType: "payment_transaction",
    referenceId,
    description: "credit",
  });
  const debit = await appendWalletLedgerEntry(store.supabaseAdmin, {
    accountType: "client",
    accountUserId: randomUUID(),
    countryCode: "US",
    currency: "usd",
    direction: "debit",
    amountCents: 100,
    referenceType: "payment_transaction",
    referenceId,
    description: "debit",
  });

  assert.ok(credit.id);
  assert.ok(debit.id);
  assert.notEqual(credit.id, debit.id);
  assert.equal(store.rows.length, 2);
});

test("non-duplicate SQL errors remain visible", async () => {
  const store = createLedgerStore();
  store.setForceSqlError("connection refused");
  const tx = sampleTx();

  await assert.rejects(
    () => recordInboundPaymentWalletEntries(store.supabaseAdmin, tx),
    /connection refused|wallet_ledger/,
  );
  assert.equal(store.rows.length, 0);
});
