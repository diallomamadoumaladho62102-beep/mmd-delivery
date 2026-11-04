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
import { createFoodOrderServerSide } from "@/lib/foodOrderService";
import { assertRestaurantCanAcceptOrders } from "@/lib/restaurantAcceptGate";
import { runFoodOrderPaymentSideEffects } from "@/lib/restaurantOrderAutomation";
import { inferPlatformCountryCode } from "@/lib/platformLaunchControl";
import { usesLocalMobileMoney } from "@/lib/paymentProviderRouting";
import { GUINEA_TEST_LIVE_OPERATION_BLOCKED } from "@/lib/guineaTestIsolation";

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

    // Cash is Guinea-only (GNF). Never accepted for Stripe or other local markets.
    const requestedPaymentMethod = String(
      rawBody.payment_method ?? rawBody.paymentMethod ?? "",
    )
      .trim()
      .toLowerCase();
    const guineaCash = requestedPaymentMethod === "cash";
    if (guineaCash && String(countryCode).trim().toUpperCase() !== "GN") {
      return mmdLocationJson(
        {
          ok: false,
          error: "cash_not_available",
          message: "Cash payment is only available in Guinea.",
        },
        400,
      );
    }

    // Stripe markets: pay-then-create via food_checkout_intents.
    // Unpaid order rows are only allowed for local mobile-money markets.
    if (!usesLocalMobileMoney(countryCode)) {
      return mmdLocationJson(
        {
          ok: false,
          error: "use_quote_checkout",
          message:
            "Stripe food orders must be paid before creation. Use /api/stripe/client/create-food-quote-checkout-session.",
        },
        400,
      );
    }

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
    const restaurantProfile = restaurantGate.profile;

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
      paymentMethod: guineaCash ? "cash" : null,
    });

    // Cash orders are actionable by the restaurant immediately (pending_cash); fail-open.
    if (guineaCash) {
      try {
        await runFoodOrderPaymentSideEffects(auth.supabaseAdmin, {
          orderId: result.orderId,
          notifyClientPaid: false,
          notifyRestaurant: true,
        });
      } catch (sideEffectError) {
        console.warn(
          "[orders/food/create] cash side effects fail-open",
          sideEffectError instanceof Error ? sideEffectError.message : sideEffectError,
        );
      }
    }

    return mmdLocationJson({
      ok: true,
      order_id: result.orderId,
      ...(guineaCash ? { payment_method: "cash", payment_status: "pending_cash" } : {}),
      pricing: buildFoodPricingResponse(result),
      commissions: result.commissions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";

    if (isDeliverySharePctError(error)) {
      // Never create an order when the delivery split is invalid.
      return mmdLocationJson(
        deliverySharePctApiErrorPayload("api.orders.food.create", error),
        400
      );
    }

    if (message === "guinea_food_cash_schema_not_ready") {
      return mmdLocationJson({ ok: false, error: message }, 503);
    }

    return mmdLocationJson(
      { ok: false, error: message },
      message === GUINEA_TEST_LIVE_OPERATION_BLOCKED ? 403 : 400,
    );
  }
}
