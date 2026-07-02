import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeClientServiceFeeFromCentsBase,
  type ServiceFeeResult,
} from "@/lib/clientServiceFee";
import { loadTaxiServiceFeeConfig } from "@/lib/serviceFeeConfigLoader";

export type TaxiServiceFeeQuote = ServiceFeeResult & {
  grossTotalBeforeServiceFeeCents: number;
  grossTotalWithServiceFeeCents: number;
};

export async function applyTaxiServiceFeeToQuote(
  supabaseAdmin: SupabaseClient,
  params: {
    countryCode: string;
    vehicleClass: string;
    subtotalCents: number;
    taxCents: number;
  }
): Promise<TaxiServiceFeeQuote> {
  const config = await loadTaxiServiceFeeConfig(supabaseAdmin, {
    countryCode: params.countryCode,
    vehicleClass: params.vehicleClass,
  });

  const subtotalCents = Math.max(0, Math.round(Number(params.subtotalCents ?? 0)));
  const taxCents = Math.max(0, Math.round(Number(params.taxCents ?? 0)));
  const feeResult = computeClientServiceFeeFromCentsBase(config, subtotalCents);
  const grossTotalBeforeServiceFeeCents = subtotalCents + taxCents;
  const grossTotalWithServiceFeeCents =
    grossTotalBeforeServiceFeeCents + feeResult.serviceFeeCents;

  return {
    ...feeResult,
    grossTotalBeforeServiceFeeCents,
    grossTotalWithServiceFeeCents,
  };
}

export function mergeTaxiServiceFeeIntoQuote(
  quote: Record<string, unknown>,
  serviceFeeQuote: TaxiServiceFeeQuote
): Record<string, unknown> {
  return {
    ...quote,
    service_fee_cents: serviceFeeQuote.serviceFeeCents,
    service_fee_pct: serviceFeeQuote.pct,
    service_fee_enabled: serviceFeeQuote.enabled,
    service_fee_fixed_cents: serviceFeeQuote.fixedCents,
    gross_total_before_service_fee_cents: serviceFeeQuote.grossTotalBeforeServiceFeeCents,
    total_cents: serviceFeeQuote.grossTotalWithServiceFeeCents,
    gross_total_cents: serviceFeeQuote.grossTotalWithServiceFeeCents,
  };
}
