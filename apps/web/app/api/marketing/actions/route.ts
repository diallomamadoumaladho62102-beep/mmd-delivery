import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import {
  isLikelyFirstOrder,
  releaseMarketingReservation,
  reserveMarketingOffers,
  resolveMarketingOffers,
  userHasActiveMmdPlus,
} from "@/lib/marketing/marketingEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "").trim();

    if (action === "validate_code") {
      const service = String(body.service ?? "food");
      if (!["food", "delivery", "taxi", "marketplace"].includes(service)) {
        return taxiJson({ ok: false, error: "invalid_service" }, 400);
      }
      const [hasPlus, firstOrder] = await Promise.all([
        userHasActiveMmdPlus(auth.supabaseAdmin, auth.user.id),
        isLikelyFirstOrder(
          auth.supabaseAdmin,
          auth.user.id,
          service as "food" | "delivery" | "taxi" | "marketplace"
        ),
      ]);
      const resolve = await resolveMarketingOffers(auth.supabaseAdmin, {
        userId: auth.user.id,
        service: service as "food" | "delivery" | "taxi" | "marketplace",
        subtotalCents: Math.max(0, Math.round(Number(body.subtotal_cents ?? 0))),
        deliveryFeeCents: Math.max(0, Math.round(Number(body.delivery_fee_cents ?? 0))),
        promoCode: typeof body.promo_code === "string" ? body.promo_code : null,
        couponId: typeof body.coupon_id === "string" ? body.coupon_id : null,
        countryCode: typeof body.country_code === "string" ? body.country_code : null,
        hasMmdPlus: hasPlus,
        isFirstOrder: firstOrder,
        skipCache: true,
      });
      if (!resolve.ok && resolve.fail_closed) {
        return taxiJson({ ok: false, error: resolve.error ?? "code_rejected", resolve }, 400);
      }
      return taxiJson({ ok: true, resolve });
    }

    if (action === "reserve") {
      const service = String(body.service ?? "");
      const entityType = String(body.entity_type ?? "").trim();
      const entityId = String(body.entity_id ?? "").trim();
      const idempotencyKey = String(body.idempotency_key ?? "").trim();
      if (!["food", "delivery", "taxi", "marketplace"].includes(service)) {
        return taxiJson({ ok: false, error: "invalid_service" }, 400);
      }
      if (!entityType || !entityId || !idempotencyKey) {
        return taxiJson({ ok: false, error: "missing_entity_or_key" }, 400);
      }
      const [hasPlus, firstOrder] = await Promise.all([
        userHasActiveMmdPlus(auth.supabaseAdmin, auth.user.id),
        isLikelyFirstOrder(
          auth.supabaseAdmin,
          auth.user.id,
          service as "food" | "delivery" | "taxi" | "marketplace"
        ),
      ]);
      const result = await reserveMarketingOffers(auth.supabaseAdmin, {
        userId: auth.user.id,
        service: service as "food" | "delivery" | "taxi" | "marketplace",
        entityType,
        entityId,
        idempotencyKey,
        subtotalCents: Math.max(0, Math.round(Number(body.subtotal_cents ?? 0))),
        deliveryFeeCents: Math.max(0, Math.round(Number(body.delivery_fee_cents ?? 0))),
        promoCode: typeof body.promo_code === "string" ? body.promo_code : null,
        couponId: typeof body.coupon_id === "string" ? body.coupon_id : null,
        countryCode: typeof body.country_code === "string" ? body.country_code : null,
        hasMmdPlus: hasPlus,
        isFirstOrder: firstOrder,
      });
      if (!result.ok && result.fail_closed) {
        return taxiJson({ ok: false, error: result.error ?? "reserve_failed", result }, 400);
      }
      return taxiJson({ ok: true, result });
    }

    if (action === "release") {
      const result = await releaseMarketingReservation(auth.supabaseAdmin, {
        reservationId: typeof body.reservation_id === "string" ? body.reservation_id : null,
        idempotencyKey: typeof body.idempotency_key === "string" ? body.idempotency_key : null,
        reason: typeof body.reason === "string" ? body.reason : "client_release",
      });
      return taxiJson({ ok: true, result });
    }

    return taxiJson({ ok: false, error: "Unknown action" }, 400);
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}
