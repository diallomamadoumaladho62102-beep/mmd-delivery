import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import {
  isLikelyFirstOrder,
  resolveMarketingOffers,
  userHasActiveMmdPlus,
} from "@/lib/marketing/marketingEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const service = String(req.nextUrl.searchParams.get("service") ?? "food");
    const subtotal = Math.max(0, Math.round(Number(req.nextUrl.searchParams.get("subtotal_cents") ?? 0)));
    const fee = Math.max(0, Math.round(Number(req.nextUrl.searchParams.get("delivery_fee_cents") ?? 0)));
    const promoCode = req.nextUrl.searchParams.get("promo_code");
    const couponId = req.nextUrl.searchParams.get("coupon_id");

    if (!["food", "delivery", "taxi", "marketplace"].includes(service)) {
      return taxiJson({ ok: false, error: "invalid_service" }, 400);
    }

    const [hasPlus, firstOrder, coupons] = await Promise.all([
      userHasActiveMmdPlus(auth.supabaseAdmin, auth.user.id),
      isLikelyFirstOrder(
        auth.supabaseAdmin,
        auth.user.id,
        service as "food" | "delivery" | "taxi" | "marketplace"
      ),
      auth.supabaseAdmin
        .from("marketing_coupons")
        .select(
          "id, status, expires_at, value_cents, value_percent, services, campaign_id, marketing_campaigns(name, description, campaign_type)"
        )
        .eq("user_id", auth.user.id)
        .eq("status", "available")
        .order("expires_at", { ascending: true })
        .limit(50),
    ]);

    const resolve = await resolveMarketingOffers(auth.supabaseAdmin, {
      userId: auth.user.id,
      service: service as "food" | "delivery" | "taxi" | "marketplace",
      subtotalCents: subtotal,
      deliveryFeeCents: fee,
      promoCode,
      couponId,
      hasMmdPlus: hasPlus,
      isFirstOrder: firstOrder,
      skipCache: Boolean(promoCode || couponId),
    });

    const { data: offers } = await auth.supabaseAdmin
      .from("marketing_campaigns")
      .select(
        "id, code, name, description, campaign_type, services, ends_at, discount_percent, discount_cents, requires_code, auto_apply, requires_mmd_plus"
      )
      .eq("status", "active")
      .eq("visible", true)
      .order("priority", { ascending: true })
      .limit(40);

    return taxiJson({
      ok: true,
      resolve,
      coupons: coupons.data ?? [],
      offers: offers ?? [],
      has_mmd_plus: hasPlus,
    });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}
