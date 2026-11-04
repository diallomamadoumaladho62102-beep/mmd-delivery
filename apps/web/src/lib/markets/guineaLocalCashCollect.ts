import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertNoGuineaIsolatedLiveWrite,
  GUINEA_TEST_LIVE_OPERATION_BLOCKED,
} from "@/lib/guineaTestIsolation";
import { inferPlatformCountryCode } from "@/lib/platformCountryInference";
import { buildCashCollectionLedgerRow } from "@/lib/markets/guineaCashPayment";

/**
 * Guinea local cash collection for delivery requests, food orders and
 * marketplace seller orders (no Orange Money dependency).
 *
 * The phone only sends the entity id. Amount, currency, market, payment method
 * and status always come from the stored row. A second confirmation is a no-op.
 */

export const LOCAL_CASH_COUNTRY = "GN";
export const LOCAL_CASH_CURRENCY = "GNF";

export type LocalCashEntityKind = "delivery_request" | "food_order" | "marketplace_order";

export type LocalCashActorRole = "driver" | "restaurant" | "seller";

export type LocalCashSnapshot = {
  id: string;
  clientUserId: string | null;
  driverId: string | null;
  restaurantUserId: string | null;
  sellerUserId: string | null;
  status: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  currency: string | null;
  countryCode: string | null;
  totalCents: number | null;
};

export type LocalCashDecision =
  | { ok: true; idempotent: boolean; amountGnf: number; actorRole: LocalCashActorRole }
  | { ok: false; status: number; error: string };

/** Delivery request / food order statuses that count as "delivered". */
export const DELIVERED_STATUSES: readonly string[] = ["delivered", "completed"];

/**
 * seller_orders statuses where the seller may confirm the cash.
 * `confirmed` = Guinea cash placement, then the seller lifecycle
 * (accepted > preparing > ready > out_for_delivery), then delivered / fulfilled.
 */
export const MARKETPLACE_COLLECTABLE_STATUSES: readonly string[] = [
  "confirmed",
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "fulfilled",
];

