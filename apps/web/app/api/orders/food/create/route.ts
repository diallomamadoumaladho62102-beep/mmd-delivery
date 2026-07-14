import { NextRequest } from "next/server";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import {
  DELIVERY_SHARE_PCT_INVALID_CODE,
  DeliveryPricingConfigError,
} from "@/lib/deliveryPricing";
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
import { logTechnicalError } from "@/lib/userFacingError";

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
      leaveAtDoor: fields.leaveAtDoor,
    });

    return mmdLocationJson({
      ok: true,
      order_id: result.orderId,
      pricing: buildFoodPricingResponse(result),
      commissions: result.commissions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";

    if (
      error instanceof DeliveryPricingConfigError ||
      /driverSharePct\s*\+\s*platformSharePct/i.test(message) ||
      message.includes(DELIVERY_SHARE_PCT_INVALID_CODE)
    ) {
      logTechnicalError("api.orders.food.create", error, {
        code: DELIVERY_SHARE_PCT_INVALID_CODE,
      });
      // Never create an order when the delivery split is invalid.
      // Mobile maps this code to a localized user message; technical detail goes to Sentry.
      return mmdLocationJson(
        {
          ok: false,
          error: DELIVERY_SHARE_PCT_INVALID_CODE,
          code: DELIVERY_SHARE_PCT_INVALID_CODE,
          message: DELIVERY_SHARE_PCT_INVALID_CODE,
        },
        400
      );
    }

    return mmdLocationJson({ ok: false, error: message }, 400);
  }
}
