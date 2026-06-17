import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMarketplaceDispatchLiveEnvEnabled,
  type MarketplaceDeliveryJobStatus,
} from "@/lib/marketplaceDispatch";
import { resolveMarketplaceLiveFlagsForScope } from "@/lib/platformScopeResolver";
import { buildMarketplaceDeliveryShadowForOrder } from "@/lib/marketplaceDeliveryShadow";

export type MarketplaceDeliveryJobRow = {
  id: string;
  seller_order_id: string;
  seller_id: string;
  client_id: string | null;
  pickup_location_id: string | null;
  dropoff_location_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  status: MarketplaceDeliveryJobStatus;
  assigned_driver_id: string | null;
  estimated_distance_miles: number | null;
  estimated_minutes: number | null;
  driver_earning_cents: number;
  platform_margin_cents: number;
  live_dispatch_enabled: boolean;
  drivers_notified: boolean;
  created_at: string;
  updated_at: string;
};

type SellerOrderDispatchSource = {
  id: string;
  seller_id: string;
  client_user_id: string | null;
  status: string;
  payment_status: string | null;
  pickup_location_id: string | null;
  dropoff_location_id: string | null;
  seller_pickup_address: string | null;
  estimated_distance_miles: number | null;
  estimated_minutes: number | null;
  driver_earning_shadow_cents: number | null;
  platform_margin_shadow_cents: number | null;
  sellers?: { country_code?: string | null } | null;
};

