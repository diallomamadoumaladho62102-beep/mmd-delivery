import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertCanWriteTaxiPricing, assertStaffPermission } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { readGuineaStandardCommissionBps, validateGuineaStandardSettings } from "@/lib/markets/guineaStandard";
import { readGuineaTaxiRateCard } from "@/lib/markets/guineaTaxiPricing";

export const dynamic = "force-dynamic";

const SELECT =
  "id,country_code,currency,base_fare_gnf,per_km_gnf,per_minute_gnf,minimum_fare_gnf,maximum_fare_gnf,platform_share_bps,updated_at,updated_by";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function schemaMissing(message: string): boolean {
  return /guinea_standard_|schema cache|does not exist/i.test(message);
}

function environmentSettings() {
  const rates = readGuineaTaxiRateCard();
  const bps = readGuineaStandardCommissionBps();
  if (rates.ok === false || bps == null) return null;
  return {
    country_code: "GN",
    currency: "GNF",
    base_fare_gnf: rates.card.baseFareGnf,
    per_km_gnf: rates.card.perKmGnf,
    per_minute_gnf: rates.card.perMinuteGnf,
    minimum_fare_gnf: rates.card.minimumFareGnf,
    maximum_fare_gnf: rates.card.maximumFareGnf,
    platform_share_bps: bps,
    updated_at: null,
    updated_by: null,
  };
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_pricing.read", request);
    const supabase = buildSupabaseAdminClient();
    const [settings, history] = await Promise.all([
      supabase.from("guinea_standard_settings").select(SELECT).eq("id", "GN").maybeSingle(),
      supabase
        .from("guinea_standard_audit")
        .select("id,actor_id,action,old_value,new_value,reason,created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (settings.error && schemaMissing(settings.error.message)) {
      return json({
        ok: true,
        schemaReady: false,
        source: environmentSettings() ? "environment" : "missing",
        settings: environmentSettings(),
        history: [],
      });
    }
    if (settings.error || history.error) return json({ ok: false, error: "guinea_catalog_failed" }, 500);
    if (!settings.data) {
      const fallback = environmentSettings();
      return json({
        ok: true,
        schemaReady: true,
        source: fallback ? "environment" : "missing",
        settings: fallback,
        history: history.data ?? [],
      });
    }
    return json({
      ok: true,
      schemaReady: true,
      source: "database",
      settings: settings.data,
      history: history.data ?? [],
    });
  } catch (error: unknown) {
    if (error instanceof AdminAccessError) return json({ ok: false, error: error.message }, error.status);
    return json({ ok: false, error: "Server error" }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const staff = await assertCanWriteTaxiPricing(request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.currency != null && String(body.currency).trim().toUpperCase() !== "GNF") {
      return json({ ok: false, error: "currency_mismatch" }, 400);
    }
    const validated = validateGuineaStandardSettings({
      baseFareGnf: body.baseFareGnf,
      perKmGnf: body.perKmGnf,
      perMinuteGnf: body.perMinuteGnf,
      minimumFareGnf: body.minimumFareGnf,
      maximumFareGnf: body.maximumFareGnf,
      platformShareBps: body.platformShareBps,
    });
    if (validated.ok === false) return json({ ok: false, error: validated.error }, 400);

    const current = await supabase.from("guinea_standard_settings").select(SELECT).eq("id", "GN").maybeSingle();
    if (current.error && schemaMissing(current.error.message)) {
      return json({ ok: false, error: "guinea_standard_schema_not_ready" }, 503);
    }
    if (current.error) return json({ ok: false, error: "guinea_catalog_failed" }, 500);

    const row = {
      id: "GN",
      country_code: "GN",
      currency: "GNF",
      base_fare_gnf: validated.baseFareGnf,
      per_km_gnf: validated.perKmGnf,
      per_minute_gnf: validated.perMinuteGnf,
      minimum_fare_gnf: validated.minimumFareGnf,
      maximum_fare_gnf: validated.maximumFareGnf,
      platform_share_bps: validated.platformShareBps,
      updated_by: staff.userId,
      updated_at: new Date().toISOString(),
    };
    const saved = current.data
      ? await supabase.from("guinea_standard_settings").update(row).eq("id", "GN").select(SELECT).maybeSingle()
      : await supabase.from("guinea_standard_settings").insert(row).select(SELECT).maybeSingle();
    if (saved.error || !saved.data) return json({ ok: false, error: "guinea_rate_invalid" }, 400);

    await supabase.from("guinea_standard_audit").insert({
      actor_id: staff.userId,
      action: "rates_saved",
      old_value: current.data,
      new_value: saved.data,
      reason: body.reason ? String(body.reason).slice(0, 300) : null,
    });
    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: staff.userId,
      action: "guinea_standard_rates_saved",
      targetType: "guinea_standard_settings",
      targetId: "GN",
      oldValues: current.data,
      newValues: saved.data,
      request,
    });
    return json({ ok: true, source: "database", settings: saved.data });
  } catch (error: unknown) {
    if (error instanceof AdminAccessError) return json({ ok: false, error: error.message }, error.status);
    return json({ ok: false, error: "Server error" }, 500);
  }
}
