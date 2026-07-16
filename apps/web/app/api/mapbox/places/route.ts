import { NextRequest, NextResponse } from "next/server";
import { assertMapboxComputeDistanceAccess } from "@/lib/mapboxRouteSecurity";
import { tryGetServerMapboxToken } from "@/lib/mapboxToken";
import { cacheWrap } from "@/lib/memoryCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": status === 200 ? "private, max-age=30" : "no-store",
    },
  });
}

export type MapboxPlaceSuggestion = {
  id: string;
  name: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
  placeType: string;
};

function parseSuggestions(data: unknown): MapboxPlaceSuggestion[] {
  const features = (data as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];

  const out: MapboxPlaceSuggestion[] = [];
  for (const feature of features) {
    const row = feature as {
      id?: string;
      text?: string;
      place_name?: string;
      center?: number[];
      place_type?: string[];
    };
    const [lng, lat] = row.center ?? [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      id: String(row.id ?? `${lng},${lat}`),
      name: String(row.text ?? row.place_name ?? "").trim() || String(row.place_name ?? ""),
      fullAddress: String(row.place_name ?? "").trim(),
      latitude: Number(lat),
      longitude: Number(lng),
      placeType: String(row.place_type?.[0] ?? "place"),
    });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const access = await assertMapboxComputeDistanceAccess(req);
  if (access.ok === false) {
    return json({ error: access.error }, access.status);
  }

  const MAPBOX_TOKEN = tryGetServerMapboxToken();
  if (!MAPBOX_TOKEN) {
    return json({ error: "Mapbox token not configured (MAPBOX_ACCESS_TOKEN)" }, 500);
  }

  let query = "";
  let proximity: { lat?: number; lng?: number } | undefined;
  let country = "";
  let limit = 5;

  try {
    const body = (await req.json()) as {
      query?: string;
      proximity?: { lat?: number; lng?: number };
      country?: string;
      limit?: number;
    };
    query = String(body.query ?? "").trim();
    proximity = body.proximity;
    country = String(body.country ?? "").trim().toLowerCase();
    const lim = Number(body.limit);
    if (Number.isFinite(lim) && lim > 0) {
      limit = Math.min(10, Math.floor(lim));
    }
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!query) {
    return json({ ok: true, suggestions: [] });
  }

  const lat = Number(proximity?.lat);
  const lng = Number(proximity?.lng);
  const proximityKey =
    Number.isFinite(lat) && Number.isFinite(lng)
      ? `${lat.toFixed(3)},${lng.toFixed(3)}`
      : "";
  const cacheKey = `mapbox:places:v1:${query.toLowerCase()}:${country}:${limit}:${proximityKey}`;

  try {
    const suggestions = await cacheWrap(cacheKey, 30_000, async () => {
      const MAPBOX_TOKEN_INNER = MAPBOX_TOKEN;
      const params = new URLSearchParams({
        access_token: MAPBOX_TOKEN_INNER,
        autocomplete: "true",
        types: "address,poi,place,locality,neighborhood",
        limit: String(limit),
      });

      if (proximityKey) {
        params.set("proximity", `${lng},${lat}`);
      }
      if (country) {
        params.set("country", country);
      }

      const url =
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
        `?${params.toString()}`;

      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error("Mapbox places failed");
      }

      return parseSuggestions(data);
    });

    return json({
      ok: true,
      suggestions,
    });
  } catch {
    return json({ error: "Mapbox places failed" }, 502);
  }
}
