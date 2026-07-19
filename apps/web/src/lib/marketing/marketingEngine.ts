import type { SupabaseClient } from "@supabase/supabase-js";

export type MarketingService = "food" | "delivery" | "taxi" | "marketplace";

export type MarketingResolveResult = {
  ok: boolean;
  error?: string;
  fail_closed?: boolean;
  order_discount_cents: number;
  delivery_fee_discount_cents: number;
  cashback_cents: number;
  points_bonus: number;
  applied: Array<Record<string, unknown>>;
  rejected: Array<Record<string, unknown>>;
  stack_policy?: string;
  promo_code?: string | null;
  coupon_id?: string | null;
  engine_version?: string;
};

export type MarketingReserveResult = MarketingResolveResult & {
  reserved?: boolean;
  already_reserved?: boolean;
  reservation_id?: string;
  resolve?: MarketingResolveResult;
};

type CacheEntry = { expiresAt: number; payload: MarketingResolveResult };
const resolveCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 20_000;

const emptyResolve = (): MarketingResolveResult => ({
  ok: true,
  order_discount_cents: 0,
  delivery_fee_discount_cents: 0,
  cashback_cents: 0,
  points_bonus: 0,
  applied: [],
  rejected: [],
});

function cacheKey(params: Record<string, unknown>) {
  return JSON.stringify(params);
}

export function invalidateMarketingCache() {
  resolveCache.clear();
}

/** Preview eligible campaigns. Fail-open unless a private code fails closed. */
export async function resolveMarketingOffers(
  supabaseAdmin: SupabaseClient,
  params: {
    userId: string;
    service: MarketingService;
    subtotalCents?: number;
    deliveryFeeCents?: number;
    promoCode?: string | null;
    couponId?: string | null;
    countryCode?: string | null;
    city?: string | null;
    partnerUserId?: string | null;
    hasMmdPlus?: boolean;
    isFirstOrder?: boolean;
    skipCache?: boolean;
  }
): Promise<MarketingResolveResult> {
  const userId = String(params.userId ?? "").trim();
  if (!userId) return emptyResolve();

  const key = cacheKey({
    userId,
    service: params.service,
    sub: Math.floor((params.subtotalCents ?? 0) / 100) * 100,
    fee: Math.floor((params.deliveryFeeCents ?? 0) / 50) * 50,
    code: params.promoCode ?? "",
    coupon: params.couponId ?? "",
    country: params.countryCode ?? "",
    plus: !!params.hasMmdPlus,
    first: !!params.isFirstOrder,
  });

  if (!params.skipCache && !params.promoCode && !params.couponId) {
    const hit = resolveCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.payload;
  }

  try {
    const { data, error } = await supabaseAdmin.rpc("mmd_marketing_resolve", {
      p_user_id: userId,
      p_service: params.service,
      p_subtotal_cents: Math.max(0, Math.round(Number(params.subtotalCents ?? 0))),
      p_delivery_fee_cents: Math.max(0, Math.round(Number(params.deliveryFeeCents ?? 0))),
      p_promo_code: params.promoCode ?? null,
      p_coupon_id: params.couponId ?? null,
      p_country_code: params.countryCode ?? null,
      p_city: params.city ?? null,
      p_partner_user_id: params.partnerUserId ?? null,
      p_has_mmd_plus: params.hasMmdPlus === true,
      p_is_first_order: params.isFirstOrder === true,
    });

    if (error) {
      // Fail-open for automatic; fail-closed when validating a code
      if (params.promoCode || params.couponId) {
        return {
          ...emptyResolve(),
          ok: false,
          error: error.message,
          fail_closed: true,
        };
      }
      console.warn("[marketing] resolve failed (fail-open)", error.message);
      return emptyResolve();
    }

    const row = (data ?? {}) as Record<string, unknown>;
    const payload: MarketingResolveResult = {
      ok: row.ok !== false,
      error: row.error ? String(row.error) : undefined,
      fail_closed: row.fail_closed === true,
      order_discount_cents: Math.max(0, Number(row.order_discount_cents ?? 0)),
      delivery_fee_discount_cents: Math.max(0, Number(row.delivery_fee_discount_cents ?? 0)),
      cashback_cents: Math.max(0, Number(row.cashback_cents ?? 0)),
      points_bonus: Math.max(0, Number(row.points_bonus ?? 0)),
      applied: Array.isArray(row.applied) ? (row.applied as Array<Record<string, unknown>>) : [],
      rejected: Array.isArray(row.rejected) ? (row.rejected as Array<Record<string, unknown>>) : [],
      stack_policy: row.stack_policy ? String(row.stack_policy) : "default",
      promo_code: row.promo_code ? String(row.promo_code) : null,
      coupon_id: row.coupon_id ? String(row.coupon_id) : null,
      engine_version: String(row.engine_version ?? "marketing_v1"),
    };

    if (!params.promoCode && !params.couponId && payload.ok) {
      resolveCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
    }
    return payload;
  } catch (e) {
    if (params.promoCode || params.couponId) {
      return {
        ...emptyResolve(),
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        fail_closed: true,
      };
    }
    console.warn("[marketing] resolve threw (fail-open)", e instanceof Error ? e.message : e);
    return emptyResolve();
  }
}

