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
import { quoteFoodOrderServerSide } from "@/lib/foodOrderService";
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

    const pricing = await quoteFoodOrderServerSide({
      supabaseAdmin: auth.supabaseAdmin,
      restaurantUserId: fields.restaurantUserId,
      pickupLat: fields.pickupLat,
      pickupLng: fields.pickupLng,
      dropoffLat: fields.dropoffLat,
      dropoffLng: fields.dropoffLng,
      items: fields.items,
      countryCode,
      promoCode: fields.promoCode,
    });

    return mmdLocationJson({
      ok: true,
      quote: buildFoodPricingResponse(pricing),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";

    if (
      error instanceof DeliveryPricingConfigError ||
      /driverSharePct\s*\+\s*platformSharePct/i.test(message) ||
      message.includes(DELIVERY_SHARE_PCT_INVALID_CODE)
    ) {
      logTechnicalError("api.orders.food.quote", error, {
        code: DELIVERY_SHARE_PCT_INVALID_CODE,
      });
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
