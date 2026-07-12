import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import {
  DEFAULT_ENABLED_PREFERENCES,
  DEFAULT_PREFERENCE_DROP_ORDER,
  TAXI_CLIENT_PREFERENCE_KEYS,
  type TaxiClientPreferenceKey,
} from "@/lib/taxiClientPreferences";
import { normalizeTaxiCityName } from "@/lib/taxiCityDetection";
import { normalizeTaxiCountryCode } from "@/lib/taxiCountries";
import { safeRequestJson } from "@/lib/safeRequestJson";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function normalizeEnabledPreferences(raw: unknown): Record<string, boolean> {
  const input = (raw ?? {}) as Record<string, unknown>;
  const enabled: Record<string, boolean> = { ...DEFAULT_ENABLED_PREFERENCES };
  for (const key of TAXI_CLIENT_PREFERENCE_KEYS) {
    if (input[key] !== undefined) {
      enabled[key] = Boolean(input[key]);
    }
  }
  return enabled;
}

function normalizeDropOrder(raw: unknown): TaxiClientPreferenceKey[] {
  if (!Array.isArray(raw)) return [...DEFAULT_PREFERENCE_DROP_ORDER];
  const cleaned = raw.map((item) => String(item).trim()).filter(Boolean);
  const valid = cleaned.filter((key): key is TaxiClientPreferenceKey =>
    TAXI_CLIENT_PREFERENCE_KEYS.includes(key as TaxiClientPreferenceKey),
  );
  return valid.length > 0 ? valid : [...DEFAULT_PREFERENCE_DROP_ORDER];
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_drivers.read", request);
    const supabase = buildSupabaseAdminClient();

    const { data: rules, error } = await supabase
      .from("taxi_dispatch_preference_rules")
      .select("*")
      .order("country_code", { ascending: true, nullsFirst: true })
      .order("city", { ascending: true, nullsFirst: true });

    if (error) return json({ ok: false, error: error.message }, 500);

    const { data: stats } = await supabase
      .from("taxi_preference_stats")
      .select("*")
      .order("stat_date", { ascending: false })
      .limit(60);

    return json({
      ok: true,
      rules: rules ?? [],
      stats: stats ?? [],
      preference_keys: TAXI_CLIENT_PREFERENCE_KEYS,
      default_drop_order: DEFAULT_PREFERENCE_DROP_ORDER,
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("taxi_drivers.manage", request);
    const supabase = buildSupabaseAdminClient();
    const parsed = await safeRequestJson<Record<string, any>>(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const countryRaw = body.country_code;
    const cityRaw = body.city;
    const countryCode =
      countryRaw == null || String(countryRaw).trim() === ""
        ? null
        : normalizeTaxiCountryCode(countryRaw);
    const city =
      cityRaw == null || String(cityRaw).trim() === ""
        ? null
        : normalizeTaxiCityName(cityRaw);

    if (countryCode == null && city != null) {
      return json({ ok: false, error: "city_rule_requires_country" }, 400);
    }

    const { data: globalRule } = await supabase
      .from("taxi_dispatch_preference_rules")
      .select("*")
      .is("country_code", null)
      .is("city", null)
      .maybeSingle();

    const widenDelaySeconds = Number(
      body.widen_delay_seconds ?? globalRule?.widen_delay_seconds ?? 30,
    );
    const preferenceDropOrder = normalizeDropOrder(
      body.preference_drop_order ?? globalRule?.preference_drop_order,
    );
    const enabledPreferences = normalizeEnabledPreferences(
      body.enabled_preferences ?? globalRule?.enabled_preferences,
    );

    const { data: created, error } = await supabase
      .from("taxi_dispatch_preference_rules")
      .insert({
        country_code: countryCode,
        city,
        widen_delay_seconds: widenDelaySeconds,
        preference_drop_order: preferenceDropOrder,
        enabled_preferences: enabledPreferences,
        is_active: true,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return json({ ok: false, error: "rule_already_exists" }, 409);
      }
      return json({ ok: false, error: error.message }, 500);
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_dispatch_preference_rules_create",
      targetType: "taxi_dispatch_preference_rules",
      targetId: String(created.id),
      metadata: { country_code: countryCode, city },
      request,
    });

    return json({ ok: true, rule: created });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertStaffPermission("taxi_drivers.manage", request);
    const supabase = buildSupabaseAdminClient();
    const parsed = await safeRequestJson<Record<string, any>>(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const ruleId = String(body.rule_id ?? body.id ?? "").trim();

    if (!ruleId) return json({ ok: false, error: "rule_id_required" }, 400);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.widen_delay_seconds !== undefined) {
      patch.widen_delay_seconds = Number(body.widen_delay_seconds);
    }
    if (body.preference_drop_order !== undefined) {
      patch.preference_drop_order = normalizeDropOrder(body.preference_drop_order);
    }
    if (body.enabled_preferences !== undefined) {
      patch.enabled_preferences = normalizeEnabledPreferences(body.enabled_preferences);
    }
    if (body.is_active !== undefined) {
      patch.is_active = Boolean(body.is_active);
    }

    const { error } = await supabase
      .from("taxi_dispatch_preference_rules")
      .update(patch)
      .eq("id", ruleId);

    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_dispatch_preference_rules_update",
      targetType: "taxi_dispatch_preference_rules",
      targetId: ruleId,
      metadata: patch,
      request,
    });

    return json({ ok: true });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
