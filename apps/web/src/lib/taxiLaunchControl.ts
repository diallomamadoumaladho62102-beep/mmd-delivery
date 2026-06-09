import type { SupabaseClient } from "@supabase/supabase-js";

export type TaxiLaunchStatus = "enabled" | "disabled" | "maintenance";

export type TaxiCountryLaunchConfig = {
  country_code: string;
  launch_status: TaxiLaunchStatus;
  checkout_enabled: boolean;
  payout_enabled: boolean;
  shared_enabled: boolean;
  business_enabled: boolean;
  scheduled_enabled: boolean;
  premium_enabled: boolean;
};

const LAUNCH_SELECT =
  "country_code, launch_status, checkout_enabled, payout_enabled, shared_enabled, business_enabled, scheduled_enabled, premium_enabled";

export async function fetchTaxiCountryLaunchConfig(
  supabase: SupabaseClient,
  countryCode: string
): Promise<TaxiCountryLaunchConfig | null> {
  const code = String(countryCode ?? "").trim().toUpperCase();
  if (!code) return null;

  const { data, error } = await supabase
    .from("taxi_countries")
    .select(LAUNCH_SELECT)
    .eq("country_code", code)
    .maybeSingle<TaxiCountryLaunchConfig>();

  if (error || !data) return null;
  return data;
}

export function readinessScoreColor(score: number): "red" | "orange" | "green" {
  if (score >= 80) return "green";
  if (score >= 60) return "orange";
  return "red";
}

export function assertTaxiLaunchFeature(
  config: TaxiCountryLaunchConfig,
  feature:
    | "checkout"
    | "payout"
    | "shared"
    | "business"
    | "scheduled"
    | "premium"
): { ok: true } | { ok: false; error: string; message: string } {
  if (config.launch_status === "maintenance") {
    return {
      ok: false,
      error: "country_maintenance",
      message: `Taxi service in ${config.country_code} is under maintenance`,
    };
  }

  if (config.launch_status !== "enabled") {
    return {
      ok: false,
      error: "country_launch_disabled",
      message: `Taxi is not launched in ${config.country_code}`,
    };
  }

  const flags: Record<typeof feature, boolean> = {
    checkout: config.checkout_enabled,
    payout: config.payout_enabled,
    shared: config.shared_enabled,
    business: config.business_enabled,
    scheduled: config.scheduled_enabled,
    premium: config.premium_enabled,
  };

  if (!flags[feature]) {
    return {
      ok: false,
      error: `taxi_${feature}_not_enabled`,
      message: `Taxi ${feature} is not enabled for ${config.country_code}`,
    };
  }

  return { ok: true };
}
