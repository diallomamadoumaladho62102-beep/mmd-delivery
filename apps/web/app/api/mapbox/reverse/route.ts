import { NextRequest, NextResponse } from "next/server";
import { assertMapboxComputeDistanceAccess } from "@/lib/mapboxRouteSecurity";
import { tryGetServerMapboxToken } from "@/lib/mapboxToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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

  let latitude = NaN;
  let longitude = NaN;

  try {
    const body = (await req.json()) as {
      latitude?: number;
      longitude?: number;
      lat?: number;
      lng?: number;
    };
    latitude = Number(body.latitude ?? body.lat);
    longitude = Number(body.longitude ?? body.lng);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return json({ error: "latitude and longitude are required" }, 400);
  }

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json` +
    `?access_token=${encodeURIComponent(MAPBOX_TOKEN)}` +
    `&types=address,poi,place&limit=1`;

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    return json({ error: "Mapbox reverse geocode failed", details: data }, 502);
  }

  const feature = (data as { features?: Array<{
    place_name?: string;
    text?: string;
    center?: number[];
  }> } | null)?.features?.[0];

  if (!feature) {
    return json({
      ok: true,
      fullAddress: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
      shortName: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
      latitude,
      longitude,
    });
  }

  const [lng, lat] = feature.center ?? [longitude, latitude];
  const fullAddress = String(feature.place_name ?? "").trim();
  const shortName = String(feature.text ?? fullAddress).trim() || fullAddress;

  return json({
    ok: true,
    fullAddress: fullAddress || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
    shortName: shortName || fullAddress,
    latitude: Number.isFinite(lat) ? Number(lat) : latitude,
    longitude: Number.isFinite(lng) ? Number(lng) : longitude,
  });
}
