import { NextRequest } from "next/server";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import { requireDeliveryClientAuth } from "@/lib/deliveryRequestApiAuth";
import {
  buildDeliveryPricingResponse,
  countryCodeFromDeliveryAuthScope,
  parseDeliveryRequestBody,
  readDeliveryRequestFields,
  validateDeliveryRequestFields,
} from "@/lib/deliveryRequestApiShared";
import { createDeliveryRequestServerSide } from "@/lib/deliveryRequestService";
import {
  deliverySharePctApiErrorPayload,
  isDeliverySharePctError,
} from "@/lib/deliveryShareApiError";
import { inferPlatformCountryCode } from "@/lib/platformLaunchControl";
import { usesLocalMobileMoney } from "@/lib/paymentProviderRouting";
import { routeDistanceLimitUserMessage } from "@/lib/routeDistanceLimits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireDeliveryClientAuth(req);
  if (auth.ok === false) return auth.response;

  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return mmdLocationJson({ ok: false, error: "Invalid JSON body" }, 400);
  }

  try {
    const body = parseDeliveryRequestBody(rawBody);
    const fields = readDeliveryRequestFields(body);
    validateDeliveryRequestFields(fields);

    const scopeCountry = countryCodeFromDeliveryAuthScope(auth.scope);
    const countryCode = inferPlatformCountryCode({
      countryCode: scopeCountry,
      lat: fields.dropoffLat,
      lng: fields.dropoffLng,
    });

    // Stripe markets: pay-then-create via delivery_checkout_intents.
    if (!usesLocalMobileMoney(countryCode)) {
      return mmdLocationJson(
        {
          ok: false,
          error: "use_quote_checkout",
          message:
            "Stripe delivery requests must be paid before creation. Use /api/stripe/client/create-delivery-quote-checkout-session.",
        },
        400,
      );
    }

    const safeTitle =
      fields.title ||
      (fields.requestType === "ride" ? "Private ride request" : "Package delivery");

    const result = await createDeliveryRequestServerSide({
      supabaseAdmin: auth.supabaseAdmin,
      clientId: auth.user.id,
      requestType: fields.requestType,
      title: safeTitle,
      description: fields.description,
      pickupAddress: fields.pickupAddress,
      dropoffAddress: fields.dropoffAddress,
      pickupContactName: fields.pickupContactName,
      pickupPhone: fields.pickupPhone,
      dropoffContactName: fields.dropoffContactName,
      dropoffPhone: fields.dropoffPhone,
      pickupLat: fields.pickupLat,
      pickupLng: fields.pickupLng,
      dropoffLat: fields.dropoffLat,
      dropoffLng: fields.dropoffLng,
      dropoffLocationId: fields.dropoffLocationId,
      countryCode,
      promoCode: fields.promoCode,
      leaveAtDoor: fields.leaveAtDoor,
    });

    return mmdLocationJson({
      ok: true,
      delivery_request_id: result.deliveryRequestId,
      pricing: buildDeliveryPricingResponse(result),
    });
  } catch (error) {
    if (isDeliverySharePctError(error)) {
      return mmdLocationJson(
        deliverySharePctApiErrorPayload("api.delivery-requests.create", error),
        400
      );
    }
    const message = error instanceof Error ? error.message : "Server error";
    if (message === "delivery_distance_too_far") {
      return mmdLocationJson(
        {
          ok: false,
          error: message,
          message: routeDistanceLimitUserMessage(message, "en"),
        },
        400,
      );
    }
    return mmdLocationJson({ ok: false, error: message }, 400);
  }
}
