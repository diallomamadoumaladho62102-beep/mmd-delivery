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
import { schedulePricingShadowCompare } from "@/lib/pricingEngine/shadow/runShadowCompare";
import { buildPackageComparablePair } from "@/lib/pricingEngine/engine/adapters/packageAdapter";
import { selectPackageChargePath } from "@/lib/pricingEngine/charge/selectFoodPackageCharge";

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

    const legacyStarted = Date.now();
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
    const legacyLatencyMs = Date.now() - legacyStarted;

    schedulePricingShadowCompare({
      legacyLatencyMs,
      deps: { supabaseAdmin: auth.supabaseAdmin },
      buildPair: () =>
        buildPackageComparablePair({
          currency: pricing.currency,
          subtotal: pricing.subtotal,
          tax: pricing.tax,
          deliveryFee: pricing.deliveryFee,
          serviceFee: pricing.serviceFee,
          discounts: pricing.discounts,
          totalCents: pricing.totalCents,
          driverPayoutEstimate: pricing.driverPayoutEstimate,
          deliveryFeeRaw: pricing.deliveryFeeRaw,
        }),
    });

    const selection = await selectPackageChargePath({
      pricing: {
        currency: pricing.currency,
        subtotal: pricing.subtotal,
        tax: pricing.tax,
        deliveryFee: pricing.deliveryFee,
        serviceFee: pricing.serviceFee,
        discounts: pricing.discounts,
        totalCents: pricing.totalCents,
        driverPayoutEstimate: pricing.driverPayoutEstimate,
        deliveryFeeRaw: pricing.deliveryFeeRaw,
        countryCode,
      },
      canaryKey: auth.user.id,
      supabaseAdmin: auth.supabaseAdmin,
    });

    return mmdLocationJson({
      ok: true,
      quote: {
        ...buildDeliveryPricingResponse(pricing),
        total_cents: selection.customerTotalCents,
        charge_path: selection.chargePath,
        pricing_snapshot_id: selection.snapshot?.snapshotId ?? null,
      },
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