function norm(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function upper(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function sameId(a: unknown, b: string): boolean {
  const left = String(a ?? "").trim();
  return left !== "" && b !== "" && left === b;
}

/**
 * Dispatch gate for non-Stripe cash entities. Cash is only dispatchable in
 * Guinea / GNF with payment_method=cash and payment_status=pending_cash.
 * An unknown country is inferred from GNF; any other market stays paid-only.
 */
export function localCashAllowsDispatch(input: {
  paymentStatus: unknown;
  paymentMethod: unknown;
  currency?: unknown;
  countryCode?: unknown;
}): boolean {
  const status = norm(input.paymentStatus);
  if (status === "paid") return true;
  if (status !== "pending_cash") return false;
  if (norm(input.paymentMethod) !== "cash") return false;
  const currency = upper(input.currency);
  if (currency !== LOCAL_CASH_CURRENCY) return false;
  const country = upper(input.countryCode) || LOCAL_CASH_COUNTRY;
  return country === LOCAL_CASH_COUNTRY;
}

/** Payment status values a food order may hold and still be actioned. */
export function foodPaymentAllowsFulfillment(input: {
  paymentStatus: unknown;
  paymentMethod: unknown;
  currency?: unknown;
  countryCode?: unknown;
}): boolean {
  return localCashAllowsDispatch(input);
}

export function isMissingPaymentMethodColumn(message: unknown): boolean {
  const text = String(message ?? "");
  return /payment_method/i.test(text) && /(column|schema cache|does not exist|42703)/i.test(text);
}

/**
 * Runs a query that selects `payment_method`; if the column is not deployed yet
 * (US / legacy schema) it retries once without it so paid-only flows keep working.
 */
export async function withOptionalPaymentMethod<T extends { error: { message?: string } | null }>(
  run: (includePaymentMethod: boolean) => PromiseLike<T>,
): Promise<T> {
  const first = await run(true);
  if (first.error && isMissingPaymentMethodColumn(first.error.message)) {
    return run(false);
  }
  return first;
}

type EvaluateOptions = {
  actorRoleFor: (snapshot: LocalCashSnapshot, actor: string) => LocalCashActorRole | null;
  allowedStatuses: readonly string[];
  notReadyError: string;
};

function evaluateLocalCash(
  entity: LocalCashSnapshot | null,
  actorUserId: string,
  options: EvaluateOptions,
): LocalCashDecision {
  if (!entity?.id) {
    return { ok: false, status: 404, error: "entity_not_found" };
  }

  const actor = String(actorUserId ?? "").trim();
  const actorRole = actor ? options.actorRoleFor(entity, actor) : null;
  if (!actorRole) {
    return { ok: false, status: 403, error: "cash_forbidden" };
  }

  if (norm(entity.paymentMethod) !== "cash") {
    return { ok: false, status: 409, error: "not_cash" };
  }
  if (upper(entity.currency) !== LOCAL_CASH_CURRENCY) {
    return { ok: false, status: 409, error: "currency_mismatch" };
  }
  if (upper(entity.countryCode) !== LOCAL_CASH_COUNTRY) {
    return { ok: false, status: 409, error: "market_mismatch" };
  }

  const status = norm(entity.status);
  if (status === "canceled" || status === "cancelled" || status === "refused") {
    return { ok: false, status: 409, error: "entity_canceled" };
  }
  if (!options.allowedStatuses.includes(status)) {
    return { ok: false, status: 409, error: options.notReadyError };
  }

  const amountGnf = Number(entity.totalCents);
  if (!Number.isSafeInteger(amountGnf) || amountGnf <= 0) {
    return { ok: false, status: 409, error: "amount_missing" };
  }

  const paymentStatus = norm(entity.paymentStatus);
  if (paymentStatus === "cash_collected") {
    return { ok: true, idempotent: true, amountGnf, actorRole };
  }
  if (paymentStatus !== "pending_cash") {
    return { ok: false, status: 409, error: "invalid_payment_status" };
  }

  return { ok: true, idempotent: false, amountGnf, actorRole };
}

/** Delivery request: only the assigned driver, after delivery. */
export function evaluateDeliveryCashCollect(
  entity: LocalCashSnapshot | null,
  actorUserId: string,
): LocalCashDecision {
  return evaluateLocalCash(entity, actorUserId, {
    actorRoleFor: (e, actor) => (sameId(e.driverId, actor) ? "driver" : null),
    allowedStatuses: DELIVERED_STATUSES,
    notReadyError: "delivery_not_completed",
  });
}

/** Food order: assigned driver or restaurant owner, after delivery. */
export function evaluateFoodCashCollect(
  entity: LocalCashSnapshot | null,
  actorUserId: string,
): LocalCashDecision {
  return evaluateLocalCash(entity, actorUserId, {
    actorRoleFor: (e, actor) => {
      if (sameId(e.driverId, actor)) return "driver";
      if (sameId(e.restaurantUserId, actor)) return "restaurant";
      return null;
    },
    allowedStatuses: DELIVERED_STATUSES,
    notReadyError: "order_not_delivered",
  });
}

/** Marketplace seller order: only the seller owner, once the order is live. */
export function evaluateMarketplaceCashCollect(
  entity: LocalCashSnapshot | null,
  actorUserId: string,
): LocalCashDecision {
  return evaluateLocalCash(entity, actorUserId, {
    actorRoleFor: (e, actor) => (sameId(e.sellerUserId, actor) ? "seller" : null),
    allowedStatuses: MARKETPLACE_COLLECTABLE_STATUSES,
    notReadyError: "order_not_collectable",
  });
}

export function buildLocalCashLedgerRow(input: {
  kind: LocalCashEntityKind;
  entityId: string;
  accountUserId: string;
  accountRole: LocalCashActorRole;
  amountGnf: number;
}): Record<string, unknown> {
  const base = buildCashCollectionLedgerRow({
    rideId: input.entityId,
    driverUserId: input.accountUserId,
    fareGnf: input.amountGnf,
  });
  return {
    ...base,
    account_type: input.accountRole,
    reference_id: input.entityId,
    description: `Cash collected (${input.kind})`,
    metadata: {
      ...(base.metadata as Record<string, unknown>),
      entity_type: input.kind,
    },
  };
}

export type LocalCashHttpResult = { status: number; body: Record<string, unknown> };

type CollectConfig = {
  kind: LocalCashEntityKind;
  table: "delivery_requests" | "orders" | "seller_orders";
  columns: string;
  hasPaymentMethodColumn: boolean;
  allowedStatuses: readonly string[];
  toSnapshot: (row: Record<string, unknown>) => LocalCashSnapshot;
  evaluate: (entity: LocalCashSnapshot | null, actor: string) => LocalCashDecision;
  /** Extra restriction applied to the filtered row (e.g. food `kind`). */
  extraEq?: Array<[string, string]>;
  /** Resolves the seller owner user for marketplace rows. */
  resolveSellerUserId?: (
    supabaseAdmin: SupabaseClient,
    row: Record<string, unknown>,
  ) => Promise<string | null>;
};

function toStr(value: unknown): string | null {
  return value != null && String(value) !== "" ? String(value) : null;
}

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readShadowPaymentMethod(row: Record<string, unknown>): string | null {
  const shadow = row.checkout_shadow;
  if (shadow && typeof shadow === "object" && !Array.isArray(shadow)) {
    const method = (shadow as Record<string, unknown>).payment_method;
    return toStr(method);
  }
  return null;
}

export function deliverySnapshotFromRow(row: Record<string, unknown>): LocalCashSnapshot {
  const currency = toStr(row.currency);
  return {
    id: String(row.id ?? ""),
    clientUserId: toStr(row.client_user_id) ?? toStr(row.created_by),
    driverId: toStr(row.driver_id),
    restaurantUserId: null,
    sellerUserId: null,
    status: toStr(row.status),
    paymentMethod: toStr(row.payment_method),
    paymentStatus: toStr(row.payment_status),
    currency,
    countryCode: inferPlatformCountryCode({
      countryCode: row.country_code,
      currency,
      lat: row.dropoff_lat ?? row.pickup_lat,
      lng: row.dropoff_lng ?? row.pickup_lng,
    }),
    totalCents: toNum(row.total_cents),
  };
}

export function foodSnapshotFromRow(row: Record<string, unknown>): LocalCashSnapshot {
  const currency = toStr(row.currency);
  return {
    id: String(row.id ?? ""),
    clientUserId: toStr(row.client_user_id) ?? toStr(row.client_id) ?? toStr(row.created_by),
    driverId: toStr(row.driver_id),
    restaurantUserId: toStr(row.restaurant_user_id) ?? toStr(row.restaurant_id),
    sellerUserId: null,
    status: toStr(row.status),
    paymentMethod: toStr(row.payment_method),
    paymentStatus: toStr(row.payment_status),
    currency,
    countryCode: inferPlatformCountryCode({
      countryCode: row.country_code,
      currency,
      lat: row.dropoff_lat ?? row.pickup_lat,
      lng: row.dropoff_lng ?? row.pickup_lng,
    }),
    totalCents: toNum(row.total_cents),
  };
}

export function marketplaceSnapshotFromRow(
  row: Record<string, unknown>,
  sellerUserId: string | null,
): LocalCashSnapshot {
  return {
    id: String(row.id ?? ""),
    clientUserId: toStr(row.client_user_id),
    driverId: null,
    restaurantUserId: null,
    sellerUserId,
    status: toStr(row.status),
    paymentMethod: toStr(row.payment_method) ?? readShadowPaymentMethod(row),
    paymentStatus: toStr(row.payment_status),
    currency: toStr(row.currency),
    countryCode: toStr(row.country_code),
    totalCents: toNum(row.total_cents),
  };
}

async function ensureLocalCashLedger(
  supabaseAdmin: SupabaseClient,
  input: {
    kind: LocalCashEntityKind;
    entityId: string;
    accountUserId: string;
    accountRole: LocalCashActorRole;
    amountGnf: number;
  },
): Promise<boolean> {
  try {
    const existing = await supabaseAdmin
      .from("wallet_ledger")
      .select("id")
      .eq("reference_type", "cash_collection")
      .eq("reference_id", input.entityId)
      .limit(1)
      .maybeSingle();
    if (existing.data?.id) return true;

    const inserted = await supabaseAdmin
      .from("wallet_ledger")
      .insert(buildLocalCashLedgerRow(input));
    if (!inserted.error) return true;
    return /duplicate|unique/i.test(String(inserted.error.message ?? ""));
  } catch {
    // Ledger is fail-open: the collection itself is already recorded.
    return false;
  }
}

function successBody(input: {
  idempotent: boolean;
  amountGnf: number;
  ledgerRecorded: boolean;
}): Record<string, unknown> {
  return {
    ok: true,
    idempotent: input.idempotent,
    payment_method: "cash",
    payment_status: "cash_collected",
    amount_gnf: input.amountGnf,
    currency: LOCAL_CASH_CURRENCY,
    ledger_recorded: input.ledgerRecorded,
  };
}

async function loadSnapshot(
  supabaseAdmin: SupabaseClient,
  config: CollectConfig,
  entityId: string,
): Promise<
  | { ok: true; snapshot: LocalCashSnapshot | null }
  | { ok: false; result: LocalCashHttpResult }
> {
  let query = supabaseAdmin.from(config.table).select(config.columns).eq("id", entityId);
  for (const [column, value] of config.extraEq ?? []) {
    query = query.eq(column, value);
  }
  const loaded = await query.maybeSingle();

  if (loaded.error) {
    if (config.hasPaymentMethodColumn && isMissingPaymentMethodColumn(loaded.error.message)) {
      return {
        ok: false,
        result: { status: 503, body: { ok: false, error: "guinea_cash_schema_not_ready" } },
      };
    }
    return {
      ok: false,
      result: { status: 500, body: { ok: false, error: "cash_lookup_failed" } },
    };
  }
  if (!loaded.data) return { ok: true, snapshot: null };

  const row = loaded.data as unknown as Record<string, unknown>;
  const sellerUserId = config.resolveSellerUserId
    ? await config.resolveSellerUserId(supabaseAdmin, row)
    : null;
  const snapshot =
    config.kind === "marketplace_order"
      ? marketplaceSnapshotFromRow(row, sellerUserId)
      : config.toSnapshot(row);
  return { ok: true, snapshot };
}

async function collectLocalCash(
  supabaseAdmin: SupabaseClient,
  config: CollectConfig,
  input: { actorUserId: string; entityId: string },
): Promise<LocalCashHttpResult> {
  const entityId = String(input.entityId ?? "").trim();
  const actorUserId = String(input.actorUserId ?? "").trim();
  if (!entityId) return { status: 400, body: { ok: false, error: "missing_id" } };

  const loaded = await loadSnapshot(supabaseAdmin, config, entityId);
  if (loaded.ok === false) return loaded.result;

  const decision = config.evaluate(loaded.snapshot, actorUserId);
  if (decision.ok === false) {
    return { status: decision.status, body: { ok: false, error: decision.error } };
  }

  const snapshot = loaded.snapshot as LocalCashSnapshot;
  try {
    await assertNoGuineaIsolatedLiveWrite(supabaseAdmin, [
      actorUserId,
      snapshot.clientUserId,
      snapshot.driverId,
      snapshot.restaurantUserId,
      snapshot.sellerUserId,
    ]);
  } catch (error) {
    if (error instanceof Error && error.message === GUINEA_TEST_LIVE_OPERATION_BLOCKED) {
      return { status: 403, body: { ok: false, error: GUINEA_TEST_LIVE_OPERATION_BLOCKED } };
    }
    return { status: 500, body: { ok: false, error: "cash_isolation_check_failed" } };
  }

  const ledgerInput = {
    kind: config.kind,
    entityId,
    accountUserId: actorUserId,
    accountRole: decision.actorRole,
  };

  if (decision.idempotent) {
    const ledgerRecorded = await ensureLocalCashLedger(supabaseAdmin, {
      ...ledgerInput,
      amountGnf: decision.amountGnf,
    });
    return {
      status: 200,
      body: successBody({
        idempotent: true,
        amountGnf: decision.amountGnf,
        ledgerRecorded,
      }),
    };
  }

  const nowIso = new Date().toISOString();
  let update = supabaseAdmin
    .from(config.table)
    .update({ payment_status: "cash_collected", paid_at: nowIso, updated_at: nowIso })
    .eq("id", entityId)
    .eq("payment_status", "pending_cash")
    .eq("currency", LOCAL_CASH_CURRENCY)
    .in("status", [...config.allowedStatuses]);
  if (config.hasPaymentMethodColumn) {
    update = update.eq("payment_method", "cash");
  }
  for (const [column, value] of config.extraEq ?? []) {
    update = update.eq(column, value);
  }
  const updated = await update.select("id,total_cents,payment_status").maybeSingle();

  if (updated.error) {
    return { status: 500, body: { ok: false, error: "cash_collect_failed" } };
  }

  if (!updated.data) {
    const again = await loadSnapshot(supabaseAdmin, config, entityId);
    if (again.ok) {
      const second = config.evaluate(again.snapshot, actorUserId);
      if (second.ok && second.idempotent) {
        const ledgerRecorded = await ensureLocalCashLedger(supabaseAdmin, {
          ...ledgerInput,
          amountGnf: second.amountGnf,
        });
        return {
          status: 200,
          body: successBody({
            idempotent: true,
            amountGnf: second.amountGnf,
            ledgerRecorded,
          }),
        };
      }
    }
    return { status: 409, body: { ok: false, error: "cash_collect_conflict" } };
  }

  const ledgerRecorded = await ensureLocalCashLedger(supabaseAdmin, {
    ...ledgerInput,
    amountGnf: decision.amountGnf,
  });
  return {
    status: 200,
    body: successBody({
      idempotent: false,
      amountGnf: decision.amountGnf,
      ledgerRecorded,
    }),
  };
}

const DELIVERY_COLUMNS =
  "id,client_user_id,created_by,driver_id,status,payment_method,payment_status,currency,total_cents,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng";

const FOOD_COLUMNS =
  "id,client_user_id,client_id,created_by,driver_id,restaurant_user_id,restaurant_id,status,payment_method,payment_status,currency,total_cents,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng";

const MARKETPLACE_COLUMNS =
  "id,seller_id,client_user_id,status,payment_status,currency,country_code,total_cents,checkout_shadow";

export function collectDeliveryRequestCash(
  supabaseAdmin: SupabaseClient,
  input: { actorUserId: string; requestId: string },
): Promise<LocalCashHttpResult> {
  return collectLocalCash(
    supabaseAdmin,
    {
      kind: "delivery_request",
      table: "delivery_requests",
      columns: DELIVERY_COLUMNS,
      hasPaymentMethodColumn: true,
      allowedStatuses: DELIVERED_STATUSES,
      toSnapshot: deliverySnapshotFromRow,
      evaluate: evaluateDeliveryCashCollect,
    },
    { actorUserId: input.actorUserId, entityId: input.requestId },
  );
}

export function collectFoodOrderCash(
  supabaseAdmin: SupabaseClient,
  input: { actorUserId: string; orderId: string },
): Promise<LocalCashHttpResult> {
  return collectLocalCash(
    supabaseAdmin,
    {
      kind: "food_order",
      table: "orders",
      columns: FOOD_COLUMNS,
      hasPaymentMethodColumn: true,
      allowedStatuses: DELIVERED_STATUSES,
      toSnapshot: foodSnapshotFromRow,
      evaluate: evaluateFoodCashCollect,
      extraEq: [["kind", "food"]],
    },
    { actorUserId: input.actorUserId, entityId: input.orderId },
  );
}

export function collectMarketplaceOrderCash(
  supabaseAdmin: SupabaseClient,
  input: { actorUserId: string; orderId: string },
): Promise<LocalCashHttpResult> {
  return collectLocalCash(
    supabaseAdmin,
    {
      kind: "marketplace_order",
      table: "seller_orders",
      columns: MARKETPLACE_COLUMNS,
      // seller_orders has no payment_method column: it lives in checkout_shadow.
      hasPaymentMethodColumn: false,
      allowedStatuses: MARKETPLACE_COLLECTABLE_STATUSES,
      toSnapshot: () => {
        throw new Error("marketplace snapshot requires seller owner");
      },
      evaluate: evaluateMarketplaceCashCollect,
      resolveSellerUserId: async (admin, row) => {
        const sellerId = toStr(row.seller_id);
        if (!sellerId) return null;
        const seller = await admin
          .from("sellers")
          .select("user_id")
          .eq("id", sellerId)
          .maybeSingle();
        return seller.data?.user_id ? String(seller.data.user_id) : null;
      },
    },
    { actorUserId: input.actorUserId, entityId: input.orderId },
  );
}
