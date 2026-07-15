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

const MARKETPLACE_SELLER_COMMISSION_BPS = 500; // 5% of subtotal

function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function isSellerOrderPaid(order: SellerOrderPayoutSource): boolean {
  return order.payment_status === "paid" || order.status === "paid";
}

export function calculateSellerMarketplacePayout(order: {
  subtotal_cents?: number | null;
  service_fee_cents?: number | null;
}): {
  gross_amount_cents: number;
  platform_fee_cents: number;
  seller_net_amount_cents: number;
} {
  const gross = roundCents(Number(order.subtotal_cents ?? 0));
  const commissionFromSubtotal = roundCents(
    (gross * MARKETPLACE_SELLER_COMMISSION_BPS) / 10_000
  );
  const platformFee =
    commissionFromSubtotal > 0
      ? commissionFromSubtotal
      : roundCents(Number(order.service_fee_cents ?? 0));
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
      "id,seller_id,status,payment_status,currency,subtotal_cents,service_fee_cents,total_cents,sellers(country_code)"
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

  const amounts = calculateSellerMarketplacePayout(order);
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
    .select("currency,payment_status,status,sellers(country_code)")
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

export async function executeMarketplacePayouts(
  supabaseAdmin: SupabaseClient,
  params?: { limit?: number }
): Promise<{
  ok: boolean;
  executed?: number;
  ignored?: string;
  error?: string;
}> {
  void supabaseAdmin;
  void params;

  if (!isMarketplacePayoutsLiveEnvEnabled()) {
    return { ok: true, ignored: "marketplace_payouts_live_disabled", executed: 0 };
  }

  return {
    ok: true,
    ignored: "marketplace_payouts_live_execution_not_enabled_yet",
    executed: 0,
  };
}
