import type { NextRequest } from "next/server";
import { mmdLocationJson, requireMmdLocationApiUser } from "@/lib/mmdLocationCore";
import { canStartServiceInCounty } from "@/lib/canStartServiceInCounty";
import { readClientScopeQuery } from "@/lib/platformScopeApi";
import {
  resolveClientPlatformScope,
  resolvePlatformScopeFeatures,
} from "@/lib/platformScopeResolver";
import { resolveCountySnapshotFromInput } from "@/lib/originCountyServiceGate";

function parseOptionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function readOptionalJsonBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  if (req.method === "GET" || req.method === "HEAD") return null;
  try {
    const clone = req.clone();
    const body = await clone.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function requireFoodClientAuth(req: NextRequest) {
  const auth = await requireMmdLocationApiUser(req);
  if (auth.ok === false) return auth;

  const query = readClientScopeQuery(req);
  const body = await readOptionalJsonBody(req);

  // Food origin = restaurant / pickup location (not client dropoff).
  const originInput = {
    countryCode:
      String(body?.pickup_country ?? body?.pickupCountry ?? query.pickupCountry ?? query.manualCountry ?? "US") ||
      "US",
    stateCode:
      String(body?.pickup_state ?? body?.pickupState ?? query.pickupState ?? query.manualState ?? "") ||
      undefined,
    countyCode:
      String(body?.pickup_county ?? body?.pickupCounty ?? query.pickupCounty ?? query.manualCounty ?? "") ||
      undefined,
    lat:
      parseOptionalNumber(body?.pickup_lat ?? body?.pickupLat) ??
      query.pickupLat ??
      query.lat,
    lng:
      parseOptionalNumber(body?.pickup_lng ?? body?.pickupLng) ??
      query.pickupLng ??
      query.lng,
  };

  const destinationInput = {
    countryCode: String(body?.dropoff_country ?? body?.dropoffCountry ?? "") || undefined,
    stateCode: String(body?.dropoff_state ?? body?.dropoffState ?? "") || undefined,
    countyCode: String(body?.dropoff_county ?? body?.dropoffCounty ?? "") || undefined,
    lat: parseOptionalNumber(body?.dropoff_lat ?? body?.dropoffLat),
    lng: parseOptionalNumber(body?.dropoff_lng ?? body?.dropoffLng),
  };

  const [originCounty, destinationCounty] = await Promise.all([
    resolveCountySnapshotFromInput(auth.supabaseAdmin, originInput),
    resolveCountySnapshotFromInput(auth.supabaseAdmin, destinationInput),
  ]);

  const startGate = canStartServiceInCounty({
    service: "food",
    originCounty,
    destinationCounty,
  });

  if (!startGate.allowed) {
    return {
      ok: false as const,
      response: mmdLocationJson(
        {
          ok: false,
          error: "restaurant_unavailable",
          code: startGate.code,
          title: startGate.title,
          message: startGate.message,
          actions: startGate.actions,
        },
        403
      ),
    };
  }

  const scopeKey = await resolveClientPlatformScope(auth.supabaseAdmin, auth.user.id, {
    pickupCountry: originInput.countryCode,
    pickupState: originInput.stateCode,
    pickupCounty: originInput.countyCode,
    pickupLat: originInput.lat,
    pickupLng: originInput.lng,
    lat: originInput.lat,
    lng: originInput.lng,
  });

  const features = scopeKey
    ? await resolvePlatformScopeFeatures(auth.supabaseAdmin, scopeKey)
    : null;

  if (!features?.checkout_enabled) {
    return {
      ok: false as const,
      response: mmdLocationJson(
        {
          ok: false,
          error: "checkout_disabled",
          title: "Service not available yet",
          message: features?.message ?? "Checkout is disabled in your market.",
        },
        403
      ),
    };
  }

  return {
    ok: true as const,
    ...auth,
    scope: features,
    scopeKey,
    startGate,
  };
}
