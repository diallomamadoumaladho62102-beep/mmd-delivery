import { NextResponse } from "next/server";

type Body = {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<Body>;

    const { pickupLat, pickupLng, dropoffLat, dropoffLng } = body;

    if (
      pickupLat == null ||
      pickupLng == null ||
      dropoffLat == null ||
      dropoffLng == null
    ) {
      return NextResponse.json(
        { error: "Coordonnées manquantes (pickup/dropoff lat/lng)" },
        { status: 400 }
      );
    }

    const token = process.env.MAPBOX_ACCESS_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "MAPBOX_ACCESS_TOKEN manquant côté serveur" },
        { status: 500 }
      );
    }

    const url = new URL(
      `https://api.mapbox.com/directions/v5/mapbox/driving/${pickupLng},${pickupLat};${dropoffLng},${dropoffLat}`
    );
    url.searchParams.set("overview", "false");
    url.searchParams.set("access_token", token);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const txt = await res.text();
      console.error("Mapbox error:", res.status, txt);
      return NextResponse.json(
        { error: "Erreur Mapbox Directions" },
        { status: 502 }
      );
    }

    const json = await res.json();

    if (!json.routes || !json.routes[0]) {
      return NextResponse.json(
        { error: "Aucune route trouvée entre ces points" },
        { status: 404 }
      );
    }

    const route = json.routes[0];
    const distanceMeters: number = route.distance;
    const durationSeconds: number = route.duration;

    const distanceMiles = distanceMeters / 1609.34;
    const etaMinutes = Math.ceil(durationSeconds / 60);

    return NextResponse.json({
      distance_miles_est: distanceMiles,
      eta_minutes_est: etaMinutes,
      raw: {
        distance_meters: distanceMeters,
        duration_seconds: durationSeconds,
      },
    });
  } catch (e: any) {
    console.error("API /mapbox/compute-distance error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Erreur interne serveur" },
      { status: 500 }
    );
  }
}
