import type { SupabaseClient } from "@supabase/supabase-js";
import {
  captureMarketingReservation,
  releaseMarketingReservation,
  reserveMarketingOffers,
  reverseMarketingApplication,
  type MarketingReserveResult,
  type MarketingService,
} from "@/lib/marketing/marketingEngine";

export type MarketingEntityKind =
  | "food"
  | "delivery"
  | "taxi"
  | "marketplace";

const ENTITY_TYPE: Record<MarketingEntityKind, string> = {
  food: "food_order",
  delivery: "delivery_request",
  taxi: "taxi_ride",
  marketplace: "seller_order",
};

const TABLE: Record<MarketingEntityKind, string> = {
  food: "orders",
  delivery: "delivery_requests",
  taxi: "taxi_rides",
  marketplace: "seller_orders",
};

/** Stable idempotency keys for marketing lifecycle ops. */
export function marketingIdempotencyKey(
  kind: MarketingEntityKind,
  entityId: string,
  action: "reserve" | "capture" | "release" | "reverse",
  extra?: string | null
): string {
  const base = `marketing:${kind}:${entityId}:${action}`;
  const suffix = String(extra ?? "").trim();
  return suffix ? `${base}:${suffix}` : base;
}

export function campaignIdsFromReserve(
  reserve: MarketingReserveResult
): string[] {
  const fromResolve = (reserve.resolve?.applied ?? [])
    .map((row) => String(row.campaign_id ?? row.id ?? "").trim())
    .filter(Boolean);
  if (fromResolve.length > 0) return fromResolve;
  return (reserve.applied ?? [])
    .map((row) => String(row.campaign_id ?? row.id ?? "").trim())
    .filter(Boolean);
}

export function totalMarketingDiscountCents(
  reserve: MarketingReserveResult
): number {
  return Math.max(
    0,
    Number(reserve.order_discount_cents ?? 0) +
      Number(reserve.delivery_fee_discount_cents ?? 0)
  );
}

/**
 * Reserve marketing after the checkout entity exists, then persist reservation
 * fields. Fail-closed when a private code/coupon was chosen; fail-open otherwise.
 */
