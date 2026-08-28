import type { AiToolContext, AiToolResult } from "@/lib/ai/aiTypes";
import { isValidCoordinate } from "@/lib/taxiMapbox";
import { searchPublicPlaces } from "@/lib/ai/searchPublicPlaces";

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function bool(value: unknown): boolean {
  if (value === true || value === "true") return true;
  return false;
}

export async function searchPlaces(
  ctx: AiToolContext,
  args: Record<string, unknown>
): Promise<AiToolResult> {
  const lat =
    num(args.latitude ?? args.lat ?? args.reference_lat) ??
    (isValidCoordinate(ctx.referenceLatitude, ctx.referenceLongitude)
      ? ctx.referenceLatitude
      : undefined);
  const lng =
    num(args.longitude ?? args.lng ?? args.reference_lng) ??
    (isValidCoordinate(ctx.referenceLatitude, ctx.referenceLongitude)
      ? ctx.referenceLongitude
      : undefined);

  const result = await searchPublicPlaces({
    query: String(args.query ?? args.name ?? args.q ?? "").trim(),
    category: String(args.category ?? "").trim(),
    area: String(args.area ?? args.city ?? args.address ?? "").trim(),
    latitude: lat,
    longitude: lng,
    radiusMeters: num(args.radius_meters ?? args.radiusMeters),
    nearest: bool(args.nearest ?? args.closest),
    countryCode: String(args.country_code ?? ctx.countryCode ?? "").trim() || undefined,
    limit: num(args.limit),
    locale: ctx.locale,
  });

  return {
    ok: result.ok,
    summary: result.summary,
    data: {
      needsArea: result.needsArea,
      invented: false,
      category: result.category,
      places: result.places.map((place) => ({
        name: place.name,
        address: place.address,
        city: place.city,
        distanceKm: place.distanceKm,
        latitude: place.latitude,
        longitude: place.longitude,
        ...(place.phone ? { phone: place.phone } : {}),
        ...(place.hours ? { hours: place.hours } : {}),
      })),
    },
    actions: result.places.slice(0, 5).map((place) => ({
      type: "quick_reply" as const,
      label: place.name,
      intent: "choose_place",
    })),
  };
}
