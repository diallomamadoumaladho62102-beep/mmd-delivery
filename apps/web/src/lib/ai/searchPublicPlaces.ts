import { haversineMeters } from "@/lib/geoTrust";
import { cacheWrap } from "@/lib/memoryCache";
import { tryGetServerMapboxToken } from "@/lib/mapboxToken";
import { isValidCoordinate } from "@/lib/taxiMapbox";
import {
  isGenericCategoryQuery,
  mapboxQueryForCategory,
  resolvePlaceCategory,
  type PlaceCategoryId,
} from "@/lib/ai/placeCategories";

export type PublicPlaceHit = {
  name: string;
  address: string;
  city: string | null;
  distanceKm: number | null;
  latitude: number;
  longitude: number;
  phone: string | null;
  hours: string | null;
};

export type SearchPublicPlacesInput = {
  query?: string;
  category?: string;
  area?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  nearest?: boolean;
  countryCode?: string;
  limit?: number;
  locale?: string;
};

export type SearchPublicPlacesResult = {
  ok: boolean;
  needsArea: boolean;
  invented: false;
  places: PublicPlaceHit[];
  summary: string;
  category: PlaceCategoryId | null;
};

type MapboxFeature = {
  id?: string;
  text?: string;
  place_name?: string;
  center?: number[];
  properties?: {
    address?: string;
    category?: string;
    tel?: string;
    phone?: string;
  };
  context?: Array<{ id?: string; text?: string }>;
};

export type SearchPublicPlacesDeps = {
  fetchFn?: (input: RequestInfo | URL | string, init?: RequestInit) => Promise<{
    ok: boolean;
    json: () => Promise<unknown>;
  }>;
  token?: string | null;
};

function askAreaSummary(locale?: string): string {
  const key = String(locale ?? "en").split("-")[0].toLowerCase();
  if (key === "fr") {
    return "Bien sûr. Dans quelle ville, quel quartier ou quelle adresse souhaitez-vous effectuer la recherche ?";
  }
  if (key === "es") {
    return "Claro. ¿En qué ciudad, barrio o dirección debo buscar?";
  }
  if (key === "ar") {
    return "بالتأكيد. في أي مدينة أو حي أو عنوان تريد أن أبحث؟";
  }
  if (key === "zh") {
    return "当然可以。请告诉我要搜索的城市、街区或地址。";
  }
  return "Sure. Which city, neighborhood, or address should I search in?";
}

function noResultSummary(locale?: string): string {
  const key = String(locale ?? "en").split("-")[0].toLowerCase();
  if (key === "fr") {
    return "Aucun résultat fiable n'a été trouvé. Je ne vais pas inventer une adresse.";
  }
  return "No reliable result was found. I will not invent an address.";
}

function parseCity(feature: MapboxFeature): string | null {
  const context = feature.context ?? [];
  for (const row of context) {
    const id = String(row.id ?? "");
    if (id.startsWith("place.") || id.startsWith("locality.")) {
      const text = String(row.text ?? "").trim();
      if (text) return text;
    }
  }
  return null;
}

