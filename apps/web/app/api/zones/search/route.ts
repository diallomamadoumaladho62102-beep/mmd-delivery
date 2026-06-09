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
  const regionName = normalizeOptionalText(url.searchParams.get("region_name"));
  const communeName = normalizeOptionalText(url.searchParams.get("commune_name"));
  const includeInactive =
    String(url.searchParams.get("include_inactive") ?? "").trim() === "1";
  const limitRaw = Number(url.searchParams.get("limit") ?? 30);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(100, Math.max(1, Math.floor(limitRaw)))
    : 30;

  let countryCode: string;
  try {
    countryCode = normalizeCountryCode(countryRaw);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid country_code";
    return mmdLocationJson({ error: message }, 400);
  }

  let query = auth.supabaseUser
    .from("mmd_zones")
    .select(
      "id, country_code, region_name, prefecture_name, city_name, commune_name, quartier_name, zone_code, zone_name, is_active"
    )
    .eq("country_code", countryCode)
    .order("region_name", { ascending: true })
    .order("commune_name", { ascending: true, nullsFirst: true })
    .order("quartier_name", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (!includeInactive) {
    query = query.eq("is_active", true);
  }

  if (regionName) {
    query = query.ilike("region_name", `%${regionName}%`);
  }

  if (communeName) {
    query = query.ilike("commune_name", `%${communeName}%`);
  }

  if (q) {
    query = query.or(
      [
        `zone_name.ilike.%${q}%`,
        `zone_code.ilike.%${q}%`,
        `commune_name.ilike.%${q}%`,
        `quartier_name.ilike.%${q}%`,
        `region_name.ilike.%${q}%`,
      ].join(",")
    );
  }

  const { data, error } = await query;

  if (error) {
    return mmdLocationJson({ error: error.message }, 500);
  }

  return mmdLocationJson({
    ok: true,
    zones: data ?? [],
  });
}