export async function reserveAndAttachMarketing(
  supabaseAdmin: SupabaseClient,
  params: {
    kind: MarketingEntityKind;
    entityId: string;
    userId: string;
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
): Promise<{
  ok: boolean;
  fail_closed?: boolean;
  error?: string;
  reserve: MarketingReserveResult;
  marketing_reservation_id: string | null;
  marketing_discount_cents: number;
  marketing_campaign_ids: string[];
}> {
  const service = params.kind as MarketingService;
  const entityType = ENTITY_TYPE[params.kind];
  const table = TABLE[params.kind];
  const reserveKey = marketingIdempotencyKey(
    params.kind,
    params.entityId,
    "reserve"
  );

  const reserve = await reserveMarketingOffers(supabaseAdmin, {
    userId: params.userId,
    service,
    entityType,
    entityId: params.entityId,
    idempotencyKey: reserveKey,
    subtotalCents: params.subtotalCents,
    deliveryFeeCents: params.deliveryFeeCents,
    promoCode: params.promoCode,
    couponId: params.couponId,
    countryCode: params.countryCode,
    city: params.city,
    partnerUserId: params.partnerUserId,
    hasMmdPlus: params.hasMmdPlus,
    isFirstOrder: params.isFirstOrder,
    ttlMinutes: params.ttlMinutes,
  });

  const hasExplicitOffer = Boolean(params.promoCode || params.couponId);
  if (!reserve.ok || reserve.fail_closed) {
    if (hasExplicitOffer || reserve.fail_closed) {
      return {
        ok: false,
        fail_closed: true,
        error: reserve.error ?? "marketing_reserve_failed",
        reserve,
        marketing_reservation_id: null,
        marketing_discount_cents: 0,
        marketing_campaign_ids: [],
      };
    }
    // Fail-open: leave entity without reservation (caller may strip discount).
    return {
      ok: true,
      reserve,
      marketing_reservation_id: null,
      marketing_discount_cents: 0,
      marketing_campaign_ids: [],
    };
  }

  const reservationId = reserve.reservation_id
    ? String(reserve.reservation_id)
    : null;
  const discountCents = totalMarketingDiscountCents(reserve);
  const campaignIds = campaignIdsFromReserve(reserve);

  if (reservationId || discountCents > 0 || campaignIds.length > 0) {
    const { error } = await supabaseAdmin
      .from(table)
      .update({
        marketing_reservation_id: reservationId,
        marketing_discount_cents: discountCents,
        marketing_campaign_ids: campaignIds,
      })
      .eq("id", params.entityId);

    if (error) {
      console.warn(
        "[marketing] attach reservation fields failed",
        params.kind,
        error.message
      );
      if (hasExplicitOffer) {
        await releaseMarketingReservation(supabaseAdmin, {
          reservationId,
          idempotencyKey: reserveKey,
          reason: "attach_failed",
        });
        return {
          ok: false,
          fail_closed: true,
          error: error.message,
          reserve,
          marketing_reservation_id: null,
          marketing_discount_cents: 0,
          marketing_campaign_ids: [],
        };
      }
    }
  }

  return {
    ok: true,
    reserve,
    marketing_reservation_id: reservationId,
    marketing_discount_cents: discountCents,
    marketing_campaign_ids: campaignIds,
  };
}

export async function captureEntityMarketing(
  supabaseAdmin: SupabaseClient,
  kind: MarketingEntityKind,
  entityId: string,
  reservationId?: string | null
): Promise<Record<string, unknown>> {
  const key = marketingIdempotencyKey(kind, entityId, "capture");
  if (reservationId) {
    return captureMarketingReservation(supabaseAdmin, {
      reservationId,
      idempotencyKey: key,
    });
  }

  const table = TABLE[kind];
  const { data } = await supabaseAdmin
    .from(table)
    .select("marketing_reservation_id")
    .eq("id", entityId)
    .maybeSingle();

  const stored = data?.marketing_reservation_id
    ? String(data.marketing_reservation_id)
    : null;

  if (stored) {
    return captureMarketingReservation(supabaseAdmin, {
      reservationId: stored,
      idempotencyKey: key,
    });
  }

  // Fallback to reserve key (Phase 7.1 convention).
  return captureMarketingReservation(supabaseAdmin, {
    idempotencyKey: marketingIdempotencyKey(kind, entityId, "reserve"),
  });
}

export async function releaseEntityMarketing(
  supabaseAdmin: SupabaseClient,
  kind: MarketingEntityKind,
  entityId: string,
  reason?: string | null
): Promise<Record<string, unknown>> {
  const table = TABLE[kind];
  const { data } = await supabaseAdmin
    .from(table)
    .select("marketing_reservation_id")
    .eq("id", entityId)
    .maybeSingle();

  const reservationId = data?.marketing_reservation_id
    ? String(data.marketing_reservation_id)
    : null;

  return releaseMarketingReservation(supabaseAdmin, {
    reservationId,
    idempotencyKey: marketingIdempotencyKey(kind, entityId, "reserve"),
    reason: reason ?? "checkout_released",
  });
}

export async function reverseEntityMarketing(
  supabaseAdmin: SupabaseClient,
  kind: MarketingEntityKind,
  entityId: string,
  params?: {
    reason?: string | null;
    restoreCoupon?: boolean;
    refundId?: string | null;
  }
): Promise<Record<string, unknown>> {
  return reverseMarketingApplication(supabaseAdmin, {
    entityType: ENTITY_TYPE[kind],
    entityId,
    restoreCoupon: params?.restoreCoupon === true,
    reason: params?.reason ?? null,
    idempotencyKey: marketingIdempotencyKey(
      kind,
      entityId,
      "reverse",
      params?.refundId ?? null
    ),
  });
}
