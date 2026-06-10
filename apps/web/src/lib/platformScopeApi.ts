import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getBearerToken,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  mmdLocationJson,
} from "@/lib/mmdLocationCore";
import type { PlatformFeatureAvailability } from "@/lib/platformScopeTypes";
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
    pickupLat: parseOptionalNumber(url.searchParams.get("pickup_lat")),
    pickupLng: parseOptionalNumber(url.searchParams.get("pickup_lng")),
    manualCountry: url.searchParams.get("country"),
    manualState: url.searchParams.get("state") ?? url.searchParams.get("state_code"),
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

  const payload: PlatformFeatureAvailability & { ok: true; scope: typeof scope } = {
    ok: true,
    scope,
    ...features,
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

  return mmdLocationJson({ ok: true, scope, ...features });
}
