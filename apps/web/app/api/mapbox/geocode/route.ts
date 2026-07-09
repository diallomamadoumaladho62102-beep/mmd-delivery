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

  let address = "";
  try {
    const body = (await req.json()) as { address?: string };
    address = String(body.address ?? "").trim();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!address) {
    return json({ error: "address is required" }, 400);
  }

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json` +
    `?access_token=${encodeURIComponent(MAPBOX_TOKEN)}&limit=1`;

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    return json({ error: "Mapbox geocode failed", details: data }, 502);
  }

  const feature = data?.features?.[0];
  if (!feature) {
    return json({ error: "No results" }, 404);
  }

  const [lng, lat] = feature.center ?? [];

  return json({
    ok: true,
    formattedAddress: feature.place_name ?? address,
    latitude: lat,
    longitude: lng,
  });
}
