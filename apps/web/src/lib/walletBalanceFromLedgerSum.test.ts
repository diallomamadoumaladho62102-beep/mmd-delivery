import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  appendWalletLedgerEntry,
  getWalletBalance,
  sumWalletLedgerBalanceCents,
} from "./payoutTransactionService";

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
  idempotency_key: string;
  created_at: string;
};

type QuarantineRow = {
  original_ledger_id: string;
  payload: LedgerRow;
};

function createFinanceStore() {
  const rows: LedgerRow[] = [];
  const quarantine: QuarantineRow[] = [];

  function matchesWallet(
    row: LedgerRow,
    accountType: string,
    accountUserId: string | null,
    currency: string
  ) {
    if (row.account_type !== accountType) return false;
    if (row.currency !== currency) return false;
    if (accountUserId === null) return row.account_user_id === null;
    return row.account_user_id === accountUserId;
  }

  function sumFor(
    accountType: string,
    accountUserId: string | null,
    currency: string
  ) {
    return rows
      .filter((r) => matchesWallet(r, accountType, accountUserId, currency))
      .reduce((acc, r) => {
        if (r.direction === "credit") return acc + r.amount_cents;
        if (r.direction === "debit") return acc - r.amount_cents;
        return acc;
      }, 0);
  }

  function seed(row: Omit<LedgerRow, "id" | "created_at"> & { id?: string }) {
    const full: LedgerRow = {
      id: row.id ?? randomUUID(),
      created_at: new Date().toISOString(),
      ...row,
    };
    rows.push(full);
    return full;
  }

  function quarantineDuplicates() {
    const groups = new Map<string, LedgerRow[]>();
    for (const row of rows) {
      const key = [
        row.account_type,
        row.account_user_id ?? "null",
        row.reference_type,
        row.reference_id,
        row.direction,
      ].join("|");
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    const keep = new Set<string>();
    for (const list of groups.values()) {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
      keep.add(list[0]!.id);
      for (const dup of list.slice(1)) {
        quarantine.push({ original_ledger_id: dup.id, payload: dup });
      }
    }
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (!keep.has(rows[i]!.id)) rows.splice(i, 1);
    }
  }

  function ledgerQuery() {
    const filters: Record<string, unknown> = {};
    const api: {
      select: (cols: string) => typeof api;
      eq: (col: string, val: unknown) => typeof api;
      is: (col: string, val: null) => typeof api;
      order: () => typeof api;
      limit: () => typeof api;
      maybeSingle: () => Promise<{ data: LedgerRow | null; error: null }>;
      then: (
        resolve: (v: { data: LedgerRow[] | Partial<LedgerRow>[]; error: null }) => unknown,
        reject?: (e: unknown) => unknown
      ) => Promise<unknown>;
    } = {
      select(_cols: string) {
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
      then(resolve, reject) {
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
          if ("idempotency_key" in filters) {
            filtered = filtered.filter((r) => r.idempotency_key === filters.idempotency_key);
          }
          return Promise.resolve(
            resolve({
              data: filtered.map((r) => ({
                direction: r.direction,
                amount_cents: r.amount_cents,
                balance_after_cents: r.balance_after_cents,
              })),
              error: null,
            })
          );
        } catch (e) {
          return Promise.reject(reject ? reject(e) : e);
        }
      },
    };
    return api;
  }

  const supabaseAdmin = {
    from(table: string) {
      assert.equal(table, "wallet_ledger");
      return {
        select(cols: string) {
          return ledgerQuery().select(cols);
        },
        insert(payload: Record<string, unknown>) {
          return {
            select() {
              return {
                single: async () => {
                  const row = seed({
                    account_type: String(payload.account_type),
                    account_user_id: (payload.account_user_id as string | null) ?? null,
                    country_code: String(payload.country_code),
                    currency: String(payload.currency),
                    direction: String(payload.direction),
                    amount_cents: Number(payload.amount_cents),
                    balance_after_cents: Number(payload.balance_after_cents ?? 0),
                    reference_type: String(payload.reference_type),
                    reference_id: String(payload.reference_id),
                    idempotency_key: String(payload.idempotency_key),
                  });
                  return { data: row, error: null };
                },
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
    quarantine,
    seed,
    quarantineDuplicates,
    sumFor,
  };
}

test("getWalletBalance ignores stale balance_after after duplicate quarantine", async () => {
  const store = createFinanceStore();
  const paymentA = randomUUID();
  const paymentB = randomUUID();

  // Canonical pair for payment A (1404) then inflated duplicate credits.
  store.seed({
    account_type: "platform",
    account_user_id: null,
    country_code: "US",
    currency: "usd",
    direction: "credit",
    amount_cents: 1404,
    balance_after_cents: 1404,
    reference_type: "payment_transaction",
    reference_id: paymentA,
    idempotency_key: `platform|null|payment_transaction|${paymentA}|credit`,
  });
  store.seed({
    account_type: "platform",
    account_user_id: null,
    country_code: "US",
    currency: "usd",
    direction: "credit",
    amount_cents: 570,
    balance_after_cents: 1974,
    reference_type: "payment_transaction",
    reference_id: paymentB,
    idempotency_key: `platform|null|payment_transaction|${paymentB}|credit`,
  });
  // Duplicate replays of payment B with inflated running snapshots.
  store.seed({
    account_type: "platform",
    account_user_id: null,
    country_code: "US",
    currency: "usd",
    direction: "credit",
    amount_cents: 570,
    balance_after_cents: 2544,
    reference_type: "payment_transaction",
    reference_id: paymentB,
    idempotency_key: `platform|null|payment_transaction|${paymentB}|credit|#dup1`,
  });
  store.seed({
    account_type: "platform",
    account_user_id: null,
    country_code: "US",
    currency: "usd",
    direction: "credit",
    amount_cents: 570,
    balance_after_cents: 3114,
    reference_type: "payment_transaction",
    reference_id: paymentB,
    idempotency_key: `platform|null|payment_transaction|${paymentB}|credit|#dup2`,
  });
  // Later keep-style row whose snapshot still embeds prior inflation (3883-style).
  const paymentC = randomUUID();
  store.seed({
    account_type: "platform",
    account_user_id: null,
    country_code: "US",
    currency: "usd",
    direction: "credit",
    amount_cents: 769,
    balance_after_cents: 3883,
    reference_type: "payment_transaction",
    reference_id: paymentC,
    idempotency_key: `platform|null|payment_transaction|${paymentC}|credit`,
  });

  assert.equal(store.rows.length, 5);
  assert.equal(
    Math.max(...store.rows.map((r) => r.balance_after_cents)),
    3883,
    "fixture must expose a stale inflated balance_after"
  );

  store.quarantineDuplicates();
  assert.equal(store.quarantine.length, 2);
  assert.equal(store.rows.length, 3);

  const realSum = 1404 + 570 + 769;
  assert.equal(store.sumFor("platform", null, "usd"), realSum);

  const viaSumHelper = await sumWalletLedgerBalanceCents(
    store.supabaseAdmin,
    "platform",
    null,
    "usd"
  );
  const viaGetBalance = await getWalletBalance(
    store.supabaseAdmin,
    "platform",
    null,
    "usd"
  );

  assert.equal(viaSumHelper, realSum);
  assert.equal(viaGetBalance, realSum);
  assert.notEqual(
    viaGetBalance,
    Math.max(...store.rows.map((r) => r.balance_after_cents)),
    "must not return stale max(balance_after_cents)"
  );
  assert.equal(
    Math.max(...store.rows.map((r) => r.balance_after_cents)),
    3883,
    "stale snapshots may remain on kept rows; reads must ignore them"
  );
});

test("future replays do not change available wallet balance", async () => {
  const store = createFinanceStore();
  const txId = randomUUID();

  const first = await appendWalletLedgerEntry(store.supabaseAdmin, {
    accountType: "platform",
    accountUserId: null,
    countryCode: "US",
    currency: "usd",
    direction: "credit",
    amountCents: 1000,
    referenceType: "payment_transaction",
    referenceId: txId,
    description: "first",
  });

  const before = await getWalletBalance(store.supabaseAdmin, "platform", null, "usd");
  assert.equal(before, 1000);
  assert.equal(first.balance_after_cents, 1000);

  const replay = await appendWalletLedgerEntry(store.supabaseAdmin, {
    accountType: "platform",
    accountUserId: null,
    countryCode: "US",
    currency: "usd",
    direction: "credit",
    amountCents: 1000,
    referenceType: "payment_transaction",
    referenceId: txId,
    description: "replay",
  });

  const after = await getWalletBalance(store.supabaseAdmin, "platform", null, "usd");
  assert.equal(replay.id, first.id);
  assert.equal(store.rows.length, 1);
  assert.equal(after, 1000);
});
