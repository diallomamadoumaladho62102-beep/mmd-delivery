import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const COUNTRY_SELECT =
  "country_code, country_name, continent, ai_enabled, ai_enabled_updated_at, ai_enabled_updated_by";

const REGION_SELECT =
  "country_code, region_code, region_name, region_type, ai_enabled, ai_enabled_updated_at, ai_enabled_updated_by";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

async function loadUpdatedByNames(
  supabase: ReturnType<typeof buildSupabaseAdminClient>,
  ids: string[]
) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, string>();

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", unique);

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const label =
      String(row.full_name ?? "").trim() ||
      String(row.email ?? "").trim() ||
      String(row.id);
    map.set(String(row.id), label);
  }
  return map;
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("mmd_ai.read", request);
    const supabase = buildSupabaseAdminClient();
    const countryFilter = request.nextUrl.searchParams.get("country")?.trim().toUpperCase();

    const countriesQuery = supabase
      .from("platform_countries")
      .select(COUNTRY_SELECT)
      .order("country_name", { ascending: true });

    const regionsQuery = supabase
      .from("platform_regions")
      .select(REGION_SELECT)
      .order("country_code", { ascending: true })
      .order("region_name", { ascending: true });

    if (countryFilter) {
      regionsQuery.eq("country_code", countryFilter);
    }

    const [countriesRes, regionsRes] = await Promise.all([countriesQuery, regionsQuery]);

    if (countriesRes.error) return json({ ok: false, error: countriesRes.error.message }, 500);
    if (regionsRes.error) return json({ ok: false, error: regionsRes.error.message }, 500);

    const updaterIds = [
      ...(countriesRes.data ?? []).map((row) => String(row.ai_enabled_updated_by ?? "")),
      ...(regionsRes.data ?? []).map((row) => String(row.ai_enabled_updated_by ?? "")),
    ];
    const names = await loadUpdatedByNames(supabase, updaterIds);

    const countries = (countriesRes.data ?? []).map((row) => ({
      ...row,
      scope_type: "country" as const,
      updated_by_name: row.ai_enabled_updated_by
        ? names.get(String(row.ai_enabled_updated_by)) ?? row.ai_enabled_updated_by
        : null,
    }));

    const regions = (regionsRes.data ?? []).map((row) => ({
      ...row,
      scope_type: "region" as const,
      state_code: row.region_type === "state" ? row.region_code.toUpperCase() : null,
      updated_by_name: row.ai_enabled_updated_by
        ? names.get(String(row.ai_enabled_updated_by)) ?? row.ai_enabled_updated_by
        : null,
    }));

    return json({ ok: true, countries, regions });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
