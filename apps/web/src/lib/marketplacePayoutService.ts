import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMarketplacePayoutsLiveEnvEnabled,
  type MarketplacePayoutStatus,
} from "@/lib/marketplacePayout";
import { resolveMarketplaceLiveFlagsForScope } from "@/lib/platformScopeResolver";

export type MarketplaceSellerPayoutRow = {
  id: string;
  seller_order_id: string;
  seller_id: string;
  gross_amount_cents: number;
  platform_fee_cents: number;
  seller_net_amount_cents: number;
  currency: string;
  status: MarketplacePayoutStatus;
  stripe_transfer_id: string | null;
  payout_live_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type MarketplaceDriverPayoutRow = {
  id: string;
  marketplace_delivery_job_id: string;
  seller_order_id: string;
  driver_id: string;
  driver_earning_cents: number;
  bonus_cents: number;
  total_driver_payout_cents: number;
  currency: string;
  status: MarketplacePayoutStatus;
  stripe_transfer_id: string | null;
  payout_live_enabled: boolean;
  created_at: string;
  updated_at: string;
};

type SellerOrderPayoutSource = {
  id: string;
  seller_id: string;
  status: string;
  payment_status: string | null;
  refund_status?: string | null;
  currency: string;
  subtotal_cents: number | null;
  service_fee_cents: number | null;
  total_cents: number | null;
  sellers?: { country_code?: string | null } | { country_code?: string | null }[] | null;
};

type DeliveryJobPayoutSource = {
  id: string;
  seller_order_id: string;
  seller_id: string;
  status: string;
  assigned_driver_id: string | null;
  driver_earning_cents: number;
  platform_margin_cents: number;
};

function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function isSellerOrderPaid(order: SellerOrderPayoutSource): boolean {
  const paid = order.payment_status === "paid" || order.status === "paid";
  if (!paid) return false;
  const refund = String(order.refund_status ?? "").trim().toLowerCase();
  // null/empty refund_status is OK; block payouts after refund/dispute.
  if (
    refund === "refunded" ||
    refund === "partially_refunded" ||
    refund === "disputed"
  ) {
    return false;
  }
  return true;
}

/**
 * Requires a resolved Phase-4 commission snapshot rate — there is no
 * hardcoded fallback percentage. Callers MUST resolve/create the snapshot
 * (see `@/lib/commission/commissionEngine`) before calling this; a missing
 * `platform_rate_pct` throws rather than silently defaulting to some
 * commission rate the founder never approved for this order.
 */
export function calculateSellerMarketplacePayout(order: {
  subtotal_cents?: number | null;
  service_fee_cents?: number | null;
  platform_rate_pct?: number | null;
  platform_fixed_fee_cents?: number | null;
  platform_fee_credit_cents?: number | null;
}): {
  gross_amount_cents: number;
  platform_fee_cents: number;
  seller_net_amount_cents: number;
} {
  if (
    order.platform_rate_pct == null ||
    !Number.isFinite(Number(order.platform_rate_pct))
  ) {
    throw new Error("platform_rate_pct_required");
  }

  const gross = roundCents(Number(order.subtotal_cents ?? 0));

  const fromRate = roundCents((gross * Number(order.platform_rate_pct)) / 100);
  const withFixed = fromRate + roundCents(Number(order.platform_fixed_fee_cents ?? 0));
  const platformFee = Math.max(
    0,
    withFixed - roundCents(Number(order.platform_fee_credit_cents ?? 0))
  );

  const sellerNet = Math.max(0, gross - platformFee);

  return {
    gross_amount_cents: gross,
    platform_fee_cents: platformFee,
    seller_net_amount_cents: sellerNet,
  };
}

export function calculateDriverMarketplacePayout(job: {
  driver_earning_cents?: number | null;
  bonus_cents?: number | null;
}): {
  driver_earning_cents: number;
  bonus_cents: number;
  total_driver_payout_cents: number;
} {
  const earning = roundCents(Number(job.driver_earning_cents ?? 0));
  const bonus = roundCents(Number(job.bonus_cents ?? 0));
  return {
    driver_earning_cents: earning,
    bonus_cents: bonus,
    total_driver_payout_cents: earning + bonus,
  };
}

async function loadSellerOrderForPayout(
  supabaseAdmin: SupabaseClient,
  sellerOrderId: string
): Promise<SellerOrderPayoutSource | null> {
  const { data, error } = await supabaseAdmin
    .from("seller_orders")
    .select(
      "id,seller_id,status,payment_status,refund_status,currency,subtotal_cents,service_fee_cents,total_cents,sellers(country_code)"
    )
    .eq("id", sellerOrderId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as SellerOrderPayoutSource | null;
}

function sellerCountryCode(
  order: Pick<SellerOrderPayoutSource, "sellers">
): string | null {
  const raw = Array.isArray(order.sellers)
    ? order.sellers[0]?.country_code
    : order.sellers?.country_code;
  const code = String(raw ?? "").trim().toUpperCase();
  return code.length === 2 ? code : null;
}

async function resolvePayoutLiveForSellerOrder(
  supabaseAdmin: SupabaseClient,
  order: SellerOrderPayoutSource
): Promise<boolean> {
  const countryCode = sellerCountryCode(order);
  if (!countryCode) return false;

  const flags = await resolveMarketplaceLiveFlagsForScope(supabaseAdmin, {
    country_code: countryCode,
    region_code: null,
    mmd_zone_id: null,
    county_code: null,
  });
  return flags.marketplace_payouts_live_enabled;
}

async function loadDeliveryJobForPayout(
  supabaseAdmin: SupabaseClient,
  jobId: string
): Promise<DeliveryJobPayoutSource | null> {
  const { data, error } = await supabaseAdmin
    .from("marketplace_delivery_jobs")
    .select(
      "id,seller_order_id,seller_id,status,assigned_driver_id,driver_earning_cents,platform_margin_cents"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as DeliveryJobPayoutSource | null;
}

/**
 * Logical wallet credit for a paid/delivered marketplace order.
 * No Stripe transfer ids — executeMarketplacePayouts remains a stub.
 */
export async function ensureMarketplaceSellerWalletEntry(
  supabaseAdmin: SupabaseClient,
  params: {
    sellerId: string;
    sellerOrderId: string;
    amountCents: number;
    currency: string;
    orderStatus?: string | null;
  }
): Promise<{ ok: true; created: boolean; entry_id?: string } | { ok: false; error: string }> {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("marketplace_seller_wallet_entries")
    .select("id")
    .eq("seller_order_id", params.sellerOrderId)
    .eq("entry_type", "order_credit")
    .limit(1)
    .maybeSingle();

  if (existingError) return { ok: false, error: existingError.message };
  if (existing) return { ok: true, created: false, entry_id: String(existing.id) };

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("marketplace_seller_wallet_entries")
    .insert({
      seller_id: params.sellerId,
      seller_order_id: params.sellerOrderId,
      entry_type: "order_credit",
      amount_cents: Math.max(0, Math.round(params.amountCents)),
      currency: params.currency,
      status: "pending",
      metadata: {
        source: "prepare_marketplace_seller_payout",
        order_status: params.orderStatus ?? null,
        stripe_transfer: false,
      },
    })
    .select("id")
    .maybeSingle();

  if (insertError) return { ok: false, error: insertError.message };
  return { ok: true, created: true, entry_id: inserted?.id ? String(inserted.id) : undefined };
}

export async function prepareMarketplaceSellerPayout(
  supabaseAdmin: SupabaseClient,
  params: { sellerOrderId: string; source?: string }
): Promise<{
  ok: boolean;
  payout?: MarketplaceSellerPayoutRow;
  already_exists?: boolean;
  skipped?: string;
  error?: string;
}> {
  const { sellerOrderId, source = "prepare" } = params;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("marketplace_seller_payouts")
    .select("*")
    .eq("seller_order_id", sellerOrderId)
    .maybeSingle();

  if (existingError) return { ok: false, error: existingError.message };
  if (existing) {
    await ensureMarketplaceSellerWalletEntry(supabaseAdmin, {
      sellerId: String(existing.seller_id),
      sellerOrderId,
      amountCents: Number(existing.seller_net_amount_cents ?? 0),
      currency: String(existing.currency ?? "USD").toUpperCase(),
    });
    return {
      ok: true,
      payout: existing as MarketplaceSellerPayoutRow,
      already_exists: true,
    };
  }

  const order = await loadSellerOrderForPayout(supabaseAdmin, sellerOrderId);
  if (!order) return { ok: false, error: "seller_order_not_found" };
  if (!isSellerOrderPaid(order)) {
    return { ok: true, skipped: "order_not_paid" };
  }

  // Prefer Phase-4 frozen snapshot; if missing (legacy orders), create one then use it.
  let ratePct: number | null = null;
  let fixedFee = 0;
  let feeCredit = 0;
  try {
    const { loadCommissionSnapshot, snapshotOrderCommission } = await import(
      "@/lib/commission/commissionEngine"
    );
    let snap = await loadCommissionSnapshot(supabaseAdmin, "marketplace", sellerOrderId);
    if (!snap) {
      const { data: sellerRow } = await supabaseAdmin
        .from("sellers")
        .select("user_id, country_code, city")
        .eq("id", order.seller_id)
        .maybeSingle();
      if (sellerRow?.user_id) {
        const created = await snapshotOrderCommission(supabaseAdmin, {
          orderKind: "marketplace",
          orderId: sellerOrderId,
          partnerType: "seller",
          partnerUserId: String(sellerRow.user_id),
          service: "marketplace",
          currency: order.currency ?? "USD",
          countryCode: sellerRow.country_code ?? sellerCountryCode(order),
          city: sellerRow.city ?? null,
        });
        if (created.ok) snap = created;
      }
    }
    if (snap?.ok) {
      ratePct = snap.rate_pct;
      fixedFee = snap.fixed_fee_cents;
      feeCredit = snap.fee_credit_cents;
    }
  } catch (e) {
    console.warn("[marketplace-payout] commission snapshot lookup failed", {
      sellerOrderId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Fail closed: never let calculateSellerMarketplacePayout silently apply
  // some other rate when the Phase-4 snapshot could not be resolved/created.
  if (ratePct == null) {
    console.error("[marketplace-payout] commission snapshot missing — payout skipped", {
      sellerOrderId,
    });
    return { ok: true, skipped: "commission_snapshot_missing" };
  }

  let amounts: ReturnType<typeof calculateSellerMarketplacePayout>;
  try {
    amounts = calculateSellerMarketplacePayout({
      ...order,
      platform_rate_pct: ratePct,
      platform_fixed_fee_cents: fixedFee,
      platform_fee_credit_cents: feeCredit,
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "seller_payout_amount_calculation_failed",
    };
  }
  if (amounts.gross_amount_cents <= 0) {
    return { ok: true, skipped: "zero_gross_amount" };
  }

  const liveEnabled = await resolvePayoutLiveForSellerOrder(supabaseAdmin, order);
  const now = new Date().toISOString();

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("marketplace_seller_payouts")
    .insert({
      seller_order_id: sellerOrderId,
      seller_id: order.seller_id,
      gross_amount_cents: amounts.gross_amount_cents,
      platform_fee_cents: amounts.platform_fee_cents,
      seller_net_amount_cents: amounts.seller_net_amount_cents,
      currency: String(order.currency ?? "USD").toUpperCase(),
      status: "pending",
      payout_live_enabled: liveEnabled,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .maybeSingle();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: raced } = await supabaseAdmin
        .from("marketplace_seller_payouts")
        .select("*")
        .eq("seller_order_id", sellerOrderId)
        .maybeSingle();
      if (raced) {
        return {
          ok: true,
          payout: raced as MarketplaceSellerPayoutRow,
          already_exists: true,
        };
      }
    }
    return { ok: false, error: insertError.message };
  }

  console.log("[marketplace-payout] seller payout prepared", {
    sellerOrderId,
    payoutId: inserted?.id,
    seller_net_amount_cents: amounts.seller_net_amount_cents,
    payout_live_enabled: liveEnabled,
    source,
  });

  try {
    await ensureMarketplaceSellerWalletEntry(supabaseAdmin, {
      sellerId: order.seller_id,
      sellerOrderId,
      amountCents: amounts.seller_net_amount_cents,
      currency: String(order.currency ?? "USD").toUpperCase(),
      orderStatus: order.status,
    });
  } catch (walletError) {
    console.warn("[marketplace-payout] wallet ledger write skipped", {
      sellerOrderId,
      error: walletError instanceof Error ? walletError.message : String(walletError),
    });
  }

  return { ok: true, payout: inserted as MarketplaceSellerPayoutRow };
}

export async function prepareMarketplaceSellerPayoutAfterPayment(
  supabaseAdmin: SupabaseClient,
  params: { sellerOrderId: string; source?: string }
) {
  return prepareMarketplaceSellerPayout(supabaseAdmin, params);
}

export async function prepareMarketplaceDriverPayout(
  supabaseAdmin: SupabaseClient,
  params: {
    marketplaceDeliveryJobId: string;
    bonusCents?: number;
    source?: string;
  }
): Promise<{
  ok: boolean;
  payout?: MarketplaceDriverPayoutRow;
  already_exists?: boolean;
  skipped?: string;
  error?: string;
}> {
  const { marketplaceDeliveryJobId, bonusCents = 0, source = "prepare" } = params;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("marketplace_driver_payouts")
    .select("*")
    .eq("marketplace_delivery_job_id", marketplaceDeliveryJobId)
    .maybeSingle();

  if (existingError) return { ok: false, error: existingError.message };
  if (existing) {
    return {
      ok: true,
      payout: existing as MarketplaceDriverPayoutRow,
      already_exists: true,
    };
  }

  const job = await loadDeliveryJobForPayout(supabaseAdmin, marketplaceDeliveryJobId);
  if (!job) return { ok: false, error: "delivery_job_not_found" };
  if (job.status !== "delivered") {
    return { ok: true, skipped: "job_not_delivered" };
  }
  if (!job.assigned_driver_id) {
    return { ok: true, skipped: "driver_not_assigned" };
  }

  const amounts = calculateDriverMarketplacePayout({
    driver_earning_cents: job.driver_earning_cents,
    bonus_cents: bonusCents,
  });

  const { data: order, error: orderError } = await supabaseAdmin
    .from("seller_orders")
    .select("currency,payment_status,status,refund_status,sellers(country_code)")
    .eq("id", job.seller_order_id)
    .maybeSingle();

  if (orderError) return { ok: false, error: orderError.message };
  if (!order) return { ok: false, error: "seller_order_not_found" };
  if (!isSellerOrderPaid(order as SellerOrderPayoutSource)) {
    return { ok: true, skipped: "order_not_paid" };
  }

  const liveEnabled = await resolvePayoutLiveForSellerOrder(
    supabaseAdmin,
    order as SellerOrderPayoutSource
  );
  const now = new Date().toISOString();

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("marketplace_driver_payouts")
    .insert({
      marketplace_delivery_job_id: marketplaceDeliveryJobId,
      seller_order_id: job.seller_order_id,
      driver_id: job.assigned_driver_id,
      driver_earning_cents: amounts.driver_earning_cents,
      bonus_cents: amounts.bonus_cents,
      total_driver_payout_cents: amounts.total_driver_payout_cents,
      currency: String(order?.currency ?? "USD").toUpperCase(),
      status: "pending",
      payout_live_enabled: liveEnabled,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .maybeSingle();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: raced } = await supabaseAdmin
        .from("marketplace_driver_payouts")
        .select("*")
        .eq("marketplace_delivery_job_id", marketplaceDeliveryJobId)
        .maybeSingle();
      if (raced) {
        return {
          ok: true,
          payout: raced as MarketplaceDriverPayoutRow,
          already_exists: true,
        };
      }
    }
    return { ok: false, error: insertError.message };
  }

  console.log("[marketplace-payout] driver payout prepared", {
    marketplaceDeliveryJobId,
    payoutId: inserted?.id,
    total_driver_payout_cents: amounts.total_driver_payout_cents,
    payout_live_enabled: liveEnabled,
    source,
  });

  return { ok: true, payout: inserted as MarketplaceDriverPayoutRow };
}

export async function simulateMarketplaceJobDelivered(
  supabaseAdmin: SupabaseClient,
  params: {
    marketplaceDeliveryJobId: string;
    driverUserId?: string | null;
    source?: string;
  }
): Promise<{ ok: boolean; job?: DeliveryJobPayoutSource; error?: string }> {
  const job = await loadDeliveryJobForPayout(
    supabaseAdmin,
    params.marketplaceDeliveryJobId
  );
  if (!job) return { ok: false, error: "delivery_job_not_found" };

  const driverId = params.driverUserId ?? job.assigned_driver_id;
  if (!driverId) {
    return { ok: false, error: "driver_not_assigned" };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("marketplace_delivery_jobs")
    .update({
      status: "delivered",
      assigned_driver_id: driverId,
      updated_at: now,
    })
    .eq("id", params.marketplaceDeliveryJobId)
    .neq("status", "cancelled")
    .select(
      "id,seller_order_id,seller_id,status,assigned_driver_id,driver_earning_cents,platform_margin_cents"
    )
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "job_update_failed" };

  console.log("[marketplace-payout] job marked delivered (simulated)", {
    marketplaceDeliveryJobId: params.marketplaceDeliveryJobId,
    driverUserId: driverId,
    source: params.source ?? "simulate",
  });

  return { ok: true, job: data as DeliveryJobPayoutSource };
}

export async function markMarketplacePayoutApproved(
  supabaseAdmin: SupabaseClient,
  params: {
    payoutType: "seller" | "driver";
    payoutId: string;
  }
): Promise<{
  ok: boolean;
  payout?: MarketplaceSellerPayoutRow | MarketplaceDriverPayoutRow;
  ignored?: string;
  error?: string;
}> {
  const table =
    params.payoutType === "seller"
      ? "marketplace_seller_payouts"
      : "marketplace_driver_payouts";

  const { data: row, error: loadError } = await supabaseAdmin
    .from(table)
    .select("*")
    .eq("id", params.payoutId)
    .maybeSingle();

  if (loadError) return { ok: false, error: loadError.message };
  if (!row) return { ok: false, error: "payout_not_found" };
  if (row.status === "cancelled" || row.status === "paid") {
    return { ok: false, error: "payout_not_approvable" };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from(table)
    .update({
      status: "approved",
      payout_live_enabled: Boolean(row.payout_live_enabled),
      updated_at: now,
    })
    .eq("id", params.payoutId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "approve_failed" };

  return { ok: true, payout: data as MarketplaceSellerPayoutRow | MarketplaceDriverPayoutRow };
}

export async function cancelMarketplacePayout(
  supabaseAdmin: SupabaseClient,
  params: {
    payoutType: "seller" | "driver";
    payoutId: string;
  }
): Promise<{
  ok: boolean;
  payout?: MarketplaceSellerPayoutRow | MarketplaceDriverPayoutRow;
  error?: string;
}> {
  const table =
    params.payoutType === "seller"
      ? "marketplace_seller_payouts"
      : "marketplace_driver_payouts";

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from(table)
    .update({
      status: "cancelled",
      updated_at: now,
    })
    .eq("id", params.payoutId)
    .in("status", ["pending", "approved"])
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "cancel_failed" };

  return { ok: true, payout: data as MarketplaceSellerPayoutRow | MarketplaceDriverPayoutRow };
}

export async function simulateMarketplacePayouts(
  supabaseAdmin: SupabaseClient,
  params: {
    sellerPayoutId?: string | null;
    driverPayoutId?: string | null;
  }
): Promise<{
  ok: boolean;
  simulation?: Record<string, unknown>;
  ignored?: string;
  error?: string;
}> {
  const simulation: Record<string, unknown> = {
    simulated_at: new Date().toISOString(),
    stripe_transfer_called: false,
    payout_live_enabled: isMarketplacePayoutsLiveEnvEnabled(),
    message: "Marketplace payout simulation only — no Stripe transfers.",
  };

  if (params.sellerPayoutId) {
    const { data } = await supabaseAdmin
      .from("marketplace_seller_payouts")
      .select("*")
      .eq("id", params.sellerPayoutId)
      .maybeSingle();
    simulation.seller_payout = data ?? null;
  }

  if (params.driverPayoutId) {
    const { data } = await supabaseAdmin
      .from("marketplace_driver_payouts")
      .select("*")
      .eq("id", params.driverPayoutId)
      .maybeSingle();
    simulation.driver_payout = data ?? null;
  }

  if (!isMarketplacePayoutsLiveEnvEnabled()) {
    return {
      ok: true,
      simulation,
      ignored: "marketplace_payouts_live_disabled",
    };
  }

  return {
    ok: true,
    simulation: {
      ...simulation,
      message:
        "Live payout flag ON — execution still requires separate validation; no Stripe in Phase 13.",
    },
  };
}

/**
 * Resolve the Stripe charge that actually funds a seller_order, so every
 * marketplace SCT (seller or driver share) can be created with
 * `source_transaction` — same fail-closed contract as food `transfers/run`.
 * seller_orders has no stored `stripe_charge_id` column, only the
 * PaymentIntent id, so this retrieves the PI and reads `latest_charge`.
 */
async function resolveSellerOrderSourceChargeId(
  supabaseAdmin: SupabaseClient,
  sellerOrderId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("seller_orders")
    .select("stripe_payment_intent_id")
    .eq("id", sellerOrderId)
    .maybeSingle();

  if (error || !data) return null;

  const paymentIntentId = String(
    (data as { stripe_payment_intent_id?: string | null }).stripe_payment_intent_id ?? ""
  ).trim();
  if (!paymentIntentId) return null;

  try {
    const { stripe } = await import("@/lib/stripe");
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    const latest = pi.latest_charge;
    if (typeof latest === "string" && latest.trim()) return latest.trim();
    if (latest && typeof latest === "object" && "id" in latest) {
      const id = (latest as { id?: unknown }).id;
      if (typeof id === "string" && id.trim()) return id.trim();
    }
    return null;
  } catch (e) {
    console.error("[marketplace-payout] source charge retrieve failed", {
      sellerOrderId,
      paymentIntentId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Execute approved marketplace seller payouts via Stripe Connect transfers.
 * Requires MARKETPLACE_PAYOUTS_LIVE_ENABLED=true and seller Express account ready.
 * Driver marketplace payouts continue to use the driver Connect destination.
 */
export async function executeMarketplacePayouts(
  supabaseAdmin: SupabaseClient,
  params?: { limit?: number }
): Promise<{
  ok: boolean;
  executed?: number;
  failed?: number;
  ignored?: string;
  error?: string;
}> {
  if (!isMarketplacePayoutsLiveEnvEnabled()) {
    return { ok: true, ignored: "marketplace_payouts_live_disabled", executed: 0 };
  }

  const { stripe } = await import("@/lib/stripe");

  const limit = Math.max(1, Math.min(50, Number(params?.limit ?? 20)));
  let executed = 0;
  let failed = 0;

  const { data: sellerRows, error: sellerLoadErr } = await supabaseAdmin
    .from("marketplace_seller_payouts")
    .select(
      "id,seller_id,seller_order_id,seller_net_amount_cents,currency,status,stripe_transfer_id,payout_live_enabled"
    )
    .eq("status", "approved")
    .eq("payout_live_enabled", true)
    .is("stripe_transfer_id", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (sellerLoadErr) {
    return { ok: false, error: sellerLoadErr.message };
  }

  for (const row of sellerRows ?? []) {
    const payoutId = String(row.id);
    const amount = Number(row.seller_net_amount_cents ?? 0);
    const currency = String(row.currency ?? "USD").toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) {
      failed += 1;
      continue;
    }

    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("marketplace_seller_payouts")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", payoutId)
      .eq("status", "approved")
      .is("stripe_transfer_id", null)
      .select("id")
      .maybeSingle();

    if (claimErr || !claimed) {
      continue;
    }

    const { data: seller, error: sellerErr } = await supabaseAdmin
      .from("sellers")
      .select(
        "id,stripe_account_id,stripe_payouts_enabled,stripe_charges_enabled,stripe_details_submitted,stripe_onboarding_status"
      )
      .eq("id", row.seller_id)
      .maybeSingle();

    if (sellerErr || !seller?.stripe_account_id) {
      await supabaseAdmin
        .from("marketplace_seller_payouts")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", payoutId);
      failed += 1;
      continue;
    }

    const destination = String(seller.stripe_account_id).trim();
    const ready =
      Boolean(seller.stripe_details_submitted) &&
      Boolean(seller.stripe_charges_enabled) &&
      Boolean(seller.stripe_payouts_enabled);

    if (!/^acct_[A-Za-z0-9]+$/.test(destination) || !ready) {
      await supabaseAdmin
        .from("marketplace_seller_payouts")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", payoutId);
      failed += 1;
      continue;
    }

    // Fail closed (same contract as food transfers/run): a marketplace SCT
    // must always be funded from the seller_order's own charge.
    const sourceChargeId = await resolveSellerOrderSourceChargeId(
      supabaseAdmin,
      String(row.seller_order_id)
    );

    if (!sourceChargeId) {
      console.error("[marketplace-payout] missing source charge — payout failed closed", {
        payoutId,
        sellerOrderId: row.seller_order_id,
      });
      await supabaseAdmin
        .from("marketplace_seller_payouts")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", payoutId);
      failed += 1;
      continue;
    }

    try {
      const transfer = await stripe.transfers.create(
        {
          amount,
          currency,
          destination,
          source_transaction: sourceChargeId,
          metadata: {
            marketplace_seller_payout_id: payoutId,
            seller_id: String(row.seller_id),
            seller_order_id: String(row.seller_order_id),
            source: "execute_marketplace_payouts",
          },
        },
        { idempotencyKey: `mkt_seller_payout_${payoutId}` }
      );

      const { error: paidErr } = await supabaseAdmin
        .from("marketplace_seller_payouts")
        .update({
          status: "paid",
          stripe_transfer_id: transfer.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payoutId);

      if (paidErr) {
        console.error("[marketplace-payout] paid update failed after transfer", {
          payoutId,
          transferId: transfer.id,
          error: paidErr.message,
        });
        failed += 1;
      } else {
        executed += 1;
      }
    } catch (e) {
      console.error("[marketplace-payout] transfer failed", {
        payoutId,
        message: e instanceof Error ? e.message : String(e),
      });
      await supabaseAdmin
        .from("marketplace_seller_payouts")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", payoutId);
      failed += 1;
    }
  }

  // Driver marketplace payouts: transfer to driver Connect account.
  const { data: driverRows, error: driverLoadErr } = await supabaseAdmin
    .from("marketplace_driver_payouts")
    .select(
      "id,driver_id,seller_order_id,marketplace_delivery_job_id,total_driver_payout_cents,currency,status,stripe_transfer_id,payout_live_enabled"
    )
    .eq("status", "approved")
    .eq("payout_live_enabled", true)
    .is("stripe_transfer_id", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (driverLoadErr) {
    return {
      ok: false,
      executed,
      failed,
      error: driverLoadErr.message,
    };
  }

  for (const row of driverRows ?? []) {
    const payoutId = String(row.id);
    const amount = Number(row.total_driver_payout_cents ?? 0);
    const currency = String(row.currency ?? "USD").toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) {
      failed += 1;
      continue;
    }

    const { data: driver, error: driverErr } = await supabaseAdmin
      .from("driver_profiles")
      .select("user_id,stripe_account_id,stripe_onboarded")
      .eq("user_id", row.driver_id)
      .maybeSingle();

    if (driverErr || !driver?.stripe_account_id || !driver.stripe_onboarded) {
      await supabaseAdmin
        .from("marketplace_driver_payouts")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", payoutId);
      failed += 1;
      continue;
    }

    const destination = String(driver.stripe_account_id).trim();

    if (!/^acct_[A-Za-z0-9]+$/.test(destination)) {
      await supabaseAdmin
        .from("marketplace_driver_payouts")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", payoutId);
      failed += 1;
      continue;
    }

    // Fail closed (same contract as food transfers/run): a marketplace SCT
    // must always be funded from the seller_order's own charge.
    const sourceChargeId = await resolveSellerOrderSourceChargeId(
      supabaseAdmin,
      String(row.seller_order_id)
    );

    if (!sourceChargeId) {
      console.error("[marketplace-payout] missing source charge — driver payout failed closed", {
        payoutId,
        sellerOrderId: row.seller_order_id,
      });
      await supabaseAdmin
        .from("marketplace_driver_payouts")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", payoutId);
      failed += 1;
      continue;
    }

    try {
      const transfer = await stripe.transfers.create(
        {
          amount,
          currency,
          destination,
          source_transaction: sourceChargeId,
          metadata: {
            marketplace_driver_payout_id: payoutId,
            driver_id: String(row.driver_id),
            seller_order_id: String(row.seller_order_id),
            source: "execute_marketplace_payouts",
          },
        },
        { idempotencyKey: `mkt_driver_payout_${payoutId}` }
      );

      const { error: paidErr } = await supabaseAdmin
        .from("marketplace_driver_payouts")
        .update({
          status: "paid",
          stripe_transfer_id: transfer.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payoutId)
        .is("stripe_transfer_id", null);

      if (paidErr) {
        failed += 1;
      } else {
        executed += 1;
      }
    } catch (e) {
      console.error("[marketplace-payout] driver transfer failed", {
        payoutId,
        message: e instanceof Error ? e.message : String(e),
      });
      await supabaseAdmin
        .from("marketplace_driver_payouts")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", payoutId);
      failed += 1;
    }
  }

  return { ok: true, executed, failed };
}