export async function reserveMarketingOffers(
  supabaseAdmin: SupabaseClient,
  params: {
    userId: string;
    service: MarketingService;
    entityType: string;
    entityId: string;
    idempotencyKey: string;
    subtotalCents?: number;
    deliveryFeeCents?: number;
    promoCode?: string | null;
    couponId?: string | null;
    countryCode?: string | null;
    city?: string | null;
    partnerUserId?: string | null;
    hasMmdPlus?: boolean;
    isFirstOrder?: boolean;
    ttlMinutes?: number;
  }
): Promise<MarketingReserveResult> {
  try {
    const { data, error } = await supabaseAdmin.rpc("mmd_marketing_reserve", {
      p_user_id: params.userId,
      p_service: params.service,
      p_entity_type: params.entityType,
      p_entity_id: params.entityId,
      p_idempotency_key: params.idempotencyKey,
      p_subtotal_cents: Math.max(0, Math.round(Number(params.subtotalCents ?? 0))),
      p_delivery_fee_cents: Math.max(0, Math.round(Number(params.deliveryFeeCents ?? 0))),
      p_promo_code: params.promoCode ?? null,
      p_coupon_id: params.couponId ?? null,
      p_country_code: params.countryCode ?? null,
      p_city: params.city ?? null,
      p_partner_user_id: params.partnerUserId ?? null,
      p_has_mmd_plus: params.hasMmdPlus === true,
      p_is_first_order: params.isFirstOrder === true,
      p_ttl_minutes: params.ttlMinutes ?? 45,
    });
    if (error) {
      if (params.promoCode || params.couponId) {
        return { ...emptyResolve(), ok: false, error: error.message, fail_closed: true };
      }
      console.warn("[marketing] reserve failed (fail-open)", error.message);
      return { ...emptyResolve(), reserved: false };
    }
    const row = (data ?? {}) as Record<string, unknown>;
    invalidateMarketingCache();
    return {
      ok: row.ok !== false,
      error: row.error ? String(row.error) : undefined,
      fail_closed: row.fail_closed === true,
      reserved: row.reserved === true,
      already_reserved: row.already_reserved === true,
      reservation_id: row.reservation_id ? String(row.reservation_id) : undefined,
      order_discount_cents: Math.max(0, Number(row.order_discount_cents ?? 0)),
      delivery_fee_discount_cents: Math.max(0, Number(row.delivery_fee_discount_cents ?? 0)),
      cashback_cents: Math.max(0, Number(row.cashback_cents ?? 0)),
      points_bonus: Math.max(0, Number(row.points_bonus ?? 0)),
      applied: [],
      rejected: [],
      resolve: row.resolve as MarketingResolveResult | undefined,
    };
  } catch (e) {
    console.warn("[marketing] reserve threw (fail-open)", e instanceof Error ? e.message : e);
    return { ...emptyResolve(), reserved: false };
  }
}

export async function captureMarketingReservation(
  supabaseAdmin: SupabaseClient,
  params: { reservationId?: string | null; idempotencyKey?: string | null }
): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await supabaseAdmin.rpc("mmd_marketing_capture", {
      p_reservation_id: params.reservationId ?? null,
      p_idempotency_key: params.idempotencyKey ?? null,
    });
    if (error) {
      console.warn("[marketing] capture failed", error.message);
      return { ok: false, error: error.message };
    }
    invalidateMarketingCache();
    return (data ?? {}) as Record<string, unknown>;
  } catch (e) {
    console.warn("[marketing] capture threw", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function releaseMarketingReservation(
  supabaseAdmin: SupabaseClient,
  params: {
    reservationId?: string | null;
    idempotencyKey?: string | null;
    reason?: string | null;
  }
): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await supabaseAdmin.rpc("mmd_marketing_release", {
      p_reservation_id: params.reservationId ?? null,
      p_idempotency_key: params.idempotencyKey ?? null,
      p_reason: params.reason ?? null,
    });
    if (error) {
      console.warn("[marketing] release failed", error.message);
      return { ok: false, error: error.message };
    }
    invalidateMarketingCache();
    return (data ?? {}) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function reverseMarketingApplication(
  supabaseAdmin: SupabaseClient,
  params: {
    entityType: string;
    entityId: string;
    restoreCoupon?: boolean;
    reason?: string | null;
    idempotencyKey?: string | null;
  }
): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await supabaseAdmin.rpc("mmd_marketing_reverse", {
      p_entity_type: params.entityType,
      p_entity_id: params.entityId,
      p_restore_coupon: params.restoreCoupon === true,
      p_reason: params.reason ?? null,
      p_idempotency_key: params.idempotencyKey ?? null,
    });
    if (error) return { ok: false, error: error.message };
    return (data ?? {}) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Detect MMD+ for stacking rules — fail-open to false. */
export async function userHasActiveMmdPlus(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("mmd_plus_subscriptions")
      .select("id")
      .eq("user_id", userId)
      .in("status", ["active", "trialing"])
      .limit(1)
      .maybeSingle();
    return Boolean(data?.id);
  } catch {
    return false;
  }
}

export async function isLikelyFirstOrder(
  supabaseAdmin: SupabaseClient,
  userId: string,
  service: MarketingService
): Promise<boolean> {
  try {
    if (service === "food") {
      const { count } = await supabaseAdmin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("client_user_id", userId)
        .eq("payment_status", "paid");
      return (count ?? 0) === 0;
    }
    if (service === "delivery") {
      const { count } = await supabaseAdmin
        .from("delivery_requests")
        .select("id", { count: "exact", head: true })
        .eq("client_user_id", userId)
        .eq("payment_status", "paid");
      return (count ?? 0) === 0;
    }
    if (service === "taxi") {
      const { count } = await supabaseAdmin
        .from("taxi_rides")
        .select("id", { count: "exact", head: true })
        .eq("client_user_id", userId)
        .eq("payment_status", "paid");
      return (count ?? 0) === 0;
    }
    if (service === "marketplace") {
      const { count } = await supabaseAdmin
        .from("seller_orders")
        .select("id", { count: "exact", head: true })
        .eq("client_user_id", userId)
        .eq("payment_status", "paid");
      return (count ?? 0) === 0;
    }
  } catch {
    return false;
  }
  return false;
}