function parsePublicPlaces(data: unknown, origin: { lat: number; lng: number } | null): PublicPlaceHit[] {
  const features = (data as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: PublicPlaceHit[] = [];
  for (const raw of features) {
    const row = raw as MapboxFeature;
    const [lng, lat] = row.center ?? [];
    if (!isValidCoordinate(lat, lng)) continue;
    const address = String(row.place_name ?? "").trim();
    const name = String(row.text ?? address).trim();
    if (!name || !address) continue;
    const phone = String(row.properties?.tel ?? row.properties?.phone ?? "").trim() || null;
    const distanceKm =
      origin && isValidCoordinate(origin.lat, origin.lng)
        ? Math.round((haversineMeters({ lat: origin.lat, lng: origin.lng }, { lat: Number(lat), lng: Number(lng) }) / 1000) * 10) / 10
        : null;
    out.push({
      name,
      address,
      city: parseCity(row),
      distanceKm,
      latitude: Number(lat),
      longitude: Number(lng),
      phone,
      hours: null,
    });
  }
  if (origin) {
    out.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
  }
  return out;
}

async function mapboxGeocode(
  query: string,
  opts: {
    token: string;
    types: string;
    proximity?: { lat: number; lng: number } | null;
    countryCode?: string;
    limit: number;
    fetchFn: NonNullable<SearchPublicPlacesDeps["fetchFn"]>;
  }
): Promise<unknown> {
  const params = new URLSearchParams({
    access_token: opts.token,
    autocomplete: "true",
    types: opts.types,
    limit: String(opts.limit),
  });
  if (opts.proximity && isValidCoordinate(opts.proximity.lat, opts.proximity.lng)) {
    params.set("proximity", `${opts.proximity.lng},${opts.proximity.lat}`);
  }
  if (opts.countryCode) {
    params.set("country", opts.countryCode.toLowerCase());
  }
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?${params.toString()}`;
  const res = await opts.fetchFn(url, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error("mapbox_places_failed");
  }
  return data;
}

function formatSummary(places: PublicPlaceHit[], locale?: string): string {
  if (!places.length) return noResultSummary(locale);
  const lines = places.map((place, index) => {
    const bits = [`${index + 1}. ${place.name}`, place.address];
    if (place.distanceKm != null) bits.push(`${place.distanceKm} km`);
    if (place.phone) bits.push(place.phone);
    return bits.join(" — ");
  });
  const intro =
    String(locale ?? "en").split("-")[0] === "fr"
      ? "Voici des lieux publics trouvés. Choisissez un résultat. Aucune adresse n'a été inventée."
      : "Here are public places I found. Choose one. No address was invented.";
  return `${intro} ${lines.join(" ")}`.slice(0, 1200);
}

export async function searchPublicPlaces(
  input: SearchPublicPlacesInput,
  deps: SearchPublicPlacesDeps = {}
): Promise<SearchPublicPlacesResult> {
  const locale = input.locale;
  const category = resolvePlaceCategory(String(input.category ?? "")) ?? resolvePlaceCategory(String(input.query ?? ""));
  const namedQuery = String(input.query ?? "").trim();
  const area = String(input.area ?? "").trim();
  const nearest = input.nearest === true;
  const limitRaw = Number(input.limit ?? 5);
  const limit = Number.isFinite(limitRaw) ? Math.min(8, Math.max(1, Math.trunc(limitRaw))) : 5;

  let origin: { lat: number; lng: number } | null = null;
  if (isValidCoordinate(input.latitude, input.longitude)) {
    origin = { lat: Number(input.latitude), lng: Number(input.longitude) };
  }

  const searchText = namedQuery || mapboxQueryForCategory(category) || "";
  const hasAnchor = Boolean(origin) || area.length >= 2;
  const generic = isGenericCategoryQuery(namedQuery, category);

  if ((nearest || generic) && !hasAnchor) {
    return {
      ok: true,
      needsArea: true,
      invented: false,
      places: [],
      summary: askAreaSummary(locale),
      category,
    };
  }

  if (!searchText && !area) {
    return {
      ok: true,
      needsArea: true,
      invented: false,
      places: [],
      summary: askAreaSummary(locale),
      category,
    };
  }

  const token = deps.token !== undefined ? deps.token : tryGetServerMapboxToken();
  if (!token) {
    return {
      ok: false,
      needsArea: false,
      invented: false,
      places: [],
      summary: "Place search is temporarily unavailable. I will not invent an address.",
      category,
    };
  }

  const fetchFn = deps.fetchFn ?? fetch;

  try {
    if (!origin && area) {
      const areaData = await cacheWrap(`mmd-ai-places-area:${area.toLowerCase()}`, 30_000, () =>
        mapboxGeocode(area, {
          token,
          types: "place,locality,neighborhood,address",
          countryCode: input.countryCode,
          limit: 1,
          fetchFn,
        })
      );
      const areaHits = parsePublicPlaces(areaData, null);
      if (areaHits[0] && isValidCoordinate(areaHits[0].latitude, areaHits[0].longitude)) {
        origin = { lat: areaHits[0].latitude, lng: areaHits[0].longitude };
      }
    }

    const poiQuery = searchText || area;
    const cacheKey = `mmd-ai-places:${poiQuery.toLowerCase()}:${origin?.lat ?? ""}:${origin?.lng ?? ""}:${input.countryCode ?? ""}:${limit}`;
    const data = await cacheWrap(cacheKey, 30_000, () =>
      mapboxGeocode(poiQuery, {
        token,
        types: namedQuery && !category ? "poi,address,place" : "poi",
        proximity: origin,
        countryCode: input.countryCode,
        limit,
        fetchFn,
      })
    );

    let places = parsePublicPlaces(data, origin);
    const radius = Number(input.radiusMeters);
    if (Number.isFinite(radius) && radius > 0 && origin) {
      const filtered = places.filter((place) => (place.distanceKm ?? 0) * 1000 <= radius);
      if (filtered.length) places = filtered;
    }
    places = places.slice(0, limit);

    return {
      ok: true,
      needsArea: false,
      invented: false,
      places,
      summary: formatSummary(places, locale),
      category,
    };
  } catch {
    return {
      ok: false,
      needsArea: false,
      invented: false,
      places: [],
      summary: noResultSummary(locale),
      category,
    };
  }
}
