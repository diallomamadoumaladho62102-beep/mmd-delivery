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
import { quoteDeliveryRequestServerSide } from "@/lib/deliveryRequestService";
import {
  deliverySharePctApiErrorPayload,
  isDeliverySharePctError,
} from "@/lib/deliveryShareApiError";
import { inferPlatformCountryCode } from "@/lib/platformLaunchControl";

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

    const pricing = await quoteDeliveryRequestServerSide({
      supabaseAdmin: auth.supabaseAdmin,
      pickupAddress: fields.pickupAddress,
      dropoffAddress: fields.dropoffAddress,
      pickupLat: fields.pickupLat,
      pickupLng: fields.pickupLng,
      dropoffLat: fields.dropoffLat,
      dropoffLng: fields.dropoffLng,
      dropoffLocationId: fields.dropoffLocationId,
      countryCode,
      promoCode: fields.promoCode,
    });

    return mmdLocationJson({
      ok: true,
      quote: buildDeliveryPricingResponse(pricing),
    });
  } catch (error) {
    if (isDeliverySharePctError(error)) {
      return mmdLocationJson(
        deliverySharePctApiErrorPayload("api.delivery-requests.quote", error),
        400
      );
    }
    const message = error instanceof Error ? error.message : "Server error";
    return mmdLocationJson({ ok: false, error: message }, 400);
  }
}
