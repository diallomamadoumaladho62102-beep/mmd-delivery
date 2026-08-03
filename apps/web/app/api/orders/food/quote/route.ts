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
import {
  deliverySharePctApiErrorPayload,
  isDeliverySharePctError,
} from "@/lib/deliveryShareApiError";
import { quoteFoodOrderServerSide } from "@/lib/foodOrderService";
import { assertRestaurantCanAcceptOrders } from "@/lib/restaurantAcceptGate";
import { inferPlatformCountryCode } from "@/lib/platformLaunchControl";
import { schedulePricingShadowCompare } from "@/lib/pricingEngine/shadow/runShadowCompare";
import { buildFoodComparablePair } from "@/lib/pricingEngine/engine/adapters/foodAdapter";
import { selectFoodChargePath } from "@/lib/pricingEngine/charge/selectFoodPackageCharge";

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

    const restaurantGate = await assertRestaurantCanAcceptOrders(
      auth.supabaseAdmin,
      fields.restaurantUserId,
    );
    if (restaurantGate.ok === false) {
      return mmdLocationJson(
        {
          ok: false,
          error: restaurantGate.error,
          message: restaurantGate.message,
        },
        restaurantGate.httpStatus,
      );
    }

    const legacyStarted = Date.now();
    const pricing = await quoteFoodOrderServerSide({
      supabaseAdmin: auth.supabaseAdmin,
      restaurantUserId: fields.restaurantUserId,
      pickupAddress: fields.pickupAddress,
      dropoffAddress: fields.dropoffAddress,
      pickupLat: fields.pickupLat,
      pickupLng: fields.pickupLng,
      dropoffLat: fields.dropoffLat,
      dropoffLng: fields.dropoffLng,
      items: fields.items,
      countryCode,
      promoCode: fields.promoCode,
    });
    const legacyLatencyMs = Date.now() - legacyStarted;

    schedulePricingShadowCompare({
      legacyLatencyMs,
      deps: { supabaseAdmin: auth.supabaseAdmin },
      buildPair: () => buildFoodComparablePair(pricing),
    });

    const selection = await selectFoodChargePath({
      pricing,
      canaryKey: auth.user.id,
      supabaseAdmin: auth.supabaseAdmin,
    });

    return mmdLocationJson({
      ok: true,
      quote: {
        ...buildFoodPricingResponse(pricing),
        total_cents: selection.customerTotalCents,
        charge_path: selection.chargePath,
        pricing_snapshot_id: selection.snapshot?.snapshotId ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";

    if (isDeliverySharePctError(error)) {
      return mmdLocationJson(
        deliverySharePctApiErrorPayload("api.orders.food.quote", error),
        400
      );
    }

    return mmdLocationJson({ ok: false, error: message }, 400);
  }
}
