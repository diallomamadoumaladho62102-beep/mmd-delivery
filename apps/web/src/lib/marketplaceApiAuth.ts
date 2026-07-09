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

export async function requireMarketplaceClientAuth(req: NextRequest) {
  const auth = await requireMmdLocationApiUser(req);
  if (auth.ok === false) return auth;

  const query = readClientScopeQuery(req);
  const body = await readOptionalJsonBody(req);

  // Marketplace origin = seller / pickup location when provided; else client scope.
  const originInput = {
    countryCode:
      String(
        body?.pickup_country ??
          body?.pickupCountry ??
          query.pickupCountry ??
          query.manualCountry ??
          "US"
      ) || "US",
    stateCode:
      String(body?.pickup_state ?? body?.pickupState ?? query.pickupState ?? query.manualState ?? "") ||
      undefined,
    countyCode:
      String(
        body?.pickup_county ?? body?.pickupCounty ?? query.pickupCounty ?? query.manualCounty ?? ""
      ) || undefined,
    lat:
      parseOptionalNumber(body?.pickup_lat ?? body?.pickupLat) ??
      query.pickupLat ??
      query.lat,
    lng:
      parseOptionalNumber(body?.pickup_lng ?? body?.pickupLng) ??
      query.pickupLng ??
      query.lng,
  };

  const originCounty = await resolveCountySnapshotFromInput(auth.supabaseAdmin, originInput);
  const startGate = canStartServiceInCounty({
    service: "marketplace",
    originCounty,
    destinationCounty: null,
  });

  if (!startGate.allowed) {
    return {
      ok: false as const,
      response: mmdLocationJson(
        {
          ok: false,
          error: "marketplace_unavailable",
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

  return { ok: true as const, ...auth, scope: features, startGate };
}
