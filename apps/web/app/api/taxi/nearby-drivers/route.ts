import { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/apiRateLimit";
import { getDistanceAndEta } from "@/lib/mapboxRoute";
import { createNearbyReaders, loadNearbyActiveDrivers } from "@/lib/nearbyActiveDriversService";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireTaxiApiUser(req);
  if (auth.ok === false) return auth.response;

  const limited = checkRateLimit({
    namespace: "taxi-nearby-drivers",
    key: auth.user.id,
    limit: 20,
    windowMs: 60_000,
  });
  if (limited.limited) {
    return taxiJson({ error: "rate_limited" }, 429);
  }

  const body = (await req.json().catch(() => null)) as {
    pickup_lat?: unknown;
    pickup_lng?: unknown;
    vehicle_class?: unknown;
    radius_miles?: unknown;
  } | null;

  try {
    const result = await loadNearbyActiveDrivers({
      pickupLat: body?.pickup_lat,
      pickupLng: body?.pickup_lng,
      vehicleClass: body?.vehicle_class,
      radiusMiles: body?.radius_miles,
      readers: createNearbyReaders(auth.supabaseAdmin, auth.supabaseUser),
      routeMinutes: async (from, to) => {
        const route = await getDistanceAndEta(from, to);
        return route.etaMinutes;
      },
    });
    if (result.ok === false) return taxiJson({ error: result.error }, 400);
    return taxiJson(result);
  } catch {
    return taxiJson({ error: "nearby_unavailable" }, 503);
  }
}
