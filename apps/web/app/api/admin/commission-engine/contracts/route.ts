import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  CONTRACT_STATUSES,
  PARTNER_TYPES,
  cleanText,
  parseFixedFee,
  parseRatePct,
  validateDateRange,
  writeCommissionAudit,
} from "@/lib/commission/commissionAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("commissions.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const partnerType = String(params.get("partnerType") ?? "").trim();
    const partnerUserId = String(params.get("partnerUserId") ?? "").trim();
    const status = String(params.get("status") ?? "").trim();
    const country = String(params.get("countryCode") ?? "").trim();
    const city = String(params.get("city") ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") ?? 100) || 100));

    let query = supabase
      .from("commercial_contracts")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (partnerType) query = query.eq("partner_type", partnerType);
    if (partnerUserId) query = query.eq("partner_user_id", partnerUserId);
    if (status) query = query.eq("status", status);
    if (country) query = query.eq("country_code", country.toUpperCase());
    if (city) query = query.ilike("city", city);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, contracts: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("commissions.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const partnerType = String(body.partner_type ?? "").trim();
    const partnerUserId = String(body.partner_user_id ?? "").trim();
    const name = cleanText(body.name, 200);
    if (!PARTNER_TYPES.has(partnerType)) return json({ ok: false, error: "Invalid partner_type" }, 400);
    if (!UUID_RE.test(partnerUserId)) return json({ ok: false, error: "Invalid partner_user_id" }, 400);
    if (!name) return json({ ok: false, error: "Missing name" }, 400);

    const rate = parseRatePct(body.rate_pct);
    if (rate == null) return json({ ok: false, error: "Invalid rate_pct" }, 400);
    const fixed = body.fixed_fee_cents === undefined ? 0 : parseFixedFee(body.fixed_fee_cents);
    if (fixed == null) return json({ ok: false, error: "Invalid fixed_fee_cents" }, 400);

    const status = String(body.status ?? "draft");
    if (!CONTRACT_STATUSES.has(status)) return json({ ok: false, error: "Invalid status" }, 400);

    const dates = validateDateRange(body.starts_at, body.ends_at);
    if ("error" in dates) return json({ ok: false, error: dates.error }, 400);

    const row = {
      partner_type: partnerType,
      partner_user_id: partnerUserId,
      name,
      rate_pct: rate,
      fixed_fee_cents: fixed,
      services: Array.isArray(body.services) ? body.services.map(String) : [],
      categories: Array.isArray(body.categories) ? body.categories.map(String) : [],
      country_code: cleanText(body.country_code, 8)?.toUpperCase() ?? null,
      city: cleanText(body.city, 120),
      starts_at: dates.starts_at,
      ends_at: dates.ends_at,
      status,
      internal_notes: cleanText(body.internal_notes, 2000),
      created_by: session.userId,
    };

    const { data, error } = await supabase
      .from("commercial_contracts")
      .insert(row)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeCommissionAudit({
      supabase,
      adminUserId: session.userId,
      action: "commercial_contract_created",
      entityType: "commercial_contract",
      entityId: data?.id,
      partnerType,
      partnerUserId,
      newValue: data,
      reason: cleanText(body.reason, 500),
      request,
    });

    return json({ ok: true, contract: data });
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

    const id = String(body.id ?? "").trim();
    if (!UUID_RE.test(id)) return json({ ok: false, error: "Invalid id" }, 400);
    const reason = cleanText(body.reason, 500);
    if (!reason) return json({ ok: false, error: "Reason is required" }, 400);

    const { data: existing } = await supabase
      .from("commercial_contracts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!existing) return json({ ok: false, error: "Contract not found" }, 404);

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = cleanText(body.name, 200);
      if (!name) return json({ ok: false, error: "Invalid name" }, 400);
      patch.name = name;
    }
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
      if (!CONTRACT_STATUSES.has(String(body.status))) {
        return json({ ok: false, error: "Invalid status" }, 400);
      }
      patch.status = String(body.status);
    }
    if (body.services !== undefined) {
      patch.services = Array.isArray(body.services) ? body.services.map(String) : [];
    }
    if (body.categories !== undefined) {
      patch.categories = Array.isArray(body.categories) ? body.categories.map(String) : [];
    }
    if (body.country_code !== undefined) {
      patch.country_code = cleanText(body.country_code, 8)?.toUpperCase() ?? null;
    }
    if (body.city !== undefined) patch.city = cleanText(body.city, 120);
    if (body.internal_notes !== undefined) {
      patch.internal_notes = cleanText(body.internal_notes, 2000);
    }
    if (body.starts_at !== undefined || body.ends_at !== undefined) {
      const dates = validateDateRange(
        body.starts_at !== undefined ? body.starts_at : existing.starts_at,
        body.ends_at !== undefined ? body.ends_at : existing.ends_at
      );
      if ("error" in dates) return json({ ok: false, error: dates.error }, 400);
      if (body.starts_at !== undefined) patch.starts_at = dates.starts_at;
      if (body.ends_at !== undefined) patch.ends_at = dates.ends_at;
    }

    if (Object.keys(patch).length === 0) {
      return json({ ok: false, error: "No valid fields to update" }, 400);
    }

    const { data, error } = await supabase
      .from("commercial_contracts")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeCommissionAudit({
      supabase,
      adminUserId: session.userId,
      action: "commercial_contract_updated",
      entityType: "commercial_contract",
      entityId: id,
      partnerType: existing.partner_type,
      partnerUserId: existing.partner_user_id,
      oldValue: existing,
      newValue: data,
      reason,
      request,
    });

    return json({ ok: true, contract: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
