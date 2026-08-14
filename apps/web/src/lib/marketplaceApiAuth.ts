import type { NextRequest } from "next/server";
import {
  getSupabaseAdminClient,
  mmdLocationJson,
  requireMmdLocationApiUser,
} from "@/lib/mmdLocationCore";
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

/**
 * Guest-safe catalog access (Apple 5.1.1(v)): browse approved sellers/products
 * without an account. Uses service role only for public storefront fields —
 * never returns orders, wallets, addresses, or private seller ops data.
 * Cart / checkout / favorites still require requireMarketplaceClientAuth.
 */
export function allowMarketplacePublicCatalog() {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    return { ok: true as const, supabaseAdmin, guest: true as const };
  } catch (error) {
    return {
      ok: false as const,
      response: mmdLocationJson(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Server error",
        },
        500,
      ),
    };
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

  if (!features) {
    return {
      ok: false as const,
      response: mmdLocationJson(
        {
          ok: false,
          error: "platform_country_not_configured",
          title: "Service not available yet",
          message: "Marketplace is not configured for this area yet.",
        },
        404
      ),
    };
  }

  if (!features.marketplace_available) {
    return {
      ok: false as const,
      response: mmdLocationJson(
        {
          ok: false,
          error: "marketplace_unavailable",
          title: "Marketplace unavailable",
          message:
            features.service_messages?.marketplace ??
            features.message ??
            "Marketplace is not available in this county yet.",
        },
        403
      ),
    };
  }

  return { ok: true as const, ...auth, scope: features, startGate };
}
