import { NextResponse } from "next/server";
import { computeDeliveryPricing } from "@/lib/deliveryPricing";

// ✅ On accepte MAPBOX_ACCESS_TOKEN ou NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
const MAPBOX_TOKEN =
  process.env.MAPBOX_ACCESS_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

if (!MAPBOX_TOKEN) {
  console.warn(
    "⚠️ Token Mapbox manquant (MAPBOX_ACCESS_TOKEN ou NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN)."
  );
}

// ✅ FIX TS: on évite le union (A | B) qui casse Partial<BodyShape>
// On garde les mêmes champs, mais optionnels.
// Ensuite on valide nous-mêmes selon les cas.
type BodyShape = {
  // cas adresses (mobile + web)
  pickupAddress?: string;
  dropoffAddress?: string;

  // cas coordonnées (ancien code web)
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
};

async function geocodeAddress(address: string) {
  if (!MAPBOX_TOKEN) throw new Error("Token Mapbox manquant (env serveur)");

  const url =
    "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
    encodeURIComponent(address) +
    `.json?access_token=${encodeURIComponent(MAPBOX_TOKEN)}&limit=1`;

  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Erreur geocoding Mapbox (${res.status}): ${txt}`);
  }

  const json = await res.json();
  const feature = json.features?.[0];
  if (!feature || !feature.center) {
    throw new Error("Aucun résultat de géocodage pour: " + address);
  }

  const [lng, lat] = feature.center as [number, number];
  return { lat, lng };
}

async function getDistanceAndDuration(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number
) {
  if (!MAPBOX_TOKEN) throw new Error("Token Mapbox manquant (env serveur)");

  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving/${pickupLng},${pickupLat};${dropoffLng},${dropoffLat}`
  );
  url.searchParams.set("overview", "false");
  url.searchParams.set("access_token", MAPBOX_TOKEN);

  const res = await fetch(url.toString(), {
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Erreur Mapbox Directions (${res.status}): ${txt}`);
  }

  const json = await res.json();

  if (!json.routes || !json.routes[0]) {
    throw new Error("Aucune route trouvée entre ces points");
  }

  const route = json.routes[0];
  const distanceMeters: number = Number(route.distance ?? 0);
  const durationSeconds: number = Number(route.duration ?? 0);

  const distanceMiles = distanceMeters / 1609.34;

  // ✅ minutes en number propre
  const etaMinutes = durationSeconds / 60;
  const etaMinutesRounded = Math.ceil(etaMinutes);

  return {
    distanceMiles,
    etaMinutes,
    etaMinutesRounded,
    distanceMeters,
    durationSeconds,
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as BodyShape;

    let pickupLat: number;
    let pickupLng: number;
    let dropoffLat: number;
    let dropoffLng: number;

    // 🅰️ CAS 1 : on reçoit des ADRESSES (mobile + web)
    if (body.pickupAddress != null && body.dropoffAddress != null) {
      const pickupAddress = body.pickupAddress?.trim();
      const dropoffAddress = body.dropoffAddress?.trim();

      if (!pickupAddress || !dropoffAddress) {
        return NextResponse.json(
          { ok: false, error: "Adresses pickup/dropoff manquantes" },
          { status: 400 }
        );
      }

      const pickupGeo = await geocodeAddress(pickupAddress);
      const dropoffGeo = await geocodeAddress(dropoffAddress);

      pickupLat = pickupGeo.lat;
      pickupLng = pickupGeo.lng;
      dropoffLat = dropoffGeo.lat;
      dropoffLng = dropoffGeo.lng;
    }
    // 🅱️ CAS 2 : coordonnées direct (ancien web)
    else if (
      body.pickupLat != null &&
      body.pickupLng != null &&
      body.dropoffLat != null &&
      body.dropoffLng != null
    ) {
      pickupLat = body.pickupLat;
      pickupLng = body.pickupLng;
      dropoffLat = body.dropoffLat;
      dropoffLng = body.dropoffLng;
    } else {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Coordonnées ou adresses manquantes (pickup/dropoff lat/lng ou pickupAddress/dropoffAddress)",
        },
        { status: 400 }
      );
    }

    const {
      distanceMiles,
      etaMinutes,
      etaMinutesRounded,
      distanceMeters,
      durationSeconds,
    } = await getDistanceAndDuration(
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng
    );

    // 🔴 Niveau 3 — blocage backend absolu
    const BLOCK_MILES = 50;

    if (distanceMiles > BLOCK_MILES) {
      return NextResponse.json(
        {
          ok: false,
          error: "distance_too_far",
          message: `Distance too far: ${distanceMiles.toFixed(2)} mi`,
          distanceMiles,
          etaMinutes,
        },
        { status: 400 }
      );
    }

    // 💰 Formule MMD (déjà définie dans lib/deliveryPricing)
    const deliveryPrice = computeDeliveryPricing({
      distanceMiles,
      durationMinutes: etaMinutes,
    });

    // ✅ IMPORTANT : renvoyer aussi les coords pour que le mobile puisse les sauvegarder dans orders
    return NextResponse.json({
      ok: true,

      // ✅ champs modernes (recommandés)
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,

      distanceMiles,
      etaMinutes,
      deliveryPrice,

      // ✅ aliases simples (souvent attendus côté UI)
      distance_miles: distanceMiles,
      eta_minutes: etaMinutesRounded,

      // 🔁 compat (ancien web)
      distance_miles_est: distanceMiles,
      eta_minutes_est: etaMinutesRounded,

      // ✅ compat naming DB si tu veux les mapper directement
      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
      dropoff_lat: dropoffLat,
      dropoff_lng: dropoffLng,

      raw: {
        distance_meters: distanceMeters,
        duration_seconds: durationSeconds,
      },

      // certains vieux codes attendent ça
      delivery_fee: deliveryPrice,
      delivery_fee_usd: deliveryPrice,
    });
  } catch (e: any) {
    console.error("API /mapbox/compute-distance error:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? "Erreur interne serveur",
      },
      { status: 500 }
    );
  }
}
