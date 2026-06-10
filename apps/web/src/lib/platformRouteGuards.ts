import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertPlatformFeature,
  type PlatformFeature,
  type PlatformVertical,
} from "@/lib/platformLaunchControl";
import {
  resolveDeliveryRequestPlatformCountry,
  resolveOrderPlatformCountry,
} from "@/lib/platformCountryResolver";

export type PlatformRouteGateFailure = {
  ok: false;
  status: 403;
  body: {
    ok: false;
    error: string;
    message: string;
    country_code: string;
  };
};

export type PlatformRouteGateSuccess = { ok: true };

export async function gateOrderPlatformFeature(
  supabase: SupabaseClient,
  order: Parameters<typeof resolveOrderPlatformCountry>[0],
  vertical: PlatformVertical,
  feature: PlatformFeature = "active"
): Promise<PlatformRouteGateSuccess | PlatformRouteGateFailure> {
  const country = resolveOrderPlatformCountry(order);
  const check = await assertPlatformFeature(supabase, country, vertical, feature);
  if (check.ok === false) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error: check.error,
        message: check.message,
        country_code: check.country_code,
      },
    };
  }
  return { ok: true };
}

export async function gateDeliveryRequestPlatformFeature(
  supabase: SupabaseClient,
  request: Parameters<typeof resolveDeliveryRequestPlatformCountry>[0],
  feature: PlatformFeature = "active"
): Promise<PlatformRouteGateSuccess | PlatformRouteGateFailure> {
  const country = resolveDeliveryRequestPlatformCountry(request);
  const check = await assertPlatformFeature(
    supabase,
    country,
    "delivery",
    feature
  );
  if (check.ok === false) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error: check.error,
        message: check.message,
        country_code: check.country_code,
      },
    };
  }
  return { ok: true };
}

export function orderVerticalForPlatformGate(kind: unknown): PlatformVertical {
  const normalized = String(kind ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return normalized === "food" ? "restaurant" : "delivery";
}