function formatLocationAddress(
  point: {
    formatted_address?: string | null;
    commune_name?: string | null;
    quartier_name?: string | null;
    country_code?: string | null;
  } | null,
  fallback?: string | null
): string | null {
  if (fallback?.trim()) return fallback.trim();
  if (!point) return null;
  if (point.formatted_address?.trim()) return point.formatted_address.trim();
  const parts = [point.quartier_name, point.commune_name, point.country_code].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

async function loadLocationPoint(
  supabaseAdmin: SupabaseClient,
  locationId?: string | null
) {
  if (!locationId) return null;
  const { data, error } = await supabaseAdmin
    .from("location_points")
    .select("id,formatted_address,commune_name,quartier_name,country_code,pin_lat,pin_lng")
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function loadSellerOrderForDispatch(
  supabaseAdmin: SupabaseClient,
  sellerOrderId: string
): Promise<SellerOrderDispatchSource | null> {
  const { data, error } = await supabaseAdmin
    .from("seller_orders")
    .select(
      "id,seller_id,client_user_id,status,payment_status,pickup_location_id,dropoff_location_id,seller_pickup_address,estimated_distance_miles,estimated_minutes,driver_earning_shadow_cents,platform_margin_shadow_cents,sellers(country_code)"
    )
    .eq("id", sellerOrderId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as SellerOrderDispatchSource | null;
}

function isSellerOrderPaid(order: SellerOrderDispatchSource): boolean {
  return order.payment_status === "paid" || order.status === "paid";
}

function sellerCountryCode(order: SellerOrderDispatchSource): string | null {
  const raw = Array.isArray(order.sellers)
    ? order.sellers[0]?.country_code
    : order.sellers?.country_code;
  const code = String(raw ?? "").trim().toUpperCase();
  return code.length === 2 ? code : null;
}

async function resolveDispatchLiveForOrder(
  supabaseAdmin: SupabaseClient,
  order: SellerOrderDispatchSource,
  pickupCountryCode?: string | null
): Promise<boolean> {
  const countryCode = sellerCountryCode(order) ?? pickupCountryCode ?? null;
  if (!countryCode) return false;

  const flags = await resolveMarketplaceLiveFlagsForScope(supabaseAdmin, {
    country_code: countryCode,
    region_code: null,
    mmd_zone_id: null,
  });
  return flags.marketplace_dispatch_live_enabled;
}

function resolveInitialJobStatus(): MarketplaceDeliveryJobStatus {
  // Paid marketplace orders enter the driver pool as ready; live_dispatch_enabled stays env-gated.
  return "dispatch_ready";
}

export async function prepareMarketplaceDeliveryJob(
  supabaseAdmin: SupabaseClient,
  params: {
    sellerOrderId: string;
    source?: string;
  }
): Promise<{
  ok: boolean;
  job?: MarketplaceDeliveryJobRow;
  already_exists?: boolean;
  skipped?: string;
  error?: string;
}> {
  const { sellerOrderId, source = "prepare" } = params;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("marketplace_delivery_jobs")
    .select("*")
    .eq("seller_order_id", sellerOrderId)
    .maybeSingle();

  if (existingError) return { ok: false, error: existingError.message };
  if (existing) {
    return {
      ok: true,
      job: existing as MarketplaceDeliveryJobRow,
      already_exists: true,
    };
  }

  const order = await loadSellerOrderForDispatch(supabaseAdmin, sellerOrderId);
  if (!order) return { ok: false, error: "seller_order_not_found" };
  if (!isSellerOrderPaid(order)) {
    return { ok: true, skipped: "order_not_paid" };
  }

  const [pickupPoint, dropoffPoint] = await Promise.all([
    loadLocationPoint(supabaseAdmin, order.pickup_location_id),
    loadLocationPoint(supabaseAdmin, order.dropoff_location_id),
  ]);

  let estimatedDistanceMiles = Number(order.estimated_distance_miles);
  let estimatedMinutes = Number(order.estimated_minutes);
  let driverEarningCents = Number(order.driver_earning_shadow_cents ?? 0);
  let platformMarginCents = Number(order.platform_margin_shadow_cents ?? 0);

  if (
    !Number.isFinite(estimatedDistanceMiles) ||
    estimatedDistanceMiles <= 0 ||
    driverEarningCents <= 0
  ) {
    const countryCode =
      (Array.isArray(order.sellers)
        ? order.sellers[0]?.country_code
        : order.sellers?.country_code) ?? pickupPoint?.country_code ?? null;

    const shadow = await buildMarketplaceDeliveryShadowForOrder(supabaseAdmin, {
      sellerId: order.seller_id,
      pickupLocationId: order.pickup_location_id,
      dropoffLocationId: order.dropoff_location_id,
      countryCode,
    });

    estimatedDistanceMiles = shadow.estimated_distance_miles;
    estimatedMinutes = shadow.estimated_minutes;
    driverEarningCents = shadow.driver_earning_shadow_cents;
    platformMarginCents = shadow.platform_margin_shadow_cents;
  }

  const countryCode =
    sellerCountryCode(order) ??
    pickupPoint?.country_code ??
    dropoffPoint?.country_code ??
    null;

  const liveEnabled = await resolveDispatchLiveForOrder(
    supabaseAdmin,
    order,
    countryCode
  );
  const now = new Date().toISOString();

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("marketplace_delivery_jobs")
    .insert({
      seller_order_id: sellerOrderId,
      seller_id: order.seller_id,
      client_id: order.client_user_id,
      pickup_location_id: order.pickup_location_id ?? pickupPoint?.id ?? null,
      dropoff_location_id: order.dropoff_location_id ?? dropoffPoint?.id ?? null,
      pickup_address: formatLocationAddress(pickupPoint, order.seller_pickup_address),
      dropoff_address: formatLocationAddress(dropoffPoint, null),
      status: resolveInitialJobStatus(),
      estimated_distance_miles: estimatedDistanceMiles,
      estimated_minutes: estimatedMinutes,
      driver_earning_cents: driverEarningCents,
      platform_margin_cents: platformMarginCents,
      live_dispatch_enabled: liveEnabled,
      drivers_notified: false,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .maybeSingle();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: raced } = await supabaseAdmin
        .from("marketplace_delivery_jobs")
        .select("*")
        .eq("seller_order_id", sellerOrderId)
        .maybeSingle();
      if (raced) {
        return {
          ok: true,
          job: raced as MarketplaceDeliveryJobRow,
          already_exists: true,
        };
      }
    }
    return { ok: false, error: insertError.message };
  }

  console.log("[marketplace-dispatch] job prepared", {
    sellerOrderId,
    jobId: inserted?.id,
    status: inserted?.status,
    live_dispatch_enabled: liveEnabled,
    source,
  });

  return { ok: true, job: inserted as MarketplaceDeliveryJobRow };
}

export async function prepareMarketplaceDeliveryJobAfterPayment(
  supabaseAdmin: SupabaseClient,
  params: {
    sellerOrderId: string;
    source?: string;
  }
): Promise<{ ok: boolean; job?: MarketplaceDeliveryJobRow; error?: string; skipped?: string }> {
  return prepareMarketplaceDeliveryJob(supabaseAdmin, params);
}

export async function markMarketplaceJobReady(
  supabaseAdmin: SupabaseClient,
  params: { jobId: string }
): Promise<{ ok: boolean; job?: MarketplaceDeliveryJobRow; ignored?: string; error?: string }> {
  const { data: jobRow, error: loadError } = await supabaseAdmin
    .from("marketplace_delivery_jobs")
    .select("id,seller_order_id,sellers(country_code)")
    .eq("id", params.jobId)
    .maybeSingle();

  if (loadError) return { ok: false, error: loadError.message };
  if (!jobRow) return { ok: false, error: "job_not_found" };

  const order = await loadSellerOrderForDispatch(supabaseAdmin, String(jobRow.seller_order_id));
  if (!order) return { ok: false, error: "seller_order_not_found" };

  const dispatchLive = await resolveDispatchLiveForOrder(supabaseAdmin, order);
  if (!dispatchLive) {
    return { ok: true, ignored: "marketplace_dispatch_live_disabled" };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("marketplace_delivery_jobs")
    .update({
      status: "dispatch_ready",
      live_dispatch_enabled: true,
      drivers_notified: false,
      updated_at: now,
    })
    .eq("id", params.jobId)
    .neq("status", "cancelled")
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "job_not_found" };
  return { ok: true, job: data as MarketplaceDeliveryJobRow };
}

export async function simulateMarketplaceDispatch(
  supabaseAdmin: SupabaseClient,
  params: { jobId: string }
): Promise<{
  ok: boolean;
  job?: MarketplaceDeliveryJobRow;
  simulation?: Record<string, unknown>;
  ignored?: string;
  error?: string;
}> {
  const { data: job, error: loadError } = await supabaseAdmin
    .from("marketplace_delivery_jobs")
    .select("*")
    .eq("id", params.jobId)
    .maybeSingle();

  if (loadError) return { ok: false, error: loadError.message };
  if (!job) return { ok: false, error: "job_not_found" };

  const order = await loadSellerOrderForDispatch(supabaseAdmin, String(job.seller_order_id));
  const dispatchLive = order
    ? await resolveDispatchLiveForOrder(supabaseAdmin, order)
    : isMarketplaceDispatchLiveEnvEnabled();

  const simulation = {
    simulated_at: new Date().toISOString(),
    live_dispatch_enabled: false,
    drivers_notified: false,
    message:
      "Marketplace dispatch simulation only — no delivery_requests, no driver notifications.",
    estimated_distance_miles: job.estimated_distance_miles,
    estimated_minutes: job.estimated_minutes,
    driver_earning_cents: job.driver_earning_cents,
    platform_margin_cents: job.platform_margin_cents,
  };

  if (dispatchLive) {
    return {
      ok: true,
      job: job as MarketplaceDeliveryJobRow,
      simulation: {
        ...simulation,
        live_dispatch_enabled: true,
        message:
          "Live dispatch flag ON — assignment still requires explicit validation; no driver notifications in Phase 12.",
      },
    };
  }

  return {
    ok: true,
    job: job as MarketplaceDeliveryJobRow,
    simulation,
    ignored: "marketplace_dispatch_live_disabled",
  };
}

export async function assignMarketplaceDriver(
  supabaseAdmin: SupabaseClient,
  params: { jobId: string; driverUserId: string }
): Promise<{ ok: boolean; job?: MarketplaceDeliveryJobRow; ignored?: string; error?: string }> {
  const { data: jobRow, error: loadError } = await supabaseAdmin
    .from("marketplace_delivery_jobs")
    .select("id,seller_order_id")
    .eq("id", params.jobId)
    .maybeSingle();

  if (loadError) return { ok: false, error: loadError.message };
  if (!jobRow) return { ok: false, error: "job_not_found" };

  const order = await loadSellerOrderForDispatch(
    supabaseAdmin,
    String(jobRow.seller_order_id)
  );
  if (!order) return { ok: false, error: "seller_order_not_found" };

  const dispatchLive = await resolveDispatchLiveForOrder(supabaseAdmin, order);
  if (!dispatchLive) {
    return { ok: true, ignored: "marketplace_dispatch_live_disabled" };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("marketplace_delivery_jobs")
    .update({
      status: "dispatch_assigned",
      assigned_driver_id: params.driverUserId,
      drivers_notified: false,
      updated_at: now,
    })
    .eq("id", params.jobId)
    .in("status", ["dispatch_pending", "dispatch_ready"])
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "job_not_assignable" };

  console.log("[marketplace-dispatch] driver assigned (no notification in Phase 12)", {
    jobId: params.jobId,
    driverUserId: params.driverUserId,
  });

  return { ok: true, job: data as MarketplaceDeliveryJobRow };
}

export async function getMarketplaceDispatchStatus(
  supabaseAdmin: SupabaseClient,
  params: { sellerOrderId: string }
): Promise<{
  ok: boolean;
  job?: MarketplaceDeliveryJobRow | null;
  live_dispatch_enabled?: boolean;
  error?: string;
}> {
  const { data, error } = await supabaseAdmin
    .from("marketplace_delivery_jobs")
    .select("*")
    .eq("seller_order_id", params.sellerOrderId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };

  const order = await loadSellerOrderForDispatch(supabaseAdmin, params.sellerOrderId);
  const liveDispatchEnabled = order
    ? await resolveDispatchLiveForOrder(supabaseAdmin, order)
    : false;

  return {
    ok: true,
    job: (data as MarketplaceDeliveryJobRow | null) ?? null,
    live_dispatch_enabled: liveDispatchEnabled,
  };
}
