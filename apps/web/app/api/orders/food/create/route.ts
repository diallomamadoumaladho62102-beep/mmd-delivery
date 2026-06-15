import { NextRequest } from "next/server";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import { requireFoodClientAuth } from "@/lib/foodOrderApiAuth";
import {
  buildFoodPricingResponse,
  countryCodeFromFoodAuthScope,
  parseFoodOrderRequestBody,
  readFoodOrderBodyFields,
  validateFoodOrderBodyFields,
} from "@/lib/foodOrderApiShared";
import { createFoodOrderServerSide } from "@/lib/foodOrderService";
import { inferPlatformCountryCode } from "@/lib/platformLaunchControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireFoodClientAuth(req);
  if (auth.ok === false) return auth.response;

  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return mmdLocationJson({ ok: false, error: "Invalid JSON body" }, 400);
  }

  try {
    const body = parseFoodOrderRequestBody(rawBody);
    const fields = readFoodOrderBodyFields(body);
    validateFoodOrderBodyFields(fields);

    const scopeCountry = countryCodeFromFoodAuthScope(auth.scope);
    const countryCode = inferPlatformCountryCode({
      countryCode: scopeCountry,
      lat: fields.dropoffLat,
      lng: fields.dropoffLng,
    });

    const { data: restaurantProfile, error: restaurantError } = await auth.supabaseAdmin
      .from("restaurant_profiles")
      .select("user_id, restaurant_name, status, is_accepting_orders")
      .eq("user_id", fields.restaurantUserId)
      .maybeSingle();

    if (restaurantError || !restaurantProfile) {
      return mmdLocationJson({ ok: false, error: "restaurant_not_found" }, 404);
    }

    if (
      restaurantProfile.status !== "approved" ||
      restaurantProfile.is_accepting_orders !== true
    ) {
      return mmdLocationJson({ ok: false, error: "restaurant_not_accepting_orders" }, 403);
    }

    const result = await createFoodOrderServerSide({
      supabaseAdmin: auth.supabaseAdmin,
      clientId: auth.user.id,
      restaurantUserId: fields.restaurantUserId,
      restaurantName:
        fields.restaurantName ||
        String(restaurantProfile.restaurant_name ?? "Restaurant"),
      pickupAddress: fields.pickupAddress,
      pickupLat: fields.pickupLat,
      pickupLng: fields.pickupLng,
      dropoffAddress: fields.dropoffAddress,
      dropoffLat: fields.dropoffLat,
      dropoffLng: fields.dropoffLng,
      items: fields.items,
      countryCode,
      promoCode: fields.promoCode,
    });

    return mmdLocationJson({
      ok: true,
      order_id: result.orderId,
      pricing: buildFoodPricingResponse(result),
      commissions: result.commissions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    const status = message.includes("rejected") ? 400 : 400;
    return mmdLocationJson({ ok: false, error: message }, status);
  }
}
