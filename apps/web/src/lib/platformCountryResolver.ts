import type { SupabaseClient } from "@supabase/supabase-js";
import {
  inferPlatformCountryCode,
  normalizePlatformCountryCode,
} from "@/lib/platformCountryInference";

export async function resolveClientPlatformCountry(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const { data } = await supabase
    .from("client_addresses")
    .select("country")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();

  const country = normalizePlatformCountryCode(data?.country);
  return country.length === 2 ? country : "US";
}

export async function resolveRestaurantPlatformCountry(
  supabase: SupabaseClient,
  restaurantUserId: string
): Promise<string> {
  const { data } = await supabase
    .from("restaurant_profiles")
    .select("city, address")
    .eq("user_id", restaurantUserId)
    .maybeSingle();

  const city = String(data?.city ?? "").trim().toUpperCase();
  if (city.includes("CONAKRY") || city.includes("GUINE")) return "GN";
  if (city.includes("DAKAR") || city.includes("SENEGAL")) return "SN";
  if (city.includes("ABIDJAN") || city.includes("IVOIRE")) return "CI";
  if (city.includes("BAMAKO") || city.includes("MALI")) return "ML";
  if (city.includes("FREETOWN") || city.includes("SIERRA")) return "SL";
  if (city.includes("NOUAKCHOTT") || city.includes("MAURITAN")) return "MR";

  return "US";
}

export function resolveOrderPlatformCountry(order: {
  currency?: unknown;
  pickup_lat?: unknown;
  pickup_lng?: unknown;
  dropoff_lat?: unknown;
  dropoff_lng?: unknown;
}): string {
  return inferPlatformCountryCode({
    currency: order.currency,
    lat: order.dropoff_lat ?? order.pickup_lat,
    lng: order.dropoff_lng ?? order.pickup_lng,
  });
}

export function resolveDeliveryRequestPlatformCountry(request: {
  currency?: unknown;
  pickup_lat?: unknown;
  pickup_lng?: unknown;
}): string {
  return inferPlatformCountryCode({
    currency: request.currency,
    lat: request.pickup_lat,
    lng: request.pickup_lng,
  });
}
