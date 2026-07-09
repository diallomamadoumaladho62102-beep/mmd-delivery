import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getBearerToken,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  mmdLocationJson,
} from "@/lib/mmdLocationCore";
import {
  resolveClientPlatformScope,
  resolveDriverPlatformScope,
  resolvePlatformScopeFeatures,
  resolveRestaurantPlatformScope,
} from "@/lib/platformScopeResolver";

export type PlatformFeaturesAuth =
  | {
      ok: true;
      userId: string;
      supabaseAdmin: SupabaseClient;
    }
  | { ok: false; response: ReturnType<typeof mmdLocationJson> };

export async function requirePlatformFeaturesAuth(
  req: NextRequest
): Promise<PlatformFeaturesAuth> {
  const token = getBearerToken(req);
  if (!token) {
    return {
      ok: false,
      response: mmdLocationJson({ ok: false, error: "Missing Authorization Bearer token" }, 401),
    };
  }

  const supabaseUser = getSupabaseUserClient(token);
  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseUser.auth.getUser();
  const user = data?.user;

  if (error || !user?.id) {
    return { ok: false, response: mmdLocationJson({ ok: false, error: "Invalid token" }, 401) };
  }

  return { ok: true, userId: user.id, supabaseAdmin };
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export function readClientScopeQuery(req: NextRequest) {
  const url = new URL(req.url);
  return {
    pickupCountry: url.searchParams.get("pickup_country"),
    pickupState: url.searchParams.get("pickup_state"),
    pickupCounty:
      url.searchParams.get("pickup_county") ?? url.searchParams.get("pickup_county_code"),
    pickupLat: parseOptionalNumber(url.searchParams.get("pickup_lat")),
    pickupLng: parseOptionalNumber(url.searchParams.get("pickup_lng")),
    manualCountry: url.searchParams.get("country"),
    manualState: url.searchParams.get("state") ?? url.searchParams.get("state_code"),
    manualCounty: url.searchParams.get("county") ?? url.searchParams.get("county_code"),
    manualRegionCode: url.searchParams.get("region_code"),
    lat: parseOptionalNumber(url.searchParams.get("lat")),
    lng: parseOptionalNumber(url.searchParams.get("lng")),
  };
}

export function readDriverScopeQuery(req: NextRequest) {
  const url = new URL(req.url);
  return {
    lat: parseOptionalNumber(url.searchParams.get("lat")),
    lng: parseOptionalNumber(url.searchParams.get("lng")),
    missionCountry: url.searchParams.get("mission_country"),
    missionRegionCode: url.searchParams.get("mission_region_code"),
    missionCountyCode:
      url.searchParams.get("mission_county") ?? url.searchParams.get("mission_county_code"),
    missionMmdZoneId: url.searchParams.get("mission_mmd_zone_id"),
  };
}

export async function buildClientFeaturesResponse(
  supabaseAdmin: SupabaseClient,
  userId: string,
  req: NextRequest
) {
  const input = readClientScopeQuery(req);
  const scope = await resolveClientPlatformScope(supabaseAdmin, userId, input);
  const features = await resolvePlatformScopeFeatures(supabaseAdmin, scope);

  if (!features) {
    return mmdLocationJson(
      { ok: false, error: "platform_country_not_configured", scope },
      404
    );
  }

  return mmdLocationJson({ ok: true, scope, ...features });
}

export async function buildDriverFeaturesResponse(
  supabaseAdmin: SupabaseClient,
  userId: string,
  req: NextRequest
) {
  const input = readDriverScopeQuery(req);
  const scope = await resolveDriverPlatformScope(supabaseAdmin, userId, input);
  const features = await resolvePlatformScopeFeatures(supabaseAdmin, scope);

  if (!features) {
    return mmdLocationJson(
      { ok: false, error: "platform_country_not_configured", scope },
      404
    );
  }

  const outOfService = Boolean(features.out_of_service_area);
  const payload = {
    ok: true as const,
    scope,
    ...features,
    can_go_online: !outOfService && features.platform_enabled,
    can_receive_requests: !outOfService && features.platform_enabled,
    out_of_service_area: outOfService,
    driver_status_label: outOfService ? "Out of Service Area" : null,
    unavailable_title: outOfService ? "Out of Service Area" : features.unavailable_title,
    message: outOfService
      ? "You have entered an area where MMD Delivery is not operating yet.\nYou can finish your current trip, but you will not receive new requests until you return to an active county."
      : features.message,
  };

  return mmdLocationJson(payload);
}

export async function buildRestaurantFeaturesResponse(
  supabaseAdmin: SupabaseClient,
  userId: string
) {
  const scope = await resolveRestaurantPlatformScope(supabaseAdmin, userId);
  const features = await resolvePlatformScopeFeatures(supabaseAdmin, scope);

  if (!features) {
    return mmdLocationJson(
      { ok: false, error: "platform_country_not_configured", scope },
      404
    );
  }

  const foodOff = !features.restaurant_available;
  return mmdLocationJson({
    ok: true,
    scope,
    ...features,
    unavailable_title: foodOff ? "Restaurant Dashboard" : features.unavailable_title,
    message: foodOff
      ? "Food delivery is currently disabled in your county.\n\nOrders cannot be received until this county is activated."
      : features.message,
  });
}
