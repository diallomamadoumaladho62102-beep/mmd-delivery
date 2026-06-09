import { NextRequest } from "next/server";
import {
  mmdLocationJson,
  normalizeCountryCode,
  normalizeOptionalText,
  requireMmdLocationApiUser,
} from "@/lib/mmdLocationCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireMmdLocationApiUser(req);
  if (auth.ok === false) return auth.response;

  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") ?? "").trim();
  const countryRaw = url.searchParams.get("country_code") ?? "GN";
  const commune = normalizeOptionalText(url.searchParams.get("commune_name"));
  const quartier = normalizeOptionalText(url.searchParams.get("quartier_name"));
  const limitRaw = Number(url.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(50, Math.max(1, Math.floor(limitRaw)))
    : 20;

  let countryCode: string;
  try {
    countryCode = normalizeCountryCode(countryRaw);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid country_code";
    return mmdLocationJson({ error: message }, 400);
  }

  let query = auth.supabaseUser
    .from("location_landmarks")
    .select(
      "id, country_code, region_name, prefecture_name, city_name, commune_name, quartier_name, name, landmark_type, lat, lng, provider, status, confidence_score"
    )
    .eq("country_code", countryCode)
    .eq("status", "approved")
    .order("confidence_score", { ascending: false })
    .limit(limit);

  if (commune) {
    query = query.ilike("commune_name", `%${commune}%`);
  }

  if (quartier) {
    query = query.ilike("quartier_name", `%${quartier}%`);
  }

  if (q) {
    query = query.ilike("name", `%${q}%`);
  }

  const { data, error } = await query;

  if (error) {
    return mmdLocationJson({ error: error.message }, 500);
  }

  return mmdLocationJson({
    ok: true,
    landmarks: data ?? [],
  });
}
