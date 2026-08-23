import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { applyTaxiServiceFeeToQuote } from "@/lib/taxiServiceFee";
import {
  buildTaxiPricingPreviewBreakdown,
  type TaxiQuoteRpcResult,
} from "@/lib/taxiPricingPreview";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * Admin Pricing Preview — same engines as live taxi quote:
 * 1) RPC quote_taxi_ride (fare, tax, driver/platform split)
 * 2) applyTaxiServiceFeeToQuote (client service fee)
 * Stripe fee is a labeled display estimate only (not settlement SoT).
 */
export async function POST(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_pricing.read", request);
    const supabase = buildSupabaseAdminClient();
    const body = await request.json().catch(() => ({}));

    const countryCode = String(
      (body as { country_code?: string }).country_code ?? "US"
    )
      .trim()
      .toUpperCase();
    const vehicleClass = String(
      (body as { vehicle_class?: string }).vehicle_class ?? "standard"
    )
      .trim()
      .toLowerCase();
    const distanceMiles = Math.max(
      0,
      Number((body as { distance_miles?: number }).distance_miles ?? 5)
    );
    const durationMinutes = Math.max(
      0,
      Number((body as { duration_minutes?: number }).duration_minutes ?? 15)
    );
    const passengerCount = Math.max(
      1,
      Math.round(
        Number((body as { passenger_count?: number }).passenger_count ?? 1)
      )
    );

    const { data: quote, error: quoteError } = await supabase.rpc(
      "quote_taxi_ride",
      {
        p_distance_miles: distanceMiles,
        p_duration_minutes: durationMinutes,
        p_vehicle_class: vehicleClass,
        p_country_code: countryCode,
        p_passenger_count: passengerCount,
      }
    );

    if (quoteError) {
      return json({ ok: false, error: quoteError.message }, 500);
    }

    const quoteObj = (quote ?? {}) as TaxiQuoteRpcResult;
    if (quoteObj.ok === false) {
      return json(
        {
          ok: false,
          error: quoteObj.message ?? "quote_failed",
          quote: quoteObj,
        },
        400
      );
    }

    const serviceFeeQuote = await applyTaxiServiceFeeToQuote(supabase, {
      countryCode,
      vehicleClass,
      subtotalCents: Number(quoteObj.subtotal_cents ?? 0),
      taxCents: Number(quoteObj.tax_cents ?? 0),
    });

    const preview = buildTaxiPricingPreviewBreakdown({
      quote: quoteObj,
      serviceFeeCents: serviceFeeQuote.serviceFeeCents,
    });

    return json({
      ok: true,
      preview,
      quote: quoteObj,
      service_fee: {
        enabled: serviceFeeQuote.enabled,
        pct: serviceFeeQuote.pct,
        fixed_cents: serviceFeeQuote.fixedCents,
        service_fee_cents: serviceFeeQuote.serviceFeeCents,
      },
      note:
        "Preview uses saved taxi_pricing via quote_taxi_ride + applyTaxiServiceFeeToQuote (live quote engines). Stripe fee is a US-card display estimate only — actual fee comes from Balance Transaction after payment.",
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
