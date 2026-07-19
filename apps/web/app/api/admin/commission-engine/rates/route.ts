import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  PARTNER_TYPES,
  SERVICES,
  cleanText,
  parseFixedFee,
  parseRatePct,
  writeCommissionAudit,
} from "@/lib/commission/commissionAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * GET — list standard / service / category / city / country rates.
 * PATCH — update a rate row (by table + id). Reason required. No retroactive
 *         effect on existing frozen snapshots.
 */
export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("commissions.read", request);
    const supabase = buildSupabaseAdminClient();

    const [standard, service, category, city, country] = await Promise.all([
      supabase.from("commission_standard_rates").select("*").order("partner_type"),
      supabase.from("commission_service_rates").select("*").order("service"),
      supabase.from("commission_category_rates").select("*").order("category").limit(200),
      supabase.from("commission_city_rates").select("*").order("city").limit(200),
      supabase.from("commission_country_rates").select("*").order("country_code").limit(200),
    ]);

    return json({
      ok: true,
      standard: standard.data ?? [],
      service: service.data ?? [],
      category: category.data ?? [],
      city: city.data ?? [],
      country: country.data ?? [],
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

const TABLES = new Set([
  "commission_standard_rates",
  "commission_service_rates",
  "commission_category_rates",
  "commission_city_rates",
  "commission_country_rates",
]);

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("commissions.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const table = String(body.table ?? "").trim();
    if (!TABLES.has(table)) return json({ ok: false, error: "Invalid table" }, 400);
    const reason = cleanText(body.reason, 500);
    if (!reason) return json({ ok: false, error: "Reason is required" }, 400);

    const rate = parseRatePct(body.rate_pct);
    if (rate == null) return json({ ok: false, error: "Invalid rate_pct" }, 400);
    const fixed = body.fixed_fee_cents === undefined ? 0 : parseFixedFee(body.fixed_fee_cents);
    if (fixed == null) return json({ ok: false, error: "Invalid fixed_fee_cents" }, 400);

    const partnerType = String(body.partner_type ?? "").trim();
    if (!PARTNER_TYPES.has(partnerType)) return json({ ok: false, error: "Invalid partner_type" }, 400);

    const row: Record<string, unknown> = {
      partner_type: partnerType,
      rate_pct: rate,
      fixed_fee_cents: fixed,
      status: "active",
    };

    if (table === "commission_standard_rates" || table === "commission_service_rates") {
      const service = String(body.service ?? "").trim();
      if (!SERVICES.has(service)) return json({ ok: false, error: "Invalid service" }, 400);
      row.service = service;
    }
    if (table === "commission_category_rates") {
      const category = cleanText(body.category, 120);
      if (!category) return json({ ok: false, error: "Missing category" }, 400);
      row.category = category;
      if (body.service) row.service = String(body.service);
      if (body.country_code) row.country_code = cleanText(body.country_code, 8)?.toUpperCase();
    }
    if (table === "commission_city_rates") {
      const country = cleanText(body.country_code, 8)?.toUpperCase();
      const city = cleanText(body.city, 120);
      if (!country || !city) return json({ ok: false, error: "Missing country_code/city" }, 400);
      row.country_code = country;
      row.city = city;
      if (body.service) row.service = String(body.service);
    }
    if (table === "commission_country_rates") {
      const country = cleanText(body.country_code, 8)?.toUpperCase();
      if (!country) return json({ ok: false, error: "Missing country_code" }, 400);
      row.country_code = country;
      if (body.service) row.service = String(body.service);
    }

    const { data, error } = await supabase.from(table).insert(row).select("*").maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeCommissionAudit({
      supabase,
      adminUserId: session.userId,
      action: "commission_rate_created",
      entityType: table,
      entityId: data?.id,
      partnerType,
      newValue: data,
      reason,
      request,
    });

    return json({ ok: true, rate: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertStaffPermission("commissions.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const table = String(body.table ?? "").trim();
    const id = String(body.id ?? "").trim();
    if (!TABLES.has(table)) return json({ ok: false, error: "Invalid table" }, 400);
    if (!id) return json({ ok: false, error: "Missing id" }, 400);
    const reason = cleanText(body.reason, 500);
    if (!reason) return json({ ok: false, error: "Reason is required" }, 400);

    const { data: existing } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
    if (!existing) return json({ ok: false, error: "Rate not found" }, 404);

    const patch: Record<string, unknown> = {};
    if (body.rate_pct !== undefined) {
      const rate = parseRatePct(body.rate_pct);
      if (rate == null) return json({ ok: false, error: "Invalid rate_pct" }, 400);
      patch.rate_pct = rate;
    }
    if (body.fixed_fee_cents !== undefined) {
      const fixed = parseFixedFee(body.fixed_fee_cents);
      if (fixed == null) return json({ ok: false, error: "Invalid fixed_fee_cents" }, 400);
      patch.fixed_fee_cents = fixed;
    }
    if (body.status !== undefined) {
      const status = String(body.status);
      if (status !== "active" && status !== "suspended") {
        return json({ ok: false, error: "Invalid status" }, 400);
      }
      patch.status = status;
    }

    if (Object.keys(patch).length === 0) {
      return json({ ok: false, error: "No valid fields to update" }, 400);
    }

    const { data, error } = await supabase
      .from(table)
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeCommissionAudit({
      supabase,
      adminUserId: session.userId,
      action: "commission_rate_updated",
      entityType: table,
      entityId: id,
      oldValue: existing,
      newValue: data,
      reason,
      request,
    });

    return json({ ok: true, rate: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
